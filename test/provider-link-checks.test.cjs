'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source='https://fuckingfast.co/file123#Game.part01.rar';
const direct='https://files2.fuckingfast.co/dl/token/Game.part01.rar';
const anchor=`<a href="${direct}">Download</a>`;
const passive='<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>';
const code=fs.readFileSync(path.join(__dirname,'../src/providers.cjs'),'utf8');

function response(body=null,{status=200,headers={},url=direct}={}){
  const result=new Response(body,{status,headers});
  Object.defineProperty(result,'url',{value:url});
  return result;
}
function fileResponse(options={}){
  return response(options.body??null,{...options,headers:{
    'content-type':'application/octet-stream','content-length':'4096',
    'content-disposition':'attachment; filename="Game.part01.rar"',...options.headers,
  }});
}
function fixture({page=anchor,pageStatus=200,postStatus=200,redirect=direct,file=()=>fileResponse(),defaultFetch}={}){
  const fastCalls=[],defaultCalls=[];
  const fastFetch=async(url,options={})=>{
    fastCalls.push({url,...options,method:options.method||'GET'});
    if(options.method==='POST')return response(null,{status:postStatus,headers:redirect?{'HX-Redirect':redirect}:{}});
    if(new URL(url).pathname.startsWith('/dl/'))return file(url,options);
    return response(page,{status:pageStatus,headers:{'content-type':'text/html'},url});
  };
  const sandbox={module:{exports:{}},URL,Buffer,TextDecoder,TextEncoder,console,require(name){
    if(name==='./net.cjs')return {safeFetch:async(url,options={})=>{
      defaultCalls.push({url,...options});
      if(!defaultFetch)throw new Error('Unexpected default network request in fixture.');
      return defaultFetch(url,options);
    }};
    return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
  }};
  vm.runInNewContext(code,sandbox,{filename:'providers.cjs'});
  const providers=sandbox.module.exports;
  return {providers,fastFetch,fastCalls,defaultCalls,resolve:value=>providers.resolveLink(value||source,{fastFetch})};
}

test('valid direct link remains ready when the page contains passive Cloudflare scripts',async()=>{
  const f=fixture({page:anchor+passive});
  const result=await f.resolve();
  assert.equal(result.status,'ready');
  assert.equal(result.filename,'Game.part01.rar');
  assert.deepEqual(f.fastCalls.map(call=>call.method),['GET','HEAD']);
  assert.equal(f.defaultCalls.length,0);
});

test('resolver finds this file control among unrelated hx-post elements without executing page scripts',async()=>{
  const page=`<div hx-post="/analytics"></div><button hx-post="/f/other/go">Ad</button><button hx-post="https://ads.example/f/file123/go">Ad</button><button hx-post="/f/file123/go">DOWNLOAD</button>${passive}<script>throw new Error('must never run');</script>`;
  const f=fixture({page});
  const result=await f.resolve();
  assert.equal(result.status,'ready');
  assert.deepEqual(f.fastCalls.map(call=>[call.method,call.url]),[
    ['GET',source],['POST','https://fuckingfast.co/f/file123/go'],['HEAD',direct],
  ]);
  assert.equal(f.fastCalls[1].redirect,'manual');
  assert.equal(f.fastCalls[1].headers['HX-Request'],'true');
});

test('a control for a different file is never submitted',async()=>{
  const f=fixture({page:'<button hx-post="/f/anotherfile/go">Download</button>'+passive});
  const result=await f.resolve();
  assert.equal(result.status,'manual');
  assert.equal(f.fastCalls.length,1);
  assert.match(result.message,/supported direct file link/);
});

test('real challenge pages remain manual and never submit download controls',async()=>{
  for(const options of [
    {page:'<title>Just a moment...</title><form id="challenge-form"></form>'},
    {page:'<button hx-post="/f/file123/go">Download</button>',pageStatus:403},
  ]){
    const f=fixture(options),result=await f.resolve();
    assert.equal(result.status,'manual');
    assert.match(result.message,/verification/);
    assert.equal(f.fastCalls.length,1);
  }
});

test('POST verification errors and off-site redirect targets are not marked ready',async()=>{
  for(const options of [{postStatus:403},{redirect:'https://ads.example/download.rar'},{redirect:'https://fuckingfast.co.evil.example/dl/file'}]){
    const f=fixture({page:'<button hx-post="/f/file123/go">Download</button>',...options});
    const result=await f.resolve();
    assert.equal(result.status,'manual');
    assert.equal(f.fastCalls.filter(call=>call.method==='HEAD').length,0);
  }
});

test('extended filename takes priority in either parameter order and supports a language tag',async()=>{
  for(const disposition of [
    'attachment; filename="Game_part01.rar"; filename*=UTF-8\'\'Game%20part01.rar',
    'attachment; filename*=UTF-8\'en\'Game%20part01.rar; filename="Game_part01.rar"',
  ]){
    const f=fixture({file:()=>fileResponse({headers:{'content-disposition':disposition}})});
    const result=await f.resolve('https://fuckingfast.co/file123#Game%20part01.rar');
    assert.equal(result.status,'ready',result.message);
    assert.equal(result.filename,'Game part01.rar');
  }
});

test('ordinary quoted filenames retain literal percent signs instead of being URI decoded',async()=>{
  const f=fixture({file:()=>fileResponse({headers:{'content-disposition':'attachment; filename="Game%20part01.rar"'}})});
  const result=await f.resolve('https://fuckingfast.co/file123#Game%2520part01.rar');
  assert.equal(result.status,'ready',result.message);
  assert.equal(result.filename,'Game%20part01.rar');
});

