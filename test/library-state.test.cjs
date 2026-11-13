'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadLibrary,validateLibrary,downloadFrom,readStateFile,SCHEMA_VERSION,MAX_BYTES,RECOVERED,BLOCKED,FUTURE}=require('../src/library-state.cjs');
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
  const result=validateLibrary(raw);assert.equal(result.changed,true);assert.deepEqual(result.data.settings,{language:'ar'});assert.equal({}.polluted,undefined);
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
  const w=fixture(t),original=Buffer.from('{"downloads":[]}'),replacement=Buffer.from('{"settings":{"language":"ar"}}'),held=path.join(w.root,'opened.json');fs.writeFileSync(w.file,original);
  let reads=0,closes=0;
  const io=delegate({openSync(file,...args){const fd=fs.openSync(file,...args);fs.renameSync(file,held);fs.writeFileSync(file,replacement);return fd;},readSync(...args){reads++;return fs.readSync(...args);},closeSync(...args){closes++;return fs.closeSync(...args);}});
  const result=loadLibrary(w.file,{io});assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(reads,0);assert.equal(closes,1);assert.deepEqual(fs.readFileSync(w.file),replacement);assert.deepEqual(fs.readFileSync(held),original);
  fs.unlinkSync(w.file);fs.renameSync(held,w.file);
  const vanished=delegate({openSync(file,...args){const fd=fs.openSync(file,...args);fs.renameSync(file,held);return fd;}});
  assert.equal(loadLibrary(w.file,{io:vanished}).canSave,false,'a missing pathname after a successful open is not a new profile');
});

test('junction parents and final-path links are rejected before reading from an opened handle',t=>{
  const w=fixture(t);save(w.file,{downloads:[]});const linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');
  let reads=0;const io=delegate({readSync(...args){reads++;return fs.readSync(...args);}});
  assert.equal(loadLibrary(path.join(linked,'library.json'),{io}).canSave,false);assert.equal(reads,0);fs.unlinkSync(linked);
  // Model Windows, where openSync has no O_NOFOLLOW flag and can return a
  // regular target handle. lstat must still reject a final-path reparse link.
  const finalLink=delegate({readSync(...args){reads++;return fs.readSync(...args);},lstatSync(file,...args){const stat=fs.lstatSync(file,...args);if(file!==w.file)return stat;return new Proxy(stat,{get(target,key){if(key==='isSymbolicLink')return ()=>true;const value=target[key];return typeof value==='function'?value.bind(target):value;}});}});
  assert.equal(loadLibrary(w.file,{io:finalLink}).canSave,false);assert.equal(reads,0);
});

test('hard-linked state, junction parents, raced content and failed backups remain untouched',t=>{
  const w=fixture(t),other=path.join(w.root,'original.json');save(other,{downloads:[]});fs.linkSync(other,w.file);const hard=loadLibrary(w.file);assert.equal(hard.warning,BLOCKED);assert.equal(hard.canSave,false);fs.unlinkSync(w.file);
  const linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');assert.equal(loadLibrary(path.join(linked,'original.json')).canSave,false);fs.unlinkSync(linked);
  save(w.file,{downloads:[]});let changed=false;const racing=delegate({readSync(...args){const count=fs.readSync(...args);if(!changed){changed=true;fs.appendFileSync(w.file,' ');}return count;}});assert.equal(loadLibrary(w.file,{io:racing}).canSave,false);
  fs.writeFileSync(w.file,'null');const denied=delegate({openSync(file,...args){if(String(file).includes('.recovery-'))throw new Error('Access refused');return fs.openSync(file,...args);}});assert.equal(loadLibrary(w.file,{io:denied}).canSave,false);assert.equal(fs.readFileSync(w.file,'utf8'),'null');
});

test('recovery rejects a changed parent and leaves the original unchanged',t=>{
  const w=fixture(t);fs.writeFileSync(w.file,'null');let opened=false;
  const io=delegate({lstatSync(file,options){const stat=fs.lstatSync(file,options);if(file===w.root&&opened)return new Proxy(stat,{get(target,key){if(key==='ino')return target.ino+1n;const value=target[key];return typeof value==='function'?value.bind(target):value;}});return stat;},openSync(file,...args){if(String(file).includes('.recovery-'))opened=true;return fs.openSync(file,...args);}});
  const result=loadLibrary(w.file,{io});assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(fs.readFileSync(w.file,'utf8'),'null');
});

test('a missing library below a junction is blocked, while an ordinary new nested profile is permitted',t=>{
  const w=fixture(t),linked=path.join(w.root,'linked');fs.symlinkSync(w.root,linked,process.platform==='win32'?'junction':'dir');
  const result=loadLibrary(path.join(linked,'new','library.json'));assert.equal(result.canSave,false);assert.equal(result.warning,BLOCKED);assert.equal(fs.existsSync(path.join(w.root,'new')),false);
  fs.unlinkSync(linked);const ordinary=loadLibrary(path.join(w.root,'new','profile','library.json'));assert.equal(ordinary.canSave,true);assert.equal(ordinary.warning,'');
});

test('previously selected network download paths survive without widening local game-folder rules',()=>{
  const share='\\\\fixture-nas\\Games\\Downloads';
  const data={settings:{downloadDir:share,gameFolders:[share]},downloads:[job(share)]};
  const result=validateLibrary(data);assert.equal(result.data.settings.downloadDir,share);assert.equal(result.data.settings.gameFolders,undefined);assert.equal(result.data.downloads[0].folder,share);
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
