'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {verifyRecord,verifyReleaseBuild,checkStatement,loadTrustedRoot,embeddedTrustedRoot,damagedCache,parseRecord,recordName,policyFor,EXPECTED,MAX_RECORD_BYTES}=require('../src/release-attestation.cjs');

// GitHub's public signed build record for the published 0.4.1 executable.
// Verification is offline: it uses the Sigstore trusted root bundled with the
// pinned @sigstore/tuf package and the record's own transparency-log proof.
const RECORD_TEXT=fs.readFileSync(path.join(__dirname,'fixtures','ravenshelf-0.4.1.sigstore.json'),'utf8');
const record=()=>JSON.parse(RECORD_TEXT);
const RELEASE=Object.freeze({name:'Ravenshelf-0.4.1-Windows.exe',sha256:'d62b521f6c0f1e94151943a765ff3a18f23c19fff5e887241eab22adf6b0ffc3'});
const root=embeddedTrustedRoot(),offline=async()=>root;
const GENERIC={name:'Error',message:'The signed build record could not be verified.'};
const payloadOf=bundle=>JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString('utf8'));
const withPayload=(bundle,statement)=>{bundle.dsseEnvelope.payload=Buffer.from(JSON.stringify(statement)).toString('base64');return bundle;};

test('the published 0.4.1 build record verifies against the pinned release workflow identity',async()=>{
  assert.equal(recordName(RELEASE.name),'Ravenshelf-0.4.1-Windows.exe.sigstore.json');
  assert.equal(verifyRecord(record(),RELEASE,root),true);
  assert.equal(await verifyReleaseBuild({release:RELEASE,recordText:RECORD_TEXT,loadRoot:offline}),true);
  assert.equal(EXPECTED.identity,'https://github.com/khattabhunter/ravenshelf/.github/workflows/publish-release.yml@refs/heads/main');
  assert.equal(EXPECTED.issuer,'https://token.actions.githubusercontent.com');
  assert.deepEqual({...EXPECTED.claims},{11:'github-hosted',12:'https://github.com/khattabhunter/ravenshelf',14:'refs/heads/main',15:'1448364041',17:'76850671'});
  assert.ok(Object.isFrozen(EXPECTED)&&Object.isFrozen(EXPECTED.claims));
});

test('a genuine record for another file name or digest is rejected',async()=>{
  for(const release of [{...RELEASE,name:'Ravenshelf-0.4.2-Windows.exe'},{...RELEASE,sha256:'0'.repeat(64)},{...RELEASE,sha256:RELEASE.sha256.slice(0,63)+'0'}]){
    assert.throws(()=>verifyRecord(record(),release,root),/names a different file/);
    await assert.rejects(verifyReleaseBuild({release,recordText:RECORD_TEXT,loadRoot:offline}),GENERIC);
  }
});

test('every pinned certificate identity, issuer and claim is enforced',()=>{
  const claims=[['11','self-hosted'],['12','https://github.com/khattabhunter/other'],['14','refs/heads/release'],['15','1448364042'],['17','76850672']];
  for(const [suffix,value]of claims)assert.throws(()=>verifyRecord(record(),RELEASE,root,{...EXPECTED,claims:{...EXPECTED.claims,[suffix]:value}}),{code:'UNTRUSTED_SIGNER_ERROR'},`claim ${suffix}`);
  for(const identity of [EXPECTED.identity.replace('publish-release.yml','build-windows.yml'),EXPECTED.identity.replace('@refs/heads/main','@refs/heads/dev'),EXPECTED.identity.replace('khattabhunter/ravenshelf','khattabhunter/atlas-library'),EXPECTED.identity.slice(0,-1),EXPECTED.identity.slice(1),EXPECTED.identity+'x'])
    assert.throws(()=>verifyRecord(record(),RELEASE,root,{...EXPECTED,identity}),{code:'UNTRUSTED_SIGNER_ERROR'},identity);
  assert.throws(()=>verifyRecord(record(),RELEASE,root,{...EXPECTED,issuer:'https://token.actions.githubusercontent.com.evil.example'}),{code:'UNTRUSTED_SIGNER_ERROR'});
  // The identity is matched as a whole string, not as a substring or pattern.
  const policy=policyFor(EXPECTED);assert.equal(policy.subjectAlternativeName.test('x'+EXPECTED.identity),false);assert.equal(policy.subjectAlternativeName.test(EXPECTED.identity.replace(/\./g,'X')),false);
  assert.deepEqual(policy.oids.map(item=>item.oid.id.join('.')),['1.3.6.1.4.1.57264.1.11','1.3.6.1.4.1.57264.1.12','1.3.6.1.4.1.57264.1.14','1.3.6.1.4.1.57264.1.15','1.3.6.1.4.1.57264.1.17']);
  assert.deepEqual([...policy.oids[0].value],[0x0c,13,...Buffer.from('github-hosted')]);
});

