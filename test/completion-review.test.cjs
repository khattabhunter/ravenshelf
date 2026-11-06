'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {CompletionAction}=require('../src/completion-action.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a newly completed job observed between ticks resets the countdown too',async()=>{
  let time=0;const queue=[{id:'a',status:'downloading'},{id:'old',status:'completed'}],calls=[];
  const action=new CompletionAction({getDownloads:()=>queue,onExecute:(mode,details)=>calls.push({mode,...details}),clock:()=>time,autoTick:false});
  action.arm('shutdown');queue[0].status='completed';action.tick();time=59000;action.tick();
  // A small new file may finish before the scheduler next observes the queue.
  queue.push({id:'b',status:'completed'});time=60000;action.tick();await flush();
  assert.equal(calls.length,0);assert.equal(action.snapshot().phase,'countdown');
  assert.equal(action.snapshot().remainingSeconds,60);assert.equal(action.snapshot().targetCount,2);
  time=119000;action.tick();await flush();assert.equal(calls.length,0);
  time=120000;action.tick();await flush();assert.deepEqual(calls,[{mode:'shutdown',ids:['a','b']}]);
  action.dispose();
});

test('a new job cancelled before its first observation disarms the countdown',async()=>{
  let time=0;const queue=[{id:'a',status:'queued'},{id:'old',status:'cancelled'}],calls=[];
  const action=new CompletionAction({getDownloads:()=>queue,onExecute:mode=>calls.push(mode),clock:()=>time,autoTick:false});
  action.arm('close');queue[0].status='completed';action.tick();
  queue.push({id:'b',status:'cancelled'});time=60000;action.tick();await flush();
  assert.equal(action.snapshot().mode,'none');assert.match(action.snapshot().message,/cancelled/);assert.equal(calls.length,0);
  action.dispose();
});

async function mainFixture({phase='idle',testMode=true,version='0.2.0',storedFiles=new Map(),catalogInterval}={}){
  const f={handles:new Map(),windows:[],actions:[],powerCalls:[],saved:0,cacheClears:0,events:[],storedFiles,appEvents:new Map(),powerEvents:new Map(),catalogRequests:[],refreshChecks:[],sent:[]};
  class Manager {
    constructor(){this.settings={downloadDir:'C:\\Atlas-test',favorites:[],collections:[]};this.downloads=[{id:'cancelled-history',status:'cancelled',folder:'C:\\Atlas-test'}];f.manager=this;}
    state(){return {settings:this.settings,downloads:this.downloads};}
    on(){} save(){f.saved++;}stop(){f.events.push('manager:stop');return Promise.resolve();}
    action(id,action){f.actions.push({id,action});return this.state();}
    updateSettings(changes){Object.assign(this.settings,changes);return this.state();}
  }
  class Scheduler {
    constructor(options){this.options=options;f.scheduler=this;}
    snapshot(){return {mode:'shutdown',phase};}
    refresh(){}dispose(){}arm(){}cancel(){}
  }
  class Refresher {
    constructor(options){this.options=options;this.state={enabled:false,checking:false,lastCheckedAt:null,latest:null};f.refresher=this;}
    snapshot(){return this.state;}
    start(){this.state.enabled=true;f.events.push('refresh:start');}
    stop(){this.state.enabled=false;f.events.push('refresh:stop');}
    check(options){f.refreshChecks.push(options);return Promise.resolve(this.state);}
  }
  class Window {
    constructor(){this.events=new Map();this.webContents={mainFrame:{url:'atlas://app/index.html'},on(){},setWindowOpenHandler(){},send:(event,state)=>f.sent.push({event,state})};f.windows.push(this);}
    once(){}on(event,handler){this.events.set(event,handler);}show(){}focus(){}isMinimized(){return false;}isDestroyed(){return false;}loadURL(){f.events.push('loadURL');return Promise.resolve();}
  }
  const ses={setPermissionRequestHandler(){},setPermissionCheckHandler(){},async clearCache(){f.cacheClears++;f.events.push('clearCache');}};
  const electron={
    app:{setPath(){},getPath:()=>path.join(__dirname,'.review-profile'),getVersion:()=>version,requestSingleInstanceLock:()=>true,on:(event,handler)=>f.appEvents.set(event,handler),setName(){},whenReady:()=>Promise.resolve(),quit(){f.quit=true;},exit(){throw new Error('Unexpected exit');}},
    powerMonitor:{on:(event,handler)=>f.powerEvents.set(event,handler)},
    BrowserWindow:Window,ipcMain:{handle:(name,fn)=>f.handles.set(name,fn)},
    protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:ses,fromPartition(){throw new Error('Startup must not touch host or gameplay partitions');}},dialog:{},shell:{openPath:async()=>{}},clipboard:{}
  };
  const context={__dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Promise,Map,Set,Buffer,Response,setImmediate,
    process:{env:{...(testMode?{ATLAS_TEST_DIR:path.join(__dirname,'.review-profile')}:{ }),...(catalogInterval===undefined?{}:{ATLAS_CATALOG_INTERVAL_MS:String(catalogInterval)})}},
    require:request=>{
      if(request==='electron')return electron;
      if(request==='node:child_process')return {execFile:(file,args,options,callback)=>{f.powerCalls.push({file,args,options});callback(null);}};
      if(request==='./downloads.cjs')return {DownloadManager:Manager,safeName:x=>x,atomicJSON:(file,data)=>storedFiles.set(file,JSON.parse(JSON.stringify(data))),loadJSON:(file,fallback)=>storedFiles.get(file)??fallback};
      if(request==='./completion-action.cjs')return {CompletionAction:Scheduler};
      if(request==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(request==='./catalog.cjs')return {getCatalogSections:()=>[],listCatalog:async options=>{f.catalogRequests.push(JSON.parse(JSON.stringify(options)));return {games:[],...options};}};
      if(request==='./installed-games.cjs')return {scanInstalledGames:async()=>({games:[]})};
      if(request.startsWith('./'))return require(path.join(__dirname,'../src',request));
      return require(request);
    }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),context);await flush();
  f.invoke=(name,value,event)=>{
    const win=f.windows[0];
    return f.handles.get('atlas:'+name)(event||{sender:win.webContents,senderFrame:win.webContents.mainFrame},value);
  };
  return f;
}

