'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFastSessionFetch}=require('../src/fast-session.cjs');
const page='https://fuckingfast.co/abcdefgh1234#Example.part1.rar';
const direct='https://cdn.fuckingfast.co/dl/token/Example.part1.rar';
function fixture({fetcher=async()=>new Response('<html>file page</html>'),endpoints=[{address:'1.1.1.1'}],nodeFetch}={}){
  const calls=[],roots=[],cookieQueries=[];
  const ses={
    resolveHost:async(host,options)=>{calls.push({kind:'dns',host,options});return {endpoints};},
    getUserAgent:()=> 'Chromium fixture user agent',
    cookies:{get:async options=>{cookieQueries.push(options);return [{name:'clearance_fixture',value:'not-a-real-secret'}];}},
    fetch:async(url,options)=>{calls.push({kind:'page',url,options});return fetcher(url,options);},
  };
  const fastFetch=createFastSessionFetch({getSession:root=>{roots.push(root);return ses;},nodeFetch:nodeFetch||(async(url,options)=>{calls.push({kind:'file',url,options});return new Response(null,{headers:{'content-length':'123'}});})});
  return {fastFetch,calls,roots,cookieQueries,ses};
}
test('fixed landing page uses shared Chromium session without stale credentials or a user agent override',async()=>{
  const f=fixture();const response=await f.fastFetch(page,{headers:{'User-Agent':'old-node',Cookie:'stale',Authorization:'Bearer stale'}});
  assert.equal(response.url,'https://fuckingfast.co/abcdefgh1234');assert.match(await response.text(),/file page/);
  assert.deepEqual(f.roots,['fuckingfast.co']);const request=f.calls.find(c=>c.kind==='page');
  assert.equal(request.options.credentials,'include');assert.equal(request.options.redirect,'manual');assert.equal(request.options.bypassCustomProtocolHandlers,true);
  for(const name of ['user-agent','cookie','authorization'])assert.equal(request.options.headers.has(name),false);
});
test('Chromium page and form requests send clean referrers without page tokens or fragments',async()=>{
  const f=fixture();
  await f.fastFetch(page,{headers:{Referer:'https://fuckingfast.co/abcdefgh1234?private=synthetic-secret#private-fragment','HX-Current-URL':'https://fuckingfast.co/abcdefgh1234?private=other-secret#private-fragment'}});
  const headers=f.calls.find(call=>call.kind==='page').options.headers;
  assert.equal(headers.get('Referer'),'https://fuckingfast.co/abcdefgh1234');
  assert.equal(headers.get('HX-Current-URL'),'https://fuckingfast.co/abcdefgh1234');
  for(const value of ['https://user:password@page.example/private','https://127.0.0.1/private','https://printer.local/private','http://page.example/private']){
    const denied=fixture();await denied.fastFetch(page,{headers:{Referer:value,'HX-Current-URL':value}});
    const sent=denied.calls.find(call=>call.kind==='page').options.headers;
    assert.equal(sent.has('Referer'),false);assert.equal(sent.has('HX-Current-URL'),false);
  }
});
test('a page redirect to a file origin drops the referrer path before Node receives it',async()=>{
  const f=fixture({fetcher:async()=>new Response(null,{status:302,headers:{location:direct}})});
  const response=await f.fastFetch(page,{headers:{Referer:'https://fuckingfast.co/abcdefgh1234?token=synthetic-secret#filename','HX-Current-URL':'https://fuckingfast.co/abcdefgh1234?token=another-secret#filename'}});
  await response.body?.cancel();
  assert.equal(f.calls.find(call=>call.kind==='page').options.headers.get('Referer'),'https://fuckingfast.co/abcdefgh1234');
  assert.equal(f.calls.find(call=>call.kind==='file').options.headers.get('Referer'),'https://fuckingfast.co/');
  assert.equal(f.calls.find(call=>call.kind==='page').options.headers.get('HX-Current-URL'),'https://fuckingfast.co/abcdefgh1234');
  assert.equal(f.calls.find(call=>call.kind==='file').options.headers.get('HX-Current-URL'),'https://fuckingfast.co/');
  const initial=fixture();await(await initial.fastFetch(direct,{headers:{Referer:'https://fuckingfast.co/abcdefgh1234#filename'}})).body?.cancel();
  assert.equal(initial.calls.find(call=>call.kind==='file').options.headers.get('Referer'),'https://fuckingfast.co/abcdefgh1234','an intentional initial provider request may keep its clean page path');
});
test('arbitrary sites, subdomain pages, paths, query strings and methods cannot enter Chromium transport',async()=>{
  const f=fixture();
  for(const url of ['https://evil.example/abcdefgh','https://fuckingfast.co.evil.example/abcdefgh','https://cdn.fuckingfast.co/abcdefgh','https://fuckingfast.co/ads/show','https://fuckingfast.co/abcdefgh?redirect=bad','https://127.0.0.1/file','http://fuckingfast.co/abcdefgh'])await assert.rejects(f.fastFetch(url));
  await assert.rejects(f.fastFetch(page,{method:'POST'}));await assert.rejects(f.fastFetch(page,{method:'DELETE'}));
  assert.equal(f.calls.length,0);
});
test('session resolver rejects private, mixed and empty address sets before making a request',async()=>{
  for(const endpoints of [[{address:'127.0.0.1'}],[{address:'1.1.1.1'},{address:'10.0.0.1'}],[]]){
    const f=fixture({endpoints});await assert.rejects(f.fastFetch(page),/private|unsupported/);assert.equal(f.calls.some(c=>c.kind==='page'),false);
  }
});
test('ordinary same-root form response exposes only a validated direct-file HX redirect',async()=>{
  const f=fixture({fetcher:async()=>new Response(null,{headers:{'HX-Redirect':direct}})});
  const response=await f.fastFetch('https://fuckingfast.co/f/abcdefgh1234/go',{method:'POST',redirect:'manual',headers:{'HX-Request':'true'}});
  assert.equal(response.headers.get('hx-redirect'),direct);assert.equal(f.calls.at(-1).options.method,'POST');
  const malicious=fixture({fetcher:async()=>new Response(null,{headers:{'HX-Redirect':'https://evil.example/ad.exe'}})});
  await assert.rejects(malicious.fastFetch('https://fuckingfast.co/f/abcdefgh1234/go',{method:'POST'}));
});
test('HTTP redirects are checked even when caller asks for manual handling',async()=>{
  for(const destination of ['https://evil.example/ads','https://cdn.fuckingfast.co/ads','https://fuckingfast.co/ads/go/now']){
    const f=fixture({fetcher:async()=>new Response(null,{status:302,headers:{location:destination}})});
    await assert.rejects(f.fastFetch(page,{redirect:'manual'}));assert.equal(f.calls.filter(c=>c.kind==='page').length,1);
  }
});
test('validated redirects track final URL instead of Electron response.url',async()=>{
  const f=fixture({fetcher:async url=>url.endsWith('/abcdefgh1234')?new Response(null,{status:302,headers:{location:'/otherfile123'}}):new Response('done')});
  const response=await f.fastFetch(page);assert.equal(response.url,'https://fuckingfast.co/otherfile123');assert.equal(await response.text(),'done');
});
test('direct-file metadata uses DNS-pinned Node transport and cookies scoped to exact file URL',async()=>{
  const f=fixture();const response=await f.fastFetch(direct,{method:'HEAD',headers:{'Accept-Encoding':'identity'}});await response.body?.cancel();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'file');assert.equal(f.calls[0].options.method,'HEAD');
  assert.equal(f.calls[0].options.headers.get('user-agent'),'Chromium fixture user agent');
  assert.equal(f.calls[0].options.headers.get('cookie'),'clearance_fixture=not-a-real-secret');
  assert.deepEqual(f.cookieQueries,[{url:direct}]);
  const headers=await f.fastFetch.getDownloadHeaders(direct);assert.equal(headers['User-Agent'],'Chromium fixture user agent');
  await assert.rejects(f.fastFetch.getDownloadHeaders('https://fuckingfast.co/abcdefgh1234'));
});
test('deadline remains active after headers and aborts a stalled response body',async()=>{
  const f=fixture({fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('prefix'));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}))});
  const keepAlive=setTimeout(()=>{},250);
  try{const response=await f.fastFetch(page,{timeoutMs:25});await assert.rejects(response.text(),/timeout|aborted/i);}finally{clearTimeout(keepAlive);}
});
test('caller cancellation remains connected to page body',async()=>{
  const controller=new AbortController();
  const f=fixture({fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(stream){signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});}}))});
  const response=await f.fastFetch(page,{signal:controller.signal});const reading=response.text();controller.abort(new Error('fixture cancelled'));await assert.rejects(reading,/fixture cancelled/);
});
test('redirect loops stop at a bounded number of requests',async()=>{
  const f=fixture({fetcher:async()=>new Response(null,{status:302,headers:{location:'/abcdefgh1234'}})});
  await assert.rejects(f.fastFetch(page),/Too many/);assert.equal(f.calls.filter(c=>c.kind==='page').length,6);
});
