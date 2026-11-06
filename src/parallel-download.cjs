'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const CHUNK_SIZE=8*1024*1024;
const MIN_PARALLEL_SIZE=16*1024*1024;
const CHECKPOINT_MS=1000;
function normalizeConnections(value){return [1,2,4].includes(Number(value))?Number(value):4;}
function workspaceFor(partialPath,id){return path.join(path.dirname(partialPath),'.atlas-segments-'+crypto.createHash('sha256').update(String(id)).digest('hex').slice(0,24));}
function readState(workspace){try{return JSON.parse(fs.readFileSync(path.join(workspace,'state.json'),'utf8'));}catch{return null;}}
function writeState(workspace,state){
  const target=path.join(workspace,'state.json'), temp=target+'.tmp';
  const fd=fs.openSync(temp,'w');
  try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,target);
}
function validatorFor(headers){
  const etag=headers.get('etag');
  if(etag!==null)return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)?{kind:'etag',value:etag}:null;
  const modified=headers.get('last-modified'), date=headers.get('date');
  return modified&&date&&Number.isFinite(Date.parse(modified))&&Number.isFinite(Date.parse(date))&&Date.parse(date)-Date.parse(modified)>=60000
    ?{kind:'last-modified',value:modified}:null;
}
function matchesValidator(headers,validator){
  return !!validator && headers.get(validator.kind)===validator.value && (validator.kind!=='last-modified'||validatorFor(headers)?.value===validator.value);
}
function validRange(response,start,end,total){
  if(response.status!==206)return false;
  const encoding=response.headers.get('content-encoding');
  if(encoding&&encoding.toLowerCase()!=='identity')return false;
  if(/text\/html|application\/(?:json|xhtml|xml|javascript)/i.test(response.headers.get('content-type')||''))return false;
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
  if(!match)return false;
  const [a,b,size]=match.slice(1).map(Number);
  if(![a,b,size].every(Number.isSafeInteger)||a!==start||b!==end||size<=end||(total!==undefined&&size!==total))return false;
  const length=response.headers.get('content-length');
  return length===null||Number(length)===end-start+1;
}
async function cancelBody(response){try{await response?.body?.cancel();}catch{}}
function savedBytes(state){return state?.segments?.reduce((sum,segment)=>sum+segment.bytes,0)||0;}
function segmentLength(state,index){return Math.min(state.chunkSize,state.total-index*state.chunkSize);}
function isUsableState(state,sourceId,dataPath){
  if(!state||state.version!==1||state.sourceId!==sourceId||state.chunkSize!==CHUNK_SIZE||!Number.isSafeInteger(state.total)||state.total<=0||!state.validator||!['etag','last-modified'].includes(state.validator.kind)||typeof state.validator.value!=='string'||!Array.isArray(state.segments)||state.segments.length!==Math.ceil(state.total/CHUNK_SIZE))return false;
  let size;try{size=fs.statSync(dataPath).size;}catch{return false;}
  return size<=state.total&&state.segments.every((s,i)=>Number.isSafeInteger(s.bytes)&&s.bytes>=0&&s.bytes<=segmentLength(state,i)&&typeof s.complete==='boolean'&&(!s.complete||s.bytes===segmentLength(state,i))&&(!s.bytes||i*CHUNK_SIZE+s.bytes<=size));
}
function publicValidator(validator){return {etag:validator?.kind==='etag'?validator.value:null,lastModified:validator?.kind==='last-modified'?validator.value:null};}
async function savePrefix(workspace,state,partialPath,onActivity){
  let count=0;
  for(let i=0;i<state.segments.length;i++){
    const s=state.segments[i],length=segmentLength(state,i);
    // Require one last response byte again if EOF was never validated.
    const bytes=!s.complete&&s.bytes===length?Math.max(0,s.bytes-1):s.bytes;
    count+=bytes;if(bytes<length)break;
  }
  if(!count)return 0;
  const source=await fs.promises.open(path.join(workspace,'data.part'),'r');
  const destination=await fs.promises.open(partialPath,'w');
  try{
    const buffer=Buffer.allocUnsafe(Math.min(CHUNK_SIZE,count));let position=0;
    while(position<count){
      const {bytesRead}=await source.read(buffer,0,Math.min(buffer.length,count-position),position);
      if(!bytesRead)throw new Error('Saved download data is incomplete.');
      let done=0;while(done<bytesRead){const {bytesWritten}=await destination.write(buffer,done,bytesRead-done,position+done);if(!bytesWritten)throw new Error('Could not save download data.');done+=bytesWritten;}
      position+=bytesRead;onActivity();
    }
    await destination.sync();
  }finally{await source.close();await destination.close();}
  return count;
}