test('default renderer cache clears before loading once for each app version',async()=>{
  const storedFiles=new Map(),first=await mainFixture({storedFiles});
  assert.equal(first.cacheClears,1);assert.deepEqual(first.events,['clearCache','refresh:start','loadURL']);
  assert.deepEqual(storedFiles.get(path.join(__dirname,'.review-profile','renderer-cache.json')),{version:'0.2.0'});
  const sameVersion=await mainFixture({storedFiles});
  assert.equal(sameVersion.cacheClears,0);assert.deepEqual(sameVersion.events,['refresh:start','loadURL']);
  const upgraded=await mainFixture({storedFiles,version:'0.3.0'});
  assert.equal(upgraded.cacheClears,1);assert.deepEqual(upgraded.events,['clearCache','refresh:start','loadURL']);
  assert.equal(storedFiles.get(path.join(__dirname,'.review-profile','renderer-cache.json')).version,'0.3.0');
});

test('main starts a five-minute newest-catalogue check before the window loads',async()=>{
  const f=await mainFixture({testMode:false,catalogInterval:15000});
  assert.equal(f.refresher.options.intervalMs,300000);
  assert.equal(f.refresher.state.enabled,true);
  assert.ok(f.events.indexOf('refresh:start')<f.events.indexOf('loadURL'));
  await f.refresher.options.fetchLatest();
  assert.deepEqual(f.catalogRequests,[{section:'newest',page:1,forceRefresh:true}]);
  assert.equal(f.actions.length,0);
});

test('wake, focus and restore request due checks; quitting stops refresh before downloads',async()=>{
  const f=await mainFixture();
  f.powerEvents.get('resume')();f.windows[0].events.get('focus')();f.windows[0].events.get('restore')();
  await flush();assert.deepEqual(f.refreshChecks,[undefined,undefined,undefined]);
  let prevented=false;f.appEvents.get('before-quit')({preventDefault(){prevented=true;}});await flush();
  assert.equal(prevented,true);assert.equal(f.refresher.state.enabled,false);assert.equal(f.quit,true);
  assert.ok(f.events.indexOf('refresh:stop')<f.events.indexOf('manager:stop'));
});

