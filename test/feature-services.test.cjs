'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const {DownloadManager}=require('../src/downloads.cjs');
const {ClipboardInbox}=require('../src/clipboard-inbox.cjs');
const {createDownloadCleanup}=require('../src/download-cleanup.cjs');
const base=path.resolve(__dirname,'.feature-fixtures');fs.mkdirSync(base,{recursive:true});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function until(fn){const deadline=Date.now()+3000;while(!fn()){if(Date.now()>deadline)throw new Error('Feature test timed out.');await new Promise(resolve=>setTimeout(resolve,5));}}
function load(file,replacements={},extra=''){
  const module={exports:{}},native=createRequire(file),requireFn=name=>Object.prototype.hasOwnProperty.call(replacements,name)?replacements[name]:native(name);
  vm.compileFunction(fs.readFileSync(file,'utf8')+extra,['require','module','exports','__filename','__dirname'],{filename:file})(requireFn,module,module.exports,file,path.dirname(file));return module.exports;
}
function fixture(t,{settings={},cleanupGate=null,storageGate=null,register=null,Notification,packaged=false,completionMode='none',hardware,statfs,requirements=null}={}){
  const root=fs.mkdtempSync(path.join(base,'case-')),profile=path.join(root,'profile'),folder=path.join(root,'Game');fs.mkdirSync(profile);fs.mkdirSync(folder);
  const manager=new DownloadManager({stateFile:path.join(profile,'library.json'),downloadDir:root,fetcher:async()=>{throw new Error('Network access is not part of feature tests.');}});
  manager.settings={...manager.settings,autoUpdateEnabled:false,clipboardWatchEnabled:false,notificationsEnabled:false,...settings};
  const calls={publish:0,quit:0,metadata:[],getGame:[],prepare:[],spawn:[],events:[],clipboardReads:0},handlers=new Map(),instances={};
  const completion={phase:'idle',mode:completionMode,snapshot(){return {phase:this.phase,mode:this.mode};},cancel(){this.phase='idle';this.mode='none';calls.events.push('completion:cancel');},dispose(){calls.events.push('completion:dispose');}};
  const appEvents=new Map(),app={isPackaged:packaged,getVersion:()=> '0.4.0',getPath:()=>profile,setPath(){},requestSingleInstanceLock:()=>true,exit(){},on(name,fn){appEvents.set(name,fn);},whenReady:()=>new Promise(()=>{}),quit(){calls.quit++;},setName(){}};
  const frame={url:'atlas://app/index.html'},win={webContents:{mainFrame:frame,send(){}},isDestroyed:()=>false,show(){},focus(){}};
  class FakeUpdater{
    constructor(options){this.options=options;this.state={phase:'idle',currentVersion:options.currentVersion};instances.updater=this;}
    snapshot(){return {...this.state};}configure(enabled){this.enabled=enabled;}async check(){calls.events.push('update:check');return this.snapshot();}
    async download(){calls.events.push('update:download');return this.snapshot();}async cleanupLeftovers(){calls.events.push('update:cleanup');return {removed:0};}
    dispose(){calls.events.push('update:dispose');}
    async prepareInstall(options){calls.prepare.push(options);calls.events.push('update:prepare');return {helper:path.join(root,'fixture-helper.exe'),job:path.join(root,'fixture-job.json')};}
  }
  class ObservedInbox extends ClipboardInbox{constructor(options){super(options);instances.inbox=this;}}
  const verifier={phase:'idle',starts:[],snapshot(){return {phase:this.phase,completed:0,total:0,results:[],error:''};},start(options){this.starts.push(options);this.phase='running';return this.snapshot();},cancel(){calls.events.push('verify:cancel');this.phase='cancelled';return this.snapshot();}};
  const chooser=[],dialog={async showOpenDialog(){return chooser.shift()||{canceled:true,filePaths:[]};}},clipboard={value:'',readText(){calls.clipboardReads++;return this.value;}};
  const checked=new Map(),providers={async getGame(url){calls.getGame.push(url);if(url!=='https://fitgirl-repacks.site/fixture/')throw new Error('Private failure C:\\private\\token');return {steamAppId:'570',title:'Fixture',systemRequirements:'OS: example'};}};
  const module=load(path.resolve(__dirname,'../src/feature-services.cjs'),{
    './app-updater.cjs':{AppUpdater:FakeUpdater},
    './clipboard-inbox.cjs':{ClipboardInbox:ObservedInbox},
    './game-metadata.cjs':{createGameMetadata:()=>async game=>{calls.metadata.push(game);return {source:'Steam',requirements:requirements||{minimum:'',recommended:''},reviews:null,genres:[]};}},
    './integrity-verifier.cjs':{createIntegrityVerifier:()=>verifier},
    './download-cleanup.cjs':{createDownloadCleanup:options=>{const cleanup=createDownloadCleanup(options);return {...cleanup,async summary(value){instances.storageSignal=value?.signal;calls.events.push('storage:pending');if(storageGate)await storageGate.promise;return cleanup.summary(value);},async deletePreview(value){if(cleanupGate){calls.events.push('cleanup:pending');await cleanupGate.promise;}return cleanup.deletePreview(value);}};}},
    'node:child_process':{spawn(helper,args,options){calls.spawn.push({helper,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}}
  });
  const services=module.createFeatureServices({app,win,manager,completion,dialog,clipboard,Notification,register:(name,handler)=>{handlers.set(name,handler);register?.(name,handler);},publish:()=>calls.publish++,providers,checked,hardware,statfs,isTest:false});
  const add=(id='one',name='archive.rar',content='fixture archive')=>{const download={id,name,folder,status:'paused',received:content.length,total:content.length,url:'https://example.invalid/'+name,sourceUrl:'https://example.invalid/'+name,headers:{}};manager.downloads.push(download);fs.writeFileSync(path.join(folder,name),content,{flag:'wx'});return download;};
  t.after(async()=>{
    cleanupGate?.resolve();storageGate?.resolve();instances.updater.state.phase='idle';instances.updater.state.installApproved=false;await manager.stop();await services.beforeQuit();
    const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});
  });
  return {root,profile,folder,manager,calls,handlers,completion,app,appEvents,win,instances,services,verifier,chooser,clipboard,checked,add,featureSettings:module.featureSettings};
}

