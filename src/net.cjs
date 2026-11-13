'use strict';
const dns = require('node:dns');
const net = require('node:net');
const { Agent, fetch } = require('undici');
const {assertFastRedirect}=require('./ff-policy.cjs');
const {closedHost}=require('./hosts.cjs');
const {sanitizedReferrer,originReferrer}=require('./referrer-policy.cjs');
// Hosts that have shut down are never contacted, also through a redirect:
// their expired names can belong to someone else now.
function assertOpenHost(url){const gone=closedHost(url.hostname);if(gone)throw new Error(gone.message);}

function isPublicIP(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100&&b>=64&&b<=127) ||
      (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0||b===2)) ||
      (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0));
  }
  if (net.isIP(address) === 6) {
    const a=new URL('https://['+address+']/').hostname.slice(1,-1);
    const [first,second]=a.split(':').map(x=>parseInt(x||'0',16));
    return first>=0x2000 && first<=0x3fff && first!==0x2002 &&
      !(first===0x2001&&(second<0x200||second===0xdb8)) && !(first===0x3fff&&second<0x1000);
  }
  return false;
}
function safeURL(value) {
  if (typeof value!=='string' || value.length>16384) throw new Error('Invalid web address.');
  const u = new URL(value);
  const hostname=u.hostname.replace(/^\[|\]$/g,'');
  const allowedPort=!u.port || u.port==='443' || (u.port==='8443' && /^fs[0-9]+\.filekeeper\.net$/.test(hostname));
  if(u.protocol!=='https:' || u.username || u.password || !allowedPort ||
    hostname==='localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.') || (net.isIP(hostname) && !isPublicIP(hostname))) {
    throw new Error('Only public HTTPS web addresses are supported.');
  }
  return u;
}
// Validate the actual addresses used by the socket, preventing DNS rebinding into local services.
const connect = { timeout:20000, lookup(host,options,callback) {
  dns.lookup(host,{all:true,verbatim:true},(err,addresses)=>{
    if(err) return callback(err);
    if(!addresses.length || addresses.some(x=>!isPublicIP(x.address))) return callback(new Error('Private network destination blocked.'));
    let eligible=options.family ? addresses.filter(x=>x.family===Number(options.family)) : addresses;
    if(!eligible.length) return callback(new Error('No compatible public address.'));
    if(options.all) callback(null,eligible); else callback(null,eligible[0].address,eligible[0].family);
  });
}};
const dispatcher = new Agent({ connect });
// File transfers use HTTP/1.1. Over HTTP/2 every request to a host shares one
// connection, so split downloads would all ride the same, possibly slow, link.
const fileDispatcher = new Agent({ connect, allowH2:false });
async function safeFetch(value, options={}) {
  let url=safeURL(String(value));
  assertOpenHost(url);
  const originalUrl=url.href;
  let {timeoutMs=30000,maxBytes,http1=false,checkRedirect, ...init}=options;
  const signal = timeoutMs>0 ? (init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : init.signal;
  const headers = new Headers(init.headers || {});
  for(const name of ['Referer','HX-Current-URL']) if(headers.has(name)) {
    const clean=sanitizedReferrer(headers.get(name));
    if(clean)headers.set(name,clean);else headers.delete(name);
  }
  if(!headers.has('User-Agent')) headers.set('User-Agent','Mozilla/5.0 Ravenshelf/0.3');
  let method=init.method || 'GET', body=init.body;
  for(let n=0;n<8;n++) {
    const res=await fetch(url.href,{...init,method,body,headers,signal,dispatcher:http1?fileDispatcher:dispatcher,redirect:'manual'});
    if(![301,302,303,307,308].includes(res.status) || options.redirect==='manual') return res;
    const location=res.headers.get('location');
    await res.body?.cancel();
    if(!location) throw new Error('Host returned a redirect without a destination.');
    const next=safeURL(new URL(location,url).href);
    assertOpenHost(next);
    assertFastRedirect(originalUrl,next.href);
    // The caller can refuse a destination, such as one outside a site's own file servers.
    if(checkRedirect) checkRedirect(next.href);
    if(next.origin!==url.origin) {
      headers.delete('authorization'); headers.delete('cookie');
      for(const name of ['Referer','HX-Current-URL']) {
        const origin=originReferrer(headers.get(name));
        if(origin)headers.set(name,origin);else headers.delete(name);
      }
    }
    if(res.status===303 || ((res.status===301||res.status===302)&&method==='POST')) {
      method='GET'; body=undefined; headers.delete('content-type'); headers.delete('content-length');
    }
    url=next;
  }
  throw new Error('Too many host redirects.');
}
module.exports={safeFetch,safeURL,isPublicIP};