test('catalogue refresh state is available at startup and pushed on background changes',async()=>{
  const f=await mainFixture();
  assert.equal((await f.invoke('getState')).catalogRefresh.enabled,true);
  f.refresher.state={enabled:true,checking:false,lastCheckedAt:'2026-11-06T12:00:00.000Z',latest:{games:[{title:'New game'}]}};
  f.refresher.options.onChange();
  const message=f.sent.at(-1);assert.equal(message.event,'atlas:state');
  assert.equal(message.state.catalogRefresh.latest.games[0].title,'New game');
  assert.equal(message.state.catalogRefresh.lastCheckedAt,'2026-11-06T12:00:00.000Z');
  assert.equal(f.actions.length,0);
});

test('catalogue IPC forwards manual freshness only for a true boolean',async()=>{
  const f=await mainFixture();
  await f.invoke('listCatalog',{section:'rpg',page:3,search:'Example',forceRefresh:true});
  await f.invoke('listCatalog',{section:'rpg',page:3,search:'Example',forceRefresh:'true'});
  assert.deepEqual(f.catalogRequests,[{section:'rpg',page:3,search:'Example',forceRefresh:true},{section:'rpg',page:3,search:'Example',forceRefresh:false}]);
});
test('IPC cannot resume, retry or start scans once a completion action is executing',async()=>{
  const f=await mainFixture({phase:'executing'});
  for(const action of ['resume','retry','scan'])await assert.rejects(f.invoke('downloadAction',{id:'cancelled-history',action}),/completion action|Wait before/i);
  assert.equal(f.actions.length,0);
});
test('isolated test profile never reaches the OS power boundary',async()=>{
  const f=await mainFixture({testMode:true});f.manager.downloads=[{id:'a',status:'completed'}];
  await assert.rejects(f.scheduler.options.onExecute('shutdown',{ids:['a']}),/disabled.*test session/);
  assert.equal(f.powerCalls.length,0);assert.equal(f.saved,0);
});
test('execution guard rechecks the full queue immediately before requesting power action',async()=>{
  const f=await mainFixture({testMode:false});f.manager.downloads=[{id:'a',status:'completed'},{id:'new',status:'queued'}];
  await assert.rejects(f.scheduler.options.onExecute('shutdown',{ids:['a']}),/queue changed/);
  assert.equal(f.powerCalls.length,0);
});

test('the final OS boundary rejects pending or adverse scan results for both actions',async()=>{
  for(const mode of ['close','shutdown'])for(const status of ['queued','scanning','threat','error','missing','unavailable','review','unknown']){
    const f=await mainFixture({testMode:false});f.manager.downloads=[{id:'a',status:'completed',scan:{status}}];
    await assert.rejects(f.scheduler.options.onExecute(mode,{ids:['a']}),/Defender scans|scan.*blocked/i);
    assert.equal(f.powerCalls.length,0);assert.equal(f.saved,0);assert.equal(f.quit,undefined);
  }
});

test('a late scan of completed history also blocks the final OS boundary',async()=>{
  const f=await mainFixture({testMode:false});f.manager.downloads=[{id:'a',status:'completed'},{id:'old',status:'completed',scan:{status:'queued'}}];
  await assert.rejects(f.scheduler.options.onExecute('shutdown',{ids:['a']}),/Defender scans/);assert.equal(f.powerCalls.length,0);
});
test('shutdown command requests graceful immediate shutdown without forced app termination',async()=>{
  const f=await mainFixture({testMode:false});f.manager.downloads=[{id:'a',status:'completed'}];
  await f.scheduler.options.onExecute('shutdown',{ids:['a']});
  assert.equal(f.powerCalls.length,1);
  assert.equal(JSON.stringify(f.powerCalls[0].args),JSON.stringify(['/s','/t','0']));
  assert.equal(f.powerCalls[0].options.windowsHide,true);
});
test('untrusted window and child-frame IPC cannot arm a completion action',async()=>{
  const f=await mainFixture();
  await assert.rejects(f.invoke('setCompletionAction','shutdown',{sender:{},senderFrame:{url:'atlas://app/index.html'}}),/Invalid app request/);
  await assert.rejects(f.invoke('setCompletionAction','shutdown',{sender:f.windows[0].webContents,senderFrame:{url:'atlas://app/index.html'}}),/Invalid app request/);
});
test('custom collection IDs must be strings so saved collections stay selectable',async()=>{
  const f=await mainFixture();
  const result=await f.invoke('saveSettings',{collections:[{id:123,name:'Broken',games:[]},{id:'valid-id',name:'Good',games:[]}]});
  assert.equal(result.settings.collections.length,1);assert.equal(result.settings.collections[0].id,'valid-id');
});
