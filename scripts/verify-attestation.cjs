'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {openDownloadFile}=require('../src/download-file.cjs');
const REPOSITORY='khattabhunter/ravenshelf';
const PREDICATE='https://slsa.dev/provenance/v1';
const WORKFLOWS=new Set(['.github/workflows/publish-release.yml','.github/workflows/build-windows.yml']);
const MAX_OUTPUT=4*1024*1024,TIMEOUT_MS=120000,MAX_RECORD=1024*1024;

const localPath=value=>{const resolved=path.resolve(value);return /^[\\/]{2}/.test(resolved)||resolved.slice(path.parse(resolved).root.length).includes(':')?null:resolved;};
function validate({artifact,commit,workflow,exportPath}={}){
  if(typeof artifact!=='string'||!artifact||artifact.length>4096||/[\x00-\x1f\x7f]/.test(artifact)||!artifact.toLowerCase().endsWith('.exe'))throw new Error('Choose a local Windows artifact for attestation verification.');
  if(typeof commit!=='string'||!/^[a-f0-9]{40}$/.test(commit))throw new Error('Attestation verification requires the exact reviewed commit SHA.');
  if(!WORKFLOWS.has(workflow))throw new Error('Attestation verification requires an approved build workflow.');
  const resolved=localPath(artifact);
  if(!resolved)throw new Error('Choose a local Windows artifact for attestation verification.');
  const result={artifact:resolved,commit,workflow};
  if(exportPath!==undefined){
    // The verified bundle is written to a new local .sigstore.json file only.
    const target=typeof exportPath==='string'&&exportPath.length<=4096&&!/[\x00-\x1f\x7f]/.test(exportPath)&&exportPath.endsWith('.sigstore.json')?localPath(exportPath):null;
    if(!target)throw new Error('Choose a new local .sigstore.json file for the verified build record.');
    result.exportPath=target;
  }
  return result;
}
function parseArgs(args){
  if(!Array.isArray(args)||![6,8].includes(args.length))throw new Error('Supply --artifact, --commit and --workflow exactly once, and optionally --export.');
  const values={},names={'--artifact':'artifact','--commit':'commit','--workflow':'workflow','--export':'exportPath'};
  for(let i=0;i<args.length;i+=2){
    const name=names[args[i]];if(!name||Object.hasOwn(values,name))throw new Error('Supply --artifact, --commit and --workflow exactly once, and optionally --export.');
    values[name]=args[i+1];
  }
  if(['artifact','commit','workflow'].some(name=>!Object.hasOwn(values,name)))throw new Error('Supply --artifact, --commit and --workflow exactly once, and optionally --export.');
  return validate(values);
}
function verifiedResults(output){
  if(typeof output!=='string'||Buffer.byteLength(output)>MAX_OUTPUT)throw new Error('GitHub CLI returned an invalid verification result.');
  let results;try{results=JSON.parse(output);}catch{throw new Error('GitHub CLI returned an invalid verification result.');}
  if(!Array.isArray(results)||!results.length||results.length>30||results.some(result=>{
    const verified=result?.verificationResult,certificate=verified?.signature?.certificate;
    return !certificate||typeof certificate!=='object'||Array.isArray(certificate)||!Array.isArray(verified.verifiedTimestamps)||!verified.verifiedTimestamps.length||verified.statement?.predicateType!==PREDICATE;
  }))throw new Error('GitHub CLI did not return verified provenance attestations.');
  return results;
}
// The first verified attestation's Sigstore bundle, exactly as GitHub CLI
// verified it. Releases publish it so the in-app updater can check it again.
function verifiedBundle(results){
  const bundle=results.map(result=>result?.attestation?.bundle).find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.mediaType==='string'&&value.mediaType.startsWith('application/vnd.dev.sigstore.bundle')&&value.dsseEnvelope&&typeof value.dsseEnvelope==='object');
  if(!bundle)throw new Error('GitHub CLI did not return the verified build record.');
  const text=JSON.stringify(bundle);
  if(Buffer.byteLength(text)>MAX_RECORD)throw new Error('GitHub CLI did not return the verified build record.');
  return text;
}
async function verifyAttestation(options,{runner=execFileSync}={}){
  const {artifact,commit,workflow,exportPath}=validate(options);
  let opened;
  try{
    opened=await openDownloadFile(artifact,{readOnly:true});
    if(opened.size<64||opened.size>512*1024*1024)throw new Error('Unexpected Windows artifact size.');
    // Use the CLI's cryptographic checks, including its signed certificate
    // identity claims. Parsing an unverified provenance payload is not proof.
    // Flags: https://cli.github.com/manual/gh_attestation_verify
    const args=['attestation','verify',artifact,
      '--hostname','github.com','--repo',REPOSITORY,
      '--signer-workflow',`github.com/${REPOSITORY}/${workflow}`,
      '--source-digest',commit,'--signer-digest',commit,
      '--predicate-type',PREDICATE,'--cert-oidc-issuer','https://token.actions.githubusercontent.com',
      '--deny-self-hosted-runners','--digest-alg','sha256','--limit','30','--format','json'];
    const env={...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1',NO_COLOR:'1'};
    delete env.GH_DEBUG;delete env.GH_FORCE_TTY;
    let output;
    try{output=runner('gh',args,{shell:false,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:TIMEOUT_MS,maxBuffer:MAX_OUTPUT,env});}
    catch{throw new Error('Cryptographic artifact attestation verification failed. Publication must stop.');}
    const results=verifiedResults(output),record=exportPath?verifiedBundle(results):null;
    await opened.verifyUnchanged();
    if(record!==null){
      try{fs.writeFileSync(exportPath,record,{flag:'wx',mode:0o644});}
      catch{throw new Error('The verified build record could not be saved to a new file.');}
    }
    return {verified:true,repository:REPOSITORY,workflow,sourceCommit:commit,attestations:results.length,...(record!==null?{exported:path.basename(exportPath)}:{})};
  }catch(error){
    // Never print raw CLI stderr, credentials, signed URLs or local paths.
    if(error?.message?.startsWith('Cryptographic artifact')||error?.message?.startsWith('GitHub CLI')||error?.message?.startsWith('The verified build record'))throw error;
    throw new Error('The local artifact could not be checked unchanged for attestation verification.');
  }finally{await opened?.handle.close();}
}
if(require.main===module){
  Promise.resolve().then(()=>verifyAttestation(parseArgs(process.argv.slice(2))))
    .then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={verifyAttestation,parseArgs,REPOSITORY,PREDICATE,MAX_OUTPUT,TIMEOUT_MS};
