'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {verifyAttestation,parseArgs,REPOSITORY,PREDICATE,MAX_OUTPUT,TIMEOUT_MS}=require('../scripts/verify-attestation.cjs');
const base=path.resolve(__dirname,'.attestation-fixtures');fs.mkdirSync(base,{recursive:true});
const commit='a'.repeat(40),workflow='.github/workflows/publish-release.yml';
const verified=()=>JSON.stringify([{verificationResult:{signature:{certificate:{subjectAlternativeName:'fixture'}},verifiedTimestamps:[{type:'tlog'}],statement:{predicateType:PREDICATE}}}]);
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'case-')),artifact=path.join(root,'Ravenshelf-fixture.exe');fs.writeFileSync(artifact,Buffer.alloc(128,1));
  t.after(()=>{const relative=path.relative(base,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(fs.realpathSync(root),root);fs.rmSync(root,{recursive:true,force:true});});
  return {root,artifact,commit,workflow};
}
test('Attestation verification pins cryptographic identity flags for both approved workflows',async t=>{
  const f=fixture(t);
  for(const approved of [workflow,'.github/workflows/build-windows.yml']){
    let calls=0;
    const result=await verifyAttestation({...f,workflow:approved},{runner:(binary,args,options)=>{
      calls++;assert.equal(binary,'gh');assert.deepEqual(args,['attestation','verify',f.artifact,'--hostname','github.com','--repo',REPOSITORY,'--signer-workflow',`github.com/${REPOSITORY}/${approved}`,'--source-digest',commit,'--signer-digest',commit,'--predicate-type',PREDICATE,'--cert-oidc-issuer','https://token.actions.githubusercontent.com','--deny-self-hosted-runners','--digest-alg','sha256','--limit','30','--format','json']);
      assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.timeout,TIMEOUT_MS);assert.equal(options.maxBuffer,MAX_OUTPUT);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.env.GH_HOST,'github.com');assert.equal(options.env.GH_PROMPT_DISABLED,'1');assert.equal(options.env.GH_DEBUG,undefined);return verified();
    }});
    assert.equal(calls,1);assert.deepEqual(result,{verified:true,repository:REPOSITORY,workflow:approved,sourceCommit:commit,attestations:1});
  }
});
test('Invalid commits, workflow overrides and nonlocal artifacts cannot launch verification',async t=>{
  const f=fixture(t);let calls=0;const runner=()=>{calls++;return verified();};
  for(const patch of [{commit:'main'},{commit:'a'.repeat(39)},{commit:commit+' --repo evil/example'},{workflow:'evil/repo/.github/workflows/publish-release.yml'},{workflow:'../publish-release.yml'},{artifact:'https://example.invalid/file.exe'},{artifact:'\\\\server\\share\\file.exe'},{artifact:f.artifact+':hidden.exe'},{artifact:'artifact.exe\n--bundle=bad'},{artifact:'artifact.zip'}])await assert.rejects(verifyAttestation({...f,...patch},{runner}));
  assert.equal(calls,0);
});
test('The command interface refuses duplicate, missing or extra policy arguments',()=>{
  const valid=['--artifact','release-files/Ravenshelf-fixture.exe','--commit',commit,'--workflow',workflow];assert.equal(parseArgs(valid).workflow,workflow);
  for(const values of [[],valid.slice(0,4),[...valid,'--bundle','untrusted.json'],['--artifact','file.exe','--commit',commit,'--commit',commit],['--artifact','file.exe','--commit',commit,'--repo','other/repo']])assert.throws(()=>parseArgs(values));
});
test('Missing CLI, failed signatures and timeouts fail closed without logging raw stderr',async t=>{
  const f=fixture(t);
  for(const code of ['ENOENT','ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','SIGNATURE_INVALID']){
    let calls=0;await assert.rejects(verifyAttestation(f,{runner:()=>{calls++;const error=new Error('fixture secret and private path');error.code=code;error.stderr='fixture token';throw error;}}),error=>/verification failed.*Publication must stop/.test(error.message)&&!error.message.includes('fixture'));
    assert.equal(calls,1);
  }
});
test('A zero exit with missing or malformed verified output is not accepted as proof',async t=>{
  const f=fixture(t);
  for(const output of ['', 'not json','[]','{}',JSON.stringify([{attestation:{dsseEnvelope:{payload:'unsigned'}}}]),JSON.stringify([{verificationResult:{statement:{predicateType:PREDICATE}}}]),' '.repeat(MAX_OUTPUT+1)])await assert.rejects(verifyAttestation(f,{runner:()=>output}),/GitHub CLI/);
  const noTimestamp=JSON.parse(verified());noTimestamp[0].verificationResult.verifiedTimestamps=[];await assert.rejects(verifyAttestation(f,{runner:()=>JSON.stringify(noTimestamp)}),/GitHub CLI/);
  const wrongPredicate=JSON.parse(verified());wrongPredicate[0].verificationResult.statement.predicateType='https://example.invalid/custom';await assert.rejects(verifyAttestation(f,{runner:()=>JSON.stringify(wrongPredicate)}),/GitHub CLI/);
});
test('An artifact changed during CLI verification cannot be reported verified',async t=>{
  const f=fixture(t);await assert.rejects(verifyAttestation(f,{runner:()=>{fs.appendFileSync(f.artifact,'changed');return verified();}}),/unchanged/);
});
test('Linked artifacts or ancestors and nonregular files are rejected before CLI execution',async t=>{
  const f=fixture(t),hardlink=path.join(f.root,'linked.exe'),directory=path.join(f.root,'directory.exe'),alias=path.join(f.root,'junction');
  fs.linkSync(f.artifact,hardlink);fs.mkdirSync(directory);fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
  let calls=0;for(const artifact of [hardlink,directory,path.join(alias,path.basename(f.artifact))])await assert.rejects(verifyAttestation({...f,artifact},{runner:()=>{calls++;return verified();}}),/local artifact/);
  assert.equal(calls,0);
});
test('The verified build record can be exported only to a new local .sigstore.json file',async t=>{
  const f=fixture(t),record=path.join(f.root,'update-record.sigstore.json');
  const bundle={mediaType:'application/vnd.dev.sigstore.bundle.v0.3+json',verificationMaterial:{tlogEntries:[]},dsseEnvelope:{payload:'e30=',payloadType:'application/vnd.in-toto+json',signatures:[]}};
  const output=()=>{const results=JSON.parse(verified());results[0].attestation={bundle,bundle_url:'https://example.invalid/signed?sig=secret'};return JSON.stringify(results);};
  const parsed=parseArgs(['--artifact','release-files/Ravenshelf-fixture.exe','--commit',commit,'--workflow',workflow,'--export','update-record.sigstore.json']);
  assert.equal(parsed.exportPath,path.resolve('update-record.sigstore.json'));
  // A backslash path is a UNC share only on Windows.
  for(const values of [['--export','record.json'],['--export','record.sigstore.json','--export','other.sigstore.json'],['--export'],['--export','record.sigstore.json:hidden.sigstore.json'],...(process.platform==='win32'?[['--export','\\\\server\\share\\record.sigstore.json']]:[])])
    assert.throws(()=>parseArgs(['--artifact','file.exe','--commit',commit,'--workflow',workflow,...values]),JSON.stringify(values));
  const result=await verifyAttestation({...f,exportPath:record},{runner:output});
  assert.deepEqual(result,{verified:true,repository:REPOSITORY,workflow,sourceCommit:commit,attestations:1,exported:'update-record.sigstore.json'});
  assert.deepEqual(JSON.parse(fs.readFileSync(record,'utf8')),bundle);assert.doesNotMatch(fs.readFileSync(record,'utf8'),/secret|bundle_url/);
  await assert.rejects(verifyAttestation({...f,exportPath:record},{runner:output}),/could not be saved to a new file/);assert.deepEqual(JSON.parse(fs.readFileSync(record,'utf8')),bundle,'an existing file is never replaced');
  const missing=path.join(f.root,'missing.sigstore.json');
  for(const changed of [{},{bundle:null},{bundle:{...bundle,mediaType:'application/json'}},{bundle:{...bundle,dsseEnvelope:undefined}},{bundle:{...bundle,padding:'x'.repeat(1024*1024)}}]){
    const results=JSON.parse(verified());results[0].attestation=changed;
    await assert.rejects(verifyAttestation({...f,exportPath:missing},{runner:()=>JSON.stringify(results)}),/did not return the verified build record/);
  }
  assert.equal(fs.existsSync(missing),false);
});