test('tampered statements, signatures, certificates and transparency-log proofs are rejected',()=>{
  const cases={
    'changed statement':bundle=>{const statement=payloadOf(bundle);statement.subject[0].digest.sha256='0'.repeat(64);return withPayload(bundle,statement);},
    'changed predicate':bundle=>{const statement=payloadOf(bundle);statement.predicateType='https://example.com/other';return withPayload(bundle,statement);},
    'changed signature':bundle=>{const value=Buffer.from(bundle.dsseEnvelope.signatures[0].sig,'base64');value[value.length-3]^=1;bundle.dsseEnvelope.signatures[0].sig=value.toString('base64');return bundle;},
    'changed certificate':bundle=>{const value=Buffer.from(bundle.verificationMaterial.certificate.rawBytes,'base64');value[value.length-40]^=1;bundle.verificationMaterial.certificate.rawBytes=value.toString('base64');return bundle;},
    'removed log entry':bundle=>{bundle.verificationMaterial.tlogEntries=[];return bundle;},
    'changed log time':bundle=>{const entry=bundle.verificationMaterial.tlogEntries[0];entry.integratedTime=String(Number(entry.integratedTime)+1);return bundle;},
    'changed inclusion proof':bundle=>{const proof=bundle.verificationMaterial.tlogEntries[0].inclusionProof;const value=Buffer.from(proof.hashes[0],'base64');value[0]^=1;proof.hashes[0]=value.toString('base64');return bundle;},
    'duplicated log entry':bundle=>{bundle.verificationMaterial.tlogEntries.push(structuredClone(bundle.verificationMaterial.tlogEntries[0]));return bundle;},
    'unexpected payload type':bundle=>{bundle.dsseEnvelope.payloadType='application/json';return bundle;}
  };
  const reasons={'changed statement':'TLOG_BODY_ERROR','changed predicate':'TLOG_BODY_ERROR','changed signature':'TLOG_BODY_ERROR','changed certificate':'CERTIFICATE_ERROR','removed log entry':'TIMESTAMP_ERROR','changed log time':'TLOG_INCLUSION_PROMISE_ERROR','changed inclusion proof':'TLOG_INCLUSION_PROOF_ERROR','duplicated log entry':'TIMESTAMP_ERROR'};
  for(const [label,change]of Object.entries(cases))assert.throws(()=>verifyRecord(change(record()),RELEASE,root),error=>reasons[label]?error.code===reasons[label]:/signed provenance statement/.test(error.message),label);
});

test('the signed statement must be SLSA provenance naming the exact executable',()=>{
  const statement=()=>({_type:'https://in-toto.io/Statement/v1',predicateType:'https://slsa.dev/provenance/v1',subject:[{name:RELEASE.name,digest:{sha256:RELEASE.sha256}}]});
  assert.equal(checkStatement(statement(),RELEASE),true);
  assert.equal(checkStatement({...statement(),subject:[{name:'other.exe',digest:{sha256:'1'.repeat(64)}},{name:RELEASE.name,digest:{sha256:RELEASE.sha256,sha512:'x'}}]},RELEASE),true);
  for(const changed of [{_type:'https://in-toto.io/Statement/v0.1'},{predicateType:'https://spdx.dev/Document'},{subject:[]},{subject:null},{subject:[{name:RELEASE.name}]},{subject:[{name:RELEASE.name,digest:{sha256:RELEASE.sha256.toUpperCase()}}]},{subject:[{name:'ravenshelf-0.4.1-windows.exe',digest:{sha256:RELEASE.sha256}}]}])
    assert.throws(()=>checkStatement({...statement(),...changed},RELEASE),Error,JSON.stringify(changed));
  assert.throws(()=>checkStatement(null,RELEASE));assert.throws(()=>checkStatement(statement(),{name:'evil.exe',sha256:RELEASE.sha256}));
});

test('malformed, oversized or non-bundle records fail closed with one generic message',async()=>{
  for(const recordText of ['','null','[]','"text"','{','{}','{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}',' '.repeat(MAX_RECORD_BYTES+1),undefined,42]){
    await assert.rejects(verifyReleaseBuild({release:RELEASE,recordText,loadRoot:offline}),GENERIC);
  }
  assert.throws(()=>parseRecord('x'.repeat(MAX_RECORD_BYTES+1)),GENERIC);assert.deepEqual(parseRecord('\uFEFF{"a":1}'),{a:1});
});

