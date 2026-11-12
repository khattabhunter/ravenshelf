'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Exercise the real registered IPC handler without launching Electron or touching a profile.
async function mainFixture(){
  const handles=new Map(),windows=[],stored=new Map();let manager;
  class Manager {
    constructor(){this.settings={downloadDir:'C:\\Atlas-fixture',concurrency:2,connectionsPerFile:4,favorites:[],collections:[]};this.downloads=[];manager=this;}
    state(){return {settings:{...this.settings},downloads:this.downloads};}
    on(){} updateSettings(changes){Object.assign(this.settings,changes);}
  }
  class Completion {snapshot(){return {mode:'none',phase:'idle'};}}
  class Refresher {snapshot(){return {enabled:true};}start(){}}
  class Window {
    constructor(){this.webContents={mainFrame:{url:'atlas://app/index.html'},on(){},setWindowOpenHandler(){},send(){}};windows.push(this);}
    on(){}once(){}loadURL(){return Promise.resolve();}isDestroyed(){return false;}
  }
  const electron={
    app:{setPath(){},getPath:()=>path.join(__dirname,'.unused-connection-profile'),getVersion:()=>'fixture',requestSingleInstanceLock:()=>true,on(){},setName(){},whenReady:()=>Promise.resolve(),quit(){throw new Error('Unexpected app quit');}},
    BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handles.set(name,handler)},
    protocol:{registerSchemesAsPrivileged(){},handle(){}},
    session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{}}},
    powerMonitor:{on(){}},dialog:{showErrorBox:(_title,error)=>{throw new Error(error);}},shell:{},clipboard:{}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Buffer,Response,setImmediate,
    process:{env:{ATLAS_TEST_DIR:path.join(__dirname,'.unused-connection-profile')}},
    require:request=>{
      if(request==='electron')return electron;
      if(request==='node:child_process')return {execFile(){throw new Error('Power actions are not part of this test');}};
      if(request==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON:(file,data)=>stored.set(file,data),loadJSON:(file,fallback)=>stored.get(file)??fallback};
      if(request==='./completion-action.cjs')return {CompletionAction:Completion};
      if(request==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(request==='./providers.cjs'||request==='./catalog.cjs')return {};
      if(request==='./installed-games.cjs')return {scanInstalledGames:async()=>({games:[]})};
      return request.startsWith('./')?require(path.join(__dirname,'../src',request)):require(request);
    }
  });
  await new Promise(resolve=>setImmediate(resolve));
  const win=windows[0];
  return {manager,win,invoke:(patch,event)=>handles.get('atlas:saveSettings')(event||{sender:win.webContents,senderFrame:win.webContents.mainFrame},patch)};
}

test('connection preference reaches the manager through trusted IPC and invalid choices leave it unchanged',async()=>{
  const f=await mainFixture();
  for(const value of [1,2,4]){
    const state=await f.invoke({connectionsPerFile:value});
    assert.equal(state.settings.connectionsPerFile,value);
    assert.equal(state.settings.concurrency,2,'per-file connections must not change simultaneous files');
  }
  for(const value of [0,-1,3,5,2.5,NaN,Infinity,'4',null,{},[4]]){
    await assert.rejects(f.invoke({connectionsPerFile:value}),/Choose 1, 2 or 4/);
    assert.equal(f.manager.settings.connectionsPerFile,4);
  }
  await f.invoke({favorites:[]});
  assert.equal(f.manager.settings.connectionsPerFile,4,'saving unrelated preferences preserves this setting');
});

test('a host page or child frame cannot change connection settings',async()=>{
  const f=await mainFixture();
  await assert.rejects(f.invoke({connectionsPerFile:1},{sender:{},senderFrame:f.win.webContents.mainFrame}),/Invalid app request/);
  await assert.rejects(f.invoke({connectionsPerFile:1},{sender:f.win.webContents,senderFrame:{url:'atlas://app/index.html'}}),/Invalid app request/);
  assert.equal(f.manager.settings.connectionsPerFile,4);
});

