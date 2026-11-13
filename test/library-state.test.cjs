'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadLibrary,validateLibrary,downloadFrom,readStateFile,settingsFrom,gameFolder,SCHEMA_VERSION,MAX_BYTES,MAX_DOWNLOADS,MAX_RECOVERY_COPIES,RECOVERED,BLOCKED,FUTURE,READ_ONLY,LIST_FULL}=require('../src/library-state.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');
const {DownloadManager}=require('../src/downloads.cjs');
const {canonicalUrl}=require('../src/youtube.cjs');
const base=path.resolve(__dirname,'.library-state-fixtures');fs.mkdirSync(base,{recursive:true});
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'run-')),file=path.join(root,'library.json'),folder=path.join(root,'Downloads','Game');
  const managers=[];
  t.after(async()=>{for(const manager of managers)await manager.stop();assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const open=(options={})=>{const manager=new DownloadManager({stateFile:file,downloadDir:path.join(root,'Downloads'),fetcher:async()=>{throw new Error('Unexpected request');},...options});managers.push(manager);return manager;};
  return {root,file,folder,open};
}
const job=(folder,extra={})=>({id:'job',url:'https://files.example.com/file?signature=active-test',sourceUrl:'https://host.example.com/file',name:'file.rar',folder,gameTitle:'Game',status:'paused',received:3,total:6,etag:'"one"',lastModified:null,headers:{},...extra});
const save=(file,data)=>fs.writeFileSync(file,JSON.stringify(data));
const delegate=overrides=>new Proxy(fs,{get(target,key){return Object.hasOwn(overrides,key)?overrides[key]:target[key];}});

test('legacy and current libraries retain valid settings, shelves and all four download types',async t=>{
  const w=fixture(t),videoId='abcdefghijk',infoHash='a'.repeat(40),magnet='magnet:?xt=urn:btih:'+infoHash;
  const favorite={id:'one',url:'https://fitgirl-repacks.site/game/',title:'Example',image:'https://images.example.com/cover.jpg',genres:['RPG'],steamAppId:123};
  const settings={downloadDir:path.join(w.root,'Chosen downloads'),concurrency:3,connectionsPerFile:2,favorites:[favorite],collections:[{id:'my-shelf',name:'My shelf',games:[favorite]}],gameFolders:[path.join(w.root,'Installed games')],language:'ar',digits:'arab',youtubeQuality:'1080',torrents:{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:15},maxDownloadBytesPerSecond:3145728,downloadSchedule:{enabled:true,start:'23:00',end:'05:00',days:[1,3,5]},notificationsEnabled:false,customFuturePreference:{keep:true}};
  // The actual quality identifiers are part of the format, not display labels.
  settings.youtubeQuality=Object.keys(require('../src/youtube.cjs').QUALITIES)[0];
  const downloads=[job(w.folder),job(w.folder,{id:'media',kind:'media',url:canonicalUrl(videoId),sourceUrl:canonicalUrl(videoId),name:'video.mp4',media:{videoId,quality:settings.youtubeQuality},origin:'browser'}),job(w.folder,{id:'mod',origin:'browser',url:'https://files.nexus-cdn.com/mod.zip?token=active',sourceUrl:'https://files.nexus-cdn.com/mod.zip?token=active',mod:{site:'nexusmods',game:'skyrimspecialedition',modId:123}}),job(w.folder,{id:'torrent',kind:'torrent',url:magnet,sourceUrl:magnet,name:'Example',torrent:{infoHash,name:'Example',files:[{index:1,path:'Example/data.bin',length:6,selected:true,padding:false}],peers:0,uploaded:0,uploadSpeed:0}})];
  for(const schema of [undefined,SCHEMA_VERSION]){
    const original={settings,downloads,...(schema?{schemaVersion:schema}:{})};save(w.file,original);
    const result=loadLibrary(w.file);assert.equal(result.warning,'');assert.equal(result.canSave,true);assert.deepEqual(result.data,{settings,downloads});
  }
  const manager=w.open();assert.equal(manager.stateRecoveryWarning,'');assert.equal(manager.downloads.length,4);await manager.stop();
  const persisted=JSON.parse(fs.readFileSync(w.file,'utf8'));assert.equal(persisted.schemaVersion,SCHEMA_VERSION);assert.deepEqual(persisted.settings.favorites,settings.favorites);assert.deepEqual(persisted.settings.collections,settings.collections);assert.equal(persisted.downloads[0].url,downloads[0].url);
  assert.equal(fs.readdirSync(w.root).filter(name=>name.includes('.recovery-')).length,0);
});

test('malformed roots and JSON preserve original bytes before saving a repaired library',async t=>{
  const w=fixture(t);
  for(const text of ['null','[]','42','"text"','{"settings":','{"schemaVersion":"bad","downloads":[]}']){
    fs.writeFileSync(w.file,text);const recovered=loadLibrary(w.file);
    assert.equal(recovered.warning,RECOVERED);assert.equal(recovered.canSave,true);assert.equal(fs.readFileSync(w.file,'utf8'),text);assert.equal(fs.readFileSync(recovered.recoveryFile,'utf8'),text);
  }
  fs.writeFileSync(w.file,'null');const manager=w.open();assert.equal(manager.state().stateRecoveryWarning,RECOVERED);await manager.stop();assert.equal(JSON.parse(fs.readFileSync(w.file,'utf8')).schemaVersion,1);
});

test('bad entries are quarantined while good partial paths and settings survive',async t=>{
  const w=fixture(t);fs.mkdirSync(w.folder,{recursive:true});const partial=path.join(w.folder,'file.rar.atlas-part');fs.writeFileSync(partial,'abc');
  const bad=[null,[],42,job(w.folder,{id:'bad-status',status:{}}),job(w.folder,{id:'bad-folder',folder:'relative'}),job(w.folder,{id:'traversal',folder:w.folder+path.sep+'..'+path.sep+'elsewhere'}),job(w.folder,{id:'bad-url',url:'http://127.0.0.1/private'}),job(w.folder,{id:'bad-size',received:'three'}),job(w.folder,{id:'bad-name',name:'NUL .rar'}),job(w.folder,{id:'bad-superscript',name:'COM¹.zip'}),job(w.folder,{id:'job'})];
  const original={settings:{downloadDir:path.dirname(w.folder),favorites:[],connectionsPerFile:4,language:'ar',concurrency:{broken:true}},downloads:[job(w.folder,{status:'downloading'}),...bad]};save(w.file,original);
  const manager=w.open();assert.equal(manager.stateRecoveryWarning,RECOVERED);assert.equal(manager.downloads.length,1);assert.equal(manager.downloads[0].folder,w.folder);assert.equal(manager.downloads[0].status,'paused');assert.equal(manager.settings.language,'ar');assert.equal(manager.settings.concurrency,2);
  await manager.stop();assert.equal(fs.readFileSync(partial,'utf8'),'abc');const backups=fs.readdirSync(w.root).filter(name=>name.includes('.recovery-'));assert.equal(backups.length,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.root,backups[0]),'utf8')),original);
});

