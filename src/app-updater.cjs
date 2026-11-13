'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeFetch}=require('./net.cjs');
const {openDownloadFile}=require('./download-file.cjs');
const {verifyReleaseBuild,recordName,MAX_RECORD_BYTES}=require('./release-attestation.cjs');
const REPO='khattabhunter/ravenshelf',MAX_EXE=512*1024*1024;
const RELEASES='https://api.github.com/repos/'+REPO+'/releases?per_page=30';
const CDN=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
// Files the updater itself creates in profile/updates/pending/<uuid>.
const PENDING_FILES=['update.exe','ravenshelf-updater.exe','job.json','result.json'];
const PENDING_NAME=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,ROLLBACK_NAME=/^\.ravenshelf-rollback-[0-9a-f]{32}\.exe$/;
// The native helper waits up to a minute for Ravenshelf to exit and retries a
// locked replacement for another minute. Unfinished work younger than this is
// never touched.
const STALE_MS=15*60*1000;
function version(value){const m=/^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value));if(!m)return null;const parts=m.slice(1).map(Number);return parts.every(x=>Number.isSafeInteger(x)&&x<1000000)?parts:null;}
function newer(a,b){const x=version(a),y=version(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function assetUrl(value,tag,name){return value==='https://github.com/'+REPO+'/releases/download/'+tag+'/'+name;}
function selectRelease(releases,current){
  if(!Array.isArray(releases))throw new Error('Invalid update response.');
  const candidates=releases.filter(r=>r&&!r.draft&&/^v\d+\.\d+\.\d+$/.test(r.tag_name)&&newer(r.tag_name,current)&&r.published_at&&Array.isArray(r.assets));
  candidates.sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:newer(b.tag_name,a.tag_name)?1:0);
  for(const release of candidates){
    const nextVersion=release.tag_name.slice(1),name='Ravenshelf-'+nextVersion+'-Windows.exe',signedName=recordName(name);
    const exes=release.assets.filter(a=>a?.name===name),sums=release.assets.filter(a=>a?.name==='SHA256SUMS.txt'),records=release.assets.filter(a=>a?.name===signedName);
    // A release without exactly one signed build record is never offered.
    if(exes.length!==1||sums.length!==1||records.length!==1)continue;
    const exe=exes[0],sum=sums[0],record=records[0];
    if(!Number.isSafeInteger(exe.size)||exe.size<64||exe.size>MAX_EXE||!/^sha256:[a-f0-9]{64}$/.test(exe.digest||''))continue;
    if(!Number.isSafeInteger(record.size)||record.size<64||record.size>MAX_RECORD_BYTES)continue;
    if(!assetUrl(exe.browser_download_url,release.tag_name,name)||!assetUrl(sum.browser_download_url,release.tag_name,'SHA256SUMS.txt')||!assetUrl(record.browser_download_url,release.tag_name,signedName))continue;
    return {version:nextVersion,tag:release.tag_name,name,size:exe.size,sha256:exe.digest.slice(7),url:exe.browser_download_url,checksumUrl:sum.browser_download_url,recordUrl:record.browser_download_url,releaseUrl:'https://github.com/'+REPO+'/releases/tag/'+release.tag_name};
  }
  return null;
}
async function trustedFetch(url,{fetcher=safeFetch,signal,timeoutMs=30000}={}){
  let current=new URL(url);
  for(let redirects=0;redirects<6;redirects++){
    if(current.protocol!=='https:'||current.username||current.password||current.port)throw new Error('Unexpected update destination.');
    const allowed=current.href===RELEASES||(current.hostname==='github.com'&&/^\/khattabhunter\/ravenshelf\/releases\/download\/v\d+\.\d+\.\d+\/(?:Ravenshelf-\d+\.\d+\.\d+-Windows\.exe(?:\.sigstore\.json)?|SHA256SUMS\.txt)$/.test(current.pathname))||CDN.has(current.hostname);
    if(!allowed)throw new Error('Unexpected update destination.');
    const response=await fetcher(current.href,{redirect:'manual',timeoutMs,signal,headers:{Accept:'application/octet-stream, application/json','Accept-Encoding':'identity'}});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('Invalid update redirect.');
    current=new URL(location,current);
  }
  throw new Error('Too many update redirects.');
}
async function boundedText(response,max){
  if(!response.ok||!response.body){await response.body?.cancel();throw new Error('Update service unavailable.');}
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max)throw new Error('Update response too large.');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
function parseChecksum(text,release){
  const lines=text.trim().split(/\r?\n/);const matches=lines.map(line=>/^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$/.exec(line)).filter(m=>m&&m[2]===release.name);
  if(matches.length!==1||matches[0][1].toLowerCase()!==release.sha256)throw new Error('Update checksums do not match.');return release.sha256;
}
async function hashOpen(file){
  const opened=await openDownloadFile(file,{readOnly:true});const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(128*1024);let position=0;
  try{if(opened.size<64||opened.size>MAX_EXE)throw new Error('Invalid application size.');for(;;){const {bytesRead}=await opened.handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;position+=bytesRead;if(position>MAX_EXE)throw new Error('Application changed.');hash.update(buffer.subarray(0,bytesRead));}await opened.verifyUnchanged();return {sha256:hash.digest('hex'),size:position};}
  finally{await opened.handle.close();}
}
async function saveProfileBackup(profileDir,directory){
  await fs.promises.mkdir(directory,{recursive:true});
  for(const name of ['library.json','installed-games.json','Local State','Preferences','renderer-cache.json']){
    const source=await openDownloadFile(path.join(profileDir,name),{allowMissing:true,readOnly:true});if(!source)continue;
    let target;try{
      if(source.size>32*1024*1024)throw new Error('Profile backup is too large.');
      target=await openDownloadFile(path.join(directory,name),{create:true});const buffer=Buffer.alloc(65536);let position=0;
      while(position<source.size){const {bytesRead}=await source.handle.read(buffer,0,Math.min(buffer.length,source.size-position),position);if(!bytesRead)throw new Error('Profile changed during backup.');let offset=0;while(offset<bytesRead){const {bytesWritten}=await target.handle.write(buffer,offset,bytesRead-offset,position+offset);if(!bytesWritten)throw new Error('Profile backup failed.');offset+=bytesWritten;}position+=bytesRead;}
      await source.verifyUnchanged();await target.handle.sync();await target.verify(source.size);
    }finally{await target?.handle.close();await source.handle.close();}
  }
}
// Bounded read of a job or result file. Unreadable or unexpected content is
// treated as unknown, which always keeps the related files.
async function readSmallJSON(file){
  let handle;
  try{
    handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    const buffer=Buffer.alloc(16385),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>16384)return null;
    const value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,''));
    return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  }catch{return null;}
  finally{await handle?.close().catch(()=>{});}
}
const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validJob(job){return Boolean(job&&hex64(job.sha256)&&hex64(job.previousSha256)&&typeof job.target==='string'&&path.isAbsolute(job.target)&&/^Ravenshelf[-\w. ()]*\.exe$/i.test(path.basename(job.target)));}
const samePathKey=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
// Removes one regular file by name. Links and directories are never followed
// or removed. A file that is already gone counts as removed.
async function removeFile(file,{clearReadOnly=false}={}){
  let stat;try{stat=await fs.promises.lstat(file);}catch(error){return error?.code==='ENOENT';}
  if(!stat.isFile()||stat.isSymbolicLink())return false;
  try{await fs.promises.unlink(file);return true;}
  catch(error){
    if(error?.code==='ENOENT')return true;
    // The rollback keeps the old executable's attributes; Windows refuses to
    // delete read-only files.
    if(!clearReadOnly||!['EPERM','EACCES'].includes(error?.code))return false;
    try{await fs.promises.chmod(file,0o666);await fs.promises.unlink(file);return true;}catch{return false;}
  }
}
async function inspectPending(directory,now){
  const stat=await fs.promises.lstat(directory).catch(()=>null);
  if(!stat?.isDirectory()||stat.isSymbolicLink())return null;
  const files={};let newest=stat.mtimeMs;
  for(const name of PENDING_FILES){
    const file=await fs.promises.lstat(path.join(directory,name)).catch(error=>error?.code==='ENOENT'?null:false);
    if(file===false)return null;
    if(!file)continue;
    // Anything other than a plain file means the folder was changed by someone
    // else; leave all of it alone.
    if(!file.isFile()||file.isSymbolicLink())return null;
    files[name]=true;newest=Math.max(newest,file.mtimeMs);
  }
  return {directory,files,age:now-newest,
    job:files['job.json']?await readSmallJSON(path.join(directory,'job.json')):null,
    result:files['result.json']?await readSmallJSON(path.join(directory,'result.json')):null};
}
class AppUpdater{
  constructor({currentVersion,profileDir,executable,fetcher=safeFetch,bandwidthLimiter=null,verifyBuild=verifyReleaseBuild,onChange=()=>{},onAvailable=()=>{},onReady=()=>{},supported=true,now=Date.now}={}){
    Object.assign(this,{currentVersion,profileDir,executable,fetcher,bandwidthLimiter,verifyBuild,onChange,onAvailable,onReady,supported,now});
    this.state={phase:supported?'idle':'unavailable',currentVersion,availableVersion:null,releaseUrl:null,progress:0,installApproved:false,message:supported?'Check GitHub for a newer Ravenshelf release.':'Automatic updates are available in the Windows portable release.'};
    this.task=null;this.available=null;this.approved=false;this.ready=null;this.prepared=null;this.preparing=null;this.timers=[];this.controller=null;this.disposed=false;this.activeDirectory=null;this.cleanupTask=null;
  }
  snapshot(){return {...this.state};}
  set(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
  // Automatic checks only look for a release and announce it. Nothing is
  // downloaded or installed until the user approves it with download().
  configure(enabled){for(const timer of this.timers){clearTimeout(timer);clearInterval(timer);}this.timers=[];if(!enabled||!this.supported||this.disposed)return;const first=setTimeout(()=>this.check().catch(()=>{}),15000),repeat=setInterval(()=>this.check().catch(()=>{}),6*60*60*1000);first.unref?.();repeat.unref?.();this.timers=[first,repeat];}
  async check(){
    if(this.task)return this.task;if(!this.supported||this.disposed||this.ready)return this.snapshot();
    this.task=this.performCheck().catch(()=>{this.set({phase:'error',progress:0,message:'Ravenshelf could not check GitHub for updates. Try again later.'});return this.snapshot();}).finally(()=>{this.task=null;});return this.task;
  }
  async performCheck(){
    const controller=this.controller=new AbortController(),signal=controller.signal;
    this.set({phase:'checking',progress:0,message:'Checking GitHub for updates.'});
    const releases=JSON.parse(await boundedText(await trustedFetch(RELEASES,{fetcher:this.fetcher,signal}),1024*1024));signal.throwIfAborted();
    const release=selectRelease(releases,this.currentVersion),lastCheckedAt=new Date(this.now()).toISOString();
    if(!release){this.available=null;this.set({phase:'current',availableVersion:null,releaseUrl:null,lastCheckedAt,message:'Ravenshelf is up to date.'});return this.snapshot();}
    this.available=release;
    this.set({phase:'available',availableVersion:release.version,releaseUrl:release.releaseUrl,lastCheckedAt,message:'Ravenshelf '+release.version+' is available. Nothing is downloaded until you choose Download and install.'});
    this.onAvailable(release.version);
    return this.snapshot();
  }
  // The user's approval of the release shown by the latest check.
  async download(){
    if(this.task)return this.task;if(!this.supported||this.disposed||this.ready)return this.snapshot();
    const release=this.available;
    if(this.state.phase!=='available'||!release)throw new Error('Check for updates first.');
    this.approved=true;
    this.task=this.performDownload(release).catch(()=>{this.approved=false;this.set({phase:'error',progress:0,installApproved:false,message:'The update could not be verified or downloaded. Your current app and downloads are unchanged.'});return this.snapshot();}).finally(()=>{this.task=null;});return this.task;
  }
  async performDownload(release){
    const controller=this.controller=new AbortController(),signal=controller.signal;
    // Check GitHub's checksum and the signed build record before spending
    // bandwidth on the executable. The record must name this exact digest.
    this.set({phase:'verifying',progress:0,installApproved:false,message:'Checking GitHub’s checksum and signed build record.'});
    parseChecksum(await boundedText(await trustedFetch(release.checksumUrl,{fetcher:this.fetcher,signal}),16384),release);signal.throwIfAborted();
    const recordText=await boundedText(await trustedFetch(release.recordUrl,{fetcher:this.fetcher,signal}),MAX_RECORD_BYTES);signal.throwIfAborted();
    await this.verifyBuild({release,recordText,cachePath:path.join(this.profileDir,'updates','sigstore'),signal});signal.throwIfAborted();
    const directory=path.join(this.profileDir,'updates','pending',crypto.randomUUID());this.activeDirectory=directory;
    const staged=path.join(directory,'update.exe');let opened,created=false,reader,watchdog,lastActivity=this.now(),waitingForBudget=false;
    try{
      await fs.promises.mkdir(directory,{recursive:true});
      signal.throwIfAborted();opened=await openDownloadFile(staged,{create:true});created=true;signal.throwIfAborted();
      watchdog=setInterval(()=>{if(!waitingForBudget&&this.now()-lastActivity>30000)controller.abort();},1000);watchdog.unref?.();
      const response=await trustedFetch(release.url,{fetcher:this.fetcher,signal,timeoutMs:0});lastActivity=this.now();
      if(response.status!==200||!response.body){await response.body?.cancel();throw new Error('Update download unavailable.');}
      const size=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
      if((size!==null&&(!/^\d+$/.test(size)||Number(size)!==release.size))||(encoding&&encoding!=='identity')){await response.body.cancel();throw new Error('Update size changed.');}
      const hash=crypto.createHash('sha256');reader=response.body.getReader();let received=0,lastProgress=0;const magic=[];
      this.set({phase:'downloading',message:'Downloading and verifying the update.'});
      for(;;){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
        lastActivity=this.now();
        if(received+value.byteLength>release.size)throw new Error('Update size changed.');
        if(this.bandwidthLimiter){waitingForBudget=true;try{await this.bandwidthLimiter.consume(value.byteLength,{signal});}finally{waitingForBudget=false;lastActivity=this.now();}}
        signal.throwIfAborted();
        for(const byte of value.subarray(0,Math.max(0,2-magic.length)))magic.push(byte);
        hash.update(value);let offset=0;while(offset<value.byteLength){const {bytesWritten}=await opened.handle.write(value,offset,value.byteLength-offset,received+offset);if(!bytesWritten)throw new Error('Cannot save update.');offset+=bytesWritten;}
        received+=value.byteLength;if(this.now()-lastProgress>=250){lastProgress=this.now();this.set({progress:received/release.size});}
      }
      if(received!==release.size||hash.digest('hex')!==release.sha256||magic[0]!==0x4d||magic[1]!==0x5a)throw new Error('Update verification failed.');
      await opened.handle.sync();signal.throwIfAborted();await opened.verify(received);signal.throwIfAborted();this.ready={release,staged,directory};
      this.set({phase:'ready',progress:1,installApproved:true,message:'Update verified. It installs when Ravenshelf fully exits, or you choose Restart now.'});this.onReady(release.version);
    }catch(error){
      // Remove only the partial file this attempt created, then its folder if
      // it is empty. rmdir never removes a folder that still has contents.
      try{await opened?.handle.close();opened=null;if(created)await fs.promises.unlink(staged);}catch{}
      await fs.promises.rmdir(directory).catch(()=>{});
      throw error;
    }
    finally{clearInterval(watchdog);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}await opened?.handle.close();this.activeDirectory=null;}
    return this.snapshot();
  }
  async prepareInstall({restart=false,pid=process.pid}={}){
    if(!this.supported||!this.ready||!this.approved)return null;if(this.prepared)return this.prepared;if(this.preparing)return this.preparing;
    this.preparing=this.performPrepareInstall({restart,pid}).finally(()=>{this.preparing=null;});return this.preparing;
  }
  async performPrepareInstall({restart,pid}){
    if(!path.isAbsolute(this.executable||'')||!/^Ravenshelf[-\w. ()]*\.exe$/i.test(path.basename(this.executable)))throw new Error('Unsupported application location.');
    const current=await hashOpen(this.executable),candidate=await hashOpen(this.ready.staged);
    if(candidate.sha256!==this.ready.release.sha256||candidate.size!==this.ready.release.size)throw new Error('Staged update changed.');
    await saveProfileBackup(this.profileDir,path.join(this.profileDir,'updates','backups',this.currentVersion+'-'+crypto.randomUUID()));
    const helper=path.join(this.ready.directory,'ravenshelf-updater.exe'),job=path.join(this.ready.directory,'job.json');
    const helperBytes=await fs.promises.readFile(path.join(__dirname,'ravenshelf-updater.exe'));
    const helperBuild=JSON.parse(await fs.promises.readFile(path.join(__dirname,'updater-build.json'),'utf8'));
    if(helperBuild.output?.name!=='ravenshelf-updater.exe'||helperBuild.output.size!==helperBytes.length||helperBuild.output.sha256!==crypto.createHash('sha256').update(helperBytes).digest('hex'))throw new Error('The bundled updater helper changed.');
    const data={target:path.resolve(this.executable),staged:this.ready.staged,sha256:candidate.sha256,size:candidate.size,previousSha256:current.sha256,pid,restart:restart===true,nonce:crypto.randomUUID(),result:path.join(this.ready.directory,'result.json')};
    const owned=[];
    try{
      for(const [file,bytes] of [[helper,helperBytes],[job,Buffer.from(JSON.stringify(data))]]){
        const opened=await openDownloadFile(file,{create:true});owned.push({file,opened});
        await opened.handle.writeFile(bytes);await opened.handle.sync();await opened.verify(bytes.length);
      }
    }catch(error){
      // A partial preparation can be retried. Never remove a preexisting file or
      // an entry whose identity/ancestry no longer matches our retained handle.
      for(const {file,opened} of owned.reverse())try{await opened.verify();await fs.promises.unlink(file);}catch{}
      throw error;
    }finally{await Promise.allSettled(owned.map(({opened})=>opened.handle.close()));}
    this.prepared={helper,job};return this.prepared;
  }
  // Removes what finished updates leave behind: the staged copy and helper in
  // profile/updates/pending, and the previous executable the helper keeps next
  // to the app as a rollback copy. A rollback is removed only when a recorded
  // successful update replaced exactly that file (same SHA-256) and it differs
  // from the running app. Failed updates never lose their rollback copy, and
  // profile backups in profile/updates/backups are kept.
  cleanupLeftovers(){
    if(!this.supported||this.disposed)return Promise.resolve({removed:0});
    if(!this.cleanupTask)this.cleanupTask=this.performCleanup().catch(()=>({removed:0})).finally(()=>{this.cleanupTask=null;});
    return this.cleanupTask;
  }
  async performCleanup(){
    const pending=path.join(this.profileDir,'updates','pending');let removed=0;
    let entries;try{entries=await fs.promises.readdir(pending,{withFileTypes:true});}catch{return {removed};}
    const jobs=[];
    for(const entry of entries.slice(0,200)){
      if(this.disposed)return {removed};
      if(!entry.isDirectory()||!PENDING_NAME.test(entry.name))continue;
      const directory=path.join(pending,entry.name);
      if(directory===this.ready?.directory||directory===this.activeDirectory)continue;
      const job=await inspectPending(directory,this.now());if(job)jobs.push(job);
    }
    const rollbacks=await this.removeRollbacks(jobs.filter(job=>job.result?.success===true&&validJob(job.job)).map(job=>job.job));
    removed+=rollbacks.removed;
    for(const job of jobs){
      if(this.disposed)break;
      const {result}=job,finished=result?.success===true||result?.success===false||job.age>STALE_MS;
      if(!finished)continue;
      // Job and result files stay until a successful update's rollback copy is
      // confirmed gone, or when a failed update could not restore the old app.
      const keepRecords=result?.success===true?!validJob(job.job)||rollbacks.unknown||rollbacks.unresolved.has(job.job.previousSha256):result?.success===false?result.restored!==true:true;
      let remaining=0;
      for(const name of PENDING_FILES){
        if(!job.files[name])continue;
        if((!keepRecords||name==='update.exe'||name==='ravenshelf-updater.exe')&&await removeFile(path.join(job.directory,name)))removed++;else remaining++;
      }
      if(!remaining)await fs.promises.rmdir(job.directory).then(()=>{removed++;},()=>{});
    }
    return {removed};
  }
  async removeRollbacks(successfulJobs){
    const outcome={removed:0,unresolved:new Set(),unknown:false};
    if(!successfulJobs.length)return outcome;
    const replaced=new Set(successfulJobs.map(job=>job.previousSha256)),folders=new Map();
    for(const file of [this.executable,...successfulJobs.map(job=>job.target)])if(typeof file==='string'&&path.isAbsolute(file))folders.set(samePathKey(path.dirname(file)),path.dirname(path.resolve(file)));
    const candidates=[];
    for(const folder of folders.values()){
      try{for(const entry of (await fs.promises.readdir(folder,{withFileTypes:true})).filter(item=>item.isFile()&&ROLLBACK_NAME.test(item.name)).slice(0,50))candidates.push(path.join(folder,entry.name));}
      // A folder that no longer exists holds no rollback copy; any other
      // failure leaves the outcome unknown and keeps the job records.
      catch(error){if(!['ENOENT','ENOTDIR'].includes(error?.code))outcome.unknown=true;}
    }
    if(!candidates.length)return outcome;
    let running;try{running=(await hashOpen(this.executable)).sha256;}catch{outcome.unknown=true;return outcome;}
    for(const file of candidates){
      if(this.disposed){outcome.unknown=true;break;}
      if(samePathKey(file)===samePathKey(this.executable))continue;
      let sha256;try{sha256=(await hashOpen(file)).sha256;}catch{outcome.unknown=true;continue;}
      if(!replaced.has(sha256)||sha256===running)continue;
      if(await removeFile(file,{clearReadOnly:true}))outcome.removed++;else outcome.unresolved.add(sha256);
    }
    return outcome;
  }
  dispose(){this.disposed=true;for(const timer of this.timers){clearTimeout(timer);clearInterval(timer);}this.timers=[];this.controller?.abort();return Promise.allSettled([this.task,this.cleanupTask].filter(Boolean)).then(()=>this.snapshot());}
}
module.exports={AppUpdater,selectRelease,newer,version,trustedFetch,parseChecksum,saveProfileBackup,hashOpen,RELEASES,STALE_MS};
