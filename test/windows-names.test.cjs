'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {safeName,folderName,isWindowsDeviceName}=require('../src/safe-name.cjs');
const {parseManifest}=require('../src/integrity-worker.cjs');
const {scanConfiguredArchives}=require('../src/download-storage.cjs');
const {createDownloadCleanup}=require('../src/download-cleanup.cjs');
const unsafe=['con .txt','NUL   .rar','aux .zip','Prn  .bin','COM1 .7z','LPT0 .bin','COM¹ .rar','lpt² .txt','COM³','CONIN$','conout$ .txt','Conin$.log'];
const normal=['con x.txt','conx .txt','com10 .txt','my con .rar','con-file .txt','conin.txt','conout.log','conin$x.txt','console.txt','connect.txt'];

test('Windows device aliases are prefixed for new downloads and unchanged ordinary names remain stable',()=>{
 for(const name of unsafe){assert.equal(isWindowsDeviceName(name),true,name);assert.ok(safeName(name).startsWith('_'),name);assert.equal(safeName(safeName(name)),safeName(name));}
 for(const name of normal){assert.equal(isWindowsDeviceName(name),false,name);assert.equal(safeName(name),name);}
 assert.equal(folderName('Con .Game'),'_Con .Game');
});

test('checksum manifests reject device aliases in every path component before opening files',()=>{
 const checksum='0'.repeat(32);
 for(const name of unsafe)for(const filename of [name,'files/'+name,name+'/sample.bin'])assert.throws(()=>parseManifest(`${checksum}  ${filename}`),/MANIFEST_PATH/,filename);
 for(const name of normal)assert.equal(parseManifest(`${checksum}  ${name}`)[0].name,name);
});

test('storage enumeration skips device aliases before attempting their metadata',async t=>{
 const base=path.resolve(__dirname,'.windows-name-fixtures');fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'storage-'));
 const originalOpen=fs.promises.opendir,originalStat=fs.promises.lstat;
 t.after(()=>{fs.promises.opendir=originalOpen;fs.promises.lstat=originalStat;assert.equal(path.dirname(root),base);fs.rmdirSync(root);});
 const pending=unsafe.map(name=>({name}));let unsafeReads=0,closed=false;
 fs.promises.opendir=async directory=>{assert.equal(directory,root);return {read:async()=>pending.shift()||null,close:async()=>{closed=true;}};};
 fs.promises.lstat=async function(file,...args){if(unsafe.includes(path.basename(String(file)))){unsafeReads++;throw new Error('Device path reached metadata lookup.');}return originalStat.call(this,file,...args);};
 const result=await scanConfiguredArchives({root});
 assert.equal(unsafeReads,0);assert.equal(result.scan.skippedEntries,unsafe.length);assert.equal(result.untrackedBytes,0);assert.equal(closed,true);
});

test('cleanup rejects device aliases before filesystem access while ordinary browser files remain removable',async t=>{
 const base=path.resolve(__dirname,'.windows-name-fixtures');fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'cleanup-')),folder=path.join(root,'Browser downloads');fs.mkdirSync(folder);
 const originalStat=fs.promises.lstat;let unsafeReads=0;
 t.after(()=>{fs.promises.lstat=originalStat;assert.equal(path.dirname(root),base);fs.rmSync(root,{recursive:true,force:true});});
 fs.promises.lstat=async function(file,...args){if(unsafe.includes(path.basename(String(file)))){unsafeReads++;throw new Error('Device path reached metadata lookup.');}return originalStat.call(this,file,...args);};
 const downloads=unsafe.map((name,i)=>({id:String(i),name,folder,status:'completed',origin:'browser'}));
 downloads.push({id:'normal',name:'ordinary.txt',folder,status:'completed',origin:'browser'});
 fs.writeFileSync(path.join(folder,'ordinary.txt'),'fixture');
 const cleanup=createDownloadCleanup({getDownloads:()=>downloads});
 for(const item of downloads.slice(0,-1)){const preview=await cleanup.preview([item.id]);assert.equal(preview.items.length,0);assert.equal(preview.warnings.length,1);const result=await cleanup.deletePreview({ids:[item.id],token:preview.token});assert.deepEqual(result.removedIds,[]);assert.equal(result.bytesFreed,0);}
 assert.equal(unsafeReads,0);
 const preview=await cleanup.preview(['normal']);assert.equal(preview.items.length,1);assert.equal(preview.warnings.length,0);
 const result=await cleanup.deletePreview({ids:['normal'],token:preview.token});assert.deepEqual(result.removedIds,['normal']);assert.equal(result.bytesFreed,7);
});

test('the updater helper refuses exactly the device names the app refuses',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','src','updater-helper.cs'),'utf8');
 const cs=/Regex\.IsMatch\(segment, @"([^"]+)", RegexOptions\.IgnoreCase \| RegexOptions\.CultureInvariant\)/.exec(source);assert.ok(cs,'the C# device-name pattern is found');
 const js=/\/\^\(\?:(.+?)\) \*\(\?:\\\.\|\$\)\/i\.test/.exec(fs.readFileSync(path.join(__dirname,'..','src','safe-name.cjs'),'utf8'));assert.ok(js,'the JavaScript device-name pattern is found');
 // The same alternatives and ending, written for each language.
 assert.equal(cs[1],'^('+js[1]+') *(?:\\.|$)');
 const csPattern=new RegExp(cs[1],'i');
 for(const name of unsafe)assert.equal(csPattern.test(name),true,name);
 for(const name of normal)assert.equal(csPattern.test(name),false,name);
});