test('Feature defaults preserve saved preferences and clipboard observation remains opt in',async t=>{
  const f=fixture(t,{settings:{autoUpdateEnabled:false,clipboardWatchEnabled:false,notificationsEnabled:false,adaptiveThemeEnabled:false,favorites:[{title:'keep'}]}});
  assert.equal(f.instances.updater.enabled,false);assert.equal(f.instances.inbox.enabled,false);assert.equal(f.calls.clipboardReads,0);assert.equal(f.manager.settings.adaptiveThemeEnabled,false);assert.deepEqual(f.manager.settings.favorites,[{title:'keep'}]);
  assert.equal(f.instances.updater.options.bandwidthLimiter,f.manager.bandwidthLimiter,'update bytes share the queue-wide bandwidth budget');
  await f.handlers.get('checkForUpdates')();assert.ok(f.calls.events.includes('update:check'),'a manual check remains available with automatic checks disabled');
  assert.throws(()=>f.featureSettings({clipboardWatchEnabled:'true'}),/on or off/);assert.deepEqual(f.featureSettings({clipboardWatchEnabled:false,autoUpdateEnabled:false}),{clipboardWatchEnabled:false,autoUpdateEnabled:false});
});
test('List-only removal preserves files and releases locks after the actual manager removes its rows',async t=>{
  const f=fixture(t),download=f.add();const result=await f.handlers.get('removeDownloads')({ids:[download.id],mode:'list'});
  assert.deepEqual(result.removedIds,[download.id]);assert.equal(f.manager.downloads.length,0);assert.equal(f.manager.quiescing.size,0);assert.equal(fs.readFileSync(path.join(f.folder,download.name),'utf8'),'fixture archive');assert.ok(f.calls.publish>0);
});
test('Removing downloads cancels a finish action only when one is set',async t=>{
  const idle=fixture(t),first=idle.add();await idle.handlers.get('removeDownloads')({ids:[first.id],mode:'list'});
  assert.ok(!idle.calls.events.includes('completion:cancel'),'with no finish action set, nothing is reported as cancelled');
  const armed=fixture(t,{completionMode:'close'}),second=armed.add();await armed.handlers.get('removeDownloads')({ids:[second.id],mode:'list'});
  assert.ok(armed.calls.events.includes('completion:cancel'));
});
test('File deletion needs a current preview token and retains unrelated files',async t=>{
  const f=fixture(t),download=f.add(),unrelated=path.join(f.folder,'untracked.rar');fs.writeFileSync(unrelated,'keep');
  await assert.rejects(f.handlers.get('removeDownloads')({ids:[download.id],mode:'files'}),/preview expired or changed/);assert.equal(f.manager.downloads.length,1);assert.equal(f.manager.quiescing.size,0);assert.ok(fs.existsSync(path.join(f.folder,download.name)));
  const preview=await f.handlers.get('previewDownloadRemoval')({ids:[download.id]});const result=await f.handlers.get('removeDownloads')({ids:[download.id],mode:'files',token:preview.token});
  assert.deepEqual(result.removedIds,[download.id]);assert.deepEqual(result.errors,[]);assert.equal(f.manager.downloads.length,0);assert.equal(f.manager.quiescing.size,0);assert.equal(fs.existsSync(path.join(f.folder,download.name)),false);assert.equal(fs.readFileSync(unrelated,'utf8'),'keep');
});
test('Cleanup preview waits for active work and cancellation leaves bytes intact and rows paused',async t=>{
  const f=fixture(t),download=f.add(),pending=deferred(),controller=new AbortController();download.status='downloading';f.manager.running.set(download.id,controller);f.manager.taskById.set(download.id,pending.promise);
  let finished=false;const preview=f.handlers.get('previewDownloadRemoval')({ids:[download.id]}).then(value=>{finished=true;return value;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(controller.signal.aborted,true);assert.equal(download.status,'paused');assert.equal(finished,false);assert.equal(f.manager.quiescing.has(download.id),true);
  f.manager.running.delete(download.id);f.manager.taskById.delete(download.id);pending.resolve();const result=await preview;
  assert.equal(result.items.length,1);assert.match(result.warnings.join(' '),/Cancelling leaves them paused/);assert.equal(f.manager.quiescing.size,0);assert.equal(fs.readFileSync(path.join(f.folder,download.name),'utf8'),'fixture archive');
});
test('Restart for update is refused while downloads, scans, verification or completion are active',t=>{
  const f=fixture(t),download=f.add();Object.assign(f.instances.updater.state,{phase:'ready',installApproved:true});
  for(const status of ['queued','downloading']){download.status=status;assert.throws(()=>f.handlers.get('installUpdate')(),/Pause active work/);}
  download.status='completed';for(const status of ['queued','scanning']){download.scan={status};assert.throws(()=>f.handlers.get('installUpdate')(),/Pause active work/);}
  delete download.scan;download.status='paused';f.verifier.phase='running';assert.throws(()=>f.handlers.get('installUpdate')(),/Pause active work/);f.verifier.phase='idle';
  for(const phase of ['countdown','executing']){f.completion.phase=phase;assert.throws(()=>f.handlers.get('installUpdate')(),/Pause active work/);}f.completion.phase='idle';assert.equal(f.calls.quit,0);
  assert.deepEqual(f.handlers.get('installUpdate')(),{restarting:true});assert.equal(f.calls.quit,1);assert.equal(f.calls.prepare.length,0,'replacement preparation is deferred until shutdown');
});
test('Restart for update is refused during pending deletion and normal exit waits for cleanup',async t=>{
  const gate=deferred(),f=fixture(t,{cleanupGate:gate}),download=f.add();Object.assign(f.instances.updater.state,{phase:'ready',installApproved:true});
  const preview=await f.handlers.get('previewDownloadRemoval')({ids:[download.id]});const removal=f.handlers.get('removeDownloads')({ids:[download.id],mode:'files',token:preview.token});
  await until(()=>f.calls.events.includes('cleanup:pending'));
  try{
    assert.throws(()=>f.handlers.get('removeDownloads')({ids:[download.id],mode:'list'}),/current cleanup operation/);
    assert.throws(()=>f.handlers.get('previewDownloadRemoval')({ids:[download.id]}),/current cleanup operation/);
    assert.equal(f.manager.quiescing.has(download.id),true,'a rejected second request cannot release the first cleanup lock');
    assert.ok(fs.existsSync(path.join(f.folder,download.name)),'the first removal still awaits its deletion step');
    assert.throws(()=>f.handlers.get('installUpdate')(),/Pause active work|cleanup|remov/i);
    let quitFinished=false;const quitting=f.services.beforeQuit().then(()=>{quitFinished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(quitFinished,false);assert.equal(f.calls.prepare.length,0);
    assert.throws(()=>f.handlers.get('previewDownloadRemoval')({ids:[download.id]}),/closing/);
    gate.resolve();await removal;await quitting;assert.equal(f.calls.prepare.length,1);assert.equal(f.manager.downloads.length,0);
  }finally{gate.resolve();await removal;}
});
test('Update preparation is deferred to exit and launches only the supplied helper without a shell',async t=>{
  const f=fixture(t);Object.assign(f.instances.updater.state,{phase:'ready',installApproved:true});f.handlers.get('installUpdate')();assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.spawn.length,0);
  await f.services.beforeQuit();assert.deepEqual(f.calls.prepare,[{restart:true}]);assert.equal(f.calls.spawn.length,1);
  const spawned=f.calls.spawn[0];assert.equal(spawned.helper,path.join(f.root,'fixture-helper.exe'));assert.deepEqual(spawned.args,[path.join(f.root,'fixture-job.json')]);assert.equal(spawned.options.windowsHide,true);assert.equal(spawned.options.detached,true);assert.notEqual(spawned.options.shell,true);
});

test('Exit waits for interrupted updater cleanup before preparing a verified update',async t=>{
  const f=fixture(t),gate=deferred();Object.assign(f.instances.updater.state,{phase:'ready',installApproved:true});
  f.instances.updater.dispose=()=>gate.promise;
  let finished=false;const quitting=f.services.beforeQuit().then(()=>{finished=true;});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.spawn.length,0);}
  finally{gate.resolve();await quitting;}
  assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.spawn.length,1);
});

