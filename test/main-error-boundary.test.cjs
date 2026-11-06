'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {publicErrorMessage,publicError}=require('../src/public-errors.cjs');

const PRIVATE_PATH='C:\\Users\\private-fixture-user\\secrets\\personal-config.json';
const PRIVATE_URL='https://private.example/download?token=fixture-secret-token';
const PRIVATE_TOKEN='fixture-bearer-credential';
const sensitiveError=()=>new Error(`EACCES ${PRIVATE_PATH} ${PRIVATE_URL} Authorization: Bearer ${PRIVATE_TOKEN}\n    at privateInternalFunction (${PRIVATE_PATH}:42:1)`);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function containsNoPrivateData(value){
  const text=typeof value==='string'?value:JSON.stringify(value);
  for(const privateValue of [PRIVATE_PATH,PRIVATE_URL,PRIVATE_TOKEN,'fixture-secret-token','privateInternalFunction'])assert.equal(text.includes(privateValue),false,`must not expose ${privateValue}`);
}

async function fixture({resourceError,startupError,loadError,imageError,queueError,providerError,catalogueError}={}){
  const handlers=new Map(),protocols=new Map(),windows=[],dialogs=[],logs=[],events=new Map(),powerEvents=new Map(),sessions=new Map(),stored=new Map();let quit=false;
  const newSession=()=>({listeners:new Map(),webRequest:{onBeforeRequest(){}},cookies:{get:async()=>[]},setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{if(startupError)throw startupError;},on(name,fn){this.listeners.set(name,fn);},removeListener(name){this.listeners.delete(name);}});
  class Manager {
    constructor(){this.settings={downloadDir:'C:\\FixtureDownloads',concurrency:2,connectionsPerFile:4};this.downloads=[];}
    on(){}state(){return {settings:this.settings,downloads:this.downloads};}updateSettings(changes){Object.assign(this.settings,changes);}add(){if(queueError)throw queueError;return {added:1};}
  }
  class Completion {snapshot(){return {mode:'none',phase:'idle'};}refresh(){}}
  class Refresher {snapshot(){return {enabled:true};}start(){}check(){return catalogueError?Promise.reject(catalogueError):Promise.resolve();}}
  class Window {
    constructor(options){this.options=options;this.events=new Map();this.webContents={mainFrame:{url:'atlas://app/index.html'},on(){},setWindowOpenHandler(){},send(){},getUserAgent:()=>'Fixture'};windows.push(this);}
    on(name,fn){this.events.set(name,fn);}once(){}isDestroyed(){return false;}loadURL(){return loadError?Promise.reject(loadError):Promise.resolve();}close(){this.events.get('closed')?.();}
  }
  const electron={
    app:{setPath(){},getPath:()=>path.join(__dirname,'.unused-error-profile'),getVersion:()=>'fixture',requestSingleInstanceLock:()=>true,on:(name,fn)=>events.set(name,fn),setName(){},whenReady:()=>Promise.resolve(),quit(){quit=true;}},
    BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    protocol:{registerSchemesAsPrivileged(){},handle:(scheme,fn)=>protocols.set(scheme,fn)},powerMonitor:{on:(name,fn)=>powerEvents.set(name,fn)},
    session:{defaultSession:newSession(),fromPartition(name){if(!sessions.has(name))sessions.set(name,newSession());return sessions.get(name);}},
    dialog:{showErrorBox:(title,message)=>dialogs.push({title,message})},shell:{},clipboard:{}
  };
  const applicationFS={...fs,readFileSync(file,...args){if(resourceError&&path.dirname(String(file))===path.join(__dirname,'../src/renderer'))throw resourceError;return fs.readFileSync(file,...args);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},URL,Response,Buffer,setImmediate,process:{env:{ATLAS_TEST_DIR:path.join(__dirname,'.unused-error-profile')}},
    console:{error:(...args)=>logs.push(args),log:(...args)=>logs.push(args)},
    require(name){
      if(name==='electron')return electron;
      if(name==='node:fs')return applicationFS;
      if(name==='node:child_process')return {execFile(){throw new Error('No process may run in these tests');}};
      if(name==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON:(file,value)=>stored.set(file,value),loadJSON:(file,fallback)=>stored.get(file)??fallback};
      if(name==='./completion-action.cjs')return {CompletionAction:Completion};
      if(name==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(name==='./image-loader.cjs')return {imageResponse:async()=>{if(imageError)throw imageError;return new Response('image fixture',{headers:{'content-type':'image/png'}});}};
      if(name==='./providers.cjs')return {getGame:async()=>{if(providerError)throw providerError;return {};},resolveLink:async()=>{if(providerError)throw providerError;return {status:'manual',message:'Fixture'};}};
      if(name==='./catalog.cjs'||name==='./installed-games.cjs')return {};
      return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
    }
  });
  await settle();
  return {dialogs,logs,windows,sessions,powerEvents,get quit(){return quit;},route:request=>protocols.get('atlas')(request),invoke(name,value){const win=windows[0];return handlers.get('atlas:'+name)({sender:win.webContents,senderFrame:win.webContents.mainFrame},value);}};
}

