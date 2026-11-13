'use strict';
// Torrent downloads in Ravenshelf. They are off until the user turns them on
// after reading what torrents share: everyone downloading the same torrent can
// see this PC's IP address, and pieces are uploaded to them while it downloads.
// The torrent engine (aria2) is set up only when the user chooses Set up, and
// a magnet link from a game page, the clipboard or the browser always waits for
// the user to see its files and choose which to download.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {MediaTools}=require('./media-tools.cjs');
const {TorrentEngine,readMetadataFile,MESSAGES:ENGINE}=require('./torrent-engine.cjs');
const {parseMagnet,readTorrent,sanitizeTorrent,MESSAGES:MAGNET}=require('./magnet.cjs');
const {TOOL_MESSAGES,MESSAGES}=require('./torrent-messages.cjs');

// The pinned torrent engine. Its release publishes no checksums, so the
// SHA-256 of the zip was compared with Scoop's and winget's records of the
// same file (both match), and the program inside was measured from that zip.
const TOOLS=Object.freeze([
  Object.freeze({id:'aria2',name:'aria2',version:'1.37.0',license:'GPL-2.0-or-later',source:'github.com/aria2/aria2',archive:'zip',
    url:'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',size:2475379,sha256:'67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288',
    files:Object.freeze([Object.freeze({role:'aria2c',entry:'aria2-1.37.0-win-64bit-build1/aria2c.exe',name:'aria2c.exe',size:5649408,sha256:'be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2'})])})
]);
// Upload limits offered (bytes per second). Uploading cannot be switched off:
// torrents only work when people share pieces with each other.
const UPLOAD_LIMITS=Object.freeze([10*1024,50*1024,100*1024,500*1024,1024*1024]);
const SHARE_MINUTES=Object.freeze([0,15,60]);
const DEFAULTS=Object.freeze({enabled:false,accepted:false,uploadLimit:100*1024,shareMinutes:0});
const MAX_REQUESTS=5,REQUEST_TTL_MS=60*60*1000;

function torrentFolders({profile,isTest,env=process.env}){
  const local=env.LOCALAPPDATA;
  const tools=!isTest&&typeof local==='string'&&path.win32.isAbsolute(local)?path.win32.join(local,'Ravenshelf','torrent-tools'):path.join(profile,'torrent-tools');
  return {tools,state:path.join(profile,'torrents'),store:path.join(profile,'torrents','files')};
}
function normalizeSettings(value){
  const v=value&&typeof value==='object'?value:{};
  return {enabled:v.enabled===true&&v.accepted===true,accepted:v.accepted===true,
    uploadLimit:UPLOAD_LIMITS.includes(v.uploadLimit)?v.uploadLimit:DEFAULTS.uploadLimit,shareMinutes:SHARE_MINUTES.includes(v.shareMinutes)?v.shareMinutes:DEFAULTS.shareMinutes};
}
async function writeAtomic(file,buffer){
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  await fs.promises.writeFile(temporary,buffer,{flag:'wx',mode:0o600});
  try{await fs.promises.rename(temporary,file);}catch(error){await fs.promises.unlink(temporary).catch(()=>{});throw error;}
}

