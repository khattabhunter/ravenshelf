'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const asar=require('@electron/asar');
const {verifyFuses}=require('./verify-fuses.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const NATIVE_HELPERS=Object.freeze({
  updater:{label:'updater',source:'updater-helper.cs',output:'ravenshelf-updater.exe',record:'updater-build.json',script:'build-updater.cjs',options:['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Web.Extensions.dll']},
  browserHost:{label:'browser connector',source:'browser-host.cs',output:'ravenshelf-browser-host.exe',record:'browser-host-build.json',script:'build-browser-host.cjs',options:['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Core.dll','/reference:System.Web.Extensions.dll']}
});
function verifyNativeHelper(kind,{source,helper,manifest,buildScript}){
  const spec=NATIVE_HELPERS[kind];
  if(!spec)throw new Error('Unknown native helper.');
  if(manifest.schemaVersion!==1||manifest.source?.name!==spec.source||manifest.output?.name!==spec.output)throw new Error(`Invalid ${spec.label} build record.`);
  if(hash(source)!==manifest.source.sha256||hash(buildScript)!==manifest.buildScriptSha256)throw new Error(`The ${spec.label} build inputs do not match the reviewed source.`);
  if(helper.length!==manifest.output.size||hash(helper)!==manifest.output.sha256||helper[0]!==0x4d||helper[1]!==0x5a)throw new Error(`The packaged ${spec.label} does not match its build record.`);
  if(manifest.compiler?.name!=='csc.exe'||!/^Microsoft\.NET\/Framework(?:64)?\/v4\.0\.30319\/csc\.exe$/.test(manifest.compiler.relativePath)||!/^[a-f0-9]{64}$/.test(manifest.compiler.sha256))throw new Error(`Unexpected ${spec.label} compiler record.`);
  if(JSON.stringify(manifest.options)!==JSON.stringify(spec.options))throw new Error(`Unexpected ${spec.label} compiler options.`);
}
const verifyUpdater=input=>verifyNativeHelper('updater',input);
const verifyBrowserHost=input=>verifyNativeHelper('browserHost',input);
async function verifyPackage(directory=path.join(__dirname,'../dist/win-unpacked')){
  await verifyFuses(path.join(directory,'Ravenshelf.exe'));
  const archive=path.join(directory,'resources/app.asar');
  const read=name=>asar.extractFile(archive,path.normalize(name));
  const local=name=>fs.readFileSync(path.join(__dirname,'../src',name));
  for(const kind of Object.keys(NATIVE_HELPERS)){
    const spec=NATIVE_HELPERS[kind];
    const source=read('src/'+spec.source),manifest=JSON.parse(read('src/'+spec.record)),helper=read('src/'+spec.output);
    if(hash(source)!==hash(local(spec.source)))throw new Error(`The packaged ${spec.label} source is stale.`);
    verifyNativeHelper(kind,{source,manifest,helper,buildScript:fs.readFileSync(path.join(__dirname,spec.script))});
    if(hash(helper)!==hash(local(spec.output)))throw new Error(`The packaged ${spec.label} is stale.`);
  }
  // The browser extension the app exports must be exactly the reviewed files.
  const {EXTENSION_FILES}=require('../src/browser-setup.cjs');
  for(const name of EXTENSION_FILES){
    if(hash(read('src/browser-extension/'+name))!==hash(local('browser-extension/'+name)))throw new Error('The packaged browser extension is stale.');
  }
  console.log('Verified the packaged native helpers and browser extension against their build inputs and output hashes.');
}
if(require.main===module)verifyPackage(process.argv[2]?path.resolve(process.argv[2]):undefined).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyUpdater,verifyBrowserHost,verifyNativeHelper,verifyPackage,NATIVE_HELPERS};
