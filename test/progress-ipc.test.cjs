'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const plain=value=>JSON.parse(JSON.stringify(value));

test('preload progress subscription exposes data only and removes its own listener',()=>{
  const listeners=new EventEmitter(),invocations=[];let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {
      contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'atlas');api=value;}},
      ipcRenderer:{on:(...args)=>listeners.on(...args),removeListener:(...args)=>listeners.removeListener(...args),invoke:(...args)=>{invocations.push(args);return Promise.resolve();}},
    };},
  });
  const received=[],other=[],state=[];
  const unsubscribe=api.onProgress((...args)=>received.push(args)),unsubscribeOther=api.onProgress(value=>other.push(value));
  const unsubscribeState=api.onState(value=>state.push(value));
  const secretEvent={sender:{send(){throw new Error('Event must not be exposed');}}},packet={updateSequence:2,downloads:[{id:'a',received:2,total:3,speed:1,activeConnections:1}]};
  listeners.emit('atlas:progress',secretEvent,packet);
  assert.equal(received.length,1);assert.equal(received[0].length,1);assert.equal(received[0][0],packet);assert.equal(other[0],packet);
  assert.equal(api.ipcRenderer,undefined);assert.equal(api.send,undefined);assert.equal(api.invoke,undefined);
  unsubscribe();listeners.emit('atlas:progress',secretEvent,packet);assert.equal(received.length,1);assert.equal(other.length,2);
  listeners.emit('atlas:state',secretEvent,{updateSequence:3});assert.equal(state.length,1);
  unsubscribeOther();unsubscribeState();assert.equal(listeners.listenerCount('atlas:progress'),0);assert.equal(listeners.listenerCount('atlas:state'),0);
  assert.equal(invocations.length,0,'subscribing must not invoke a privileged action');
});

async function mainFixture(){
  const f={handles:new Map(),sent:[],stateCalls:0,refreshCalls:0,windows:[],stored:new Map()};
  class Manager extends EventEmitter {
    constructor(){super();this.settings={downloadDir:'C:\\Fixture',favorites:[],collections:[],defenderScan:true};this.downloads=[{id:'a',status:'downloading',name:'a.rar',received:10,total:100,speed:2,headers:{Cookie:'private-cookie'},sealedHeaders:'private-sealed'}];this.headerStorageWarning='';f.manager=this;}
    state(){f.stateCalls++;return {settings:{...this.settings},downloads:this.downloads.map(({headers,sealedHeaders,...item})=>({...item})),headerStorageWarning:this.headerStorageWarning,version:'fixture'};}
    save(){}stop(){return Promise.resolve();}updateSettings(patch){Object.assign(this.settings,patch);this.emit('state',this.state());}
  }
  class Completion {
    constructor(options){this.options=options;f.completion=this;}
    snapshot(){return {mode:'none',phase:'idle'};}refresh(){f.refreshCalls++;}dispose(){}
  }
  class Refresher {snapshot(){return {enabled:true};}start(){}stop(){}check(){return Promise.resolve();}}
  class Window {
    constructor(){this.destroyed=false;this.webContents={mainFrame:{url:'atlas://app/index.html'},on(){},setWindowOpenHandler(){},send:(event,payload)=>f.sent.push({event,payload:plain(payload)})};f.windows.push(this);}
    on(){}once(){}isDestroyed(){return this.destroyed;}loadURL(){return Promise.resolve();}
  }
  const electron={
    app:{setPath(){},getPath:()=>path.join(__dirname,'.unused-progress-profile'),getVersion:()=>'fixture',requestSingleInstanceLock:()=>true,on(){},setName(){},whenReady:()=>Promise.resolve(),quit(){throw new Error('No app exit in this test');}},
    BrowserWindow:Window,ipcMain:{handle:(name,callback)=>f.handles.set(name,callback)},
    protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{}}},
    powerMonitor:{on(){}},dialog:{showErrorBox:(_title,error)=>{throw new Error(error);}},shell:{},clipboard:{},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Buffer,Response,setImmediate,
    process:{env:{ATLAS_TEST_DIR:path.join(__dirname,'.unused-progress-profile')}},
    require:request=>{
      if(request==='electron')return electron;
      if(request==='node:child_process')return {execFile(){throw new Error('No power actions in this test');}};
      if(request==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON:(file,data)=>f.stored.set(file,data),loadJSON:(file,fallback)=>f.stored.get(file)??fallback};
      if(request==='./completion-action.cjs')return {CompletionAction:Completion};
      if(request==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(request==='./providers.cjs'||request==='./catalog.cjs')return {};
      if(request==='./installed-games.cjs')return {scanInstalledGames:async()=>({games:[]})};
      return request.startsWith('./')?require(path.join(__dirname,'../src',request)):require(request);
    },
  });
  await new Promise(resolve=>setImmediate(resolve));
  f.invoke=(name,value,event)=>{const win=f.windows[0];return f.handles.get('atlas:'+name)(event||{sender:win.webContents,senderFrame:win.webContents.mainFrame},value);};
  return f;
}