test('failed app resources return a constant restrictive response and never log the underlying exception',async()=>{
  const f=await fixture({resourceError:sensitiveError()});
  for(const resource of ['index.html','styles.css','app.js']){
    const response=await f.route(new Request('atlas://app/'+resource));
    assert.equal(response.status,500);
    assert.equal(await response.text(),'App resource unavailable');
    assert.equal(response.headers.get('content-type'),'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(response.headers.get('content-security-policy'),/sandbox/);
  }
  assert.equal(f.logs.length,3);containsNoPrivateData(f.logs);
});

test('malformed routes and asynchronous image failures use the same nonreflecting protocol boundary',async()=>{
  const f=await fixture({imageError:sensitiveError()});
  for(const request of [{url:`invalid ${PRIVATE_URL}`},new Request('atlas://app/image?url='+encodeURIComponent(PRIVATE_URL))]){
    const response=await f.route(request);
    assert.equal(response.status,500);assert.equal(await response.text(),'App resource unavailable');
  }
  containsNoPrivateData(f.logs);
});

test('successful application assets remain exact and unknown resources remain unavailable',async()=>{
  const f=await fixture();
  for(const [resource,type] of [['index.html','text/html'],['styles.css','text/css'],['app.js','text/javascript']]){
    const response=await f.route(new Request('atlas://app/'+resource));
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),new RegExp('^'+type));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(__dirname,'../src/renderer',resource)));
  }
  for(const url of ['atlas://other/index.html','atlas://app/private.json']){
    const response=await f.route(new Request(url));assert.equal(response.status,404);assert.equal(await response.text(),'Not found');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal(f.logs.length,0);
});

test('startup failures do not expose exception messages or stacks in the dialog or console',async()=>{
  for(const options of [{startupError:sensitiveError()},{loadError:sensitiveError()}]){
    const f=await fixture(options);assert.equal(f.quit,true);assert.equal(f.dialogs.length,1);
    assert.equal(f.dialogs[0].title,'Ravenshelf could not start');
    assert.match(f.dialogs[0].message,/Close it and try again/);
    containsNoPrivateData(f.dialogs);containsNoPrivateData(f.logs);
  }
});

test('IPC failures and link-check error results preserve safe guidance without reflecting private error data',async()=>{
  const f=await fixture({providerError:sensitiveError()});
  await assert.rejects(f.invoke('getGame','https://fitgirl-repacks.site/example/'),error=>{
    assert.equal(error.message,'The game page could not be loaded. Please try again.');
    containsNoPrivateData(error.message);containsNoPrivateData(error.stack);
    assert.equal(error.stack,error.message);return true;
  });
  const links=await f.invoke('checkLinks',['https://files.example/game.rar']);
  assert.equal(links[0].status,'unavailable');assert.equal(links[0].message,'The link could not be checked. Try again or choose another mirror.');containsNoPrivateData(links);
  await assert.rejects(f.invoke('saveSettings',{connectionsPerFile:3}),/Choose 1, 2 or 4 connections per file/);
  containsNoPrivateData(f.logs);
});

test('protected-host queue failures and background refresh logs do not expose unexpected private data',async()=>{
  const f=await fixture({queueError:sensitiveError(),catalogueError:sensitiveError()});
  await f.invoke('openHost',{url:'https://fuckingfast.co/id#game.part01.rar',gameTitle:'Game'});
  const browser=f.windows[1],session=browser.options.webPreferences.session;
  await session.listeners.get('will-download')({preventDefault(){}},{getURL:()=>'https://fuckingfast.co/dl/token',getFilename:()=>'game.part01.rar',getTotalBytes:()=>1024},browser.webContents);
  assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].message,/file could not be queued/);containsNoPrivateData(f.dialogs);
  f.powerEvents.get('resume')();await settle();assert.deepEqual(f.logs,[['Catalogue refresh failed.']]);containsNoPrivateData(f.logs);
});

test('public error mapping preserves known actionable messages and rejects appended or accessor-supplied private data',()=>{
  assert.equal(publicErrorMessage({code:'EACCES',message:sensitiveError().message}),'Ravenshelf cannot access this file or folder. Check its permissions and try again.');
  assert.equal(publicErrorMessage(new Error('Only public HTTPS web addresses are supported.')),'Only public HTTPS web addresses are supported.');
  assert.equal(publicErrorMessage(new Error('Game page unavailable (HTTP 503).')),'The source returned HTTP 503. Please try again or choose another source.');
  for(const error of [sensitiveError(),new Error('Only public HTTPS web addresses are supported. '+PRIVATE_TOKEN),{get message(){throw sensitiveError();}},PRIVATE_URL,null]){
    containsNoPrivateData(publicErrorMessage(error));containsNoPrivateData(publicError(error).stack);
  }
});
