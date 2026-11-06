'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {safeFetch,safeURL}=require('./net.cjs');
const {RateMeter}=require('./rate-meter.cjs');
const {openDownloadFile}=require('./download-file.cjs');
const {publicErrorMessage}=require('./public-errors.cjs');
const {MIN_PARALLEL_SIZE,normalizeConnections,workspaceFor,readState,downloadRanges,removeWorkspace,validatorFor}=require('./parallel-download.cjs');
const APP_VERSION=require('../package.json').version;
const HEADER_STORAGE_WARNING='Some download sign-in details could not be saved securely. They stay in memory for this session; affected links will be checked again after restarting.';
function safeName(value,fallback='download') {
  let s=String(value || fallback).normalize('NFKC').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').trim().slice(0,180).replace(/[. ]+$/g,'');
  if(!s || s==='.' || s==='..') s=fallback;
  if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)) s='_'+s;
  return s;
}
function atomicJSON(file,data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);}
  catch(error){fs.closeSync(fd);fs.unlinkSync(temporary);throw error;}
  fs.closeSync(fd);
  try{fs.renameSync(temporary,file);}catch(error){fs.unlinkSync(temporary);throw error;}
}
function loadJSON(file,fallback) { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;} }
class DownloadManager extends EventEmitter {
  constructor({stateFile,downloadDir,fetcher=safeFetch,resolveLink,vault=null,scanFile=null}) {
    super(); this.stateFile=stateFile; this.fetcher=fetcher; this.resolveLink=resolveLink; this.vault=vault; this.scanFile=scanFile;
    this.running=new Map(); this.tasks=new Set(); this.progressMeters=new Map(); this.stopping=false; this.scanQueue=[]; this.scanning=null; this.headerStorageWarning='';
    const stored=loadJSON(stateFile,{});
    this.settings={downloadDir,concurrency:2,connectionsPerFile:4,favorites:[],defenderScan:true,...stored.settings};
    this.settings.defenderScan=this.settings.defenderScan!==false;
    this.settings.connectionsPerFile=normalizeConnections(this.settings.connectionsPerFile);
    this.settings.concurrency=Math.max(1,Math.min(4,Math.floor(Number(this.settings.concurrency)||2)));
    this.downloads=Array.isArray(stored.downloads)?stored.downloads:[];
    let plainHeaders=false;
    for(const d of this.downloads){
      if(['queued','downloading'].includes(d.status))d.status='paused';d.speed=0;d.activeConnections=0;
      if('sealedHeaders' in d){
        // Headers that cannot be opened (another Windows account or PC) are dropped;
        // the job then refreshes its link from the source page when it resumes.
        const opened=this.vault?.open(d.sealedHeaders);
        d.headers=opened||{};if(!opened)d.headersNeedRefresh=true;delete d.sealedHeaders;
      }else if(d.headers&&typeof d.headers==='object'&&Object.keys(d.headers).length)plainHeaders=true;
      if(!d.headers||typeof d.headers!=='object'||Array.isArray(d.headers))d.headers={};
    }
    // Remove legacy plaintext even when encryption is unavailable. Working
    // credentials remain in memory, but only sealed credentials go to disk.
    if(plainHeaders||this.downloads.some(d=>d.headersNeedRefresh))this.save();
    // Scans interrupted by closing the app run again on the next start.
    for(const d of this.downloads)if(d.status==='completed'&&['queued','scanning'].includes(d.scan?.status)){d.scan={status:'queued'};this.scanQueue.push(d.id);}
    if(this.scanQueue.length&&this.scanFile)setImmediate(()=>this.pumpScans());
    this.timer=setInterval(()=>{
      if(this.running.size){
        const warning=this.headerStorageWarning;this.save();
        // Storage failures/recovery must reach the UI even without a lifecycle change.
        if(warning!==this.headerStorageWarning)this.changed();
      }
    },2000); this.timer.unref();
    // One cadence for the whole queue. File I/O and durable checkpoints do not
    // depend on renderer notifications, and important state changes stay immediate.
    this.progressTimer=setInterval(()=>this.publishProgress(),500);this.progressTimer.unref();
  }
  state(){ return {downloads:this.downloads.map(({headers,sealedHeaders,...d})=>({...d})),settings:{...this.settings},version:APP_VERSION,headerStorageWarning:this.headerStorageWarning}; }
  persisted(d){
    const {headers,sealedHeaders,headersNeedRefresh,...rest}=d;
    if(!headers||!Object.keys(headers).length)return {...rest,headers:{},...(headersNeedRefresh?{headersNeedRefresh:true}:{})};
    let sealed=null;try{sealed=this.vault?.seal(headers);}catch{}
    return sealed?{...rest,sealedHeaders:sealed}:{...rest,headers:{},headersNeedRefresh:true};
  }
  save(){
    const downloads=this.downloads.map(d=>this.persisted(d));
    this.headerStorageWarning=downloads.some(d=>d.headersNeedRefresh)?HEADER_STORAGE_WARNING:'';
    atomicJSON(this.stateFile,{settings:this.settings,downloads});
  }
  changed(){this.emit('state',this.state());}
  publishProgress(){
    if(this.stopping)return;
    const downloads=[];
    for(const {download:d,rateMeter}of this.progressMeters.values()){
      if(d.status!=='downloading')continue;
      d.speed=rateMeter.sample(d.received);
      // Explicit allowlist: no credentials, paths, URLs, settings or scan results.
      downloads.push({id:d.id,received:d.received,total:d.total,speed:d.speed,activeConnections:d.activeConnections});
    }
    if(downloads.length)this.emit('progress',downloads);
  }
  updateSettings(patch){this.settings={...this.settings,...patch};this.settings.defenderScan=this.settings.defenderScan!==false;this.settings.connectionsPerFile=normalizeConnections(this.settings.connectionsPerFile);this.settings.concurrency=Math.max(1,Math.min(4,Math.floor(Number(this.settings.concurrency)||2)));this.save();this.changed();this.pump();return this.state();}
  add({links,gameTitle}) {
    if(!Array.isArray(links)||!links.length||links.length>500) throw new Error('Choose between 1 and 500 files.');
    const folderName=safeName(gameTitle,'Imported files').slice(0,100);
    const folder=path.join(this.settings.downloadDir,folderName); fs.mkdirSync(folder,{recursive:true});
    const added=[];
    for(const link of links){
      if(link.status!=='ready')continue;
      safeURL(link.url);
      if(this.downloads.some(d=>d.sourceUrl===(link.sourceUrl||link.url)&&d.folder.toLowerCase()===folder.toLowerCase()&&d.status!=='cancelled'))continue;
      const original=safeName(link.filename || new URL(link.url).pathname.split('/').pop());
      const ext=path.extname(original),stem=original.slice(0,original.length-ext.length);
      let name=original, i=1;
      const conflicts=candidate=>this.downloads.some(d=>d.folder.toLowerCase()===folder.toLowerCase()&&[d.name.toLowerCase(),(d.name+'.atlas-part').toLowerCase()].some(p=>p===candidate.toLowerCase()||p===(candidate+'.atlas-part').toLowerCase()));
      while(fs.existsSync(path.join(folder,name))||fs.existsSync(path.join(folder,name+'.atlas-part'))||conflicts(name)) name=`${stem} (${i++})${ext}`;
      const requestHeaders={...link.headers};if(link.referer)requestHeaders.Referer=safeURL(link.referer).href;
      const d={id:crypto.randomUUID(),url:link.url,sourceUrl:link.sourceUrl||link.url,name,gameTitle:gameTitle||'Imported files',folder,status:'queued',received:0,total:Number(link.size)||0,speed:0,error:'',etag:null,lastModified:null,headers:requestHeaders,connectionMode:'checking',activeConnections:0,connectionNote:'',createdAt:new Date().toISOString()};
      this.downloads.push(d);added.push(d.id);
    }
    this.save();this.changed();this.pump();return {added:added.length,ids:added};
  }
  action(id,action){
    const d=this.downloads.find(x=>x.id===id);if(!d)throw new Error('Download not found.');
    if(action==='scan'){
      if(d.status!=='completed')throw new Error('Only finished downloads can be scanned.');
      if(!this.scanFile)throw new Error('Microsoft Defender scanning is not available.');
      this.queueScan(d);return this.state();
    }
    if(action==='pause'&&['queued','downloading'].includes(d.status)){d.status='paused';this.running.get(id)?.abort();}
    else if(action==='cancel'&&!['completed','cancelled'].includes(d.status)){d.status='cancelled';this.running.get(id)?.abort();}
    else if(['resume','retry'].includes(action)&&['paused','error','cancelled'].includes(d.status)){d.status='queued';d.error='';}
    d.speed=0;if(d.status!=='downloading')d.activeConnections=0;this.save();this.changed();this.pump();return this.state();
  }
  pump(){
    if(this.stopping)return;
    while(this.running.size<this.settings.concurrency){
      const d=this.downloads.find(x=>x.status==='queued'&&!this.running.has(x.id));if(!d)break;
      const controller=new AbortController();this.running.set(d.id,controller);
      const task=this.run(d,controller).catch(err=>{if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,'download');}}).finally(()=>{
        this.running.delete(d.id);d.speed=0;d.activeConnections=0;this.save();this.changed();this.pump();
      });
      this.tasks.add(task);task.finally(()=>this.tasks.delete(task));
    }
  }
  async run(d,controller){
    d.status='downloading';d.error='';d.speed=0;d.connectionMode='checking';d.connectionNote='';d.activeConnections=0;this.changed();
    const partial=path.join(d.folder,d.name+'.atlas-part'), final=path.join(d.folder,d.name);
    const workspace=workspaceFor(partial,d.id),connections=normalizeConnections(this.settings.connectionsPerFile);
    fs.mkdirSync(d.folder,{recursive:true});
    let offset=0;
    let lastActivity=Date.now();
    const watchdog=setInterval(()=>{if(Date.now()-lastActivity>60000)controller.abort(new Error('The host stopped responding. Retry to resume.'));},5000);
    let handle,partialFile,responseBody,refreshPromise;
    const rateMeter=new RateMeter({windowMs:5000,sampleMs:500});rateMeter.reset(d.received);
    this.progressMeters.set(d.id,{download:d,rateMeter});
    const refreshHeaders=()=>{
      if(!refreshPromise)refreshPromise=(async()=>{
        if(!this.resolveLink)throw new Error('Saved sign-in details are unavailable. Check this download link again before resuming.');
        const fresh=await this.resolveLink(d.sourceUrl||d.url);
        if(fresh.status!=='ready')throw new Error(fresh.message||'This link needs a browser check.');
        d.url=safeURL(fresh.url).href;d.headers={...fresh.headers};if(fresh.referer)d.headers.Referer=safeURL(fresh.referer).href;
        delete d.headersNeedRefresh;
      })().finally(()=>{refreshPromise=null;});
      return refreshPromise;
    };
    const request=async(extraHeaders,signal=controller.signal)=>{
      signal.throwIfAborted();
      if(d.headersNeedRefresh){await refreshHeaders();signal.throwIfAborted();}
      const originalUrl=d.url;
      let res=await this.fetcher(originalUrl,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0});
      lastActivity=Date.now();
      if([401,403,404,410].includes(res.status)&&this.resolveLink&&d.sourceUrl!==d.url){
        await res.body?.cancel();
        if(originalUrl===d.url){
          await refreshHeaders();
        }
        signal.throwIfAborted();
        res=await this.fetcher(d.url,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0});
      }
      return res;
    };
    const publish=async(file)=>{
      controller.signal.throwIfAborted();
      // Hard linking publishes without another full copy and never overwrites.
      try{await fs.promises.link(file,final);}catch(err){
        if(!['ENOTSUP','EPERM','EXDEV'].includes(err.code))throw err;
        await fs.promises.copyFile(file,final,fs.constants.COPYFILE_EXCL);
      }
      if(file===partial)await fs.promises.unlink(partial);
      else await fs.promises.unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await removeWorkspace(workspace).catch(()=>{d.connectionNote='Download complete. Some temporary files could not be removed.';});
      d.total=d.received;d.status='completed';d.completedAt=new Date().toISOString();
      if(this.scanFile&&this.settings.defenderScan)this.queueScan(d);
    };
    const parallel=async()=>{
      if(partialFile){await partialFile.handle.close();partialFile=null;handle=null;}
      d.connectionMode='checking';d.activeConnections=0;this.changed();
      const result=await downloadRanges({workspace,partialPath:partial,sourceId:d.id,request,signal:controller.signal,connections,
        onProgress:(received,total)=>{d.received=received;d.total=total;},
        onActivity:()=>{lastActivity=Date.now();},
        onConnections:count=>{d.activeConnections=d.status==='downloading'?count:0;},
        onMode:(mode,note)=>{d.connectionMode=mode;d.connectionNote=note;this.changed();}});
      if(result.path){d.received=result.total;d.total=result.total;d.etag=result.etag;d.lastModified=result.lastModified;d.lastModifiedVerified=Boolean(result.lastModified);await publish(result.path);return true;}
      d.connectionMode='single';d.connectionNote=result.note;
      if(result.prefixBytes){d.etag=result.etag;d.lastModified=result.lastModified;d.lastModifiedVerified=Boolean(result.lastModified);}
      partialFile=await openDownloadFile(partial,{allowMissing:true});handle=partialFile?.handle;
      offset=result.reset?0:partialFile?.size||0;
      if(offset&&!d.etag&&!(d.lastModified&&d.lastModifiedVerified))offset=0;
      d.received=offset;rateMeter.reset(offset);this.changed();return false;
    };
    try{
      partialFile=await openDownloadFile(partial,{allowMissing:true});handle=partialFile?.handle;
      offset=partialFile?.size||0;
      // Only a verified resource validator can authorize a resumed prefix.
      if(d.etag&&!validatorFor(new Headers({etag:d.etag})))d.etag=null;
      if(offset&&!d.etag&&!(d.lastModified&&d.lastModifiedVerified))offset=0;
      d.received=offset;rateMeter.reset(offset);
      const saved=readState(workspace);let triedParallel=false;
      if((saved&&!saved.disabled)||(connections>1&&!offset&&d.total>=MIN_PARALLEL_SIZE&&!saved?.disabled)){
        triedParallel=true;if(await parallel())return;
      }
      if(saved?.disabled)d.connectionNote=saved.note||'Using one connection for this file.';
      let headers=offset?{Range:`bytes=${offset}-`,'If-Range':d.etag||d.lastModified}:{};
      d.activeConnections=1;
      let res=await request(headers);responseBody=res.body;
      if(!triedParallel&&!saved?.disabled&&connections>1&&!offset&&res.status===200&&Number(res.headers.get('content-length'))>=MIN_PARALLEL_SIZE){
        await res.body?.cancel();d.activeConnections=0;triedParallel=true;
        if(await parallel())return;
        headers=offset?{Range:`bytes=${offset}-`,'If-Range':d.etag||d.lastModified}:{};
        d.activeConnections=1;res=await request(headers);responseBody=res.body;
      }
      d.connectionMode='single';if(!d.connectionNote)d.connectionNote=connections===1?'One connection selected.':offset?'Resuming an existing download with one connection.':'This file uses one connection.';
      if(!res.ok){await res.body?.cancel();throw new Error(`Host returned HTTP ${res.status}. Check the source link or retry.`);}
      const encoding=res.headers.get('content-encoding');
      if(encoding&&encoding.toLowerCase()!=='identity'){await res.body?.cancel();throw new Error('Host ignored the uncompressed transfer request. Use another mirror to preserve reliable byte ranges.');}
      const type=(res.headers.get('content-type')||'').toLowerCase();
      if(/text\/(?:html|javascript)|application\/(?:json|xhtml|xml|javascript)/.test(type)){await res.body?.cancel();throw new Error('The host returned a web page instead of a file. Open the protected host.');}
      if(offset&&res.status===200){offset=0;d.received=0;}
      let expectedResponse=0;
      if(res.status===206){
        const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range')||'');
        if(!range || !range.slice(1).every(value=>Number.isSafeInteger(Number(value))) || Number(range[1])!==offset || Number(range[2])<offset || Number(range[2])>=Number(range[3])) {await res.body?.cancel();throw new Error('Host sent an invalid resume range. File was not modified.');}
        if(offset&&d.etag&&d.etag!==res.headers.get('etag')){await res.body?.cancel();throw new Error('The host could not verify the saved file version. Cancel and queue it again.');}
        if(offset&&!d.etag&&d.lastModified&&(validatorFor(res.headers)?.kind!=='last-modified'||d.lastModified!==res.headers.get('last-modified'))){await res.body?.cancel();throw new Error('The file changed on the host. Cancel and queue it again.');}
        d.total=Number(range[3]);
        expectedResponse=Number(range[2])-Number(range[1])+1;
        if(res.headers.has('content-length')&&Number(res.headers.get('content-length'))!==expectedResponse){await res.body?.cancel();throw new Error('Host returned inconsistent range and file lengths.');}
      }else if(res.status===200){d.total=Number(res.headers.get('content-length'))||0;if(!Number.isSafeInteger(d.total)||d.total<0)throw new Error('Host returned an invalid file length.');}
      else {await res.body?.cancel();throw new Error('The host did not return a downloadable file.');}
      const validator=validatorFor(res.headers);
      controller.signal.throwIfAborted();
      if(partialFile)await partialFile.verifyUnchanged();
      else partialFile=await openDownloadFile(partial,{create:true});
      handle=partialFile.handle;
      controller.signal.throwIfAborted();
      if(!offset)await handle.truncate(0);
      // Commit new validators only after any old prefix has been safely reset.
      // Otherwise a pause/error could authorize old bytes with a new validator.
      d.etag=validator?.kind==='etag'?validator.value:null;
      d.lastModified=validator?.kind==='last-modified'?validator.value:null;
      d.lastModifiedVerified=validator?.kind==='last-modified';
      this.changed();
      rateMeter.reset(d.received);
      for await (const chunk of res.body){
        if(controller.signal.aborted)throw controller.signal.reason||new Error('Paused');
        if(d.total&&d.received+chunk.length>d.total)throw new Error('Host sent more bytes than expected.');
        let pos=0;while(pos<chunk.length){const result=await handle.write(chunk,pos,chunk.length-pos,d.received+pos);if(!result.bytesWritten)throw new Error('Could not save download bytes.');pos+=result.bytesWritten;}
        d.received+=chunk.length;lastActivity=Date.now();
        if(d.total&&d.received>d.total)throw new Error('Host sent more bytes than expected.');
      }
      if(controller.signal.aborted)throw controller.signal.reason||new Error('Paused');
      if(expectedResponse&&d.received-offset!==expectedResponse)throw new Error('Transfer length did not match the requested range.');
      if(d.total&&d.received!==d.total)throw new Error('Transfer ended early. Retry to resume.');
      if(!d.received)throw new Error('The host returned an empty file.');
      await handle.sync();await partialFile.verify(d.received);await handle.close();handle=null;partialFile=null;
      await publish(partial);
    }catch(err){
      if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,'download');}
    }finally{clearInterval(watchdog);this.progressMeters.delete(d.id);try{await responseBody?.cancel();}catch{}if(handle)await handle.close();d.activeConnections=0;}
  }
  queueScan(d){
    if(['queued','scanning'].includes(d.scan?.status)&&(this.scanning===d.id||this.scanQueue.includes(d.id)))return;
    d.scan={status:'queued'};this.scanQueue.push(d.id);this.save();this.changed();
    setImmediate(()=>this.pumpScans());
  }
  // One scan at a time keeps Defender from slowing the PC with parallel archive scans.
  async pumpScans(){
    if(this.scanning||this.stopping||!this.scanFile)return;
    const id=this.scanQueue.shift();if(!id)return;
    const d=this.downloads.find(x=>x.id===id);
    if(!d||d.status!=='completed'){if(d)delete d.scan;return this.pumpScans();}
    this.scanning=id;d.scan={status:'scanning',startedAt:new Date().toISOString()};this.changed();
    try{
      const result=await this.scanFile(path.join(d.folder,d.name));
      const status=['clean','threat','missing','unavailable','error','review'].includes(result?.status)?result.status:'error';
      d.scan={status,message:String(result?.message||'').slice(0,300),scannedAt:result?.scannedAt||new Date().toISOString()};
    }catch{d.scan={status:'error',message:'Microsoft Defender could not finish this scan.',scannedAt:new Date().toISOString()};}
    finally{this.scanning=null;this.save();this.changed();}
    return this.pumpScans();
  }
  // Manual closing stays responsive. Queued/running scan states are persisted
  // and resumed on next launch; automatic completion waits for scans beforehand.
  async stop(){this.stopping=true;clearInterval(this.timer);clearInterval(this.progressTimer);for(const d of this.downloads)if(d.status==='queued')d.status='paused';for(const [id,c]of this.running){const d=this.downloads.find(x=>x.id===id);d.status='paused';c.abort();}await Promise.allSettled([...this.tasks]);this.progressMeters.clear();this.save();}
}
module.exports={DownloadManager,safeName,atomicJSON,loadJSON};
