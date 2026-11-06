'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CatalogRefresh}=require('../src/catalog-refresh.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const result=(...titles)=>({section:'newest',page:1,games:titles.map(title=>({title,url:'https://fitgirl-repacks.site/'+title+'/'})),hasMore:true});
function setup({intervalMs=300000,fetchLatest}={}){
  const f={time:Date.UTC(2026,10,6,12),requests:0,states:[],timers:new Map(),sequence:0,data:result('first')};
  f.action=new CatalogRefresh({intervalMs,clock:()=>f.time,onChange:s=>f.states.push(s),fetchLatest:()=>{f.requests++;return fetchLatest?fetchLatest():structuredClone(f.data);},
    setTimeoutFn:(callback,delay)=>{const id=++f.sequence;f.timers.set(id,{at:f.time+delay,callback});return id;},clearTimeoutFn:id=>f.timers.delete(id)});
  f.advance=async ms=>{
    f.time+=ms;
    for(const [id,timer] of [...f.timers])if(timer.at<=f.time){f.timers.delete(id);timer.callback();}
    await flush();
  };
  return f;
}

test('startup fetches immediately and automatically publishes a new upload after five minutes',async()=>{
  const f=setup();assert.equal(f.action.snapshot().enabled,false);
  await f.action.start();assert.equal(f.requests,1);assert.equal(f.action.snapshot().revision,1);
  assert.equal(f.action.snapshot().intervalMs,300000);assert.equal(f.action.snapshot().checking,false);
  const firstChecked=f.action.snapshot().lastCheckedAt;
  assert.ok(f.states[0].checking);assert.equal(f.states[0].lastCheckedAt,null);
  f.data=result('new-upload','first');await f.advance(299999);assert.equal(f.requests,1);
  await f.advance(1);assert.equal(f.requests,2);assert.equal(f.action.snapshot().latest.games[0].title,'new-upload');
  assert.equal(f.action.snapshot().revision,2);assert.notEqual(f.action.snapshot().lastCheckedAt,firstChecked);
  assert.equal(new Date(f.action.snapshot().nextCheckAt).getTime(),f.time+300000);f.action.stop();
});

test('unchanged results update check time without incrementing the content revision',async()=>{
  const f=setup();await f.action.start();const initial=f.action.snapshot().lastCheckedAt;
  await f.advance(300000);assert.equal(f.action.snapshot().revision,1);assert.notEqual(f.action.snapshot().lastCheckedAt,initial);
  const copy=f.action.snapshot();copy.latest.games[0].title='External mutation';
  assert.equal(f.action.snapshot().latest.games[0].title,'first');f.action.stop();
});

test('slow checks, startup repeats, and forced requests share one network request',async()=>{
  let release;const f=setup({fetchLatest:()=>new Promise(resolve=>{release=resolve;})});
  const first=f.action.start(),again=f.action.start(),forced=f.action.check({force:true});await flush();
  assert.equal(f.requests,1);assert.equal(f.timers.size,0);
  await f.advance(900000);assert.equal(f.requests,1);
  release(result('one'));await Promise.all([first,again,forced]);
  assert.equal(f.action.snapshot().checking,false);assert.equal(f.timers.size,1);
  assert.equal(new Date(f.action.snapshot().nextCheckAt).getTime(),f.time+300000);f.action.stop();
});

test('focus or resume checks fetch only when due and replace an overdue timer',async()=>{
  const f=setup();await f.action.start();await f.action.check();await f.action.start();assert.equal(f.requests,1);
  f.time+=600000;await f.action.check();assert.equal(f.requests,2);assert.equal(f.timers.size,1);
  await f.advance(299999);assert.equal(f.requests,2);await f.advance(1);assert.equal(f.requests,3);f.action.stop();
});

