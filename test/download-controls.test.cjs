'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {DownloadManager}=require('../src/downloads.cjs');
const {CHUNK_SIZE}=require('../src/parallel-download.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label='condition'){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error(`Timed out: ${label}`);await wait(3);}}
function fixture(t,options={}){
  const base=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'ravenshelf-controls-'));
  const {Manager=DownloadManager,...settings}=options;
  const manager=new Manager({stateFile:path.join(root,'state.json'),downloadDir:path.join(root,'downloads'),...settings});
  t.after(async()=>{await manager.stop();assert.equal(path.dirname(path.resolve(root)),base);fs.rmSync(root,{recursive:true,force:true});});
  return {root,manager};
}
function add(manager,count=1,size=3){return manager.add({gameTitle:'Fixture',links:Array.from({length:count},(_,index)=>({status:'ready',url:`https://files.example.com/${index}`,filename:`file${index}.rar`,size}))}).ids;}
const fileResponse=(body='abc')=>new Response(body,{headers:{etag:'"stable"','content-length':String(Buffer.byteLength(body)),'content-type':'application/octet-stream'}});

test('schedule resumes only its own paused requests and never a manual pause',async t=>{
  let now=new Date(2026,10,9,8).getTime(),requests=0;
  const {manager}=fixture(t,{now:()=>now,fetcher:async()=>{requests++;return fileResponse();}});
  manager.updateSettings({downloadSchedule:{enabled:true,start:'09:00',end:'17:00',days:[1]}});
  const ids=add(manager,2);
  assert.equal(manager.downloads.every(d=>d.status==='paused'&&d.pauseReason==='schedule'),true);
  manager.action(ids[0],'pause');
  assert.equal(manager.downloads[0].pauseReason,undefined);
  now=new Date(2026,10,9,9).getTime();manager.checkSchedule();manager.pump();
  await until(()=>manager.downloads[1].status==='completed'&&!manager.running.size);
  assert.equal(requests,1);assert.equal(manager.downloads[0].status,'paused');
  now=new Date(2026,10,9,18).getTime();manager.checkSchedule();
  assert.equal(manager.downloads[1].status,'completed');
  assert.equal(manager.state().downloadSchedule.active,false);
});

test('restart resumes requested schedule pauses but keeps manual pauses and cancellations stopped',async t=>{
  let now=new Date(2026,10,9,8).getTime(),requests=0;
  const fetcher=async()=>{requests++;return fileResponse();};
  const {manager}=fixture(t,{now:()=>now,fetcher});
  manager.updateSettings({downloadSchedule:{enabled:true,start:'09:00',end:'17:00',days:[1]}});
  const ids=add(manager,3);manager.action(ids[1],'pause');manager.action(ids[2],'cancel');await manager.stop();
  now=new Date(2026,10,9,9).getTime();
  const reopened=new DownloadManager({stateFile:manager.stateFile,downloadDir:manager.settings.downloadDir,now:()=>now,fetcher});
  try{
    await until(()=>reopened.downloads[0].status==='completed'&&!reopened.running.size);
    assert.equal(reopened.downloads[1].status,'paused');assert.equal(reopened.downloads[2].status,'cancelled');assert.equal(requests,1);
  }finally{await reopened.stop();}
});

test('busy hosts have bounded automatic retries and cancellation prevents a queued retry',async t=>{
  let now=0,requests=0;
  const {manager}=fixture(t,{now:()=>now,fetcher:async()=>{requests++;return new Response(null,{status:429,headers:{'retry-after':'1'}});}});
  const [id]=add(manager);
  for(let attempt=1;attempt<=3;attempt++){
    await until(()=>!manager.running.size&&manager.downloads[0].retryCount===attempt,`busy attempt ${attempt}`);
    const d=manager.downloads[0];assert.equal(requests,attempt);
    assert.ok(d.retryAt>=now+60000);
    if(attempt<3){assert.equal(d.status,'queued');now=d.retryAt-1;manager.pump();assert.equal(requests,attempt);now=d.retryAt;manager.pump();}
    else assert.equal(d.status,'error');
  }
  manager.action(id,'retry');manager.action(id,'cancel');now=manager.downloads[0].retryAt+200000;manager.pump();
  await wait(5);assert.equal(requests,3);assert.equal(manager.downloads[0].status,'cancelled');
});

test('pauseAndWait cancels a bandwidth wait and removal cannot race transfer handles',async t=>{
  const {manager}=fixture(t,{fetcher:async()=>fileResponse(Buffer.alloc(8192,7))});
  manager.updateSettings({connectionsPerFile:1,maxDownloadBytesPerSecond:1});
  const [id]=add(manager,1,8192);
  await until(()=>manager.bandwidthLimiter.pending>0,'bandwidth wait');
  assert.throws(()=>manager.removeFromList([id]),/stop before removing/);
  await manager.pauseAndWait([id]);
  assert.equal(manager.running.size,0);assert.equal(manager.bandwidthLimiter.pending,0);
  assert.throws(()=>manager.action(id,'resume'),/being removed/);
  const d=manager.downloads[0],partial=path.join(d.folder,d.name+'.atlas-part');
  assert.equal(fs.existsSync(partial),true);
  assert.equal(manager.removeFromList([id]).removed,1);
  assert.equal(fs.existsSync(partial),true,'list removal never deletes disk files');
  assert.doesNotThrow(()=>manager.releaseQuiescence([id]));
});

