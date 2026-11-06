'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {spawn}=require('node:child_process');
const {AppUpdater,selectRelease,newer,trustedFetch,RELEASES}=require('../src/app-updater.cjs');
const {BandwidthLimiter}=require('../src/bandwidth-limiter.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(4094,42)]);
function release(v='0.4.1',payload=bytes){const tag='v'+v,name='Ravenshelf-'+v+'-Windows.exe',base='https://github.com/khattabhunter/ravenshelf/releases/download/'+tag+'/';return {tag_name:tag,published_at:'2026-11-06T00:00:00Z',draft:false,prerelease:true,assets:[{name,size:payload.length,digest:'sha256:'+hash(payload),browser_download_url:base+name},{name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt'}]};}
async function fixture(t,{payload=bytes,body=payload,checksum=hash(payload),bandwidthLimiter=null,now=Date.now}={}){
  const base=path.resolve(os.tmpdir()),root=await fs.promises.mkdtemp(path.join(base,'ravenshelf-update-test-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^ravenshelf-update-test-/);return fs.promises.rm(root,{recursive:true,force:true});});
  const profile=path.join(root,'profile');await fs.promises.mkdir(profile);await fs.promises.writeFile(path.join(profile,'library.json'),'fixture private settings');
  const executable=path.join(root,'Ravenshelf.exe'),old=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(1022,11)]);await fs.promises.writeFile(executable,old);
  const entry=release('0.4.1',payload),events=[];let calls=0;
  const updater=new AppUpdater({currentVersion:'0.4.0',profileDir:profile,executable,bandwidthLimiter,now,onChange:s=>events.push(s),fetcher:async url=>{calls++;if(url===RELEASES)return Response.json([entry]);if(url.endsWith('SHA256SUMS.txt'))return new Response(checksum+'  Ravenshelf-0.4.1-Windows.exe\n');return new Response(body,{headers:{'Content-Length':String(body.length)}});}});
  t.after(()=>updater.dispose());return {root,profile,executable,old,updater,events,get calls(){return calls;}};
}
test('numeric releases cannot downgrade, run arbitrary assets, or trust forged asset paths',()=>{
  assert.equal(newer('0.10.0','0.9.9'),true);assert.equal(newer('0.4.0','0.4.0'),false);assert.equal(newer('0.4.1-beta','0.4.0'),false);
  assert.equal(selectRelease([release('0.3.0')],'0.4.0'),null);
  const bad=release();bad.assets[0].browser_download_url='https://evil.example/update.exe';assert.equal(selectRelease([bad],'0.4.0'),null);
  const duplicate=release();duplicate.assets.push(duplicate.assets[0]);assert.equal(selectRelease([duplicate],'0.4.0'),null);
});
test('update redirects are limited to the expected GitHub/CDN hosts',async()=>{
  let called=0;await assert.rejects(trustedFetch(RELEASES,{fetcher:async()=>{called++;return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com.evil.example/a'}});}}),/Unexpected update destination/);assert.equal(called,1);
});
test('checking downloads and hashes exactly once; existing profile and executable stay untouched',async t=>{
  const f=await fixture(t);const [a,b]=await Promise.all([f.updater.check(),f.updater.check()]);assert.equal(a.phase,'ready');assert.equal(b.phase,'ready');assert.equal(f.calls,3);
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
  assert.ok(f.events.some(x=>x.phase==='downloading'));await f.updater.check();assert.equal(f.calls,3);
});
test('mismatched checksums and non-PE payloads cannot become installable',async t=>{
  for(const options of [{checksum:'a'.repeat(64)},{body:Buffer.alloc(4096,9)},{payload:Buffer.alloc(4096,8)}]){
    const f=await fixture(t,options);assert.equal((await f.updater.check()).phase,'error');assert.equal(await f.updater.prepareInstall(),null);assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  }
});
test('preparation makes an exclusive local job, backs up settings and rechecks staged bytes',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});const job=JSON.parse(await fs.promises.readFile(prepared.job));
  assert.equal(job.restart,false);assert.equal(job.target,f.executable);assert.equal(job.previousSha256,hash(f.old));assert.equal(job.sha256,hash(bytes));
  const backups=await fs.promises.readdir(path.join(f.profile,'updates/backups'));assert.equal(backups.length,1);assert.equal(await fs.promises.readFile(path.join(f.profile,'updates/backups',backups[0],'library.json'),'utf8'),'fixture private settings');
});
test('Windows helper atomically replaces only the fixture executable and preserves its profile', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  assert.equal(path.basename(prepared.helper),'ravenshelf-updater.exe');
  await execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000});
  assert.deepEqual(await fs.promises.readFile(f.executable),bytes);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
  assert.equal(JSON.parse((await fs.promises.readFile(path.join(path.dirname(prepared.job),'result.json'),'utf8')).replace(/^\uFEFF/,'')).success,true);
  const backups=(await fs.promises.readdir(f.root)).filter(x=>x.startsWith('.ravenshelf-rollback-'));assert.equal(backups.length,1);
  assert.deepEqual(await fs.promises.readFile(path.join(f.root,backups[0])),f.old,'the rollback copy retains the exact previous executable');
  assert.equal((await fs.promises.readdir(f.root)).some(x=>x.startsWith('.ravenshelf-update-')),false);
});

test('native updater accepts real Windows short-path aliases without losing directory or file checks',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const source=path.join(f.root,'short-paths.cs'),probe=path.join(f.root,'short-paths.exe');
  // Ask Windows for actual aliases; invented ~1 paths do not exercise .NET's
  // expansion. No short-name policy, filesystem setting, or TEMP override changes.
  await fs.promises.writeFile(source,'using System; using System.IO; using System.Text; using System.Runtime.InteropServices; using System.Web.Script.Serialization; class ShortPaths { [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetShortPathName(string value,StringBuilder result,uint capacity); static void Main(string[] args) { var result=new string[args.Length][]; for(int i=0;i<args.Length;i++){var buffer=new StringBuilder(32768); uint length=GetShortPathName(args[i],buffer,(uint)buffer.Capacity); if(length==0||length>=buffer.Capacity)throw new IOException("Fixture path alias unavailable."); string shortPath=buffer.ToString(); result[i]=new[]{shortPath,Path.GetFullPath(shortPath)};} Console.Write(new JavaScriptSerializer().Serialize(result)); } }');
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  await execFile(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+probe,source],{windowsHide:true,timeout:15000});
  const originals=[prepared.helper,prepared.job,f.executable,f.updater.ready.staged,path.dirname(prepared.job)];
  const aliases=JSON.parse((await execFile(probe,originals,{windowsHide:true,timeout:15000})).stdout);
  for(let i=0;i<originals.length;i++)assert.equal((await fs.promises.realpath(aliases[i][0])).toLowerCase(),(await fs.promises.realpath(originals[i])).toLowerCase());
  const expanded=aliases.filter(([shortPath,fullPath])=>shortPath.toLowerCase()!==fullPath.toLowerCase()).length;
  t.diagnostic(`Windows expanded ${expanded} of ${aliases.length} fixture paths; unchanged aliases are allowed on volumes without short names.`);
  const job=JSON.parse(await fs.promises.readFile(prepared.job));job.target=aliases[2][0];job.staged=aliases[3][0];job.result=aliases[4][0]+'\\result.json';
  await fs.promises.writeFile(prepared.job,JSON.stringify(job));
  await execFile(aliases[0][0],[aliases[1][0]],{windowsHide:true,timeout:15000});
  assert.deepEqual(await fs.promises.readFile(f.executable),bytes);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
  assert.equal(JSON.parse(await fs.promises.readFile(path.join(path.dirname(prepared.job),'result.json'),'utf8')).success,true);
  const backups=(await fs.promises.readdir(f.root)).filter(x=>x.startsWith('.ravenshelf-rollback-'));assert.equal(backups.length,1);assert.deepEqual(await fs.promises.readFile(path.join(f.root,backups[0])),f.old);
});

test('a modified bundled helper cannot be prepared for execution',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();
  const original=fs.promises.readFile,bundled=path.resolve(__dirname,'../src/ravenshelf-updater.exe');
  fs.promises.readFile=async function(file,...args){const result=await original.call(this,file,...args);if(path.resolve(String(file))===bundled){const changed=Buffer.from(result);changed[changed.length-1]^=1;return changed;}return result;};
  try{await assert.rejects(f.updater.prepareInstall(),/bundled updater helper changed/);}
  finally{fs.promises.readFile=original;}
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  assert.equal(fs.existsSync(path.join(f.updater.ready.directory,'job.json')),false);
});
test('Windows helper rejects a changed staged file without replacing the old app', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});await fs.promises.writeFile(f.updater.ready.staged,Buffer.alloc(bytes.length));
  await assert.rejects(execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000}));assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