test('unrecognized future schemas never overwrite or start their saved queue',async t=>{
  const w=fixture(t),original={schemaVersion:99,settings:{language:'ar'},downloads:[job(w.folder,{status:'queued'})]};save(w.file,original);
  const manager=w.open();assert.equal(manager.stateCanSave,false);assert.equal(manager.state().stateRecoveryWarning,FUTURE);manager.updateSettings({concurrency:1});await manager.stop();assert.deepEqual(JSON.parse(fs.readFileSync(w.file,'utf8')),original);assert.equal(fs.readdirSync(w.root).length,1);
});

test('bad settings cannot crash startup or mutate prototypes; valid preferences are retained',t=>{
  const w=fixture(t),raw=JSON.parse('{"settings":{"__proto__":{"polluted":true},"favorites":{},"collections":[null],"downloadSchedule":[],"gameFolders":[null],"notificationsEnabled":"false","language":"ar"},"downloads":[null]}');
  const result=validateLibrary(raw);assert.equal(result.changed,true);assert.deepEqual(result.data.settings,{collections:[],gameFolders:[],language:'ar'});assert.equal({}.polluted,undefined);
  assert.equal(downloadFrom(job(w.folder,{kind:'media',media:{videoId:12345678901,quality:'best'}})),null);
  assert.equal(downloadFrom(job(w.folder,{kind:'torrent',torrent:{}})),null);
  assert.equal(downloadFrom(job(w.folder,{etag:{broken:true},scan:{status:'clean',message:{broken:true}}})).etag,undefined);
});

test('state reads are bounded and retain a single descriptor across short reads',t=>{
  const w=fixture(t),bytes=Buffer.from(JSON.stringify({settings:{language:'ar'},downloads:[]}));fs.writeFileSync(w.file,bytes);
  let opens=0,closes=0,reads=0;const io=delegate({openSync(...args){opens++;return fs.openSync(...args);},closeSync(fd){closes++;return fs.closeSync(fd);},readSync(fd,buffer,offset,length,position){reads++;return fs.readSync(fd,buffer,offset,Math.min(3,length),position);}});
  assert.deepEqual(readStateFile(w.file,io),bytes);assert.equal(opens,1);assert.equal(closes,1);assert.ok(reads>1);
  fs.truncateSync(w.file,MAX_BYTES+1);reads=0;assert.equal(loadLibrary(w.file,{io}).canSave,false);assert.equal(reads,0);assert.equal(fs.statSync(w.file).size,MAX_BYTES+1);
});

test('state validates the opened descriptor before any pathname check or content read',t=>{
  const w=fixture(t),bytes=Buffer.from('{"downloads":[]}');fs.writeFileSync(w.file,bytes);const calls=[];
  const io=delegate({openSync(...args){calls.push('open');return fs.openSync(...args);},fstatSync(...args){calls.push('fstat');return fs.fstatSync(...args);},lstatSync(...args){calls.push('lstat');return fs.lstatSync(...args);},readSync(...args){calls.push('read');return fs.readSync(...args);}});
  assert.deepEqual(readStateFile(w.file,io),bytes);assert.deepEqual(calls.slice(0,2),['open','fstat']);assert.ok(calls.indexOf('lstat')<calls.indexOf('read'));
});

