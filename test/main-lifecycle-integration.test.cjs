'use strict';
// Executes the complete main-process entry point with its real lifecycle code.
// Electron, downloads, native helpers and network services are in-memory fakes:
// no browser profile, local download, process or external request is opened.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const sourceFile=path.resolve(__dirname,'../src/main.cjs'),nativeRequire=createRequire(sourceFile);
const source=fs.readFileSync(sourceFile,'utf8');
const {SETTINGS_READ_ONLY,SESSION_ONLY}=require('../src/library-state.cjs');
const turn=()=>new Promise(setImmediate);
const event=()=>({prevented:false,preventDefault(){this.prevented=true;}});

async function mainFixture(t,{behavior='ask',fail=[],blockStop=false,blockFeatures=false,emptyIcon=false,shutdownMs}={}){
  const handlers=new Map(),windows=[],trays=[],dialogs=[],prompts=[],errors=[],calls=[],quitEvents=[],featureOptions=[],configured=[];
  const profile=path.resolve(__dirname,'.unused-main-lifecycle-profile');
  let releaseStop,releaseFeatures,manager,featureApp;
  const stopGate=blockStop?new Promise(resolve=>{releaseStop=resolve;}):Promise.resolve();
  const featureGate=blockFeatures?new Promise(resolve=>{releaseFeatures=resolve;}):Promise.resolve();
  const app=new EventEmitter();
  Object.assign(app,{exits:0,setPath(){},getPath:name=>path.join(profile,name),getVersion:()=>'fixture',getPreferredSystemLanguages:()=>['en'],setName(){},setAppUserModelId(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),exit:()=>{throw new Error('Unexpected forced exit');}});
  app.quit=()=>{
    const quitting=event();quitEvents.push(quitting);app.emit('before-quit',quitting);
    if(quitting.prevented)return;
    for(const win of windows)if(!win.destroyed)win.close();
    app.exits++;
  };
  class BrowserWindow extends EventEmitter{
    constructor(options){super();this.options=options;this.visible=true;this.destroyed=false;this.minimized=false;this.shows=0;this.loaded=false;
      this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:'atlas://app/index.html'},sent:[],send:(...args)=>this.webContents.sent.push(args),setWindowOpenHandler(){},reload(){}});windows.push(this);}
    isDestroyed(){return this.destroyed;}isMinimized(){return this.minimized;}isVisible(){return this.visible;}
    restore(){this.minimized=false;this.emit('restore');}show(){this.visible=true;this.shows++;}focus(){this.emit('focus');}hide(){this.visible=false;}
    close(){if(this.destroyed)return;const closing=event();this.emit('close',closing);if(!closing.prevented)this.destroy();return closing;}
    destroy(){if(this.destroyed)return;this.destroyed=true;this.visible=false;this.emit('closed');}
    async loadURL(url){this.url=url;this.loaded=true;}
  }
  class Tray extends EventEmitter{
    constructor(icon){super();this.icon=icon;this.destroyed=false;trays.push(this);}
    isDestroyed(){return this.destroyed;}setContextMenu(menu){this.menu=menu;}setToolTip(){}destroy(){this.destroyed=true;}
  }
  const dialog={showErrorBox:(title,message)=>errors.push({title,message}),showMessageBox:async(parent,options)=>{dialogs.push(options);prompts.push({minimized:parent.minimized,visible:parent.visible});return {response:2,checkboxChecked:false};}};
  const session={defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{}},fromPartition:()=>{throw new Error('Unexpected browser session');}};
  const nativeImage={createFromPath:file=>({file,isEmpty:()=>emptyIcon})};
  const electron={app,BrowserWindow,Tray,nativeImage,Menu:{buildFromTemplate:items=>items,setApplicationMenu(){}},dialog,session,protocol:{registerSchemesAsPrivileged(){},handle(){}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},powerMonitor:new EventEmitter(),shell:{},clipboard:{},safeStorage:{}};
  const cleanup=async(name,gate)=>{calls.push(name);if(gate)await gate;if(fail.includes(name))throw new Error('Private '+name+' fixture failure');};
  class DownloadManager extends EventEmitter{
    constructor(){super();manager=this;this.settings={closeBehavior:behavior,favorites:[]};this.downloads=[{id:'fixture-download',status:'downloading',received:3,total:10}];this.saved=0;}
    state(){return {settings:{...this.settings},downloads:this.downloads.map(value=>({...value}))};}
    updateSettings(patch){if(this.stateCanSave===false)throw new Error(SETTINGS_READ_ONLY);Object.assign(this.settings,patch);this.save();this.emit('state');return this.state();}
    // As the real manager: turning off still applies, until restart, when settings can't be saved.
    turnOff(patch){if(this.stateCanSave!==false){this.updateSettings(patch);return true;}Object.assign(this.settings,patch);this.emit('state');return false;}
    save(){this.saved++;return true;}
    async stop(){this.stopping=true;await cleanup('manager',stopGate);}
  }
  class CompletionAction{snapshot(){return {mode:'none',phase:'idle'};}refresh(){}dispose(){calls.push('completion');}}
  class CatalogRefresh{start(){}stop(){calls.push('catalog');}snapshot(){return {};}async check(){}}
  const modules={
    electron,
    'node:fs':{statSync:()=>{throw Object.assign(new Error('No legacy fixture folder'),{code:'ENOENT'});}},
    'node:child_process':{execFile:()=>{throw new Error('Unexpected native helper');}},
    './downloads.cjs':{DownloadManager,safeName:value=>value,atomicJSON(){},loadJSON:(_file,fallback)=>fallback},
    './defender-scan.cjs':{createDefenderScanner:()=>()=>{throw new Error('Unexpected Defender scan');}},
    './header-vault.cjs':{createHeaderVault:()=>({})},
    './fast-session.cjs':{createFastSessionFetch:()=>()=>{throw new Error('Unexpected network request');}},
    './completion-action.cjs':{CompletionAction},'./catalog-refresh.cjs':{CatalogRefresh},
    './hardware.cjs':{createHardwareService:()=>({})},
    './feature-services.cjs':{featureSettings:patch=>patch,createFeatureServices:({app:injected,register})=>{
      featureApp=injected;
      // The updater uses app.quit(), not the window's close operation.
      register('installUpdate',()=>{setImmediate(()=>injected.quit());return {phase:'ready'};});
      return {snapshot:()=>({}),observe(){},configure(changes){configured.push(changes);},cancelInstall(){calls.push('cancelInstall');},beforeQuit:async options=>{featureOptions.push(options);await cleanup('features',featureGate);}};
    }},
    './browser-integration.cjs':{createBrowserIntegration:()=>({snapshot:()=>({}),beforeQuit:()=>cleanup('browser')})},
    './media-integration.cjs':{createMediaIntegration:()=>({snapshot:()=>({}),beforeQuit:()=>cleanup('media')})},
    './torrent-integration.cjs':{createTorrentIntegration:()=>({snapshot:()=>({}),beforeQuit:()=>cleanup('torrents')})},
    './providers.cjs':{},'./catalog.cjs':{},'./installed-games.cjs':{scanInstalledGames:()=>{throw new Error('Unexpected installed-games scan');}}
  };
  const context=vm.createContext({module:{exports:{}},require:name=>Object.hasOwn(modules,name)?modules[name]:nativeRequire(name),__dirname:path.dirname(sourceFile),process:{env:{ATLAS_TEST_DIR:profile,...(shutdownMs===undefined?{}:{ATLAS_SHUTDOWN_TIMEOUT_MS:String(shutdownMs)})},platform:process.platform},console:{error:(...args)=>errors.push(args.join(' '))},Buffer,URL,Response,AbortController,AbortSignal,setImmediate,setTimeout,clearTimeout});
  vm.runInContext(source,context,{filename:sourceFile});
  for(let i=0;i<20&&!windows[0]?.loaded;i++)await turn();
  assert.equal(windows[0]?.loaded,true,JSON.stringify(errors));
  const win=windows[0];
  const call=(name,value,sender={sender:win.webContents,senderFrame:win.webContents.mainFrame})=>handlers.get('atlas:'+name)(sender,value);
  const closeDown=async()=>{
    releaseStop?.();releaseFeatures?.();if(!app.exits)app.quit();
    for(let i=0;i<30&&!app.exits;i++)await turn();
    assert.equal(app.exits,1,'the fixture must finish cleanup rather than leave a live lifecycle');
  };
  t.after(closeDown);
  return {app,win,manager,trays,dialogs,prompts,calls,errors,quitEvents,featureOptions,configured,call,context,featureApp,releaseStop:()=>releaseStop?.(),releaseFeatures:()=>releaseFeatures?.(),closeDown};
}