for(const [label,change]of [
  ['a changed current executable hash',(job)=>{job.previousSha256='0'.repeat(64);}],
  ['an incorrect staged size',(job)=>{job.size++;}],
  ['an alternate data stream target',(job)=>{job.target+=':payload';}],
  ['a network-share target',(job)=>{job.target='\\\\localhost\\share\\Ravenshelf.exe';}],
  ['an escaping staged path',(job)=>{job.staged=path.join(path.dirname(job.staged),'..','update.exe');}],
  ['an escaping result path',(job)=>{job.result=path.join(path.dirname(job.result),'..','result.json');}],
  ['raw parent traversal even when it returns to the same target',(job)=>{job.target=path.dirname(job.target)+'\\profile\\..\\Ravenshelf.exe';}],
  ['a raw current-directory segment',(job)=>{job.target=path.dirname(job.target)+'\\.\\Ravenshelf.exe';}],
  ['a raw duplicate separator',(job)=>{job.target=path.dirname(job.target)+'\\\\Ravenshelf.exe';}],
  ['a trailing-dot filename',(job)=>{job.target+='.';}],
  ['a trailing-space filename',(job)=>{job.target+=' ';}],
  ['an unrelated executable name',(job)=>{job.target=job.target.replace('Ravenshelf.exe','Other.exe');}],
  ['a non-boolean restart request',(job)=>{job.restart='true';}],
])test(`native updater rejects ${label} without changing the app`,{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const job=JSON.parse(await fs.promises.readFile(prepared.job));change(job);await fs.promises.writeFile(prepared.job,JSON.stringify(job));
  await assert.rejects(execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000}));
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  const result=JSON.parse(await fs.promises.readFile(path.join(path.dirname(prepared.job),'result.json'),'utf8'));
  assert.equal(result.success,false);assert.doesNotMatch(result.message,/Users|https:|System\.|Exception|Stack/i);
});

