'use strict';
// Verifies the signed build record that the release workflow publishes beside
// each Windows build. The record is a Sigstore bundle: a short-lived Fulcio
// certificate issued to GitHub Actions, a Rekor transparency-log entry, and a
// DSSE-signed SLSA provenance statement naming the exact executable digest.
// Every check fails closed. A repository rename, deletion and re-creation, a
// different workflow or branch, or a self-hosted runner stops in-app updates.
const fs=require('node:fs');
const path=require('node:path');
const nodeCrypto=require('node:crypto');

const REPOSITORY='khattabhunter/ravenshelf';
const TUF_MIRROR='https://tuf-repo-cdn.sigstore.dev';
const EXPECTED=Object.freeze({
  identity:`https://github.com/${REPOSITORY}/.github/workflows/publish-release.yml@refs/heads/main`,
  issuer:'https://token.actions.githubusercontent.com',
  // Fulcio certificate extensions 1.3.6.1.4.1.57264.1.N. GitHub's numeric
  // repository and owner IDs stay the same across renames, so a deleted and
  // re-created repository with the same name cannot sign updates.
  claims:Object.freeze({11:'github-hosted',12:`https://github.com/${REPOSITORY}`,14:'refs/heads/main',15:'1448364041',17:'76850671'})
});
const PAYLOAD_TYPE='application/vnd.in-toto+json',STATEMENT_TYPE='https://in-toto.io/Statement/v1',PROVENANCE='https://slsa.dev/provenance/v1';
const MAX_RECORD_BYTES=1024*1024,REFRESH_TIMEOUT_MS=30000;
const failure=()=>new Error('The signed build record could not be verified.');

function recordName(executableName){return executableName+'.sigstore.json';}
function validRelease(release){return Boolean(release&&typeof release.name==='string'&&/^Ravenshelf-\d+\.\d+\.\d+-Windows\.exe$/.test(release.name)&&typeof release.sha256==='string'&&/^[a-f0-9]{64}$/.test(release.sha256));}
function parseRecord(text){
  if(typeof text!=='string'||!text||Buffer.byteLength(text)>MAX_RECORD_BYTES)throw failure();
  let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw failure();}
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure();
  return value;
}
// Fulcio stores each claim as a DER UTF8String inside the extension value.
function utf8String(value){
  const bytes=Buffer.from(String(value),'utf8');
  if(!bytes.length||bytes.length>127)throw new Error('Unsupported certificate claim.');
  return Buffer.concat([Buffer.from([0x0c,bytes.length]),bytes]);
}
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function policyFor(expected){
  return {
    // @sigstore/verify treats a string as an unanchored pattern; anchor it.
    subjectAlternativeName:new RegExp(`^${escapePattern(expected.identity)}$`),
    extensions:{issuer:expected.issuer},
    oids:Object.entries(expected.claims).map(([suffix,value])=>({oid:{id:[1,3,6,1,4,1,57264,1,Number(suffix)]},value:utf8String(value)}))
  };
}

let embedded=null;
function embeddedTrustedRoot(){
  if(!embedded){
    const {TrustedRoot}=require('@sigstore/protobuf-specs');
    const seed=require('@sigstore/tuf/seeds.json')[TUF_MIRROR];
    embedded=TrustedRoot.fromJSON(JSON.parse(Buffer.from(seed.targets['trusted_root.json'],'base64').toString('utf8')));
  }
  return embedded;
}
// A partly written root.json cannot be parsed and would block every refresh.
// Re-seeding from the bundled TUF root repairs it; the refresh then walks the
// signed root chain forward again.
function damagedCache(cachePath){
  try{JSON.parse(fs.readFileSync(path.join(cachePath,encodeURIComponent(new URL(TUF_MIRROR).host),'root.json'),'utf8'));return false;}
  catch(error){return error?.code!=='ENOENT';}
}
let refreshing=null;
function refreshTrustedRoot(cachePath){
  // One refresh at a time: concurrent TUF clients would write the same cache.
  if(!refreshing)refreshing=Promise.resolve().then(()=>require('@sigstore/tuf').getTrustedRoot({cachePath,mirrorURL:TUF_MIRROR,retry:false,timeout:10000,forceInit:damagedCache(cachePath)})).finally(()=>{refreshing=null;});
  return refreshing;
}
// Prefer Sigstore's current TUF-signed trusted root so key rotations keep
// working. If the TUF CDN is unreachable, fall back to the root bundled with
// the app. A root that refreshed successfully is never replaced by the older
// bundled root after a failed verification.
async function loadTrustedRoot({cachePath,signal,timeoutMs=REFRESH_TIMEOUT_MS,refresh=refreshTrustedRoot}={}){
  signal?.throwIfAborted();
  if(typeof cachePath==='string'&&path.isAbsolute(cachePath)){
    let timer,onAbort;
    try{
      return await Promise.race([Promise.resolve().then(()=>refresh(cachePath)),new Promise((resolve,reject)=>{
        // Deliberately not unref'd: the timer is always cleared below, and a
        // command-line check must not exit early while a refresh is pending.
        timer=setTimeout(()=>reject(new Error('Trusted root refresh timed out.')),timeoutMs);
        if(signal){onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}
      })]);
    }catch{signal?.throwIfAborted();}
    finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
  }
  return embeddedTrustedRoot();
}

