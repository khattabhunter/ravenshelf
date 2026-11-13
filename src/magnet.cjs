'use strict';
// Magnet links and torrent files. A magnet link names a torrent by its
// info-hash; the file list (the torrent's metadata) comes from other people
// and is checked here against that hash before anything is downloaded. Every
// file name in it must be one Windows can store exactly as written, inside the
// download's own folder; a torrent with any other name is refused, never
// renamed, so the files on disk are the ones that were shown and checked.
const crypto=require('node:crypto');
const net=require('node:net');
const {isPublicIP}=require('./net.cjs');
const {safeName}=require('./safe-name.cjs');

const MESSAGES=Object.freeze({
  invalid:'This is not a valid magnet link.',
  version2:'This torrent uses a newer format that Ravenshelf can’t download yet.',
  damaged:'The torrent’s file list is damaged or does not match its magnet link.',
  names:'This torrent has file names that Windows can’t store safely, so Ravenshelf won’t download it.',
  tooMany:'This torrent has too many files for Ravenshelf to download.',
  tooLong:'This torrent’s file names are too long for your download folder. Choose a shorter download folder in Settings.',
  deceptive:'This torrent has a file name made to hide its real type, so Ravenshelf won’t download it.'
});
const MAX_MAGNET=8192,MAX_TRACKERS=30,MAX_TRACKER=512,MAX_META=10*1024*1024,MAX_FILES=10000,MAX_DEPTH=64,MAX_PART=180;
const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TRACKER_SCHEMES=new Set(['udp:','http:','https:']);
const controls=/[\x00-\x1f\x7f]/g,CONTROL=/[\x00-\x1f\x7f]/;
// Invisible format characters (text-direction marks, zero-width characters) can make a name read as something else.
// Zero-width joiner and non-joiner are kept: Persian, Kurdish and Urdu names written in Arabic letters need them.
const FORMAT=/(?![\u200c\u200d])\p{Cf}/u,FORMATS=/(?![\u200c\u200d])\p{Cf}/gu;
// Names a tracker on this PC or the home network would have; they are never contacted.
const LOCAL_NAME=/(?:^|\.)(?:localhost|local|lan|home|internal|intranet|corp|localdomain|home\.arpa)$/i;