for(const linked of ['target','staged','job'])test(`native updater refuses a hard-linked ${linked}`,{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const source=linked==='target'?f.executable:linked==='staged'?f.updater.ready.staged:prepared.job;
  const other=path.join(f.root,'hardlink-copy');const before=await fs.promises.readFile(source);await fs.promises.link(source,other);
  await assert.rejects(execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000}));
  assert.deepEqual(await fs.promises.readFile(other),before);assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

test('native updater refuses a junction in the target directory ancestry',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const alias=path.join(f.root,'junction'),ordinary=path.join(f.root,'ordinary-app');await fs.promises.mkdir(ordinary);await fs.promises.writeFile(path.join(ordinary,'Ravenshelf.exe'),f.old);await fs.promises.symlink(ordinary,alias,'junction');
  const job=JSON.parse(await fs.promises.readFile(prepared.job));job.target=path.join(alias,'Ravenshelf.exe');await fs.promises.writeFile(prepared.job,JSON.stringify(job));
  await assert.rejects(execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000}));
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  await fs.promises.unlink(alias);
});

test('native result output never overwrites an existing hard link',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const existing=path.join(f.root,'existing.txt');await fs.promises.writeFile(existing,'keep this file');
  await fs.promises.link(existing,path.join(path.dirname(prepared.job),'result.json'));
  await execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000});
  assert.deepEqual(await fs.promises.readFile(f.executable),bytes);assert.equal(await fs.promises.readFile(existing,'utf8'),'keep this file');
});

