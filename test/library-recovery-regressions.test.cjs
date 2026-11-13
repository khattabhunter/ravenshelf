'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadLibrary,validateLibrary,settingsFrom,downloadFrom,MAX_DOWNLOADS,RECOVERED,BLOCKED,LIST_FULL,SETTINGS_READ_ONLY}=require('../src/library-state.cjs');
const {DownloadManager,atomicJSON}=require('../src/downloads.cjs');
const base=path.resolve(__dirname,'.library-recovery-fixtures');fs.mkdirSync(base,{recursive:true});
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'run-')),file=path.join(root,'library.json'),folder=path.join(root,'Downloads','Game'),managers=[];
  const open=options=>{const manager=new DownloadManager({stateFile:file,downloadDir:path.dirname(folder),fetcher:async()=>{throw new Error('Unexpected request');},...options});managers.push(manager);return manager;};
  t.after(async()=>{for(const manager of managers)await manager.stop();assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,file,folder,open};
}
const job=(folder,i=0)=>({id:'job-'+i,url:'https://files.example.com/'+i,sourceUrl:'https://files.example.com/'+i,name:'part-'+i+'.rar',folder,status:'paused',received:i?0:100,total:1000,etag:'"resume-v1"',headers:{}});
const delegate=overrides=>new Proxy(fs,{get(target,key){return Object.hasOwn(overrides,key)?overrides[key]:target[key];}});
const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'operation finished');await new Promise(resolve=>setTimeout(resolve,5));}};

test('an oversized unfinished legacy queue survives restart, refuses growth, and still resumes its oldest partial',async t=>{
  const w=fixture(t);fs.mkdirSync(w.folder,{recursive:true});const partial=path.join(w.folder,'part-0.rar.atlas-part'),prefix=Buffer.alloc(100,1),suffix=Buffer.alloc(900,2);fs.writeFileSync(partial,prefix);
  const downloads=Array.from({length:MAX_DOWNLOADS+1},(_,i)=>job(w.folder,i));assert.deepEqual(downloadFrom(downloads[0]),downloads[0]);
  fs.writeFileSync(w.file,JSON.stringify({settings:{language:'ar',connectionsPerFile:1},downloads}));
  const first=w.open();assert.equal(first.downloads.length,MAX_DOWNLOADS+1);assert.equal(first.stateRecoveryWarning,'');assert.equal(first.downloads[0].id,'job-0');await first.stop();
  assert.equal(JSON.parse(fs.readFileSync(w.file,'utf8')).downloads.length,MAX_DOWNLOADS+1);assert.deepEqual(fs.readFileSync(partial),prefix);
  const requests=[],manager=w.open({fetcher:async(url,{headers})=>{requests.push({url,headers});return new Response(suffix,{status:206,headers:{'content-type':'application/octet-stream','content-length':'900','content-range':'bytes 100-999/1000',etag:'"resume-v1"'}});}});
  assert.equal(manager.downloads.length,MAX_DOWNLOADS+1);assert.equal(manager.settings.language,'ar');
  const link={status:'ready',url:'https://files.example.com/new',filename:'new.rar'};
  assert.throws(()=>manager.add({links:[link],gameTitle:'Game'}),{message:LIST_FULL});
  const quality=Object.keys(require('../src/youtube.cjs').QUALITIES)[0];assert.throws(()=>manager.addMedia({videoId:'abcdefghijk',quality}),{message:LIST_FULL});
  assert.throws(()=>manager.addTorrent({infoHash:'a'.repeat(40),magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40),name:'New',files:[{index:1,path:'New',length:1,selected:true,padding:false}]}),{message:LIST_FULL});
  assert.equal(manager.downloads.length,MAX_DOWNLOADS+1);assert.equal(fs.existsSync(path.join(w.folder,'new.rar')),false);
  manager.action('job-0','resume');await until(()=>manager.running.size===0);
  assert.equal(manager.downloads[0].status,'completed');assert.equal(manager.downloads.length,MAX_DOWNLOADS+1);assert.equal(requests.length,1);assert.equal(requests[0].headers.Range,'bytes=100-');assert.equal(requests[0].headers['If-Range'],'"resume-v1"');
  assert.deepEqual(fs.readFileSync(path.join(w.folder,'part-0.rar')),Buffer.concat([prefix,suffix]));assert.equal(fs.existsSync(partial),false);
});

