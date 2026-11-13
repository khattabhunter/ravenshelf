'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {safeFetch,safeURL}=require('./net.cjs');
const {loadLibrary,SCHEMA_VERSION,MAX_DOWNLOADS,READ_ONLY,LIST_FULL}=require('./library-state.cjs');
const {cleanHeaders}=require('./header-vault.cjs');
const {sanitizedReferrer,originReferrer}=require('./referrer-policy.cjs');
const {RateMeter}=require('./rate-meter.cjs');
const {openDownloadFile}=require('./download-file.cjs');
const {publicErrorMessage}=require('./public-errors.cjs');
const {BandwidthLimiter,normalizeBandwidthLimit}=require('./bandwidth-limiter.cjs');
const {HostBackoff,hostKey}=require('./host-backoff.cjs');
const {DEFAULT_SCHEDULE,normalizeSchedule,scheduleSnapshot}=require('./download-schedule.cjs');
const {MIN_PARALLEL_SIZE,normalizeConnections,workspaceFor,readState,downloadRanges,removeWorkspace,validatorFor}=require('./parallel-download.cjs');
const {MEDIA_FOLDER,QUALITIES,VIDEO_ID,canonicalUrl,cleanTitle}=require('./youtube.cjs');
const {removeMediaWorkspace}=require('./media-downloads.cjs');
const {SITE:MOD_SITE,MODS_FOLDER,modFolder,ONE_CONNECTION_NOTE,LINK_REFUSED:MOD_LINK_REFUSED,LINK_EXPIRED_NOTE:MOD_LINK_EXPIRED,LINK_DROPPED_NOTE:MOD_LINK_DROPPED,assertFileServer}=require('./mods.cjs');
const {safeName,folderName:safeFolderName}=require('./safe-name.cjs');
const {oneConnection,isDownloadProvider}=require('./hosts.cjs');
const {MESSAGES:PIXELDRAIN,downloadRefusal}=require('./pixeldrain.cjs');
const {MESSAGES:MAGNET}=require('./magnet.cjs');
const {MESSAGES:ENGINE}=require('./torrent-engine.cjs');
const APP_VERSION=require('../package.json').version;
// YouTube jobs waiting or running at once; more are refused until some finish.
const MAX_MEDIA_JOBS=50;
const MEDIA_SETUP='Set up YouTube downloads in Settings first, then retry.';
const MEDIA_INVALID='Only YouTube video addresses can be downloaded this way.';
const MEDIA_FULL='Too many YouTube downloads are waiting. Let some finish first.';
// Torrents waiting or running at once, and the folder for torrents from the browser.
const MAX_TORRENT_JOBS=50,TORRENTS_FOLDER='Torrents',MAX_TORRENT_PATH=250;
const {TORRENT_SETUP,MESSAGES:TORRENT}=require('./torrent-messages.cjs');
const TORRENT_FULL=TORRENT.full,TORRENT_INVALID=TORRENT.choose;
const INFO_HASH=/^[0-9a-f]{40}$/;
// A torrent downloads into a hidden working folder beside its final place,
// and moves there in one step when every chosen file is complete.
const torrentWorkspace=d=>path.join(d.folder,'.atlas-torrent-'+crypto.createHash('sha256').update(String(d.id)).digest('hex').slice(0,24));
// A torrent's files as the window needs them: counts, not the whole list.
function torrentSummary(t){
  const files=Array.isArray(t?.files)?t.files:[];
  return {infoHash:t?.infoHash||'',name:t?.name||'',fileCount:files.length,selectedCount:files.filter(file=>file.selected).length,peers:t?.peers||0,uploadSpeed:t?.uploadSpeed||0,uploaded:t?.uploaded||0,sharing:t?.sharing===true};
}
const LONE_SURROGATE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Connection failures that usually pass on their own are retried automatically:
// at most twice in a row, waiting longer each time. A retry that received more
// data resets the count, so a long download survives occasional drops.
const NETWORK_RETRY_CODES=new Set(['ECONNRESET','ETIMEDOUT','EPIPE','ECONNABORTED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const NETWORK_RETRY_LIMIT=2,NETWORK_RETRY_MS=15000;
function networkFailure(error){for(let cause=error,depth=0;cause&&depth<4;cause=cause.cause,depth++)if(NETWORK_RETRY_CODES.has(cause.code))return true;return false;}
// A Nexus Mods file is known by its address without the part after "?": that
// part is a signed, short-lived pass that carries the account's number and
// differs on every click, while the address before it names the file.
const withoutQuery=value=>{try{const url=new URL(value);url.search='';url.hash='';return url.href;}catch{return value;}};
const isModFile=item=>item.origin==='browser'&&item.mod?.site===MOD_SITE;
const linkIdentity=item=>isModFile(item)?withoutQuery(item.sourceUrl||item.url):item.sourceUrl||item.url;
const sourceIdentity=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const filePath=value=>{try{return new URL(value).pathname;}catch{return String(value);}};
// True when `name` is `original`, or `original` with the " (1)" that a name
// already in use is given.
function sameSavedName(name,original){
  if(name===original)return true;
  const ext=path.extname(original),stem=original.slice(0,original.length-ext.length);
  const number=name.slice(stem.length,name.length-ext.length);
  return /^ \([1-9][0-9]*\)$/.test(number)&&name===stem+number+ext;
}
// Whether a link is for a file the list already holds. Nexus Mods signs a new
// link for every click, and the link can name another of its file servers, so
// two mod downloads are the same file when they have the same path on those
// servers and are saved under the same name. Everything else is compared by
// its address, as before.
const sameFile=(held,link,name)=>isModFile(held)&&isModFile(link)
  ?filePath(held.url)===filePath(link.url)&&sameSavedName(held.name,name)
  :held.origin==='browser'&&!isModFile(held)&&held.sourceIdentity
    ?held.sourceIdentity===sourceIdentity(linkIdentity(link))
    :linkIdentity(held)===linkIdentity(link);
// A Nexus Mods link is signed for one click and can include the account's
// number. It is dropped as soon as it is no longer needed, when the file has
// finished or the download is cancelled: only the plain address of the file
// stays, and the page address that was sent with the request goes too.
function dropModLink(d){d.url=withoutQuery(d.url);d.sourceUrl=withoutQuery(d.sourceUrl);d.headers={};}
// Browser page context is reduced to its origin. A supported file host can
// require its clean page path; neither kind needs page tokens or fragments.
function downloadHeaders(value,referer,entry={}){
  if(referer)safeURL(referer);
  const headers=cleanHeaders(value)||{};
  const sanitize=entry.origin==='browser'&&!isDownloadProvider(entry.sourceUrl||entry.url)?originReferrer:sanitizedReferrer;
  for(const name of ['Referer','HX-Current-URL']){
    let found;
    for(const key of Object.keys(headers))if(key.toLowerCase()===name.toLowerCase()){found=headers[key];delete headers[key];}
    const clean=sanitize(name==='Referer'&&referer!==undefined?referer:found);
    if(clean)headers[name]=clean;
  }
  return headers;
}
function dropFinishedBrowserLink(d){if(d.origin==='browser'&&!d.kind&&d.status==='completed'){
  // Keep only a local opaque identifier for exact-link deduplication. Hash
  // before removing tokens, including when migrating an older finished job.
  if(!isModFile(d)&&!d.sourceIdentity)d.sourceIdentity=sourceIdentity(d.sourceUrl||d.url);
  dropModLink(d);delete d.headersNeedRefresh;
}}
const HEADER_STORAGE_WARNING='Some download sign-in details could not be saved securely. They stay in memory for this session; affected links will be checked again after restarting.';
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
  constructor({stateFile,downloadDir,fetcher=safeFetch,resolveLink,vault=null,scanFile=null,markFile=null,onCompleted=null,now=Date.now,bandwidthLimiter=null,hostBackoff=null,media=null,torrent=null}) {
    super(); this.stateFile=stateFile; this.fetcher=fetcher; this.resolveLink=resolveLink; this.vault=vault; this.scanFile=scanFile; this.markFile=markFile; this.onCompleted=onCompleted; this.media=media; this.torrent=torrent;
    this.running=new Map(); this.tasks=new Set(); this.progressMeters=new Map(); this.stopping=false; this.scanQueue=[]; this.scanning=null; this.headerStorageWarning='';
    this.now=now;this.taskById=new Map();this.scanTasks=new Map();this.quiescing=new Set();this.hostBackoff=hostBackoff||new HostBackoff({now});
    const loaded=loadLibrary(stateFile),stored=loaded.data;
    // Saves go to the real file that was checked and read (the profile may be reached through a junction).
    if(typeof loaded.file==='string')this.stateFile=loaded.file;
    this.stateCanSave=loaded.canSave;this.stateRecoveryWarning=loaded.warning;
    this.settings={downloadDir,concurrency:2,connectionsPerFile:4,favorites:[],defenderScan:true,...stored.settings};
    this.settings.defenderScan=this.settings.defenderScan!==false;
    this.settings.connectionsPerFile=normalizeConnections(this.settings.connectionsPerFile);
    this.settings.concurrency=Math.max(1,Math.min(4,Math.floor(Number(this.settings.concurrency)||2)));
    try{this.settings.maxDownloadBytesPerSecond=normalizeBandwidthLimit(this.settings.maxDownloadBytesPerSecond??0);}catch{this.settings.maxDownloadBytesPerSecond=0;}
    try{this.settings.downloadSchedule=normalizeSchedule(this.settings.downloadSchedule||DEFAULT_SCHEDULE);}catch{this.settings.downloadSchedule=normalizeSchedule();}
    this.bandwidthLimiter=bandwidthLimiter||new BandwidthLimiter({bytesPerSecond:this.settings.maxDownloadBytesPerSecond});
    this.downloads=Array.isArray(stored.downloads)?stored.downloads:[];
    let plainHeaders=false,tidied=false;
    for(const d of this.downloads){
      if(['queued','downloading'].includes(d.status))d.status='paused';d.speed=0;d.activeConnections=0;
      this.hostBackoff.restore(d.url,{retryAt:d.retryAt,status:d.retryStatus,failures:d.retryCount});
      if('sealedHeaders' in d){
        // Headers that cannot be opened (another Windows account or PC) are dropped;
        // the job then refreshes its link from the source page when it resumes.
        let opened=null;try{opened=this.vault?.open(d.sealedHeaders);}catch{}
        d.headers=opened||{};if(!opened&&!isModFile(d))d.headersNeedRefresh=true;delete d.sealedHeaders;
      }else if(d.headers&&typeof d.headers==='object'&&Object.keys(d.headers).length)plainHeaders=true;
      d.headers=downloadHeaders(d.headers,undefined,d);
      // A mod download that Ravenshelf 0.7.0 finished or cancelled: drop what that version still kept of its link.
      if(isModFile(d)&&['completed','cancelled'].includes(d.status)){
        const kept=JSON.stringify([d.url,d.sourceUrl,d.headers,d.needsNewLink]);
        dropModLink(d);if(d.status==='cancelled')d.needsNewLink=true;
        if(kept!==JSON.stringify([d.url,d.sourceUrl,d.headers,d.needsNewLink]))tidied=true;
      }
      if(d.origin==='browser'&&!d.kind&&d.status==='completed'){
        const before=JSON.stringify([d.url,d.sourceUrl,d.headers,d.headersNeedRefresh]);dropFinishedBrowserLink(d);
        if(before!==JSON.stringify([d.url,d.sourceUrl,d.headers,d.headersNeedRefresh]))tidied=true;
      }
    }
    // Remove legacy plaintext even when encryption is unavailable. Working
    // credentials remain in memory, but only sealed credentials go to disk.
    // A repaired library is saved at once, so the next start finds it repaired
    // instead of making another recovery copy of the same damage.
    if(plainHeaders||tidied||loaded.recoveryFile||this.downloads.some(d=>d.headersNeedRefresh&&!isModFile(d))){try{this.save();}catch{}}
    // Scans interrupted by closing the app run again on the next start.
    for(const d of this.downloads)if(d.status==='completed'&&['queued','scanning'].includes(d.scan?.status)){d.scan={status:'queued'};this.scanQueue.push(d.id);}
    if(this.stateCanSave&&this.scanQueue.length&&this.scanFile)setImmediate(()=>this.pumpScans());
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
    this.scheduleTimer=setInterval(()=>{this.checkSchedule();this.pump();},1000);this.scheduleTimer.unref();
    Promise.resolve().then(()=>{if(!this.stopping){this.checkSchedule();this.pump();}});
  }
  state(){ return {downloads:this.downloads.map(({headers,sealedHeaders,...d})=>d.kind==='torrent'?{...d,torrent:torrentSummary(d.torrent)}:{...d}),settings:{...this.settings},version:APP_VERSION,headerStorageWarning:this.headerStorageWarning,stateRecoveryWarning:this.stateRecoveryWarning,downloadSchedule:{...scheduleSnapshot(this.settings.downloadSchedule,new Date(this.now())),pausedCount:this.downloads.filter(d=>d.pauseReason==='schedule').length}}; }
  persisted(d){
    const {headers:rawHeaders,sealedHeaders,headersNeedRefresh,...rest}=d;
    const headers=downloadHeaders(rawHeaders,undefined,d);
    if(!headers||!Object.keys(headers).length)return {...rest,headers:{},...(headersNeedRefresh?{headersNeedRefresh:true}:{})};
    let sealed=null;try{sealed=this.vault?.seal(headers);}catch{}
    // What a mod download sends is its page's address, not a sign-in, and its link
    // is never looked up again: nothing needs to be checked again for it.
    return sealed?{...rest,sealedHeaders:sealed}:{...rest,headers:{},...(isModFile(d)?{}:{headersNeedRefresh:true})};
  }
  save(){
    if(!this.stateCanSave)return false;
    const downloads=this.downloads.map(d=>this.persisted(d));
    this.headerStorageWarning=downloads.some(d=>d.headersNeedRefresh&&!isModFile(d))?HEADER_STORAGE_WARNING:'';
    atomicJSON(this.stateFile,{schemaVersion:SCHEMA_VERSION,settings:this.settings,downloads});
    return true;
  }
  changed(){this.emit('state',this.state());}
  publishProgress(){
    if(this.stopping)return;
    const downloads=[];
    for(const {download:d,rateMeter}of this.progressMeters.values()){
      if(d.status!=='downloading')continue;
      d.speed=rateMeter.sample(d.received);
      // Explicit allowlist: no credentials, paths, URLs, settings or scan results.
      const update={id:d.id,received:d.received,total:d.total,speed:d.speed,activeConnections:d.activeConnections};
      if(d.kind==='torrent'){update.peers=d.torrent?.peers||0;update.uploadSpeed=d.torrent?.uploadSpeed||0;}
      downloads.push(update);
    }
    if(downloads.length)this.emit('progress',downloads);
  }
  updateSettings(patch){
    const next={...this.settings,...patch};
    next.maxDownloadBytesPerSecond=normalizeBandwidthLimit(next.maxDownloadBytesPerSecond);
    next.downloadSchedule=normalizeSchedule(next.downloadSchedule);
    this.settings=next;this.settings.defenderScan=this.settings.defenderScan!==false;this.settings.connectionsPerFile=normalizeConnections(this.settings.connectionsPerFile);this.settings.concurrency=Math.max(1,Math.min(4,Math.floor(Number(this.settings.concurrency)||2)));
    this.bandwidthLimiter.setRate(next.maxDownloadBytesPerSecond);this.checkSchedule();this.save();this.changed();this.pump();return this.state();
  }
  checkSchedule(date=new Date(this.now())){
    const snapshot=scheduleSnapshot(this.settings.downloadSchedule,date);let changed=false;
    for(const d of this.downloads){
      if(this.quiescing.has(d.id))continue;
      if(!snapshot.active&&['queued','downloading'].includes(d.status)){
        d.status='paused';d.pauseReason='schedule';d.scheduleRequested=true;d.speed=0;d.activeConnections=0;this.running.get(d.id)?.abort();changed=true;
      }else if(snapshot.active&&d.status==='paused'&&d.pauseReason==='schedule'&&d.scheduleRequested===true){
        d.status='queued';delete d.pauseReason;delete d.scheduleRequested;changed=true;
      }
    }
    if(changed){this.save();this.changed();}
    return snapshot;
  }
  selectedIds(ids){
    if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'))throw new Error('Choose between 1 and 500 downloads.');
    const selected=[...new Set(ids)];
    if(selected.some(id=>!this.downloads.some(d=>d.id===id)))throw new Error('Download not found.');
    return selected;
  }
  async pauseAndWait(ids){
    const selected=this.selectedIds(ids),set=new Set(selected);
    if(selected.some(id=>this.quiescing.has(id)))throw new Error('This download is being removed. Wait for the operation to finish.');
    for(const id of selected)this.quiescing.add(id);
    this.scanQueue=this.scanQueue.filter(id=>!set.has(id));
    for(const d of this.downloads)if(set.has(d.id)){
      delete d.pauseReason;delete d.scheduleRequested;
      if(!['completed','cancelled'].includes(d.status))d.status='paused';
      d.speed=0;d.activeConnections=0;this.running.get(d.id)?.abort();
    }
    this.save();this.changed();
    await Promise.allSettled(selected.flatMap(id=>[this.taskById.get(id),this.scanTasks.get(id)].filter(Boolean)));
    return selected;
  }
  releaseQuiescence(ids){
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw new Error('Choose between 1 and 500 downloads.');
    for(const id of ids){
      this.quiescing.delete(id);const d=this.downloads.find(item=>item.id===id);
      if(d?.status==='completed'&&d.scan?.status==='queued'&&!this.scanQueue.includes(id))this.scanQueue.push(id);
    }
    setImmediate(()=>this.pumpScans());
  }
  removeFromList(ids){
    const selected=this.selectedIds(ids),set=new Set(selected);
    if(selected.some(id=>!this.quiescing.has(id)||this.running.has(id)||this.scanTasks.has(id)||this.scanQueue.includes(id)))throw new Error('Wait for these downloads and scans to stop before removing them.');
    this.downloads=this.downloads.filter(d=>!set.has(d.id));for(const id of selected)this.quiescing.delete(id);
    this.save();this.changed();return {removed:selected.length,ids:selected};
  }
  // The title that the folder for a mod's game is made from, inside Mods. The
  // game's name comes from the page and is not always known. So a game that
  // already has mod files in the list keeps the title they were filed under,
  // whichever name this file arrives with: one folder for each game.
  modTitle(mod){
    const root=path.join(this.settings.downloadDir,safeFolderName(MODS_FOLDER)).toLowerCase();
    const held=this.downloads.findLast(d=>isModFile(d)&&d.mod.game===mod.game&&path.dirname(d.folder).toLowerCase()===root);
    return held?held.gameTitle:modFolder(mod);
  }
  // `group` puts the folder one level down, such as Mods\<game> for mod files.
  // Nothing new is added while the saved list is read-only: it could not be saved.
  assertWritable(adding=1){if(!this.stateCanSave)throw new Error(READ_ONLY);if(this.downloads.length+adding>MAX_DOWNLOADS)throw new Error(LIST_FULL);}
  add({links,gameTitle,group}) {
    if(!Array.isArray(links)||!links.length||links.length>500) throw new Error('Choose between 1 and 500 files.');
    this.assertWritable(links.filter(link=>link?.status==='ready').length);
    // Before 0.7.0 a folder name was cut at 100 characters without tidying the cut,
    // which could leave a space or a dot at its end. A game that already has such a
    // folder, on disk or in the list, keeps it, so that its parts stay together and
    // are still recognised. Folders are compared without case, as they are below.
    const earlierName=safeName(gameTitle,'Imported files').slice(0,100),earlier=path.join(this.settings.downloadDir,earlierName);
    const keepsEarlier=!group&&(this.downloads.some(d=>d.folder.toLowerCase()===earlier.toLowerCase())||fs.existsSync(earlier));
    const folderName=keepsEarlier?earlierName:safeFolderName(gameTitle);
    const folder=group?path.join(this.settings.downloadDir,safeFolderName(group),folderName):path.join(this.settings.downloadDir,folderName); fs.mkdirSync(folder,{recursive:true});
    const added=[];
    for(const link of links){
      if(link.status!=='ready')continue;
      safeURL(link.url);
      const original=safeName(link.filename || new URL(link.url).pathname.split('/').pop());
      // A cancelled download does not count as the same file, except a mod file's: see below.
      const held=this.downloads.find(d=>sameFile(d,link,original)&&d.folder.toLowerCase()===folder.toLowerCase()&&(d.status!=='cancelled'||(isModFile(d)&&isModFile(link))));
      if(held){
        // A Nexus Mods link stops working after a while, and a cancelled mod download
        // gives its link up. Downloading the same file again from its page brings a
        // new link: a failed or cancelled entry for that file takes it and carries
        // on from where it stopped, instead of staying stuck beside a second copy.
        if(['error','cancelled'].includes(held.status)&&isModFile(held)&&isModFile(link)&&!this.quiescing.has(held.id)){
          const headers=downloadHeaders(link.headers,link.referer,link);
          delete held.headersNeedRefresh;delete held.pauseReason;delete held.scheduleRequested;delete held.needsNewLink;
          // From here on it is the same as pressing Retry, with the new link.
          Object.assign(held,{url:link.url,sourceUrl:link.sourceUrl||link.url,headers,mod:{...link.mod},status:'queued',error:'',retryCount:0,networkRetries:0,speed:0,activeConnections:0});
          added.push(held.id);
        }
        continue;
      }
      const name=this.availableName(folder,original);
      const requestHeaders=downloadHeaders(link.headers,link.referer,link);
      const d={id:crypto.randomUUID(),url:link.url,sourceUrl:link.sourceUrl||link.url,name,gameTitle:gameTitle||'Imported files',folder,status:'queued',received:0,total:Number(link.size)||0,speed:0,error:'',etag:null,lastModified:null,headers:requestHeaders,connectionMode:'checking',activeConnections:0,connectionNote:'',createdAt:new Date().toISOString()};
      // A download taken over from a browser keeps the browser's internet-zone mark.
      if(link.origin==='browser'){d.origin='browser';d.markOfTheWeb=link.markOfTheWeb===true;}
      // The game and mod of a file downloaded on Nexus Mods, checked by the browser bridge.
      if(isModFile(link))d.mod={...link.mod};
      this.downloads.push(d);added.push(d.id);
    }
    this.save();this.changed();this.pump();return {added:added.length,ids:added};
  }
  // A name in the folder that no file, partial file or other queued download uses.
  availableName(folder,original,ignoreId=null){
    const ext=path.extname(original),stem=original.slice(0,original.length-ext.length);
    let name=original, i=1;
    const conflicts=candidate=>this.downloads.some(d=>d.id!==ignoreId&&d.folder.toLowerCase()===folder.toLowerCase()&&[d.name.toLowerCase(),(d.name+'.atlas-part').toLowerCase()].some(p=>p===candidate.toLowerCase()||p===(candidate+'.atlas-part').toLowerCase()));
    while(fs.existsSync(path.join(folder,name))||fs.existsSync(path.join(folder,name+'.atlas-part'))||conflicts(name)) name=`${stem} (${i++})${ext}`;
    return name;
  }
  // A YouTube video chosen in the browser extension. It starts under a
  // placeholder name; the real title arrives when yt-dlp reads the video.
  addMedia({videoId,quality}={}){
    if(typeof videoId!=='string'||!VIDEO_ID.test(videoId)||typeof quality!=='string'||!Object.hasOwn(QUALITIES,quality))throw new Error(MEDIA_INVALID);
    this.assertWritable();
    const existing=this.downloads.find(d=>d.kind==='media'&&d.media?.videoId===videoId&&d.media?.quality===quality&&d.status!=='cancelled');
    if(existing)return {added:0,ids:[existing.id]};
    if(this.downloads.filter(d=>d.kind==='media'&&['queued','downloading','paused'].includes(d.status)).length>=MAX_MEDIA_JOBS)throw new Error(MEDIA_FULL);
    const folder=path.join(this.settings.downloadDir,MEDIA_FOLDER);fs.mkdirSync(folder,{recursive:true});
    const url=canonicalUrl(videoId),name=this.availableName(folder,`YouTube video ${videoId}.${QUALITIES[quality].ext}`);
    const d={id:crypto.randomUUID(),kind:'media',url,sourceUrl:url,name,gameTitle:MEDIA_FOLDER,folder,status:'queued',received:0,total:0,speed:0,error:'',etag:null,lastModified:null,headers:{},connectionMode:'media',activeConnections:0,connectionNote:'',createdAt:new Date().toISOString(),
      origin:'browser',markOfTheWeb:true,media:{videoId,quality}};
    this.downloads.push(d);this.save();this.changed();this.pump();
    return {added:1,ids:[d.id]};
  }
  // A torrent whose file list was checked and shown. `files` is the whole list,
  // in the torrent's order, with the files chosen to download marked.
  addTorrent({infoHash,magnet,name,files,gameTitle}={}){
    if(typeof infoHash!=='string'||!INFO_HASH.test(infoHash)||typeof magnet!=='string'||!magnet.startsWith('magnet:?xt=urn:btih:'+infoHash)||magnet.length>8192)throw new Error(MAGNET.invalid);
    this.assertWritable();
    if(typeof name!=='string'||!name||safeName(name,'')!==name)throw new Error(MAGNET.names);
    if(!Array.isArray(files)||!files.length||files.length>10000)throw new Error(MAGNET.tooMany);
    const list=files.map((file,i)=>{
      if(!file||file.index!==i+1||typeof file.path!=='string'||!(file.path===name||file.path.startsWith(name+'/'))||!Number.isSafeInteger(file.length)||file.length<0)throw new Error(MAGNET.damaged);
      // Each part of the path is one Windows stores exactly as written, so no file can land outside the folder.
      if(file.path.split('/').some(part=>!part||part!==safeName(part,'')||part==='.'||part==='..'))throw new Error(MAGNET.names);
      return {index:file.index,path:file.path,length:file.length,selected:file.selected===true&&file.padding!==true,padding:file.padding===true};
    });
    const chosen=list.filter(file=>file.selected);
    if(!chosen.length)throw new Error(TORRENT_INVALID);
    const browser=typeof gameTitle!=='string'||!gameTitle.trim();
    const folder=path.join(this.settings.downloadDir,safeFolderName(browser?TORRENTS_FOLDER:gameTitle));
    const existing=this.downloads.find(d=>d.kind==='torrent'&&d.torrent?.infoHash===infoHash&&d.status!=='cancelled'&&d.folder.toLowerCase()===folder.toLowerCase());
    if(existing)return {added:0,ids:[existing.id]};
    if(this.downloads.filter(d=>d.kind==='torrent'&&['queued','downloading','paused'].includes(d.status)).length>=MAX_TORRENT_JOBS)throw new Error(TORRENT_FULL);
    const d={id:crypto.randomUUID(),kind:'torrent',url:magnet,sourceUrl:magnet,name,gameTitle:browser?TORRENTS_FOLDER:String(gameTitle).slice(0,200),folder,status:'queued',
      received:0,total:chosen.reduce((sum,file)=>sum+file.length,0),speed:0,error:'',etag:null,lastModified:null,headers:{},connectionMode:'torrent',activeConnections:0,connectionNote:'',
      createdAt:new Date().toISOString(),origin:'torrent',markOfTheWeb:true,torrent:{infoHash,name,files:list,peers:0,uploadSpeed:0,uploaded:0}};
    // Windows paths are kept under 250 characters, counted from the working folder, the longer of the two places.
    const longest=list.reduce((max,file)=>Math.max(max,file.path.length),0);
    if(torrentWorkspace(d).length+1+longest>MAX_TORRENT_PATH)throw new Error(MAGNET.tooLong);
    fs.mkdirSync(folder,{recursive:true});
    this.downloads.push(d);this.save();this.changed();this.pump();
    return {added:1,ids:[d.id]};
  }
  action(id,action){
    const d=this.downloads.find(x=>x.id===id);if(!d)throw new Error('Download not found.');
    if(this.quiescing.has(id))throw new Error('This download is being removed. Wait for the operation to finish.');
    if(action==='scan'){
      if(d.status!=='completed')throw new Error('Only finished downloads can be scanned.');
      if(!this.scanFile)throw new Error('Microsoft Defender scanning is not available.');
      this.queueScan(d);return this.state();
    }
    if(['pause','cancel','resume','retry'].includes(action)){delete d.pauseReason;delete d.scheduleRequested;}
    if(action==='pause'&&['queued','downloading'].includes(d.status)){d.status='paused';this.running.get(id)?.abort();}
    else if(action==='cancel'&&!['completed','cancelled'].includes(d.status)){
      d.status='cancelled';this.running.get(id)?.abort();
      if(isModFile(d)){dropModLink(d);d.needsNewLink=true;}
    }
    // A cancelled mod download has no link left to carry on with, and Ravenshelf
    // asks nothing of the file server without one. It says how to get a new link,
    // and then takes it like any failed mod download.
    else if(['resume','retry'].includes(action)&&d.needsNewLink&&isModFile(d)&&['error','cancelled'].includes(d.status)){d.status='error';d.error=MOD_LINK_DROPPED;}
    else if(['resume','retry'].includes(action)&&['paused','error','cancelled'].includes(d.status)){d.status='queued';d.error='';d.retryCount=0;d.networkRetries=0;}
    d.speed=0;if(d.status!=='downloading')d.activeConnections=0;this.save();this.changed();this.pump();return this.state();
  }
  pump(){
    if(this.stopping||!this.stateCanSave||!this.checkSchedule().active)return;
    while(this.running.size<this.settings.concurrency){
      const d=this.downloads.find(x=>{
        if(x.status!=='queued'||this.running.has(x.id)||this.quiescing.has(x.id)||(x.retryAt||0)>this.now())return false;
        const policy=this.hostBackoff.policy(x.url);
        if(policy.retryAt>this.now())return false;
        return !policy.limited||![...this.running.keys()].some(id=>hostKey(this.downloads.find(item=>item.id===id).url)===policy.key);
      });if(!d)break;
      const controller=new AbortController();this.running.set(d.id,controller);
      const task=(d.kind==='media'?this.runMedia(d,controller):d.kind==='torrent'?this.runTorrent(d,controller):this.run(d,controller)).catch(err=>{if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,d.kind==='media'?'media':d.kind==='torrent'?'torrent':'download');}}).finally(()=>{
        this.running.delete(d.id);this.taskById.delete(d.id);d.speed=0;d.activeConnections=0;this.save();this.changed();this.pump();
      });
      this.tasks.add(task);this.taskById.set(d.id,task);task.finally(()=>this.tasks.delete(task));
    }
  }
  async run(d,controller){
    d.status='downloading';d.error='';d.speed=0;d.connectionMode='checking';d.connectionNote='';d.activeConnections=0;this.changed();
    const partial=path.join(d.folder,d.name+'.atlas-part'), final=path.join(d.folder,d.name);
    // Nexus Mods serves free accounts one connection per file, so mod files never use more.
    const workspace=workspaceFor(partial,d.id),connections=d.mod||oneConnection(d.url)?1:Math.min(normalizeConnections(this.settings.connectionsPerFile),this.hostBackoff.policy(d.url).connectionLimit);
    fs.mkdirSync(d.folder,{recursive:true});
    let offset=0,progressFrom=null;
    let lastActivity=Date.now(),intentionalWaits=0;
    const throttle=async(bytes,signal=controller.signal)=>{
      intentionalWaits++;
      try{await this.bandwidthLimiter.consume(bytes,{signal});}
      finally{intentionalWaits--;lastActivity=Date.now();}
    };
    const watchdog=setInterval(()=>{if(!intentionalWaits&&Date.now()-lastActivity>60000)controller.abort(new Error('The host stopped responding. Retry to resume.'));},5000);
    let handle,partialFile,responseBody,refreshPromise;
    const rateMeter=new RateMeter({windowMs:5000,sampleMs:500});rateMeter.reset(d.received);
    this.progressMeters.set(d.id,{download:d,rateMeter});
    const refreshHeaders=()=>{
      if(!refreshPromise)refreshPromise=(async()=>{
        if(!this.resolveLink)throw new Error('Saved sign-in details are unavailable. Check this download link again before resuming.');
        const fresh=await this.resolveLink(d.sourceUrl||d.url);
        if(fresh.status!=='ready')throw new Error(fresh.message||'This link needs a browser check.');
        d.url=safeURL(fresh.url).href;d.headers=downloadHeaders(fresh.headers,fresh.referer,d);
        delete d.headersNeedRefresh;
      })().finally(()=>{refreshPromise=null;});
      return refreshPromise;
    };
    const request=async(extraHeaders,signal=controller.signal)=>{
      signal.throwIfAborted();
      // A mod file's link is signed for the click that made it, and only its page on
      // Nexus Mods gives another: it is never looked up again from here. The header
      // that could not be kept for it is the page's address, not a sign-in.
      if(d.headersNeedRefresh){if(d.mod)delete d.headersNeedRefresh;else{await refreshHeaders();signal.throwIfAborted();}}
      const originalUrl=d.url;
      this.hostBackoff.assertAvailable(originalUrl);
      // A mod file may be handed on only among Nexus Mods' own file servers.
      let res=await this.fetcher(originalUrl,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0,http1:true,...(isModFile(d)?{checkRedirect:assertFileServer}:{})});
      lastActivity=Date.now();
      if([401,403,404,410].includes(res.status)&&this.resolveLink&&d.sourceUrl!==d.url&&!d.mod){
        await res.body?.cancel();
        if(originalUrl===d.url){
          await refreshHeaders();
        }
        signal.throwIfAborted();
        this.hostBackoff.assertAvailable(d.url);
        res=await this.fetcher(d.url,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0,http1:true});
      }
      if([429,503].includes(res.status)){
        const failure=this.hostBackoff.failure(d.url,res);try{await res.body?.cancel();}catch{}
        const host=hostKey(d.url);
        for(const [id,running]of this.running){const other=this.downloads.find(item=>item.id===id);if(other&&hostKey(other.url)===host)running.abort(failure);}
        throw failure;
      }
      if([200,206].includes(res.status))this.hostBackoff.success(d.url);
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
      if(d.markOfTheWeb&&this.markFile){
        try{await this.markFile(final);}catch{d.connectionNote='Download complete. Windows’ downloaded-from-the-internet mark could not be added to this file.';}
      }
      d.total=d.received;d.status='completed';d.completedAt=new Date().toISOString();
      // A finished mod file no longer needs its signed link: only the plain address is kept.
      if(isModFile(d))dropModLink(d);
      dropFinishedBrowserLink(d);
      if(this.scanFile&&this.settings.defenderScan)this.queueScan(d);
      try{this.onCompleted?.(d);}catch{/* A follow-up check must not undo a finished download. */}
    };
    const parallel=async()=>{
      if(partialFile){await partialFile.handle.close();partialFile=null;handle=null;}
      d.connectionMode='checking';d.activeConnections=0;this.changed();
      const result=await downloadRanges({workspace,partialPath:partial,sourceId:d.id,request,signal:controller.signal,connections,throttle,
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
      d.received=offset;rateMeter.reset(offset);progressFrom=offset;
      const saved=readState(workspace);let triedParallel=false;
      if((saved&&!saved.disabled)||(connections>1&&!offset&&d.total>=MIN_PARALLEL_SIZE&&!saved?.disabled)){
        triedParallel=true;if(await parallel())return;
      }
      if(saved?.disabled)d.connectionNote=saved.note||'Using one connection for this file.';
      let headers=offset?{Range:`bytes=${offset}-`,'If-Range':d.etag||d.lastModified}:{};
      d.activeConnections=1;
      let res=await request(headers);responseBody=res.body;
      if(!triedParallel&&!saved?.disabled&&connections>1&&!offset&&res.status===200&&Number(res.headers.get('content-length'))>=MIN_PARALLEL_SIZE){
        await res.body?.cancel();d.activeConnections=0;
        if(await parallel())return;
        headers=offset?{Range:`bytes=${offset}-`,'If-Range':d.etag||d.lastModified}:{};
        d.activeConnections=1;res=await request(headers);responseBody=res.body;
      }
      if(offset&&res.status===416){
        const unsatisfied=/^bytes \*\/(\d+)$/.exec(res.headers.get('content-range')||'');
        const size=unsatisfied?Number(unsatisfied[1]):NaN;
        if(Number.isSafeInteger(size)&&size===offset){
          // All advertised bytes may have arrived before a broken stream or
          // pause prevented clean EOF. A 416 alone never proves completion:
          // re-request the last byte with If-Range, then validate the ordinary
          // response, unchanged prefix, exact length and clean EOF below.
          await res.body?.cancel();offset--;d.received=offset;rateMeter.reset(offset);
          headers={Range:`bytes=${offset}-`,'If-Range':d.etag||d.lastModified};
          res=await request(headers);responseBody=res.body;
        }
      }
      d.connectionMode='single';if(!d.connectionNote)d.connectionNote=d.mod?ONE_CONNECTION_NOTE:oneConnection(d.url)?PIXELDRAIN.note:connections===1?'One connection selected.':offset?'Resuming an existing download with one connection.':'This file uses one connection.';
      // A mod file's link that Nexus Mods no longer accepts: say what to do, not just a number.
      if(!res.ok){
        // PixelDrain says why it refused (a captcha, its free limit); only its refusal code is read.
        const refused=oneConnection(d.url)?await downloadRefusal(res):null;
        if(!refused)try{await res.body?.cancel();}catch{/* The refusal was already read. */}
        throw new Error(refused||(d.mod&&MOD_LINK_REFUSED.includes(res.status)?MOD_LINK_EXPIRED:`Host returned HTTP ${res.status}. Check the source link or retry.`));
      }
      const encoding=res.headers.get('content-encoding');
      if(encoding&&encoding.toLowerCase()!=='identity'){await res.body?.cancel();throw new Error('Host ignored the uncompressed transfer request. Use another mirror to preserve reliable byte ranges.');}
      const type=(res.headers.get('content-type')||'').toLowerCase();
      if(/text\/(?:html|xml|javascript)|application\/(?:json|xhtml|xml|javascript)/.test(type)){await res.body?.cancel();throw new Error('The host returned a web page instead of a file. Open the protected host.');}
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
        await throttle(chunk.length);controller.signal.throwIfAborted();
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
      const failure=controller.signal.reason?.code==='HOST_BACKOFF'?controller.signal.reason:err;
      if(d.status==='downloading'){
        if(failure?.code==='HOST_BACKOFF'){
          d.retryAt=Math.max(failure.retryAt||0,this.hostBackoff.policy(d.url).retryAt);d.retryCount=Math.max(0,Math.min(2,Number(d.retryCount)||0))+1;d.retryStatus=failure.status;
          d.connectionNote=d.mod?'The host is busy. Waiting before retrying.':'The host is busy. Waiting before retrying with fewer connections.';
          if(failure.automatic!==false&&d.retryCount<=2){d.status='queued';d.error='';}
          else{d.status='error';d.error=publicErrorMessage(failure,'download');}
        }else if(networkFailure(err)&&!controller.signal.aborted){
          if(progressFrom!==null&&d.received>progressFrom)d.networkRetries=0;
          const tries=Math.max(0,Math.min(NETWORK_RETRY_LIMIT,Number(d.networkRetries)||0));
          if(tries<NETWORK_RETRY_LIMIT){
            d.networkRetries=tries+1;d.retryAt=this.now()+NETWORK_RETRY_MS*d.networkRetries;d.status='queued';d.error='';
            d.connectionNote='The connection dropped. Ravenshelf will try again shortly.';
          }else{d.status='error';d.error=publicErrorMessage(err,'download');}
        }else{d.status='error';d.error=publicErrorMessage(err,'download');}
      }
    }finally{clearInterval(watchdog);this.progressMeters.delete(d.id);try{await responseBody?.cancel();}catch{}if(handle)await handle.close();d.activeConnections=0;}
  }
  // A YouTube job: yt-dlp downloads into the job's private working folder,
  // then the finished file is published under the video's title.
  async runMedia(d,controller){
    d.status='downloading';d.error='';d.speed=0;d.connectionMode='media';d.activeConnections=0;d.connectionNote='';this.changed();
    const rateMeter=new RateMeter({windowMs:5000,sampleMs:500});rateMeter.reset(d.received);
    this.progressMeters.set(d.id,{download:d,rateMeter});
    const workspace=workspaceFor(path.join(d.folder,d.name+'.atlas-part'),d.id);
    try{
      if(!this.media)throw new Error(MEDIA_SETUP);
      fs.mkdirSync(workspace,{recursive:true});
      // yt-dlp limits each job separately, so the shared limit is split across the download slots.
      const limit=Number(this.settings.maxDownloadBytesPerSecond)||0,rateLimit=limit>0?Math.max(1024,Math.floor(limit/Math.max(1,this.settings.concurrency))):0;
      const result=await this.media.download(d,{signal:controller.signal,workspace,rateLimit,
        onDetails:details=>this.applyMediaDetails(d,details),
        onProgress:(received,total)=>{if(d.status!=='downloading')return;d.received=Math.max(0,received);if(total>0)d.total=total;},
        onNote:note=>{if(d.status==='downloading'&&d.connectionNote!==note){d.connectionNote=String(note||'').slice(0,200);this.changed();}}});
      controller.signal.throwIfAborted();
      await this.publishMedia(d,result,workspace,controller.signal);
    }catch(err){
      if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,'media');}
    }finally{this.progressMeters.delete(d.id);d.activeConnections=0;}
  }
  applyMediaDetails(d,details){
    const title=cleanTitle(details?.title),ext=['mp4','mkv','webm','m4a','mp3'].includes(details?.ext)?details.ext:QUALITIES[d.media.quality].ext;
    const formats=(Array.isArray(details?.formats)?details.formats:[]).slice(0,4).map(format=>({id:String(format.id||'').slice(0,40),size:Number.isSafeInteger(format.size)&&format.size>0?format.size:0,audio:format.audio===true}));
    d.media={...d.media,title,ext,formats,duration:Number.isSafeInteger(details?.duration)?details.duration:0};
    // At most 150 UTF-16 units (Windows allows 255 per name), without half an emoji.
    const stem=safeName(title,'YouTube video').slice(0,150).replace(LONE_SURROGATE,'').replace(/[. ]+$/,'')||'YouTube video';
    d.name=this.availableName(d.folder,`${stem}.${ext}`,d.id);
    const total=formats.reduce((sum,format)=>sum+format.size,0);if(total)d.total=total;
    this.save();this.changed();
  }
  async publishMedia(d,result,workspace,signal){
    const stem=path.basename(d.name,path.extname(d.name));
    // The joined file can come out as MKV instead of MP4; never overwrite a file that appeared meanwhile.
    if(path.extname(d.name).slice(1).toLowerCase()!==result.ext||fs.existsSync(path.join(d.folder,d.name)))d.name=this.availableName(d.folder,`${stem}.${result.ext}`,d.id);
    const final=path.join(d.folder,d.name);
    signal.throwIfAborted();
    try{await fs.promises.link(result.file,final);}catch(err){
      if(!['ENOTSUP','EPERM','EXDEV'].includes(err.code))throw err;
      await fs.promises.copyFile(result.file,final,fs.constants.COPYFILE_EXCL);
    }
    await fs.promises.unlink(result.file);
    d.connectionNote='';
    await removeMediaWorkspace(workspace).catch(()=>{d.connectionNote='Download complete. Some temporary files could not be removed.';});
    const size=(await fs.promises.stat(final)).size;d.received=size;d.total=size;
    if(d.markOfTheWeb&&this.markFile){
      try{await this.markFile(final);}catch{d.connectionNote='Download complete. Windows’ downloaded-from-the-internet mark could not be added to this file.';}
    }
    d.status='completed';d.completedAt=new Date().toISOString();
    if(this.scanFile&&this.settings.defenderScan)this.queueScan(d);
    try{this.onCompleted?.(d);}catch{/* A follow-up check must not undo a finished download. */}
  }
  // A torrent job: the torrent engine downloads the chosen files into the job's
  // working folder, and they are published together when all are complete.
  async runTorrent(d,controller){
    d.status='downloading';d.error='';d.speed=0;d.connectionMode='torrent';d.activeConnections=0;d.connectionNote='';
    d.torrent={...d.torrent,peers:0,uploadSpeed:0,sharing:false};this.changed();
    const rateMeter=new RateMeter({windowMs:5000,sampleMs:500});rateMeter.reset(d.received);
    this.progressMeters.set(d.id,{download:d,rateMeter});
    const workspace=torrentWorkspace(d);
    try{
      if(!this.torrent)throw new Error(TORRENT_SETUP);
      await fs.promises.mkdir(workspace,{recursive:true});
      const resume=(await fs.promises.readdir(workspace)).length>0;
      const result=await this.torrent.download(d,{signal:controller.signal,workspace,resume,
        onProgress:progress=>{
          if(d.status!=='downloading')return;
          d.received=Math.max(0,progress.received);if(progress.total>0)d.total=progress.total;
          d.torrent.peers=progress.peers;d.torrent.uploadSpeed=progress.uploadSpeed;d.torrent.uploaded=progress.uploaded;
        },
        onSharing:minutes=>{if(d.status!=='downloading'||![15,60].includes(minutes))return;d.torrent.sharing=true;d.connectionNote=minutes===60?'Download complete. Sharing with other people for up to an hour.':'Download complete. Sharing with other people for up to 15 minutes.';this.changed();}});
      if(!result?.complete)throw new Error(ENGINE.failed);
      // Stopping while sharing only stops sharing: every chosen file is complete.
      if(!result.interrupted)controller.signal.throwIfAborted();
      await this.publishTorrent(d,workspace);
    }catch(err){
      // A sharing note must not stay on a card that is no longer sharing.
      if(/^Download complete\. Sharing/.test(d.connectionNote||''))d.connectionNote='';
      if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,'torrent');}
    }finally{this.progressMeters.delete(d.id);d.activeConnections=0;if(d.torrent){d.torrent.peers=0;d.torrent.uploadSpeed=0;d.torrent.sharing=false;}}
  }
  async publishTorrent(d,workspace){
    const files=d.torrent.files,source=path.join(workspace,d.torrent.name);
    // Every chosen file must be there at its full size; parts of files that were
    // not chosen (they can share pieces with chosen ones) are removed first.
    for(const file of files){
      const target=path.join(workspace,file.path);
      if(file.selected){
        const stat=await fs.promises.lstat(target).catch(()=>null);
        if(!stat?.isFile()||stat.size!==file.length)throw new Error(ENGINE.changed);
      }else await fs.promises.rm(target,{force:true}).catch(()=>{});
    }
    const sourceStat=await fs.promises.lstat(source);
    if(sourceStat.isSymbolicLink())throw new Error(ENGINE.changed);
    d.name=this.availableName(d.folder,d.torrent.name,d.id);
    const final=path.join(d.folder,d.name);
    await fs.promises.rename(source,final);
    await removeEmptyFolders(final).catch(()=>{});
    d.connectionNote='';
    await fs.promises.rm(workspace,{recursive:true,force:true,maxRetries:2}).catch(()=>{d.connectionNote='Download complete. Some temporary files could not be removed.';});
    // The published place of each chosen file: the torrent's own name may have become "Name (1)".
    const published=file=>path.join(d.folder,d.name+file.path.slice(d.torrent.name.length));
    d.total=files.filter(file=>file.selected).reduce((sum,file)=>sum+file.length,0);d.received=d.total;
    if(this.markFile)for(const file of files.filter(item=>item.selected)){
      try{await this.markFile(published(file));}catch{d.connectionNote='Download complete. Windows’ downloaded-from-the-internet mark could not be added to some files.';}
    }
    d.status='completed';d.completedAt=new Date().toISOString();
    if(this.scanFile&&this.settings.defenderScan)this.queueScan(d);
    try{this.onCompleted?.(d);}catch{/* A follow-up check must not undo a finished download. */}
  }
  // Stores a reputation lookup result shown on the download's card.
  setReputation(id,reputation){
    const d=this.downloads.find(x=>x.id===id);if(!d)return false;
    if(reputation===null)delete d.reputation;else d.reputation=reputation;
    this.save();this.changed();return true;
  }
  queueScan(d){
    // A transfer can finish publishing while a removal request is stopping it.
    // Keep scan evidence pending until removal succeeds or the lock is released.
    if(this.quiescing.has(d.id)){d.scan={status:'queued'};this.save();this.changed();return;}
    if(['queued','scanning'].includes(d.scan?.status)&&(this.scanning===d.id||this.scanQueue.includes(d.id)))return;
    d.scan={status:'queued'};this.scanQueue.push(d.id);this.save();this.changed();
    setImmediate(()=>this.pumpScans());
  }
  // One scan at a time keeps Defender from slowing the PC with parallel archive scans.
  async pumpScans(){
    if(this.scanning||this.stopping||!this.stateCanSave||!this.scanFile)return;
    const id=this.scanQueue.shift();if(!id)return;
    const d=this.downloads.find(x=>x.id===id);
    if(!d||d.status!=='completed'||this.quiescing.has(id)){if(d)delete d.scan;return this.pumpScans();}
    this.scanning=id;d.scan={status:'scanning',startedAt:new Date().toISOString()};
    let scanFinished;
    const scanTask=new Promise(resolve=>{scanFinished=resolve;});this.scanTasks.set(id,scanTask);
    this.changed();
    try{
      // A torrent with several files is published as one folder, scanned as a whole.
      const folder=d.kind==='torrent'&&Boolean(d.torrent?.files?.some(file=>file.path.includes('/')));
      const result=await this.scanFile(path.join(d.folder,d.name),{folder});
      const status=['clean','threat','missing','unavailable','error','review'].includes(result?.status)?result.status:'error';
      d.scan={status,message:String(result?.message||'').slice(0,300),scannedAt:result?.scannedAt||new Date().toISOString()};
    }catch{d.scan={status:'error',message:'Microsoft Defender could not finish this scan.',scannedAt:new Date().toISOString()};}
    finally{this.scanning=null;this.scanTasks.delete(id);try{this.save();this.changed();}finally{scanFinished();}}
    return this.pumpScans();
  }
  // Manual closing stays responsive. Queued/running scan states are persisted
  // and resumed on next launch; automatic completion waits for scans beforehand.
  async stop(){this.stopping=true;clearInterval(this.timer);clearInterval(this.progressTimer);clearInterval(this.scheduleTimer);for(const d of this.downloads)if(d.status==='queued')d.status='paused';for(const [id,c]of this.running){const d=this.downloads.find(x=>x.id===id);d.status='paused';c.abort();}this.bandwidthLimiter.stop();await Promise.allSettled([...this.tasks]);this.progressMeters.clear();this.save();}
}
// Removes folders left empty inside a published torrent (files that were not chosen).
async function removeEmptyFolders(root){
  const stat=await fs.promises.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())return;
  const walk=async dir=>{
    let empty=true;
    for(const entry of await fs.promises.readdir(dir,{withFileTypes:true})){
      if(entry.isDirectory()&&!entry.isSymbolicLink()){if(!await walk(path.join(dir,entry.name)))empty=false;}else empty=false;
    }
    if(empty&&dir!==root){await fs.promises.rmdir(dir).catch(()=>{empty=false;});}
    return empty;
  };
  await walk(root);
}
module.exports={DownloadManager,safeName,atomicJSON,loadJSON,MAX_MEDIA_JOBS,MAX_TORRENT_JOBS,TORRENTS_FOLDER,TORRENT_SETUP,torrentWorkspace,torrentSummary};
