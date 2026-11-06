'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {RateMeter}=require('../src/rate-meter.cjs');

function fixture(initialBytes=0){
  let now=0;
  const meter=new RateMeter({clock:()=>now});
  meter.reset(initialBytes);
  return {meter,at(time,total){now=time;return meter.sample(total);},setTime(time){now=time;}};
}
function close(actual,expected){assert.ok(Math.abs(actual-expected)<0.0001,`${actual} should equal ${expected}`);}

test('steady traffic reports bytes per second independent of cumulative resume offset',()=>{
  const f=fixture(900_000_000);
  for(let time=500;time<=15_000;time+=500)close(f.at(time,900_000_000+time*2000),2_000_000);
});

test('bursty delivery is averaged over five seconds rather than the last chunk interval',()=>{
  const f=fixture();
  for(let time=500;time<=5000;time+=500)f.at(time,time*1000);
  // Same one MB/s average, now arriving as alternating one MB bursts and silence.
  for(let time=5500;time<=15_000;time+=500){
    const received=5_000_000+Math.ceil((time-5000)/1000)*1_000_000;
    const rate=f.at(time,received);
    assert.ok(rate>=1_000_000&&rate<=1_100_000,`recent average should stay near1 MB/s, got${rate}`);
  }
});

test('a silent stall decays to zero without receiving another network chunk',()=>{
  const f=fixture();
  for(let time=500;time<=5000;time+=500)f.at(time,time*1000);
  for(let time=5500;time<=10_000;time+=500){
    close(f.at(time,5_000_000),(10_000-time)*200);
  }
  close(f.at(10_500,5_000_000),0);
});

test('reset for resume discards previous speed, old bytes and paused time',()=>{
  const f=fixture();
  close(f.at(500,5_000_000),10_000_000);
  f.setTime(60_000);
  close(f.meter.reset(5_000_000),0);
  close(f.at(60_500,5_250_000),500_000);
  close(f.at(61_000,5_500_000),500_000);
});

test('byte counter restarting from zero resets the baseline instead of producing a negative rate',()=>{
  const f=fixture();
  close(f.at(500,1_000_000),2_000_000);
  close(f.at(1000,0),0);
  close(f.at(1500,250_000),500_000);
});

test('irregular timer ticks interpolate the five-second boundary',()=>{
  const f=fixture();
  for(const time of [700,1300,2100,3000,3800,4700,5600,6500,7400])close(f.at(time,time*1000),1_000_000);
});

test('frequent accidental calls do not replace timer samples with per-chunk measurements',()=>{
  const f=fixture();
  for(let time=1;time<500;time++)close(f.at(time,time*1000),0);
  close(f.at(500,500_000),1_000_000);
  close(f.at(501,600_000),1_000_000);
  close(f.at(1000,1_000_000),1_000_000);
});

test('invalid measurements are rejected and backward clocks restart cleanly',()=>{
  const f=fixture();
  assert.throws(()=>f.at(500,NaN),/finite/);
  assert.throws(()=>f.at(500,-1),/non-negative/);
  close(f.at(1000,1_000_000),1_000_000);
  close(f.at(500,1_000_000),0);
  close(f.at(1000,1_500_000),1_000_000);
});