test('trimming finished history never removes unfinished jobs even when those alone exceed the limit',()=>{
  const folder=path.resolve(base,'legacy','Game'),busy=Array.from({length:MAX_DOWNLOADS+1},(_,i)=>job(folder,i));
  const result=validateLibrary({settings:{language:'ar'},downloads:[{...job(folder,-1),status:'completed'},...busy,{...job(folder,-2),status:'cancelled'}]});
  assert.equal(result.changed,true);assert.deepEqual(result.data.downloads,busy);assert.equal(result.data.settings.language,'ar');
});

test('a missing profile is canonicalized once and never redirected to an existing library',t=>{
  const w=fixture(t),empty=path.join(w.root,'empty'),existing=path.join(w.root,'existing'),alias=path.join(w.root,'profile');fs.mkdirSync(empty);fs.mkdirSync(existing);fs.symlinkSync(empty,alias,process.platform==='win32'?'junction':'dir');
  const original={settings:{language:'ar'},downloads:[job(w.folder)]};assert.equal(validateLibrary(original).changed,false);
  const existingFile=path.join(existing,'library.json'),bytes=JSON.stringify(original);fs.writeFileSync(existingFile,bytes);let resolutions=0;
  const retarget=()=>{fs.unlinkSync(alias);fs.symlinkSync(existing,alias,process.platform==='win32'?'junction':'dir');};
  const real=function(value){resolutions++;if(resolutions===3)retarget();return fs.realpathSync(value);};real.native=real;
  const loaded=loadLibrary(path.join(alias,'library.json'),{io:delegate({realpathSync:real})});
  assert.equal(resolutions,1);assert.equal(loaded.canSave,true);assert.equal(loaded.file,path.join(fs.realpathSync(empty),'library.json'));
  // A later junction change also cannot change the selected save destination.
  retarget();atomicJSON(loaded.file,{schemaVersion:1,...loaded.data});
  assert.equal(fs.readFileSync(existingFile,'utf8'),bytes);assert.deepEqual(JSON.parse(fs.readFileSync(loaded.file,'utf8')).downloads,[]);
});

test('a missing target created while its parents are checked cannot authorize overwriting it',t=>{
  const w=fixture(t),original=JSON.stringify({settings:{language:'ar'},downloads:[job(w.folder)]});let created=false;
  const io=delegate({lstatSync(file,...args){if(file===w.root&&!created){created=true;fs.writeFileSync(w.file,original);}return fs.lstatSync(file,...args);}});
  const result=loadLibrary(w.file,{io});assert.equal(created,true);assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(fs.readFileSync(w.file,'utf8'),original);
});

test('a missing target whose parent changes during validation remains blocked',t=>{
  const w=fixture(t);let reads=0;
  const io=delegate({lstatSync(file,...args){const stat=fs.lstatSync(file,...args);if(file!==w.root||++reads<2)return stat;return new Proxy(stat,{get(target,key){if(key==='ino')return target.ino+1n;const value=target[key];return typeof value==='function'?value.bind(target):value;}});}});
  const result=loadLibrary(w.file,{io});assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(fs.existsSync(w.file),false);
});