function rendererFixture(api={}){
  const nodes=new Map();
  const node=()=>({textContent:'',hidden:false,disabled:false,value:'',dataset:{},style:{},attributes:{},events:new Map(),children:[],
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},
    replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    addEventListener(name,listener){this.events.set(name,listener);},classList:{toggle(){}},querySelectorAll(){return [];},
    focus(){},remove(){},className:''});
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>[],createElement:node,activeElement:null,addEventListener(){}};
  const context=vm.createContext({window:{atlas:api},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=source=>vm.runInContext(source,context);
  return {get,document,context,run};
}

test('download cards show current connections and a safe fallback explanation without replacing progress or controls',()=>{
  const f=rendererFixture();
  const controls=f.get('.download-actions');controls.dataset.status='downloading';controls.children=[{label:'Pause'}];
  f.context.card={querySelector:f.get};
  f.context.item={id:'part',name:'game.part01.rar',status:'downloading',received:1024,total:2048,speed:512,connectionMode:'parallel',activeConnections:4};
  f.run('updateDownloadCard(card,item)');
  assert.match(f.get('.download-connections').textContent,/4 active connections/);
  const progress=f.get('.download-progress');
  assert.equal(progress.attributes['aria-valuenow'],'50');
  f.context.item.connectionMode='single';f.context.item.activeConnections=1;
  f.context.item.connectionNote='Host requires one connection. <script>untrusted text</script>';
  f.run('updateDownloadCard(card,item)');
  assert.match(f.get('.download-connections').textContent,/1 active connection.*Host requires one connection/);
  assert.equal(f.get('.download-connections').innerHTML,undefined,'remote descriptions stay plain text');
  assert.equal(f.get('.download-progress'),progress);
  assert.equal(progress.attributes['aria-valuenow'],'50');
  assert.equal(f.get('.download-actions'),controls);
  assert.equal(controls.children[0].label,'Pause');
  f.context.item.connectionMode='checking';f.context.item.activeConnections=0;f.context.item.connectionNote='';
  f.run('updateDownloadCard(card,item)');
  assert.match(f.get('.download-connections').textContent,/Checking connection support/);
});

test('connection selector defaults to four, preserves focused edits, and sends a numeric preference',async()=>{
  const sent=[];let release;
  const f=rendererFixture({saveSettings:patch=>{sent.push(patch);return new Promise(resolve=>{release=resolve;});}});
  f.run('renderSettings();wireEvents();toast=()=>{};');
  const control=f.get('#connections-per-file');
  assert.equal(control.value,'4');
  control.value='2';f.document.activeElement=control;f.run('renderSettings()');
  assert.equal(control.value,'2');
  const pending=control.events.get('change')();
  assert.equal(control.disabled,true);
  assert.equal(sent[0].connectionsPerFile,2);
  release({settings:{connectionsPerFile:2}});await pending;
  assert.equal(control.disabled,false);
  assert.equal(f.run('state.settings.connectionsPerFile'),2);
});

test('the Defender scan setting only accepts true or false through trusted IPC',async()=>{
  const f=await mainFixture();
  for(const value of ['yes',1,null,{}])await assert.rejects(f.invoke({defenderScan:value}),/Choose whether to scan/);
  assert.equal((await f.invoke({defenderScan:false})).settings.defenderScan,false);
  assert.equal((await f.invoke({defenderScan:true})).settings.defenderScan,true);
  await assert.rejects(f.invoke({defenderScan:false},{sender:{},senderFrame:f.win.webContents.mainFrame}),/Invalid app request/);
  assert.equal(f.manager.settings.defenderScan,true);
});

test('finished download cards show the Defender result as plain text with a Scan again button',()=>{
  const f=rendererFixture();
  f.context.card={querySelector:f.get};
  f.context.item={id:'done',name:'game.part01.rar',status:'completed',received:3,total:3,scan:{status:'scanning'}};
  f.run('updateDownloadCard(card,item)');
  const scan=f.get('.download-scan'),controls=f.get('.download-actions');
  assert.equal(scan.hidden,false);assert.match(scan.className,/busy/);
  assert.match(scan.children[1].textContent,/Scanning with Microsoft Defender/);
  assert.equal(controls.children.length,1,'no Scan again button while a scan is running');
  f.context.item.scan={status:'threat',message:'Microsoft Defender found a threat. <img src=x onerror=alert(1)>'};
  f.run('updateDownloadCard(card,item)');
  assert.match(scan.className,/threat/);
  assert.equal(scan.children[1].textContent,'Microsoft Defender found a threat. <img src=x onerror=alert(1)>');
  assert.equal(scan.children[1].innerHTML,undefined,'scan messages stay plain text');
  assert.equal(controls.children.length,2,'Scan again appears once the scan finishes');
  f.context.item={id:'active',name:'x',status:'downloading',received:1,total:3};
  f.run('updateDownloadCard(card,item)');
  assert.equal(scan.hidden,true);
});

test('the Defender scan selector sends a boolean and restores the old value on failure',async()=>{
  const sent=[];
  const f=rendererFixture({saveSettings:async patch=>{sent.push(patch);if(patch.defenderScan===false)throw new Error('Not saved');return {settings:{defenderScan:true}};}});
  f.run('renderSettings();wireEvents();toast=()=>{};applyState=()=>{};');
  const control=f.get('#defender-scan');
  assert.equal(control.value,'on');
  control.value='off';await control.events.get('change')();
  assert.equal(sent[0].defenderScan,false);assert.equal(Object.keys(sent[0]).length,1);
  assert.equal(control.value,'on');assert.equal(control.disabled,false);
});

test('scan review replaces a clean badge with a neutral alert and keeps untrusted output out of HTML',()=>{
  const f=rendererFixture(),htmlWrites=[],createElement=f.document.createElement;
  f.document.createElement=(...args)=>{
    const node=createElement(...args);let html;
    Object.defineProperty(node,'innerHTML',{get:()=>html,set:value=>{html=String(value);htmlWrites.push(html);}});
    return node;
  };
  f.context.card={querySelector:f.get};
  f.context.item={id:'review',name:'game.part01.rar',status:'completed',received:3,total:3,scan:{status:'clean'}};
  f.run('updateDownloadCard(card,item)');
  const scan=f.get('.download-scan');assert.ok(scan.className.split(/\s+/).includes('clean'));
  f.context.item.scan={status:'review'};f.run('updateDownloadCard(card,item)');
  assert.equal(scan.hidden,false);assert.ok(!scan.className.split(/\s+/).includes('clean'));
  assert.ok(!scan.className.split(/\s+/).includes('threat'),'ambiguous output must not claim a detected threat');
  assert.equal(f.run('scanText(item).glyph'),'alert');
  assert.match(scan.children[1].textContent,/needs review.*Protection history/);
  assert.doesNotMatch(scan.children[1].textContent,/found no threats/i);
  assert.ok(f.get('.download-actions').children.some(node=>node.attributes['aria-label']==='Scan again with Microsoft Defender'));
  const payload='Review required <img src=x onerror="window.reviewPayloadRan=true"><script>window.reviewPayloadRan=true</script>';
  f.context.window.reviewPayloadRan=false;f.context.item.scan.message=payload;f.run('updateDownloadCard(card,item)');
  assert.equal(scan.children[1].textContent,payload);assert.equal(scan.children[1].innerHTML,undefined);
  assert.ok(htmlWrites.every(markup=>!markup.includes('reviewPayloadRan')),'only developer SVG markup reaches an HTML sink');
  assert.equal(f.context.window.reviewPayloadRan,false);
  assert.ok(!scan.className.split(/\s+/).includes('clean'));
});

test('real applyState shows the global credential warning as text and clears it across views',()=>{
  const f=rendererFixture(),warning=f.get('#credential-warning');
  Object.defineProperty(warning,'innerHTML',{set(){assert.fail('Credential warnings must never be rendered as HTML');}});
  warning.insertAdjacentHTML=()=>assert.fail('Credential warnings must never be inserted as HTML');
  f.run('applyState({})');assert.equal(warning.hidden,true);assert.equal(warning.textContent,'');
  const payload='Sign-in details were not saved securely. <img src=x onerror="window.warningPayloadRan=true">';
  f.context.warningPayload=payload;f.context.window.warningPayloadRan=false;
  for(const view of ['discover','downloads','library','settings']){
    f.context.warningView=view;
    f.run('currentView=warningView;applyState({headerStorageWarning:warningPayload})');
    assert.equal(warning.hidden,false,view);assert.equal(warning.textContent,payload);
    f.run('applyState({settings:{connectionsPerFile:2}})');
    assert.equal(warning.hidden,false,'unrelated partial updates must preserve the warning');
    assert.equal(warning.textContent,payload);
    f.run('applyState({headerStorageWarning:""})');
    assert.equal(warning.hidden,true,view);assert.equal(warning.textContent,'');
  }
  assert.equal(f.context.window.warningPayloadRan,false);
});

test('completion controls can arm close while a finished file has a pending scan',async()=>{
  for(const status of ['queued','scanning']){
    const sent=[],f=rendererFixture({setCompletionAction:async mode=>{
      sent.push(mode);return {completionAction:{mode,phase:'armed',message:'Waiting for Microsoft Defender scans to finish.'}};
    }});
    f.context.scanStatus=status;f.run('state.downloads=[{id:"done",status:"completed",scan:{status:scanStatus}}];wireEvents();renderCompletionAction();');
    const control=f.get('#completion-mode');assert.equal(control.disabled,false);control.value='close';
    control.events.get('change')();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(sent,['close']);assert.equal(f.run('state.completionAction.phase'),'armed');
    assert.match(f.get('#completion-status').textContent,/Waiting for Microsoft Defender/);
    assert.equal(control.disabled,false);
  }
});