test('generated updater manifest binds current source and build script to the actual helper bytes',{skip:process.platform!=='win32'},async()=>{
  const source=path.resolve(__dirname,'../src'),manifestText=await fs.promises.readFile(path.join(source,'updater-build.json'),'utf8'),manifest=JSON.parse(manifestText);
  const helper=await fs.promises.readFile(path.join(source,'ravenshelf-updater.exe'));
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.source.name,'updater-helper.cs');
  assert.equal(manifest.source.sha256,hash(await fs.promises.readFile(path.join(source,'updater-helper.cs'))));
  assert.equal(manifest.buildScriptSha256,hash(await fs.promises.readFile(path.resolve(__dirname,'../scripts/build-updater.cjs'))));
  assert.equal(manifest.output.name,'ravenshelf-updater.exe');assert.equal(manifest.output.size,helper.length);assert.equal(manifest.output.sha256,hash(helper));
  assert.match(manifest.compiler.relativePath,/^Microsoft\.NET\/Framework(?:64)?\/v4\.0\.30319\/csc\.exe$/);
  assert.equal(manifest.compiler.sha256,hash(await fs.promises.readFile(path.join(process.env.SystemRoot||'C:\\Windows',manifest.compiler.relativePath))));
  assert.doesNotMatch(manifestText,/[A-Za-z]:[\\/]|[\\/]Users[\\/]|https?:/i);
});

test('native updater waits for a wrapper file lock without terminating the fixture process',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const prepared=await f.updater.prepareInstall({pid:2147483647});
  const source=path.join(f.root,'locker.cs'),locker=path.join(f.root,'locker.exe'),ready=path.join(f.root,'lock-ready.txt'),finished=path.join(f.root,'lock-finished.txt');
  await fs.promises.writeFile(source,'using System.IO; using System.Threading; class Locker { static void Main(string[] a) { using (var f=File.Open(a[0],FileMode.Open,FileAccess.Read,FileShare.Read)) { File.WriteAllText(a[1],"ready"); Thread.Sleep(1000); } File.WriteAllText(a[2],"finished"); } }');
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  await execFile(compiler,['/nologo','/target:winexe','/out:'+locker,source],{windowsHide:true,timeout:15000});
  const child=spawn(locker,[f.executable,ready,finished],{windowsHide:true,stdio:'ignore'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try{
    const deadline=Date.now()+5000;
    while(!fs.existsSync(ready)){if(Date.now()>deadline)throw new Error('Fixture lock did not start.');await new Promise(resolve=>setTimeout(resolve,10));}
    await execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000});
  }finally{const result=await exited;assert.equal(result.code,0);assert.equal(result.signal,null);}
  assert.equal(await fs.promises.readFile(finished,'utf8'),'finished');assert.deepEqual(await fs.promises.readFile(f.executable),bytes);
});

test('background updater charges every payload byte to the shared limiter and excludes budget waits from its watchdog',async t=>{
  let now=0,charged=0,releaseBudget;
  const bandwidthLimiter={consume:(count,{signal})=>{charged+=count;return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||new Error('Stopped'));signal.addEventListener('abort',abort,{once:true});releaseBudget=()=>{signal.removeEventListener('abort',abort);resolve();};});}};
  const f=await fixture(t,{bandwidthLimiter,now:()=>now}),checking=f.updater.check(),deadline=Date.now()+5000;
  while(!releaseBudget){if(Date.now()>deadline)throw new Error('Update did not reach the shared bandwidth budget.');await new Promise(resolve=>setTimeout(resolve,5));}
  now=120000;await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(f.updater.controller.signal.aborted,false,'an intentional wait is not a stalled host');
  releaseBudget();assert.equal((await checking).phase,'ready');assert.equal(charged,bytes.length);
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