for(const mutation of ['content','replacement','hardlink'])test(`a reused recovery copy changed by ${mutation} during reading is replaced with an intact exclusive copy`,t=>{
  const w=fixture(t),bytes=Buffer.from('{"settings":{"language":"ar"},"downloads":[null]}');fs.writeFileSync(w.file,bytes);
  const first=loadLibrary(w.file),fds=new Map();let changed=false;
  const io=delegate({
    openSync(file,...args){const fd=fs.openSync(file,...args);fds.set(fd,file);return fd;},
    closeSync(fd){fds.delete(fd);return fs.closeSync(fd);},
    readSync(fd,...args){const count=fs.readSync(fd,...args);if(!changed&&fds.get(fd)===first.recoveryFile){
      changed=true;
      if(mutation==='content'){fs.writeFileSync(first.recoveryFile,Buffer.alloc(bytes.length,120));const future=new Date(Date.now()+2000);fs.utimesSync(first.recoveryFile,future,future);}
      else if(mutation==='replacement'){fs.renameSync(first.recoveryFile,path.join(w.root,'previous-copy.json'));fs.writeFileSync(first.recoveryFile,bytes);}
      else fs.linkSync(first.recoveryFile,path.join(w.root,'linked-copy.json'));
    }return count;}
  });
  const result=loadLibrary(w.file,{io});assert.equal(changed,true);assert.equal(result.canSave,true);assert.equal(result.warning,RECOVERED);assert.notEqual(result.recoveryFile,first.recoveryFile);assert.deepEqual(fs.readFileSync(result.recoveryFile),bytes);assert.equal(fs.lstatSync(result.recoveryFile).nlink,1);
  atomicJSON(result.file,{schemaVersion:1,...result.data});assert.deepEqual(fs.readFileSync(result.recoveryFile),bytes,'repair leaves an intact copy of the original');
});

test('bounded malformed items preserve neighbouring favorites, shelves, and shelf games',t=>{
  const w=fixture(t),good={url:'https://fitgirl-repacks.site/good/',title:'Good'},last={url:'https://fitgirl-repacks.site/last/',title:'Last'};let deep={};for(let i=0;i<12;i++)deep={child:deep};
  const malformed=[{...good,title:'Oversized',image:'x'.repeat(1024*1024+1)},{...good,title:'Deep',extra:deep},JSON.parse('{"url":"https://fitgirl-repacks.site/bad/","title":"Prototype","__proto__":{}}')];
  for(const bad of malformed){
    const input={language:'ar',favorites:[good,bad,last],collections:[{id:'first',name:'First',games:[good]},{id:'broken',name:'Broken',extra:bad,games:[last]},{id:'mixed',name:'Mixed',games:[good,bad,last],color:'blue'}],gameFolders:[w.folder,{extra:bad},path.dirname(w.folder)]};
    const result=settingsFrom(input);assert.equal(result.changed,true);assert.equal(result.settings.language,'ar');assert.deepEqual(result.settings.favorites,[good,last]);assert.deepEqual(result.settings.collections,[{id:'first',name:'First',games:[good]},{id:'mixed',name:'Mixed',color:'blue',games:[good,last]}]);assert.deepEqual(result.settings.gameFolders,[w.folder,path.dirname(w.folder)]);
  }
  const input={favorites:[good,last],collections:[{id:'first',name:'First',games:[good,last],color:'blue'}]};assert.equal(settingsFrom(input).changed,false);assert.deepEqual(settingsFrom(input).settings,input);
  assert.equal({}.polluted,undefined);
});

test('nested shelf repair keeps the exact original in its recovery copy and persists good games',async t=>{
  const w=fixture(t),good={url:'https://fitgirl-repacks.site/good/',title:'Good'},bad={...good,title:'Bad',image:'x'.repeat(1024*1024+1)};
  const original=JSON.stringify({settings:{favorites:[good,bad],collections:[{id:'shelf',name:'Shelf',games:[good,bad]}]},downloads:[]});fs.writeFileSync(w.file,original);
  const manager=w.open();assert.equal(manager.stateRecoveryWarning,RECOVERED);assert.deepEqual(manager.settings.favorites,[good]);assert.deepEqual(manager.settings.collections[0].games,[good]);
  const backup=fs.readdirSync(w.root).find(name=>name.startsWith('library.json.recovery-'));assert.ok(backup);assert.equal(fs.readFileSync(path.join(w.root,backup),'utf8'),original);
  await manager.stop();const again=w.open();assert.equal(again.stateRecoveryWarning,'');assert.deepEqual(again.settings.collections[0].games,[good]);
});