test('unsafe opened descriptors are closed without reading or trusting their pathname',t=>{
  const w=fixture(t);save(w.file,{downloads:[]});
  for(const override of [{isFile:()=>false},{isSymbolicLink:()=>true},{nlink:2n},{size:BigInt(MAX_BYTES)+1n},{size:-1n},{ino:0n}]){
    let reads=0,closes=0,paths=0;
    const io=delegate({fstatSync(...args){const stat=fs.fstatSync(...args);return new Proxy(stat,{get(target,key){if(Object.hasOwn(override,key))return override[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});},readSync(...args){reads++;return fs.readSync(...args);},closeSync(...args){closes++;return fs.closeSync(...args);},lstatSync(...args){paths++;return fs.lstatSync(...args);}});
    assert.throws(()=>readStateFile(w.file,io),/Unsafe library file/);assert.equal(reads,0);assert.equal(closes,1);assert.equal(paths,0);
  }
});

test('a pathname replaced after opening cannot substitute content or become a new profile',t=>{
  const w=fixture(t),original=Buffer.from('{"downloads":[]}'),replacement=Buffer.from('{"settings":{"language":"ar"}}'),held=path.join(w.root,'opened.json'),substitute=path.join(w.root,'replacement.json');fs.writeFileSync(w.file,original);
  // Prepare a separate inode, then simulate a foreign process swapping the
  // pathname. Never write through the name the reader has already opened.
  fs.writeFileSync(substitute,replacement,{flag:'wx'});
  let reads=0,closes=0;
  const io=delegate({openSync(file,...args){const fd=fs.openSync(file,...args);fs.renameSync(file,held);fs.renameSync(substitute,file);return fd;},readSync(...args){reads++;return fs.readSync(...args);},closeSync(...args){closes++;return fs.closeSync(...args);}});
  const result=loadLibrary(w.file,{io});assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(reads,0);assert.equal(closes,1);assert.deepEqual(fs.readFileSync(w.file),replacement);assert.deepEqual(fs.readFileSync(held),original);
  fs.unlinkSync(w.file);fs.renameSync(held,w.file);
  const vanished=delegate({openSync(file,...args){const fd=fs.openSync(file,...args);fs.renameSync(file,held);return fd;}});
  assert.equal(loadLibrary(w.file,{io:vanished}).canSave,false,'a missing pathname after a successful open is not a new profile');
});

test('a profile reached through a junction loads from its real folder; final-path links are rejected before reading',t=>{
  const w=fixture(t);save(w.file,{settings:{language:'ar'},downloads:[job(w.folder)]});const linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');
  let reads=0;const io=delegate({readSync(...args){reads++;return fs.readSync(...args);}});
  // AppData moved to another drive with a junction: the library opens as usual.
  const through=loadLibrary(path.join(linked,'library.json'),{io});assert.equal(through.canSave,true);assert.equal(through.warning,'');assert.equal(through.data.settings.language,'ar');assert.equal(through.data.downloads.length,1);assert.ok(reads>0);fs.unlinkSync(linked);reads=0;
  // Model Windows, where openSync has no O_NOFOLLOW flag and can return a
  // regular target handle. lstat must still reject a final-path reparse link.
  const finalLink=delegate({readSync(...args){reads++;return fs.readSync(...args);},lstatSync(file,...args){const stat=fs.lstatSync(file,...args);if(file!==w.file)return stat;return new Proxy(stat,{get(target,key){if(key==='isSymbolicLink')return ()=>true;const value=target[key];return typeof value==='function'?value.bind(target):value;}});}});
  assert.equal(loadLibrary(w.file,{io:finalLink}).canSave,false);assert.equal(reads,0);
});

test('hard-linked state, junction parents, raced content and failed backups remain untouched',t=>{
  const w=fixture(t),other=path.join(w.root,'original.json');save(other,{downloads:[]});fs.linkSync(other,w.file);const hard=loadLibrary(w.file);assert.equal(hard.warning,BLOCKED);assert.equal(hard.canSave,false);fs.unlinkSync(w.file);
  const linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');assert.equal(loadLibrary(path.join(linked,'original.json')).canSave,true);fs.unlinkSync(linked);
  save(w.file,{downloads:[]});let changed=false;const racing=delegate({readSync(...args){const count=fs.readSync(...args);if(!changed){changed=true;fs.appendFileSync(w.file,' ');}return count;}});assert.equal(loadLibrary(w.file,{io:racing}).canSave,false);
  fs.writeFileSync(w.file,'null');const denied=delegate({openSync(file,...args){if(String(file).includes('.recovery-'))throw new Error('Access refused');return fs.openSync(file,...args);}});assert.equal(loadLibrary(w.file,{io:denied}).canSave,false);assert.equal(fs.readFileSync(w.file,'utf8'),'null');
});

test('recovery rejects a changed parent and leaves the original unchanged',t=>{
  const w=fixture(t);fs.writeFileSync(w.file,'null');let opened=false;
  const io=delegate({lstatSync(file,options){const stat=fs.lstatSync(file,options);if(file===w.root&&opened)return new Proxy(stat,{get(target,key){if(key==='ino')return target.ino+1n;const value=target[key];return typeof value==='function'?value.bind(target):value;}});return stat;},openSync(file,...args){if(String(file).includes('.recovery-'))opened=true;return fs.openSync(file,...args);}});
  const result=loadLibrary(w.file,{io});assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(fs.readFileSync(w.file,'utf8'),'null');
});

test('a new profile below a junction or an ordinary new nested profile is permitted without creating folders',t=>{
  const w=fixture(t),linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');
  const result=loadLibrary(path.join(linked,'new','library.json'));assert.equal(result.canSave,true);assert.equal(result.warning,'');assert.equal(fs.existsSync(path.join(w.root,'new')),false);
  fs.unlinkSync(linked);const ordinary=loadLibrary(path.join(w.root,'new','profile','library.json'));assert.equal(ordinary.canSave,true);assert.equal(ordinary.warning,'');
});

test('previously selected network download paths survive without widening local game-folder rules',()=>{
  const share='\\\\fixture-nas\\Games\\Downloads';
  const data={settings:{downloadDir:share,gameFolders:[share]},downloads:[job(share)]};
  const result=validateLibrary(data);assert.equal(result.data.settings.downloadDir,share);assert.deepEqual(result.data.settings.gameFolders,[]);assert.equal(result.data.downloads[0].folder,share);
  for(const folder of ['\\\\?\\C:\\Downloads','\\\\.\\pipe\\Anything','\\\\fixture-nas\\..\\Downloads','\\\\fixture-nas\\Games\\..\\Private'])assert.equal(downloadFrom(job(folder)),null,folder);
});

test('browser context tokens are minimized but active signed targets and secure cookies survive',async t=>{
  const w=fixture(t),sealed=new Map();let counter=0;const vault={seal(headers){const token='sealed-'+(++counter);sealed.set(token,structuredClone(headers));return token;},open(token){return sealed.get(token);}};
  save(w.file,{downloads:[job(w.folder,{origin:'browser',headers:{Cookie:'session=fixture',referer:'https://portal.example.com/account/private?token=page-secret#hidden','HX-Current-URL':'https://portal.example.com/account/private?token=page-secret#hidden'}}),job(w.folder,{id:'provider',origin:'browser',sourceUrl:'https://fuckingfast.co/abc',headers:{Referer:'https://fuckingfast.co/abc?token=page-secret#hidden','HX-Current-URL':'https://fuckingfast.co/abc?token=page-secret#hidden'}}),job(w.folder,{id:'finished',origin:'browser',status:'completed',sourceUrl:'https://portal.example.com/start?token=completed-secret',url:'https://files.example.com/result?token=completed-secret',headers:{Cookie:'old-secret'}})]});
  const manager=w.open({vault});assert.equal(manager.downloads[0].headers.Referer,'https://portal.example.com/');assert.equal(manager.downloads[0].headers.Cookie,'session=fixture');assert.match(manager.downloads[0].url,/signature=active-test/);assert.equal(manager.downloads[1].headers.Referer,'https://fuckingfast.co/abc');assert.equal(manager.downloads[2].url,'https://files.example.com/result');assert.deepEqual(manager.downloads[2].headers,{});
  await manager.stop();const saved=fs.readFileSync(w.file,'utf8');assert.doesNotMatch(saved,/page-secret|completed-secret|old-secret|session=fixture/);assert.match(saved,/signature=active-test/);
  assert.equal(manager.downloads[0].headers['HX-Current-URL'],'https://portal.example.com/');assert.equal(manager.downloads[1].headers['HX-Current-URL'],'https://fuckingfast.co/abc');
});

test('finished browser link hashes preserve exact deduplication after restart without keeping query tokens',async t=>{
  const w=fixture(t),url='https://files.example.com/data?token=finished-secret',source='https://portal.example.com/get?id=one';
  const entry={status:'ready',origin:'browser',filename:'data.zip',url,sourceUrl:source};
  const manager=w.open({fetcher:async()=>new Response('abc',{headers:{'content-type':'application/octet-stream','content-length':'3'}})});
  manager.add({links:[entry],gameTitle:'Browser'});const deadline=Date.now()+3000;while(manager.running.size){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(manager.downloads[0].status,'completed');assert.equal(manager.add({links:[entry],gameTitle:'Browser'}).added,0);await manager.stop();
  const saved=fs.readFileSync(w.file,'utf8');assert.doesNotMatch(saved,/finished-secret|get\?id=one/);assert.match(JSON.parse(saved).downloads[0].sourceIdentity,/^[a-f0-9]{64}$/);
  const reopened=w.open();reopened.stopping=true;assert.equal(reopened.add({links:[entry],gameTitle:'Browser'}).added,0);
  assert.equal(reopened.add({links:[{...entry,sourceUrl:'https://portal.example.com/get?id=two'}],gameTitle:'Browser'}).added,1,'a different query can identify a different file');
});

test('a saved partial still resumes with its exact signed target after validation',async t=>{
  const w=fixture(t);fs.mkdirSync(w.folder,{recursive:true});fs.writeFileSync(path.join(w.folder,'file.rar.atlas-part'),'abc');save(w.file,{settings:{connectionsPerFile:1},downloads:[job(w.folder)]});
  const requests=[];const manager=w.open({fetcher:async(url,{headers})=>{requests.push({url,headers});return new Response('def',{status:206,headers:{'content-type':'application/octet-stream','content-length':'3','content-range':'bytes 3-5/6',etag:'"one"'}});}});
  manager.action('job','resume');const deadline=Date.now()+3000;while(manager.running.size){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(manager.downloads[0].status,'completed');assert.equal(fs.readFileSync(path.join(w.folder,'file.rar'),'utf8'),'abcdef');assert.equal(requests[0].url,'https://files.example.com/file?signature=active-test');assert.equal(requests[0].headers.Range,'bytes=3-');assert.equal(requests[0].headers['If-Range'],'"one"');
});

// 0.10.2

test('a library held for a moment by another program is read after a short wait; one held for long is left untouched',t=>{
  const w=fixture(t);save(w.file,{settings:{language:'ar'},downloads:[job(w.folder)]});let busy=2,waits=0;
  const io=delegate({openSync(file,...args){if(path.basename(String(file))==='library.json'&&busy>0){busy--;throw Object.assign(new Error('busy'),{code:'EBUSY'});}return fs.openSync(file,...args);}});
  const wait=()=>{waits++;};
  const result=loadLibrary(w.file,{io,wait});assert.equal(result.canSave,true);assert.equal(result.warning,'');assert.equal(result.data.settings.language,'ar');assert.equal(waits,2);
  busy=Infinity;waits=0;const held=loadLibrary(w.file,{io,wait});assert.equal(held.canSave,false);assert.equal(held.warning,BLOCKED);assert.equal(waits,4,'a few short waits, then the library is left alone');
  const refused=delegate({openSync(file,...args){if(path.basename(String(file))==='library.json')throw Object.assign(new Error('refused'),{code:'EISDIR'});return fs.openSync(file,...args);}});
  waits=0;assert.equal(loadLibrary(w.file,{io:refused,wait}).warning,BLOCKED);assert.equal(waits,0,'other errors are not waited on');
  assert.equal(fs.readdirSync(w.root).filter(name=>name.includes('.recovery-')).length,0);
});

test('a very long download list keeps every unfinished download and the newest finished ones, and its settings',()=>{
  const folder=path.resolve(base,'long','Game'),total=MAX_DOWNLOADS+5,downloads=[];
  for(let i=0;i<total;i++)downloads.push(job(folder,{id:'job-'+i,status:i===4?'paused':i<3?'error':i%2?'completed':'cancelled'}));
  const result=validateLibrary({settings:{language:'ar'},downloads});
  assert.equal(result.changed,true);assert.equal(result.data.downloads.length,MAX_DOWNLOADS);assert.equal(result.data.settings.language,'ar');
  const kept=new Set(result.data.downloads.map(d=>d.id));
  for(const id of ['job-0','job-1','job-2','job-4','job-'+(total-1)])assert.ok(kept.has(id),id);
  for(const id of ['job-3','job-5','job-6','job-7','job-8'])assert.equal(kept.has(id),false,id);
  assert.deepEqual(result.data.downloads.slice(0,3).map(d=>d.id),['job-0','job-1','job-2'],'the order is kept');
  const busy=Array.from({length:total},(_,i)=>job(folder,{id:'busy-'+i,status:'paused'}));
  const all=validateLibrary({downloads:busy});assert.equal(all.data.downloads.length,MAX_DOWNLOADS);assert.equal(all.data.downloads[0].id,'busy-5','only when every entry is unfinished do the oldest go');
});

test('the same damage is copied once, and only the oldest and newest recovery copies are kept',t=>{
  const w=fixture(t),copies=()=>fs.readdirSync(w.root).filter(name=>name.startsWith('library.json.recovery-')).sort();
  const past=Math.floor(Date.now()/1000)-1000;
  fs.writeFileSync(w.file,'{"downloads":[null]}');
  const first=loadLibrary(w.file),second=loadLibrary(w.file);
  assert.equal(first.warning,RECOVERED);assert.equal(second.warning,RECOVERED);assert.equal(second.recoveryFile,first.recoveryFile,'the same bytes reuse their copy');
  assert.deepEqual(copies(),[path.basename(first.recoveryFile)]);assert.equal(fs.readFileSync(first.recoveryFile,'utf8'),'{"downloads":[null]}');
  fs.utimesSync(first.recoveryFile,past-1,past-1);
  const made=[];
  for(let i=0;i<8;i++){fs.writeFileSync(w.file,`{"downloads":[null],"n":${i}}`);const result=loadLibrary(w.file);assert.equal(result.canSave,true);made.push(result.recoveryFile);fs.utimesSync(result.recoveryFile,past+i,past+i);}
  assert.equal(copies().length,MAX_RECOVERY_COPIES);
  // The oldest copy (the list before anything went wrong) and the newest ones stay.
  assert.ok(fs.existsSync(first.recoveryFile),'the oldest copy is kept');
  for(const kept of made.slice(-(MAX_RECOVERY_COPIES-1)))assert.ok(fs.existsSync(kept));
  for(const gone of made.slice(0,made.length-(MAX_RECOVERY_COPIES-1)))assert.equal(fs.existsSync(gone),false);
  // Only Ravenshelf's own copies are ever removed.
  const other=path.join(w.root,'library.json.recovery-notes.json'),linked=path.join(w.root,'library.json.recovery-'+'f'.repeat(32)+'.json');
  fs.writeFileSync(other,'keep');fs.symlinkSync(other,linked);fs.utimesSync(other,past-50,past-50);fs.lutimesSync(linked,past-60,past-60);
  for(let i=8;i<11;i++){fs.writeFileSync(w.file,`{"downloads":[null],"n":${i}}`);loadLibrary(w.file);}
  assert.equal(fs.readFileSync(other,'utf8'),'keep');assert.ok(fs.lstatSync(linked).isSymbolicLink());
});

test('a copy with the same name but other content is never reused or replaced',t=>{
  const w=fixture(t);fs.writeFileSync(w.file,'{"downloads":[null]}');
  const first=loadLibrary(w.file);fs.writeFileSync(first.recoveryFile,'tampered');
  const second=loadLibrary(w.file);assert.equal(second.warning,RECOVERED);assert.notEqual(second.recoveryFile,first.recoveryFile);
  assert.equal(fs.readFileSync(first.recoveryFile,'utf8'),'tampered');assert.equal(fs.readFileSync(second.recoveryFile,'utf8'),'{"downloads":[null]}');
});

test('a repaired library is saved at once, so the next start shows no warning and makes no new copy',async t=>{
  const w=fixture(t),good={url:'https://fitgirl-repacks.site/a/',title:'A'};
  save(w.file,{settings:{language:'ar',favorites:[good,{url:'not a link',title:'B'}]},downloads:[job(w.folder),null]});
  const manager=w.open();assert.equal(manager.stateRecoveryWarning,RECOVERED);assert.equal(manager.stateCanSave,true);
  const saved=JSON.parse(fs.readFileSync(w.file,'utf8'));assert.equal(saved.schemaVersion,SCHEMA_VERSION);assert.deepEqual(saved.settings.favorites,[good]);assert.equal(saved.downloads.length,1);
  await manager.stop();
  const again=w.open();assert.equal(again.stateRecoveryWarning,'');assert.deepEqual(again.settings.favorites,[good]);
  assert.equal(fs.readdirSync(w.root).filter(name=>name.includes('.recovery-')).length,1);
});

test('one damaged favourite, shelf or game drops only that item',()=>{
  const good={url:'https://fitgirl-repacks.site/a/',title:'A'},bad={url:'javascript:alert(1)',title:'B'};
  const {settings,changed}=settingsFrom({favorites:[good,bad,null],collections:[{id:'one',name:'Shelf',games:[good,bad]},{id:'two',name:'x'.repeat(81),games:[]},null],gameFolders:[path.resolve(base,'Games'),'\\\\nas\\Games\\Library','relative']});
  assert.equal(changed,true);assert.deepEqual(settings.favorites,[good]);assert.deepEqual(settings.collections,[{id:'one',name:'Shelf',games:[good]}]);assert.deepEqual(settings.gameFolders,[path.resolve(base,'Games')]);
  const clean=settingsFrom({favorites:[good],collections:[{id:'one',name:'Shelf',games:[good]}]});assert.equal(clean.changed,false,'valid lists are unchanged');
});

test('network download folders from Windows folder pickers are kept, including WSL and WebDAV shares',()=>{
  for(const share of ['\\\\wsl$\\Ubuntu\\home\\games','\\\\nas.example@SSL@443\\DavWWWRoot\\Games','\\\\fixture-nas\\Games'])assert.equal(settingsFrom({downloadDir:share}).settings.downloadDir,share,share);
  for(const share of ['\\\\?\\C:\\Downloads','\\\\.\\pipe\\x','\\\\$bad\\Games','\\\\nas\\..\\x'])assert.equal(settingsFrom({downloadDir:share}).settings.downloadDir,undefined,share);
});

test('a read-only list refuses new downloads with a message the window may show',async t=>{
  const w=fixture(t);save(w.file,{schemaVersion:SCHEMA_VERSION+1,downloads:[]});
  const manager=w.open();assert.equal(manager.stateCanSave,false);
  assert.throws(()=>manager.add({links:[{status:'ready',url:'https://files.example.com/a.zip',filename:'a.zip'}],gameTitle:'Game'}),{message:READ_ONLY});
  assert.throws(()=>manager.addMedia({videoId:'abcdefghijk',quality:Object.keys(require('../src/youtube.cjs').QUALITIES)[0]}),{message:READ_ONLY});
  assert.throws(()=>manager.addTorrent({infoHash:'a'.repeat(40),magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40),name:'Game',files:[{index:1,path:'Game',length:1,selected:true}],gameTitle:'Game'}),{message:READ_ONLY});
  assert.equal(manager.downloads.length,0);assert.equal(publicErrorMessage(new Error(READ_ONLY)),READ_ONLY);
});

test('a reused copy is kept even when newer copies would push it out',t=>{
  const w=fixture(t),past=Math.floor(Date.now()/1000)-1000,copies=()=>fs.readdirSync(w.root).filter(name=>name.startsWith('library.json.recovery-'));
  fs.writeFileSync(w.file,'{"downloads":[null],"n":"reused"}');const reused=loadLibrary(w.file).recoveryFile;fs.utimesSync(reused,past+1,past+1);
  fs.writeFileSync(w.file,'{"downloads":[null],"n":"oldest"}');const oldest=loadLibrary(w.file).recoveryFile;fs.utimesSync(oldest,past,past);
  for(let i=0;i<MAX_RECOVERY_COPIES;i++){fs.writeFileSync(w.file,`{"downloads":[null],"n":${i}}`);fs.utimesSync(loadLibrary(w.file).recoveryFile,past+10+i,past+10+i);}
  fs.writeFileSync(w.file,'{"downloads":[null],"n":"reused"}');const again=loadLibrary(w.file);
  assert.equal(again.recoveryFile,reused);assert.ok(fs.existsSync(reused),'the copy just reused is never removed');assert.ok(fs.existsSync(oldest));assert.equal(copies().length,MAX_RECOVERY_COPIES);
});

test('through a junction, copies and saves go to the real folder that was checked',async t=>{
  const w=fixture(t),real=path.join(w.root,'real'),linked=path.join(w.root,'linked');fs.mkdirSync(real);fs.symlinkSync(real,linked,process.platform==='win32'?'junction':'dir');
  const realFile=path.join(real,'library.json');fs.writeFileSync(realFile,JSON.stringify({settings:{language:'ar'},downloads:[job(w.folder),null]}));
  const loaded=loadLibrary(path.join(linked,'library.json'));
  assert.equal(loaded.warning,RECOVERED);assert.equal(loaded.file,fs.realpathSync(realFile));assert.equal(path.dirname(loaded.recoveryFile),fs.realpathSync(real));
  const manager=new DownloadManager({stateFile:path.join(linked,'library.json'),downloadDir:path.join(w.root,'Downloads'),fetcher:async()=>{throw new Error('Unexpected request');}});
  assert.equal(manager.stateFile,fs.realpathSync(realFile));await manager.stop();
  assert.equal(JSON.parse(fs.readFileSync(realFile,'utf8')).downloads.length,1);
  // A drive or folder that refuses Windows' own path lookup falls back to Node's.
  const refusing=delegate({realpathSync:Object.assign((...args)=>fs.realpathSync(...args),{native(){throw Object.assign(new Error('unsupported'),{code:'EINVAL'});}})});
  assert.equal(loadLibrary(path.join(linked,'library.json'),{io:refusing}).file,fs.realpathSync(realFile));
});

test('a locked list is retried for every Windows lock error, and a hard-linked list blocks adding too',t=>{
  for(const code of ['EPERM','EACCES']){
    const w=fixture(t);save(w.file,{downloads:[]});let busy=1,waits=0;
    const io=delegate({openSync(file,...args){if(path.basename(String(file))==='library.json'&&busy-->0)throw Object.assign(new Error('locked'),{code});return fs.openSync(file,...args);}});
    assert.equal(loadLibrary(w.file,{io,wait:()=>{waits++;}}).canSave,true,code);assert.equal(waits,1,code);
  }
  const w=fixture(t),other=path.join(w.root,'original.json');save(other,{downloads:[]});fs.linkSync(other,w.file);
  const manager=w.open();assert.equal(manager.stateRecoveryWarning,BLOCKED);
  assert.throws(()=>manager.add({links:[{status:'ready',url:'https://files.example.com/a.zip',filename:'a.zip'}],gameTitle:'Game'}),{message:READ_ONLY});
});

test('a full list refuses new downloads instead of growing past what Ravenshelf keeps',async t=>{
  const w=fixture(t),manager=w.open();
  for(let i=0;i<MAX_DOWNLOADS;i++)manager.downloads.push({id:'x'+i,status:'completed',name:'x'+i+'.bin',folder:w.folder,url:'https://files.example.com/x'+i});
  assert.throws(()=>manager.add({links:[{status:'ready',url:'https://files.example.com/a.zip',filename:'a.zip'}],gameTitle:'Game'}),{message:LIST_FULL});
  assert.throws(()=>manager.addMedia({videoId:'abcdefghijk',quality:Object.keys(require('../src/youtube.cjs').QUALITIES)[0]}),{message:LIST_FULL});
  assert.equal(manager.downloads.length,MAX_DOWNLOADS);assert.equal(publicErrorMessage(new Error(LIST_FULL)),LIST_FULL);
  manager.downloads.length=MAX_DOWNLOADS-1;manager.stopping=true;
  assert.doesNotThrow(()=>manager.assertWritable(1));assert.throws(()=>manager.assertWritable(2),{message:LIST_FULL});
});

test('game folders are local folders that are not a whole drive',()=>{
  const local=process.platform==='win32'?'C:\\Games\\Library':path.resolve(base,'Games');
  assert.equal(gameFolder(local),true);
  for(const folder of ['C:\\','D:\\','D:/','C:','\\\\nas\\Games','\\\\?\\C:\\Games','relative\\Games','C:\\Games\\..\\x','C:\\Games\\.','C:\\Games\\ ',local+'\\Library.',(process.platform==='win32'?'C:\\':'/')+'x'.repeat(2050)])assert.equal(gameFolder(folder),false,folder.slice(0,40));
  const kept=settingsFrom({gameFolders:[local]});assert.equal(kept.changed,false,'valid folders cause no repair');assert.deepEqual(kept.settings.gameFolders,[local]);
  // A whole drive saved by an older version is kept (the scan skips it with a note), so it causes no repair either.
  if(process.platform==='win32'){const older=settingsFrom({gameFolders:[local,'D:\\']});assert.deepEqual(older.settings.gameFolders,[local,'D:\\']);assert.equal(older.changed,false);}
});

test('a link or hard link named like the copy of the same bytes is never taken as that copy',t=>{
  const crypto=require('node:crypto'),bytes='{"downloads":[null]}',name='library.json.recovery-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32)+'.json';
  for(const kind of ['symlink','hardlink']){
    const w=fixture(t),elsewhere=path.join(w.root,'elsewhere.json'),planted=path.join(w.root,name);
    fs.writeFileSync(elsewhere,bytes);kind==='symlink'?fs.symlinkSync(elsewhere,planted):fs.linkSync(elsewhere,planted);fs.writeFileSync(w.file,bytes);
    const result=loadLibrary(w.file);assert.equal(result.warning,RECOVERED,kind);assert.notEqual(path.basename(result.recoveryFile),name,kind);
    assert.equal(fs.readFileSync(result.recoveryFile,'utf8'),bytes,kind);
  }
});

test('at a full list, links already in it and videos already in it are no error',async t=>{
  const w=fixture(t),manager=w.open(),link={status:'ready',url:'https://files.example.com/a.zip',filename:'a.zip'};
  manager.stopping=true;manager.add({links:[link],gameTitle:'Game'});const quality=Object.keys(require('../src/youtube.cjs').QUALITIES)[0];manager.addMedia({videoId:'abcdefghijk',quality});
  for(let i=manager.downloads.length;i<MAX_DOWNLOADS;i++)manager.downloads.push({id:'x'+i,status:'completed',name:'x'+i+'.bin',folder:w.folder,url:'https://files.example.com/x'+i});
  assert.equal(manager.add({links:[link],gameTitle:'Game'}).added,0);assert.equal(manager.addMedia({videoId:'abcdefghijk',quality}).added,0);
  assert.throws(()=>manager.add({links:[link,{status:'ready',url:'https://files.example.com/b.zip',filename:'b.zip'}],gameTitle:'Game'}),{message:LIST_FULL});
  assert.equal(manager.downloads.length,MAX_DOWNLOADS);
});

test('an invalid label on a torrent or video entry keeps its link',()=>{
  const folder=path.resolve(base,'labels','Game'),infoHash='c'.repeat(40),magnet='magnet:?xt=urn:btih:'+infoHash,videoId='abcdefghijk',quality=Object.keys(require('../src/youtube.cjs').QUALITIES)[0];
  const torrent=downloadFrom(job(folder,{id:'t',kind:'torrent',status:'completed',url:magnet,sourceUrl:magnet,name:'Game',torrent:{infoHash,name:'Game',files:[{index:1,path:'Game',length:1,selected:true,padding:false}]},mod:{site:'elsewhere'}}));
  assert.equal(torrent.url,magnet);assert.equal(Object.hasOwn(torrent,'mod'),false);
  const video=downloadFrom(job(folder,{id:'v',kind:'media',status:'cancelled',url:canonicalUrl(videoId),sourceUrl:canonicalUrl(videoId),name:'video.mp4',media:{videoId,quality},mod:{site:'elsewhere'}}));
  assert.equal(video.url,canonicalUrl(videoId));assert.equal(Object.hasOwn(video,'mod'),false);
});