function createTorrentIntegration({app,win,manager,register,publish,Notification=null,assertQueueAvailable=()=>{},isTest=false,platform=process.platform,folders=null,toolsOptions={},engineOptions={},now=Date.now}){
  manager.settings={...manager.settings,torrents:normalizeSettings(manager.settings.torrents)};
  const where=folders||torrentFolders({profile:app.getPath('userData'),isTest});
  const settings=()=>manager.settings.torrents;
  const tools=new MediaTools({root:where.tools,tools:TOOLS,roles:['aria2c'],messages:TOOL_MESSAGES,bandwidthLimiter:manager.bandwidthLimiter,platform,onChange:()=>publish(),onReady:()=>openWaiting(),...toolsOptions});
  const engine=new TorrentEngine({tools,stateDir:path.join(where.state,'engine'),
    settings:()=>({uploadLimit:settings().uploadLimit,downloadLimit:manager.settings.maxDownloadBytesPerSecond||0}),...engineOptions});
  const requests=new Map();let closing=false;
  // Magnet links from the browser that arrived before setup finished: kept in
  // memory only, for an hour at most, and opened for review once setup is done.
  let waiting=[];
  const reveal=()=>{if(win&&!win.isDestroyed?.()){if(win.isMinimized())win.restore();win.show();win.focus();}};
  const notify=({title,body})=>{
    if(manager.settings.notificationsEnabled===false||isTest)return;
    try{if(typeof Notification==='function'&&Notification.isSupported()){const alert=new Notification({title,body});alert.on('click',reveal);alert.show();}}catch{}
  };
  const storeFile=infoHash=>path.join(where.store,infoHash+'.torrent');
  const expire=()=>{const limit=now()-REQUEST_TTL_MS;for(const [id,request]of requests)if(request.at<limit){request.controller.abort();requests.delete(id);}waiting=waiting.filter(item=>item.at>=limit);};
  function openWaiting(){
    expire();const items=waiting;waiting=[];
    for(const item of items){try{if(settings().enabled)open({magnet:item.magnet,source:'browser'});}catch{/* It can be clicked again in the browser. */}}
    publish();
  }
  const assertOn=()=>{
    if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');
    if(platform!=='win32')throw new Error(TOOL_MESSAGES.unsupported);
    if(!settings().enabled)throw new Error(MESSAGES.off);
  };
  const activeJobs=()=>manager.downloads.some(d=>d.kind==='torrent'&&['queued','downloading'].includes(d.status));
  // At start, the saved file lists of torrents no longer in the downloads are
  // removed, with any half-written one left by a crash. Nothing else is touched.
  const pruned=(async()=>{
    // An unreadable/future queue, or one recovered only in part, cannot prove
    // that an absent entry no longer owns its saved torrent metadata.
    if(manager.stateCanSave===false||manager.stateRecoveryWarning)return;
    const keep=new Set(manager.downloads.filter(d=>d.kind==='torrent'&&typeof d.torrent?.infoHash==='string').map(d=>d.torrent.infoHash));
    let entries=[];try{entries=await fs.promises.readdir(where.store,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      const saved=/^([0-9a-f]{40})\.torrent$/.exec(entry.name),partial=/^[0-9a-f]{40}\.torrent\.[0-9a-f-]{36}\.tmp$/.test(entry.name);
      if(entry.isFile()&&((saved&&!keep.has(saved[1]))||partial))await fs.promises.rm(path.join(where.store,entry.name),{force:true}).catch(()=>{});
    }
  })();

  // The engine that downloads a queued torrent job.
  manager.torrent={
    async download(d,{signal,workspace,resume,onProgress,onSharing}){
      assertOn();
      const torrent=await readMetadataFile(storeFile(d.torrent.infoHash)).catch(()=>{throw new Error(ENGINE.missing);});
      return engine.download({torrent,infoHash:d.torrent.infoHash,magnet:d.url,files:d.torrent.files,selected:d.torrent.files.filter(file=>file.selected).map(file=>file.index),
        dir:workspace,resume,shareMinutes:settings().shareMinutes},{signal,onProgress,onSharing});
    }
  };
  // The engine starts again with the current limits; a running one is told now.
  let lastLimit=manager.settings.maxDownloadBytesPerSecond;
  manager.on?.('state',()=>{
    if(manager.settings.maxDownloadBytesPerSecond!==lastLimit){lastLimit=manager.settings.maxDownloadBytesPerSecond;applyLimits();}
  });
  function applyLimits(){
    if(!engine.running)return;
    engine.rpc('changeGlobalOption',[{'max-overall-upload-limit':String(settings().uploadLimit),'max-overall-download-limit':String(Math.max(0,Math.floor(manager.settings.maxDownloadBytesPerSecond||0)))}]).catch(()=>{});
  }
  // Leftovers of an older set of the engine or an abandoned setup.
  if(platform==='win32')tools.removeOthers().catch(()=>{});

  function requestView(request){
    const view={id:request.id,status:request.status,name:request.name,gameTitle:request.gameTitle,source:request.source,peers:request.peers,error:request.error};
    if(request.status==='ready')Object.assign(view,{totalLength:request.read.totalLength,files:request.read.files.map(({index,path:file,length,padding})=>({index,path:file,length,padding}))});
    return view;
  }
  function snapshot(){
    expire();
    const s=settings();
    return {supported:platform==='win32',enabled:s.enabled,accepted:s.accepted,uploadLimit:s.uploadLimit,shareMinutes:s.shareMinutes,uploadLimits:[...UPLOAD_LIMITS],shareChoices:[...SHARE_MINUTES],
      tools:tools.snapshot(),requests:[...requests.values()].map(requestView),waiting:waiting.length};
  }
  // Starts reading a magnet link: its file list comes from a saved copy, or
  // from other people (which can take a while). Nothing else is downloaded.
  function open({magnet,gameTitle='',source='app'}={}){
    assertOn();
    if(tools.refresh()!=='ready')throw new Error(TOOL_MESSAGES.setup);
    const parsed=parseMagnet(magnet);
    expire();
    const existing=[...requests.values()].find(request=>request.parsed.infoHash===parsed.infoHash&&request.status!=='error');
    if(existing){existing.gameTitle=String(gameTitle||existing.gameTitle||'').slice(0,200);publish();return requestView(existing);}
    if(requests.size>=MAX_REQUESTS)throw new Error(MESSAGES.tooManyRequests);
    const request={id:crypto.randomUUID(),parsed,status:'finding',name:parsed.name,gameTitle:String(gameTitle||'').slice(0,200),source:source==='browser'?'browser':'app',peers:0,error:'',at:now(),controller:new AbortController(),torrent:null,read:null};
    requests.set(request.id,request);
    (async()=>{
      try{
        await pruned;
        let torrent=await readMetadataFile(storeFile(parsed.infoHash)).catch(()=>null);
        let read=null;
        if(torrent){try{read=readTorrent(torrent,parsed.infoHash);}catch{torrent=null;}}
        if(!torrent){
          torrent=await engine.metadata(parsed,{signal:request.controller.signal,onStatus:({peers})=>{if(request.peers!==peers){request.peers=peers;publish();}}});
          read=readTorrent(torrent,parsed.infoHash);
        }
        // Only the checked file list is kept. Trackers come from the magnet link,
        // checked again each time the torrent starts.
        torrent=sanitizeTorrent(torrent,parsed.infoHash,[]);
        Object.assign(request,{status:'ready',torrent,read,name:read.name});
      }catch(error){
        if(request.controller.signal.aborted)return;
        const known=[...Object.values(MAGNET),...Object.values(ENGINE),...Object.values(TOOL_MESSAGES)];
        Object.assign(request,{status:'error',error:known.includes(error?.message)?error.message:ENGINE.failed});
      }finally{if(requests.has(request.id))publish();}
    })();
    publish();
    return requestView(request);
  }
  function close(id){
    const request=requests.get(id);
    if(request){request.controller.abort();requests.delete(id);publish();}
    return snapshot();
  }
  async function add({id,selected,gameTitle}={}){
    assertOn();assertQueueAvailable();manager.assertWritable?.();
    const request=requests.get(id);
    if(!request)throw new Error(MESSAGES.request);
    if(request.status!=='ready')throw new Error(MESSAGES.waiting);
    if(!Array.isArray(selected)||selected.length>10000||selected.some(n=>!Number.isSafeInteger(n)))throw new Error(MESSAGES.choose);
    const chosen=new Set(selected);
    const files=request.read.files.map(file=>({...file,selected:chosen.has(file.index)&&!file.padding}));
    // The checked file list is kept so a paused torrent resumes without asking other people again.
    await pruned;
    await writeAtomic(storeFile(request.parsed.infoHash),request.torrent);
    const title=typeof gameTitle==='string'?gameTitle:request.gameTitle;
    const result=manager.addTorrent({infoHash:request.parsed.infoHash,magnet:request.parsed.magnet,name:request.read.name,files,gameTitle:request.source==='browser'&&!gameTitle?'':title});
    requests.delete(id);publish();
    return result;
  }
  // A magnet link from the browser extension: it waits in Ravenshelf for the
  // user. 'off' when torrents are off, so the browser can hand it elsewhere.
  function receive({magnet}={}){
    if(closing||platform!=='win32'||!settings().enabled)return {action:'off'};
    if(tools.refresh()!=='ready'){
      let parsed;try{parsed=parseMagnet(magnet);}catch{return {action:'invalid'};}
      expire();
      if(!waiting.some(item=>item.infoHash===parsed.infoHash)){
        if(waiting.length>=MAX_REQUESTS)return {action:'busy'};
        waiting.push({magnet:parsed.magnet,infoHash:parsed.infoHash,at:now()});
      }
      publish();reveal();
      notify({title:'Set up torrent downloads',body:'Ravenshelf needs a one-time setup before it can download torrents. Your magnet link opens after that.'});
      return {action:'setup'};
    }
    try{open({magnet,source:'browser'});}
    catch(error){return {action:error?.message===MAGNET.invalid||error?.message===MAGNET.version2?'invalid':'busy'};}
    reveal();
    return {action:'review'};
  }

  register('saveTorrentSettings',(options={})=>{
    if(!options||typeof options!=='object')throw new Error(MESSAGES.limit);
    const current=settings(),next={...current};
    if('uploadLimit' in options){if(!UPLOAD_LIMITS.includes(options.uploadLimit))throw new Error(MESSAGES.limit);next.uploadLimit=options.uploadLimit;}
    if('shareMinutes' in options){if(!SHARE_MINUTES.includes(options.shareMinutes))throw new Error(MESSAGES.share);next.shareMinutes=options.shareMinutes;}
    if('enabled' in options){
      if(options.enabled===true){
        if(platform!=='win32')throw new Error(TOOL_MESSAGES.unsupported);
        if(options.accepted!==true&&!current.accepted)throw new Error(MESSAGES.accept);
        next.accepted=true;next.enabled=true;
      }else if(options.enabled===false){
        if(activeJobs())throw new Error(MESSAGES.stillActive);
        next.enabled=false;waiting=[];
        for(const id of [...requests.keys()])close(id);
        engine.stop().catch(()=>{});
      }
    }
    manager.updateSettings({torrents:normalizeSettings(next)});
    applyLimits();
    return snapshot();
  });
  register('setUpTorrents',()=>{assertOn();tools.install();return snapshot();});
  register('cancelTorrentSetup',()=>{tools.cancel();return snapshot();});
  register('removeTorrentTools',async()=>{
    if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');
    if(activeJobs()||requests.size)throw new Error(TOOL_MESSAGES.busy);
    await engine.stop();await tools.remove();waiting=[];publish();return snapshot();
  });
  register('openMagnet',options=>{
    if(!options||typeof options!=='object'||typeof options.magnet!=='string')throw new Error(MAGNET.invalid);
    return open({magnet:options.magnet,gameTitle:typeof options.gameTitle==='string'?options.gameTitle:'',source:'app'});
  });
  register('closeMagnet',id=>close(typeof id==='string'?id:''));
  register('addTorrent',options=>add(options&&typeof options==='object'?options:{}));
  return {
    snapshot,receive,open,add,close,engine,tools,pruned,
    async beforeQuit(){closing=true;waiting=[];for(const request of requests.values())request.controller.abort();requests.clear();try{await engine.dispose();}finally{await tools.dispose();}}
  };
}
module.exports={createTorrentIntegration,TOOLS,TOOL_MESSAGES,MESSAGES,UPLOAD_LIMITS,SHARE_MINUTES,normalizeSettings,torrentFolders};