function base32Hex(value){
  let bits='';
  for(const char of value.toUpperCase()){const index=BASE32.indexOf(char);if(index<0)return null;bits+=index.toString(2).padStart(5,'0');}
  return bits.length===160?BigInt('0b'+bits).toString(16).padStart(40,'0'):null;
}
// The torrent a magnet link names: its info-hash (40 lowercase hex digits), a
// display name and its trackers. Everything else in the link is dropped, so
// Ravenshelf never contacts web seeds or peer addresses a link suggests.
function parseMagnet(value){
  if(typeof value!=='string'||value.length>MAX_MAGNET||!/^magnet:\?/i.test(value))throw new Error(MESSAGES.invalid);
  let params;try{params=new URLSearchParams(value.slice(value.indexOf('?')+1));}catch{throw new Error(MESSAGES.invalid);}
  let infoHash='',newer=false;
  for(const xt of params.getAll('xt')){
    const v1=/^urn:btih:([0-9a-f]{40}|[a-z2-7]{32})$/i.exec(xt);
    if(v1){
      const hash=v1[1].length===40?v1[1].toLowerCase():base32Hex(v1[1]);
      if(!hash||(infoHash&&infoHash!==hash))throw new Error(MESSAGES.invalid);
      infoHash=hash;
    }else if(/^urn:btmh:/i.test(xt))newer=true;
  }
  if(!infoHash)throw new Error(newer?MESSAGES.version2:MESSAGES.invalid);
  const name=String(params.get('dn')||'').replace(controls,'').replace(FORMATS,'').trim().slice(0,200);
  const trackers=[];
  for(const raw of params.getAll('tr')){
    if(trackers.length>=MAX_TRACKERS)break;
    if(typeof raw!=='string'||raw.length>MAX_TRACKER)continue;
    let u;try{u=new URL(raw);}catch{continue;}
    if(!TRACKER_SCHEMES.has(u.protocol)||u.username||u.password||!u.hostname||u.href.length>MAX_TRACKER)continue;
    // Only public trackers: not this PC, the home network or a name without a dot.
    // udp: is not a web scheme, so its host is read the way a web address's is
    // ("127.1" and "0177.0.0.1" are 127.0.0.1) before it is judged.
    let host;try{host=new URL('http://'+u.host).hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');}catch{continue;}
    if(net.isIP(host)?!isPublicIP(host):(!host.includes('.')||LOCAL_NAME.test(host)))continue;
    if(!trackers.includes(u.href))trackers.push(u.href);
  }
  const magnet='magnet:?xt=urn:btih:'+infoHash+(name?'&dn='+encodeURIComponent(name):'')+trackers.map(tracker=>'&tr='+encodeURIComponent(tracker)).join('');
  return {infoHash,name,trackers,magnet};
}

// A strict bencode reader for torrent files. Integers stay exact (BigInt when
// large), and the byte range of the "info" dictionary is kept, because the
// info-hash is the SHA-1 of exactly those bytes.
function decode(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_META)throw new Error(MESSAGES.damaged);
  let position=0,infoStart=-1,infoEnd=-1;
  const fail=()=>{throw new Error(MESSAGES.damaged);};
  const digitsUntil=end=>{
    const stop=buffer.indexOf(end,position);if(stop<0||stop===position||stop-position>20)fail();
    const text=buffer.toString('latin1',position,stop);position=stop+1;return text;
  };
  function value(depth){
    if(depth>MAX_DEPTH||position>=buffer.length)fail();
    const byte=buffer[position];
    if(byte===0x69){// i<integer>e
      position++;const text=digitsUntil(0x65);
      if(!/^(?:0|-?[1-9][0-9]*)$/.test(text))fail();
      const number=BigInt(text);return number>=BigInt(Number.MIN_SAFE_INTEGER)&&number<=BigInt(Number.MAX_SAFE_INTEGER)?Number(number):number;
    }
    if(byte===0x6c){// l<values>e
      position++;const list=[];
      while(buffer[position]!==0x65){if(position>=buffer.length)fail();list.push(value(depth+1));}
      position++;return list;
    }
    if(byte===0x64){// d<key value>e; a key may appear once
      position++;const dict=new Map();
      while(buffer[position]!==0x65){
        if(position>=buffer.length)fail();
        const name=bytes().toString('latin1');
        if(dict.has(name))fail();
        const start=position,entry=value(depth+1);
        if(depth===0&&name==='info'){infoStart=start;infoEnd=position;}
        dict.set(name,entry);
      }
      position++;return dict;
    }
    if(byte>=0x30&&byte<=0x39)return bytes();
    fail();
  }
  function bytes(){
    if(!(buffer[position]>=0x30&&buffer[position]<=0x39))fail();
    const text=digitsUntil(0x3a);if(!/^(?:0|[1-9][0-9]*)$/.test(text))fail();
    const length=Number(text);if(!Number.isSafeInteger(length)||position+length>buffer.length)fail();
    const out=buffer.subarray(position,position+length);position+=length;return out;
  }
  const root=value(0);
  if(position!==buffer.length||!(root instanceof Map))fail();
  return {root,info:infoStart>=0?buffer.subarray(infoStart,infoEnd):null};
}
const strict=new TextDecoder('utf-8',{fatal:true});
function text(value){
  if(!Buffer.isBuffer(value))throw new Error(MESSAGES.damaged);
  try{return strict.decode(value);}catch{throw new Error(MESSAGES.names);}
}
// One part of a path: kept only when Windows stores it exactly as written.
function safePart(value){
  if(typeof value!=='string'||!value||value.length>MAX_PART||CONTROL.test(value))throw new Error(MESSAGES.names);
  if(value!==safeName(value,'')||value==='.'||value==='..')throw new Error(MESSAGES.names);
  // "~1" is how Windows writes short names, so such a name could open another file.
  if(/~\d/.test(value))throw new Error(MESSAGES.names);
  if(FORMAT.test(value))throw new Error(MESSAGES.deceptive);
  return value;
}
const preferred=(dict,key)=>dict.has(key+'.utf-8')?dict.get(key+'.utf-8'):dict.get(key);
// The torrent's name and files from a .torrent file, after checking that it is
// the torrent the magnet link names. Files are numbered from 1 in the
// torrent's own order, as the downloader numbers them. Paths use "/" between
// folders, as in the torrent; Windows reads them the same way.
function readTorrent(buffer,infoHash){
  const {root,info:raw}=decode(buffer);
  const info=root.get('info');
  if(!(info instanceof Map)||!raw)throw new Error(MESSAGES.damaged);
  if(typeof infoHash!=='string'||crypto.createHash('sha1').update(raw).digest('hex')!==infoHash)throw new Error(MESSAGES.damaged);
  const pieces=info.get('pieces'),pieceLength=info.get('piece length');
  if(info.get('meta version')===2&&!Buffer.isBuffer(pieces))throw new Error(MESSAGES.version2);
  if(!Buffer.isBuffer(pieces)||!pieces.length||pieces.length%20||!Number.isSafeInteger(pieceLength)||pieceLength<1)throw new Error(MESSAGES.damaged);
  const name=safePart(text(preferred(info,'name')));
  const files=[];let total=0;
  if(info.has('files')){
    const list=info.get('files');
    if(!Array.isArray(list)||!list.length)throw new Error(MESSAGES.damaged);
    if(list.length>MAX_FILES)throw new Error(MESSAGES.tooMany);
    const seen=new Set();
    list.forEach((entry,index)=>{
      if(!(entry instanceof Map))throw new Error(MESSAGES.damaged);
      const length=entry.get('length'),parts=preferred(entry,'path');
      if(!Number.isSafeInteger(length)||length<0||!Array.isArray(parts)||!parts.length||parts.length>32)throw new Error(MESSAGES.damaged);
      const relative=[name,...parts.map(part=>safePart(text(part)))];
      // Windows compares names in upper case.
      const key=relative.join('/').toUpperCase();
      if(seen.has(key))throw new Error(MESSAGES.names);
      seen.add(key);
      // A padding file (BEP 47) holds no data of its own and is never downloaded.
      const padding=Buffer.isBuffer(entry.get('attr'))&&entry.get('attr').includes(0x70);
      files.push({index:index+1,path:relative.join('/'),length,padding});
      total+=length;
    });
    // A file and a folder of the same name cannot both exist.
    for(const key of seen){const parts=key.split('/');for(let i=1;i<parts.length;i++)if(seen.has(parts.slice(0,i).join('/')))throw new Error(MESSAGES.names);}
  }else{
    const length=info.get('length');
    if(!Number.isSafeInteger(length)||length<0)throw new Error(MESSAGES.damaged);
    files.push({index:1,path:name,length,padding:false});total=length;
  }
  if(!Number.isSafeInteger(total))throw new Error(MESSAGES.damaged);
  // Names that the checks for browser downloads block (such as "invoice.pdf.exe",
  // or an ending hidden behind spaces) are refused here too.
  const {nameReasons}=require('./link-safety.cjs');
  for(const file of files)for(const part of file.path.split('/'))if(nameReasons(part).some(reason=>reason.level==='blocked'))throw new Error(MESSAGES.deceptive);
  return {infoHash,name,files,totalLength:total,pieceLength};
}

module.exports={MESSAGES,parseMagnet,readTorrent,decode,base32Hex};
