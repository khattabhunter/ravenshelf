'use strict';
// The torrent engine: aria2 (aria2c.exe, a pinned and checked helper program)
// running in the background while torrents download, controlled over JSON-RPC
// on 127.0.0.1 with a random secret for each start. aria2 reads no
// configuration file, keeps no log or session file, never follows web seeds or
// other links named in a magnet, does not look for peers on the local network
// and stops uploading as soon as a download is finished, unless sharing for a
// while afterwards was chosen. It also stops when Ravenshelf exits, even if
// Ravenshelf crashes. Text that aria2 sends back is never shown; only its
// error numbers are read.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {killTree}=require('./media-downloads.cjs');
const {readTorrent}=require('./magnet.cjs');

const MESSAGES=Object.freeze({
  start:'The torrent downloader could not start. Try again; if it keeps failing, set up torrent downloads again in Settings.',
  stopped:'The torrent downloader stopped unexpectedly. Retry to resume.',
  failed:'The torrent download stopped. Retry to resume.',
  write:'The torrent’s files could not be written. Check the download folder and free space, then retry.',
  space:'There is not enough free disk space. Free some space and try again.',
  noPeers:'No one is sharing this torrent right now, so its file list could not be found. Try again later.',
  changed:'The torrent’s files did not match what was checked, so Ravenshelf stopped it.',
  missing:'This torrent’s saved file list is missing. Add it again from its magnet link.'
});
const ENV_KEEP=['systemroot','windir'];
const DROP_MS=5000,START_TIMEOUT_MS=15000,RPC_TIMEOUT_MS=15000,MAX_ANSWER=8*1024*1024,METADATA_TIMEOUT_MS=10*60*1000,IDLE_MS=60*1000,POLL_MS=1000;
const STATUS_KEYS=['status','totalLength','completedLength','downloadSpeed','uploadSpeed','uploadLength','connections','numSeeders','errorCode','seeder'];
// aria2's exit and error numbers that mean the disk, or the files on it.
const SPACE_CODES=new Set(['9']),WRITE_CODES=new Set(['13','15','16','17','18']);

// Only what a Windows program needs to start, and a private temporary folder.
function engineEnv(base,temp){
  const env={};
  for(const [key,value] of Object.entries(base||{}))if(ENV_KEEP.includes(key.toLowerCase())&&typeof value==='string')env[key]=value;
  const root=env.SystemRoot||env.SYSTEMROOT||env.windir||env.WINDIR||'C:\\Windows';
  Object.assign(env,{PATH:[path.win32.join(root,'System32'),root].join(';'),TEMP:temp,TMP:temp});
  return env;
}
// Bytes per second as aria2 writes them; 0 means no limit there.
const rate=value=>String(Math.max(0,Math.floor(Number(value)||0)));
// The fixed command line. Every option that could read a file, run a command,
// keep a log or listen beyond this PC is set here, not taken from anywhere else.
function engineArgs({port,secret,appPid,stateDir,uploadLimit,downloadLimit}){
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(secret)||!Number.isInteger(appPid)||appPid<1)throw new Error(MESSAGES.start);
  const upload=Math.floor(Number(uploadLimit));
  // 0 would mean "no limit" to aria2, so an upload limit is always positive.
  if(!Number.isSafeInteger(upload)||upload<1024)throw new Error(MESSAGES.start);
  return Object.freeze([
    '--no-conf=true','--no-netrc=true','--quiet=true','--enable-color=false','--show-console-readout=false','--summary-interval=0','--console-log-level=error',
    '--enable-rpc=true','--rpc-listen-all=false',`--rpc-listen-port=${port}`,`--rpc-secret=${secret}`,'--rpc-allow-origin-all=false','--rpc-save-upload-metadata=false','--rpc-max-request-size=16M',
    `--stop-with-process=${appPid}`,`--dir=${stateDir}`,
    '--seed-time=0','--bt-seed-unverified=false','--bt-save-metadata=false','--follow-torrent=false','--follow-metalink=false',
    '--bt-enable-lpd=false','--enable-dht=true','--enable-dht6=false','--disable-ipv6=true','--enable-peer-exchange=true',
    `--dht-file-path=${path.join(stateDir,'dht.dat')}`,
    `--max-overall-upload-limit=${upload}`,`--max-overall-download-limit=${rate(downloadLimit)}`,
    '--allow-overwrite=false','--auto-file-renaming=false','--file-allocation=none','--auto-save-interval=30','--max-concurrent-downloads=8'
  ]);
}
// A plain file of at most `cap` bytes, checked and read through one open
// handle, so what is checked is what is read.
const MAX_METADATA=10*1024*1024;
async function readSmallFile(file,cap){
  let handle;
  try{handle=await fs.promises.open(file,'r');}catch{throw new Error(MESSAGES.stopped);}
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>cap)throw new Error(MESSAGES.stopped);
    const buffer=Buffer.alloc(cap+1);let length=0;
    for(;;){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;if(length>cap)throw new Error(MESSAGES.stopped);}
    return buffer.subarray(0,length);
  }finally{await handle.close().catch(()=>{});}
}
// The fixed message for an aria2 error number.
function errorMessage(code){
  const value=String(code??'');
  if(SPACE_CODES.has(value))return MESSAGES.space;
  if(WRITE_CODES.has(value))return MESSAGES.write;
  return MESSAGES.failed;
}
const number=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0;};
function abortError(signal){return signal?.reason instanceof Error?signal.reason:Object.assign(new Error('The operation was aborted.'),{name:'AbortError'});}
async function readLimited(response,cap){
  const reader=response.body?.getReader();if(!reader)return '';
  const parts=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>cap)throw new Error(MESSAGES.stopped);parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).toString('utf8');
}
// aria2 writes paths with "/" on Windows, after the folder it was given.
const ariaPath=(dir,relative)=>(dir+'/'+relative).replace(/\\/g,'/');
// Checks aria2's view of a torrent's files against the list Ravenshelf read
// and showed: the same files, numbered the same way, at the same places inside
// the download's folder, with the same choice of files to download.
function sameFiles(answer,expected,dir,selected){
  if(!Array.isArray(answer)||answer.length!==expected.length)return false;
  const wanted=new Set(selected);
  return expected.every((file,i)=>{
    const got=answer[i];
    return got&&String(got.index)===String(file.index)&&got.path===ariaPath(dir,file.path)&&String(got.length)===String(file.length)&&
      String(got.selected)===String(wanted.has(file.index));
  });
}
// "1,3-5" for files 1, 3, 4 and 5.
function selection(indexes){
  const sorted=[...new Set(indexes)].filter(n=>Number.isSafeInteger(n)&&n>0).sort((a,b)=>a-b),ranges=[];
  for(const n of sorted){const last=ranges.at(-1);if(last&&n===last[1]+1)last[1]=n;else ranges.push([n,n]);}
  return ranges.map(([a,b])=>a===b?String(a):`${a}-${b}`).join(',');
}

