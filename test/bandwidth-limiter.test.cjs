'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BandwidthLimiter,normalizeBandwidthLimit,MAX_BANDWIDTH_BYTES_PER_SECOND,MAX_BURST_BYTES}=require('../src/bandwidth-limiter.cjs');

function clock(){
  let time=0,nextId=0;const timers=new Map();
  return {
    now:()=>time,
    setTimeoutFn:(fn,delay)=>{const id=++nextId;timers.set(id,{at:time+delay,fn});return id;},
    clearTimeoutFn:id=>timers.delete(id),
    get timerCount(){return timers.size;},
    async advance(milliseconds){
      const end=time+milliseconds;let callbacks=0;
      while(true){
        const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!due)break;
        assert.ok(++callbacks<10000,'timers must yield instead of spinning');
        time=due[1].at;timers.delete(due[0]);due[1].fn();await Promise.resolve();await Promise.resolve();
      }
      time=end;await Promise.resolve();await Promise.resolve();
    },
  };
}
function fixture(rate){const time=clock();return {time,limiter:new BandwidthLimiter({bytesPerSecond:rate,...time})};}

test('two consumers share one aggregate bandwidth budget',async()=>{
  const {limiter,time}=fixture(100);let delivered=0;
  await limiter.consume(100);delivered+=100;
  const next=limiter.consume(100).then(()=>{delivered+=100;});
  assert.equal(delivered,100);assert.equal(limiter.pending,1);
  await time.advance(999);assert.equal(delivered,100);
  await time.advance(1);await next;assert.equal(delivered,200);
  assert.equal(time.timerCount,0);assert.equal(limiter.pending,0);
});

test('a chunk larger than the bucket completes without an impossible token request',async()=>{
  const {limiter,time}=fixture(10);let done=false;const waits=[];
  const pending=limiter.consume(35,{onWait:value=>waits.push(value)}).then(()=>{done=true;});
  await time.advance(2499);assert.equal(done,false);
  await time.advance(1);await pending;assert.equal(done,true);
  assert.deepEqual(waits,[true,false]);assert.equal(time.timerCount,0);
});

test('large queued chunks rotate so a smaller consumer can complete first',async()=>{
  const {limiter,time}=fixture(100),finished=[];
  const large=limiter.consume(300).then(()=>finished.push('large'));
  const small=limiter.consume(100).then(()=>finished.push('small'));
  await time.advance(2000);assert.deepEqual(finished,['small']);
  await time.advance(1000);await Promise.all([large,small]);assert.deepEqual(finished,['small','large']);
});

test('abort removes its waiter and timer without refunding already consumed credits',async()=>{
  const {limiter,time}=fixture(100),controller=new AbortController(),reason=new Error('Paused'),waits=[];
  const pending=limiter.consume(300,{signal:controller.signal,onWait:value=>waits.push(value)});
  const rejected=assert.rejects(pending,error=>error===reason);
  controller.abort(reason);await rejected;
  assert.deepEqual(waits,[true,false]);assert.equal(limiter.pending,0);assert.equal(time.timerCount,0);
  let nextDone=false;const next=limiter.consume(100).then(()=>{nextDone=true;});
  await time.advance(999);assert.equal(nextDone,false);
  await time.advance(1);await next;assert.equal(nextDone,true);
});

test('changing the limit accounts for old elapsed time and wakes pending work',async()=>{
  const {limiter,time}=fixture(100);let done=false;
  const pending=limiter.consume(300).then(()=>{done=true;});
  await time.advance(500);limiter.setRate(200);
  await time.advance(749);assert.equal(done,false);
  await time.advance(1);await pending;assert.equal(done,true);
  const unlimited=limiter.consume(1000000);assert.equal(limiter.pending,1);
  limiter.setRate(0);await unlimited;assert.equal(time.timerCount,0);
  await limiter.consume(Number.MAX_SAFE_INTEGER);assert.equal(limiter.pending,0);
});

test('unlimited-to-limited updates use a bounded initial burst',async()=>{
  const {limiter,time}=fixture(0);
  await limiter.consume(1000000);limiter.setRate(MAX_BANDWIDTH_BYTES_PER_SECOND);
  assert.equal(limiter.capacity,MAX_BURST_BYTES);
  await limiter.consume(MAX_BURST_BYTES);
  const next=limiter.consume(1);assert.equal(limiter.pending,1);
  await time.advance(1);await next;assert.equal(time.timerCount,0);
});

test('stop settles every pending promise and prevents new work',async()=>{
  const {limiter,time}=fixture(10);
  const first=assert.rejects(limiter.consume(100),/stopped/),second=assert.rejects(limiter.consume(100),/stopped/);
  limiter.stop();limiter.stop();await Promise.all([first,second]);
  assert.equal(time.timerCount,0);assert.equal(limiter.pending,0);
  await assert.rejects(limiter.consume(1),/stopped/);
  assert.throws(()=>limiter.setRate(0),/stopped/);
});

test('invalid limits and byte counts are rejected and safe high rates are bounded',async()=>{
  for(const value of [-1,NaN,Infinity,1.5,'100',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalizeBandwidthLimit(value),/whole-number/);
  assert.equal(normalizeBandwidthLimit(0),0);
  assert.equal(normalizeBandwidthLimit(Number.MAX_SAFE_INTEGER),MAX_BANDWIDTH_BYTES_PER_SECOND);
  const {limiter,time}=fixture(100);
  for(const value of [-1,NaN,Infinity,1.5,'100'])await assert.rejects(limiter.consume(value),/byte count/);
  const controller=new AbortController();controller.abort(new Error('Already paused'));
  await assert.rejects(limiter.consume(1,{signal:controller.signal}),/Already paused/);
  assert.equal(time.timerCount,0);assert.equal(limiter.pending,0);
});
