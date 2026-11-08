'use strict';
// Release gate for the in-app updater. Checks the build record exported by
// verify-attestation.cjs with the same verifier the installed app uses, against
// both Sigstore's current TUF-signed trusted root and the root bundled with the
// app, so a release that installed copies would refuse is never published.
// With --runtime electron it also repeats the check inside the Electron runtime
// the app ships with, whose BoringSSL differs from Node's OpenSSL.
// On success it writes GitHub Actions step outputs (to --output, or stdout):
// the record's SHA-256 and the record itself in base64 for the publishing job.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {hashOpen}=require('../src/app-updater.cjs');
const {verifyRecord,parseRecord,embeddedTrustedRoot,TUF_MIRROR}=require('../src/release-attestation.cjs');
// The record reaches the publishing job through an environment variable; its
// base64 form must stay well under Windows' 32,767-character limit.
const MAX_HANDOFF_BYTES=22*1024;
const USAGE='Supply --artifact and --record exactly once, and optionally --output and --runtime.';

function parseArgs(args){
  if(!Array.isArray(args)||![4,6,8].includes(args.length))throw new Error(USAGE);
  const values={},names={'--artifact':'artifact','--record':'record','--output':'output','--runtime':'runtime'};
  for(let i=0;i<args.length;i+=2){
    const name=names[args[i]],value=args[i+1];
    if(!name||Object.hasOwn(values,name)||typeof value!=='string'||!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value))throw new Error(USAGE);
    values[name]=value;
  }
  if(!values.artifact||!values.record)throw new Error(USAGE);
  const name=path.basename(values.artifact);
  if(!/^Ravenshelf-\d+\.\d+\.\d+-Windows\.exe$/.test(name))throw new Error('The artifact must be a Ravenshelf Windows release executable.');
  if(!values.record.endsWith('.sigstore.json'))throw new Error('The build record must be a .sigstore.json file.');
  // GitHub Actions supplies an absolute path to its step-output file.
  if(values.output!==undefined&&!path.isAbsolute(values.output))throw new Error('The output file must be an absolute path.');
  if(values.runtime!==undefined&&values.runtime!=='electron')throw new Error('The only additional runtime is electron.');
  return {artifact:path.resolve(values.artifact),record:path.resolve(values.record),name,...(values.output!==undefined?{output:values.output}:{}),...(values.runtime?{runtime:values.runtime}:{})};
}
// The development Electron binary installed by npm ci (same version as the app).
function electronBinary(root=path.resolve(__dirname,'..')){
  let binary=null;
  try{const folder=path.join(root,'node_modules','electron');binary=path.join(folder,'dist',fs.readFileSync(path.join(folder,'path.txt'),'utf8').trim());}catch{}
  if(!binary||!fs.existsSync(binary))throw new Error('The Electron runtime is not installed. Run npm ci with install scripts.');
  return binary;
}
const ELECTRON_CHECK=`const fs=require('fs'),{verifyRecord,embeddedTrustedRoot,parseRecord}=require(process.argv[1]);
verifyRecord(parseRecord(fs.readFileSync(process.argv[2],'utf8')),{name:process.argv[3],sha256:process.argv[4]},embeddedTrustedRoot());
process.stdout.write('verified:'+process.versions.electron);`;
async function verifyInElectron({record,release},{binary=electronBinary(),run=execFile}={}){
  const stdout=await new Promise((resolve,reject)=>run(binary,['-e',ELECTRON_CHECK,path.join(__dirname,'..','src','release-attestation.cjs'),record,release.name,release.sha256],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:120000,maxBuffer:65536},(error,output)=>error?reject(new Error('The Electron runtime did not verify the build record.')):resolve(String(output))));
  const match=/^verified:(\d+\.\d+\.\d+)$/.exec(stdout);
  if(!match)throw new Error('The Electron runtime did not verify the build record.');
  return match[1];
}
const outputLines=result=>`record-sha256=${result.recordSha256}\nrecord=${result.recordBase64}\n`;
async function readRecord(file){
  const handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const buffer=Buffer.alloc(MAX_HANDOFF_BYTES+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(!bytesRead)throw new Error('The build record is empty.');
    if(bytesRead>MAX_HANDOFF_BYTES)throw new Error('The build record is too large to hand to the publishing job.');
    return buffer.subarray(0,bytesRead);
  }finally{await handle.close();}
}
async function currentTrustedRoot(){
  const cache=await fs.promises.mkdtemp(path.join(os.tmpdir(),'ravenshelf-tuf-'));
  try{return await require('@sigstore/tuf').getTrustedRoot({cachePath:cache,mirrorURL:TUF_MIRROR,retry:{retries:2},timeout:15000});}
  finally{await fs.promises.rm(cache,{recursive:true,force:true});}
}
async function verifyUpdateRecord({artifact,record,name,runtime},{loadCurrentRoot=currentTrustedRoot,hashArtifact=hashOpen,electron=verifyInElectron}={}){
  const {sha256}=await hashArtifact(artifact);
  const bytes=await readRecord(record),parsed=parseRecord(bytes.toString('utf8')),release={name,sha256};
  // The bundled root is what installed copies fall back to when Sigstore's
  // TUF service is unreachable; it must accept the record.
  verifyRecord(parsed,release,embeddedTrustedRoot());
  let current=null,warning='';
  try{current=await loadCurrentRoot();}catch{warning='Sigstore’s TUF service could not be reached; the record was verified with the bundled trusted root only.';}
  if(current)verifyRecord(parsed,release,current);
  const electronVersion=runtime==='electron'?await electron({record,release}):'';
  return {release,currentRoot:Boolean(current),electronVersion,warning,recordSha256:crypto.createHash('sha256').update(bytes).digest('hex'),recordBase64:bytes.toString('base64')};
}

if(require.main===module){
  // Stays failed unless verification completes.
  process.exitCode=1;
  Promise.resolve().then(async()=>{
    const options=parseArgs(process.argv.slice(2)),result=await verifyUpdateRecord(options);
    if(result.warning)process.stdout.write(`::warning::${result.warning}\n`);
    // Written byte for byte; a shell redirect could re-encode or wrap lines.
    if(options.output)fs.appendFileSync(options.output,outputLines(result),{encoding:'utf8'});else process.stdout.write(outputLines(result));
    process.stdout.write(`The in-app updater verified the build record for ${result.release.name} with the ${result.currentRoot?'current and bundled':'bundled'} Sigstore trusted roots${result.electronVersion?`, and again in Electron ${result.electronVersion}`:''}.\n`);
    process.exitCode=0;
  }).catch(error=>{process.stderr.write(`${error?.message||'The build record could not be verified.'}\n`);process.exitCode=1;});
}
module.exports={verifyUpdateRecord,verifyInElectron,electronBinary,parseArgs,outputLines,MAX_HANDOFF_BYTES};
