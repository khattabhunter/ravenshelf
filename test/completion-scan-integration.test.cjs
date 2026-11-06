'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DownloadManager}=require('../src/downloads.cjs');
const {CompletionAction}=require('../src/completion-action.cjs');
const {assertCompletionReady}=require('../src/completion-policy.cjs');
const fixtureRoot=path.resolve(__dirname,'.completion-scan-fixtures');
fs.mkdirSync(fixtureRoot,{recursive:true});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){
  const deadline=Date.now()+4000;
  while(!predicate()){if(Date.now()>deadline)throw new Error('Timed out waiting for synthetic queue.');await new Promise(resolve=>setTimeout(resolve,5));}
}
function fixture(t){
  const folder=fs.mkdtempSync(path.join(fixtureRoot,'run-')),resolvers=[],managers=[];
  t.after(async()=>{
    for(const resolve of resolvers)resolve({status:'clean',message:'Fixture scan finished.'});
    await flush();
    for(const manager of managers)await manager.stop();
    assert.ok(path.resolve(folder).startsWith(fixtureRoot+path.sep));
    fs.rmSync(folder,{recursive:true,force:true});
  });
  return {resolvers,stateFile:path.join(folder,'state.json'),open(options={}){
    const manager=new DownloadManager({stateFile:path.join(folder,'state.json'),downloadDir:path.join(folder,'downloads'),
      fetcher:async()=>new Response('abc',{headers:{'content-type':'application/octet-stream','content-length':'3',etag:'"fixture"'}}),
      scanFile:()=>new Promise(resolve=>resolvers.push(resolve)),...options});
    managers.push(manager);return manager;
  }};
}
const links=['one','two'].map(name=>({status:'ready',url:`https://files.example.org/${name}`,filename:name+'.rar'}));

test('ordinary automatic close still completes when automatic scans are disabled',async t=>{
  const f=fixture(t),manager=f.open(),calls=[];let now=0;
  manager.updateSettings({defenderScan:false});
  const action=new CompletionAction({getDownloads:()=>manager.downloads,onExecute:(mode,{ids})=>{
    assertCompletionReady(manager.downloads,ids);calls.push(mode);
  },clock:()=>now,autoTick:false});
  t.after(()=>action.dispose());manager.on('state',()=>action.refresh());
  manager.add({gameTitle:'Synthetic unscanned queue',links});action.arm('close');
  await until(()=>manager.downloads.every(d=>d.status==='completed'));
  assert.equal(f.resolvers.length,0);assert.ok(manager.downloads.every(d=>d.scan===undefined));
  assert.equal(action.snapshot().remainingSeconds,60);
  now=59000;action.tick();await flush();assert.equal(calls.length,0);
  now=60000;action.tick();await flush();assert.deepEqual(calls,['close']);
});

test('real queue events keep completion blocked across serial scans and an ambiguous result',async t=>{
  const f=fixture(t),manager=f.open(),calls=[];let now=0;
  const action=new CompletionAction({getDownloads:()=>manager.downloads,onExecute:mode=>calls.push(mode),clock:()=>now,autoTick:false});
  t.after(()=>action.dispose());manager.on('state',()=>action.refresh());
  manager.add({gameTitle:'Synthetic queue',links});action.arm('shutdown');
  await until(()=>manager.downloads.every(d=>d.status==='completed')&&f.resolvers.length===1);
  now=120000;action.tick();await flush();assert.equal(calls.length,0);assert.equal(action.snapshot().phase,'armed');
  assert.deepEqual(manager.downloads.map(d=>d.scan.status).sort(),['queued','scanning']);
  f.resolvers[0]({status:'clean',message:'Fixture clean.'});await until(()=>f.resolvers.length===2);
  f.resolvers[1]({status:'review',message:'Fixture ambiguous result.'});await until(()=>manager.downloads.some(d=>d.scan.status==='review'));
  now+=120000;action.tick();await flush();assert.equal(calls.length,0);assert.match(action.snapshot().message,/blocked/);
  const review=manager.downloads.find(d=>d.scan.status==='review');manager.action(review.id,'scan');
  await until(()=>f.resolvers.length===3);f.resolvers[2]({status:'clean',message:'Fixture rescan clean.'});
  await until(()=>action.snapshot().phase==='countdown');assert.equal(action.snapshot().remainingSeconds,60);
  now+=60000;action.tick();await flush();assert.deepEqual(calls,['shutdown']);
});

test('manual stop stays responsive and persists active and queued scans for restart',async t=>{
  const f=fixture(t),manager=f.open();manager.add({gameTitle:'Synthetic queue',links});
  await until(()=>manager.downloads.every(d=>d.status==='completed')&&f.resolvers.length===1);
  let timeout;
  try{await Promise.race([manager.stop(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Manual close waited for the scan.')),1000);})]);}
  finally{clearTimeout(timeout);}
  const saved=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));
  assert.deepEqual(saved.downloads.map(d=>d.scan.status).sort(),['queued','scanning']);
  // The active process may finish, but stopping must not launch another scan.
  f.resolvers[0]({status:'clean',message:'Fixture scan finished.'});await flush();await flush();assert.equal(f.resolvers.length,1);
  const restarted=f.open({scanFile:async()=>({status:'clean',message:'Fixture restarted scan.'})});
  await until(()=>restarted.downloads.every(d=>d.scan.status==='clean'));
});
