'use strict';
// The helper programs Ravenshelf uses for YouTube downloads: yt-dlp, the Deno
// JavaScript runtime yt-dlp needs for YouTube, and FFmpeg to join video and
// audio. Nothing is downloaded until the user chooses Set up. Each file comes
// from its publisher's GitHub release at a fixed version and must match the
// size and SHA-256 recorded here, archives and the programs inside them alike.
// The installed programs are checked again before their first use in each
// session. Like the other file checks in Ravenshelf, this finds damaged or
// replaced files; it is not isolation from malware already running as the
// same Windows user.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const {safeFetch}=require('./net.cjs');
const {openDownloadFile}=require('./download-file.cjs');

const MESSAGES=Object.freeze({
  setup:'Set up YouTube downloads in Settings first, then retry.',
  damaged:'The YouTube helper programs changed or are damaged. Set up YouTube downloads again in Settings.',
  running:'The YouTube helper programs are being set up. Wait for setup to finish.',
  busy:'Pause YouTube downloads before removing the helper programs.',
  unsupported:'YouTube downloads are available in Ravenshelf on Windows.',
  failed:'The YouTube helper programs could not be downloaded or verified. Nothing was installed. Try again later.',
  cancelled:'Setup was cancelled. Nothing was installed.',
  unreadable:'The YouTube helper programs could not be checked right now. Try again in a moment.'
});
// Pinned releases. Updating one means changing its version, address, size and
// hashes together; the install folder name follows from this list, so a new
// set never mixes with an older one.
const TOOLS=Object.freeze([
  Object.freeze({id:'yt-dlp',name:'yt-dlp',version:'2026.10.26',license:'Unlicense',source:'github.com/yt-dlp/yt-dlp',
    url:'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe',size:23575744,sha256:'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
    files:Object.freeze([Object.freeze({role:'ytDlp',name:'yt-dlp.exe',size:23575744,sha256:'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'})])}),
  Object.freeze({id:'deno',name:'Deno',version:'2.9.8',license:'MIT',source:'github.com/denoland/deno',archive:'zip',
    url:'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip',size:42917472,sha256:'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf',
    files:Object.freeze([Object.freeze({role:'deno',entry:'deno.exe',name:'deno.exe',size:98081568,sha256:'924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266'})])}),
  Object.freeze({id:'ffmpeg',name:'FFmpeg',version:'8.1.2',license:'GPL-3.0 (essentials build by Gyan Doshi)',source:'github.com/GyanD/codexffmpeg',archive:'zip',
    url:'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',size:109728040,sha256:'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
    files:Object.freeze([
      Object.freeze({role:'ffmpeg',entry:'ffmpeg-8.1.2-essentials_build/bin/ffmpeg.exe',name:'ffmpeg.exe',size:101897728,sha256:'1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e'}),
      Object.freeze({role:'ffprobe',entry:'ffmpeg-8.1.2-essentials_build/bin/ffprobe.exe',name:'ffprobe.exe',size:101692928,sha256:'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07'})
    ])})
]);
const CDN=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
const SET_NAME=/^tools-[a-f0-9]{16}$/,STAGING_NAME=/^\.staging-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARKER='installed.json',STALL_MS=60000,SPACE_MARGIN=64*1024*1024,MAX_CENTRAL_DIRECTORY=16*1024*1024;
// Downloads arrive in 2 MB parts over up to 8 connections, as in Ravenshelf's
// own downloads: on some connections a single link to GitHub's file servers
// stays at a few KB/s. A part with no data for 20 seconds is asked for again;
// near the end, a part still running after 6 seconds gets one extra connection
// and the first copy to arrive is kept. The whole file is checked afterwards.
const PART_SIZE=2*1024*1024,CONNECTIONS=8,PART_STALL_MS=20000,RACE_AFTER_MS=6000,PART_TRIES=6,RETRY_DELAY_MS=500;
const ROLES=['ytDlp','deno','ffmpeg','ffprobe'];

const setName=tools=>'tools-'+crypto.createHash('sha256').update(JSON.stringify(tools)).digest('hex').slice(0,16);
const allFiles=tools=>tools.flatMap(tool=>tool.files);
const totalDownload=tools=>tools.reduce((sum,tool)=>sum+tool.size,0);
const totalDisk=tools=>allFiles(tools).reduce((sum,file)=>sum+file.size,0);
function badArchive(){return new Error(MESSAGES.failed);}