// A sparse data file is never exposed as the legacy .atlas-part. Only bytes
// recorded after fsync in the manifest count as received after a restart.
async function downloadRanges({workspace,partialPath,sourceId,request,signal,connections=4,onProgress=()=>{},onConnections=()=>{},onMode=()=>{},onActivity=()=>{}}){
  const dataPath=path.join(workspace,'data.part');
  let state=readState(workspace);
  if(state?.disabled)return {fallback:true,note:state.note||'Using one connection for this file.'};
  if(fs.existsSync(workspace)&&!isUsableState(state,sourceId,dataPath))return {fallback:true,note:'Saved connection data could not be verified. Using one connection.'};
  let probe,validator,total,openEnded=false;
  const fallback=async(note,reuse=true)=>{
    let prefixBytes=0;
    if(state){
      if(reuse)prefixBytes=await savePrefix(workspace,state,partialPath,onActivity);
      state.disabled=true;state.note=note;writeState(workspace,state);
    }
    return {fallback:true,note,prefixBytes,...(reuse?publicValidator(state?.validator):{etag:null,lastModified:null}),reset:!!state&&!reuse};
  };
  try{
    signal.throwIfAborted();onConnections(1);
    probe=await request({Range:'bytes=0-0'},signal);onActivity();
    // Some hosts misreport bounded ranges but implement ordinary resume
    // ranges correctly. Re-probe independently; never reinterpret bad headers.
    if(probe.status===206&&!validRange(probe,0,0)){
      await cancelBody(probe);probe=await request({Range:'bytes=0-'},signal);onActivity();
      const match=/^bytes 0-(\d+)\/(\d+)$/.exec(probe.headers.get('content-range')||'');
      const size=match?Number(match[2]):0;
      if(!Number.isSafeInteger(size)||size<1||!validRange(probe,0,size-1,size))return await fallback('The host does not support reliable split downloads. Using one connection.');
      openEnded=true;
    }
    if(!openEnded&&!validRange(probe,0,0))return await fallback('The host does not support reliable split downloads. Using one connection.');
    total=Number(probe.headers.get('content-range').split('/')[1]);validator=validatorFor(probe.headers);
    if(!validator||total<MIN_PARALLEL_SIZE)return await fallback(validator?'This file is small enough for one connection.':'The host cannot verify split downloads safely. Using one connection.');
    let length=0;for await(const chunk of probe.body){length+=chunk.length;if(openEnded&&length>=1)break;if(length>1)throw new Error('Invalid range probe.');}
    if((openEnded&&length<1)||(!openEnded&&length!==1))throw new Error('Incomplete range probe.');
    if(state&&(state.total!==total||state.validator.kind!==validator.kind||state.validator.value!==validator.value))return await fallback('The file changed on the host. Restarting with one connection.',false);
  }catch(error){
    if(signal.aborted)throw signal.reason||error;
    return await fallback('The host could not open split connections. Using one connection.');
  }finally{await cancelBody(probe);onConnections(0);}

  if(!state){
    fs.mkdirSync(workspace,{recursive:true});
    const fd=fs.openSync(dataPath,'wx');fs.closeSync(fd);
    state={version:1,sourceId,total,chunkSize:CHUNK_SIZE,validator,segments:Array.from({length:Math.ceil(total/CHUNK_SIZE)},()=>({bytes:0,complete:false}))};
    writeState(workspace,state);
  }
  const handle=await fs.promises.open(dataPath,'r+');
  const group=new AbortController(),abort=()=>group.abort(signal.reason||new Error('Download paused.'));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  let active=0,next=0,firstError=null,checkpointFailure=null,checkpointBusy=false;
  let checkpoint=Promise.resolve();
  const report=()=>{onProgress(savedBytes(state),total);onActivity();};
  const saveCheckpoint=()=>{
    const snapshot=JSON.parse(JSON.stringify(state));
    checkpoint=checkpoint.then(async()=>{await handle.sync();writeState(workspace,snapshot);});
    return checkpoint;
  };
  const timer=setInterval(()=>{
    if(checkpointBusy)return;
    checkpointBusy=true;
    saveCheckpoint().catch(error=>{checkpointFailure=error;group.abort(error);}).finally(()=>{checkpointBusy=false;});
  },CHECKPOINT_MS);timer.unref();
  const count=normalizeConnections(connections);
  onMode(count>1?'parallel':'single',count>1?'':'Resuming saved sections with one connection.');report();
  const worker=async()=>{
    while(!group.signal.aborted){
      const index=next++;if(index>=state.segments.length)return;
      const segment=state.segments[index];if(segment.complete)continue;
      const end=index*CHUNK_SIZE+segmentLength(state,index)-1;
      // An interrupted stream must still finish a real response, not just have
      // reached its advertised length before its connection failed.
      if(segment.bytes===segmentLength(state,index))segment.bytes--;
      const start=index*CHUNK_SIZE+segment.bytes;
      let response,lastRead=Date.now();
      // Fall back before the manager's 60-second whole-download watchdog fires.
      const watchdog=setInterval(()=>{if(Date.now()-lastRead>30000){const error=new Error('A split connection stopped responding.');if(!firstError)firstError=error;group.abort(error);}},5000);watchdog.unref();
      try{
        active++;onConnections(active);
        response=await request({Range:openEnded?`bytes=${start}-`:`bytes=${start}-${end}`,'If-Range':validator.value},group.signal);
        onActivity();
        if(!validRange(response,start,openEnded?total-1:end,total)||!matchesValidator(response.headers,validator))throw new Error('The host did not return a matching file section.');
        let received=0;
        for await(const value of response.body){
          group.signal.throwIfAborted();
          const chunk=openEnded?value.subarray(0,end-start+1-received):value;
          if(received+chunk.length>end-start+1)throw new Error('The host returned an oversized file section.');
          let written=0;
          while(written<chunk.length){const result=await handle.write(chunk,written,chunk.length-written,start+received+written);if(!result.bytesWritten)throw new Error('Could not save a file section.');written+=result.bytesWritten;}
          received+=chunk.length;segment.bytes+=chunk.length;lastRead=Date.now();report();
          if(openEnded&&received===end-start+1)break;
        }
        if(received!==end-start+1)throw new Error('The host ended a file section early.');
        group.signal.throwIfAborted();segment.complete=true;
      }catch(error){if(!firstError&&!signal.aborted){firstError=error;group.abort(error);}throw error;}
      finally{clearInterval(watchdog);await cancelBody(response);active--;onConnections(active);}
    }
  };
  try{
    await Promise.allSettled(Array.from({length:count},()=>worker()));
    clearInterval(timer);await checkpoint;await saveCheckpoint();
  }finally{
    clearInterval(timer);signal.removeEventListener('abort',abort);await handle.close();onConnections(0);
  }
  if(signal.aborted)throw signal.reason||new Error('Download paused.');
  if(checkpointFailure)throw checkpointFailure;
  if(firstError)return fallback('The host limited or interrupted split connections. Continuing with one connection.');
  if(!state.segments.every(s=>s.complete))throw new Error('Some file sections are incomplete. Retry to resume.');
  return {path:dataPath,total,...publicValidator(validator)};
}
async function removeWorkspace(workspace){
  // Only known files created by this module are removed; never recurse through
  // an arbitrary saved download folder.
  for(const name of ['state.json','state.json.tmp','data.part'])await fs.promises.unlink(path.join(workspace,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.promises.rmdir(workspace).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
module.exports={CHUNK_SIZE,MIN_PARALLEL_SIZE,normalizeConnections,workspaceFor,readState,validatorFor,validRange,savedBytes,downloadRanges,removeWorkspace};
