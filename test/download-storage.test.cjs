'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {scanConfiguredArchives}=require('../src/download-storage.cjs');
const base=path.resolve(__dirname,'.storage-fixtures');fs.mkdirSync(base,{recursive:true});
function fixture(t){const root=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>{const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});});return root;}
function fakeStat(stat,changes){return new Proxy(stat,{get(target,key){if(key in changes)return changes[key];const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}

test('Storage inventory counts archives and partials only inside its configured folder',async t=>{
  const root=fixture(t),nested=path.join(root,'Game');fs.mkdirSync(nested);
  fs.writeFileSync(path.join(root,'other.rar'),'1234');fs.writeFileSync(path.join(nested,'other.part01.rar.atlas-part'),'123');fs.writeFileSync(path.join(root,'setup.exe'),'excluded');
  const result=await scanConfiguredArchives({root});assert.equal(result.untrackedBytes,7);assert.equal(result.scan.status,'complete');assert.equal(result.untrackedItems.length,2);
  assert.ok(result.untrackedItems.every(item=>item.deletable===false&&!('id' in item)&&!path.isAbsolute(item.relativePath)));
  assert.deepEqual(new Set(result.untrackedItems.map(item=>item.kind)),new Set(['completed','partial']));
});
test('Broad personal folders and drive roots are refused before filesystem enumeration',async()=>{
  for(const root of [os.homedir(),path.dirname(os.homedir()),path.join(os.homedir(),'Downloads'),path.parse(os.homedir()).root]){
    const result=await scanConfiguredArchives({root});assert.equal(result.scan.status,'unsupported');assert.equal(result.scan.entriesScanned,0);assert.equal(result.untrackedBytes,0);
  }
});
test('Links are never traversed and hardlinked archive bytes are deduplicated',async t=>{
  const root=fixture(t),outside=path.join(root,'outside'),configured=path.join(root,'configured');fs.mkdirSync(outside);fs.mkdirSync(configured);
  fs.writeFileSync(path.join(outside,'private.rar'),'must not count');fs.symlinkSync(outside,path.join(configured,'linked'),process.platform==='win32'?'junction':'dir');
  fs.writeFileSync(path.join(configured,'one.rar'),'12345');fs.linkSync(path.join(configured,'one.rar'),path.join(configured,'alias.rar'));
  const result=await scanConfiguredArchives({root:configured});assert.equal(result.untrackedBytes,5);assert.equal(result.scan.archivesFound,1);assert.equal(result.scan.status,'partial');assert.ok(result.scan.skippedEntries>0);
  const linkedRoot=await scanConfiguredArchives({root:path.join(configured,'linked')});assert.equal(linkedRoot.scan.status,'unavailable');assert.equal(linkedRoot.untrackedBytes,0);
});
test('Entry, result and depth bounds report partial coverage without recursive unrestricted traversal',async t=>{
  const root=fixture(t);for(let i=0;i<6;i++)fs.writeFileSync(path.join(root,`${i}.rar`),'12');
  const entries=await scanConfiguredArchives({root,limits:{maxEntries:3}});assert.equal(entries.scan.entriesScanned,3);assert.equal(entries.scan.status,'partial');assert.equal(entries.untrackedBytes,6);
  const results=await scanConfiguredArchives({root,limits:{maxResults:2}});assert.equal(results.untrackedItems.length,2);assert.equal(results.scan.archivesFound,6);assert.equal(results.untrackedBytes,12);assert.ok(results.warnings.length);
  const child=path.join(root,'child'),deep=path.join(child,'deep');fs.mkdirSync(child);fs.mkdirSync(deep);fs.writeFileSync(path.join(deep,'excluded.zip'),'excluded');
  const depth=await scanConfiguredArchives({root,limits:{maxDepth:1}});assert.equal(depth.scan.status,'partial');assert.equal(depth.untrackedBytes,12);
});
test('Unreadable archive metadata and oversized sizes produce explicit incomplete results',async t=>{
  const root=fixture(t);for(const name of ['good.rar','denied.rar','oversize.rar'])fs.writeFileSync(path.join(root,name),'123');
  const original=fs.promises.lstat;t.after(()=>{fs.promises.lstat=original;});
  fs.promises.lstat=async function(file,options){if(file===path.join(root,'denied.rar')){const error=new Error('private path deliberately omitted');error.code='EACCES';throw error;}const stat=await original.call(this,file,options);return file===path.join(root,'oversize.rar')?fakeStat(stat,{size:BigInt(Number.MAX_SAFE_INTEGER)+1n}):stat;};
  const result=await scanConfiguredArchives({root});assert.equal(result.untrackedBytes,3);assert.equal(result.scan.skippedEntries,2);assert.equal(result.scan.status,'partial');assert.ok(!JSON.stringify(result).includes(root));
});
test('Cancelled inventory closes its directory and performs no mutations',async t=>{
  const root=fixture(t),file=path.join(root,'keep.rar');fs.writeFileSync(file,'keep');const controller=new AbortController(),original=fs.promises.opendir;let closed=false;
  t.after(()=>{fs.promises.opendir=original;});
  fs.promises.opendir=async function(...args){const directory=await original.apply(this,args);return {read:async()=>{const entry=await directory.read();controller.abort();return entry;},close:async()=>{closed=true;await directory.close();}};};
  await assert.rejects(scanConfiguredArchives({root,signal:controller.signal}),{name:'AbortError'});assert.equal(closed,true);assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
test('An inventory root replaced during enumeration discards the stale snapshot',async t=>{
  const root=fixture(t),configured=path.join(root,'configured'),saved=path.join(root,'saved');fs.mkdirSync(configured);fs.writeFileSync(path.join(configured,'old.rar'),'old');
  const original=fs.promises.opendir;let changed=false;t.after(()=>{fs.promises.opendir=original;});
  fs.promises.opendir=async function(...args){const directory=await original.apply(this,args);return {read:async()=>{const entry=await directory.read();if(entry&&!changed){changed=true;fs.renameSync(configured,saved);fs.mkdirSync(configured);fs.writeFileSync(path.join(configured,'new.rar'),'new');}return entry;},close:()=>directory.close()};};
  const result=await scanConfiguredArchives({root:configured});assert.equal(result.scan.status,'unavailable');assert.equal(result.untrackedBytes,0);assert.deepEqual(result.untrackedItems,[]);assert.equal(fs.readFileSync(path.join(saved,'old.rar'),'utf8'),'old');
});
test('Elapsed scan budget stops further traversal and closes the current directory',async t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'one.rar'),'123');fs.writeFileSync(path.join(root,'two.rar'),'123');
  const original=fs.promises.opendir;let closed=false,reads=0;t.after(()=>{fs.promises.opendir=original;});
  fs.promises.opendir=async function(...args){const directory=await original.apply(this,args);return {read:async()=>{reads++;await new Promise(resolve=>setTimeout(resolve,15));return directory.read();},close:async()=>{closed=true;await directory.close();}};};
  const result=await scanConfiguredArchives({root,limits:{maxMs:10}});assert.equal(result.scan.status,'partial');assert.equal(result.scan.limitReached,true);assert.ok(reads<=1);if(reads)assert.equal(closed,true);
});
