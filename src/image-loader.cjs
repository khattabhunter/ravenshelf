'use strict';
const {safeFetch,safeURL}=require('./net.cjs');

const MAX_IMAGE_BYTES=12*1024*1024;
const IMAGE_TIMEOUT_MS=15000;
const TYPES=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const RESPONSE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};

function hasRasterSignature(bytes,type){
  if(type==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(type==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/gif')return bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
  if(type==='image/webp')return bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}
function withAbort(promise,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',abort);
    const abort=()=>{cleanup();reject(signal.reason||new Error('Image request cancelled.'));};
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}
function cancelBody(body){try{void body?.cancel().catch(()=>{});}catch{}}

// Remote images enter the renderer only through this bounded, cookie-free
// request. safeFetch validates every redirect and the addresses used by sockets.
async function imageResponse(request,{fetcher=safeFetch,maxBytes=MAX_IMAGE_BYTES,timeoutMs=IMAGE_TIMEOUT_MS}={}){
  let response,reader;
  try{
    const route=new URL(request.url);
    if(route.protocol!=='atlas:'||route.host!=='app'||route.pathname!=='/image'||route.username||route.password||route.hash||
      route.searchParams.size!==1||!route.searchParams.has('url')||request.method!=='GET')throw new Error('Invalid image request.');
    const target=safeURL(route.searchParams.get('url'));target.hash='';
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_IMAGE_BYTES||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>IMAGE_TIMEOUT_MS)throw new Error('Invalid image limits.');
    const deadline=AbortSignal.timeout(timeoutMs);
    const signal=request.signal?AbortSignal.any([request.signal,deadline]):deadline;
    signal.throwIfAborted();
    response=await withAbort(fetcher(target.href,{
      method:'GET',headers:{Accept:'image/png,image/jpeg,image/gif,image/webp','Accept-Encoding':'identity'},
      credentials:'omit',referrerPolicy:'no-referrer',signal,timeoutMs:0
    }),signal);
    if(response.status!==200||!response.body)throw new Error('Image unavailable.');
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const encoding=(response.headers.get('content-encoding')||'identity').trim().toLowerCase();
    if(!TYPES.has(type)||encoding!=='identity')throw new Error('Unsupported image response.');
    const rawLength=response.headers.get('content-length');
    const declared=rawLength===null?null:Number(rawLength);
    if(rawLength!==null&&(!/^\d+$/.test(rawLength)||!Number.isSafeInteger(declared)||declared>maxBytes))throw new Error('Image is too large.');
    reader=response.body.getReader();
    const chunks=[];let total=0;
    while(true){
      const {done,value}=await withAbort(reader.read(),signal);
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes)throw new Error('Image is too large.');
      chunks.push(Buffer.from(value));
    }
    if(!total||(declared!==null&&declared!==total))throw new Error('Image was incomplete.');
    const bytes=Buffer.concat(chunks,total);
    if(!hasRasterSignature(bytes,type))throw new Error('Image data did not match its type.');
    return new Response(bytes,{headers:{...RESPONSE_HEADERS,'Content-Type':type,'Content-Length':String(total)}});
  }catch{
    // Do not reflect private URLs, request headers, or system error paths.
    return new Response('Image unavailable',{status:502,headers:{...RESPONSE_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
  }finally{
    if(reader){try{void reader.cancel().catch(()=>{});reader.releaseLock();}catch{}}
    else cancelBody(response?.body);
  }
}
module.exports={imageResponse,MAX_IMAGE_BYTES,IMAGE_TIMEOUT_MS};