test('disposing an update cancels its shared bandwidth wait without changing the app or profile',async t=>{
  const limiter=new BandwidthLimiter({bytesPerSecond:1});t.after(()=>limiter.stop());
  const f=await fixture(t,{bandwidthLimiter:limiter}),checking=f.updater.check(),deadline=Date.now()+5000;
  while(!limiter.pending){if(Date.now()>deadline)throw new Error('Update did not wait for bandwidth.');await new Promise(resolve=>setTimeout(resolve,5));}
  f.updater.dispose();assert.equal((await checking).phase,'error');assert.equal(limiter.pending,0);assert.equal(f.updater.ready,null);
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
  const pending=path.join(f.profile,'updates','pending');for(const directory of await fs.promises.readdir(pending))assert.equal(fs.existsSync(path.join(pending,directory,'update.exe')),false);
});

test('shutdown waits for staging cleanup and disposed updaters cannot start fresh work',async t=>{
  const limiter=new BandwidthLimiter({bytesPerSecond:1});t.after(()=>limiter.stop());
  const f=await fixture(t,{bandwidthLimiter:limiter}),checking=f.updater.check(),deadline=Date.now()+5000;
  while(!limiter.pending){if(Date.now()>deadline)throw new Error('Update did not wait for bandwidth.');await new Promise(resolve=>setTimeout(resolve,5));}
  const original=fs.promises.unlink;let releaseCleanup,cleanupReached=false,finished=false;
  fs.promises.unlink=async function(file,...args){if(String(file).startsWith(f.profile)&&path.basename(String(file))==='update.exe'){cleanupReached=true;await new Promise(resolve=>{releaseCleanup=resolve;});}return original.call(this,file,...args);};
  try{
    const stopping=f.updater.dispose().then(()=>{finished=true;});
    while(!cleanupReached){if(Date.now()>deadline)throw new Error('Update did not reach cleanup.');await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(finished,false,'shutdown remains pending until the partial file is removed');
    releaseCleanup();await stopping;assert.equal((await checking).phase,'error');
    const calls=f.calls;await f.updater.check();f.updater.configure(true);assert.equal(f.calls,calls);assert.equal(f.updater.timers.length,0);
    const pending=path.join(f.profile,'updates','pending');for(const directory of await fs.promises.readdir(pending))assert.equal(fs.existsSync(path.join(pending,directory,'update.exe')),false);
    assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  }finally{releaseCleanup?.();fs.promises.unlink=original;}
});

test('cancellation after metadata arrives cannot create a new staging directory',async t=>{
  const f=await fixture(t);let deliver;f.updater.fetcher=()=>new Promise(resolve=>{deliver=resolve;});
  const checking=f.updater.check(),stopping=f.updater.dispose();deliver(Response.json([release()]));
  assert.equal((await checking).phase,'error');await stopping;
  assert.equal(fs.existsSync(path.join(f.profile,'updates')),false);assert.equal(f.updater.ready,null);
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

test('an interrupted payload is removed and never becomes an installable update',async t=>{
  const f=await fixture(t);
  f.updater.fetcher=async url=>url===RELEASES?Response.json([release()]):url.endsWith('SHA256SUMS.txt')?new Response(hash(bytes)+'  Ravenshelf-0.4.1-Windows.exe\n'):new Response(bytes.subarray(0,128),{headers:{'Content-Length':String(bytes.length)}});
  assert.equal((await f.updater.check()).phase,'error');assert.equal(f.updater.ready,null);assert.equal(await f.updater.prepareInstall(),null);
  const pending=path.join(f.profile,'updates','pending');for(const directory of await fs.promises.readdir(pending))assert.equal(fs.existsSync(path.join(pending,directory,'update.exe')),false);
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
});

test('a partial job write is cleaned up so verified updates can be prepared again',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const directory=f.updater.ready.directory,original=fs.promises.open;let injected=false;
  fs.promises.open=async function(file,...args){const handle=await original.call(this,file,...args);if(path.basename(String(file))==='job.json'&&!injected){injected=true;handle.writeFile=async function(){await this.write(Buffer.from('{'));throw Object.assign(new Error('Fixture write failure'),{code:'EIO'});};}return handle;};
  try{await assert.rejects(f.updater.prepareInstall({pid:2147483647}),/Fixture write failure/);}finally{fs.promises.open=original;}
  assert.equal(injected,true);assert.equal(fs.existsSync(path.join(directory,'job.json')),false);assert.equal(fs.existsSync(path.join(directory,'ravenshelf-updater.exe')),false);
  assert.deepEqual(await fs.promises.readFile(f.updater.ready.staged),bytes);assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
  const prepared=await f.updater.prepareInstall({pid:2147483647});await execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000});
  assert.deepEqual(await fs.promises.readFile(f.executable),bytes);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
});

