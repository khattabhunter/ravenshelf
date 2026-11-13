'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const net=require('node:net');
const {safeURL,isPublicIP}=require('../src/net.cjs');

test('network guard permits normal public HTTPS destinations',()=>{
 for(const url of ['https://fitgirl-repacks.site/game/','https://example.org/file.zip','https://1.1.1.1/','https://[2606:4700:4700::1111]/','https://example.org:443/file']) assert.equal(safeURL(url).protocol,'https:');
});
test('network guard rejects local IPv4, alternate numeric notation and mapped IPv6',()=>{
 for(const url of ['https://127.0.0.1/','https://127.1/','https://2130706433/','https://0x7f000001/','https://10.1.2.3/','https://172.16.0.1/','https://192.168.1.1/','https://169.254.169.254/','https://[::1]/','https://[::ffff:127.0.0.1]/','https://[::ffff:192.168.1.1]/','https://[fe80::1]/','https://[fc00::1]/']) assert.throws(()=>safeURL(url),undefined,url);
});
test('network guard rejects userinfo, insecure/custom schemes and local hostnames',()=>{
 for(const url of ['https://user:secret@example.org/file','http://example.org/file','file:///C:/Windows/system.ini','javascript:alert(1)','data:text/plain,hello','ftp://example.org/file','https://localhost/','https://sub.localhost/','https://printer.local/','https://example.org./']) assert.throws(()=>safeURL(url),undefined,url);
});
test('only exact FileKeeper file-server family receives port 8443 exception',()=>{
 for(const url of ['https://fs2.filekeeper.net:8443/file','https://fs123.filekeeper.net:8443/file']) assert.equal(safeURL(url).port,'8443');
 for(const url of ['https://filekeeper.net:8443/file','https://fs2.filekeeper.net.evil.example:8443/file','https://evil-fs2.filekeeper.net:8443/file','https://fsx.filekeeper.net:8443/file','https://fs2.filekeeper.net:8444/file','https://example.org:8080/file','https://fs2.filekeeper.net:8443@localhost/file']) assert.throws(()=>safeURL(url),undefined,url);
});
test('address policy excludes private, link-local, shared, multicast and documentation addresses',()=>{
 for(const address of ['0.0.0.0','10.0.0.1','100.64.0.1','100.127.255.254','127.0.0.1','169.254.1.1','172.31.255.255','192.168.1.1','192.0.2.1','198.18.0.1','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:8.8.8.8','fc00::1','fe80::1','ff02::1','2001:db8::1','2002:7f00:1::','not-an-address']) assert.equal(isPublicIP(address),false,address);
 for(const address of ['1.1.1.1','8.8.8.8','172.15.255.255','172.32.0.1','100.128.0.1','2606:4700:4700::1111']) assert.equal(isPublicIP(address),true,address);
});
test('IPv6 special-address rejection is independent of compressed or padded notation',()=>{
 // IANA IPv6 special registry: Teredo, benchmarking, and documentation prefixes.
 for(const address of ['2001::1','2001:0000::1','2001:2::1','2001:db8::1','2001:0db8::1','3fff::1','3fff:fff::1']) {
   assert.equal(isPublicIP(address),false,address);
   assert.throws(()=>safeURL(`https://[${address}]/file`),undefined,address);
 }
});

function harness(fetcher,addresses=[{address:'93.184.216.34',family:4}]) {
 let agentOptions;
 const source=fs.readFileSync(path.join(__dirname,'../src/net.cjs'),'utf8');
 const sandbox={module:{exports:{}},URL,Headers,AbortSignal,require(name){
   if(name==='node:net')return net;
   if(name==='node:dns')return {lookup(host,opts,cb){cb(null,addresses);}};
   if(name==='undici')return {Agent:class {constructor(options){agentOptions=options;}},fetch:fetcher};
   if(name==='./ff-policy.cjs')return require('../src/ff-policy.cjs');
   if(name==='./hosts.cjs')return require('../src/hosts.cjs');
   if(name==='./referrer-policy.cjs')return require('../src/referrer-policy.cjs');
   throw Error('Unexpected dependency: '+name);
 }};
 vm.runInNewContext(source,sandbox,{filename:'net.cjs'});
 return {...sandbox.module.exports,lookup(host='example.org',options={}){return new Promise((resolve,reject)=>agentOptions.connect.lookup(host,options,(error,value)=>error?reject(error):resolve(value)));}};
}
test('socket DNS check rejects mixed public/private answers before connection',async()=>{
 const h=harness(()=>{},[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}]);
 await assert.rejects(h.lookup(),/Private network/);
});
test('socket DNS check accepts public answer and honors requested family',async()=>{
 const h=harness(()=>{});assert.equal(await h.lookup(),'93.184.216.34');
 await assert.rejects(h.lookup('example.org',{family:6}),/No compatible public address/);
});
test('redirects cannot reach a local or insecure destination',async()=>{
 for(const destination of ['https://127.0.0.1/private','http://example.org/file']) {
   let calls=0;const h=harness(async()=>{calls++;return new Response(null,{status:302,headers:{location:destination}});});
   await assert.rejects(h.safeFetch('https://example.org/file'),/Only public HTTPS/);assert.equal(calls,1);
 }
});
test('cross-origin redirects strip credentials and turn ordinary POST redirect into GET',async()=>{
 const seen=[];const h=harness(async(url,options)=>{
   seen.push({url,method:options.method,body:options.body,headers:new Headers(options.headers)});
   return seen.length===1?new Response(null,{status:302,headers:{location:'https://other.example/file'}}):new Response(null,{status:200});
 });
 await h.safeFetch('https://example.org/form',{method:'POST',body:'token=value',headers:{Cookie:'session=secret',Authorization:'Bearer secret','Content-Type':'application/x-www-form-urlencoded'}});
 assert.equal(seen.length,2);assert.equal(seen[1].method,'GET');assert.equal(seen[1].body,undefined);
 assert.equal(seen[1].headers.has('Cookie'),false);assert.equal(seen[1].headers.has('Authorization'),false);assert.equal(seen[1].headers.has('Content-Type'),false);
});
test('manual redirect mode leaves the host form destination for the caller',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://other.example/file'}});});
 const result=await h.safeFetch('https://example.org/form',{redirect:'manual'});
 assert.equal(result.status,302);assert.equal(calls,1);await result.body?.cancel();
});

