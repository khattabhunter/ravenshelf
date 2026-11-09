'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {safeFetch,safeURL}=require('./net.cjs');
const {RateMeter}=require('./rate-meter.cjs');
const {openDownloadFile}=require('./download-file.cjs');
const {publicErrorMessage}=require('./public-errors.cjs');
const {BandwidthLimiter,normalizeBandwidthLimit}=require('./bandwidth-limiter.cjs');
const {HostBackoff,hostKey}=require('./host-backoff.cjs');
const {DEFAULT_SCHEDULE,normalizeSchedule,scheduleSnapshot}=require('./download-schedule.cjs');
const {MIN_PARALLEL_SIZE,normalizeConnections,workspaceFor,readState,downloadRanges,removeWorkspace,validatorFor}=require('./parallel-download.cjs');
const {MEDIA_FOLDER,QUALITIES,VIDEO_ID,canonicalUrl,cleanTitle}=require('./youtube.cjs');
const {removeMediaWorkspace}=require('./media-downloads.cjs');
const APP_VERSION=require('../package.json').version;
// YouTube jobs waiting or running at once; more are refused until some finish.
const MAX_MEDIA_JOBS=50;
const MEDIA_SETUP='Set up YouTube downloads in Settings first, then retry.';
const MEDIA_INVALID='Only YouTube video addresses can be downloaded this way.';
const MEDIA_FULL='Too many YouTube downloads are waiting. Let some finish first.';
const LONE_SURROGATE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Connection failures that usually pass on their own are retried automatically:
// at most twice in a row, waiting longer each time. A retry that received more
// data resets the count, so a long download survives occasional drops.
const NETWORK_RETRY_CODES=new Set(['ECONNRESET','ETIMEDOUT','EPIPE','ECONNABORTED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const NETWORK_RETRY_LIMIT=2,NETWORK_RETRY_MS=15000;
function networkFailure(error){for(let cause=error,depth=0;cause&&depth<4;cause=cause.cause,depth++)if(NETWORK_RETRY_CODES.has(cause.code))return true;return false;}
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
  constructor({stateFile,downloadDir,fetcher=safeFetch,resolveLink,vault=null,scanFile=null,markFile=null,onCompleted=null,now=Date.now,bandwidthLimiter=null,hostBackoff=null,media=null}) {
    super(); this.stateFile=stateFile; this.fetcher=fetcher; this.resolveLink=resolveLink; this.vault=vault; this.scanFile=scanFile; this.markFile=markFile; this.onCompleted=onCompleted; this.media=media;
    this.running=new Map(); this.tasks=new Set(); this.progressMeters=new Map(); this.stopping=false; this.scanQueue=[]; this.scanning=null; this.headerStorageWarning='';
    this.now=now;this.taskById=new Map();this.scanTasks=new Map();this.quiescing=new Set();this.hostBackoff=hostBackoff||new HostBackoff({now});
    const stored=loadJSON(stateFile,{});
    this.settings={downloadDir,concurrency:2,connectionsPerFile:4,favorites:[],defenderScan:true,...stored.settings};
    this.settings.defenderScan=this.settings.defenderScan!==false;
    this.settings.connectionsPerFile=normalizeConnections(this.settings.connectionsPerFile);
    this.settings.concurrency=Math.max(1,Math.min(4,Math.floor(Number(this.settings.concurrency)||2)));
    try{this.settings.maxDownloadBytesPerSecond=normalizeBandwidthLimit(this.settings.maxDownloadBytesPerSecond??0);}catch{this.settings.maxDownloadBytesPerSecond=0;}
    try{this.settings.downloadSchedule=normalizeSchedule(this.settings.downloadSchedule||DEFAULT_SCHEDULE);}catch{this.settings.downloadSchedule=normalizeSchedule();}
    this.bandwidthLimiter=bandwidthLimiter||new BandwidthLimiter({bytesPerSecond:this.settings.maxDownloadBytesPerSecond});
    this.downloads=Array.isArray(stored.downloads)?stored.downloads:[];
    let plainHeaders=false;
    for(const d of this.downloads){
      if(['queued','downloading'].includes(d.status))d.status='paused';d.speed=0;d.activeConnections=0;
      this.hostBackoff.restore(d.url,{retryAt:d.retryAt,status:d.retryStatus,failures:d.retryCount});
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
    this.scheduleTimer=setInterval(()=>{this.checkSchedule();this.pump();},1000);this.scheduleTimer.unref();
    Promise.resolve().then(()=>{if(!this.stopping){this.checkSchedule();this.pump();}});
  }
  state(){ return {downloads:this.downloads.map(({headers,sealedHeaders,...d})=>({...d})),settings:{...this.settings},version:APP_VERSION,headerStorageWarning:this.headerStorageWarning,downloadSchedule:{...scheduleSnapshot(this.settings.downloadSchedule,new Date(this.now())),pausedCount:this.downloads.filter(d=>d.pauseReason==='schedule').length}}; }
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
  add({links,gameTitle}) {
    if(!Array.isArray(links)||!links.length||links.length>500) throw new Error('Choose between 1 and 500 files.');
    const folderName=safeName(gameTitle,'Imported files').slice(0,100);
    const folder=path.join(this.settings.downloadDir,folderName); fs.mkdirSync(folder,{recursive:true});
    const added=[];
    for(const link of links){
      if(link.status!=='ready')continue;
      safeURL(link.url);
      if(this.downloads.some(d=>d.sourceUrl===(link.sourceUrl||link.url)&&d.folder.toLowerCase()===folder.toLowerCase()&&d.status!=='cancelled'))continue;
      const name=this.availableName(folder,safeName(link.filename || new URL(link.url).pathname.split('/').pop()));
      const requestHeaders={...link.headers};if(link.referer)requestHeaders.Referer=safeURL(link.referer).href;
      const d={id:crypto.randomUUID(),url:link.url,sourceUrl:link.sourceUrl||link.url,name,gameTitle:gameTitle||'Imported files',folder,status:'queued',received:0,total:Number(link.size)||0,speed:0,error:'',etag:null,lastModified:null,headers:requestHeaders,connectionMode:'checking',activeConnections:0,connectionNote:'',createdAt:new Date().toISOString()};
      // A download taken over from a browser keeps the browser's internet-zone mark.
      if(link.origin==='browser'){d.origin='browser';d.markOfTheWeb=link.markOfTheWeb===true;}
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
    else if(action==='cancel'&&!['completed','cancelled'].includes(d.status)){d.status='cancelled';this.running.get(id)?.abort();}
    else if(['resume','retry'].includes(action)&&['paused','error','cancelled'].includes(d.status)){d.status='queued';d.error='';d.retryCount=0;d.networkRetries=0;}
    d.speed=0;if(d.status!=='downloading')d.activeConnections=0;this.save();this.changed();this.pump();return this.state();
  }
  pump(){
    if(this.stopping||!this.checkSchedule().active)return;
    while(this.running.size<this.settings.concurrency){
      const d=this.downloads.find(x=>{
        if(x.status!=='queued'||this.running.has(x.id)||this.quiescing.has(x.id)||(x.retryAt||0)>this.now())return false;
        const policy=this.hostBackoff.policy(x.url);
        if(policy.retryAt>this.now())return false;
        return !policy.limited||![...this.running.keys()].some(id=>hostKey(this.downloads.find(item=>item.id===id).url)===policy.key);
      });if(!d)break;
      const controller=new AbortController();this.running.set(d.id,controller);
      const task=(d.kind==='media'?this.runMedia(d,controller):this.run(d,controller)).catch(err=>{if(d.status==='downloading'){d.status='error';d.error=publicErrorMessage(err,d.kind==='media'?'media':'download');}}).finally(()=>{
        this.running.delete(d.id);this.taskById.delete(d.id);d.speed=0;d.activeConnections=0;this.save();this.changed();this.pump();
      });
      this.tasks.add(task);this.taskById.set(d.id,task);task.finally(()=>this.tasks.delete(task));
    }
  }
  async run(d,controller){
    d.status='downloading';d.error='';d.speed=0;d.connectionMode='checking';d.connectionNote='';d.activeConnections=0;this.changed();
    const partial=path.join(d.folder,d.name+'.atlas-part'), final=path.join(d.folder,d.name);
    const workspace=workspaceFor(partial,d.id),connections=Math.min(normalizeConnections(this.settings.connectionsPerFile),this.hostBackoff.policy(d.url).connectionLimit);
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
        d.url=safeURL(fresh.url).href;d.headers={...fresh.headers};if(fresh.referer)d.headers.Referer=safeURL(fresh.referer).href;
        delete d.headersNeedRefresh;
      })().finally(()=>{refreshPromise=null;});
      return refreshPromise;
    };
    const request=async(extraHeaders,signal=controller.signal)=>{
      signal.throwIfAborted();
      if(d.headersNeedRefresh){await refreshHeaders();signal.throwIfAborted();}
      const originalUrl=d.url;
      this.hostBackoff.assertAvailable(originalUrl);
      let res=await this.fetcher(originalUrl,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0});
      lastActivity=Date.now();
      if([401,403,404,410].includes(res.status)&&this.resolveLink&&d.sourceUrl!==d.url){
        await res.body?.cancel();
        if(originalUrl===d.url){
          await refreshHeaders();
        }
        signal.throwIfAborted();
        this.hostBackoff.assertAvailable(d.url);
        res=await this.fetcher(d.url,{headers:{...d.headers,'Accept-Encoding':'identity',...extraHeaders},signal,timeoutMs:0});
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
      d.connectionMode='single';if(!d.connectionNote)d.connectionNote=connections===1?'One connection selected.':offset?'Resuming an existing download with one connection.':'This file uses one connection.';
      if(!res.ok){await res.body?.cancel();throw new Error(`Host returned HTTP ${res.status}. Check the source link or retry.`);}
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
          d.connectionNote='The host is busy. Waiting before retrying with fewer connections.';
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
    if(this.scanning||this.stopping||!this.scanFile)return;
    const id=this.scanQueue.shift();if(!id)return;
    const d=this.downloads.find(x=>x.id===id);
    if(!d||d.status!=='completed'||this.quiescing.has(id)){if(d)delete d.scan;return this.pumpScans();}
    this.scanning=id;d.scan={status:'scanning',startedAt:new Date().toISOString()};
    let scanFinished;
    const scanTask=new Promise(resolve=>{scanFinished=resolve;});this.scanTasks.set(id,scanTask);
    this.changed();
    try{
      const result=await this.scanFile(path.join(d.folder,d.name));
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
module.exports={DownloadManager,safeName,atomicJSON,loadJSON,MAX_MEDIA_JOBS};