test('main prevents repeated quit attempts until its single ordered cleanup finishes',async t=>{
  const f=await mainFixture(t,{blockStop:true,blockFeatures:true});
  f.app.quit();f.app.quit();f.app.quit();await turn();
  assert.equal(f.quitEvents.length,3);assert.ok(f.quitEvents.every(value=>value.prevented));assert.equal(f.app.exits,0);
  assert.deepEqual(f.calls,['completion','catalog','manager']);
  await assert.rejects(f.call('windowAction','background'),/Ravenshelf is closing/);
  const shown=f.win.shows;f.app.emit('second-instance');assert.equal(f.win.shows,shown);
  f.releaseStop();await turn();assert.deepEqual(f.calls,['completion','catalog','manager','browser','media','torrents','features']);
  assert.deepEqual(f.featureOptions,[{install:true}]);assert.equal(f.app.exits,0);
  f.app.quit();assert.equal(f.quitEvents.at(-1).prevented,true);assert.equal(f.calls.filter(value=>value==='manager').length,1);
  f.releaseFeatures();await f.closeDown();
  assert.equal(f.quitEvents.at(-1).prevented,false);assert.equal(f.win.destroyed,true);assert.equal(f.dialogs.length,0);
});

test('main attempts every cleanup after failures and forbids update installation',async t=>{
  const f=await mainFixture(t,{fail:['manager','browser','media','torrents']});
  f.app.quit();await f.closeDown();
  assert.deepEqual(f.calls,['completion','catalog','manager','browser','media','torrents','features']);
  assert.deepEqual(f.featureOptions,[{install:false}]);assert.equal(f.dialogs.length,0);
  assert.ok(f.errors.some(value=>typeof value==='string'&&value.includes('could not finish cleanup')));
  assert.ok(!JSON.stringify(f.errors).includes('Private '));
});

