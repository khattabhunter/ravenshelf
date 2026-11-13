'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {imageResponse,MAX_IMAGE_BYTES}=require('../src/image-loader.cjs');

const fixtures={
  'image/png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=','base64'),
  'image/jpeg':Buffer.from([255,216,255,224,0,2,255,217]),
  'image/gif':Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),
  'image/webp':Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')
};
const route=(target='https://images.example.org/cover.png',options={})=>new Request('atlas://app/image?url='+encodeURIComponent(target),options);
const remote=(bytes=fixtures['image/png'],headers={})=>new Response(bytes,{headers:{'content-type':'image/png',...headers}});

test('checked image route returns bounded raster bytes and only controlled response headers',async()=>{
  for(const [type,bytes] of Object.entries(fixtures)){
    const result=await imageResponse(route(),{fetcher:async()=>remote(bytes,{'content-type':type+'; charset=binary','set-cookie':'private=fixture','x-upstream':'not-forwarded'})});
    assert.equal(result.status,200,type);assert.equal(result.headers.get('content-type'),type);
    assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('x-content-type-options'),'nosniff');
    assert.equal(result.headers.has('set-cookie'),false);assert.equal(result.headers.has('x-upstream'),false);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
  }
});

test('images never forward browser cookies, authorization, referrer or local request headers',async()=>{
  let captured;
  const request=route('https://images.example.org/cover.png#local-fragment',{headers:{Cookie:'fixture-cookie',Authorization:'Bearer fixture',Referer:'atlas://app/index.html','X-Local-Path':'fixture-path'}});
  const result=await imageResponse(request,{fetcher:async(url,options)=>{captured={url,...options};return remote();}});
  assert.equal(result.status,200);assert.equal(captured.url,'https://images.example.org/cover.png');
  assert.equal(captured.credentials,'omit');assert.equal(captured.referrerPolicy,'no-referrer');assert.equal(captured.method,'GET');
  assert.deepEqual(Object.keys(captured.headers).sort(),['Accept','Accept-Encoding']);
});

test('private, credentialed and non-HTTPS image destinations never reach the fetcher',async()=>{
  let requests=0;
  for(const target of ['https://127.0.0.1/a.png','https://2130706433/a.png','https://10.1.2.3/a.png','https://169.254.169.254/a.png','https://[::1]/a.png','https://[::ffff:127.0.0.1]/a.png','https://printer.local/a.png','https://localhost/a.png','https://user:fixture@example.org/a.png','http://example.org/a.png','file:///C:/private.png','data:image/png,fixture','https://example.org:8080/a.png']){
    const result=await imageResponse(route(target),{fetcher:async()=>{requests++;return remote();}});
    assert.equal(result.status,502,target);assert.equal(await result.text(),'Image unavailable');
  }
  assert.equal(requests,0);
});

test('invalid image route, methods and duplicate query values fail closed',async()=>{
  let requests=0;
  for(const request of [new Request('atlas://other/image?url=https://example.org/a.png'),new Request('atlas://app/other?url=https://example.org/a.png'),new Request('atlas://app/image?url=https://example.org/a.png&url=https://example.org/b.png'),new Request('atlas://app/image?url=https://example.org/a.png&secret=fixture'),route(undefined,{method:'POST',body:'fixture'})]){
    assert.equal((await imageResponse(request,{fetcher:async()=>{requests++;return remote();}})).status,502);
  }
  assert.equal(requests,0);
});

test('SVG, HTML, MIME mismatches, non-image responses and partial responses are rejected',async()=>{
  for(const response of [remote(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),{'content-type':'image/svg+xml'}),remote(Buffer.from('<html>fixture</html>'),{'content-type':'text/html'}),remote(Buffer.from('<html>fixture</html>')),remote(fixtures['image/png'],{'content-type':'image/jpeg'}),remote(Buffer.alloc(0)),new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}),new Response(fixtures['image/png'],{status:206,headers:{'content-type':'image/png'}})]){
    assert.equal((await imageResponse(route(),{fetcher:async()=>response})).status,502);
  }
});

test('oversized declared body is cancelled without reading; untrusted length and encoding fail closed',async()=>{
  for(const headers of [{'content-length':String(MAX_IMAGE_BYTES+1)},{'content-length':'NaN'},{'content-length':'-1'},{'content-encoding':'gzip'}]){
    let cancelled=false;
    const stream=new ReadableStream({cancel(){cancelled=true;}},{highWaterMark:0});
    const result=await imageResponse(route(),{fetcher:async()=>new Response(stream,{headers:{'content-type':'image/png',...headers}})});
    assert.equal(result.status,502);assert.equal(cancelled,true);
  }
});

test('chunked bodies cannot exceed the actual byte limit and are cancelled on overflow',async()=>{
  let pulls=0,cancelled=false;
  const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(9));},cancel(){cancelled=true;}},{highWaterMark:0});
  const result=await imageResponse(route(),{maxBytes:16,fetcher:async()=>new Response(stream,{headers:{'content-type':'image/png'}})});
  assert.equal(result.status,502);assert.equal(pulls,2);assert.equal(cancelled,true);
});

test('declared-size mismatch is not returned as a successful image',async()=>{
  const result=await imageResponse(route(),{fetcher:async()=>remote(fixtures['image/png'],{'content-length':'1'})});
  assert.equal(result.status,502);
});

