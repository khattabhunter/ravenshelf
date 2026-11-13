'use strict';
// Browser page context is not a download address. Keep only its public origin;
// never copy page tokens, fragments, credentials or local addresses into a
// request header. Provider code may deliberately retain a clean page path.
const net=require('node:net');
const MAX_CONTEXT_URL=8192;

function contextURL(value,{httpsOnly=false}={}){
  if(typeof value!=='string'||!value||value.length>MAX_CONTEXT_URL||/[\x00-\x20\x7f]/.test(value))return undefined;
  let url;try{url=new URL(value);}catch{return undefined;}
  if(!(httpsOnly?url.protocol==='https:':['https:','http:'].includes(url.protocol))||url.username||url.password)return undefined;
  const host=url.hostname.toLowerCase(),literal=host.replace(/^\[|\]$/g,'');
  // No DNS query is made just to send a referrer. Numeric addresses and known
  // local-name forms are omitted, including URL-normalized legacy IP forms.
  if(!host.includes('.')||host.endsWith('.')||net.isIP(literal)||
    /(?:^|\.)(?:localhost|local|localdomain|internal|lan)$/.test(host)||host==='home.arpa'||host.endsWith('.home.arpa'))return undefined;
  url.search='';url.hash='';
  return url;
}
function contextOrigin(value){const url=contextURL(value);return url?url.origin+'/':undefined;}
function sanitizedReferrer(value){const url=contextURL(value,{httpsOnly:true});return url?.href;}
function originReferrer(value){const url=contextURL(value,{httpsOnly:true});return url?url.origin+'/':undefined;}
module.exports={contextOrigin,sanitizedReferrer,originReferrer,MAX_CONTEXT_URL};