test('close behavior accepts only the supported choices and never inserts a default into legacy settings',()=>{
  for(const closeBehavior of ['ask','background','quit'])assert.deepEqual(settingsFrom({closeBehavior}),{settings:{closeBehavior},changed:false});
  for(const closeBehavior of [null,true,42,'hide','',[],{},'QUIT'])assert.deepEqual(settingsFrom({language:'ar',closeBehavior}),{settings:{language:'ar'},changed:true});
  assert.deepEqual(settingsFrom({language:'ar'}),{settings:{language:'ar'},changed:false});
});

test('read-only state refuses remembered settings without changing the current preference or disk',t=>{
  const w=fixture(t),original=JSON.stringify({schemaVersion:99,settings:{closeBehavior:'quit'},downloads:[]});fs.writeFileSync(w.file,original);
  const manager=w.open(),before=manager.settings;
  assert.throws(()=>manager.updateSettings({closeBehavior:'background'}),{message:SETTINGS_READ_ONLY});
  assert.strictEqual(manager.settings,before);assert.equal(manager.settings.closeBehavior,undefined);assert.equal(fs.readFileSync(w.file,'utf8'),original);
});

test('failed settings writes restore preferences before changing the download rate or schedule',t=>{
  const w=fixture(t),manager=w.open();manager.pump=()=>{};manager.settings.closeBehavior='ask';manager.save();
  const original=fs.readFileSync(w.file,'utf8'),previous=manager.settings,save=manager.save,rate=manager.bandwidthLimiter.rate;
  const paused={...job(w.folder),pauseReason:'schedule',scheduleRequested:true};manager.downloads.push(paused);
  const failure=Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});let saves=0;
  manager.save=()=>{saves++;throw failure;};
  try{assert.throws(()=>manager.updateSettings({closeBehavior:'background',maxDownloadBytesPerSecond:1024}),error=>error===failure);}
  finally{manager.save=save;}
  assert.equal(saves,1);assert.strictEqual(manager.settings,previous);assert.equal(manager.settings.closeBehavior,'ask');assert.equal(manager.bandwidthLimiter.rate,rate);assert.equal(paused.status,'paused');assert.equal(fs.readFileSync(w.file,'utf8'),original);
  manager.updateSettings({closeBehavior:'background',maxDownloadBytesPerSecond:1024});
  assert.equal(manager.settings.closeBehavior,'background');assert.equal(manager.bandwidthLimiter.rate,1024);assert.equal(paused.status,'queued');assert.equal(JSON.parse(fs.readFileSync(w.file,'utf8')).settings.closeBehavior,'background');
});

test('a late dialog setting cannot change the shutdown checkpoint or remembered behavior',async t=>{
  const w=fixture(t),manager=w.open();manager.updateSettings({closeBehavior:'ask'});await manager.stop();
  const checkpoint=fs.readFileSync(w.file,'utf8'),previous=manager.settings,save=manager.save;let writes=0,events=0;
  manager.on('state',()=>events++);manager.save=function(){writes++;return save.call(this);};
  try{
    assert.throws(()=>manager.updateSettings({closeBehavior:'quit',downloadDir:path.join(w.root,'late')}),/Ravenshelf is closing/);
    assert.strictEqual(manager.settings,previous);assert.equal(writes,0);assert.equal(events,0);assert.equal(fs.readFileSync(w.file,'utf8'),checkpoint);
  }finally{manager.save=save;}
});