test('Updates download only through the explicit download request and install only after approval',async t=>{
  const f=fixture(t);
  await f.handlers.get('downloadUpdate')();assert.deepEqual(f.calls.events.filter(event=>event.startsWith('update:')),['update:download']);
  f.instances.updater.state.phase='ready';
  for(const approval of [undefined,false,'true'])assert.throws(()=>{f.instances.updater.state.installApproved=approval;f.handlers.get('installUpdate')();},/Choose Download and install/);
  assert.equal(f.calls.quit,0);
  await f.services.beforeQuit();assert.equal(f.calls.prepare.length,0,'an unapproved ready state is never prepared');assert.equal(f.calls.spawn.length,0);
  assert.deepEqual(f.calls.events.filter(event=>event==='update:cleanup'),[],'leftover cleanup is scheduled only for supported packaged builds');
});
test('Packaged Windows builds clean update leftovers after start and again later, and stop on exit',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const supported=()=>{
    const platform=Object.getOwnPropertyDescriptor(process,'platform'),portable=process.env.PORTABLE_EXECUTABLE_FILE;
    Object.defineProperty(process,'platform',{...platform,value:'win32'});process.env.PORTABLE_EXECUTABLE_FILE='C:\\Portable\\Ravenshelf.exe';
    try{return fixture(t,{packaged:true});}
    finally{Object.defineProperty(process,'platform',platform);if(portable===undefined)delete process.env.PORTABLE_EXECUTABLE_FILE;else process.env.PORTABLE_EXECUTABLE_FILE=portable;}
  };
  const cleanups=f=>f.calls.events.filter(event=>event==='update:cleanup').length;
  const f=supported(),closed=supported();assert.equal(f.instances.updater.options.supported,true);
  await closed.services.beforeQuit();
  t.mock.timers.tick(9999);assert.equal(cleanups(f),0);t.mock.timers.tick(1);assert.equal(cleanups(f),1);
  t.mock.timers.tick(20*60*1000-10000);assert.equal(cleanups(f),2);
  t.mock.timers.tick(60*60*1000);assert.equal(cleanups(f),2,'only two passes are scheduled');
  assert.equal(cleanups(closed),0,'closing Ravenshelf cancels scheduled cleanup');
});
test('Available updates are announced once per version without downloading',async t=>{
  const shown=[];class FakeNotification{static isSupported(){return true;}constructor(options){this.options=options;}on(){}show(){shown.push(this.options);}}
  const f=fixture(t,{settings:{notificationsEnabled:true},Notification:FakeNotification});
  f.instances.updater.options.onAvailable('0.4.2');f.instances.updater.options.onAvailable('0.4.2');f.instances.updater.options.onAvailable('0.4.3');
  assert.deepEqual(shown.map(item=>item.title),['Ravenshelf update available','Ravenshelf update available']);assert.match(shown[0].body,/Version 0\.4\.2 is available\. Open Settings to review and install it\./);
  assert.equal(f.calls.events.includes('update:download'),false);
});
test('Storage IPC coalesces repeated checks and refuses scans after shutdown',async t=>{
  const f=fixture(t);f.add();fs.writeFileSync(path.join(f.root,'outside-queue.rar'),'separate archive');
  const first=f.handlers.get('getStorageSummary')(),second=f.handlers.get('getStorageSummary')();
  assert.equal(first,second);const result=await first;
  assert.equal(result.untrackedBytes,Buffer.byteLength('separate archive'));assert.equal(result.untrackedItems[0].deletable,false);
  await f.services.beforeQuit();assert.throws(()=>f.handlers.get('getStorageSummary')(),/closing/);
});