test('malformed explicit filenames never fall back to the selected archive name',async()=>{
  for(const disposition of [
    'attachment; filename="advertisement%ZZ.exe"',
    'attachment; filename*=UTF-8\'\'advertisement%ZZ.exe',
    'attachment; filename*=UTF-8\'\'%ff.rar',
    'attachment; filename*=unknown\'\'Game.part01.rar',
    'attachment; filename="Game.part01.rar',
    'attachment; filename=" "',
    'attachment; filename*=UTF-8\'\'%20',
    'attachment; filename="Game.part01.rar"; filename="advertisement.exe"',
    'filename="advertisement.exe"',
  ]){
    const f=fixture({file:()=>fileResponse({headers:{'content-disposition':disposition}})});
    const result=await f.resolve();
    assert.equal(result.status,'manual',disposition);
    assert.match(result.message,/filename|Blocked/);
  }
});

test('filename mismatch, executable bait, and off-site final files retain strict blocking',async()=>{
  for(const options of [
    {headers:{'content-disposition':'attachment; filename="Other.part01.rar"'}},
    {headers:{'content-disposition':'attachment; filename="Game.part01.rar.exe"'}},
    {url:'https://ads.example/Game.part01.rar'},
  ]){
    const f=fixture({file:()=>fileResponse(options)}),result=await f.resolve();
    assert.equal(result.status,'manual');
    assert.match(result.message,/Blocked/);
  }
});

test('HEAD 405 uses a one-byte GET probe, cancels its body and reports total size',async()=>{
  let cancelled=false;
  const f=fixture({file:(_url,options)=>options.method==='HEAD'?response(null,{status:405}):fileResponse({
    body:new ReadableStream({cancel(){cancelled=true;}}),status:206,
    headers:{'content-length':'1','content-range':'bytes 0-0/987654321'},
  })});
  const result=await f.resolve();
  assert.equal(result.status,'ready',result.message);
  assert.equal(result.size,987654321);
  assert.equal(cancelled,true);
  const probe=f.fastCalls.at(-1);
  assert.equal(probe.method,'GET');
  assert.equal(probe.headers.Range,'bytes=0-0');
  assert.equal(probe.timeoutMs,10000);
});

test('HEAD 501 probe handles the observed FuckingFast full-end header quirk without downloading the body',async()=>{
  let cancelled=false;
  const f=fixture({file:(_url,options)=>options.method==='HEAD'?response(null,{status:501}):fileResponse({
    body:new ReadableStream({cancel(){cancelled=true;}}),status:206,
    headers:{'content-length':'1','content-range':'bytes 0-999999/1000000'},
  })});
  const result=await f.resolve();
  assert.equal(result.status,'ready',result.message);
  assert.equal(result.size,1000000);
  assert.equal(cancelled,true);
});

test('a server ignoring the one-byte probe is cancelled immediately instead of downloading the file',async()=>{
  let cancelled=false;
  const f=fixture({file:(_url,options)=>options.method==='HEAD'?response(null,{status:405}):fileResponse({
    body:new ReadableStream({cancel(){cancelled=true;}}),headers:{'content-length':'10000000000'},
  })});
  const result=await f.resolve();
  assert.equal(result.status,'ready');
  assert.equal(cancelled,true);
  assert.equal(result.size,10000000000);
});

test('GET fallback rejects invalid range metadata and HTML rather than claiming readiness',async()=>{
  for(const options of [
    {status:206,headers:{'content-length':'1','content-range':'bytes 1-1/4096'}},
    {status:206,headers:{'content-length':'1','content-range':'bytes 0-0/0'}},
    {status:206,headers:{'content-length':'1','content-range':'bytes 0-0/9007199254740992'}},
    {status:200,headers:{'content-type':'text/html'}},
    {status:200,headers:{'content-type':'application/xhtml+xml'}},
    {status:200,headers:{'content-type':'text/javascript'}},
    {status:200,headers:{'content-type':'text/xml'}},
  ]){
    const f=fixture({file:(_url,request)=>request.method==='HEAD'?response(null,{status:405}):fileResponse(options)});
    const result=await f.resolve();
    assert.equal(result.status,'manual');
  }
});

test('HEAD 403 remains a verification error without issuing GET requests to bypass it',async()=>{
  const f=fixture({file:()=>response(null,{status:403})});
  const result=await f.resolve();
  assert.equal(result.status,'manual');
  assert.deepEqual(f.fastCalls.map(call=>call.method),['GET','HEAD']);
});

test('direct FuckingFast links use the injected transport while other hosts and catalog use the default',async()=>{
  const f=fixture({defaultFetch:async(url,options)=>options.method==='HEAD'?fileResponse({url}):response('<html><body>No games</body></html>',{headers:{'content-type':'text/html'},url})});
  assert.equal((await f.resolve(direct)).status,'ready');
  assert.equal(f.fastCalls.length,1);
  const other=await f.providers.resolveLink('https://files.example.org/Game.part01.rar',{fastFetch:f.fastFetch});
  assert.equal(other.status,'ready');
  await f.providers.listGames();
  assert.equal(f.fastCalls.length,1);
  assert.equal(f.defaultCalls.length,2);
  assert.equal(f.defaultCalls[0].url,'https://files.example.org/Game.part01.rar');
  assert.equal(new URL(f.defaultCalls[1].url).hostname,'fitgirl-repacks.site');
});
