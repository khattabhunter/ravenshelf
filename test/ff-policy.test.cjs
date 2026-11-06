'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {fastRoot,isFastFileURL,assertFastFile}=require('../src/ff-policy.cjs');
const source='https://fuckingfast.co/fixture123#Example.part01.rar';

test('FuckingFast file policy accepts HTTPS download servers and matches the selected archive name',()=>{
  assert.doesNotThrow(()=>assertFastFile(source,'https://files7.fuckingfast.co/dl/token/Example.part01.rar','EXAMPLE.part01.rar'));
  assert.doesNotThrow(()=>assertFastFile(source,'https://fuckingfast.net/dl/token','Example.part01.rar'));
  assert.doesNotThrow(()=>assertFastFile('https://fuckingfast.co/id#Game%20part01.rar','https://fuckingfast.co/dl/token','Game part01.rar'));
});

test('FuckingFast file policy rejects fake archive names, executables, page URLs and off-site destinations',()=>{
  for(const [url,name] of [
    ['https://fuckingfast.co/dl/token','advertisement.rar'],
    ['https://fuckingfast.co/dl/token','Example.part01.rar.exe'],
    ['https://fuckingfast.co/dl/token','../Example.part01.rar'],
    ['https://fuckingfast.co/advertisement','Example.part01.rar'],
    ['https://challenges.cloudflare.com/dl/token','Example.part01.rar'],
    ['https://fuckingfast.co.evil.example/dl/token','Example.part01.rar'],
    ['https://evil-fuckingfast.co/dl/token','Example.part01.rar'],
    ['http://fuckingfast.co/dl/token','Example.part01.rar']
  ])assert.throws(()=>assertFastFile(source,url,name),/Blocked/);
  assert.equal(fastRoot('https://fuckingfast.co@evil.example/dl/token'),null);
  assert.equal(isFastFileURL('https://fuckingfast.co/ads/dl/token'),false);
});