test('invalid release metadata is rejected before any trusted root is loaded',async()=>{
  let loads=0;const counting=async()=>{loads++;return root;};
  for(const release of [null,{},{...RELEASE,name:'evil.exe'},{...RELEASE,name:'Ravenshelf-0.4.1-Windows.exe.bat'},{...RELEASE,sha256:RELEASE.sha256.toUpperCase()},{...RELEASE,sha256:'abc'}])
    await assert.rejects(verifyReleaseBuild({release,recordText:RECORD_TEXT,loadRoot:counting}),GENERIC);
  assert.equal(loads,0);
});

test('the trusted root refreshes through TUF and falls back to the bundled root only when refresh fails',async t=>{
  const cache=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ravenshelf-tuf-test-'));t.after(()=>fs.promises.rm(cache,{recursive:true,force:true}));
  const refreshed={mediaType:'fixture refreshed root'};let requested='';
  assert.equal(await loadTrustedRoot({cachePath:cache,refresh:async value=>{requested=value;return refreshed;}}),refreshed);assert.equal(requested,cache);
  assert.equal(await loadTrustedRoot({cachePath:cache,refresh:async()=>{throw new Error('offline');}}),root);
  assert.equal(await loadTrustedRoot({cachePath:cache,timeoutMs:20,refresh:()=>new Promise(()=>{})}),root,'a stalled refresh times out to the bundled root');
  let calls=0;assert.equal(await loadTrustedRoot({cachePath:'relative/cache',refresh:async()=>{calls++;return refreshed;}}),root);assert.equal(await loadTrustedRoot({refresh:async()=>{calls++;return refreshed;}}),root);assert.equal(calls,0);
  const controller=new AbortController(),stopping=loadTrustedRoot({cachePath:cache,refresh:()=>new Promise(()=>{}),signal:controller.signal});controller.abort(new Error('Stopped by shutdown'));
  await assert.rejects(stopping,/Stopped by shutdown/);
  await assert.rejects(loadTrustedRoot({cachePath:cache,signal:controller.signal,refresh:async()=>refreshed}),/Stopped by shutdown/);
});

test('a partly written TUF root is re-seeded from the bundled TUF root',async t=>{
  const cache=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ravenshelf-tuf-test-'));t.after(()=>fs.promises.rm(cache,{recursive:true,force:true}));
  assert.equal(damagedCache(cache),false,'an empty cache is seeded normally');
  const folder=path.join(cache,'tuf-repo-cdn.sigstore.dev');await fs.promises.mkdir(folder);
  await fs.promises.writeFile(path.join(folder,'root.json'),'{"signed":');assert.equal(damagedCache(cache),true);
  await fs.promises.writeFile(path.join(folder,'root.json'),'{"signed":{}}');assert.equal(damagedCache(cache),false);
});

test('the bundled Sigstore trusted root contains the services that sign GitHub attestations',()=>{
  assert.ok(root.tlogs.some(log=>log.baseUrl==='https://rekor.sigstore.dev'));
  assert.ok(root.certificateAuthorities.some(authority=>authority.uri==='https://fulcio.sigstore.dev'));
  assert.ok(root.ctlogs.length>0);assert.ok(root.timestampAuthorities.length>0);
});

// Electron uses BoringSSL, which has no default digest for EC or RSA keys and
// rejects crypto.verify(null, ...). sigstore-js relies on OpenSSL's SHA-256
// default for DSSE signatures, Rekor entry timestamps and checkpoints.
function simulateBoringSSL(t){
  const original=crypto.verify;let refused=0;
  const strict=function(algorithm,data,key,signature,callback){
    if(algorithm==null&&(key instanceof crypto.KeyObject)&&key.asymmetricKeyType!=='ed25519'&&key.asymmetricKeyType!=='ed448'){refused++;throw Object.assign(new Error('No default digest.'),{code:'ERR_OSSL_EVP_NO_DEFAULT_DIGEST'});}
    return original.call(this,algorithm,data,key,signature,callback);
  };
  crypto.verify=strict;t.after(()=>{crypto.verify=original;});
  return {strict,get refused(){return refused;}};
}
test('records verify under Electron-style BoringSSL digest rules and crypto is restored afterwards',t=>{
  const simulated=simulateBoringSSL(t);
  assert.equal(verifyRecord(record(),RELEASE,root),true);assert.equal(simulated.refused,0,'no null-digest call reaches BoringSSL');
  assert.equal(crypto.verify,simulated.strict,'the temporary default is removed after success');
  const signature=record();const value=Buffer.from(signature.dsseEnvelope.signatures[0].sig,'base64');value[10]^=1;signature.dsseEnvelope.signatures[0].sig=value.toString('base64');
  assert.throws(()=>verifyRecord(signature,RELEASE,root),{code:'TLOG_BODY_ERROR'});
  const promise=record(),entry=promise.verificationMaterial.tlogEntries[0],set=Buffer.from(entry.inclusionPromise.signedEntryTimestamp,'base64');set[12]^=1;entry.inclusionPromise.signedEntryTimestamp=set.toString('base64');
  assert.throws(()=>verifyRecord(promise,RELEASE,root),{code:'TLOG_INCLUSION_PROMISE_ERROR'});
  assert.throws(()=>verifyRecord(record(),{...RELEASE,sha256:'0'.repeat(64)},root),/names a different file/);
  assert.equal(crypto.verify,simulated.strict,'the temporary default is removed after failures');
  // Outside verification, a null digest still reaches the platform unchanged.
  const {publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});assert.throws(()=>crypto.verify(null,Buffer.from('x'),publicKey,Buffer.alloc(8)),{code:'ERR_OSSL_EVP_NO_DEFAULT_DIGEST'});
});