test('a cleanup step that never settles still exits at the time limit and never installs the update',async t=>{
  const f=await mainFixture(t,{blockStop:true,shutdownMs:25}),saved=f.manager.saved;
  f.app.quit();await turn();assert.equal(f.app.exits,0);assert.deepEqual(f.calls,['completion','catalog','manager']);
  for(let i=0;i<200&&!f.app.exits;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.app.exits,1,'the process exits instead of hiding with the single-instance lock');
  assert.equal(f.quitEvents.at(-1).prevented,false);assert.equal(f.win.destroyed,true);assert.equal(f.dialogs.length,0);
  assert.equal(f.manager.saved,saved+1,'the queue is checkpointed');assert.deepEqual(f.calls,['completion','catalog','manager','cancelInstall']);
  assert.deepEqual(f.featureOptions,[]);assert.ok(f.errors.some(value=>typeof value==='string'&&value.includes('could not finish cleanup')));
  // A step that settles after the limit lets the rest clean up, but the update is never installed.
  f.releaseStop();for(let i=0;i<10;i++)await turn();
  assert.deepEqual(f.featureOptions,[{install:false}]);assert.equal(f.app.exits,1);assert.equal(f.quitEvents.length,2);
});

test('the shutdown time limit is cleared when cleanup finishes in time',async t=>{
  const f=await mainFixture(t,{shutdownMs:25});f.app.quit();await f.closeDown();const saved=f.manager.saved;
  await new Promise(resolve=>setTimeout(resolve,75));
  assert.equal(f.manager.saved,saved);assert.ok(!f.calls.includes('cancelInstall'));assert.deepEqual(f.featureOptions,[{install:true}]);
  assert.equal(f.app.exits,1);assert.ok(!f.errors.some(value=>typeof value==='string'&&value.includes('could not finish cleanup')));
});

test('a tray icon that cannot be loaded keeps the window visible instead of hiding it',async t=>{
  const f=await mainFixture(t,{behavior:'background',emptyIcon:true});
  assert.equal((await f.call('windowAction','background')).action,'visible');
  assert.equal(f.win.visible,true);assert.equal(f.trays.length,0);
  assert.deepEqual(f.errors,[{title:'Ravenshelf',message:'Ravenshelf could not stay in the background. The window is still open.'}]);
  assert.equal(f.win.close().prevented,true);await turn();assert.equal(f.win.visible,true);assert.equal(f.trays.length,0);
});