test('concurrent preparation creates one job and preserves all backed-up profile data',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),values=new Map([['library.json','fixture private settings'],['installed-games.json','fixture installed games'],['Local State','fixture encryption state'],['Preferences','fixture preferences'],['renderer-cache.json','fixture cache']]);
  for(const [name,value]of values)await fs.promises.writeFile(path.join(f.profile,name),value);
  await f.updater.check();const [first,second]=await Promise.all([f.updater.prepareInstall({pid:2147483647}),f.updater.prepareInstall({pid:2147483647})]);assert.deepEqual(first,second);
  const backups=await fs.promises.readdir(path.join(f.profile,'updates','backups'));assert.equal(backups.length,1);
  for(const [name,value]of values){assert.equal(await fs.promises.readFile(path.join(f.profile,name),'utf8'),value);assert.equal(await fs.promises.readFile(path.join(f.profile,'updates','backups',backups[0],name),'utf8'),value);}
  assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

test('preparation failure never removes an existing job file',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);await f.updater.check();const job=path.join(f.updater.ready.directory,'job.json');await fs.promises.writeFile(job,'existing fixture job');
  await assert.rejects(f.updater.prepareInstall({pid:2147483647}));
  assert.equal(await fs.promises.readFile(job,'utf8'),'existing fixture job');assert.equal(fs.existsSync(path.join(f.updater.ready.directory,'ravenshelf-updater.exe')),false);
  assert.deepEqual(await fs.promises.readFile(f.updater.ready.staged),bytes);assert.deepEqual(await fs.promises.readFile(f.executable),f.old);
});

