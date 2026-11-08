'use strict';
// Checks a download link before Ravenshelf fetches the file. The check follows
// redirects one step at a time, refuses to contact listed or private hosts,
// never runs page scripts, never sends browser cookies, and reads at most a few
// kilobytes of the file to learn what it really is.
const net=require('node:net');
const {safeFetch,safeURL,isPublicIP}=require('./net.cjs');
const {filenameFromHeaders}=require('./providers.cjs');

const SNIFF_BYTES=4096;
const PROGRAMS=new Set(['exe','msi','msix','msixbundle','appx','appxbundle','appinstaller','com','scr','pif','cpl']);
const SCRIPTS=new Set(['bat','cmd','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','hta','jar','lnk','url','scf','reg','inf','msc','application','gadget','settingcontent-ms','xll','iqy','slk']);
const DISK_IMAGES=new Set(['iso','img','vhd','vhdx']);
const ARCHIVES=new Set(['zip','rar','7z','gz','tgz','bz2','xz','tar','cab']);
const PLAIN_TYPES=new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','jpg','jpeg','png','gif','bmp','webp','svg','mp4','mkv','avi','mov','wmv','webm','m4v','mp3','wav','flac','m4a','ogg','aac','epub','srt']);
const BIDI=/[؜‎‏‪-‮⁦-⁩]/;
const LEVELS={info:0,warning:1,blocked:2};