test('deadline covers stalled body reads and cancels the stream',async()=>{
  let cancelled=false;
  const keepAlive=setTimeout(()=>{},1000);
  try{
    const stream=new ReadableStream({cancel(){cancelled=true;}},{highWaterMark:0});
    const result=await imageResponse(route(),{timeoutMs:20,fetcher:async()=>new Response(stream,{headers:{'content-type':'image/png'}})});
    assert.equal(result.status,502);assert.equal(cancelled,true);
  }finally{clearTimeout(keepAlive);}
});

test('cancellation is propagated and already aborted image requests do not fetch',async()=>{
  const controller=new AbortController();controller.abort();let requests=0;
  assert.equal((await imageResponse(route(undefined,{signal:controller.signal}),{fetcher:async()=>{requests++;return remote();}})).status,502);
  assert.equal(requests,0);
});

function guardedFetch(addresses,responder){
  let connectionOptions,connections=0;
  const context={module:{exports:{}},URL,Headers,AbortSignal,require(name){
    if(name==='node:dns')return {lookup(_host,_options,callback){callback(null,addresses);}};
    if(name==='undici')return {Agent:class{constructor(options){connectionOptions=options.connect;}},fetch:async(url,options)=>{
      await new Promise((resolve,reject)=>connectionOptions.lookup(new URL(url).hostname,{},error=>error?reject(error):resolve()));
      connections++;return responder(url,options);
    }};
    if(name==='./ff-policy.cjs')return require('../src/ff-policy.cjs');
    if(name==='./hosts.cjs')return require('../src/hosts.cjs');
    return require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/net.cjs'),'utf8'),context);
  return {fetcher:context.module.exports.safeFetch,connections:()=>connections};
}

test('checked images retain socket DNS protection against private and mixed answers',async()=>{
  for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'1.1.1.1',family:4},{address:'192.168.1.1',family:4}]]){
    const network=guardedFetch(addresses,()=>remote());
    assert.equal((await imageResponse(route(),network)).status,502);assert.equal(network.connections(),0);
  }
});

test('image redirects are validated before a second connection, without forwarding cookies',async()=>{
  const network=guardedFetch([{address:'1.1.1.1',family:4}],()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private.png','set-cookie':'fixture=secret'}}));
  assert.equal((await imageResponse(route(),network)).status,502);assert.equal(network.connections(),1);
});

test('renderer maps remote images to the checked protocol and refuses credentialed or non-HTTPS values',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8');
  const fn=source.slice(source.indexOf('function safeImageUrl('),source.indexOf('function gameTitle('));
  const context=vm.createContext({URL,encodeURIComponent});vm.runInContext(fn,context);
  const original='https://images.example.org/a.png?token=fictional';
  const mapped=context.safeImageUrl(original);
  assert.equal(new URL(mapped).origin,'null');assert.equal(new URL(mapped).host,'app');assert.equal(new URL(mapped).pathname,'/image');
  assert.equal(new URL(mapped).searchParams.get('url'),original);
  for(const value of ['file:///C:/fixture.png','data:image/svg+xml,fixture','http://example.org/a.png','https://user:fixture@example.org/a.png'])assert.equal(context.safeImageUrl(value),'');
  for(const filename of ['../src/main.cjs','../src/renderer/index.html']){
    const code=fs.readFileSync(path.join(__dirname,filename),'utf8');
    assert.match(code,/img-src 'self';/);assert.doesNotMatch(code,/img-src[^;]*(?:https:|data:)/);
  }
});

test('main protocol routes images through the loader and keeps application resources whitelisted',async()=>{
  const protocols=new Map(),routed=[];
  class Manager{constructor(){this.settings={};this.downloads=[];}on(){}state(){return {};}}
  class Completion{snapshot(){return {};}}
  class Refresher{start(){}snapshot(){return {};}}
  class Window{constructor(){this.webContents={setWindowOpenHandler(){},on(){},send(){}};}isDestroyed(){return false;}on(){}once(){}loadURL(){return Promise.resolve();}}
  const electron={
    app:{setPath(){},getPath:()=>'/fixture',getVersion:()=>'test',requestSingleInstanceLock:()=>true,on(){},setName(){},whenReady:()=>Promise.resolve(),quit(){}},
    BrowserWindow:Window,ipcMain:{handle(){}},protocol:{registerSchemesAsPrivileged(){},handle:(scheme,handler)=>protocols.set(scheme,handler)},powerMonitor:{on(){}},
    session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{}},fromPartition(){}},
    dialog:{showErrorBox(_title,message){throw new Error(message);}},shell:{},clipboard:{}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Response,Buffer,setImmediate,process:{env:{}},
    require(name){
      if(name==='electron')return electron;
      if(name==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON(){},loadJSON:(_file,fallback)=>fallback};
      if(name==='./completion-action.cjs')return {CompletionAction:Completion};
      if(name==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(name==='./image-loader.cjs')return {imageResponse:async request=>{routed.push(request.url);return remote();}};
      if(name==='./providers.cjs'||name==='./catalog.cjs'||name==='./installed-games.cjs')return {};
      return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
    }
  });
  await new Promise(resolve=>setImmediate(resolve));
  const handler=protocols.get('atlas'),imageRequest=route();
  assert.equal((await handler(imageRequest)).status,200);assert.deepEqual(routed,[imageRequest.url]);
  for(const resource of ['index.html','styles.css','app.js']){
    const result=await handler(new Request('atlas://app/'+resource));assert.equal(result.status,200);
    assert.match(result.headers.get('content-security-policy'),/img-src 'self';/);
  }
  for(const address of ['atlas://other/index.html','atlas://app/package.json','atlas://app/src/main.cjs','atlas://app/../../package.json'])assert.equal((await handler(new Request(address))).status,404);
});
