'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CompletionAction}=require('../src/completion-action.cjs');
function setup(queue=[]){
  const f={queue,time:0,calls:[],states:[]};
  f.action=new CompletionAction({getDownloads:()=>f.queue,onExecute:async(mode,details)=>f.calls.push({mode,...details}),onChange:s=>f.states.push(s),clock:()=>f.time,autoTick:false});
  f.tick=(ms=0)=>{f.time+=ms;f.action.tick();};return f;
}
const flush=()=>new Promise(r=>setImmediate(r));
test('defaults to keep open and never triggers from completed history',async()=>{
 const f=setup([{id:'a',status:'completed'}]);f.tick(999999);await flush();assert.equal(f.action.snapshot().mode,'none');assert.equal(f.calls.length,0);assert.throws(()=>f.action.arm('shutdown'),/Add downloads/);
});
test('successful armed queue starts a cancellable 60-second countdown',async()=>{
 const f=setup([{id:'a',status:'downloading'}]);f.action.arm('shutdown');f.queue[0].status='completed';f.tick();assert.equal(f.action.snapshot().remainingSeconds,60);f.tick(59000);await flush();assert.equal(f.calls.length,0);assert.equal(f.action.snapshot().remainingSeconds,1);f.tick(1000);await flush();assert.deepEqual(f.calls,[{mode:'shutdown',ids:['a']}]);f.tick(90000);await flush();assert.equal(f.calls.length,1);
});
test('close action also waits for every part to succeed',async()=>{
 const f=setup([{id:'a',status:'completed'},{id:'b',status:'queued'},{id:'c',status:'downloading'}]);f.action.arm('close');f.queue[1].status='completed';f.tick(60000);assert.equal(f.action.snapshot().phase,'armed');f.queue[2].status='completed';f.tick();f.tick(60000);await flush();assert.equal(f.calls[0].mode,'close');
});
test('errors and paused transfers cannot cause shutdown',async()=>{
 const f=setup([{id:'a',status:'error'},{id:'b',status:'paused'}]);f.action.arm('shutdown');f.tick(999999);await flush();assert.equal(f.action.snapshot().phase,'armed');assert.equal(f.calls.length,0);f.queue[0].status='completed';f.tick();assert.match(f.action.snapshot().message,/paused/);
});
test('cancelled or removed tracked downloads disarm the action',async()=>{
 for(const remove of [false,true]){const f=setup([{id:'a',status:'downloading'}]);f.action.arm('shutdown');if(remove)f.queue=[];else f.queue[0].status='cancelled';f.tick(999999);await flush();assert.equal(f.action.snapshot().mode,'none');assert.equal(f.calls.length,0);}
});
test('new work interrupts countdown and must also complete',async()=>{
 const f=setup([{id:'a',status:'downloading'}]);f.action.arm('shutdown');f.queue[0].status='completed';f.tick();f.tick(59000);f.queue.push({id:'b',status:'queued'});f.tick(1000);await flush();assert.equal(f.action.snapshot().phase,'armed');assert.equal(f.calls.length,0);f.queue[1].status='completed';f.tick();assert.equal(f.action.snapshot().remainingSeconds,60);f.tick(60000);await flush();assert.deepEqual(f.calls[0].ids,['a','b']);
});
test('user cancellation during countdown prevents any later action',async()=>{
 const f=setup([{id:'a',status:'queued'}]);f.action.arm('shutdown');f.queue[0].status='completed';f.tick();f.tick(59000);f.action.cancel();f.tick(999999);await flush();assert.equal(f.calls.length,0);
});
test('failed OS handler reports error and never retries itself',async()=>{
 const f=setup([{id:'a',status:'queued'}]);f.action.onExecute=async()=>{throw Error('Windows rejected the request');};f.action.arm('shutdown');f.queue[0].status='completed';f.tick();f.tick(60000);await flush();assert.equal(f.action.snapshot().phase,'error');assert.match(f.action.snapshot().message,/Windows rejected/);assert.equal(f.action.snapshot().mode,'none');
});
test('fresh session and disposed scheduler do not retain an armed action',async()=>{
 const f=setup([{id:'a',status:'queued'}]);f.action.arm('shutdown');f.action.dispose();f.queue[0].status='completed';f.tick(999999);await flush();assert.equal(f.calls.length,0);assert.equal(setup(f.queue).action.snapshot().mode,'none');
});
test('unrecognized modes are rejected without arming',()=>{const f=setup([{id:'a',status:'queued'}]);assert.throws(()=>f.action.arm('restart'),/Choose/);assert.equal(f.action.snapshot().mode,'none');});