function extensionOf(name){
  const match=/\.([a-z0-9-]{1,24})$/i.exec(String(name||'').trim().replace(/[. ]+$/,''));
  return match?match[1].toLowerCase():'';
}
function sniffBytes(bytes){
  const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
  if(b.length>=2&&b[0]===0x4d&&b[1]===0x5a)return 'windows-program';
  if(b.length>=4&&b[0]===0x50&&b[1]===0x4b&&(b[2]===0x03||b[2]===0x05||b[2]===0x07))return 'zip';
  if(b.length>=6&&b.subarray(0,6).toString('latin1')==='Rar!\x1a\x07')return 'rar';
  if(b.length>=6&&b[0]===0x37&&b[1]===0x7a&&b[2]===0xbc&&b[3]===0xaf&&b[4]===0x27&&b[5]===0x1c)return '7z';
  if(b.length>=5&&b.subarray(0,5).toString('latin1')==='%PDF-')return 'pdf';
  if(b.length>=8&&b.readUInt32BE(0)===0xd0cf11e0&&b.readUInt32BE(4)===0xa1b11ae1)return 'office-legacy';
  const text=b.subarray(0,512).toString('latin1').replace(/^﻿|^\xef\xbb\xbf/,'').trimStart().toLowerCase();
  if(text.startsWith('<!doctype html')||text.startsWith('<html')||(text.startsWith('<')&&/<(?:head|body|script|meta)[\s>]/i.test(text)))return 'html';
  if(text.startsWith('#!'))return 'script';
  return 'unknown';
}
const reason=(code,level,message)=>({code,level,message});
// Deceptive names are judged on the name Ravenshelf will save, before any byte
// of the file is fetched, so they can be stopped immediately.
function nameReasons(filename){
  const name=String(filename||'');const reasons=[];const ext=extensionOf(name);
  if(BIDI.test(name))reasons.push(reason('spoofed-name','blocked','The file name uses hidden or reversed text to disguise its real type.'));
  const double=/\.([a-z0-9]{2,5})\s*\.([a-z0-9]{2,5})$/i.exec(name.replace(/[. ]+$/,''));
  if(double&&PLAIN_TYPES.has(double[1].toLowerCase())&&(PROGRAMS.has(ext)||SCRIPTS.has(ext)))reasons.push(reason('double-extension','blocked',`The name looks like a .${double[1].toLowerCase()} file, but it is really a .${ext} program.`));
  else if(/\s{3,}\.[a-z0-9]{2,5}$/i.test(name)&&(PROGRAMS.has(ext)||SCRIPTS.has(ext)))reasons.push(reason('padded-name','blocked',`The name hides its .${ext} ending behind a run of spaces.`));
  if(!reasons.some(item=>item.level==='blocked')){
    if(PROGRAMS.has(ext))reasons.push(reason('program','warning',`.${ext} files are programs that can change your PC. Run it only if you trust where it came from.`));
    else if(SCRIPTS.has(ext))reasons.push(reason('script','warning',`.${ext} files run commands as soon as they are opened. Open it only if you are sure it is safe.`));
    else if(DISK_IMAGES.has(ext))reasons.push(reason('disk-image','warning',`.${ext} disk images can hide programs and skip some Windows warnings. Open it only if you expected one.`));
  }
  return reasons;
}
function contentReasons(filename,sniffed){
  const ext=extensionOf(filename);
  if(sniffed!=='windows-program'||PROGRAMS.has(ext)||SCRIPTS.has(ext))return [];
  if(PLAIN_TYPES.has(ext))return [reason('disguised-program','blocked',`This file contains a Windows program even though its name ends in .${ext}.`)];
  if(ARCHIVES.has(ext))return [reason('archive-program','warning',`This .${ext} file is really a self-extracting program. Open it only if you expected that.`)];
  return [];
}
function chainReasons(chain){
  const reasons=[];
  for(const hop of chain){
    if(hop.listed)reasons.push(reason('listed','blocked',`${hop.host} is on Ravenshelf’s list of ${hop.listed.label}.`));
  }
  const hosts=[...new Set(chain.map(hop=>hop.host))];
  if(hosts.length>1)reasons.push(reason('redirects','info',`The link passed through ${hosts.length-1} other ${hosts.length===2?'site':'sites'}: ${hosts.join(' → ')}.`));
  return reasons;
}
function virusTotalReasons(results){
  const reasons=[];
  for(const item of Array.isArray(results)?results:[]){
    if(item?.status!=='ok'||!Number.isSafeInteger(item.malicious))continue;
    const subject=item.kind==='file'?'this file':item.subject;
    if(item.malicious>=2)reasons.push(reason('virustotal','warning',`${item.malicious} security vendors on VirusTotal flagged ${subject}.`));
    else if(item.malicious===1)reasons.push(reason('virustotal','info',`1 security vendor on VirusTotal flagged ${subject}; one detection is often a false alarm.`));
  }
  return reasons;
}
function assessDownload({filename='',sniffed='unknown',chain=[],insecure=false,virusTotal=[]}={}){
  const reasons=[...chainReasons(chain),...nameReasons(filename),...contentReasons(filename,sniffed),...virusTotalReasons(virusTotal)];
  const ext=extensionOf(filename);
  if(insecure&&(PROGRAMS.has(ext)||SCRIPTS.has(ext)||DISK_IMAGES.has(ext)))reasons.push(reason('insecure-program','blocked','This program would be downloaded without encryption (HTTP), so it could be changed on the way.'));
  else if(insecure)reasons.push(reason('insecure','warning','This link is not encrypted (HTTP). Ravenshelf downloads only HTTPS links, so your browser would have to handle it.'));
  const level=reasons.reduce((highest,item)=>LEVELS[item.level]>LEVELS[highest]?item.level:highest,'info');
  return {level:level==='info'?'ok':level,reasons};
}
function nameFromURL(url){
  try{
    const segment=new URL(url).pathname.split('/').filter(Boolean).at(-1)||'';
    const decoded=decodeURIComponent(segment);
    return decoded.replace(/[\x00-\x1f\x7f]/g,'').slice(0,240)||'download';
  }catch{return 'download';}
}
async function readHead(response,limit=SNIFF_BYTES){
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const parts=[];let length=0;
  try{
    while(length<limit){
      const {done,value}=await reader.read();
      if(done)break;
      parts.push(Buffer.from(value));length+=value.length;
    }
  }finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).subarray(0,limit);
}
function rangeTotal(response){
  if(response.status===206){
    const range=/^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range')||'');
    const total=range&&range[3]!=='*'?Number(range[3]):0;
    return Number.isSafeInteger(total)&&total>0?total:0;
  }
  const length=response.headers.get('content-length');
  if(length===null||!/^\d+$/.test(length))return 0;
  const value=Number(length);return Number.isSafeInteger(value)?value:0;
}
function privateDestination(url){
  try{
    const host=new URL(url).hostname.replace(/^\[|\]$/g,'').toLowerCase();
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))return true;
    return net.isIP(host)!==0&&!isPublicIP(host);
  }catch{return false;}
}
// Returns one of: ready (a file responded), manual (the browser must handle it),
// unavailable (gone) or blocked (a listed or local host was reached by redirect).
async function inspectLink(start,{fetcher=safeFetch,referer=null,lookupHost=()=>null,maxHops=8,timeoutMs=15000,signal}={}){
  const chain=[];const result=(status,message,extra={})=>({status,message,sourceUrl:start,url:chain.at(-1)?.url||start,chain,...extra});
  let current;
  try{current=new URL(start);}catch{return result('unavailable','This is not a valid web address.');}
  for(let hop=0;hop<=maxHops;hop++){
    const listed=lookupHost(current.hostname);
    chain.push({url:current.href,host:current.hostname.toLowerCase(),listed:listed||null});
    // Never contact a listed host, not even to look at its response.
    if(listed)return result('blocked',`${current.hostname} is on Ravenshelf’s list of ${listed.label}.`);
    if(current.protocol==='http:')return result('manual','This link is not encrypted (HTTP), so Ravenshelf will not download it.',{insecure:true});
    if(privateDestination(current.href))return result('blocked','The link tried to reach a device on your own network.',{privateDestination:true});
    try{safeURL(current.href);}catch{return result('manual','This link uses an address Ravenshelf does not download from.');}
    const headers={'Accept-Encoding':'identity',Range:`bytes=0-${SNIFF_BYTES-1}`};
    if(referer&&hop===0){try{headers.Referer=safeURL(referer).href;}catch{}}
    let response;
    try{response=await fetcher(current.href,{method:'GET',redirect:'manual',headers,timeoutMs,signal});}
    catch(error){
      if(signal?.aborted)throw error;
      if(/Private network destination/.test(String(error?.message)))return result('blocked','The link tried to reach a device on your own network.',{privateDestination:true});
      return result('manual','The site could not be reached from Ravenshelf. Your browser may still be able to download it.');
    }
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location)return result('unavailable','The site sent a redirect without a destination.');
      let next;try{next=new URL(location,current);}catch{return result('unavailable','The site sent an invalid redirect.');}
      if(!['https:','http:'].includes(next.protocol))return result('blocked','The link tried to open something other than a web address.');
      current=next;continue;
    }
    const status=response.status;
    if(status===404||status===410){await response.body?.cancel();return result('unavailable','File not found or deleted.');}
    if([401,403,407,451].includes(status)){await response.body?.cancel();return result('manual','This site gives the file only to your browser (it needs a sign-in, cookies or a check).');}
    if(status===429||status===503){await response.body?.cancel();return result('manual','The site is busy right now. Try again in a moment, or let your browser download it.');}
    if(status!==200&&status!==206){await response.body?.cancel();return result('manual',`The site returned HTTP ${status}.`);}
    const encoding=response.headers.get('content-encoding');
    if(encoding&&!/^identity$/i.test(encoding)){await response.body?.cancel();return result('manual','The site compressed this download in a way Ravenshelf cannot resume safely. Your browser can download it.');}
    const type=(response.headers.get('content-type')||'').toLowerCase();
    let filename;
    try{filename=filenameFromHeaders(response,nameFromURL(current.href));}
    catch{await response.body?.cancel();return result('manual','The site sent an invalid file name.');}
    const size=rangeTotal(response);
    const head=await readHead(response);
    const sniffed=sniffBytes(head);
    if(sniffed==='html'||/text\/html|application\/xhtml|text\/xml|application\/json|javascript/.test(type))return result('manual','This link opens a web page, not a file. It may be an ad or a redirect page.',{filename,sniffed:'html'});
    return result('ready','The file responded. Its contents have not been scanned yet.',{url:current.href,filename,size,contentType:type.slice(0,200),sniffed});
  }
  return result('unavailable','The link redirected too many times.');
}
module.exports={inspectLink,assessDownload,nameReasons,contentReasons,sniffBytes,extensionOf,nameFromURL,PROGRAMS,SCRIPTS,DISK_IMAGES,SNIFF_BYTES};