test('Shutdown aborts an in-progress storage scan and awaits its pending filesystem work',async t=>{
  const gate=deferred(),f=fixture(t,{storageGate:gate});
  const storage=f.handlers.get('getStorageSummary')(),rejection=assert.rejects(storage,{name:'AbortError'});
  await until(()=>f.calls.events.includes('storage:pending'));
  let finished=false;const quitting=f.services.beforeQuit().then(()=>{finished=true;});
  try{assert.equal(f.instances.storageSignal.aborted,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);}
  finally{gate.resolve();await rejection;await quitting;}
  assert.equal(finished,true);assert.equal(f.calls.prepare.length,0);
});
test('Verification IPC uses native dialog choices, never supplied renderer paths',async t=>{
  const f=fixture(t);f.chooser.push({canceled:false,filePaths:[path.join(f.root,'chosen.sfv')]},{canceled:false,filePaths:[f.folder]});
  await f.handlers.get('verifyFiles')({manifestPath:'C:\\unapproved\\manifest',rootPath:'C:\\unapproved'});assert.deepEqual(f.verifier.starts,[{manifestPath:path.join(f.root,'chosen.sfv'),rootPath:f.folder}]);
  f.verifier.phase='idle';f.chooser.push({canceled:true,filePaths:[]});await f.handlers.get('verifyFiles')();assert.equal(f.verifier.starts.length,1);
});
test('Metadata re-fetches the trusted game page and ignores renderer-provided Steam identities',async t=>{
  const f=fixture(t);const result=await f.handlers.get('getGameMetadata')({url:'https://fitgirl-repacks.site/fixture/',steamAppId:'999999',systemRequirements:'forged'});
  assert.deepEqual(f.calls.getGame,['https://fitgirl-repacks.site/fixture/']);assert.equal(f.calls.metadata[0].steamAppId,'570');assert.equal(result.requirements.minimum,'OS: example');
  const unavailable=await f.handlers.get('getGameMetadata')({url:'https://unapproved.invalid/'});assert.equal(f.calls.metadata.length,1);assert.doesNotMatch(JSON.stringify(unavailable),/private|token|unapproved/);
});
test('Archive validation rejects unknown links and requires an explicit override for known gaps',t=>{
  const f=fixture(t),a='https://fuckingfast.co/first',b='https://fuckingfast.co/third';f.checked.set(a,{filename:'Game.part01.rar',size:100});f.checked.set(b,{filename:'Game.part03.rar',size:20});
  assert.throws(()=>f.handlers.get('validateArchiveSet')({sourceUrls:[a,'https://unapproved.invalid/']}),/Check|check|unknown|Invalid/);
  assert.ok(f.handlers.get('validateArchiveSet')({sourceUrls:[a,b]}).errors.length);assert.throws(()=>f.services.validateBatch([...f.checked.values()],false),/Archive parts/);assert.ok(f.services.validateBatch([...f.checked.values()],true).errors.length);
});
test('Clipboard import returns selected recognized links without checking or queuing downloads',t=>{
  const f=fixture(t);f.services.configure({clipboardWatchEnabled:true});f.clipboard.value='private clipboard text https://fuckingfast.co/file#part01.rar https://unapproved.invalid/secret';f.instances.inbox.poll();
  const tray=f.handlers.get('getClipboardInbox')();assert.equal(tray.items.length,1);const imported=f.handlers.get('importClipboardLinks')({ids:[tray.items[0].id]});assert.equal(imported.text,'https://fuckingfast.co/file#part01.rar');assert.equal(f.manager.downloads.length,0);assert.equal(f.calls.getGame.length,0);assert.equal(f.handlers.get('getClipboardInbox')().items.length,0);
});
test('All new feature IPC handlers retain main-frame and exact app-origin authorization',async t=>{
  const handlers=new Map(),appEvents=new Map(),app={getPath:()=>base,setPath(){},requestSingleInstanceLock:()=>true,exit(){},on(name,fn){appEvents.set(name,fn);},whenReady:()=>new Promise(()=>{})};
  const main=load(path.resolve(__dirname,'../src/main.cjs'),{electron:{app,protocol:{registerSchemesAsPrivileged(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}}},'\nmodule.exports.__test={handle,setWindow(value){win=value;}};');
  const f=fixture(t,{register:main.__test.handle});main.__test.setWindow(f.win);
  const trusted={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
  assert.equal((await handlers.get('atlas:getUpdateState')(trusted)).phase,'idle');
  const attacks=[{sender:{},senderFrame:f.win.webContents.mainFrame},{sender:f.win.webContents,senderFrame:{url:'atlas://app/index.html'}},{sender:f.win.webContents,senderFrame:null}];
  for(const name of ['getUpdateState','checkForUpdates','downloadUpdate','installUpdate','removeDownloads','verifyFiles','getGameMetadata','importClipboardLinks','checkGame','getDownloadSpace'])for(const event of attacks)await assert.rejects(handlers.get('atlas:'+name)(event,{}),/Invalid app request/);
  f.win.webContents.mainFrame.url='https://fuckingfast.co/';await assert.rejects(handlers.get('atlas:getUpdateState')(trusted),/Invalid app request/);assert.equal(f.calls.quit,0);assert.equal(f.verifier.starts.length,0);assert.equal(f.calls.getGame.length,0);
});

// Made-up hardware in the shape of the PC specs answer.
const SPECS={schema:1,status:'complete',system:{name:'Windows 11 Home',version:'10.0.22631',build:22631,architecture:'64-bit'},processor:{name:'Example CPU'},
  memory:{installedBytes:16*1024**3,usableBytes:15*1024**3},graphics:[{name:'Example GPU',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*1024**3,directx:12,featureLevel:'12.1',problem:false,main:true}],
  drives:[{letter:'C',freeBytes:100*1024**3,removable:false}],notes:[]};
test('Can You Run It compares the trusted game page with this PC, asking for the specs only once and without a new check',async t=>{
  const asks=[];const hardware={async get(options){asks.push(options);return SPECS;}};
  const f=fixture(t,{hardware,requirements:{minimum:'OS: Windows 10\nMemory: 8 GB RAM\nStorage: 500 GB',recommended:''}});
  const result=await f.handlers.get('checkGame')({url:'https://fitgirl-repacks.site/fixture/',steamAppId:'999999',requirements:{minimum:'Memory: 1 MB'},specs:{memory:{installedBytes:1}}});
  assert.deepEqual(f.calls.getGame,['https://fitgirl-repacks.site/fixture/']);
  assert.equal(f.calls.metadata[0].steamAppId,'570');
  assert.deepEqual(asks,[{refresh:false}]);
  assert.equal(result.status,'complete');
  assert.deepEqual(result.tiers.minimum.rows.map(row=>[row.key,row.verdict]),[['windows','meets'],['memory','meets'],['storage','below']]);
  assert.equal(result.tiers.recommended,undefined);
  for(const value of [undefined,null,{},{url:7},{url:'x'.repeat(2001)}])await assert.rejects(f.handlers.get('checkGame')(value),/Choose a game first/);
  assert.equal(asks.length,1);
  // Compare again reads this PC again; only a real true asks for that.
  await f.handlers.get('checkGame')({url:'https://fitgirl-repacks.site/fixture/',refresh:true});
  await f.handlers.get('checkGame')({url:'https://fitgirl-repacks.site/fixture/',refresh:'true'});
  assert.deepEqual(asks.slice(1),[{refresh:true},{refresh:false}]);
});
test('Can You Run It still answers when the specs cannot be read, and leaks nothing from a failed page',async t=>{
  const hardware={async get(){throw new Error('Private failure C:\\private\\hardware');}};
  const f=fixture(t,{hardware,requirements:{minimum:'Memory: 8 GB RAM',recommended:''}});
  const result=await f.handlers.get('checkGame')({url:'https://fitgirl-repacks.site/fixture/'});
  assert.equal(result.status,'no-specs');assert.equal(result.tiers.minimum.rows[0].verdict,'unknown');
  const failed=await f.handlers.get('checkGame')({url:'https://unapproved.invalid/'});
  assert.equal(failed.status,'details-unavailable');assert.doesNotMatch(JSON.stringify(failed),/private|token|unapproved/);
  // Without a specs service there is nothing to read.
  const g=fixture(t,{requirements:{minimum:'Memory: 8 GB RAM',recommended:''}});
  assert.equal((await g.handlers.get('checkGame')({url:'https://fitgirl-repacks.site/fixture/'})).status,'no-specs');
});
test('Free space is measured at the download folder, or its nearest existing parent',async t=>{
  const asked=[];
  const statfs=async folder=>{asked.push(folder);if(folder.endsWith('missing')||folder.endsWith('deeper'))throw Object.assign(new Error('gone'),{code:'ENOENT'});return {bavail:1000,bsize:4096};};
  const f=fixture(t,{statfs});
  f.manager.settings.downloadDir=path.join(f.root,'missing','deeper');
  const answer=await f.handlers.get('getDownloadSpace')();
  assert.equal(answer.freeBytes,4096000);
  assert.deepEqual(asked,[path.join(f.root,'missing','deeper'),path.join(f.root,'missing'),f.root]);
  assert.equal(answer.pendingBytes,0);
});
test('Free space: what downloads waiting on the same drive still need is counted',async t=>{
  const f=fixture(t,{statfs:async()=>({bavail:10,bsize:100})});
  const entry=(id,status,received,total)=>({id,name:id,folder:f.folder,status,received,total,url:'https://example.invalid/'+id,headers:{}});
  f.manager.downloads.push(entry('a','queued',0,1000),entry('b','downloading',400,1000),entry('c','paused',900,1000),entry('d','completed',500,1000),entry('e','cancelled',0,5000),entry('f','error',0,7000),entry('g','queued',0,0),entry('h','queued',0,null),entry('j','queued',0,undefined),entry('k','queued',0,'x'),entry('i','paused',2000,1000));
  const answer=await f.handlers.get('getDownloadSpace')();
  // A failed download can be retried: what it still needs counts too.
  assert.deepEqual(answer,{freeBytes:1000,pendingBytes:1000+600+100+7000});
});
test('Free space: unreadable drives, missing statfs and impossible numbers give no figure',async()=>{
  const {freeSpace}=require('../src/feature-services.cjs');
  assert.equal(await freeSpace('/x',{statfs:async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});}}),null);
  // A folder that cannot be read is not measured at its parent.
  assert.equal(await freeSpace('/x',{statfs:async folder=>{if(folder===path.resolve('/x'))throw Object.assign(new Error('denied'),{code:'EACCES'});return {bavail:1,bsize:1};}}),null);
  assert.equal(await freeSpace('/x',{statfs:null}),null);
  assert.equal(await freeSpace('',{statfs:async()=>({bavail:1,bsize:1})}),null);
  assert.equal(await freeSpace(7,{statfs:async()=>({bavail:1,bsize:1})}),null);
  assert.equal(await freeSpace('/x',{statfs:async()=>({bavail:2**53,bsize:4096})}),null);
  assert.equal(await freeSpace('/x',{statfs:async()=>({bavail:-1,bsize:4096})}),null);
  assert.equal(await freeSpace('/x',{statfs:async()=>({bavail:'abc',bsize:4096})}),null);
  assert.equal(await freeSpace('/x',{statfs:async()=>({bavail:0,bsize:4096})}),0);
  assert.equal(await freeSpace('/',{statfs:async()=>{throw Object.assign(new Error('gone'),{code:'ENOENT'});}}),null);
  // BigInt answers are read too.
  assert.equal(await freeSpace('/x',{statfs:async()=>({bavail:3n,bsize:4096n})}),12288);
});
test('Free space: on Windows a download on another drive is not counted',async()=>{
  const module=load(path.resolve(__dirname,'../src/feature-services.cjs'),{'node:path':path.win32});
  const handlers=new Map();
  const manager={settings:{downloadDir:'D:\\Downloads\\Atlas'},downloads:[
    {status:'queued',folder:'D:\\Downloads\\Atlas\\Game',received:0,total:300},
    {status:'queued',folder:'d:\\Other',received:100,total:300},
    {status:'queued',folder:'C:\\Games\\Old',received:0,total:9000},
    {status:'queued',received:0,total:50}]};
  const asked=[];
  module.createFeatureServices({app:{isPackaged:false,getVersion:()=>'0.9.0',getPath:()=>base},win:{},manager,completion:null,dialog:{},clipboard:{readText:()=>''},Notification:null,
    register:(name,handler)=>handlers.set(name,handler),publish(){},providers:{},checked:new Map(),statfs:async folder=>{asked.push(folder);return {bavail:1,bsize:4096};},isTest:true});
  assert.deepEqual(await handlers.get('getDownloadSpace')(),{freeBytes:4096,pendingBytes:300+200+50});
  assert.deepEqual(asked,['D:\\Downloads\\Atlas']);
});

