'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {runPowerShell,scanEnvironment,scanWarning}=require('../src/installed-games.cjs')._test;

function fakeProcess(finish){
  const calls=[];let killed=0;
  const spawn=(exe,args,options)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{killed++;return true;};
    let input='';child.stdin.on('data',chunk=>{input+=chunk;});child.stdin.on('end',()=>{calls.push({exe,args,options,input});queueMicrotask(()=>finish(child));});
    return child;
  };
  return {spawn,calls,get killed(){return killed;}};
}
test('game inventory launches only the fixed Windows script with trusted module lookup and JSON input',async()=>{
  const fake=fakeProcess(child=>{child.stdout.write('{"steamRoots":[],"uninstall":[],"gog":[]}');child.emit('close',0);});
  const source='Get-ItemProperty -LiteralPath HKCU:\\Software';
  const env={SystemRoot:'C:\\Windows',Path:'C:\\Tools',PSModulePath:'C:\\User modules',psmodulepath:'C:\\Other modules',pSmOdUlEpAtH:'C:\\Third modules',KEEP:'value'};
  const result=await runPowerShell({action:'discover'},{spawnImpl:fake.spawn,readFile:()=>source,env,systemRoot:'C:\\Windows'});
  assert.deepEqual(result,{steamRoots:[],uninstall:[],gog:[]});assert.equal(fake.calls.length,1);
  const call=fake.calls[0],home='C:\\Windows\\System32\\WindowsPowerShell\\v1.0';
  assert.equal(call.exe,home+'\\powershell.exe');assert.deepEqual(call.args.slice(0,-1),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);assert.equal(Buffer.from(call.args.at(-1),'base64').toString('utf16le'),source);
  assert.equal(call.options.windowsHide,true);assert.equal(call.options.shell,undefined);assert.deepEqual(call.options.stdio,['pipe','pipe','ignore']);
  assert.deepEqual(call.options.env,{SystemRoot:'C:\\Windows',Path:'C:\\Tools',KEEP:'value',PSModulePath:home+'\\Modules'});assert.deepEqual(JSON.parse(call.input),{action:'discover'});assert.equal(env.psmodulepath,'C:\\Other modules');
});
test('executable paths remain data on stdin and never become PowerShell command text',async()=>{
  const file=path.resolve(__dirname,'fixtures','Game $(No-Such-Command); quote \' test.exe'),request={action:'versions',paths:[file]};
  const fake=fakeProcess(child=>{child.stdout.write(JSON.stringify({path:file,fileVersion:'1.2.3'})+'\nnot-json\n');child.emit('close',0);});
  const result=await runPowerShell(request,{spawnImpl:fake.spawn,readFile:()=>'$request = [Console]::In.ReadToEnd()',systemRoot:'relative',env:{}});
  assert.equal(fake.calls[0].exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.deepEqual(JSON.parse(fake.calls[0].input),request);assert.ok(!fake.calls[0].args.join(' ').includes('No-Such-Command'));assert.deepEqual(result,{items:[{path:file,fileVersion:'1.2.3'}],timedOut:false});
});
test('invalid requests never launch a process',async()=>{
  let launches=0;const options={spawnImpl:()=>{launches++;throw new Error('Must not launch');},readFile:()=>''};
  for(const request of [null,[],{}, {action:'invoke'}, {action:'discover',paths:[]}, {action:'versions',paths:['relative.exe']}, {action:'versions',paths:[path.resolve('setup.ps1')]}, {action:'versions',paths:Array(501).fill(path.resolve('game.exe'))}, {action:'discover',command:'anything'}])await assert.rejects(runPowerShell(request,options),/metadata response was invalid/);
  assert.equal(launches,0);
});
test('timeouts stop the inspection and retain only complete version records',async()=>{
  const versions=fakeProcess(child=>{child.stdout.write('{"path":"fixture","fileVersion":"2"}\n{"unfinished":');});
  assert.deepEqual(await runPowerShell({action:'versions',paths:[]},{spawnImpl:versions.spawn,readFile:()=>'',timeoutMs:5}),{items:[{path:'fixture',fileVersion:'2'}],timedOut:true});assert.equal(versions.killed,1);
  const discovery=fakeProcess(()=>{});await assert.rejects(runPowerShell({action:'discover'},{spawnImpl:discovery.spawn,readFile:()=>'',timeoutMs:5}),/timed out/);assert.equal(discovery.killed,1);
});
test('oversized output and stream failure stop inspection without exposing host errors',async()=>{
  for(const send of [child=>child.stdout.write('x'.repeat(6*1024*1024+1)),child=>child.stdout.emit('error',new Error('C:\\Private\\secret'))]){
    const fake=fakeProcess(send);await assert.rejects(runPowerShell({action:'discover'},{spawnImpl:fake.spawn,readFile:()=>''}),error=>{assert.doesNotMatch(error.message,/Private|secret/);return true;});assert.equal(fake.killed,1);
  }
  assert.equal(scanWarning(new Error('C:\\Private\\secret')),'Windows game records could not be read. Choose Scan games to try again.');
  assert.deepEqual(scanEnvironment({psmodulepath:'private',PSMODULEPATH:'private',keep:'ok'},'system'),{keep:'ok',PSModulePath:'system'});
});