// CRC-32 for zip entries; zlib.crc32 where the runtime has it.
let crcTable=null;
function crc32(chunk,previous=0){
  if(typeof zlib.crc32==='function')return zlib.crc32(chunk,previous);
  if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}}
  let crc=(previous^0xffffffff)>>>0;
  for(const byte of chunk)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
async function readExactly(handle,buffer,position){
  let offset=0;
  while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,position+offset);if(!bytesRead)throw badArchive();offset+=bytesRead;}
  return buffer;
}
// Reads the central directory of a plain (not ZIP64, not encrypted) archive.
async function readZipDirectory(handle,size){
  const tailLength=Math.min(size,22+65535),tail=await readExactly(handle,Buffer.alloc(tailLength),size-tailLength);
  let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0)throw badArchive();
  const disk=tail.readUInt16LE(end+4),directoryDisk=tail.readUInt16LE(end+6),here=tail.readUInt16LE(end+8),count=tail.readUInt16LE(end+10);
  const directorySize=tail.readUInt32LE(end+12),directoryOffset=tail.readUInt32LE(end+16),endOffset=size-tailLength+end;
  if(disk||directoryDisk||here!==count||count===0xffff||directorySize===0xffffffff||directoryOffset===0xffffffff||directorySize>MAX_CENTRAL_DIRECTORY||directoryOffset+directorySize!==endOffset)throw badArchive();
  const directory=await readExactly(handle,Buffer.alloc(directorySize),directoryOffset);
  const records=new Map(),repeated=new Set();let position=0;
  for(let n=0;n<count;n++){
    if(position+46>directory.length||directory.readUInt32LE(position)!==0x02014b50)throw badArchive();
    const nameLength=directory.readUInt16LE(position+28),extraLength=directory.readUInt16LE(position+30),commentLength=directory.readUInt16LE(position+32);
    const next=position+46+nameLength+extraLength+commentLength;if(next>directory.length)throw badArchive();
    const name=directory.subarray(position+46,position+46+nameLength).toString('latin1');
    const record={flags:directory.readUInt16LE(position+8),method:directory.readUInt16LE(position+10),crc:directory.readUInt32LE(position+16),
      compressed:directory.readUInt32LE(position+20),uncompressed:directory.readUInt32LE(position+24),offset:directory.readUInt32LE(position+42)};
    if(records.has(name))repeated.add(name);else records.set(name,record);
    position=next;
  }
  if(position!==directory.length)throw badArchive();
  return {records,repeated,directoryOffset};
}
// Extracts exactly the named entries, each to a new file, checking the zip's
// CRC-32 and the pinned size and SHA-256. Entry names come from the pinned
// list, never from the archive, so nothing can be written anywhere else.
async function extractZipEntries(zipPath,wanted,{signal}={}){
  const handle=await fs.promises.open(zipPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const {size}=await handle.stat();
    const {records,repeated,directoryOffset}=await readZipDirectory(handle,size);
    for(const want of wanted){
      signal?.throwIfAborted();
      const record=records.get(want.entry);
      if(!record||repeated.has(want.entry)||record.flags&0x1||![0,8].includes(record.method)||record.uncompressed!==want.size||!record.compressed||(record.method===0&&record.compressed!==want.size))throw badArchive();
      const local=await readExactly(handle,Buffer.alloc(30),record.offset);
      if(local.readUInt32LE(0)!==0x04034b50)throw badArchive();
      const nameLength=local.readUInt16LE(26),extraLength=local.readUInt16LE(28);
      const localName=await readExactly(handle,Buffer.alloc(nameLength),record.offset+30);
      const start=record.offset+30+nameLength+extraLength;
      if(localName.toString('latin1')!==want.entry||start+record.compressed>directoryOffset)throw badArchive();
      await inflateEntry(handle,start,record,want,signal);
    }
  }finally{await handle.close();}
}
async function inflateEntry(handle,start,record,want,signal){
  const target=await openDownloadFile(want.target,{create:true});
  let written=0,crc=0,closed=false;const hash=crypto.createHash('sha256');
  try{
    const stages=[handle.createReadStream({start,end:start+record.compressed-1,autoClose:false,highWaterMark:1024*1024})];
    if(record.method===8)stages.push(zlib.createInflateRaw());
    await pipeline(...stages,async function(chunks){
      for await(const chunk of chunks){
        if(written+chunk.length>want.size)throw badArchive();
        hash.update(chunk);crc=crc32(chunk,crc);
        let offset=0;while(offset<chunk.length){const {bytesWritten}=await target.handle.write(chunk,offset,chunk.length-offset,written+offset);if(!bytesWritten)throw badArchive();offset+=bytesWritten;}
        written+=chunk.length;
      }
    },...(signal?[{signal}]:[]));
    if(written!==want.size||(crc>>>0)!==record.crc||hash.digest('hex')!==want.sha256)throw badArchive();
    await target.handle.sync();await target.verify(written);
  }catch(error){
    await target.handle.close().catch(()=>{});closed=true;
    await fs.promises.unlink(want.target).catch(()=>{});
    throw error;
  }finally{if(!closed)await target.handle.close();}
}
async function hashFile(file){
  const hash=crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file,{highWaterMark:1024*1024}),async function(chunks){for await(const chunk of chunks)hash.update(chunk);});
  return hash.digest('hex');
}
// GitHub release downloads: the pinned address on github.com, then GitHub's
// release download hosts only.
async function toolFetch(url,{fetcher,signal,headers={}}){
  let current=new URL(url);
  for(let redirects=0;redirects<6;redirects++){
    if(current.protocol!=='https:'||current.username||current.password||current.port)throw new Error(MESSAGES.failed);
    const allowed=(redirects===0&&current.href===url&&current.hostname==='github.com')||(redirects>0&&CDN.has(current.hostname));
    if(!allowed)throw new Error(MESSAGES.failed);
    const response=await fetcher(current.href,{redirect:'manual',timeoutMs:0,signal,headers:{Accept:'application/octet-stream','Accept-Encoding':'identity',...headers}});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location)throw new Error(MESSAGES.failed);
    current=new URL(location,current);
  }
  throw new Error(MESSAGES.failed);
}
async function writeAt(handle,data,position){
  let offset=0;
  while(offset<data.byteLength){const {bytesWritten}=await handle.write(data,offset,data.byteLength-offset,position+offset);if(!bytesWritten)throw new Error(MESSAGES.failed);offset+=bytesWritten;}
}
// Problems that another try can fix: the connection, a busy or slow server.
function retryable(error){error.retry=true;return error;}
function partAnswer(response){return [403,408,425,429,500,502,503,504].includes(response.status);}
async function hashHandle(handle,size){
  const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let position=0,head=Buffer.alloc(0);
  while(position<size){
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-position),position);
    if(!bytesRead)throw new Error(MESSAGES.failed);
    if(head.length<4)head=Buffer.concat([head,buffer.subarray(0,Math.min(4-head.length,bytesRead))]);
    hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
  }
  return {sha256:hash.digest('hex'),head};
}
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  const stop=()=>{clearTimeout(timer);reject(signal.reason);};
  signal?.addEventListener('abort',stop,{once:true});
});
async function removeDirectory(directory){
  let stat;try{stat=await fs.promises.lstat(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
  // Never follow a link or junction out of the helper folder.
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error(MESSAGES.damaged);
  await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:2});
}
// Antivirus programs often open new programs for a moment just after they are
// written, which can make Windows refuse to rename their folder. Retry briefly.
async function renameDirectory(from,to,{attempts=6,delayMs=250}={}){
  for(let attempt=1;;attempt++){
    try{return await fs.promises.rename(from,to);}
    catch(error){
      if(attempt>=attempts||!['EPERM','EBUSY','EACCES'].includes(error?.code))throw error;
      await new Promise(resolve=>setTimeout(resolve,delayMs*attempt));
    }
  }
}

