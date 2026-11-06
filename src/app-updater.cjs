'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeFetch}=require('./net.cjs');
const {openDownloadFile}=require('./download-file.cjs');
const REPO='khattabhunter/ravenshelf',MAX_EXE=512*1024*1024;
const RELEASES='https://api.github.com/repos/'+REPO+'/releases?per_page=30';
const CDN=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
function version(value){const m=/^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value));if(!m)return null;const parts=m.slice(1).map(Number);return parts.every(x=>Number.isSafeInteger(x)&&x<1000000)?parts:null;}
function newer(a,b){const x=version(a),y=version(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function assetUrl(value,tag,name){return value==='https://github.com/'+REPO+'/releases/download/'+tag+'/'+name;}
function selectRelease(releases,current){
  if(!Array.isArray(releases))throw new Error('Invalid update response.');
  const candidates=releases.filter(r=>r&&!r.draft&&/^v\d+\.\d+\.\d+$/.test(r.tag_name)&&newer(r.tag_name,current)&&r.published_at&&Array.isArray(r.assets));
  candidates.sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:newer(b.tag_name,a.tag_name)?1:0);
  for(const release of candidates){
    const nextVersion=release.tag_name.slice(1),name='Ravenshelf-'+nextVersion+'-Windows.exe';
    const exes=release.assets.filter(a=>a.name===name),sums=release.assets.filter(a=>a.name==='SHA256SUMS.txt');
    if(exes.length!==1||sums.length!==1)continue;
    const exe=exes[0],sum=sums[0];
    if(!Number.isSafeInteger(exe.size)||exe.size<64||exe.size>MAX_EXE||!/^sha256:[a-f0-9]{64}$/.test(exe.digest||''))continue;
    if(!assetUrl(exe.browser_download_url,release.tag_name,name)||!assetUrl(sum.browser_download_url,release.tag_name,'SHA256SUMS.txt'))continue;
    return {version:nextVersion,tag:release.tag_name,name,size:exe.size,sha256:exe.digest.slice(7),url:exe.browser_download_url,checksumUrl:sum.browser_download_url,releaseUrl:'https://github.com/'+REPO+'/releases/tag/'+release.tag_name};
  }
  return null;
}
async function trustedFetch(url,{fetcher=safeFetch,signal,timeoutMs=30000}={}){
  let current=new URL(url);
  for(let redirects=0;redirects<6;redirects++){
    if(current.protocol!=='https:'||current.username||current.password||current.port)throw new Error('Unexpected update destination.');
    const allowed=current.href===RELEASES||(current.hostname==='github.com'&&/^\/khattabhunter\/ravenshelf\/releases\/download\/v\d+\.\d+\.\d+\/(?:Ravenshelf-\d+\.\d+\.\d+-Windows\.exe|SHA256SUMS\.txt)$/.test(current.pathname))||CDN.has(current.hostname);
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
class AppUpdater{
  constructor({currentVersion,profileDir,executable,fetcher=safeFetch,bandwidthLimiter=null,onChange=()=>{},onReady=()=>{},supported=true,now=Date.now}={}){
    Object.assign(this,{currentVersion,profileDir,executable,fetcher,bandwidthLimiter,onChange,onReady,supported,now});this.state={phase:supported?'idle':'unavailable',currentVersion,availableVersion:null,progress:0,message:supported?'Updates are checked automatically.':'Automatic updates are available in the Windows portable release.'};this.task=null;this.ready=null;this.prepared=null;this.preparing=null;this.timers=[];this.controller=null;this.disposed=false;
  }
  snapshot(){return {...this.state};}
  set(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
  configure(enabled){for(const timer of this.timers){clearTimeout(timer);clearInterval(timer);}this.timers=[];if(!enabled||!this.supported||this.disposed)return;const first=setTimeout(()=>this.check().catch(()=>{}),15000),repeat=setInterval(()=>this.check().catch(()=>{}),6*60*60*1000);first.unref?.();repeat.unref?.();this.timers=[first,repeat];}
  async check(){
    if(this.task)return this.task;if(!this.supported||this.disposed||this.ready)return this.snapshot();
    this.task=this.performCheck().catch(()=>{this.set({phase:'error',message:'The update could not be verified or downloaded. Your current app and downloads are unchanged.'});return this.snapshot();}).finally(()=>{this.task=null;});return this.task;
  }
  async performCheck(){
    this.controller=new AbortController();const signal=this.controller.signal;
    this.set({phase:'checking',progress:0,message:'Checking GitHub for updates.'});
    const releases=JSON.parse(await boundedText(await trustedFetch(RELEASES,{fetcher:this.fetcher,signal}),1024*1024));signal.throwIfAborted();
    const release=selectRelease(releases,this.currentVersion);
    if(!release){this.set({phase:'current',lastCheckedAt:new Date(this.now()).toISOString(),message:'Ravenshelf is up to date.'});return this.snapshot();}
    this.set({phase:'available',availableVersion:release.version,releaseUrl:release.releaseUrl,message:'A newer release is available.'});
    parseChecksum(await boundedText(await trustedFetch(release.checksumUrl,{fetcher:this.fetcher,signal}),16384),release);signal.throwIfAborted();
    const directory=path.join(this.profileDir,'updates','pending',crypto.randomUUID());await fs.promises.mkdir(directory,{recursive:true});
    const staged=path.join(directory,'update.exe');let opened,reader,watchdog,lastActivity=this.now(),waitingForBudget=false;
    try{
      signal.throwIfAborted();opened=await openDownloadFile(staged,{create:true});signal.throwIfAborted();
      watchdog=setInterval(()=>{if(!waitingForBudget&&this.now()-lastActivity>30000)this.controller.abort();},1000);watchdog.unref?.();
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
      this.set({phase:'ready',progress:1,message:'Update verified. It installs when you close Ravenshelf.'});this.onReady(release.version);
    }catch(error){try{await opened?.handle.close();opened=null;await fs.promises.unlink(staged);}catch{}throw error;}
    finally{clearInterval(watchdog);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}await opened?.handle.close();}
    return this.snapshot();
  }
  async prepareInstall({restart=false,pid=process.pid}={}){
    if(!this.supported||!this.ready)return null;if(this.prepared)return this.prepared;if(this.preparing)return this.preparing;
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
  dispose(){this.disposed=true;for(const timer of this.timers){clearTimeout(timer);clearInterval(timer);}this.timers=[];this.controller?.abort();return this.task||Promise.resolve(this.snapshot());}
}
module.exports={AppUpdater,selectRelease,newer,version,trustedFetch,parseChecksum,saveProfileBackup,hashOpen,RELEASES};
