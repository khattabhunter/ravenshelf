'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DownloadManager}=require('../src/downloads.cjs');

// What the network library throws when a connection drops: "fetch failed" with the reason as its cause.
const dropped=code=>Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error('connection to hidden.example failed'),{code})});
const file=body=>new Response(body,{headers:{'content-length':String(Buffer.byteLength(body))}});

async function fixture(t,respond){
  const base=path.resolve(os.tmpdir()),root=await fs.promises.mkdtemp(path.join(base,'ravenshelf-retry-')),downloadDir=path.join(root,'downloads');
  await fs.promises.mkdir(downloadDir,{recursive:true});
  const stateFile=path.join(root,'state.json');
  await fs.promises.writeFile(stateFile,JSON.stringify({settings:{downloadDir,connectionsPerFile:1,defenderScan:false},downloads:[]}));
  let clock=Date.parse('2026-11-08T12:00:00Z');const requests=[];
  const manager=new DownloadManager({stateFile,downloadDir,now:()=>clock,fetcher:async(url,options)=>{requests.push(options.headers);return respond(requests.length);}});
  t.after(async()=>{await manager.stop();assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^ravenshelf-retry-/);await fs.promises.rm(root,{recursive:true,force:true});});
  const settle=async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    const deadline=Date.now()+5000;
    while(manager.running.size){if(Date.now()>deadline)throw new Error('The transfer did not settle.');await new Promise(resolve=>setTimeout(resolve,5));}
  };
  manager.add({gameTitle:'Fixture',links:[{status:'ready',url:'https://files.example.com/notes.zip',filename:'notes.zip'}]});
  await settle();
  return {manager,requests,settle,download:()=>manager.downloads[0],final:path.join(downloadDir,'Fixture','notes.zip'),
    advance:async ms=>{clock+=ms;manager.pump();await settle();}};
}

test('a dropped connection is retried automatically and the download completes',async t=>{
  const f=await fixture(t,attempt=>{if(attempt===1)throw dropped('ECONNRESET');return file('hello');});
  assert.equal(f.download().status,'queued');assert.equal(f.download().error,'');assert.match(f.download().connectionNote,/connection dropped/);
  assert.equal(f.requests.length,1);
  await f.advance(14999);assert.equal(f.requests.length,1,'it waits before trying again');assert.equal(f.download().status,'queued');
  await f.advance(1);
  assert.equal(f.requests.length,2);assert.equal(f.download().status,'completed');assert.equal(await fs.promises.readFile(f.final,'utf8'),'hello');
});

test('repeated drops without progress stop after two automatic retries with a clear message',async t=>{
  const f=await fixture(t,()=>{throw dropped('UND_ERR_CONNECT_TIMEOUT');});
  assert.equal(f.download().status,'queued');
  await f.advance(15000);assert.equal(f.requests.length,2);assert.equal(f.download().status,'queued','the second retry waits longer');
  await f.advance(15000);assert.equal(f.requests.length,2);
  await f.advance(15000);assert.equal(f.requests.length,3);
  assert.equal(f.download().status,'error');assert.equal(f.download().error,'The connection timed out. Check your connection and try again.');
  assert.ok(!f.download().error.includes('hidden.example'));
  f.manager.action(f.download().id,'retry');await f.settle();
  assert.equal(f.requests.length,4);assert.equal(f.download().status,'queued','a manual retry restores the automatic retries');
});

test('failures that are not dropped connections are not retried automatically',async t=>{
  const f=await fixture(t,()=>new Response('missing',{status:404}));
  assert.equal(f.download().status,'error');assert.equal(f.download().error,'Host returned HTTP 404. Check the source link or retry.');
  await f.advance(60000);assert.equal(f.requests.length,1);
});