function networkFixture(fetcher){
  const sandbox={module:{exports:{}},URL,Headers,AbortSignal,require(name){
    if(name==='undici')return {Agent:class{},fetch:fetcher};
    if(name==='./ff-policy.cjs')return require('../src/ff-policy.cjs');
    return require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/net.cjs'),'utf8'),sandbox);
  return sandbox.module.exports;
}

test('actual downloader HTTP redirect handling stops off-site FuckingFast requests before following them',async()=>{
  for(const destination of ['https://advertising.example/download.rar','https://challenges.cloudflare.com/file.rar','https://fuckingfast.co.evil.example/dl/file']){
    const calls=[];
    const net=networkFixture(async url=>{calls.push(url);return new Response(null,{status:302,headers:{Location:destination}});});
    await assert.rejects(net.safeFetch('https://fuckingfast.co/dl/file'),/Blocked an off-site redirect/);
    assert.equal(calls.length,1);
  }
});

test('FuckingFast server redirects remain usable and other file hosts retain their external CDN support',async()=>{
  for(const [from,to] of [
    ['https://fuckingfast.co/dl/file','https://files4.fuckingfast.co/dl/file'],
    ['https://fuckingfast.net/dl/file','https://files4.fuckingfast.co/dl/file'],
    ['https://filekeeper.net/file','https://cdn.example/file.rar']
  ]){
    const calls=[];
    const net=networkFixture(async (url,options)=>{calls.push({url,headers:new Headers(options.headers)});return calls.length===1?new Response(null,{status:302,headers:{Location:to}}):new Response(null,{status:200});});
    const result=await net.safeFetch(from,{headers:{Cookie:'session=test'}});
    assert.equal(result.status,200);assert.equal(calls[1].url,to);
    assert.equal(calls[1].headers.has('Cookie'),false,'redirect must not forward source cookies to another server');
  }
});

test('FuckingFast resolver refuses a substituted filename or off-site file before marking a link ready',async()=>{
  for(const [finalUrl,filename,status] of [
    ['https://files2.fuckingfast.co/dl/token','Example.part01.rar','ready'],
    ['https://files2.fuckingfast.co/dl/token','advertisement.rar','manual'],
    ['https://ads.example/file.rar','Example.part01.rar','manual']
  ]){
    const sandbox={module:{exports:{}},URL,Buffer,TextDecoder,TextEncoder,console,require(name){
      if(name==='./net.cjs')return {safeFetch:async (_url,options={})=>{
        if(options.method!=='HEAD')return new Response('<a href="https://files2.fuckingfast.co/dl/token">Download</a>',{headers:{'content-type':'text/html'}});
        const response=new Response(null,{headers:{'content-type':'application/octet-stream','content-length':'4096','content-disposition':`attachment; filename="${filename}"`}});
        Object.defineProperty(response,'url',{value:finalUrl});return response;
      }};
      return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/providers.cjs'),'utf8'),sandbox);
    const result=await sandbox.module.exports.resolveLink(source);
    assert.equal(result.status,status);
    if(status==='ready')assert.equal(result.filename,'Example.part01.rar');else assert.match(result.message,/Blocked/);
  }
});

async function hostFixture(){
  const handles=new Map(),windows=[],queued=[],errors=[],sessions=new Map();
  const emptySession=()=>({listeners:new Map(),setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{},webRequest:{onBeforeRequest(listener){this.listener=listener;}},cookies:{get:async()=>[]},on(event,listener){this.listeners.set(event,listener);},removeListener(event){this.listeners.delete(event);}});
  class Manager {constructor(){this.settings={};this.downloads=[];}state(){return {settings:this.settings,downloads:this.downloads};}on(){}add(batch){queued.push(batch);}}
  class Completion {snapshot(){return {mode:'none',phase:'idle'};}}
  class Refresher {snapshot(){return {};}start(){}}
  class Window {
    constructor(options){this.options=options;this.events=new Map();this.loaded=[];const events=new Map();this.webContents={mainFrame:{url:'atlas://app/index.html'},events,on:(name,listener)=>events.set(name,listener),setWindowOpenHandler:listener=>{this.popup=listener;},send(){},getUserAgent:()=>'Fixture'};windows.push(this);}
    on(name,listener){this.events.set(name,listener);}once(){}isDestroyed(){return false;}loadURL(url){this.loaded.push(url);return Promise.resolve();}close(){this.closed=true;this.events.get('closed')?.();}
  }
  const electron={
    app:{setPath(){},getPath:()=>path.join(__dirname,'.unused-host-profile'),getVersion:()=>'fixture',requestSingleInstanceLock:()=>true,on(){},setName(){},whenReady:()=>Promise.resolve(),quit(){}},
    BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handles.set(name,handler)},protocol:{registerSchemesAsPrivileged(){},handle(){}},powerMonitor:{on(){}},
    session:{defaultSession:emptySession(),fromPartition(name){if(!sessions.has(name))sessions.set(name,emptySession());return sessions.get(name);}},dialog:{showErrorBox:(title,message)=>errors.push({title,message})},shell:{},clipboard:{}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Response,Buffer,setImmediate,process:{env:{ATLAS_TEST_DIR:path.join(__dirname,'.unused-host-profile')}},
    require(name){
      if(name==='electron')return electron;
      if(name==='node:child_process')return {execFile(){throw new Error('Unexpected process');}};
      if(name==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON(){},loadJSON:(_file,fallback)=>fallback};
      if(name==='./completion-action.cjs')return {CompletionAction:Completion};
      if(name==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(name==='./providers.cjs'||name==='./catalog.cjs'||name==='./installed-games.cjs')return {};
      return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
    }
  });
  await new Promise(resolve=>setImmediate(resolve));
  const main=windows[0];
  await handles.get('atlas:openHost')({sender:main.webContents,senderFrame:main.webContents.mainFrame},{url:source,gameTitle:'Example'});
  const browser=windows[1],session=browser.options.webPreferences.session;
  return {browser,session,queued,errors,async download(url,name){let prevented=false;await session.listeners.get('will-download')({preventDefault(){prevented=true;}},{getURL:()=>url,getFilename:()=>name,getTotalBytes:()=>4096},browser.webContents);return prevented;}};
}

test('protected browser blocks ad popups, external requests and navigations while allowing challenge verification',async()=>{
  const f=await hostFixture();
  for(const url of ['https://ads.example/','https://fuckingfast.co/advertisement'])assert.equal(f.browser.popup({url}).action,'deny');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.browser.loaded,[source],'same-host advertising paths must not replace the selected download page');
  let blocked;
  f.session.webRequest.listener({url:'https://ads.example/ad.js'},result=>{blocked=result.cancel;});assert.equal(blocked,true);
  f.session.webRequest.listener({url:'https://challenges.cloudflare.com/check'},result=>{blocked=result.cancel;});assert.equal(blocked,false);
  for(const event of ['will-navigate','will-redirect']){let prevented=false;f.browser.webContents.events.get(event)({preventDefault(){prevented=true;}},'https://ads.example/');assert.equal(prevented,true);}
  f.browser.popup({url:'https://files2.fuckingfast.co/dl/token'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.browser.loaded.at(-1),'https://files2.fuckingfast.co/dl/token');
});

test('protected capture blocks fake archives, executable bait and challenge downloads before anything is queued',async()=>{
  const f=await hostFixture();
  for(const [url,name] of [
    ['https://fuckingfast.co/dl/token','advertisement.rar'],
    ['https://fuckingfast.co/dl/token','installer.exe'],
    ['https://challenges.cloudflare.com/dl/token','Example.part01.rar'],
    ['https://ads.example/dl/token','Example.part01.rar']
  ])assert.equal(await f.download(url,name),true);
  assert.equal(f.queued.length,0);assert.equal(f.errors.length,4);assert.equal(f.browser.closed,undefined);
  assert.equal(await f.download('https://files2.fuckingfast.co/dl/token','Example.part01.rar'),true);
  assert.equal(f.queued.length,1);assert.equal(f.queued[0].links[0].sourceUrl,source,'preserve the original file ID and expected name for refresh');
  assert.equal(f.queued[0].links[0].filename,'Example.part01.rar');assert.equal(f.browser.closed,true);
});
