'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const asar=require('@electron/asar');
const {verifyFuses}=require('./verify-fuses.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function verifyUpdater({source,helper,manifest,buildScript}){
  if(manifest.schemaVersion!==1||manifest.source?.name!=='updater-helper.cs'||manifest.output?.name!=='ravenshelf-updater.exe')throw new Error('Invalid updater build record.');
  if(hash(source)!==manifest.source.sha256||hash(buildScript)!==manifest.buildScriptSha256)throw new Error('Updater build inputs do not match the reviewed source.');
  if(helper.length!==manifest.output.size||hash(helper)!==manifest.output.sha256||helper[0]!==0x4d||helper[1]!==0x5a)throw new Error('Packaged updater does not match its build record.');
  if(manifest.compiler?.name!=='csc.exe'||!/^Microsoft\.NET\/Framework(?:64)?\/v4\.0\.30319\/csc\.exe$/.test(manifest.compiler.relativePath)||!/^[a-f0-9]{64}$/.test(manifest.compiler.sha256))throw new Error('Unexpected updater compiler record.');
  if(JSON.stringify(manifest.options)!==JSON.stringify(['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Web.Extensions.dll']))throw new Error('Unexpected updater compiler options.');
}
async function verifyPackage(directory=path.join(__dirname,'../dist/win-unpacked')){
  await verifyFuses(path.join(directory,'Ravenshelf.exe'));
  const archive=path.join(directory,'resources/app.asar');
  const read=name=>asar.extractFile(archive,path.normalize(name));
  const source=read('src/updater-helper.cs'),manifest=JSON.parse(read('src/updater-build.json'));
  if(hash(source)!==hash(fs.readFileSync(path.join(__dirname,'../src/updater-helper.cs'))))throw new Error('Packaged updater source is stale.');
  verifyUpdater({source,manifest,helper:read('src/ravenshelf-updater.exe'),buildScript:fs.readFileSync(path.join(__dirname,'build-updater.cjs'))});
  if(hash(read('src/ravenshelf-updater.exe'))!==hash(fs.readFileSync(path.join(__dirname,'../src/ravenshelf-updater.exe'))))throw new Error('Packaged updater helper is stale.');
  console.log('Verified the packaged native updater against its build inputs and output hashes.');
}
if(require.main===module)verifyPackage(process.argv[2]?path.resolve(process.argv[2]):undefined).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyUpdater,verifyPackage};