test('main progress delivery avoids complete snapshots and completion-policy refreshes',async()=>{
  const f=await mainFixture(),initial=await f.invoke('getState');
  assert.ok(Number.isSafeInteger(initial.updateSequence));assert.equal(initial.downloads.length,1);
  assert.equal(initial.downloads[0].headers,undefined);assert.equal(initial.downloads[0].sealedHeaders,undefined);
  const stateCalls=f.stateCalls,refreshCalls=f.refreshCalls,sent=f.sent.length;
  const entries=[{id:'a',received:50,total:100,speed:10,activeConnections:4}];
  f.manager.emit('progress',entries);
  assert.equal(f.stateCalls,stateCalls,'a progress tick must not rebuild complete app state');assert.equal(f.refreshCalls,refreshCalls,'progress is not a completion-policy transition');
  assert.equal(f.sent.length,sent+1);const delta=f.sent.at(-1);assert.equal(delta.event,'atlas:progress');assert.deepEqual(delta.payload.downloads,entries);
  assert.ok(delta.payload.updateSequence>initial.updateSequence);assert.deepEqual(Object.keys(delta.payload).sort(),['downloads','updateSequence']);
  const reloaded=await f.invoke('getState');assert.ok(reloaded.updateSequence>delta.payload.updateSequence);assert.equal(reloaded.downloads.length,1);assert.equal(reloaded.settings.defenderScan,true);assert.equal(reloaded.completionAction.phase,'idle');
  f.windows[0].destroyed=true;f.manager.emit('progress',entries);assert.equal(f.sent.length,sent+1,'no progress is sent to a destroyed window');
});

test('lifecycle and credential-warning events still publish a complete state immediately',async()=>{
  const f=await mainFixture();
  f.manager.emit('progress',[{id:'a',received:30,total:100,speed:10,activeConnections:4}]);const progressSequence=f.sent.at(-1).payload.updateSequence;
  f.manager.downloads[0]={...f.manager.downloads[0],status:'completed',received:100,speed:0,scan:{status:'review',message:'Needs review'}};
  f.manager.headerStorageWarning='Headers could not be saved securely.';
  f.manager.emit('state',f.manager.state());
  assert.equal(f.refreshCalls,1);const immediate=f.sent.at(-1);assert.equal(immediate.event,'atlas:state');assert.ok(immediate.payload.updateSequence>progressSequence);
  assert.equal(immediate.payload.downloads[0].status,'completed');assert.equal(immediate.payload.downloads[0].scan.status,'review');assert.equal(immediate.payload.headerStorageWarning,'Headers could not be saved securely.');
  assert.equal(immediate.payload.downloads[0].headers,undefined);assert.equal(immediate.payload.downloads[0].sealedHeaders,undefined);
  await assert.rejects(f.invoke('getState',undefined,{sender:{},senderFrame:f.windows[0].webContents.mainFrame}),/Invalid app request/);
});