test('main background action and remembered window close leave downloads and services running',async t=>{
  const f=await mainFixture(t,{behavior:'background'}),before=f.manager.state();
  assert.equal((await f.call('windowAction','background')).action,'background');
  assert.equal(f.win.visible,false);assert.equal(f.win.destroyed,false);assert.equal(f.manager.stopping,undefined);
  assert.deepEqual(f.manager.state(),before);assert.deepEqual(f.calls,[]);assert.equal(f.featureOptions.length,0);
  f.manager.emit('progress',[{id:'fixture-download',received:4,total:10,speed:1}]);
  assert.equal(f.win.webContents.sent.at(-1)[0],'atlas:progress');
  f.app.emit('second-instance');assert.equal(f.win.visible,true);
  assert.equal(f.win.close().prevented,true);await turn();assert.equal(f.win.visible,false);
  assert.equal(f.dialogs.length,0);assert.deepEqual(f.calls,[]);
  assert.equal((await f.call('getState')).downloads[0].id,'fixture-download');
});

test('windowAction accepts only a trusted main frame and its two action values',async t=>{
  const f=await mainFixture(t);
  const untrusted=[{sender:{},senderFrame:f.win.webContents.mainFrame},{sender:f.win.webContents,senderFrame:{url:'atlas://app/index.html'}}];
  for(const sender of untrusted)await assert.rejects(f.call('windowAction','quit',sender),/Invalid app request/);
  f.win.webContents.mainFrame.url='https://untrusted.example/';await assert.rejects(f.call('windowAction','background'),/Invalid app request/);f.win.webContents.mainFrame.url='atlas://app/index.html';
  for(const value of [undefined,null,'close','hide',{},['quit']])await assert.rejects(f.call('windowAction',value),/Invalid app request/);
  assert.equal(f.trays.length,0);assert.equal(f.quitEvents.length,0);assert.equal(f.dialogs.length,0);
  assert.equal((await f.call('windowAction','quit')).action,'quit');await f.closeDown();assert.equal(f.dialogs.length,0);
});

test('an updater app.quit exits instead of honoring the background close preference',async t=>{
  const f=await mainFixture(t,{behavior:'background'});await f.call('windowAction','background');
  assert.equal(f.win.visible,false);assert.equal(f.featureApp,f.app);
  await f.call('installUpdate');await turn();await f.closeDown();
  assert.equal(f.dialogs.length,0);assert.deepEqual(f.featureOptions,[{install:true}]);
  assert.equal(f.trays[0].destroyed,true);assert.equal(f.win.destroyed,true);
});

test('a cancelled Windows session-end query preserves the close choice and working tray',async t=>{
  const f=await mainFixture(t),before=f.manager.saved;
  f.win.emit('query-session-end',event());assert.equal(f.manager.saved,before+1);
  assert.equal(f.dialogs.length,0);assert.equal(f.win.close().prevented,true);await turn();assert.equal(f.dialogs.length,1);
  assert.equal(f.win.visible,true);await f.call('windowAction','background');assert.equal(f.win.visible,false);
  f.trays[0].emit('click');assert.equal(f.win.visible,true);assert.equal(f.quitEvents.length,0);
});

test('the close prompt restores a minimized window before it opens',async t=>{
  const f=await mainFixture(t);f.win.minimized=true;const shows=f.win.shows;
  assert.equal(f.win.close().prevented,true);await turn();
  assert.deepEqual(f.prompts,[{minimized:false,visible:true}]);assert.equal(f.win.shows,shows+1);assert.equal(f.quitEvents.length,0);
});

test('confirmed Windows session end bypasses the close prompt',async t=>{
  const f=await mainFixture(t);f.win.emit('session-end',event());
  assert.equal(f.win.close().prevented,false);await turn();assert.equal(f.dialogs.length,0);assert.equal(f.trays.length,0);
});

test('in a read-only session clipboard watching can still be turned off until restart, but not turned on',async t=>{
  const f=await mainFixture(t);f.manager.stateCanSave=false;f.manager.settings.clipboardWatchEnabled=true;
  await assert.rejects(f.call('saveSettings',{clipboardWatchEnabled:false}),{message:SESSION_ONLY});
  assert.equal(f.manager.settings.clipboardWatchEnabled,false);assert.deepEqual(f.configured,[{clipboardWatchEnabled:false}],'the watcher is stopped now');assert.equal(f.manager.saved,0);
  await assert.rejects(f.call('saveSettings',{clipboardWatchEnabled:true}),{message:SETTINGS_READ_ONLY});
  assert.equal(f.manager.settings.clipboardWatchEnabled,false);assert.equal(f.configured.length,1,'nothing was started');
  // A list that can be saved keeps the choice as before.
  f.manager.stateCanSave=true;await f.call('saveSettings',{clipboardWatchEnabled:false});assert.equal(f.manager.saved,1);assert.equal(f.configured.length,2);
});
