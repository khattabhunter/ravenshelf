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
const dns=require('node:dns');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {readTorrent,parseMagnet,sanitizeTorrent}=require('./magnet.cjs');
const {isPublicIP}=require('./net.cjs');
const {openDownloadFile}=require('./download-file.cjs');

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
const DROP_MS=5000,STOP_RESERVE_MS=2500,PREFLIGHT_MS=3000,LOOKUP_SLOTS=2,MAX_LAUNCHES=3,START_TIMEOUT_MS=15000,RPC_TIMEOUT_MS=15000,MAX_ANSWER=8*1024*1024,METADATA_TIMEOUT_MS=10*60*1000,IDLE_MS=60*1000,POLL_MS=1000;
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
  let opened;
  try{opened=await openDownloadFile(file,{readOnly:true});}catch{throw new Error(MESSAGES.stopped);}
  try{
    if(opened.size>cap)throw new Error(MESSAGES.stopped);
    const buffer=Buffer.alloc(cap+1);let length=0;
    for(;;){const {bytesRead}=await opened.handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;if(length>cap)throw new Error(MESSAGES.stopped);}
    await opened.verifyUnchanged();
    return buffer.subarray(0,length);
  }catch{throw new Error(MESSAGES.stopped);}
  finally{await opened.handle.close().catch(()=>{});}
}
const readMetadataFile=file=>readSmallFile(file,MAX_METADATA);
// The fixed message for an aria2 error number.
function errorMessage(code){
  const value=String(code??'');
  if(SPACE_CODES.has(value))return MESSAGES.space;
  if(WRITE_CODES.has(value))return MESSAGES.write;
  return MESSAGES.failed;
}
const number=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0;};
function abortError(signal){return signal?.reason instanceof Error?signal.reason:Object.assign(new Error('The operation was aborted.'),{name:'AbortError'});}
// Bound the complete operation, including response bodies and cleanup, even
// when a dependency does not honour AbortSignal. Its late rejection is handled.
async function until(promise,deadline,signal){
  let timer,onAbort;
  try{
    return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{
      const fail=()=>reject(new Error(MESSAGES.stopped));
      timer=setTimeout(fail,Math.max(0,deadline-Date.now()));
      if(signal){onAbort=()=>reject(abortError(signal));if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});}
    })]);
  }finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
}
// Waits for `promise`, or rejects as soon as `signal` aborts. The promise
// itself carries on, for anyone else waiting on it.
function abortable(promise,signal){
  if(!signal)return promise;
  let onAbort;
  return Promise.race([promise,new Promise((_,reject)=>{onAbort=()=>reject(abortError(signal));if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});})])
    .finally(()=>signal.removeEventListener('abort',onAbort));
}
// aria2 has no subprocess hooks in our fixed configuration. Terminate its
// exact child directly instead of waiting on taskkill's separate 15s timeout.
async function killEngine(child){if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
// Tracker names are looked up with Windows' own resolver (its hosts file,
// cache, encrypted DNS and VPN rules), for IPv4 addresses only: aria2 runs
// without IPv6. (aria2 then makes its own lookups.) Those lookups use the small thread pool that file
// reads and writes share, so at most two run at a time, across all checks, and
// a place is given back only when its lookup has really ended.
function createSystemLookup({lookupImpl=dns.promises.lookup,slots=LOOKUP_SLOTS}={}){
  let free=slots;const queue=[],inflight=new Map();
  const take=()=>free>0?(free--,Promise.resolve()):new Promise(resolve=>queue.push(resolve));
  const give=()=>{const next=queue.shift();if(next)next();else free++;};
  const lookup=(host,{signal}={})=>{
    if(signal?.aborted)return Promise.reject(abortError(signal));
    // A name already being looked up, or waiting for a place, for this or
    // another check, is joined rather than asked again.
    if(inflight.has(host))return inflight.get(host);
    const job=(async()=>{
      await take();
      try{
        if(signal?.aborted)throw abortError(signal);
        return await lookupImpl(host,{all:true,family:4,verbatim:true});
      }finally{give();}
    })();
    inflight.set(host,job);
    const forget=()=>{if(inflight.get(host)===job)inflight.delete(host);};
    job.then(forget,forget);
    return job;
  };
  lookup.busy=()=>slots-free;
  return lookup;
}
const systemLookup=createSystemLookup();
// A preflight only: aria2 performs its own DNS lookup later. This drops
// trackers whose IPv4 answers are private, mixed or missing, or that are not
// answered within a few seconds. It is not socket-level enforcement, a
// DNS-rebinding defence, or a VPN kill switch.
async function publicMagnet(value,{lookup=systemLookup,signal,timeoutMs=PREFLIGHT_MS}={}){
  signal?.throwIfAborted();
  const parsed=parseMagnet(value),answers=new Map();
  // One end for the whole check: its time limit, or the caller giving up.
  const end=new AbortController(),ended=new Promise(resolve=>end.signal.addEventListener('abort',()=>resolve(false),{once:true}));
  const timer=setTimeout(()=>end.abort(new Error(MESSAGES.stopped)),timeoutMs),onAbort=()=>end.abort(abortError(signal));
  signal?.addEventListener('abort',onAbort,{once:true});
  let keep;
  try{
    keep=await Promise.all(parsed.trackers.map(async tracker=>{
      const host=new URL('http://'+new URL(tracker).host).hostname.replace(/^\[|\]$/g,'');
      if(net.isIP(host))return net.isIPv4(host)&&isPublicIP(host);
      if(!answers.has(host))answers.set(host,Promise.race([ended,Promise.resolve().then(()=>lookup(host,{all:true,family:4,signal:end.signal}))
        .then(records=>{const ipv4=Array.isArray(records)?records.filter(record=>net.isIPv4(String(record?.address??''))):[];return ipv4.length>0&&ipv4.every(record=>isPublicIP(record.address));},()=>false)]));
      return answers.get(host);
    }));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);end.abort();}
  signal?.throwIfAborted();
  return parseMagnet('magnet:?xt=urn:btih:'+parsed.infoHash+(parsed.name?'&dn='+encodeURIComponent(parsed.name):'')+parsed.trackers.filter((_,index)=>keep[index]).map(tracker=>'&tr='+encodeURIComponent(tracker)).join(''));
}
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
  constructor({tools,stateDir,settings=()=>({}),spawnImpl=spawn,rpcFetch=globalThis.fetch,kill=killEngine,lookup=systemLookup,appPid=process.pid,env=process.env,
    randomPort=()=>crypto.randomInt(49152,65535),pollMs=POLL_MS,idleMs=IDLE_MS,startTimeoutMs=START_TIMEOUT_MS,metadataTimeoutMs=METADATA_TIMEOUT_MS,preflightMs=PREFLIGHT_MS}={}){
    if(typeof stateDir!=='string'||!path.isAbsolute(stateDir))throw new Error(MESSAGES.start);
    Object.assign(this,{tools,stateDir,settings,spawnImpl,rpcFetch,kill,lookup,appPid,env,randomPort,pollMs,idleMs,startTimeoutMs,metadataTimeoutMs,preflightMs});
    this.child=null;this.port=0;this.secret='';this.starting=null;this.stopping=null;this.cleaning=null;this.terminationFailed=false;this.users=0;this.idleTimer=null;this.seq=0;this.closed=false;
    // Each stop() ends a start that is still under way instead of retrying it.
    this.stops=0;this.launchAbort=null;
  }
  get running(){return Boolean(this.child&&this.child.exitCode===null&&this.child.signalCode===null);}
  async start(signal){
    // A start that aria2 keeps leaving right after it answered is not retried for ever.
    for(let launches=0;;){
      if(this.closed)throw new Error(MESSAGES.start);
      signal?.throwIfAborted();
      // Every wait can change the lifecycle. Check it again before accepting
      // the child, and share its readiness probe with concurrent callers.
      if(this.stopping){await abortable(this.stopping.catch(()=>{}),signal);continue;}
      if(this.terminationFailed)throw new Error(MESSAGES.stopped);
      if(this.cleaning){await abortable(until(this.cleaning,Date.now()+this.startTimeoutMs),signal);continue;}
      // A child that is running but has not answered yet is not ready: wait
      // for the start under way (ours or another caller's) to finish.
      if(!this.starting&&this.running&&this.port)return;
      if(++launches>MAX_LAUNCHES)throw new Error(MESSAGES.start);
      if(!this.starting){this.starting=this.launch().finally(()=>{this.starting=null;});this.starting.catch(()=>{});}
      await abortable(this.starting,signal);
    }
  }
  async launch(){
    const stops=this.stops,cancelled=()=>this.closed||this.stops!==stops;
    const paths=await this.tools.verified();
    await fs.promises.mkdir(this.stateDir,{recursive:true});
    const temp=path.join(this.stateDir,'tmp');await fs.promises.mkdir(temp,{recursive:true});
    // aria2 keeps its own DHT node ID in this file. A new one each time it
    // starts keeps other computers from linking this PC across IP addresses.
    await this.forgetDht();
    const {uploadLimit,downloadLimit}=this.settings();
    for(let attempt=0;attempt<3;attempt++){
      if(cancelled())throw new Error(MESSAGES.start);
      const port=this.randomPort(),secret=crypto.randomBytes(32).toString('hex');
      const args=engineArgs({port,secret,appPid:this.appPid,stateDir:this.stateDir,uploadLimit,downloadLimit});
      let child;
      try{child=this.spawnImpl(paths.aria2c,args,{cwd:temp,env:engineEnv(this.env,temp),windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']});}
      catch{throw new Error(MESSAGES.start);}
      let exited=false;
      // Once the OS reports this child gone, an earlier failed stop no longer blocks a new start.
      child.once('exit',()=>{exited=true;if(this.child===child){this.child=null;this.port=0;this.secret='';this.terminationFailed=false;if(!this.starting||this.stopping)this.forgetDht().catch(()=>{});}});
      child.once('error',()=>{exited=true;if(!child.pid&&this.child===child){this.child=null;this.port=0;this.secret='';}});
      this.child=child;this.port=port;this.secret=secret;
      const deadline=Date.now()+this.startTimeoutMs,probe=new AbortController();this.launchAbort=probe;
      try{
        while(!exited&&!probe.signal.aborted&&Date.now()<deadline){
          let ready=false;
          try{await until(this.rpc('getVersion',[],AbortSignal.any([probe.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])),deadline,probe.signal);ready=true;}catch{}
          if(ready){
            // A stop that came while aria2 answered still ends this start.
            if(cancelled()){await this.halt();throw new Error(MESSAGES.start);}
            return;
          }
          if(Date.now()<deadline&&!probe.signal.aborted)await delay(Math.min(100,deadline-Date.now()));
        }
      }finally{if(this.launchAbort===probe)this.launchAbort=null;}
      // A failed probe does not prove aria2 failed to start. Use the same
      // bounded, confirmed termination as a user stop before retrying a port.
      // Failure retains the live handle and aborts the retry loop.
      await this.halt();
      if(cancelled())throw new Error(MESSAGES.start);
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
  async use(work,signal){
    this.users++;clearTimeout(this.idleTimer);this.idleTimer=null;
    try{await this.start(signal);return await work();}
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
  // `owner` is the aria2 that holds `gid`. After it has gone, nothing is left
  // to remove, and a newer aria2 (perhaps still starting for someone else) is not touched.
  async drop(gid,stop,owner=this.child){
    const mine=()=>this.running&&this.child===owner;
    if(!mine())return;
    // One total deadline includes fallback shutdown, process termination and
    // cleanup. Reserve time for those instead of starting another 15s RPC.
    const deadline=Date.now()+DROP_MS,removeUntil=deadline-STOP_RESERVE_MS,quick=()=>AbortSignal.timeout(Math.max(1,Math.min(1000,removeUntil-Date.now())));
    if(stop)await until(this.rpc('forceRemove',[gid],quick()),Math.min(removeUntil,Date.now()+1000)).catch(()=>{});
    // Checked before every request: if this aria2 leaves meanwhile, the job went with it.
    while(Date.now()<removeUntil){
      if(!mine())return false;
      try{await until(this.rpc('removeDownloadResult',[gid],quick()),Math.min(removeUntil,Date.now()+1000));return true;}
      catch(error){if(!Number.isInteger(error?.rpcCode)||!mine())break;await delay(100);}
    }
    // aria2 would not let go of it (still downloading or sharing): stopping
    // aria2 itself is the only sure way to end the uploading.
    if(stop&&mine())await this.stop(deadline);
    return false;
  }
  // The .torrent file for a magnet link, fetched from other people. Only the
  // file list is fetched here; nothing of the torrent's contents.
  async metadata(parsed,{signal,onStatus=()=>{}}={}){
    parsed=await publicMagnet(parsed.magnet,{lookup:this.lookup,signal,timeoutMs:this.preflightMs});
    return this.use(async()=>{
      const dir=path.join(this.stateDir,'metadata',crypto.randomUUID());
      await fs.promises.mkdir(dir,{recursive:true});
      let gid=null,done=false,failed=false;const owner=this.child;
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
        const buffer=await readMetadataFile(path.join(dir,parsed.infoHash+'.torrent'));
        return sanitizeTorrent(buffer,parsed.infoHash,parsed.trackers);
      }catch(error){failed=true;throw error;}
      // The folder goes even when aria2 cannot be stopped, and the reason the
      // search failed is the one reported.
      finally{
        try{if(gid)await this.drop(gid,!done,owner);}
        catch(error){if(!failed)throw error;}
        finally{await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:2}).catch(()=>{});}
      }
    },signal);
  }
  // Downloads the chosen files of a torrent into `dir`. Returns when they are
  // complete (after the chosen sharing time), or throws when stopped first. A
  // stop during sharing still counts as complete: the files are all there.
  async download({torrent,infoHash,magnet,files,selected,dir,resume=false,shareMinutes=0},{signal,onProgress=()=>{},onSharing=()=>{}}={}){
    const parsed=await publicMagnet(magnet||'magnet:?xt=urn:btih:'+infoHash,{lookup:this.lookup,signal,timeoutMs:this.preflightMs});
    if(parsed.infoHash!==infoHash)throw new Error(MESSAGES.changed);
    torrent=sanitizeTorrent(torrent,infoHash,parsed.trackers);
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
      const owner=this.child,gid=await this.rpc('addTorrent',[torrent.toString('base64'),[],options],signal);
      if(typeof gid!=='string'||!/^[0-9a-f]{16}$/i.test(gid))throw new Error(MESSAGES.stopped);
      let finished=false,sharing=false,interrupted=false,failure=null;
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
      }catch(error){failure=error;throw error;}
      // Stopped while sharing: aria2 still shares the torrent, so it is removed
      // (which ends the uploading and closes its files) before anything else.
      // When aria2 cannot be stopped that is reported, unless the download had
      // already failed for another reason, which then stays the reason given.
      finally{try{await this.drop(gid,!finished||interrupted,owner);}catch(error){if(!failure)throw error;}}
    },signal);
  }
  // A stop also ends a start that is still under way.
  async stop(deadline=Date.now()+DROP_MS){
    this.stops++;this.launchAbort?.abort();
    clearTimeout(this.idleTimer);this.idleTimer=null;
    return this.halt(deadline);
  }
  // Stops the current aria2 without ending a start under way. The idle timer
  // stays, so an aria2 that a later attempt starts with nobody using it still stops.
  async halt(deadline=Date.now()+DROP_MS){
    if(this.stopping)return this.stopping;
    this.stopping=this.performStop(deadline).finally(()=>{this.stopping=null;});
    return this.stopping;
  }
  async performStop(deadline){
    const child=this.child;if(!child){this.terminationFailed=false;if(this.cleaning)await until(this.cleaning,deadline);return;}
    const alive=()=>child.exitCode===null&&child.signalCode===null;
    const graceful=Math.min(Date.now()+500,deadline-1000);
    if(graceful>Date.now())try{await until(this.rpc('shutdown',[],AbortSignal.timeout(Math.max(1,graceful-Date.now()))),graceful);}catch{}
    const grace=Math.min(Date.now()+250,deadline-750);
    while(alive()&&Date.now()<grace)await delay(25);
    if(alive()){
      try{await until(Promise.resolve().then(()=>this.kill(child)),deadline-250);}catch{}
      while(alive()&&Date.now()<deadline-250)await delay(25);
      // Do not report stopped, publish completed files, or start a second
      // engine if the OS has not confirmed termination of this child.
      if(alive()){this.terminationFailed=true;throw new Error(MESSAGES.stopped);}
    }
    this.terminationFailed=false;
    if(this.child===child){this.child=null;this.port=0;this.secret='';}
    if(!this.child)await until(this.forgetDht(),deadline);
  }
  async forgetDht(){
    if(!this.cleaning)this.cleaning=this.cleanDht().finally(()=>{this.cleaning=null;});
    return this.cleaning;
  }
  async cleanDht(){
    let names=[];try{names=await fs.promises.readdir(this.stateDir);}catch{return;}
    // dht.dat and the temporary copy aria2 writes before replacing it.
    for(const name of names)if(name.startsWith('dht.dat'))await fs.promises.rm(path.join(this.stateDir,name),{force:true}).catch(()=>{});
  }
  async dispose(){this.closed=true;const starting=this.starting;await this.stop().catch(()=>{});await starting?.catch(()=>{});await this.stop();}
}

module.exports={TorrentEngine,MESSAGES,engineArgs,engineEnv,errorMessage,sameFiles,selection,ariaPath,publicMagnet,createSystemLookup,readMetadataFile};