test('Free space: a drive that does not answer gives no figure after four seconds, and one check runs at a time',async t=>{
  let calls=0,release;
  const statfs=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const timers=[];
  const realSetTimeout=global.setTimeout;
  // The app lets this timer go (unref); here it must keep the test running.
  global.setTimeout=(fn,ms,...rest)=>{if(ms===4000){timers.push(ms);const handle=realSetTimeout(fn,1,...rest);handle.unref=()=>handle;return handle;}return realSetTimeout(fn,ms,...rest);};
  try{
    const f=fixture(t,{statfs});
    const [first,second]=await Promise.all([f.handlers.get('getDownloadSpace')(),f.handlers.get('getDownloadSpace')()]);
    assert.equal(first.freeBytes,null);assert.equal(second.freeBytes,null);
    assert.equal(calls,1);assert.deepEqual(timers,[4000]);
    release({bavail:1,bsize:1});
    // After it is over, the next question checks again.
    const g=fixture(t,{statfs:async()=>({bavail:2,bsize:3})});
    assert.equal((await g.handlers.get('getDownloadSpace')()).freeBytes,6);
  }finally{global.setTimeout=realSetTimeout;}
});

test('Free space: each new question after the last one is over measures again',async t=>{
  let free=0;
  const f=fixture(t,{statfs:async()=>({bavail:++free,bsize:1})});
  assert.equal((await f.handlers.get('getDownloadSpace')()).freeBytes,1);
  assert.equal((await f.handlers.get('getDownloadSpace')()).freeBytes,2);
});
