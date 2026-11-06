'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {HostBackoff,retryAfterMilliseconds,MAX_RETRY_AFTER_MS}=require('../src/host-backoff.cjs');
const host='https://files.example.com/file.rar';
const busy=(status=429,retry='1')=>new Response(null,{status,headers:{'retry-after':retry}});
test('host cooldown is shared by paths, respects Retry-After and ramps one then two then four',()=>{
  let now=0;const backoff=new HostBackoff({now:()=>now});
  const failure=backoff.failure(host,busy());assert.equal(failure.retryAt,60000);
  assert.throws(()=>backoff.assertAvailable('https://files.example.com/other.rar'),error=>error.code==='HOST_BACKOFF');
  assert.equal(backoff.policy('https://other.example.com/file.rar').limited,false);
  now=60000;assert.equal(backoff.assertAvailable(host).connectionLimit,1);
  now=119999;assert.equal(backoff.policy(host).connectionLimit,1);
  now=120000;assert.equal(backoff.policy(host).connectionLimit,2);
  now=180000;assert.equal(backoff.policy(host).connectionLimit,4);
});
test('consecutive busy responses extend cooldown and successful recovery resets their count',()=>{
  let now=0;const backoff=new HostBackoff({now:()=>now});
  backoff.failure(host,busy());assert.equal(backoff.failure(host,busy(503)).retryAt,120000);
  now=120000;backoff.success(host);
  assert.equal(backoff.failure(host,busy(503,'240')).retryAt,360000);
});
test('HTTP-date and very long retry delays are respected without automatic week-long retries',()=>{
  const now=Date.UTC(2026,10,7),backoff=new HostBackoff({now:()=>now});
  assert.equal(retryAfterMilliseconds(new Date(now+120000).toUTCString(),now),120000);
  assert.equal(retryAfterMilliseconds('invalid',now),0);
  const delay=MAX_RETRY_AFTER_MS+86400000,error=backoff.failure(host,busy(503,String(delay/1000)));
  assert.equal(error.retryAt,now+delay);assert.equal(error.automatic,false);
});
test('restored host limits preserve the cooldown and gradual recovery after app restart',()=>{
  let now=30000;const backoff=new HostBackoff({now:()=>now});
  backoff.restore(host,{retryAt:60000,status:429,failures:1});
  assert.throws(()=>backoff.assertAvailable(host),error=>error.retryAt===60000);
  now=60000;assert.equal(backoff.policy(host).connectionLimit,1);
  now=120000;assert.equal(backoff.policy(host).connectionLimit,2);
  backoff.restore('https://other.example/file',{retryAt:-1,status:429});
  assert.equal(backoff.policy('https://other.example/file').limited,false);
});
