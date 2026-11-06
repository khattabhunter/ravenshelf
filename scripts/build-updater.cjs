'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32'){console.log('Native Windows updater build skipped on this platform.');process.exit(0);}
const root=path.resolve(__dirname,'..'),source=path.join(root,'src','updater-helper.cs'),output=path.join(root,'src','ravenshelf-updater.exe'),manifestFile=path.join(root,'src','updater-build.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const windows=process.env.SystemRoot||'C:\\Windows';
const candidates=['Framework64','Framework'].map(folder=>path.join(windows,'Microsoft.NET',folder,'v4.0.30319','csc.exe'));
const compiler=candidates.find(file=>{try{return fs.statSync(file).isFile();}catch{return false;}});
if(!compiler)throw new Error('The Windows .NET Framework compiler is required to build the updater.');
const temporaryDirectory=path.join(root,'src','.updater-build-'+crypto.randomUUID());fs.mkdirSync(temporaryDirectory);
const temporary=path.join(temporaryDirectory,'ravenshelf-updater.exe'),temporaryManifest=manifestFile+'.'+crypto.randomUUID()+'.tmp';
const sourceSha256=hash(fs.readFileSync(source)),compilerSha256=hash(fs.readFileSync(compiler));
const options=['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Web.Extensions.dll'];
try{
  execFileSync(compiler,[...options,'/out:'+temporary,source],{windowsHide:true,stdio:'pipe',maxBuffer:1024*1024});
  if(hash(fs.readFileSync(source))!==sourceSha256||hash(fs.readFileSync(compiler))!==compilerSha256)throw new Error('Updater build inputs changed.');
  const bytes=fs.readFileSync(temporary);
  const manifest={schemaVersion:1,source:{name:'updater-helper.cs',sha256:sourceSha256},buildScriptSha256:hash(fs.readFileSync(__filename)),compiler:{name:'csc.exe',relativePath:path.relative(windows,compiler).replaceAll('\\','/'),sha256:compilerSha256},options,output:{name:'ravenshelf-updater.exe',size:bytes.length,sha256:hash(bytes)}};
  fs.writeFileSync(temporaryManifest,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(temporary,output);
  fs.renameSync(temporaryManifest,manifestFile);
  console.log('Built native Windows updater helper.');
}catch(error){
  if(error.stdout)process.stderr.write(error.stdout);
  if(error.stderr)process.stderr.write(error.stderr);
  throw new Error('The native Windows updater helper could not be built.');
}finally{
  for(const file of [temporary,temporaryManifest])try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  fs.rmdirSync(temporaryDirectory);
}
