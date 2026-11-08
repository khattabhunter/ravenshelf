'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verifyUpdateRecord,verifyInElectron,electronBinary,parseArgs,outputLines,MAX_HANDOFF_BYTES}=require('../scripts/verify-update-record.cjs');
const {embeddedTrustedRoot}=require('../src/release-attestation.cjs');
// The real 0.4.1 record; the executable's hash is supplied because the
// published executable is not stored in the repository.
const FIXTURE=path.join(__dirname,'fixtures','ravenshelf-0.4.1.sigstore.json');
const DIGEST='d62b521f6c0f1e94151943a765ff3a18f23c19fff5e887241eab22adf6b0ffc3';
const genuine={artifact:'/release-files/Ravenshelf-0.4.1-Windows.exe',record:FIXTURE,name:'Ravenshelf-0.4.1-Windows.exe'};
const hashed=sha256=>async()=>({sha256,size:111171308});
async function scratch(t){const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ravenshelf-record-test-'));t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));return root;}

test('the release gate accepts the genuine record with both trusted roots and hands over its exact bytes',async()=>{
  const bytes=fs.readFileSync(FIXTURE);
  const result=await verifyUpdateRecord(genuine,{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot()});
  assert.equal(result.currentRoot,true);assert.equal(result.warning,'');assert.deepEqual(result.release,{name:'Ravenshelf-0.4.1-Windows.exe',sha256:DIGEST});
  assert.equal(result.recordSha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.ok(Buffer.from(result.recordBase64,'base64').equals(bytes));
  assert.ok(result.recordBase64.length<30000,'the handoff stays under the Windows environment limit');
});
test('an unreachable TUF service is reported, but a current root that rejects the record stops the release',async()=>{
  const offline=await verifyUpdateRecord(genuine,{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>{throw new Error('offline');}});
  assert.equal(offline.currentRoot,false);assert.match(offline.warning,/bundled trusted root only/);
  const emptyRoot={...embeddedTrustedRoot(),tlogs:[],ctlogs:[],certificateAuthorities:[],timestampAuthorities:[]};
  await assert.rejects(verifyUpdateRecord(genuine,{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>emptyRoot}));
});
test('a record for a different executable, name or content never passes the gate',async t=>{
  await assert.rejects(verifyUpdateRecord(genuine,{hashArtifact:hashed('0'.repeat(64)),loadCurrentRoot:async()=>embeddedTrustedRoot()}),/names a different file/);
  await assert.rejects(verifyUpdateRecord({...genuine,name:'Ravenshelf-0.4.2-Windows.exe'},{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot()}),/names a different file/);
  const root=await scratch(t),changed=path.join(root,'changed.sigstore.json'),large=path.join(root,'large.sigstore.json'),empty=path.join(root,'empty.sigstore.json');
  const record=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));record.dsseEnvelope.signatures[0].sig=Buffer.alloc(70,1).toString('base64');fs.writeFileSync(changed,JSON.stringify(record));
  fs.writeFileSync(large,' '.repeat(MAX_HANDOFF_BYTES+1));fs.writeFileSync(empty,'');
  await assert.rejects(verifyUpdateRecord({...genuine,record:changed},{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot()}));
  await assert.rejects(verifyUpdateRecord({...genuine,record:large},{hashArtifact:hashed(DIGEST)}),/too large/);
  await assert.rejects(verifyUpdateRecord({...genuine,record:empty},{hashArtifact:hashed(DIGEST)}),/empty/);
});
test('the release gate accepts only one release executable and one .sigstore.json record',()=>{
  const parsed=parseArgs(['--artifact','release-files/Ravenshelf-0.4.2-Windows.exe','--record','update-record.sigstore.json']);
  assert.equal(parsed.name,'Ravenshelf-0.4.2-Windows.exe');assert.equal(parsed.artifact,path.resolve('release-files/Ravenshelf-0.4.2-Windows.exe'));assert.equal(parsed.record,path.resolve('update-record.sigstore.json'));assert.equal(parsed.output,undefined);
  const output=path.resolve('github-output.txt');assert.equal(parseArgs(['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--output',output]).output,output);
  assert.equal(parseArgs(['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--runtime','electron','--output',output]).runtime,'electron');
  for(const args of [['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--runtime','node'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--runtime','electron','--runtime','electron'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--output','relative.txt'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--output',output,'--output',output],['--artifact','Ravenshelf-0.4.2-Windows.exe'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--artifact','Ravenshelf-0.4.2-Windows.exe'],['--artifact','other.exe','--record','r.sigstore.json'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','record.json'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r.sigstore.json','--extra','x'],['--record','r.sigstore.json','--bundle','b.json'],['--artifact','Ravenshelf-0.4.2-Windows.exe','--record','r\n.sigstore.json']])
    assert.throws(()=>parseArgs(args),JSON.stringify(args));
});
test('step outputs are two exact lines that GitHub Actions reads as name=value pairs',async t=>{
  const result=await verifyUpdateRecord(genuine,{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot()});
  const lines=outputLines(result).split('\n');assert.equal(lines.length,3);assert.equal(lines[2],'');
  assert.equal(lines[0],'record-sha256='+result.recordSha256);assert.equal(lines[1],'record='+result.recordBase64);assert.match(lines[1],/^record=[A-Za-z0-9+/]+=*$/);
});
test('the Electron runtime check is required when requested and must report a verified record',async t=>{
  const calls=[];
  const passed=await verifyUpdateRecord({...genuine,runtime:'electron'},{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot(),electron:async args=>{calls.push(args);return '45.2.3';}});
  assert.equal(passed.electronVersion,'45.2.3');assert.deepEqual(calls,[{record:FIXTURE,release:{name:'Ravenshelf-0.4.1-Windows.exe',sha256:DIGEST}}]);
  const skipped=await verifyUpdateRecord(genuine,{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot(),electron:async()=>{throw new Error('not requested');}});assert.equal(skipped.electronVersion,'');
  await assert.rejects(verifyUpdateRecord({...genuine,runtime:'electron'},{hashArtifact:hashed(DIGEST),loadCurrentRoot:async()=>embeddedTrustedRoot(),electron:async()=>{throw new Error('The Electron runtime did not verify the build record.');}}),/Electron runtime did not verify/);
  const run=(output,error=null)=>(binary,args,options,callback)=>{calls.push({binary,args,options});callback(error,output,'');};
  assert.equal(await verifyInElectron({record:FIXTURE,release:{name:'Ravenshelf-0.4.1-Windows.exe',sha256:DIGEST}},{binary:'electron-fixture',run:run('verified:45.2.3')}),'45.2.3');
  const call=calls.at(-1);assert.equal(call.binary,'electron-fixture');assert.equal(call.options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(call.args[0],'-e');assert.deepEqual(call.args.slice(-3),[FIXTURE,'Ravenshelf-0.4.1-Windows.exe',DIGEST]);
  for(const runner of [run('verified:'),run('verified:45.2.3\nextra'),run(''),run('verified:45.2.3',new Error('exit 1'))])
    await assert.rejects(verifyInElectron({record:FIXTURE,release:{name:'Ravenshelf-0.4.1-Windows.exe',sha256:DIGEST}},{binary:'electron-fixture',run:runner}),/Electron runtime did not verify/);
  const empty=await scratch(t);assert.throws(()=>electronBinary(empty),/Electron runtime is not installed/);
});
function installedElectron(){
  if(process.env.RAVENSHELF_TEST_ELECTRON)return process.env.RAVENSHELF_TEST_ELECTRON;
  try{return electronBinary();}catch{return null;}
}
const ELECTRON=installedElectron(),REQUIRE_ELECTRON=process.env.RAVENSHELF_REQUIRE_ELECTRON==='1';
test('the release gate accepts the genuine record inside Electron and rejects another digest there',{skip:ELECTRON||REQUIRE_ELECTRON?false:'The development Electron binary is not installed.'},async()=>{
  assert.ok(ELECTRON,'This run requires the Electron runtime; install it with node node_modules/electron/install.js.');
  assert.match(await verifyInElectron({record:FIXTURE,release:{name:'Ravenshelf-0.4.1-Windows.exe',sha256:DIGEST}},{binary:ELECTRON}),/^\d+\.\d+\.\d+$/);
  await assert.rejects(verifyInElectron({record:FIXTURE,release:{name:'Ravenshelf-0.4.1-Windows.exe',sha256:'0'.repeat(64)}},{binary:ELECTRON}),/Electron runtime did not verify/);
});