class MediaTools{
  constructor({root,fetcher=safeFetch,bandwidthLimiter=null,onChange=()=>{},onReady=()=>{},platform=process.platform,tools=TOOLS,stallMs=STALL_MS,
    partSize=PART_SIZE,connections=CONNECTIONS,partStallMs=PART_STALL_MS,raceAfterMs=RACE_AFTER_MS,partTries=PART_TRIES,retryDelayMs=RETRY_DELAY_MS}={}){
    if(typeof root!=='string'||!path.isAbsolute(root))throw new Error(MESSAGES.unsupported);
    Object.assign(this,{root,fetcher,bandwidthLimiter,onChange,onReady,platform,tools,stallMs,partSize,connections,partStallMs,raceAfterMs,partTries,retryDelayMs});
    this.files=allFiles(tools);this.setId=setName(tools);this.dir=path.join(root,this.setId);
    this.cache=path.join(root,'cache');this.temp=path.join(root,'tmp');
    this.state={phase:'missing',progress:0,message:''};
    this.task=null;this.controller=null;this.verifying=null;this.verifiedKey=null;this.disposed=false;this.lastProgress=0;
    this.refresh();
  }
  snapshot(){
    return {...this.state,downloadBytes:totalDownload(this.tools),diskBytes:totalDisk(this.tools),
      tools:this.tools.map(({name,version,license,source})=>({name,version,license,source}))};
  }
  update(patch){Object.assign(this.state,patch);try{this.onChange(this.snapshot());}catch{}}
  // Quick check of what is on disk; the full check runs before first use.
  refresh(){
    if(this.platform!=='win32'){this.state={phase:'unsupported',progress:0,message:MESSAGES.unsupported};return this.state.phase;}
    if(this.task||['damaged','error'].includes(this.state.phase))return this.state.phase;
    this.state={phase:this.installed()?'ready':'missing',progress:0,message:''};
    return this.state.phase;
  }
  installed(){
    try{
      const marker=JSON.parse(fs.readFileSync(path.join(this.dir,MARKER),'utf8'));
      if(marker?.set!==this.setId)return false;
      return this.files.every(file=>{const stat=fs.lstatSync(path.join(this.dir,file.name));return stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.size;});
    }catch{return false;}
  }
  install(){
    if(this.platform!=='win32')throw new Error(MESSAGES.unsupported);
    if(this.disposed)return this.snapshot();
    if(this.task)return this.snapshot();
    if(this.state.phase==='ready'&&this.installed())return this.snapshot();
    this.verifiedKey=null;this.lastProgress=0;
    this.update({phase:'installing',progress:0,message:`Downloading ${this.tools[0]?.name||'helper programs'}…`});
    this.task=this.performInstall().then(()=>{
      this.update({phase:'ready',progress:1,message:''});
      try{this.onReady();}catch{}
    },error=>{
      const cancelled=error?.name==='AbortError'||this.controller?.signal.aborted;
      this.update({phase:cancelled?'missing':'error',progress:0,message:cancelled?MESSAGES.cancelled:(error?.code==='ENOSPC'?'There is not enough free disk space. Free some space and try again.':MESSAGES.failed)});
    }).finally(()=>{this.task=null;this.controller=null;});
    return this.snapshot();
  }
  cancel(){this.controller?.abort();return this.snapshot();}
  async checkSpace(){
    if(typeof fs.promises.statfs!=='function')return;
    let stats;try{stats=await fs.promises.statfs(this.root);}catch{return;}
    const free=Number(stats.bavail)*Number(stats.bsize);
    if(Number.isFinite(free)&&free<totalDownload(this.tools)+totalDisk(this.tools)+SPACE_MARGIN){const error=new Error('There is not enough free disk space. Free some space and try again.');error.code='ENOSPC';throw error;}
  }
  progress(done,total,message){
    const now=Date.now();
    if(now-this.lastProgress<250&&done<total)return;
    this.lastProgress=now;this.update({progress:Math.min(0.95,done/total*0.95),...(message?{message}:{})});
  }
  async performInstall(){
    const controller=this.controller=new AbortController(),signal=controller.signal;
    await fs.promises.mkdir(this.root,{recursive:true});
    await this.checkSpace();signal.throwIfAborted();
    const staging=path.join(this.root,'.staging-'+crypto.randomUUID());
    await fs.promises.mkdir(staging);
    try{
      const total=totalDownload(this.tools);let done=0;
      for(const tool of this.tools){
        signal.throwIfAborted();
        this.update({message:`Downloading ${tool.name} ${tool.version}…`});
        const download=path.join(staging,`${tool.id}.download`);
        await this.fetchVerified(tool,download,signal,bytes=>{done+=bytes;this.progress(done,total);});
        if(tool.archive==='zip'){
          this.update({message:`Checking and unpacking ${tool.name}…`});
          await extractZipEntries(download,tool.files.map(file=>({...file,target:path.join(staging,file.name)})),{signal});
          await fs.promises.unlink(download);
        }else await fs.promises.rename(download,path.join(staging,tool.files[0].name));
      }
      signal.throwIfAborted();
      await fs.promises.writeFile(path.join(staging,MARKER),JSON.stringify({schema:1,set:this.setId,tools:this.tools.map(({id,version})=>({id,version})),installedAt:new Date().toISOString()}),{flag:'wx'});
      // A failed earlier copy of this same set is replaced only now, once the new copy is complete.
      await removeDirectory(this.dir);
      await renameDirectory(staging,this.dir);
    }catch(error){
      await fs.promises.rm(staging,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
      throw error;
    }
    await this.removeOthers().catch(()=>{});
  }
  async fetchVerified(tool,file,signal,onBytes){
    const opened=await openDownloadFile(file,{create:true});
    try{
      // The first part's answer shows whether the server sends parts; a server
      // that sends the whole file instead is read as one stream.
      let first;
      for(let tries=1;;tries++){
        try{first=await this.openPart(tool,0,Math.min(tool.size,this.partSize)-1,signal);break;}
        catch(error){signal.throwIfAborted();if(!error?.retry||tries>=this.partTries)throw new Error(MESSAGES.failed);await wait(this.retryDelayMs*tries,signal);}
      }
      if(first.whole)await this.streamWhole(tool,first.response,opened,signal,onBytes);
      else await this.downloadParts(tool,opened,first.response,signal,onBytes);
      await opened.handle.sync();await opened.verify(tool.size);
      const {sha256,head}=await hashHandle(opened.handle,tool.size);
      const expectedMagic=tool.archive==='zip'?[0x50,0x4b,0x03,0x04]:[0x4d,0x5a];
      if(sha256!==tool.sha256||expectedMagic.some((byte,index)=>head[index]!==byte))throw new Error(MESSAGES.failed);
    }finally{await opened.handle.close();}
  }
  // One request for bytes start..end through the pinned release address.
  async openPart(tool,start,end,signal){
    let response;
    try{response=await toolFetch(tool.url,{fetcher:this.fetcher,signal,headers:{Range:`bytes=${start}-${end}`}});}
    catch(error){if(signal.aborted||error?.message===MESSAGES.failed)throw error;throw retryable(new Error(MESSAGES.failed));}
    const encoding=response.headers.get('content-encoding'),length=response.headers.get('content-length');
    const lengthIs=size=>length===null||(/^\d+$/.test(length)&&Number(length)===size);
    if(!encoding||encoding==='identity'){
      if(response.status===206&&response.body&&lengthIs(end-start+1)){
        const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
        if(range&&Number(range[1])===start&&Number(range[2])===end&&Number(range[3])===tool.size)return {response,whole:false};
      }else if(response.status===200&&start===0&&response.body&&lengthIs(tool.size))return {response,whole:true};
    }
    await response.body?.cancel().catch(()=>{});
    const error=new Error(MESSAGES.failed);
    throw partAnswer(response)?retryable(error):error;
  }
  // The whole file as one stream, for servers that do not send parts.
  async streamWhole(tool,response,opened,signal,onBytes){
    const reader=response.body.getReader();
    let received=0,lastActivity=Date.now(),waiting=false;
    const stall=new AbortController(),watchdog=setInterval(()=>{if(!waiting&&Date.now()-lastActivity>this.stallMs)stall.abort();},Math.min(1000,this.stallMs));
    watchdog.unref?.();
    const cancelRead=()=>{reader.cancel().catch(()=>{});};
    signal.addEventListener('abort',cancelRead,{once:true});stall.signal.addEventListener('abort',cancelRead,{once:true});
    try{
      for(;;){
        const {done,value}=await reader.read();
        signal.throwIfAborted();if(stall.signal.aborted)throw new Error(MESSAGES.failed);
        if(done)break;
        lastActivity=Date.now();
        if(received+value.byteLength>tool.size)throw new Error(MESSAGES.failed);
        if(this.bandwidthLimiter){waiting=true;try{await this.bandwidthLimiter.consume(value.byteLength,{signal});}finally{waiting=false;lastActivity=Date.now();}}
        await writeAt(opened.handle,value,received);
        received+=value.byteLength;onBytes(value.byteLength);
      }
      if(received!==tool.size)throw new Error(MESSAGES.failed);
    }finally{
      clearInterval(watchdog);signal.removeEventListener('abort',cancelRead);
      try{await reader.cancel();}catch{}
      try{reader.releaseLock();}catch{}
    }
  }
  // Reads exactly one part into memory; no data for partStallMs ends the try.
  async readPart(response,length,signal,onData){
    const data=Buffer.alloc(length),reader=response.body.getReader();
    let received=0,timer=null,stalled=false;
    const cancel=()=>{reader.cancel().catch(()=>{});};
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{stalled=true;cancel();},this.partStallMs);timer.unref?.();};
    signal.addEventListener('abort',cancel,{once:true});
    try{
      arm();
      for(;;){
        const {done,value}=await reader.read();
        if(signal.aborted||stalled)throw retryable(new Error(MESSAGES.failed));
        if(done)break;
        if(received+value.byteLength>length)throw new Error(MESSAGES.failed);
        clearTimeout(timer);
        if(this.bandwidthLimiter)await this.bandwidthLimiter.consume(value.byteLength,{signal});
        data.set(value,received);received+=value.byteLength;onData(received);
        arm();
      }
      if(received!==length)throw retryable(new Error(MESSAGES.failed));
      return data;
    }catch(error){
      if(error?.message===MESSAGES.failed)throw error;
      throw retryable(new Error(MESSAGES.failed));
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);
      try{await reader.cancel();}catch{}
      try{reader.releaseLock();}catch{}
    }
  }
  async downloadParts(tool,opened,firstResponse,signal,onBytes){
    const parts=[];
    for(let start=0;start<tool.size;start+=this.partSize){
      const end=Math.min(tool.size,start+this.partSize)-1;
      parts.push({start,end,length:end-start+1,done:false,writing:false,raced:false,tries:0,attempts:new Set(),received:0,startedAt:0});
    }
    const pending=parts.slice(1);
    let reported=0,lastActivity=Date.now(),closed=false,timer=null;
    const report=()=>{
      let total=0;for(const part of parts)total+=part.done?part.length:Math.min(part.length,part.received);
      if(total>reported){onBytes(total-reported);reported=total;}
    };
    await new Promise((resolve,reject)=>{
      const finish=error=>{
        if(closed)return;
        closed=true;clearInterval(timer);signal.removeEventListener('abort',onAbort);
        for(const part of parts)for(const attempt of part.attempts)attempt.abort();
        if(error)reject(error);else resolve();
      };
      const onAbort=()=>finish(signal.reason instanceof Error?signal.reason:new Error(MESSAGES.cancelled));
      const active=()=>parts.reduce((count,part)=>count+part.attempts.size,0);
      const fill=()=>{
        if(closed)return;
        if(parts.every(part=>part.done)){finish();return;}
        while(active()<this.connections){
          let part=pending.shift();
          if(!part){
            const now=Date.now();
            part=parts.filter(item=>!item.done&&!item.writing&&!item.raced&&item.attempts.size===1&&now-item.startedAt>=this.raceAfterMs)
              .sort((a,b)=>a.received/a.length-b.received/b.length)[0];
            if(!part)break;
            part.raced=true;
          }
          begin(part);
        }
      };
      const begin=(part,given=null)=>{
        const controller=new AbortController();
        if(!part.attempts.size)part.startedAt=Date.now();
        part.attempts.add(controller);
        (async()=>{
          let failure=null;
          try{
            let response=given;
            if(!response){
              const answer=await this.openPart(tool,part.start,part.end,controller.signal);
              if(answer.whole){await answer.response.body?.cancel().catch(()=>{});throw new Error(MESSAGES.failed);}
              response=answer.response;
            }
            const data=await this.readPart(response,part.length,controller.signal,received=>{lastActivity=Date.now();if(received>part.received)part.received=received;report();});
            if(closed||part.done||part.writing)return;
            part.writing=true;
            await writeAt(opened.handle,data,part.start);
            part.done=true;part.writing=false;lastActivity=Date.now();
            for(const other of part.attempts)if(other!==controller)other.abort();
            report();
          }catch(error){failure=error;}
          part.attempts.delete(controller);
          if(closed)return;
          // A failed write is a disk problem, not a network one.
          if(part.writing&&!part.done){finish(failure||new Error(MESSAGES.failed));return;}
          if(failure&&!part.done&&!controller.signal.aborted){
            if(!failure.retry){finish(new Error(MESSAGES.failed));return;}
            if(!part.attempts.size){
              part.tries++;part.received=0;
              if(part.tries>=this.partTries){finish(new Error(MESSAGES.failed));return;}
              const again=setTimeout(()=>{if(!closed){pending.unshift(part);fill();}},Math.min(5000,this.retryDelayMs*part.tries));
              again.unref?.();
            }
          }
          fill();
        })();
      };
      signal.addEventListener('abort',onAbort,{once:true});
      if(signal.aborted){onAbort();return;}
      timer=setInterval(()=>{if(Date.now()-lastActivity>this.stallMs)finish(new Error(MESSAGES.failed));else fill();},Math.min(1000,this.stallMs));
      timer.unref?.();
      begin(parts[0],firstResponse);
      fill();
    });
  }
  // Older pinned sets and abandoned setup folders. Only folders with
  // Ravenshelf's own names are touched. Runs only when no setup is in
  // progress (at the end of a setup, its own folder is already renamed).
  async removeOthers(){
    let entries;try{entries=await fs.promises.readdir(this.root,{withFileTypes:true});}catch{return;}
    for(const entry of entries)if((SET_NAME.test(entry.name)&&entry.name!==this.setId)||STAGING_NAME.test(entry.name))await removeDirectory(path.join(this.root,entry.name)).catch(()=>{});
  }
  async remove(){
    if(this.task)throw new Error(MESSAGES.running);
    if(this.verifying)await this.verifying.catch(()=>{});
    let entries=[];try{entries=await fs.promises.readdir(this.root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const entry of entries)if(SET_NAME.test(entry.name)||STAGING_NAME.test(entry.name)||['cache','tmp'].includes(entry.name))await removeDirectory(path.join(this.root,entry.name));
    await fs.promises.rmdir(this.root).catch(()=>{});
    this.verifiedKey=null;this.state={phase:'missing',progress:0,message:''};this.update({});
    return this.snapshot();
  }
  // Paths to the programs after checking each one against its pinned size and
  // SHA-256. Files are hashed once per session and again if they change.
  async verified(){
    if(this.platform!=='win32')throw new Error(MESSAGES.unsupported);
    if(this.task)throw new Error(MESSAGES.running);
    if(this.state.phase==='damaged')throw new Error(MESSAGES.damaged);
    if(this.state.phase==='error')this.state.phase='missing';
    if(this.refresh()!=='ready')throw new Error(MESSAGES.setup);
    if(!this.verifying)this.verifying=this.performVerify().finally(()=>{this.verifying=null;});
    return this.verifying;
  }
  async performVerify(){
    const damaged=()=>{this.verifiedKey=null;this.update({phase:'damaged',progress:0,message:MESSAGES.damaged});return new Error(MESSAGES.damaged);};
    try{
      const identities=[];
      for(const file of this.files){
        const stat=await fs.promises.lstat(path.join(this.dir,file.name),{bigint:true});
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size!==BigInt(file.size))throw damaged();
        identities.push(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
      }
      const key=identities.join('|');
      if(this.verifiedKey!==key){
        for(const file of this.files)if(await hashFile(path.join(this.dir,file.name))!==file.sha256)throw damaged();
        this.verifiedKey=key;
      }
    }catch(error){
      if(error?.message===MESSAGES.damaged)throw error;
      // A missing file is damage; a file that is only busy (for example while
      // antivirus scans it) can be checked again on the next try.
      if(error?.code==='ENOENT'||error?.code==='ENOTDIR')throw damaged();
      this.verifiedKey=null;
      throw new Error(MESSAGES.unreadable);
    }
    await fs.promises.mkdir(this.cache,{recursive:true});await fs.promises.mkdir(this.temp,{recursive:true});
    const paths={dir:this.dir,cache:this.cache,temp:this.temp};
    for(const file of this.files)if(ROLES.includes(file.role))paths[file.role]=path.join(this.dir,file.name);
    return paths;
  }
  async dispose(){this.disposed=true;this.controller?.abort();await Promise.allSettled([this.task,this.verifying].filter(Boolean));}
}
module.exports={MediaTools,TOOLS,MESSAGES,extractZipEntries,toolFetch,setName,crc32,hashFile,renameDirectory,SET_NAME,STAGING_NAME};