test('native updater waits for the app to exit then restarts only its verified replacement',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const updatedSource=path.join(f.root,'restart-fixture.cs'),updated=path.join(f.root,'restart-fixture.exe');
  await fs.promises.writeFile(updatedSource,'using System.IO; class RestartFixture { static void Main(){File.WriteAllText(Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory,"restart-marker.txt"),"verified fixture restarted");} }');
  await execFile(compiler,['/nologo','/target:winexe','/out:'+updated,updatedSource],{windowsHide:true,timeout:15000});
  const payload=await fs.promises.readFile(updated);
  f.updater.fetcher=async url=>url===RELEASES?Response.json([release('0.4.1',payload)]):url.endsWith('SHA256SUMS.txt')?new Response(hash(payload)+'  Ravenshelf-0.4.1-Windows.exe\n'):new Response(payload,{headers:{'Content-Length':String(payload.length)}});
  assert.equal((await f.updater.check()).phase,'ready');
  const waiterSource=path.join(f.root,'wait-fixture.cs'),waiter=path.join(f.root,'wait-fixture.exe'),waiting=path.join(f.root,'waiting.txt'),releaseWait=path.join(f.root,'release.txt');
  await fs.promises.writeFile(waiterSource,'using System; using System.IO; using System.Threading; class WaitFixture { static void Main(string[] a){File.WriteAllText(a[0],"waiting"); DateTime deadline=DateTime.UtcNow.AddSeconds(10); while(!File.Exists(a[1])&&DateTime.UtcNow<deadline)Thread.Sleep(10);} }');
  await execFile(compiler,['/nologo','/target:winexe','/out:'+waiter,waiterSource],{windowsHide:true,timeout:15000});
  const child=spawn(waiter,[waiting,releaseWait],{windowsHide:true,stdio:'ignore'}),exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  try{
    const deadline=Date.now()+5000;while(!fs.existsSync(waiting)){if(Date.now()>deadline)throw new Error('Fixture app did not start.');await new Promise(resolve=>setTimeout(resolve,5));}
    const prepared=await f.updater.prepareInstall({pid:child.pid,restart:true}),running=execFile(prepared.helper,[prepared.job],{windowsHide:true,timeout:15000});
    await new Promise(resolve=>setTimeout(resolve,100));assert.deepEqual(await fs.promises.readFile(f.executable),f.old);assert.equal(fs.existsSync(path.join(f.root,'restart-marker.txt')),false);
    await fs.promises.writeFile(releaseWait,'finish');await running;assert.equal(await exited,0);
    while(!fs.existsSync(path.join(f.root,'restart-marker.txt'))){if(Date.now()>deadline)throw new Error('Verified fixture did not restart.');await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(await fs.promises.readFile(path.join(f.root,'restart-marker.txt'),'utf8'),'verified fixture restarted');
    assert.deepEqual(await fs.promises.readFile(f.executable),payload);assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
  }finally{await fs.promises.writeFile(releaseWait,'finish');await exited;}
});

test('native rollback restores a verified previous app and preserves externally changed targets or backups',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const source=path.join(f.root,'rollback-probe.cs'),probe=path.join(f.root,'rollback-probe.exe'),helper=path.resolve(__dirname,'../src/ravenshelf-updater.exe');
  // Invoke the shipped rollback routine in a disposable process. Fake MZ data
  // is only hashed/replaced; neither the old nor staged data is ever executed.
  await fs.promises.writeFile(source,'using System; using System.Reflection; class RollbackProbe { static void Main(string[] a){var type=Assembly.LoadFile(a[0]).GetType("RavenshelfUpdater"); var method=type.GetMethod("Restore",BindingFlags.NonPublic|BindingFlags.Static); Console.Write((bool)method.Invoke(null,new object[]{a[1],a[2],a[3],a[4]})?"restored":"preserved");} }');
  await execFile(compiler,['/nologo','/target:exe','/out:'+probe,source],{windowsHide:true,timeout:15000});
  for(const mode of ['valid','changed-target','changed-backup']){
    const backup=path.join(f.root,'rollback-'+mode+'.exe'),old=mode==='changed-backup'?Buffer.concat([Buffer.from('MZ'),Buffer.alloc(100,6)]):f.old;
    const current=mode==='changed-target'?Buffer.concat([Buffer.from('MZ'),Buffer.alloc(100,7)]):bytes;
    await fs.promises.writeFile(backup,old);await fs.promises.writeFile(f.executable,current);
    const result=await execFile(probe,[helper,backup,f.executable,hash(f.old),hash(bytes)],{windowsHide:true,timeout:15000});
    assert.equal(result.stdout,mode==='valid'?'restored':'preserved');assert.deepEqual(await fs.promises.readFile(f.executable),mode==='valid'?f.old:current);
    if(mode==='valid')assert.equal(fs.existsSync(backup),false);else assert.deepEqual(await fs.promises.readFile(backup),old);
  }
  assert.equal(await fs.promises.readFile(path.join(f.profile,'library.json'),'utf8'),'fixture private settings');
});