class TorrentEngine{
  constructor({tools,stateDir,settings=()=>({}),spawnImpl=spawn,rpcFetch=globalThis.fetch,kill=killTree,appPid=process.pid,env=process.env,
    randomPort=()=>crypto.randomInt(49152,65535),pollMs=POLL_MS,idleMs=IDLE_MS,startTimeoutMs=START_TIMEOUT_MS,metadataTimeoutMs=METADATA_TIMEOUT_MS}={}){
    if(typeof stateDir!=='string'||!path.isAbsolute(stateDir))throw new Error(MESSAGES.start);
    Object.assign(this,{tools,stateDir,settings,spawnImpl,rpcFetch,kill,appPid,env,randomPort,pollMs,idleMs,startTimeoutMs,metadataTimeoutMs});
    this.child=null;this.port=0;this.secret='';this.starting=null;this.stopping=null;this.users=0;this.idleTimer=null;this.seq=0;this.closed=false;
  }
  get running(){return Boolean(this.child&&this.child.exitCode===null&&this.child.signalCode===null);}
  async start(){
    if(this.closed)throw new Error(MESSAGES.start);
    // A stop under way (the idle stop, for example) finishes first; aria2 then starts again.
    if(this.stopping)await this.stopping;
    if(this.closed)throw new Error(MESSAGES.start);
    if(this.running&&this.port)return;
    if(!this.starting)this.starting=this.launch().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async launch(){
    const paths=await this.tools.verified();
    await fs.promises.mkdir(this.stateDir,{recursive:true});
    const temp=path.join(this.stateDir,'tmp');await fs.promises.mkdir(temp,{recursive:true});
    // aria2 keeps its own DHT node ID in this file. A new one each time it
    // starts keeps other computers from linking this PC across IP addresses.
    await this.forgetDht();
    const {uploadLimit,downloadLimit}=this.settings();
    for(let attempt=0;attempt<3;attempt++){
      const port=this.randomPort(),secret=crypto.randomBytes(32).toString('hex');
      const args=engineArgs({port,secret,appPid:this.appPid,stateDir:this.stateDir,uploadLimit,downloadLimit});
      let child;
      try{child=this.spawnImpl(paths.aria2c,args,{cwd:temp,env:engineEnv(this.env,temp),windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']});}
      catch{throw new Error(MESSAGES.start);}
      let exited=false;
      child.once('exit',()=>{exited=true;if(this.child===child){this.child=null;this.port=0;this.secret='';if(!this.starting||this.stopping)this.forgetDht().catch(()=>{});}});
      child.once('error',()=>{exited=true;});
      this.child=child;this.port=port;this.secret=secret;
      const deadline=Date.now()+this.startTimeoutMs;
      while(!exited&&Date.now()<deadline){
        try{await this.rpc('getVersion');return;}catch{}
        await delay(100);
      }
      await this.kill(child).catch(()=>{});
      if(this.child===child){this.child=null;this.port=0;this.secret='';}
    }
    throw new Error(MESSAGES.start);
  }
  // One JSON-RPC call; the secret goes first, as aria2 asks.
  async rpc(method,params=[],signal){
    if(!this.child||!this.port)throw new Error(MESSAGES.stopped);
    const body=JSON.stringify({jsonrpc:'2.0',id:String(++this.seq),method:'aria2.'+method,params:['token:'+this.secret,...params]});
    const timeout=AbortSignal.timeout(RPC_TIMEOUT_MS),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;
    try{response=await this.rpcFetch(`http://127.0.0.1:${this.port}/jsonrpc`,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:combined,redirect:'error'});}
    catch(error){if(signal?.aborted)throw abortError(signal);throw new Error(MESSAGES.stopped,{cause:error});}
    let data;
    try{data=JSON.parse(await readLimited(response,MAX_ANSWER));}catch{throw new Error(MESSAGES.stopped);}
    if(!data||typeof data!=='object')throw new Error(MESSAGES.stopped);
    if(data.error){const error=new Error(MESSAGES.failed);error.rpcCode=Number(data.error.code)||0;throw error;}
    return data.result;
  }
  // Keeps aria2 running while something uses it, and stops it a minute after
  // the last use, so it does not keep listening for peers in the background.
  async use(work){
    this.users++;clearTimeout(this.idleTimer);this.idleTimer=null;
    try{await this.start();return await work();}
    finally{
      this.users--;
      if(!this.users&&!this.closed){this.idleTimer=setTimeout(()=>{if(!this.users)this.stop().catch(()=>{});},this.idleMs);this.idleTimer.unref?.();}
    }
  }
  async wait(signal){
    try{await delay(this.pollMs,undefined,{signal});}catch{throw abortError(signal);}
  }
  async status(gid,signal){
    const status=await this.rpc('tellStatus',[gid,STATUS_KEYS],signal);
    if(!status||typeof status!=='object')throw new Error(MESSAGES.stopped);
    return status;
  }
  async drop(gid,stop){
    if(!this.running)return;
    // At most five seconds in all, each call one second, so a hung aria2 is stopped soon.
    const deadline=Date.now()+DROP_MS,quick=()=>AbortSignal.timeout(1000);
    if(stop)await this.rpc('forceRemove',[gid],quick()).catch(()=>{});
    while(Date.now()<deadline){
      try{await this.rpc('removeDownloadResult',[gid],quick());return true;}
      catch(error){if(!Number.isInteger(error?.rpcCode)||!this.running)break;await delay(100);}
    }
    // aria2 would not let go of it (still downloading or sharing): stopping
    // aria2 itself is the only sure way to end the uploading.
    if(stop)await this.stop();
    return false;
  }
  // The .torrent file for a magnet link, fetched from other people. Only the
  // file list is fetched here; nothing of the torrent's contents.
  async metadata(parsed,{signal,onStatus=()=>{}}={}){
    return this.use(async()=>{
      const dir=path.join(this.stateDir,'metadata',crypto.randomUUID());
      await fs.promises.mkdir(dir,{recursive:true});
      let gid=null,done=false;
      try{
        gid=await this.rpc('addUri',[[parsed.magnet],{dir,'bt-metadata-only':'true','bt-save-metadata':'true','follow-torrent':'false','seed-time':'0'}],signal);
        if(typeof gid!=='string'||!/^[0-9a-f]{16}$/i.test(gid))throw new Error(MESSAGES.stopped);
        const deadline=Date.now()+this.metadataTimeoutMs;
        for(;;){
          const status=await this.status(gid,signal);
          if(status.status==='complete'){done=true;break;}
          if(status.status==='error')throw new Error(errorMessage(status.errorCode));
          if(status.status==='removed')throw new Error(MESSAGES.stopped);
          try{onStatus({peers:number(status.connections)});}catch{}
          if(Date.now()>deadline)throw new Error(MESSAGES.noPeers);
          await this.wait(signal);
        }
        const buffer=await readSmallFile(path.join(dir,parsed.infoHash+'.torrent'),MAX_METADATA);
        readTorrent(buffer,parsed.infoHash);
        return buffer;
      }finally{
        if(gid)await this.drop(gid,!done);
        await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
      }
    });
  }
  // Downloads the chosen files of a torrent into `dir`. Returns when they are
  // complete (after the chosen sharing time), or throws when stopped first. A
  // stop during sharing still counts as complete: the files are all there.
  async download({torrent,infoHash,files,selected,dir,resume=false,shareMinutes=0},{signal,onProgress=()=>{},onSharing=()=>{}}={}){
    return this.use(async()=>{
      const read=readTorrent(torrent,infoHash);
      if(read.files.length!==files.length||read.files.some((file,i)=>file.path!==files[i].path||file.length!==files[i].length))throw new Error(MESSAGES.changed);
      const select=selection(selected);if(!select)throw new Error(MESSAGES.changed);
      const minutes=[0,15,60].includes(shareMinutes)?shareMinutes:0;
      // aria2 resumes from its own progress file. Files without one (Ravenshelf
      // or Windows stopped before it was saved) are checked piece by piece first.
      const progressFile=await fs.promises.lstat(path.join(dir,read.name+'.aria2')).then(stat=>stat.isFile(),()=>false);
      const options={dir,'select-file':select,'seed-time':String(minutes),pause:'true','check-integrity':resume&&!progressFile?'true':'false',
        'bt-remove-unselected-file':'false','allow-overwrite':'false','auto-file-renaming':'false','follow-torrent':'false'};
      const gid=await this.rpc('addTorrent',[torrent.toString('base64'),[],options],signal);
      if(typeof gid!=='string'||!/^[0-9a-f]{16}$/i.test(gid))throw new Error(MESSAGES.stopped);
      let finished=false,sharing=false,interrupted=false;
      try{
        // Nothing is written before aria2's file list is checked.
        if(!sameFiles(await this.rpc('getFiles',[gid],signal),files,dir,selected))throw new Error(MESSAGES.changed);
        await this.rpc('unpause',[gid],signal);
        for(;;){
          let status;
          try{status=await this.status(gid,signal);}catch(error){if(sharing&&signal?.aborted){finished=interrupted=true;return {complete:true,interrupted:true};}throw error;}
          if(status.status==='complete'){finished=true;return {complete:true,interrupted:false};}
          if(status.status==='error')throw new Error(errorMessage(status.errorCode));
          if(status.status==='removed')throw new Error(MESSAGES.stopped);
          const total=number(status.totalLength),done=number(status.completedLength);
          try{onProgress({received:done,total,speed:number(status.downloadSpeed),uploadSpeed:number(status.uploadSpeed),uploaded:number(status.uploadLength),peers:number(status.connections)});}catch{}
          if(!sharing&&minutes>0&&status.seeder==='true'&&total>0&&done===total){sharing=true;try{onSharing(minutes);}catch{}}
          try{await this.wait(signal);}
          catch(error){if(sharing){finished=interrupted=true;return {complete:true,interrupted:true};}throw error;}
        }
      // Stopped while sharing: aria2 still shares the torrent, so it is removed
      // (which ends the uploading and closes its files) before anything else.
      }finally{await this.drop(gid,!finished||interrupted);}
    });
  }
  async stop(){
    clearTimeout(this.idleTimer);this.idleTimer=null;
    if(this.stopping)return this.stopping;
    this.stopping=this.performStop().finally(()=>{this.stopping=null;});
    return this.stopping;
  }
  async performStop(){
    const child=this.child;if(!child)return;
    try{await this.rpc('shutdown');}catch{}
    for(let i=0;i<30&&this.child===child&&child.exitCode===null&&child.signalCode===null;i++)await delay(100);
    if(child.exitCode===null&&child.signalCode===null)await this.kill(child).catch(()=>{});
    if(this.child===child){this.child=null;this.port=0;this.secret='';}
    if(!this.child)await this.forgetDht();
  }
  async forgetDht(){
    let names=[];try{names=await fs.promises.readdir(this.stateDir);}catch{return;}
    // dht.dat and the temporary copy aria2 writes before replacing it.
    for(const name of names)if(name.startsWith('dht.dat'))await fs.promises.rm(path.join(this.stateDir,name),{force:true}).catch(()=>{});
  }
  async dispose(){this.closed=true;await this.starting?.catch(()=>{});await this.stop();}
}

module.exports={TorrentEngine,MESSAGES,engineArgs,engineEnv,errorMessage,sameFiles,selection,ariaPath};