test('referrers discard private queries and fragments and lose paths across origins',async()=>{
 const seen=[];const h=harness(async(url,options)=>{
   seen.push(new Headers(options.headers));
   if(seen.length===1)return new Response(null,{status:302,headers:{location:'/next'}});
   if(seen.length===2)return new Response(null,{status:302,headers:{location:'https://cdn.example.net/file'}});
   return new Response('file');
 });
 await h.safeFetch('https://files.example.org/start',{headers:{rEfErEr:'https://provider.example.org/download/123?private_token=fixture#private-fragment','HX-Current-URL':'https://provider.example.org/download/123?private_token=fixture#private-fragment'}});
 for(const name of ['Referer','HX-Current-URL']) assert.deepEqual(seen.map(headers=>headers.get(name)),['https://provider.example.org/download/123','https://provider.example.org/download/123','https://provider.example.org/']);
 assert.ok(seen.every(headers=>!JSON.stringify([...headers]).includes('private')));
});

test('invalid and local referrer values are omitted without changing the file request',async()=>{
 for(const referer of ['https://user:password@example.org/private','http://example.org/private','https://192.168.1.1/private','https://files.local/private','not a URL']){
   let seen;const h=harness(async(url,options)=>{seen=new Headers(options.headers);return new Response('ok');});
   assert.equal(await(await h.safeFetch('https://files.example.org/file',{headers:{Referer:referer,'HX-Current-URL':referer}})).text(),'ok');
   assert.equal(seen.has('Referer'),false);assert.equal(seen.has('HX-Current-URL'),false);
 }
});
test('a caller can refuse where a request is sent on to, before that address is contacted',async()=>{
 const hops={'https://a.example.org/1':'https://b.example.org/2','https://b.example.org/2':'/3?x=1','https://b.example.org/3?x=1':'https://c.example.net/4'};
 const calls=[];
 const h=harness(async(url,init)=>{calls.push({url:String(url),keys:Object.keys(init)});const next=hops[String(url)];return next?new Response(null,{status:302,headers:{location:next}}):new Response('the file');});
 const seen=[];
 const response=await h.safeFetch('https://a.example.org/1',{checkRedirect:next=>{seen.push(next);}});
 assert.equal(await response.text(),'the file');
 assert.deepEqual(seen,['https://b.example.org/2','https://b.example.org/3?x=1','https://c.example.net/4'],'asked about each address in turn, in full');
 assert.deepEqual(calls.map(call=>call.url),['https://a.example.org/1','https://b.example.org/2','https://b.example.org/3?x=1','https://c.example.net/4']);
 assert.ok(calls.every(call=>!call.keys.includes('checkRedirect')),'the rule itself is not passed on to the network library');
 // Refusing stops the request there: the refused address is never contacted.
 calls.length=0;
 await assert.rejects(h.safeFetch('https://a.example.org/1',{checkRedirect:next=>{if(next.startsWith('https://c.example.net/'))throw new Error('Not there.');}}),/^Error: Not there\.$/);
 assert.deepEqual(calls.map(call=>call.url),['https://a.example.org/1','https://b.example.org/2','https://b.example.org/3?x=1']);
 // It is asked only about addresses that pass the checks every request gets, and not at all without a hand-over.
 let asked=0;
 const local=harness(async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));
 await assert.rejects(local.safeFetch('https://example.org/file',{checkRedirect:()=>{asked++;}}),/Only public HTTPS/);
 const direct=harness(async()=>new Response('ok'));
 await direct.safeFetch('https://example.org/file',{checkRedirect:()=>{asked++;}});
 const manual=harness(async()=>new Response(null,{status:302,headers:{location:'https://example.net/next'}}));
 assert.equal((await manual.safeFetch('https://example.org/file',{redirect:'manual',checkRedirect:()=>{asked++;}})).status,302);
 assert.equal(asked,0);
});

test('hosts that have shut down are never contacted, also through a redirect',async()=>{
 const calls=[];
 const h=harness(async url=>{calls.push(url);return url.includes('short.example')?new Response(null,{status:302,headers:{location:'https://www.zippyshare.com/v/x/file.html'}}):new Response('ok');});
 await assert.rejects(h.safeFetch('https://letsupload.io/file/abc'),/^Error: LetsUpload has shut down/);
 await assert.rejects(h.safeFetch('https://cdn.bayfiles.com/x'),/^Error: BayFiles closed in August 2023/);
 assert.deepEqual(calls,[],'nothing is requested from a closed host');
 await assert.rejects(h.safeFetch('https://short.example/abc'),/^Error: ZippyShare closed in March 2023/);
 assert.deepEqual(calls,['https://short.example/abc'],'the redirect to a closed host is not followed');
 // A look-alike name is not a closed host.
 assert.equal(await (await h.safeFetch('https://zippyshare.com.example/x')).text(),'ok');
});
