'use strict';
// PixelDrain, through its public API. Ravenshelf first asks for a file's
// details and downloads only when PixelDrain says the file can be downloaded,
// over one connection, as its free service allows. When PixelDrain asks for a
// captcha or its free limit is used up, Ravenshelf stops and says so: it never
// solves, skips or works around these checks, and never uses other servers.
const {isPixeldrainHost}=require('./hosts.cjs');

const ID=/^[A-Za-z0-9]{4,32}$/;
const MAX_LIST=1000,INFO_BYTES=256*1024,LIST_BYTES=2*1024*1024,REFUSAL_BYTES=16*1024;
const MESSAGES=Object.freeze({
  check:'PixelDrain asks for a quick browser check. Open the link in your browser, complete it, then try again.',
  limit:'PixelDrain’s free daily download limit is used up. Try again later or choose another mirror.',
  busy:'PixelDrain is limiting downloads from this connection right now. Try again later.',
  removed:'PixelDrain removed this file. Choose another mirror.',
  virus:'PixelDrain flagged this file as possibly harmful. Choose another mirror.',
  missing:'File not found or deleted.',
  list:'Import this PixelDrain list to see its files first.',
  ready:'PixelDrain file found; contents have not been scanned.',
  failed:'PixelDrain did not answer as expected. Try again later or open the link in your browser.',
  note:'PixelDrain allows one connection per file.'
});
// PixelDrain's documented refusal codes ("value"). Messages from the server
// are never shown; only these codes are read.
// A file PixelDrain's own scan flagged is never offered, not even through the browser.
const VIRUS=new Set(['virus_detected_captcha_required']);
const CHECK=new Set(['file_rate_limited_captcha_required','hotlink_detected','ip_download_limited_captcha_required','recpatcha_failed','recaptcha_failed']);
const LIMIT=new Set(['transfer_limit_exceeded','download_limit_exceeded']);
const BUSY=new Set(['max_concurrent_downloads']);
const GONE=new Set(['not_found','file_not_found']);
const REMOVED=new Set(['unavailable_for_legal_reasons']);

// A PixelDrain file (/u/<id>, /api/file/<id>) or list (/l/<id>, /api/list/<id>) link.
function pixeldrainLink(value){
  let u;try{u=new URL(String(value));}catch{return null;}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!isPixeldrainHost(u.hostname))return null;
  const parts=u.pathname.split('/').filter(Boolean);
  let kind='',id='';
  if(parts.length===2&&(parts[0]==='u'||parts[0]==='l')){kind=parts[0]==='u'?'file':'list';id=parts[1];}
  else if(parts[0]==='api'&&parts[1]==='file'&&(parts.length===3||(parts.length===4&&parts[3]==='info'))){kind='file';id=parts[2];}
  else if(parts.length===3&&parts[0]==='api'&&parts[1]==='list'){kind='list';id=parts[2];}
  if(!kind||!ID.test(id))return null;
  const origin='https://'+u.hostname.toLowerCase().replace(/^www\./,'');
  return {kind,id,origin,page:`${origin}/${kind==='file'?'u':'l'}/${id}`};
}
const isPixeldrainList=value=>pixeldrainLink(value)?.kind==='list';
// The fixed message for one of PixelDrain's refusal codes, or null for an unknown one.
function refusal(value){
  const code=typeof value==='string'?value.slice(0,80):'';
  if(VIRUS.has(code)||/virus|malware/.test(code))return MESSAGES.virus;
  if(CHECK.has(code)||/captcha/.test(code))return MESSAGES.check;
  if(LIMIT.has(code))return MESSAGES.limit;
  if(BUSY.has(code))return MESSAGES.busy;
  if(GONE.has(code))return MESSAGES.missing;
  if(REMOVED.has(code))return MESSAGES.removed;
  return null;
}
// Reads at most `cap` bytes of an answer as text.
async function readLimited(response,cap){
  const reader=response.body?.getReader();if(!reader)return '';
  const parts=[];let length=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      length+=value.length;if(length>cap)throw new Error('The answer is too large.');
      parts.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).toString('utf8');
}
async function readJSON(response,readText=readLimited,cap){
  if(!/\bjson\b/i.test(response.headers.get('content-type')||'')){try{await response.body?.cancel();}catch{}return null;}
  try{const value=JSON.parse(await readText(response,cap));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}
}
const cleanName=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,240):'';

async function resolvePixeldrain(url,{fetcher,readText=readLimited}){
  const link=pixeldrainLink(url);
  if(!link)return {status:'manual',message:MESSAGES.failed};
  if(link.kind==='list')return {status:'manual',message:MESSAGES.list};
  const response=await fetcher(`${link.origin}/api/file/${link.id}/info`,{headers:{Accept:'application/json'}});
  const body=await readJSON(response,readText,INFO_BYTES);
  if(response.status===404)return {status:'unavailable',message:MESSAGES.missing};
  if(body?.success===false){
    const message=refusal(body.value)||MESSAGES.failed;
    return {status:[MESSAGES.missing,MESSAGES.removed,MESSAGES.virus].includes(message)?'unavailable':'manual',message};
  }
  if(response.status!==200||!body)return {status:'manual',message:MESSAGES.failed};
  const availability=typeof body.availability==='string'?body.availability:'';
  if(availability){
    const message=refusal(availability)||MESSAGES.failed;
    return {status:[MESSAGES.missing,MESSAGES.removed,MESSAGES.virus].includes(message)?'unavailable':'manual',message};
  }
  if(body.can_download===false)return {status:'manual',message:MESSAGES.check};
  const size=Number.isSafeInteger(body.size)&&body.size>0?body.size:0;
  return {status:'ready',url:`${link.origin}/api/file/${link.id}?download`,filename:cleanName(body.name)||link.id,size,message:MESSAGES.ready};
}
// The file links in a PixelDrain list, in the list's order.
async function listFiles(url,{fetcher,readText=readLimited}){
  const link=pixeldrainLink(url);
  if(link?.kind!=='list')throw new Error(MESSAGES.failed);
  const response=await fetcher(`${link.origin}/api/list/${link.id}`,{headers:{Accept:'application/json'}});
  const body=await readJSON(response,readText,LIST_BYTES);
  if(response.status===404)throw new Error(MESSAGES.missing);
  if(body?.success===false)throw new Error(refusal(body.value)||MESSAGES.failed);
  if(response.status!==200||!Array.isArray(body?.files))throw new Error(MESSAGES.failed);
  const files=[];
  for(const file of body.files.slice(0,MAX_LIST))if(typeof file?.id==='string'&&ID.test(file.id))files.push(`${link.origin}/u/${file.id}`);
  return [...new Set(files)];
}
// Why PixelDrain refused a download request, from the JSON it sends with the
// refusal; null when the answer is not one of its refusals.
async function downloadRefusal(response,readText=readLimited){
  if(!response||response.ok)return null;
  const body=await readJSON(response,readText,REFUSAL_BYTES);
  return body?.success===false?refusal(body.value):null;
}

module.exports={MESSAGES,pixeldrainLink,isPixeldrainList,refusal,resolvePixeldrain,listFiles,downloadRefusal};