// Runs the verifier in Electron's own runtime when the development Electron
// binary is installed (CI installs it; offline checkouts may not).
function electronBinary(){
  if(process.env.RAVENSHELF_TEST_ELECTRON)return process.env.RAVENSHELF_TEST_ELECTRON;
  try{const folder=path.join(__dirname,'..','node_modules','electron'),name=fs.readFileSync(path.join(folder,'path.txt'),'utf8').trim(),binary=path.join(folder,'dist',name);return fs.existsSync(binary)?binary:null;}catch{return null;}
}
const ELECTRON=electronBinary(),REQUIRE_ELECTRON=process.env.RAVENSHELF_REQUIRE_ELECTRON==='1';
test('the packaged runtime (Electron with BoringSSL) accepts genuine records, rejects changed ones and verifies TUF signatures',{skip:ELECTRON||REQUIRE_ELECTRON?false:'The development Electron binary is not installed.'},async()=>{
  assert.ok(ELECTRON,'This run requires the Electron runtime; install it with node node_modules/electron/install.js.');
  const script=`
    const fs=require('fs'),crypto=require('crypto'),{verifyRecord,embeddedTrustedRoot}=require(process.argv[1]);
    const text=fs.readFileSync(process.argv[2],'utf8'),release=JSON.parse(process.argv[3]),root=embeddedTrustedRoot(),results={electron:process.versions.electron||''};
    results.genuine=verifyRecord(JSON.parse(text),release,root);
    const changed=JSON.parse(text),entry=changed.verificationMaterial.tlogEntries[0],set=Buffer.from(entry.inclusionPromise.signedEntryTimestamp,'base64');set[12]^=1;entry.inclusionPromise.signedEntryTimestamp=set.toString('base64');
    try{verifyRecord(changed,release,root);results.changed='accepted';}catch(error){results.changed=error.code||error.message;}
    const before=crypto.verify;verifyRecord(JSON.parse(text),release,root);results.restored=crypto.verify===before;
    const {Metadata,MetadataKind}=require(require.resolve('@tufjs/models',{paths:[require('path').dirname(require.resolve('tuf-js',{paths:[require('path').dirname(require.resolve('@sigstore/tuf',{paths:[process.argv[4]]}))]}))]}));
    const seed=require(require.resolve('@sigstore/tuf/seeds.json',{paths:[process.argv[4]]}))['https://tuf-repo-cdn.sigstore.dev'];
    const tuf=Metadata.fromJSON(MetadataKind.Root,JSON.parse(Buffer.from(seed['root.json'],'base64').toString('utf8')));tuf.verifyDelegate(MetadataKind.Root,tuf);results.tufRoot=true;
    process.stdout.write(JSON.stringify(results));`;
  const repository=path.resolve(__dirname,'..');
  const output=await new Promise((resolve,reject)=>execFile(ELECTRON,['-e',script,path.join(repository,'src','release-attestation.cjs'),path.join(__dirname,'fixtures','ravenshelf-0.4.1.sigstore.json'),JSON.stringify(RELEASE),repository],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error(`Electron check failed: ${error.message}\n${stderr}`)):resolve(stdout)));
  const results=JSON.parse(output);
  assert.match(results.electron,/^\d+\.\d+\.\d+/);assert.equal(results.genuine,true);assert.equal(results.changed,'TLOG_INCLUSION_PROMISE_ERROR');assert.equal(results.restored,true);assert.equal(results.tufRoot,true);
});
