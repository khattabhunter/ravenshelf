'use strict';
// Protects saved download request headers (host cookies, authorization and
// referrers) while they sit in library.json. In the app the storage is
// Electron safeStorage, which on Windows uses DPAPI tied to the signed-in
// Windows account. Tests inject a fake storage object.
const PREFIX='atlas-sealed-v1:';
const MAX_SEALED_LENGTH=1024*1024;
const HEADER_NAME=/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;

function cleanHeaders(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const out={};
  for(const [name,content] of Object.entries(value)){
    if(name==='__proto__'||!HEADER_NAME.test(name)||typeof content!=='string'||content.length>65536||/[\r\n\0]/.test(content))continue;
    out[name]=content;
  }
  return out;
}

function createHeaderVault(storage){
  const available=()=>{try{return Boolean(storage&&storage.isEncryptionAvailable());}catch{return false;}};
  return {
    available,
    // Returns a sealed string, or null when encryption is unavailable.
    seal(headers){
      const clean=cleanHeaders(headers);
      if(!clean||!Object.keys(clean).length||!available())return null;
      try{
        const sealed=storage.encryptString(JSON.stringify(clean));
        if(!Buffer.isBuffer(sealed)||!sealed.length)return null;
        return PREFIX+sealed.toString('base64');
      }catch{return null;}
    },
    // Returns the original headers, or null if they cannot be read on this
    // Windows account (for example, a profile copied from another PC).
    open(value){
      if(typeof value!=='string'||!value.startsWith(PREFIX)||value.length>MAX_SEALED_LENGTH||!available())return null;
      const encoded=value.slice(PREFIX.length);
      if(!encoded||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return null;
      try{return cleanHeaders(JSON.parse(storage.decryptString(Buffer.from(encoded,'base64'))));}
      catch{return null;}
    }
  };
}
module.exports={createHeaderVault,cleanHeaders,PREFIX};