// sigstore-js checks DSSE signatures, Rekor signed entry timestamps and
// checkpoints with crypto.verify(null, ...). Node's OpenSSL then uses the key's
// default digest, SHA-256 for EC and RSA keys. Electron's BoringSSL has no
// default digest and rejects those calls, so every genuine record would fail in
// the packaged app. While the synchronous verification runs, supply the same
// SHA-256 default; Ed25519 keys keep the required null digest. Results under
// OpenSSL are unchanged.
function withOpenSSLDefaultDigest(run){
  const original=nodeCrypto.verify;
  nodeCrypto.verify=function(algorithm,data,key,signature,callback){
    if(algorithm==null&&(key instanceof nodeCrypto.KeyObject)&&['ec','rsa'].includes(key.asymmetricKeyType))algorithm='sha256';
    return original.call(this,algorithm,data,key,signature,callback);
  };
  try{return run();}finally{nodeCrypto.verify=original;}
}

// Synchronous cryptographic and policy checks for one parsed bundle.
function verifyRecord(record,release,trustedRoot,expected=EXPECTED){
  if(!validRelease(release)||!record||typeof record!=='object'||Array.isArray(record))throw failure();
  const {bundleFromJSON}=require('@sigstore/bundle');
  const {toSignedEntity,toTrustMaterial,Verifier}=require('@sigstore/verify');
  const bundle=bundleFromJSON(record);
  const envelope=bundle.content?.$case==='dsseEnvelope'?bundle.content.dsseEnvelope:null;
  if(!envelope||envelope.payloadType!==PAYLOAD_TYPE)throw new Error('The build record does not contain a signed provenance statement.');
  // Verifies the certificate chain and its embedded CT log proof, the Rekor
  // inclusion proof and signed entry time, the DSSE signature over the
  // statement, and the pinned certificate identity and claims.
  const signer=withOpenSSLDefaultDigest(()=>new Verifier(toTrustMaterial(trustedRoot)).verify(toSignedEntity(bundle),policyFor(expected)));
  if(signer?.identity?.subjectAlternativeName!==expected.identity||signer.identity.extensions?.issuer!==expected.issuer)throw new Error('The build record was signed by an unexpected workflow.');
  let statement;try{statement=JSON.parse(Buffer.from(envelope.payload).toString('utf8'));}catch{throw new Error('The signed provenance statement is invalid.');}
  return checkStatement(statement,release);
}
// The signed statement must be SLSA provenance naming this exact file.
function checkStatement(statement,release){
  if(!validRelease(release)||!statement||typeof statement!=='object'||statement._type!==STATEMENT_TYPE||statement.predicateType!==PROVENANCE)throw new Error('The build record is not SLSA build provenance.');
  const subjects=Array.isArray(statement.subject)?statement.subject:[];
  if(!subjects.some(subject=>subject&&subject.name===release.name&&subject.digest&&subject.digest.sha256===release.sha256))throw new Error('The build record names a different file.');
  return true;
}

async function verifyReleaseBuild({release,recordText,cachePath,signal,loadRoot=loadTrustedRoot}={}){
  if(!validRelease(release))throw failure();
  const record=parseRecord(recordText);
  const trustedRoot=await loadRoot({cachePath,signal});signal?.throwIfAborted();
  try{verifyRecord(record,release,trustedRoot);}catch{throw failure();}
  return true;
}

module.exports={verifyReleaseBuild,verifyRecord,checkStatement,loadTrustedRoot,embeddedTrustedRoot,damagedCache,withOpenSSLDefaultDigest,parseRecord,recordName,policyFor,utf8String,EXPECTED,MAX_RECORD_BYTES,TUF_MIRROR};