test('failed checks retain good results and retry on the interval without a tight loop',async()=>{
  let fail=false;const f=setup({fetchLatest:()=>{if(fail)throw Error('Site unavailable');return result('available');}});
  await f.action.start();const good=f.action.snapshot();fail=true;await f.advance(300000);
  const failed=f.action.snapshot();assert.equal(f.requests,2);assert.equal(failed.latest.games[0].title,'available');
  assert.equal(failed.lastCheckedAt,good.lastCheckedAt);assert.equal(failed.revision,good.revision);assert.match(failed.error,/Site unavailable/);assert.equal(failed.checking,false);
  await f.action.check();await f.advance(299999);assert.equal(f.requests,2);
  fail=false;await f.advance(1);assert.equal(f.requests,3);assert.equal(f.action.snapshot().error,'');f.action.stop();
});

test('a first-check failure and invalid results remain retryable without claiming a successful check',async()=>{
  const f=setup({fetchLatest:()=>({error:'not a catalogue'})});await f.action.start();
  assert.equal(f.action.snapshot().lastCheckedAt,null);assert.equal(f.action.snapshot().latest,null);assert.equal(f.action.snapshot().revision,0);
  assert.match(f.action.snapshot().error,/could not be read/);assert.equal(f.timers.size,1);f.action.stop();
});

test('an empty newest parse retains the last good games and remains retryable',async()=>{
  const f=setup();await f.action.start();const good=f.action.snapshot();
  // A 200 challenge page or a missing homepage can both parse as games: [].
  for(const empty of [result(),{section:'newest',page:1,games:[],hasMore:false}]){
    f.data=empty;await f.advance(300000);const failed=f.action.snapshot();
    assert.equal(failed.latest.games[0].title,'first');assert.equal(failed.lastCheckedAt,good.lastCheckedAt);
    assert.equal(failed.revision,good.revision);assert.match(failed.error,/did not contain any games/);assert.equal(f.timers.size,1);
  }
  f.data=result('new-upload','first');await f.advance(300000);
  assert.equal(f.action.snapshot().latest.games[0].title,'new-upload');assert.equal(f.action.snapshot().error,'');assert.equal(f.action.snapshot().revision,2);f.action.stop();
});

test('an empty first response never claims that the newest catalogue was checked successfully',async()=>{
  const f=setup({fetchLatest:()=>result()});await f.action.start();const state=f.action.snapshot();
  assert.equal(state.lastCheckedAt,null);assert.equal(state.latest,null);assert.equal(state.revision,0);assert.match(state.error,/did not contain any games/);f.action.stop();
});

test('stopping cancels timers and discards an in-flight result without late notifications',async()=>{
  let release;const f=setup({fetchLatest:()=>new Promise(resolve=>{release=resolve;})});
  const active=f.action.start();await flush();f.action.stop();const count=f.states.length;
  release(result('late'));await active;await f.advance(900000);await f.action.check({force:true});
  assert.equal(f.states.length,count);assert.equal(f.action.snapshot().enabled,false);assert.equal(f.action.snapshot().latest,null);
  assert.equal(f.action.snapshot().nextCheckAt,null);assert.equal(f.requests,1);assert.equal(f.timers.size,0);
});

test('restart waits for an old request and only publishes the restarted generation',async()=>{
  const releases=[];const f=setup({fetchLatest:()=>new Promise(resolve=>releases.push(resolve))});
  const initial=f.action.start();await flush();f.action.stop();const restarted=f.action.start();
  assert.equal(f.requests,1);releases[0](result('old-generation'));await initial;await flush();
  assert.equal(f.requests,2);assert.equal(f.action.snapshot().latest,null);
  releases[1](result('new-generation'));await restarted;
  assert.equal(f.action.snapshot().latest.games[0].title,'new-generation');assert.equal(f.action.snapshot().revision,1);f.action.stop();
});

test('stop before the scheduled fetch begins does not send a request',async()=>{
  const f=setup();const active=f.action.start();f.action.stop();await active;assert.equal(f.requests,0);
});

test('invalid intervals and missing fetch handlers are rejected',()=>{
  assert.throws(()=>new CatalogRefresh(),/fetch handler/);
  for(const intervalMs of [0,-1,NaN,Infinity,2147483648])assert.throws(()=>new CatalogRefresh({fetchLatest:()=>result(),intervalMs}),/interval/);
});
