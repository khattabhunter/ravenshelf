'use strict';
const {isWindowsDeviceName}=require('./safe-name.cjs');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {isMainThread,parentPort,workerData}=require('node:worker_threads');
const MAX_MANIFEST_BYTES=2*1024*1024,MAX_ENTRIES=2000,MAX_LINES=10000;
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
const same=(a,b)=>a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const unchanged=(a,b)=>same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function failure(code){const error=new Error(code);error.safeCode=code;return error;}
function safeRelative(value){
  if(typeof value!=='string'||!value||value.length>512||/[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)||path.posix.isAbsolute(value)||path.win32.isAbsolute(value)||/[<>:"|?*]/.test(value))throw failure('MANIFEST_PATH');
  const parts=value.replace(/\\/g,'/').split('/');
  if(parts.length>32||parts.some(part=>!part||part==='.'||part==='..'||part!==part.trim()||/[. ]$/.test(part)||isWindowsDeviceName(part)))throw failure('MANIFEST_PATH');
  return parts.join('/');
}
function local(value){
  if(typeof value!=='string'||!value||value.length>2048||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\0-\x1f]/.test(value))throw failure('LOCAL_PATH');
  const absolute=path.resolve(value),relative=path.relative(path.parse(absolute).root,absolute);
  if(relative)safeRelative(relative);return absolute;
}
function parseManifest(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_MANIFEST_BYTES)throw failure('MANIFEST_LIMIT');
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/,MAX_LINES+1);if(lines.length>MAX_LINES)throw failure('MANIFEST_LIMIT');
  const entries=[],seen=new Map();
  for(const raw of lines){
    if(raw.length>2048)throw failure('MANIFEST_LIMIT');
    const line=raw.trim();if(!line||/^[;#]/.test(line))continue;
    let algorithm,expected,name,match;
    if((match=/^(MD5|SHA256|SHA-256) \((.+)\) = ([a-f0-9]+)$/i.exec(line))){algorithm=match[1].toLowerCase().replace('-','');name=match[2];expected=match[3];if(expected.length!==(algorithm==='md5'?32:64))throw failure('MANIFEST_FORMAT');}
    else if((match=/^([a-f0-9]{64}|[a-f0-9]{32})[ \t]+([ *]?)(.+)$/i.exec(line))){expected=match[1];algorithm=expected.length===64?'sha256':'md5';name=match[3];}
    else if((match=/^(.+?)[ \t]+([a-f0-9]{8})$/i.exec(line))){algorithm='crc32';name=match[1];expected=match[2];}
    else throw failure('MANIFEST_FORMAT');
    name=safeRelative(name);expected=expected.toLowerCase();
    const key=algorithm+':'+(process.platform==='win32'?name.toLowerCase():name);
    if(seen.has(key)){if(seen.get(key)!==expected)throw failure('MANIFEST_CONFLICT');continue;}
    seen.set(key,expected);entries.push({name,algorithm,expected});if(entries.length>MAX_ENTRIES)throw failure('MANIFEST_LIMIT');
  }
  if(!entries.length)throw failure('MANIFEST_EMPTY');return entries;
}
async function parentsOf(file){
  const parents=[];
  for(let directory=path.dirname(file);;directory=path.dirname(directory)){
    const stat=await fs.promises.lstat(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino===0n)throw failure('UNSAFE_FILE');
    parents.push({path:directory,stat});if(path.dirname(directory)===directory)break;
  }
  return parents;
}
async function verifyParents(parents){for(const parent of parents){const stat=await fs.promises.lstat(parent.path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(parent.stat,stat))throw failure('CHANGED_FILE');}}
async function openRead(file,root){
  const parents=await parentsOf(file);
  if(root){const entry=parents.find(parent=>parent.path===root.path);if(!entry||!same(root.stat,entry.stat))throw failure('CHANGED_FILE');}
  let handle;
  try{
    handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
    const initial=await handle.stat({bigint:true});
    if(!initial.isFile()||initial.ino===0n||initial.nlink!==1n||initial.size<0n||initial.size>BigInt(Number.MAX_SAFE_INTEGER))throw failure('UNSAFE_FILE');
    const verify=async()=>{const current=await handle.stat({bigint:true}),named=await fs.promises.lstat(file,{bigint:true});if(!current.isFile()||current.nlink!==1n||!named.isFile()||named.isSymbolicLink()||!unchanged(initial,current)||!unchanged(current,named))throw failure('CHANGED_FILE');await verifyParents(parents);};
    await verify();return {handle,size:Number(initial.size),verify};
  }catch(error){if(handle)await handle.close();throw error;}
}
function publicMessage(error){
  const messages={MANIFEST_LIMIT:'The checksum manifest exceeds its size or entry limit.',MANIFEST_FORMAT:'The manifest contains an unsupported checksum line.',MANIFEST_PATH:'The manifest contains an unsafe or unsupported relative filename.',MANIFEST_CONFLICT:'The manifest contains conflicting checksums for one file.',MANIFEST_EMPTY:'No supported checksums were found in the manifest.',LOCAL_PATH:'Choose an ordinary local file and folder.',UNSAFE_FILE:'Linked, shared, or nonregular files cannot be verified.',CHANGED_FILE:'The file or its folder changed during verification.',CANCELLED:'Verification cancelled.'};
  if(messages[error?.safeCode])return messages[error.safeCode];if(error?.code==='ENOENT')return 'The file could not be found.';return 'The file could not be read safely.';
}
async function runVerification({manifestPath,rootPath},{send,cancelled=()=>false}={}){
  const check=()=>{if(cancelled())throw failure('CANCELLED');};check();
  const rootFile=local(rootPath),manifestFile=local(manifestPath);
  const rootStat=await fs.promises.lstat(rootFile,{bigint:true});if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.ino===0n)throw failure('UNSAFE_FILE');
  const root={path:rootFile,stat:rootStat};await verifyParents(await parentsOf(path.join(rootFile,'.verification-check')));
  let manifest,bytes;
  try{
    manifest=await openRead(manifestFile);if(manifest.size>MAX_MANIFEST_BYTES)throw failure('MANIFEST_LIMIT');
    const chunks=[],buffer=Buffer.allocUnsafe(65536);let total=0;
    while(total<=MAX_MANIFEST_BYTES){check();const {bytesRead}=await manifest.handle.read(buffer,0,Math.min(buffer.length,MAX_MANIFEST_BYTES+1-total),total);if(!bytesRead)break;total+=bytesRead;if(total>MAX_MANIFEST_BYTES)throw failure('MANIFEST_LIMIT');chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));}
    await manifest.verify();bytes=Buffer.concat(chunks,total);
  }finally{if(manifest)await manifest.handle.close();}
  check();const entries=parseManifest(bytes.toString('utf8'));let completed=0,bytesChecked=0,lastSent=0,batch=[];
  const emit=(force=false,type='progress')=>{if(force||Date.now()-lastSent>=200){send({type,total:entries.length,completed,bytesChecked,results:batch});batch=[];lastSent=Date.now();}};
  emit(true);
  for(const entry of entries){
    check();let opened;
    const result={...entry,actual:'',status:'error',message:''};
    try{
      const file=path.resolve(rootFile,...entry.name.split('/')),relative=path.relative(rootFile,file);
      if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw failure('MANIFEST_PATH');
      opened=await openRead(file,root);check();
      const hash=entry.algorithm==='crc32'?null:crypto.createHash(entry.algorithm);let crc=0xffffffff,position=0;
      const buffer=Buffer.allocUnsafe(Math.min(1024*1024,Math.max(1,opened.size)));
      // Read only the size captured from the descriptor. A growing file cannot
      // turn a checksum request into an unbounded stream.
      while(position<opened.size){
        check();const {bytesRead}=await opened.handle.read(buffer,0,Math.min(buffer.length,opened.size-position),position);if(!bytesRead)throw failure('CHANGED_FILE');
        const chunk=buffer.subarray(0,bytesRead);if(hash)hash.update(chunk);else for(const byte of chunk)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
        position+=bytesRead;bytesChecked+=bytesRead;emit();
      }
      check();await opened.verify();
      result.actual=hash?hash.digest('hex'):((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');
      result.status=result.actual===entry.expected?'match':'mismatch';result.message=result.status==='match'?'Checksum matches.':'Checksum does not match.';
    }catch(error){if(error.safeCode==='CANCELLED')throw error;result.status=error.code==='ENOENT'?'missing':'error';result.message=publicMessage(error);}
    finally{if(opened)await opened.handle.close();}
    completed++;batch.push(result);emit();
  }
  check();emit(true,'complete');
}
if(!isMainThread){
  let cancelled=false;parentPort.on('message',message=>{if(message?.type==='cancel')cancelled=true;});
  runVerification(workerData,{send:message=>parentPort.postMessage(message),cancelled:()=>cancelled})
    .catch(error=>parentPort.postMessage({type:error.safeCode==='CANCELLED'?'cancelled':'error',error:publicMessage(error)}))
    .finally(()=>parentPort.close());
}
module.exports={parseManifest,runVerification,MAX_MANIFEST_BYTES,MAX_ENTRIES,_test:{openRead}};