test('pauseAndWait waits for an active Defender operation before list removal',async t=>{
  let finishScan;
  const {manager}=fixture(t,{fetcher:async()=>fileResponse(),scanFile:()=>new Promise(resolve=>{finishScan=resolve;})});
  const [id]=add(manager);
  await until(()=>manager.scanning===id&&finishScan,'active scan');
  let quiet=false;const pending=manager.pauseAndWait([id]).then(()=>{quiet=true;});
  await wait(5);assert.equal(quiet,false);assert.throws(()=>manager.removeFromList([id]),/stop before removing/);
  finishScan({status:'clean'});await pending;
  assert.equal(manager.removeFromList([id]).removed,1);
});

test('a scan queued by late completion remains pending until quiescence is released',async t=>{
  let scans=0;const {manager}=fixture(t,{fetcher:async()=>fileResponse(),scanFile:async()=>{scans++;return {status:'clean'};}});
  manager.updateSettings({defenderScan:false});const [id]=add(manager);
  await until(()=>manager.downloads[0].status==='completed'&&!manager.running.size);
  await manager.pauseAndWait([id]);manager.queueScan(manager.downloads[0]);
  assert.equal(manager.downloads[0].scan.status,'queued');assert.equal(scans,0);assert.equal(manager.scanQueue.length,0);
  manager.releaseQuiescence([id]);
  await until(()=>manager.downloads[0].scan.status==='clean');assert.equal(scans,1);
});

test('one limiter instance receives all actual single and parallel body bytes',async t=>{
  const payload=Buffer.alloc(2*CHUNK_SIZE+113,0x4a),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  let charged=0;const signals=new Set();
  const limiter={setRate(){},stop(){},async consume(bytes,{signal}){signal.throwIfAborted();charged+=bytes;signals.add(signal);}};
  const {manager}=fixture(t,{bandwidthLimiter:limiter,fetcher:async(_url,{headers})=>{
    const range=/^bytes=(\d+)-(\d*)$/.exec(headers.Range||''),start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):payload.length-1;
    return new Response(payload.subarray(start,end+1),{status:range?206:200,headers:{etag:'"payload"','content-length':String(end-start+1),...(range?{'content-range':`bytes ${start}-${end}/${payload.length}`}:{})}});
  }});
  add(manager,2,payload.length);
  await until(()=>manager.downloads.every(d=>d.status==='completed')&&!manager.running.size,'two parallel files');
  assert.equal(charged,2*payload.length+2,'each file includes its one-byte range probe');
  assert.ok(signals.size>=4,'both file controllers and range groups use the shared limiter');
  for(const d of manager.downloads)assert.equal(digest(fs.readFileSync(path.join(d.folder,d.name))),digest(payload));
});

for(const connections of [1,4])test(`intentional bandwidth waits do not trip ${connections}-connection inactivity watchdogs`,async t=>{
  let clock=0,holding=true;const intervals=new Set(),waiting=new Set();
  class Clock extends Date{static now(){return clock;}}
  const load=(file,parallel)=>{
    const filename=path.resolve(__dirname,'../src',file),nativeRequire=createRequire(filename),module={exports:{}};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>name==='./parallel-download.cjs'&&parallel?parallel:nativeRequire(name),Date:Clock,Buffer,AbortController,Headers,setImmediate,
      setInterval:(fn,ms)=>{const timer={fn,ms,unref(){}};intervals.add(timer);return timer;},clearInterval:timer=>intervals.delete(timer)},{filename});
    return module.exports;
  };
  const limiter={setRate(){},stop(){for(const job of [...waiting])job.abort();},consume:async(bytes,{signal})=>{
    if(!holding||bytes<=1)return;
    return new Promise((resolve,reject)=>{
      const job={signal,release:()=>{waiting.delete(job);signal.removeEventListener('abort',job.abort);resolve();},abort:()=>{waiting.delete(job);signal.removeEventListener('abort',job.abort);reject(signal.reason||new Error('Stopped'));}};
      waiting.add(job);signal.addEventListener('abort',job.abort,{once:true});if(signal.aborted)job.abort();
    });
  }};
  const payload=Buffer.alloc(connections===1?8192:2*CHUNK_SIZE+3,0x62);
  const {DownloadManager:Manager}=load('downloads.cjs',load('parallel-download.cjs'));
  const {manager}=fixture(t,{Manager,bandwidthLimiter:limiter,fetcher:async(_url,{headers})=>{
    const range=/^bytes=(\d+)-(\d*)$/.exec(headers.Range||''),start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):payload.length-1;
    return new Response(payload.subarray(start,end+1),{status:range?206:200,headers:{etag:'"throttled"','content-length':String(end-start+1),...(range?{'content-range':`bytes ${start}-${end}/${payload.length}`}:{})}});
  }});
  manager.updateSettings({connectionsPerFile:connections});add(manager,1,payload.length);
  await until(()=>waiting.size>=(connections===1?1:3),'all active sections waiting for budget');
  clock=120000;for(const timer of [...intervals])if(timer.ms===5000)timer.fn();
  assert.equal(manager.downloads[0].status,'downloading');
  assert.equal([...waiting].some(job=>job.signal.aborted),false,'watchdogs ignore intentional budget waits');
  holding=false;for(const job of [...waiting])job.release();
  await until(()=>manager.downloads[0].status==='completed'&&!manager.running.size,'throttled completion');
  const d=manager.downloads[0];assert.deepEqual(fs.readFileSync(path.join(d.folder,d.name)),payload);
  await manager.stop();assert.equal(intervals.size,0,'manager and range timers are all cleaned up');
});
