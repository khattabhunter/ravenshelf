'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDownloadCleanup,TTL_MS,BROWSER_FOLDER}=require('../src/download-cleanup.cjs');
const {workspaceFor}=require('../src/parallel-download.cjs');
const base=path.resolve(__dirname,'.cleanup-fixtures');fs.mkdirSync(base,{recursive:true});
function within(root,target){const relative=path.relative(root,path.resolve(target));assert.ok(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));}
function fixture(t){const root=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>{within(base,root);assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});});const folder=path.join(root,'Game');fs.mkdirSync(folder);return {root,folder};}
function job(folder,overrides={}){return {id:'one',name:'archive.part01.rar',folder,status:'paused',...overrides};}

test('Cleanup deletes only confirmed tracked archive/partial/workspace files and preserves game folders',async t=>{
  const {folder}=fixture(t),download=job(folder),final=path.join(folder,download.name),partial=final+'.atlas-part',workspace=workspaceFor(partial,download.id);
  fs.writeFileSync(final,'archive');fs.writeFileSync(partial,'part');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'data.part'),'data');fs.writeFileSync(path.join(workspace,'state.json'),'{}');
  fs.writeFileSync(path.join(folder,'installed-game.exe'),'keep');fs.writeFileSync(path.join(folder,'untracked.rar'),'keep');
  const cleanup=createDownloadCleanup({getDownloads:()=>[download]}),preview=await cleanup.preview(['one']);
  assert.equal(preview.totalBytes,17);assert.deepEqual(preview.items,[{id:'one',name:download.name,bytes:17}]);assert.deepEqual(preview.warnings,[]);
  const result=await cleanup.deletePreview({ids:['one'],token:preview.token});assert.deepEqual(result,{removedIds:['one'],failed:[],bytesFreed:17});
  assert.equal(fs.existsSync(final),false);assert.equal(fs.existsSync(partial),false);assert.equal(fs.existsSync(workspace),false);
  assert.equal(fs.readFileSync(path.join(folder,'installed-game.exe'),'utf8'),'keep');assert.equal(fs.readFileSync(path.join(folder,'untracked.rar'),'utf8'),'keep');assert.ok(fs.statSync(folder).isDirectory());
  await assert.rejects(cleanup.deletePreview({ids:['one'],token:preview.token}),/expired or changed/);
});
test('Preview tokens expire and are bound to the selected download IDs',async t=>{
  const {folder}=fixture(t),downloads=[job(folder),job(folder,{id:'two',name:'other.zip'})];let now=1000;
  fs.writeFileSync(path.join(folder,downloads[0].name),'keep');const cleanup=createDownloadCleanup({getDownloads:()=>downloads,now:()=>now});
  const preview=await cleanup.preview(['one']);await assert.rejects(cleanup.deletePreview({ids:['two'],token:preview.token}),/expired or changed/);
  now+=TTL_MS;await assert.rejects(cleanup.deletePreview({ids:['one'],token:preview.token}),/expired or changed/);assert.equal(fs.readFileSync(path.join(folder,downloads[0].name),'utf8'),'keep');
});
test('Replacing, growing, or newly creating a target after preview refuses the whole item',async t=>{
  const {folder}=fixture(t);
  for(const mutation of ['replace','grow','new-partial']){
    const download=job(folder,{id:mutation,name:mutation+'.rar'}),file=path.join(folder,download.name);fs.writeFileSync(file,'original');
    const cleanup=createDownloadCleanup({getDownloads:()=>[download]}),preview=await cleanup.preview([download.id]);
    if(mutation==='replace'){const replacement=file+'.replacement';fs.writeFileSync(replacement,'replaced',{flag:'wx'});fs.renameSync(replacement,file);}
    else if(mutation==='grow')fs.appendFileSync(file,'changed');else fs.writeFileSync(file+'.atlas-part','new');
    const result=await cleanup.deletePreview({ids:[download.id],token:preview.token});assert.deepEqual(result.removedIds,[]);assert.equal(result.failed.length,1);assert.equal(result.bytesFreed,0);assert.ok(fs.existsSync(file));assert.ok(!result.failed[0].message.includes(folder));
  }
});
test('Replacing the ancestor directory after preview cannot redirect cleanup',async t=>{
  const {root,folder}=fixture(t),download=job(folder),file=path.join(folder,download.name);fs.writeFileSync(file,'original');
  const cleanup=createDownloadCleanup({getDownloads:()=>[download]}),preview=await cleanup.preview(['one']),saved=path.join(root,'original');
  within(root,folder);within(root,saved);fs.renameSync(folder,saved);fs.mkdirSync(folder);fs.writeFileSync(file,'new folder');
  const result=await cleanup.deletePreview({ids:['one'],token:preview.token});assert.equal(result.failed.length,1);assert.equal(fs.readFileSync(file,'utf8'),'new folder');assert.equal(fs.readFileSync(path.join(saved,download.name),'utf8'),'original');
});
test('Hardlinks are refused for deletion and storage summary deduplicates their inode',async t=>{
  const {folder}=fixture(t),a=job(folder,{name:'a.rar'}),b=job(folder,{id:'two',name:'b.rar'});fs.writeFileSync(path.join(folder,a.name),'shared');fs.linkSync(path.join(folder,a.name),path.join(folder,b.name));
  const cleanup=createDownloadCleanup({getDownloads:()=>[a,b]}),preview=await cleanup.preview(['one','two']);assert.equal(preview.items.length,0);assert.equal(preview.warnings.length,2);
  const summary=await cleanup.summary();assert.equal(summary.completedBytes,6);assert.equal(summary.totalBytes,6);
  const result=await cleanup.deletePreview({ids:['one','two'],token:preview.token});assert.equal(result.failed.length,2);assert.ok(fs.existsSync(path.join(folder,a.name)));assert.ok(fs.existsSync(path.join(folder,b.name)));
});
test('Unknown workspace files, junction ancestors, active jobs, and nonarchive names are never deleted',async t=>{
  const {root,folder}=fixture(t),a=job(folder),partial=path.join(folder,a.name+'.atlas-part'),workspace=workspaceFor(partial,a.id);
  fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'do-not-delete.txt'),'keep');fs.writeFileSync(path.join(folder,a.name),'keep');
  const alias=path.join(root,'linked');fs.symlinkSync(folder,alias,process.platform==='win32'?'junction':'dir');
  const downloads=[a,job(alias,{id:'link'}),job(folder,{id:'running',name:'active.rar',status:'downloading'}),job(folder,{id:'exe',name:'setup.exe'}),job(folder,{id:'traversal',name:'../escape.rar'})];
  const cleanup=createDownloadCleanup({getDownloads:()=>downloads}),ids=downloads.map(item=>item.id),preview=await cleanup.preview(ids);assert.equal(preview.items.length,0);
  const result=await cleanup.deletePreview({ids,token:preview.token});assert.equal(result.failed.length,ids.length);assert.equal(fs.readFileSync(path.join(workspace,'do-not-delete.txt'),'utf8'),'keep');
});
test('Browser downloads of any file type can be deleted, but only from Ravenshelf’s Browser downloads folder',async t=>{
  const {root,folder}=fixture(t),browser=path.join(root,BROWSER_FOLDER);fs.mkdirSync(browser);
  const program=job(browser,{id:'program',name:'7z2606-x64.exe',origin:'browser',status:'completed',scan:{status:'clean'}});
  const photo=job(browser,{id:'photo',name:'tigris-river.jpg',origin:'browser',status:'error'});
  const inGameFolder=job(folder,{id:'in-game-folder',name:'installer.exe',origin:'browser',status:'completed'});
  const notFromBrowser=job(browser,{id:'not-from-browser',name:'tool.exe',status:'completed'});
  fs.writeFileSync(path.join(browser,program.name),'program');fs.writeFileSync(path.join(browser,photo.name+'.atlas-part'),'jp');
  fs.writeFileSync(path.join(folder,inGameFolder.name),'keep');fs.writeFileSync(path.join(browser,notFromBrowser.name),'keep');fs.writeFileSync(path.join(browser,'untracked.pdf'),'keep');
  const downloads=[program,photo,inGameFolder,notFromBrowser],cleanup=createDownloadCleanup({getDownloads:()=>downloads,getDownloadDir:()=>root});
  const summary=await cleanup.summary();
  assert.equal(summary.completedBytes,7);assert.equal(summary.partialBytes,2);
  assert.deepEqual(summary.items.filter(item=>item.unavailable).map(item=>item.id),['in-game-folder','not-from-browser']);
  const ids=downloads.map(item=>item.id),preview=await cleanup.preview(ids);
  assert.deepEqual(preview.items.map(item=>item.id).sort(),['photo','program']);assert.equal(preview.totalBytes,9);assert.equal(preview.warnings.length,2);
  const result=await cleanup.deletePreview({ids,token:preview.token});
  assert.deepEqual(result.removedIds,['photo','program']);assert.equal(result.failed.length,2);assert.equal(result.bytesFreed,9);
  assert.equal(fs.existsSync(path.join(browser,program.name)),false);assert.equal(fs.existsSync(path.join(browser,photo.name+'.atlas-part')),false);
  for(const kept of [path.join(folder,inGameFolder.name),path.join(browser,notFromBrowser.name),path.join(browser,'untracked.pdf')])assert.equal(fs.readFileSync(kept,'utf8'),'keep');
});
test('Browser downloads are queued into the folder that cleanup recognises',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','browser-integration.cjs'),'utf8');
  assert.match(source,/gameTitle:BROWSER_FOLDER\b/);assert.equal(BROWSER_FOLDER,'Browser downloads');
});
test('Summary uses existing file sizes, deduplicates shared paths, and separates partial storage',async t=>{
  const {folder}=fixture(t),a=job(folder),b={...a,id:'two'};fs.writeFileSync(path.join(folder,a.name),'12345');fs.writeFileSync(path.join(folder,a.name+'.atlas-part'),'123');
  const cleanup=createDownloadCleanup({getDownloads:()=>[a,b]});const summary=await cleanup.summary();assert.equal(summary.completedBytes,5);assert.equal(summary.partialBytes,3);assert.equal(summary.totalBytes,8);
  const one=await cleanup.preview(['one']);assert.equal(one.items.length,0,'unselected duplicate row protects its files');
  const both=await cleanup.preview(['one','two']);assert.equal(both.totalBytes,8);const removed=await cleanup.deletePreview({ids:['one','two'],token:both.token});assert.deepEqual(removed.removedIds,['one','two']);assert.equal(removed.bytesFreed,8);
});
test('A changed queue path or restarted job invalidates its cleanup preview',async t=>{
  const {folder}=fixture(t),download=job(folder);fs.writeFileSync(path.join(folder,download.name),'keep');const cleanup=createDownloadCleanup({getDownloads:()=>[download]});
  const preview=await cleanup.preview(['one']);download.status='downloading';const result=await cleanup.deletePreview({ids:['one'],token:preview.token});assert.equal(result.failed.length,1);assert.ok(fs.existsSync(path.join(folder,download.name)));
});
test('Missing completed queue files and untracked archives have separate honest storage totals',async t=>{
  const {folder}=fixture(t),downloads=[job(folder,{status:'completed'}),job(folder,{id:'two',name:'missing.zip',status:'completed'})];
  fs.writeFileSync(path.join(folder,'untracked.rar'),'12345');fs.writeFileSync(path.join(folder,'untracked.zip'),'123');
  const cleanup=createDownloadCleanup({getDownloads:()=>downloads,getDownloadDir:()=>folder}),summary=await cleanup.summary();
  assert.equal(summary.totalBytes,0);assert.equal(summary.trackedBytes,0);assert.equal(summary.untrackedBytes,8);assert.equal(summary.libraryBytes,8);assert.equal(summary.missingItems.length,2);assert.equal(summary.scan.status,'complete');
  assert.ok(summary.items.every(item=>item.missing&&item.completedFileMissing));assert.ok(summary.untrackedItems.every(item=>item.deletable===false&&!item.id));
  const preview=await cleanup.preview(downloads.map(item=>item.id));assert.equal(preview.totalBytes,0);
  const removed=await cleanup.deletePreview({ids:downloads.map(item=>item.id),token:preview.token});assert.equal(removed.bytesFreed,0);assert.equal(fs.readFileSync(path.join(folder,'untracked.rar'),'utf8'),'12345');
});
test('Summary preserves valid archive bytes when unrelated checkpoint contents make cleanup unsafe',async t=>{
  const {folder}=fixture(t),download=job(folder),file=path.join(folder,download.name),workspace=workspaceFor(file+'.atlas-part',download.id);
  fs.writeFileSync(file,'12345');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'unknown.txt'),'unrelated');fs.writeFileSync(path.join(workspace,'data.part'),'123');
  const cleanup=createDownloadCleanup({getDownloads:()=>[download],getDownloadDir:()=>folder}),summary=await cleanup.summary();
  assert.equal(summary.completedBytes,5);assert.equal(summary.partialBytes,3);assert.equal(summary.untrackedBytes,0);assert.equal(summary.libraryBytes,8);assert.equal(summary.items[0].unavailable,true);assert.ok(summary.warnings.length);
  const preview=await cleanup.preview(['one']);assert.equal(preview.items.length,0);assert.ok(fs.existsSync(file));
});
test('Managed archives, partials, and their hardlink aliases are not counted again as untracked',async t=>{
  const {folder}=fixture(t),download=job(folder),file=path.join(folder,download.name);fs.writeFileSync(file,'12345');fs.writeFileSync(file+'.atlas-part','123');fs.linkSync(file,path.join(folder,'alias.rar'));fs.writeFileSync(path.join(folder,'untracked.7z'),'12');
  const cleanup=createDownloadCleanup({getDownloads:()=>[download],getDownloadDir:()=>folder}),summary=await cleanup.summary();
  assert.equal(summary.totalBytes,8);assert.equal(summary.untrackedBytes,2);assert.equal(summary.libraryBytes,10);assert.deepEqual(summary.untrackedItems.map(item=>item.name),['untracked.7z']);
});
test('A removed download folder is reported missing instead of an unexplained zero or a security error',async t=>{
  const {folder}=fixture(t),download=job(folder,{status:'completed'});fs.rmdirSync(folder);
  const summary=await createDownloadCleanup({getDownloads:()=>[download],getDownloadDir:()=>folder}).summary();
  assert.equal(summary.items[0].missing,true);assert.equal(summary.items[0].unavailable,false);assert.equal(summary.missingItems.length,1);assert.equal(summary.scan.status,'unavailable');assert.equal(summary.libraryBytes,0);
});
test('A job restarted while cleanup opens its file is rechecked before any deletion',async t=>{
  const {folder}=fixture(t),download=job(folder),file=path.join(folder,download.name);fs.writeFileSync(file,'keep');
  const cleanup=createDownloadCleanup({getDownloads:()=>[download]}),preview=await cleanup.preview(['one']);
  const original=fs.promises.open;t.after(()=>{fs.promises.open=original;});
  fs.promises.open=async function(...args){const handle=await original.apply(this,args);if(args[0]===file)download.status='downloading';return handle;};
  const result=await cleanup.deletePreview({ids:['one'],token:preview.token});assert.equal(result.bytesFreed,0);assert.equal(result.failed.length,1);assert.equal(fs.readFileSync(file,'utf8'),'keep');
});
