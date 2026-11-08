'use strict';
// Framing and validation for messages between the Ravenshelf browser extension
// (through the small native connector) and the app. Everything that arrives
// from a browser is untrusted: it is size-limited and must match an exact shape
// before Ravenshelf acts on it.
const crypto=require('node:crypto');

const HOST_NAME='io.github.khattabhunter.ravenshelf';
// Public half of the key that pins the Chrome/Edge/Brave extension ID. Browsers
// derive the ID from it; no private key is needed or kept.
const CHROMIUM_EXTENSION_KEY='MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzomgWWP7W6/Ge6fzxk+HV2EImDlSFFKoVbJt3Rj2JhOFKEcVmsDKpO0tL6QxcLuygLmhYlz8YRQyG3z2JUj83M8mCmTwVV4m6k2B+mdDU+wBngYeN3LZyWUr2iw4NXuEbmNL01mqbslVKDRTT8bG4PqBTyLs2UPTEB0LLX+Wg2YtpgEq7wGkvPnxVwzHXhxyHMKWM85VnC8tkpAWJ9rLyRi1bLwkSNxFR/OlkehyvxrdlsNfumk1vmZIspgFx/b758bW312Wd86POlDwqSmvxc9yN77qkQHfg2L8YumjtLUDLpFRZ2LrrdixHRqjyPtTLxSsB7cbcozBK8NOyxwZcQIDAQAB';
const FIREFOX_EXTENSION_ID='ravenshelf@khattabhunter.github.io';
const MAX_HEADER_BYTES=4096;
const MAX_REQUEST_BYTES=64*1024;
const MAX_RESPONSE_BYTES=1000000;
const MAX_URL=8192;

function extensionIdFromKey(base64){
  const der=Buffer.from(base64,'base64');
  return [...crypto.createHash('sha256').update(der).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
}
const CHROMIUM_EXTENSION_ID=extensionIdFromKey(CHROMIUM_EXTENSION_KEY);
const ORIGINS=new Map([[`chrome-extension://${CHROMIUM_EXTENSION_ID}/`,'chromium'],[`firefox:${FIREFOX_EXTENSION_ID}`,'firefox']]);
const allowedOrigin=origin=>typeof origin==='string'&&ORIGINS.get(origin)||null;

function encodeFrame(value,maxBytes=MAX_RESPONSE_BYTES){
  const body=Buffer.from(JSON.stringify(value),'utf8');
  if(!body.length||body.length>maxBytes)throw new Error('Message is too large.');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length,0);
  return Buffer.concat([header,body]);
}
// Collects length-prefixed JSON frames from a byte stream.
class FrameReader{
  constructor(maxBytes){this.maxBytes=maxBytes;this.buffer=Buffer.alloc(0);}
  push(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);const frames=[];
    while(this.buffer.length>=4){
      const length=this.buffer.readUInt32LE(0);
      if(length<2||length>this.maxBytes)throw new Error('Invalid message length.');
      if(this.buffer.length<4+length)break;
      const text=this.buffer.subarray(4,4+length).toString('utf8');this.buffer=this.buffer.subarray(4+length);
      const value=JSON.parse(text);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid message.');
      frames.push(value);
    }
    if(this.buffer.length>4+this.maxBytes)throw new Error('Invalid message length.');
    return frames;
  }
}

const invalid=()=>{throw new Error('Invalid browser request.');};
function exactKeys(message,required,optional=[]){
  const keys=Object.keys(message),allowed=new Set(['v','type',...required,...optional]);
  if(keys.some(key=>!allowed.has(key))||required.some(key=>!Object.hasOwn(message,key)))invalid();
}
function webAddress(value,{optional=false,schemes=['https:','http:']}={}){
  if(optional&&(value===undefined||value===''))return undefined;
  if(typeof value!=='string'||!value||value.length>MAX_URL||/[\x00-\x1f\x7f]/.test(value))invalid();
  let url;try{url=new URL(value);}catch{invalid();}
  if(!schemes.includes(url.protocol)||!url.hostname)invalid();
  return url.href;
}
function text(value,max,{optional=true}={}){
  if(optional&&(value===undefined||value===''))return undefined;
  if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))invalid();
  return value;
}
function validateRequest(message){
  if(!message||typeof message!=='object'||Array.isArray(message)||message.v!==1||typeof message.type!=='string')invalid();
  switch(message.type){
    case 'hello':
      exactKeys(message,['extensionVersion','browser']);
      if(typeof message.extensionVersion!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(message.extensionVersion)||!['chromium','firefox'].includes(message.browser))invalid();
      return {type:'hello',extensionVersion:message.extensionVersion,browser:message.browser};
    case 'capture':{
      exactKeys(message,['url'],['finalUrl','referrer','pageUrl','filename','mime','totalBytes','incognito']);
      if(message.incognito!==undefined&&message.incognito!==false)invalid();
      const totalBytes=message.totalBytes===undefined?undefined:message.totalBytes;
      if(totalBytes!==undefined&&(!Number.isSafeInteger(totalBytes)||totalBytes<-1))invalid();
      return {type:'capture',url:webAddress(message.url),finalUrl:webAddress(message.finalUrl,{optional:true}),referrer:webAddress(message.referrer,{optional:true}),pageUrl:webAddress(message.pageUrl,{optional:true}),filename:text(message.filename,1024),mime:text(message.mime,200),totalBytes:totalBytes>0?totalBytes:undefined};
    }
    case 'send':
      exactKeys(message,['url','kind'],['pageUrl']);
      if(!['link','page'].includes(message.kind))invalid();
      return {type:'send',kind:message.kind,url:webAddress(message.url),pageUrl:webAddress(message.pageUrl,{optional:true})};
    case 'threats':
      exactKeys(message,[]);return {type:'threats'};
    case 'threatRule':
      exactKeys(message,['id']);
      if(!Number.isSafeInteger(message.id)||message.id<1||message.id>999)invalid();
      return {type:'threatRule',id:message.id};
    case 'lookup':
      exactKeys(message,['host']);
      if(typeof message.host!=='string'||!message.host||message.host.length>253||!/^[a-z0-9._-]+$/i.test(message.host))invalid();
      return {type:'lookup',host:message.host.toLowerCase()};
    default:invalid();
  }
}
module.exports={HOST_NAME,CHROMIUM_EXTENSION_KEY,CHROMIUM_EXTENSION_ID,FIREFOX_EXTENSION_ID,MAX_HEADER_BYTES,MAX_REQUEST_BYTES,MAX_RESPONSE_BYTES,extensionIdFromKey,allowedOrigin,encodeFrame,FrameReader,validateRequest};
