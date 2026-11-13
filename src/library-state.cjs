'use strict';
// Saved state is data, not authority to choose arbitrary files or request
// headers. Keep usable entries, and preserve the original bytes locally before
// repairing malformed data. Newer formats are never overwritten by this app.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeURL}=require('./net.cjs');
const {isWindowsDeviceName}=require('./safe-name.cjs');
const {cleanHeaders}=require('./header-vault.cjs');
const {modContext,fromNexus}=require('./mods.cjs');
const {VIDEO_ID,QUALITIES,canonicalUrl}=require('./youtube.cjs');
const {normalizeSchedule}=require('./download-schedule.cjs');
const {normalizeBandwidthLimit}=require('./bandwidth-limiter.cjs');
const SCHEMA_VERSION=1,MAX_BYTES=128*1024*1024,MAX_DOWNLOADS=10000,MAX_RECOVERY_COPIES=5,LOCK_RETRIES=4,LOCK_WAIT_MS=250;
const RECOVERED='Some saved settings or downloads were damaged. Valid items were kept, and the original library was preserved in a local recovery file.';
const BLOCKED='Saved data could not be read safely. The original library is unchanged; changes in this session cannot be saved. Close Ravenshelf and recover the library before continuing.';
const READ_ONLY='Ravenshelf can’t add downloads now because its saved list is read-only. See the message at the top of the window.';
const LIST_FULL='Your downloads list is full (10,000 downloads). Remove finished downloads before adding more.';
const FUTURE='This library was saved by a newer Ravenshelf version. The original library is unchanged; use that version to keep your settings and downloads.';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max=2000)=>typeof value==='string'&&value.length<=max&&!/[\0\r\n]/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function localPath(value,{network=false}={}){
  if(!text(value,8192)||!value||/[\x00-\x1f]/.test(value))return false;
  const unc=/^[\\/]{2}/.test(value);
  // Older folder pickers allowed network shares. Preserve those paths as data;
  // each operation retains its own filesystem checks and access restrictions.
  if(unc&&(!network||!/^[/\\]{2}[A-Za-z0-9][A-Za-z0-9._$@-]{0,252}[/\\][^/\\]+(?:[/\\]|$)/.test(value)))return false;
  if(!unc&&(!path.isAbsolute(value)||(process.platform==='win32'&&!/^[A-Za-z]:[/\\]/.test(value))))return false;
  const root=(unc?path.win32:path).parse(value).root,tail=value.slice(root.length);
  const parts=(unc?value.replace(/^[\\/]{2}[^\\/]+[\\/]/,''):tail).split(/[\\/]/);
  return !/[<>:"|?*]/.test(tail)&&!parts.some(part=>part==='.'||part==='..'||isWindowsDeviceName(part)||/[<>:"|?*]/.test(part));
}
function filename(value){return text(value,255)&&Boolean(value)&&!/[\x00-\x1f<>:"/\\|?*]/.test(value)&&!/[. ]$/.test(value)&&value!=='.'&&value!=='..'&&!isWindowsDeviceName(value);}
function address(value){if(!text(value,16384)||!value)return false;try{safeURL(value);return true;}catch{return false;}}
function plainAddress(value){try{const url=new URL(value);return url.origin+url.pathname;}catch{return value;}}
// JSON-only copies avoid inherited keys, prototype setters and unchecked
// object graphs. Bounds apply before any recursive field consumer sees them.
function copyJSON(value,depth=0){
  if(depth>10)throw new Error('Invalid saved data.');
  if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=1024*1024||typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value)){if(value.length>10000)throw new Error('Invalid saved data.');return value.map(item=>copyJSON(item,depth+1));}
  if(!object(value)||Object.keys(value).length>1000)throw new Error('Invalid saved data.');
  const out={};
  for(const [key,item]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid saved data.');out[key]=copyJSON(item,depth+1);}
  return out;
}
const game=value=>object(value)&&address(value.url)&&text(value.title,500);
// A local folder that is not a whole drive, as the installed-games scan requires.
function gameFolder(value){
  if(!localPath(value))return false;
  const resolved=path.win32.resolve(value);return resolved!==path.win32.parse(resolved).root;
}
function listItems(key,list){
  if(key==='favorites')return list.filter(game);
  // Installed games are scanned only in local folders (see installed-games.cjs).
  if(key==='gameFolders')return list.filter(gameFolder);
  return list.filter(collection=>object(collection)&&text(collection.id,100)&&text(collection.name,80)&&Array.isArray(collection.games))
    .map(collection=>({...collection,games:collection.games.filter(game).slice(0,500)}));
}
const BOOLEAN_SETTINGS=['defenderScan','autoUpdateEnabled','clipboardWatchEnabled','notificationsEnabled','adaptiveThemeEnabled','browserIntegrationEnabled'];
function settingsFrom(value){
  if(value===undefined)return {settings:{},changed:false};
  if(!object(value))return {settings:{},changed:true};
  const settings={};let changed=false;
  for(const [key,raw]of Object.entries(value)){
    try{
      if(['__proto__','prototype','constructor'].includes(key))throw new Error();
      const entry=copyJSON(raw);
      if(key==='downloadDir'&&!localPath(entry,{network:true}))throw new Error();
      if(BOOLEAN_SETTINGS.includes(key)&&typeof entry!=='boolean')throw new Error();
      if(key==='concurrency'&&(!integer(entry)||entry<1||entry>4))throw new Error();
      if(key==='connectionsPerFile'&&![1,2,4].includes(entry))throw new Error();
      if(key==='maxDownloadBytesPerSecond')normalizeBandwidthLimit(entry);
      if(key==='downloadSchedule')normalizeSchedule(entry);
      // One damaged item drops only that item, never the whole list.
      if(key==='favorites'||key==='collections'||key==='gameFolders'){
        const max={favorites:1000,collections:100,gameFolders:20}[key];
        if(!Array.isArray(entry))throw new Error();
        const kept=listItems(key,entry).slice(0,max);
        if(kept.length!==entry.length||JSON.stringify(kept)!==JSON.stringify(entry))changed=true;
        settings[key]=kept;continue;
      }
      if(key==='language'&&!['en','ar','system'].includes(entry))throw new Error();
      if(key==='digits'&&!['latn','arab','auto'].includes(entry))throw new Error();
      if(key==='youtubeQuality'&&!Object.hasOwn(QUALITIES,entry))throw new Error();
      if(key==='torrents'&&(!object(entry)||['enabled','accepted'].some(flag=>typeof entry[flag]!=='boolean')||!integer(entry.uploadLimit)||![0,15,60].includes(entry.shareMinutes)))throw new Error();
      settings[key]=entry;
    }catch{changed=true;}
  }
  return {settings,changed};
}
const ENTRY_KEYS=new Set(['id','url','sourceUrl','sourceIdentity','name','gameTitle','folder','status','received','total','speed','error','etag','lastModified','lastModifiedVerified','headers','sealedHeaders','headersNeedRefresh','connectionMode','activeConnections','connectionNote','createdAt','completedAt','origin','markOfTheWeb','mod','kind','media','torrent','retryAt','retryCount','retryStatus','networkRetries','pauseReason','scheduleRequested','needsNewLink','scan','reputation']);
function downloadFrom(value){
  if(!object(value)||!text(value.id,200)||!value.id||/[\x00-\x1f\x7f]/.test(value.id)||!filename(value.name)||!localPath(value.folder,{network:true})||!['queued','downloading','paused','completed','cancelled','error'].includes(value.status))return null;
  let d;try{d=copyJSON(Object.fromEntries(Object.entries(value).filter(([key])=>ENTRY_KEYS.has(key))));}catch{return null;}
  if(d.kind!==undefined&&!['media','torrent'].includes(d.kind))return null;
  if(d.kind==='torrent'){
    const torrent=d.torrent;
    if(!object(torrent)||!text(torrent.infoHash,40)||!/^[a-f0-9]{40}$/.test(torrent.infoHash)||!filename(torrent.name)||!text(d.url,8192)||!d.url.startsWith('magnet:?xt=urn:btih:'+torrent.infoHash)||d.sourceUrl!==d.url||!Array.isArray(torrent.files)||!torrent.files.length||torrent.files.length>10000)return null;
    let total=0,selected=0;const paths=new Set();
    for(const [index,file]of torrent.files.entries()){
      if(!object(file)||file.index!==index+1||!text(file.path,2048)||!(file.path===torrent.name||file.path.startsWith(torrent.name+'/'))||file.path.split('/').some(part=>!filename(part))||!integer(file.length)||typeof file.selected!=='boolean'||typeof file.padding!=='boolean'||file.selected&&file.padding||paths.has(file.path.toLowerCase()))return null;
      paths.add(file.path.toLowerCase());if(file.selected){selected++;total+=file.length;}
    }
    if(!selected||!integer(total))return null;
  }else{
    if(!address(d.url)||d.sourceUrl!==undefined&&!address(d.sourceUrl))return null;
    if(d.kind==='media'&&(!object(d.media)||typeof d.media.videoId!=='string'||!VIDEO_ID.test(d.media.videoId)||typeof d.media.quality!=='string'||!Object.hasOwn(QUALITIES,d.media.quality)||d.url!==canonicalUrl(d.media.videoId)))return null;
  }
  // A mod label that does not check out is dropped; the download itself stays.
  if(d.mod!==undefined){
    let valid=false;try{d.mod=modContext(d.mod);valid=d.origin==='browser'&&fromNexus({url:d.sourceUrl||d.url,finalUrl:d.url});}catch{}
    if(!valid){
      delete d.mod;
      // As for a valid mod link, a finished or cancelled entry keeps no signed link or request details.
      if(['completed','cancelled'].includes(d.status)){d.url=plainAddress(d.url);if(d.sourceUrl!==undefined)d.sourceUrl=plainAddress(d.sourceUrl);d.headers={};delete d.sealedHeaders;}
    }
  }
  if(d.gameTitle!==undefined&&!text(d.gameTitle,2000))return null;
  for(const key of ['received','total'])if(d[key]!==undefined&&!integer(d[key]))return null;
  for(const key of ['retryAt','retryCount','retryStatus','networkRetries'])if(d[key]!==undefined&&!integer(d[key]))delete d[key];
  for(const key of ['createdAt','completedAt','lastModified','etag','connectionMode','connectionNote','error','pauseReason'])if(d[key]!==undefined&&d[key]!==null&&!text(d[key],4000))delete d[key];
  for(const key of ['lastModifiedVerified','headersNeedRefresh','markOfTheWeb','scheduleRequested','needsNewLink'])if(d[key]!==undefined&&typeof d[key]!=='boolean')delete d[key];
  if(d.sealedHeaders!==undefined&&(!text(d.sealedHeaders,1024*1024)||typeof d.sealedHeaders!=='string'))delete d.sealedHeaders;
  if(d.headers!==undefined)d.headers=cleanHeaders(d.headers)||{};
  if(d.scan!==undefined&&(!object(d.scan)||!['queued','scanning','clean','threat','missing','unavailable','error','review'].includes(d.scan.status)))delete d.scan;
  if(d.scan)for(const key of ['message','startedAt','scannedAt'])if(d.scan[key]!==undefined&&!text(d.scan[key],4000))delete d.scan[key];
  if(d.reputation!==undefined&&!object(d.reputation))delete d.reputation;
  if(d.sourceIdentity!==undefined&&(typeof d.sourceIdentity!=='string'||!/^[a-f0-9]{64}$/.test(d.sourceIdentity)))delete d.sourceIdentity;
  return d;
}
function validateLibrary(value){
  if(!object(value)||value.schemaVersion!==undefined&&value.schemaVersion!==SCHEMA_VERSION)return {data:{settings:{},downloads:[]},changed:true,future:object(value)&&Number.isSafeInteger(value.schemaVersion)&&value.schemaVersion>SCHEMA_VERSION};
  const {settings,changed:settingsChanged}=settingsFrom(value.settings);
  let changed=settingsChanged||value.downloads!==undefined&&!Array.isArray(value.downloads);
  const downloads=[],ids=new Set();
  if(Array.isArray(value.downloads)){
    for(const raw of value.downloads){const entry=downloadFrom(raw);if(!entry||ids.has(entry.id)){changed=true;continue;}ids.add(entry.id);downloads.push(entry);if(JSON.stringify(entry)!==JSON.stringify(raw))changed=true;}
  }
  // A very long list keeps every unfinished download and the newest finished
  // ones (the original stays in the recovery copy), instead of refusing it all.
  if(downloads.length>MAX_DOWNLOADS){
    let over=downloads.length-MAX_DOWNLOADS;const drop=new Set();
    for(const done of [true,false])for(const d of downloads){if(!over)break;if(!drop.has(d)&&['completed','cancelled'].includes(d.status)===done){drop.add(d);over--;}}
    return {data:{settings,downloads:downloads.filter(d=>!drop.has(d))},changed:true};
  }
  return {data:{settings,downloads},changed};
}
// The profile folder can be reached through a junction or link (for example
// AppData moved to another drive). Resolve it once; the real folders are then
// checked, and none of them may change while the library is read.
function canonical(file,io){
  // Windows' own answer first; some virtual drives refuse it, so Node's own
  // resolution next, and then the path as given (checked as before).
  const resolvers=[io.realpathSync?.native,io.realpathSync].filter(real=>typeof real==='function');
  let existing=path.dirname(file);const rest=[path.basename(file)];
  for(;;){
    let missing=false;
    for(const real of resolvers){
      try{return path.join(real.call(io,existing),...rest);}
      catch(error){if(error?.code==='ENOENT'){missing=true;break;}}
    }
    if(!missing)return path.join(existing,...rest);
    const parent=path.dirname(existing);if(parent===existing)return path.join(existing,...rest);
    rest.unshift(path.basename(existing));existing=parent;
  }
}
// Antivirus and sync programs can hold the file for a moment at startup.
const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function openRetrying(open,{retries=LOCK_RETRIES,wait=pause}={}){
  for(let attempt=0;;attempt++){
    try{return open();}
    catch(error){if(attempt>=retries||!['EBUSY','EPERM','EACCES'].includes(error?.code))throw error;wait(LOCK_WAIT_MS);}
  }
}
function readStateFile(file,io=fs,verification={},options={}){
  file=canonical(path.resolve(file),io);verification.file=file;
  const same=(a,b)=>a.ino!==0n&&a.ino===b.ino&&a.dev===b.dev&&a.birthtimeNs===b.birthtimeNs;
  const unchanged=(a,b)=>same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.nlink===b.nlink;
  const regular=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.ino!==0n&&stat.nlink===1n&&stat.size>=0n&&stat.size<=BigInt(MAX_BYTES);
  let fd;
  try{
    // Validate the handle we actually opened, not a pathname checked before
    // opening. NOFOLLOW/NONBLOCK are unavailable on Windows: there, explicit
    // pathname and junction checks below still run before the first byte read.
    fd=openRetrying(()=>io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0)),options);
    verification.existed=true;
    const stat=io.fstatSync(fd,{bigint:true});
    if(!regular(stat))throw new Error('Unsafe library file.');
    const ancestors=[];
    for(let parent=path.dirname(file);;parent=path.dirname(parent)){const current=io.lstatSync(parent,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||current.ino===0n)throw new Error('Unsafe library folder.');ancestors.push([parent,current]);if(parent===path.parse(parent).root)break;}
    const verifyPath=()=>{
      const named=io.lstatSync(file,{bigint:true});
      if(!regular(named)||!unchanged(stat,named))throw new Error('Library changed.');
      for(const [parent,before]of ancestors){const current=io.lstatSync(parent,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||!same(before,current))throw new Error('Library folder changed.');}
    };
    const verify=()=>{
      const opened=io.fstatSync(fd,{bigint:true});
      if(!regular(opened)||!unchanged(stat,opened))throw new Error('Library changed.');
      verifyPath();
    };
    verify();const bytes=Buffer.alloc(Number(stat.size));let position=0;
    while(position<bytes.length){const count=io.readSync(fd,bytes,position,bytes.length-position,position);if(!count)throw new Error('Library changed.');position+=count;}
    verify();
    // Recovery writes recheck the original and every parent immediately before
    // and after creating the sibling. No second unbounded read is needed.
    verification.check=verifyPath;
    return bytes;
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
function safeMissingLibrary(file,io){
  file=canonical(path.resolve(file),io);
  if(!localPath(file,{network:true}))return false;
  try{io.lstatSync(file);return false;}catch(error){if(error.code!=='ENOENT')return false;}
  for(let parent=path.dirname(file);;parent=path.dirname(parent)){
    const atRoot=parent===path.parse(parent).root;
    try{const stat=io.lstatSync(parent,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino===0n)return false;}
    catch(error){if(error.code!=='ENOENT'||atRoot)return false;}
    if(atRoot)return true;
  }
}
function loadLibrary(file,{io=fs,wait}={}){
  let bytes;const verification={};
  try{bytes=readStateFile(file,io,verification,{wait});}catch(error){
    // Only a missing library is a new profile. A vanished parent or raced
    // replacement of an existing file must not enable overwriting it.
    const missing=!verification.existed&&error?.code==='ENOENT'&&safeMissingLibrary(file,io);
    return {data:{settings:{},downloads:[]},canSave:missing,warning:missing?'':BLOCKED,file:canonical(path.resolve(file),io)};
  }
  // From here on the real path that was checked and read is the one written.
  file=verification.file;
  let parsed;try{parsed=validateLibrary(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}catch{parsed={data:{settings:{},downloads:[]},changed:true};}
  if(parsed.future)return {data:parsed.data,canSave:false,warning:FUTURE,file};
  if(!parsed.changed)return {data:parsed.data,canSave:true,warning:'',file};
  // EXCL creates a new sibling, never replaces any recovery file. The original
  // remains in place until a later successful atomic save; failed backup means
  // saving is disabled, not permission to discard the only copy. A copy is
  // named after its content, so the same damaged library is copied only once.
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0);
  const names=[crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32),crypto.randomUUID()];
  let recoveryFd,recoveryFile;
  try{
    verification.check();
    for(const [i,name]of names.entries()){
      const candidate=file+'.recovery-'+name+'.json';
      try{recoveryFd=io.openSync(candidate,flags,0o600);recoveryFile=candidate;break;}
      catch(error){
        if(error?.code!=='EEXIST'||i===names.length-1)throw error;
        if(sameCopy(candidate,bytes,io)){recoveryFile=candidate;break;}
      }
    }
    if(recoveryFd!==undefined){
      io.writeFileSync(recoveryFd,bytes);io.fsyncSync(recoveryFd);
      const created=io.fstatSync(recoveryFd,{bigint:true}),named=io.lstatSync(recoveryFile,{bigint:true});
      if(!created.isFile()||created.nlink!==1n||created.ino===0n||created.ino!==named.ino||created.dev!==named.dev||created.birthtimeNs!==named.birthtimeNs||named.isSymbolicLink())throw new Error('Recovery changed.');
    }
    verification.check();
  }
  catch{return {data:parsed.data,canSave:false,warning:BLOCKED,file};}
  finally{if(recoveryFd!==undefined)io.closeSync(recoveryFd);}
  pruneRecoveryCopies(file,recoveryFile,io);
  return {data:parsed.data,canSave:true,warning:RECOVERED,recoveryFile,file};
}
// An earlier copy of exactly these bytes: a plain file, not a link.
function sameCopy(copy,bytes,io){
  try{
    const stat=io.lstatSync(copy,{bigint:true});
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size!==BigInt(bytes.length))return false;
    return Buffer.from(io.readFileSync(copy)).equals(bytes);
  }catch{return false;}
}
// Recovery copies keep old links and paths. Keep the oldest (often the list as
// it was before anything went wrong) and the newest, never the one just made or
// reused, and remove only Ravenshelf's own plain files beside the library.
const COPY_NAME=/^\.recovery-(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
function pruneRecoveryCopies(file,keep,io){
  if(typeof io.readdirSync!=='function'||typeof io.unlinkSync!=='function')return;
  try{
    const folder=path.dirname(file),base=path.basename(file),copies=[];
    for(const name of io.readdirSync(folder)){
      if(typeof name!=='string'||!name.startsWith(base)||!COPY_NAME.test(name.slice(base.length)))continue;
      const copy=path.join(folder,name);
      try{const stat=io.lstatSync(copy);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1)copies.push({copy,name,time:stat.mtimeMs});}catch{}
    }
    copies.sort((a,b)=>b.time-a.time);
    const kept=new Set([path.basename(keep)]);
    if(copies.length)kept.add(copies.at(-1).name);
    for(const {copy,name}of copies){if(kept.size<MAX_RECOVERY_COPIES||kept.has(name)){kept.add(name);continue;}try{io.unlinkSync(copy);}catch{}}
  }catch{}
}
module.exports={loadLibrary,validateLibrary,downloadFrom,settingsFrom,readStateFile,localPath,filename,gameFolder,SCHEMA_VERSION,MAX_BYTES,MAX_DOWNLOADS,MAX_RECOVERY_COPIES,RECOVERED,BLOCKED,FUTURE,READ_ONLY,LIST_FULL};
