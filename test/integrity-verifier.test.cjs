'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createIntegrityVerifier}=require('../src/integrity-verifier.cjs');
const {parseManifest,MAX_MANIFEST_BYTES,MAX_ENTRIES,_test}=require('../src/integrity-worker.cjs');
const base=path.resolve(__dirname,'.integrity-fixtures');fs.mkdirSync(base,{recursive:true});
function fixture(t){const root=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>{const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});});return root;}
async function until(fn){const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw new Error('Verification test timed out.');await new Promise(resolve=>setTimeout(resolve,5));}}
const MD5='25f9e794323b453885f5181f1b624d0b',SHA256='15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225';

test('CRC32, MD5 and SHA256 vectors run in the worker without blocking the controller',async t=>{
  const root=fixture(t),manifestPath=path.join(root,'checksums.txt');fs.writeFileSync(path.join(root,'sample.bin'),'123456789');
  fs.writeFileSync(manifestPath,`sample.bin CBF43926\n${MD5} *sample.bin\nSHA256 (sample.bin) = ${SHA256}\n`);
  const updates=[],controller=createIntegrityVerifier({onChange:state=>updates.push(state)});t.after(()=>controller.cancel());
  assert.equal(controller.start({manifestPath,rootPath:root}).phase,'running');await until(()=>controller.snapshot().phase!=='running');
  const result=controller.snapshot();assert.equal(result.phase,'completed');assert.equal(result.total,3);assert.equal(result.completed,3);assert.deepEqual(result.results.map(item=>item.status),['match','match','match']);assert.equal(result.results[0].actual,'cbf43926');assert.ok(updates.length>=2);assert.ok(!JSON.stringify(result).includes(root));
});
test('Worker reports mismatches and missing files without calling them authentic or safe',async t=>{
  const root=fixture(t),manifestPath=path.join(root,'checksums.md5');fs.writeFileSync(path.join(root,'sample.bin'),'different');fs.writeFileSync(manifestPath,`${MD5}  sample.bin\n${MD5}  absent.bin\n`);
  const controller=createIntegrityVerifier();t.after(()=>controller.cancel());controller.start({manifestPath,rootPath:root});await until(()=>controller.snapshot().phase!=='running');
  const result=controller.snapshot();assert.equal(result.phase,'completed');assert.deepEqual(result.results.map(item=>item.status),['mismatch','missing']);assert.ok(!/authentic|malware.free|virus.free/i.test(JSON.stringify(result)));
});
test('Checksum manifest paths reject traversal, devices, absolute paths, alternate streams and controls',()=>{
  for(const name of ['../outside.bin','sub/../outside.bin','/etc/passwd','C:\\private.bin','\\\\server\\file.bin','file.bin:stream','NUL','dir/CON.txt','LPT1.bin','dir//file.bin','dir/./file.bin','dir/trailing.','bad\0name'])assert.throws(()=>parseManifest(`${MD5}  ${name}\n`),undefined,name);
  assert.equal(parseManifest(`${MD5} *sub\\sample.bin`)[0].name,'sub/sample.bin');
  assert.throws(()=>parseManifest(`${MD5} sample.bin\n${'0'.repeat(32)} sample.bin`),/MANIFEST_CONFLICT/);
  assert.equal(parseManifest(`${MD5} sample.bin\n${MD5} sample.bin`).length,1);
});
test('Manifest byte, line and entry limits are strict',async t=>{
  assert.throws(()=>parseManifest('x'.repeat(MAX_MANIFEST_BYTES+1)),/MANIFEST_LIMIT/);
  assert.throws(()=>parseManifest(Array.from({length:MAX_ENTRIES+1},(_,i)=>`${MD5} file${i}.bin`).join('\n')),/MANIFEST_LIMIT/);
  const root=fixture(t),manifestPath=path.join(root,'huge.sfv');fs.writeFileSync(manifestPath,Buffer.alloc(MAX_MANIFEST_BYTES+1,32));const controller=createIntegrityVerifier();t.after(()=>controller.cancel());
  controller.start({manifestPath,rootPath:root});await until(()=>controller.snapshot().phase!=='running');assert.equal(controller.snapshot().phase,'error');assert.match(controller.snapshot().error,/size or entry limit/);assert.equal(controller.snapshot().completed,0);
});
test('An opened checksum file detects pathname replacement and growth',async t=>{
  const root=fixture(t),file=path.join(root,'sample.bin');fs.writeFileSync(file,'original');
  let opened=await _test.openRead(file);
  try{const previous=path.join(root,'previous.bin');assert.equal(path.dirname(file),root);assert.equal(path.dirname(previous),root);fs.renameSync(file,previous);fs.writeFileSync(file,'replacement',{flag:'wx'});await assert.rejects(opened.verify(),/CHANGED_FILE/);}finally{await opened.handle.close();}
  opened=await _test.openRead(file);try{fs.appendFileSync(file,'growth');await assert.rejects(opened.verify(),/CHANGED_FILE/);}finally{await opened.handle.close();}
});
test('Linked subfolders and hardlinked targets cannot escape the chosen verification folder',async t=>{
  const root=fixture(t),files=path.join(root,'files'),outside=path.join(root,'outside');fs.mkdirSync(files);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sample.bin'),'123456789');
  fs.symlinkSync(outside,path.join(files,'linked'),process.platform==='win32'?'junction':'dir');fs.linkSync(path.join(outside,'sample.bin'),path.join(files,'shared.bin'));
  const manifestPath=path.join(root,'checksums.md5');fs.writeFileSync(manifestPath,`${MD5} linked/sample.bin\n${MD5} shared.bin`);const controller=createIntegrityVerifier();t.after(()=>controller.cancel());
  controller.start({manifestPath,rootPath:files});await until(()=>controller.snapshot().phase!=='running');assert.deepEqual(controller.snapshot().results.map(item=>item.status),['error','error']);assert.ok(controller.snapshot().results.every(item=>item.actual===''));
});
test('Verification can be cancelled during work and does not publish later completed results',async t=>{
  const root=fixture(t),manifestPath=path.join(root,'large.sfv'),file=path.join(root,'large.bin');const fd=fs.openSync(file,'wx');try{fs.ftruncateSync(fd,64*1024*1024);}finally{fs.closeSync(fd);}fs.writeFileSync(manifestPath,'large.bin 00000000');
  const controller=createIntegrityVerifier();t.after(()=>controller.cancel());controller.start({manifestPath,rootPath:root});await until(()=>controller.snapshot().total===1);assert.equal(controller.snapshot().phase,'running');
  assert.equal(controller.cancel().phase,'cancelled');await new Promise(resolve=>setTimeout(resolve,50));assert.equal(controller.snapshot().phase,'cancelled');assert.equal(controller.snapshot().completed,0);
});
