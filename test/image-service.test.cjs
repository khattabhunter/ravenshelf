'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createImageService,LIMITS,CATEGORIES,retryAfterMs}=require('../src/image-loader.cjs');

const JPEG=size=>{const bytes=Buffer.alloc(Math.max(4,size),7);bytes[0]=255;bytes[1]=216;bytes[2]=255;return bytes;};
const jpegResponse=(size=64,headers={})=>new Response(JPEG(size),{headers:{'content-type':'image/jpeg',...headers}});
const route=(target,signal,ticket)=>new Request('atlas://app/image?url='+encodeURIComponent(target)+(ticket?`&r=${ticket}`:''),signal?{signal}:{});
const tick=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
// A site whose answers the test releases one at a time, recording each request.
function site(){
  const calls=[];
  const fetcher=(url,options)=>new Promise((resolve,reject)=>{
    const call={url,options,resolve,reject,aborted:false};calls.push(call);
    options.signal.addEventListener('abort',()=>{call.aborted=true;reject(options.signal.reason);},{once:true});
  });
  return {calls,fetcher,answer:(index,response)=>calls[index].resolve(response)};
}
// A test clock with its own timers: advance() runs the timers that fall due.
const clock=(start=Date.parse('2026-11-13T12:00:00Z'))=>{
  let time=start,order=0;const due=[];
  const timers={setTimeout:(fn,ms)=>{const timer={at:time+Math.max(0,ms),fn,order:++order};due.push(timer);return timer;},clearTimeout:timer=>{const index=due.indexOf(timer);if(index>=0)due.splice(index,1);}};
  const advance=ms=>{
    const end=time+ms;
    for(;;){due.sort((a,b)=>a.at-b.at||a.order-b.order);if(!due.length||due[0].at>end)break;const next=due.shift();time=next.at;next.fn();}
    time=end;
  };
  return {now:()=>time,advance,timers,pending:()=>due.length};
};
const settled=promise=>{const state={done:false};promise.then(()=>{state.done=true;},()=>{state.done=true;});return state;};
const counts=(service,host)=>service.snapshot().sites.find(entry=>entry.host===host)?.counts||{};

test('two cards that need the same picture share one request; leaving one card does not cancel it for the other',async()=>{
  const s=site(),service=createImageService({fetcher:s.fetcher});
  const leave=new AbortController();
  const first=service.respond(route('https://riotpixels.net/data/a/1.jpg.240p.jpg',leave.signal));
  const second=service.respond(route('https://riotpixels.net/data/a/1.jpg.240p.jpg'));
  await tick();assert.equal(s.calls.length,1,'one request for both cards');
  leave.abort();
  assert.equal((await first).status,502);assert.equal(s.calls[0].aborted,false,'still needed by the other card');
  s.answer(0,jpegResponse());
  const shown=await second;assert.equal(shown.status,200);assert.deepEqual(Buffer.from(await shown.arrayBuffer()),JPEG(64));
  const c=counts(service,'riotpixels.net');assert.equal(c.cancelled,1);assert.equal(c.loaded,1);assert.equal(c.fetches,1);
});

test('the shared request is cancelled when the last card leaves, and is never remembered as a failure',async()=>{
  const s=site(),service=createImageService({fetcher:s.fetcher});
  const a=new AbortController(),b=new AbortController();
  const pending=[service.respond(route('https://riotpixels.net/x.jpg',a.signal)),service.respond(route('https://riotpixels.net/x.jpg',b.signal))];
  await tick();a.abort();b.abort();
  for(const result of await Promise.all(pending))assert.equal(result.status,502);
  assert.equal(s.calls[0].aborted,true);assert.equal(service._state.inflight.size,0);assert.equal(service._state.failures.size,0);
  const again=service.respond(route('https://riotpixels.net/x.jpg'));await tick();
  assert.equal(s.calls.length,2,'a later card asks again');s.answer(1,jpegResponse());assert.equal((await again).status,200);
  assert.equal(counts(service,'riotpixels.net').cancelled,2);
});

test('each site gets at most four requests at a time; a waiting request that is no longer needed never starts',async()=>{
  const s=site(),service=createImageService({fetcher:s.fetcher});
  const leave=new AbortController(),results=[];
  for(let i=0;i<6;i++)results.push(service.respond(route(`https://riotpixels.net/${i}.jpg`,i===5?leave.signal:undefined)));
  results.push(service.respond(route('https://other.example/cover.jpg')));
  await tick();
  assert.deepEqual(s.calls.map(call=>new URL(call.url).hostname).sort(),['other.example','riotpixels.net','riotpixels.net','riotpixels.net','riotpixels.net']);
  assert.equal(service._state.hosts.get('riotpixels.net').queue.length,2);
  leave.abort();assert.equal((await results[5]).status,502);assert.equal(service._state.hosts.get('riotpixels.net').queue.length,1);
  s.answer(0,jpegResponse());await results[0];await tick();
  assert.equal(s.calls.filter(call=>call.url.includes('riotpixels')).length,5,'the next waiting picture starts');
  assert.ok(!s.calls.some(call=>call.url.endsWith('/5.jpg')),'the cancelled one never started');
  for(const index of [1,2,3,4,5])s.calls[index].resolve(jpegResponse());
  for(const index of [1,2,3,4,6])assert.equal((await results[index]).status,200);
  assert.equal(service._state.hosts.has('riotpixels.net'),false,'an idle site keeps no state');assert.equal(service._state.inflight.size,0);
});

test('"too many requests" pauses that site: its pictures wait, alternatives included, and load after the pause',async()=>{
  const s=site(),time=clock(),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
  const results=[];for(let i=0;i<6;i++)results.push(service.respond(route(`https://riotpixels.net/${i}.jpg`)));
  const elsewhere=service.respond(route('https://other.example/a.jpg'));
  await tick();
  s.answer(0,new Response('slow down',{status:429,headers:{'retry-after':'20'}}));
  assert.equal((await results[0]).status,502);
  const alternative=service.respond(route('https://riotpixels.net/thumbnail-alternative.jpg.240p.jpg'));
  const waiting=[settled(results[4]),settled(results[5]),settled(alternative)];
  // Requests already sent finish normally; the other site is not affected.
  for(const index of [1,2,3])s.calls[index].resolve(jpegResponse());
  s.calls.find(call=>call.url.includes('other.example')).resolve(jpegResponse());
  for(const index of [1,2,3])assert.equal((await results[index]).status,200);
  assert.equal((await elsewhere).status,200);
  await tick();
  const before=s.calls.length;
  assert.ok(waiting.every(state=>!state.done),'waiting pictures are not given up during a short pause');
  assert.deepEqual(service.snapshot().pausedSites,[{host:'riotpixels.net',seconds:20}]);
  time.advance(19999);await tick();
  assert.equal(s.calls.length,before,'no request to the paused site');
  time.advance(1);await tick();
  assert.deepEqual(s.calls.slice(before).map(call=>new URL(call.url).pathname).sort(),['/4.jpg','/5.jpg','/thumbnail-alternative.jpg.240p.jpg'],'they are asked for after the pause');
  for(const call of s.calls.slice(before))call.resolve(jpegResponse());
  for(const result of [results[4],results[5],alternative])assert.equal((await result).status,200);
  const c=counts(service,'riotpixels.net');assert.equal(c.tooMany,1);assert.equal(c.cooldown,0);assert.equal(c.loaded,6);assert.equal(service.snapshot().pausedSites.length,0);
  assert.equal(service._state.hosts.size,0,'nothing is kept for a site once it is idle');
});

test('a pause longer than a picture can wait gives up waiting pictures at once, without a request',async()=>{
  const s=site(),time=clock(),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
  const results=[];for(let i=0;i<6;i++)results.push(service.respond(route(`https://riotpixels.net/${i}.jpg`)));
  await tick();
  s.answer(0,new Response('',{status:429,headers:{'retry-after':'600'}}));
  for(const index of [0,4,5])assert.equal((await results[index]).status,502);
  assert.equal((await service.respond(route('https://riotpixels.net/new.jpg'))).status,502,'a new picture is not kept waiting for 10 minutes');
  assert.equal(s.calls.length,4);
  const c=counts(service,'riotpixels.net');assert.equal(c.tooMany,1);assert.equal(c.cooldown,3);
  for(const index of [1,2,3])s.calls[index].resolve(jpegResponse());
  time.advance(600000);
  const later=service.respond(route('https://riotpixels.net/4.jpg'));await tick();
  assert.equal(s.calls.at(-1).url,'https://riotpixels.net/4.jpg','the site is asked again after the pause');
  s.calls.at(-1).resolve(jpegResponse());assert.equal((await later).status,200);
});

test('a picture waits at most 90 seconds for its turn, then gives up so the card can move on',async()=>{
  const s=site(),time=clock(),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
  const results=[];for(let i=0;i<5;i++)results.push(service.respond(route(`https://slow.example/${i}.jpg`)));
  await tick();assert.equal(s.calls.length,4);
  const fifth=settled(results[4]);
  time.advance(LIMITS.maxWaitMs-1);await tick();assert.equal(fifth.done,false);
  time.advance(1);assert.equal((await results[4]).status,502);
  assert.equal(counts(service,'slow.example').busy,1);assert.equal(s.calls.length,4,'it never started');
  for(let i=0;i<4;i++)s.calls[i].resolve(jpegResponse());
  for(let i=0;i<4;i++)assert.equal((await results[i]).status,200);
  assert.equal(service._state.hosts.size,0);assert.equal(time.pending()>0,true,'only the memory clean-up timer is left');
});

test('a picture handed its turn just as a long pause starts gives up at once instead of waiting in line',async()=>{
  const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
  // The pause can start a few steps after the turn was handed over; try each step.
  for(let offset=0;offset<12;offset++){
    const s=site(),time=clock(),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
    for(const name of ['b','c','d','e'])service.respond(route(`https://h.example/${name}.jpg`));
    await flush();
    const a=settled(service.respond(route('https://h.example/a.jpg')));await flush();
    s.answer(0,jpegResponse());
    for(let i=0;i<offset;i++)await Promise.resolve();
    s.answer(1,new Response('',{status:429,headers:{'retry-after':'600'}}));
    await flush();
    // Either a.jpg was already on its way before the pause was known, or it
    // gave up at once without a request; it never sits in line for 90 s.
    const sent=s.calls.some(call=>call.url.endsWith('/a.jpg'));
    assert.ok(sent||a.done,`offset ${offset}: sent=${sent} settled=${a.done}`);
    if(!sent){assert.equal(counts(service,'h.example').cooldown,1);assert.equal(service._state.hosts.get('h.example').queue.length,0);}
    for(const call of s.calls.slice(2))call.resolve(jpegResponse());
  }
});

test('pauses and waits follow a steady clock: changing the PC clock does not stretch them',async()=>{
  // A steady clock counts from an arbitrary point, unlike the wall clock.
  const s=site(),time=clock(5000);let wall=Date.parse('2026-11-13T12:00:00Z');
  const service=createImageService({fetcher:s.fetcher,now:time.now,wallNow:()=>wall,timers:time.timers});
  const first=service.respond(route('https://riotpixels.net/a.jpg'));await tick();
  s.answer(0,new Response('',{status:429}));await first;
  wall-=3600*1000;time.advance(61000);
  const next=service.respond(route('https://riotpixels.net/b.jpg'));await tick();
  assert.equal(s.calls.length,2,'asked again after 60 s, whatever the PC clock says');
  s.answer(1,jpegResponse());assert.equal((await next).status,200);
  assert.equal(service.snapshot().since,'2026-11-13T12:00:00.000Z','the summary start time is the wall time');
});

test('an HTTP-date Retry-After is measured against the wall clock; the default timing clock is steady',async()=>{
  const s=site(),time=clock(5000),wall=Date.parse('2026-11-13T12:00:00Z');
  const service=createImageService({fetcher:s.fetcher,now:time.now,wallNow:()=>wall,timers:time.timers});
  const result=service.respond(route('https://riotpixels.net/a.jpg'));await tick();
  s.answer(0,new Response('',{status:429,headers:{'retry-after':'Fri, 13 Nov 2026 12:02:00 GMT'}}));await result;
  assert.deepEqual(service.snapshot().pausedSites,[{host:'riotpixels.net',seconds:120}]);
  // Without an injected clock, pauses ignore changes to the PC's clock (Date.now).
  const realNow=Date.now;let pcClock=realNow();Date.now=()=>pcClock;
  try{
    const other=site(),plain=createImageService({fetcher:other.fetcher});
    const first=plain.respond(route('https://riotpixels.net/b.jpg'));await tick();
    other.answer(0,new Response('',{status:429,headers:{'retry-after':'60'}}));await first;
    pcClock+=3600*1000;
    assert.ok(plain.snapshot().pausedSites[0]?.seconds>=59,'an hour jump of the PC clock does not end the pause');
  }finally{Date.now=realNow;}
});

test('Retry-After is read as whole seconds or an HTTP date, and the pause stays between 5 seconds and 10 minutes',async()=>{
  const now=Date.parse('2026-11-13T12:00:00Z');
  assert.equal(retryAfterMs('20',now),20000);assert.equal(retryAfterMs(' 20 ',now),20000);assert.equal(retryAfterMs('Fri, 13 Nov 2026 12:01:00 GMT',now),60000);
  for(const value of ['soon','','-5','1.5','soon 2','1 2','2026-11-13','Friday, 13-Nov-26 12:01:00 GMT',undefined,null])assert.equal(retryAfterMs(value,now),null,String(value));
  assert.equal(retryAfterMs('9'.repeat(400),now),1e12,'huge values stay finite and are capped below');
  for(const [header,seconds] of [[null,60],['0',5],['99999',600],['9'.repeat(12),600],['Fri, 13 Nov 2026 11:00:00 GMT',5],['garbage',60],['-5',60],['1.5',60]]){
    const s=site(),time=clock(now),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
    const result=service.respond(route('https://riotpixels.net/a.jpg'));await tick();
    s.answer(0,new Response('',{status:429,headers:header===null?{}:{'retry-after':header}}));await result;
    assert.equal(service.snapshot().pausedSites[0].seconds,seconds,String(header));
  }
  // 503 pauses only with a usable Retry-After. Then the picture is asked for
  // again after the pause; without one it is remembered as a failure.
  for(const [headers,paused] of [[{'retry-after':'30'},true],[{'retry-after':'soon'},false],[{},false]]){
    const s=site(),time=clock(now),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
    const result=service.respond(route('https://riotpixels.net/a.jpg'));await tick();
    s.answer(0,new Response('',{status:503,headers}));await result;
    assert.equal(service.snapshot().pausedSites.length>0,paused,JSON.stringify(headers));assert.equal(counts(service,'riotpixels.net').serverError,1);
    time.advance(31000);
    const again=service.respond(route('https://riotpixels.net/a.jpg'));await tick();
    assert.equal(s.calls.length,paused?2:1,'asked again after the pause, or remembered as failed');
    if(paused){s.answer(1,jpegResponse());assert.equal((await again).status,200);}
    else assert.equal((await again).status,502);
  }
});

test('revisited pictures come from memory, within the cache limits, and expire',async()=>{
  let fetches=0;const time=clock();
  const service=createImageService({now:time.now,timers:time.timers,fetcher:async url=>{fetches++;return jpegResponse(url.includes('big')?LIMITS.cacheEntryBytes+1:1024*1024);}});
  assert.equal((await service.respond(route('https://riotpixels.net/a.jpg'))).status,200);
  assert.equal((await service.respond(route('https://riotpixels.net/a.jpg'))).status,200);
  assert.equal(fetches,1,'the second visit is served from memory');assert.equal(counts(service,'riotpixels.net').memory,1);
  assert.equal((await service.respond(route('https://riotpixels.net/big.jpg'))).status,200);
  await service.respond(route('https://riotpixels.net/big.jpg'));assert.equal(fetches,3,'pictures over 4 MB are shown but not kept');
  for(let i=0;i<60;i++)await service.respond(route(`https://riotpixels.net/page-${i}.jpg`));
  const cache=service.snapshot().cache;
  assert.ok(cache.bytes<=LIMITS.cacheBytes,'never more than the byte limit');assert.equal(cache.pictures,40);assert.equal(cache.limitBytes,40*1024*1024);
  const recent=fetches;await service.respond(route('https://riotpixels.net/page-59.jpg'));assert.equal(fetches,recent,'the newest stay');
  await service.respond(route('https://riotpixels.net/page-0.jpg'));assert.equal(fetches,recent+1,'the oldest were dropped');
  time.advance(LIMITS.cacheMs+1);await service.respond(route('https://riotpixels.net/page-59.jpg'));assert.equal(fetches,recent+2,'kept pictures expire');
  // Expired pictures leave memory on their own, without new requests.
  time.advance(LIMITS.cacheMs+LIMITS.sweepMs);
  assert.equal(service._state.cache.size,0);assert.equal(service.snapshot().cache.bytes,0);assert.equal(time.pending(),0,'the clean-up timer stops when nothing is left');
  // Many small pictures: the count limit applies too.
  let small=0;const many=createImageService({fetcher:async()=>{small++;return jpegResponse(10);}});
  for(let i=0;i<LIMITS.cacheEntries+50;i++)await many.respond(route(`https://riotpixels.net/s${i}.jpg`));
  assert.equal(many.snapshot().cache.pictures,LIMITS.cacheEntries);
});

test('a failed picture is not asked for again for two minutes, then tried again',async()=>{
  let fetches=0,missing=true;const time=clock();
  const service=createImageService({now:time.now,timers:time.timers,fetcher:async()=>{fetches++;return missing?new Response('gone',{status:404}):jpegResponse();}});
  assert.equal((await service.respond(route('https://riotpixels.net/gone.jpg'))).status,502);
  assert.equal((await service.respond(route('https://riotpixels.net/gone.jpg'))).status,502);
  assert.equal(fetches,1);assert.equal(counts(service,'riotpixels.net').recentFailure,1);
  time.advance(LIMITS.failureMs);missing=false;
  assert.equal((await service.respond(route('https://riotpixels.net/gone.jpg'))).status,200,'a temporary failure does not stay a placeholder');
  assert.equal(fetches,2);
  const pictures=service.snapshot().pictures;assert.equal(pictures.failedThenLoaded,1);assert.equal(pictures.stillFailing,0);assert.equal(pictures.firstFailureAfter,0);
  // Expired failures leave memory on their own too.
  missing=true;await service.respond(route('https://riotpixels.net/other.jpg'));assert.equal(service._state.failures.size,1);
  time.advance(LIMITS.failureMs+LIMITS.sweepMs);assert.equal(service._state.failures.size,0);
});

test('each failure is counted in its own category, by site, with no addresses in the summary',async()=>{
  const answers={
    'not-found':()=>new Response('',{status:404}),'refused':()=>new Response('',{status:403}),'teapot':()=>new Response('',{status:418}),
    'html':()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}),'fake':()=>new Response(Buffer.from('not a jpeg'),{headers:{'content-type':'image/jpeg'}}),
    'short':()=>new Response(JPEG(10),{headers:{'content-type':'image/jpeg','content-length':'99'}}),
    'dns':()=>{throw Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error('getaddrinfo ENOTFOUND'),{code:'ENOTFOUND'})});},
    'reset':()=>{throw Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error('socket hang up'),{code:'ECONNRESET'})});},
    'redirect':()=>{throw new Error('Only public HTTPS web addresses are supported.');},
    // net.cjs refuses a private address found by DNS inside fetch; the site's redirect loop is the site's reply.
    'private':()=>{throw Object.assign(new TypeError('fetch failed'),{cause:new Error('Private network destination blocked.')});},
    'loop':()=>{throw new Error('Too many host redirects.');}
  };
  const service=createImageService({fetcher:async url=>answers[new URL(url).pathname.slice(1)]()});
  for(const name of Object.keys(answers))assert.equal((await service.respond(route(`https://cdn${name.length}.example/${name}`))).status,502,name);
  assert.equal((await service.respond(route('https://127.0.0.1/private.jpg'))).status,502);
  assert.equal((await service.respond(new Request('atlas://app/image?url=x&url=y'))).status,502);
  // The window's request number must be a plain whole number, given once; nothing else is accepted.
  const picture=encodeURIComponent('https://cdn1.example/ok.jpg');
  for(const query of [`url=${picture}&r=0`,`url=${picture}&r=abc`,`url=${picture}&r=1e3`,`url=${picture}&r=1&r=2`,`url=${picture}&x=1`,`url=${picture}&r=${'9'.repeat(16)}`,`url=${encodeURIComponent('https://'+'a'.repeat(250)+'.example/a.jpg')}`])
    assert.equal((await service.respond(new Request('atlas://app/image?'+query))).status,502,query);
  const totals=Object.fromEntries(CATEGORIES.map(name=>[name,0]));
  for(const entry of service.snapshot().sites)for(const name of CATEGORIES)totals[name]+=entry.counts[name];
  assert.deepEqual({notFound:totals.notFound,refused:totals.refused,otherStatus:totals.otherStatus,notImage:totals.notImage,incomplete:totals.incomplete,dns:totals.dns,network:totals.network,blocked:totals.blocked},
    {notFound:1,refused:1,otherStatus:2,notImage:2,incomplete:1,dns:1,network:1,blocked:11});
  const text=JSON.stringify(service.snapshot());
  for(const word of ['/not-found','private.jpg','https://','redirect','?'])assert.ok(!text.includes(word),word);
  assert.equal(service.snapshot().pictures.stillFailing,9,'every network failure, not the refused addresses');
});

test('a slow picture times out and is counted as a timeout, not a cancellation',async()=>{
  const service=createImageService({timeoutMs:30,fetcher:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});
  // Node does not wait for timeout signals by themselves; the app's window keeps it running.
  const awake=setTimeout(()=>{},1000);
  try{assert.equal((await service.respond(route('https://riotpixels.net/slow.jpg'))).status,502);}finally{clearTimeout(awake);}
  const c=counts(service,'riotpixels.net');assert.equal(c.timeout,1);assert.equal(c.cancelled,0);
});

test('the summary lists at most 30 sites, then "other sites", paused sites included; idle sites are not kept',async()=>{
  const time=clock(),service=createImageService({fetcher:async()=>jpegResponse(),now:time.now,timers:time.timers});
  for(let i=0;i<40;i++)await service.respond(route(`https://site${i}.example/a.jpg`));
  const sites=service.snapshot().sites;
  assert.equal(sites.length,31);assert.equal(sites.at(-1).host,'other sites');assert.equal(sites.at(-1).counts.loaded,10);
  assert.equal(service._state.hosts.size,0);
  const busy=createImageService({fetcher:async url=>new Response('',{status:429,headers:{'retry-after':String(10+Number(new URL(url).hostname.match(/\d+/)[0]))}}),now:time.now,timers:time.timers});
  for(let i=0;i<200;i++)await busy.respond(route(`https://cover${i}.example/a.jpg`));
  const paused=busy.snapshot().pausedSites;
  assert.equal(paused.length,31);assert.deepEqual(paused.at(-1),{host:'other sites',seconds:209});
  time.advance(LIMITS.maxCooldownMs+LIMITS.sweepMs);
  assert.equal(busy.snapshot().pausedSites.length,0);assert.equal(busy._state.hosts.size,0,'sites are forgotten once their pause ends');
});

test('Electron never cancels a picture request, so the window reports pictures that left the page by number',async()=>{
  const s=site(),time=clock(),service=createImageService({fetcher:s.fetcher,now:time.now,timers:time.timers});
  // Two cards share a picture; the first leaves the page.
  const first=service.respond(route('https://riotpixels.net/shared.jpg',null,1));
  const second=service.respond(route('https://riotpixels.net/shared.jpg',null,2));
  await tick();assert.equal(s.calls.length,1);
  assert.equal(service.leave([1]),1);assert.equal((await first).status,502);assert.equal(s.calls[0].aborted,false,'still needed by the other card');
  assert.equal(service.leave([2]),1);assert.equal((await second).status,502);assert.equal(s.calls[0].aborted,true,'nobody needs it any more');
  assert.equal(service._state.inflight.size,0);assert.equal(service._state.tickets.size,0);
  // A waiting picture that left the page never starts.
  const running=[];for(let i=0;i<4;i++)running.push(service.respond(route(`https://riotpixels.net/r${i}.jpg`,null,10+i)));
  const queued=service.respond(route('https://riotpixels.net/queued.jpg',null,20));
  await tick();service.leave([20]);assert.equal((await queued).status,502);
  for(let i=1;i<=4;i++)s.calls[i].resolve(jpegResponse());
  for(const result of running)assert.equal((await result).status,200);
  assert.ok(!s.calls.some(call=>call.url.endsWith('/queued.jpg')));
  // A report that arrives before its request: the request is answered at once.
  assert.equal(service.leave([30]),0);
  assert.equal((await service.respond(route('https://riotpixels.net/late.jpg',null,30))).status,502);
  assert.ok(!s.calls.some(call=>call.url.endsWith('/late.jpg')));assert.equal(service._state.leftTickets.size,0);
  // A reported number is kept for a minute only: an old report never cancels a new picture.
  service.leave([31,32]);time.advance(LIMITS.leftTicketMs+1);
  const fresh=service.respond(route('https://riotpixels.net/fresh.jpg',null,31));await tick();
  assert.ok(s.calls.at(-1).url.endsWith('/fresh.jpg'));s.calls.at(-1).resolve(jpegResponse());assert.equal((await fresh).status,200);
  time.advance(LIMITS.sweepMs);assert.equal(service._state.leftTickets.size,0,'old reports are dropped');
  // A finished picture is not affected by a later report.
  const done=service.respond(route('https://riotpixels.net/done.jpg',null,40));await tick();s.calls.at(-1).resolve(jpegResponse());
  assert.equal((await done).status,200);service.leave([40]);
  assert.equal(counts(service,'riotpixels.net').cancelled,4);
  // Only plain numbers count, at most 500 per report, and unmatched ones are kept in a bounded list.
  assert.equal(service._state.leftTickets.size,1,'a late report is kept for a while, in a bounded list');
  for(const bad of [null,'1',{0:1},[0,-1,1.5,'x',2**60,NaN]])service.leave(bad);
  assert.equal(service._state.leftTickets.size,1);
  service.leave(Array.from({length:600},(_,i)=>1000+i));assert.equal(service._state.leftTickets.size,501);
  for(let i=0;i<5;i++)service.leave(Array.from({length:500},(_,j)=>10000+i*500+j));
  assert.equal(service._state.leftTickets.size,LIMITS.leftTickets);
});

test('25 pages of browsing with fast page changes, a throttling site and missing pictures stays bounded and recovers',async()=>{
  const time=clock(),fetched=new Map(),inFlight=new Set();
  let sinceWindow=0,windowStart=time.now(),throttled=0,maxInFlight=0,siteOpenAt=0,duringPause=0,raced=0;
  // RiotPixels-like site: allows 60 pictures a minute, then answers 429 with
  // Retry-After 20 and refuses everything until then. Pictures of games whose
  // number ends in 0 or 7 are missing. The cover site does not resolve.
  const fetcher=(url,options)=>new Promise((resolve,reject)=>{
    const u=new URL(url);fetched.set(url,(fetched.get(url)||0)+1);
    if(u.hostname==='i2.imageban.ru')return reject(Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}}));
    // A request sent while Ravenshelf already knew the site asked for a pause.
    // (One sent before the 429 reached Ravenshelf can still meet the pause.)
    if(service._state.hosts.get(u.hostname)?.cooldownUntil>time.now())duringPause++;
    if(time.now()<siteOpenAt){raced++;return resolve(new Response('',{status:429,headers:{'retry-after':String(Math.ceil((siteOpenAt-time.now())/1000))}}));}
    if(time.now()-windowStart>=60000){windowStart=time.now();sinceWindow=0;}
    if(++sinceWindow>60){throttled++;siteOpenAt=time.now()+20000;windowStart=siteOpenAt;sinceWindow=0;return resolve(new Response('',{status:429,headers:{'retry-after':'20'}}));}
    if(/game-\d*[07]\//.test(u.pathname))return resolve(new Response('',{status:404}));
    inFlight.add(url);maxInFlight=Math.max(maxInFlight,inFlight.size);
    const timer=setTimeout(()=>{inFlight.delete(url);resolve(jpegResponse(url.includes('240p')?2048:200*1024));},1);
    options.signal.addEventListener('abort',()=>{clearTimeout(timer);inFlight.delete(url);reject(options.signal.reason);},{once:true});
  });
  const service=createImageService({fetcher,now:time.now,timers:time.timers});
  let ticket=0;
  // A card tries its pictures one after another, as the window does. Like
  // Electron, the request's signal never aborts; the window reports numbers.
  async function card(game,page){
    for(const url of [`https://riotpixels.net/data/game-${game}/1.jpg.240p.jpg`,`https://riotpixels.net/data/game-${game}/2.jpg.240p.jpg`,`https://i2.imageban.ru/out/game-${game}.jpg`]){
      if(page.left)return 'left';
      const number=++ticket;page.tickets.add(number);
      const ok=(await service.respond(route(url,null,number))).status===200;
      page.tickets.delete(number);
      if(ok)return 'shown';
    }
    return page.left?'left':'placeholder';
  }
  // Lets the test clock run while pictures wait (for a pause, say).
  async function settle(promises){
    const states=promises.map(settled);
    for(let round=0;round<2000&&!states.every(state=>state.done);round++){await tick(2);if(!states.every(state=>state.done))time.advance(1000);}
    assert.ok(states.every(state=>state.done),'every card finishes');
    return Promise.all(promises);
  }
  async function visit(number,{leave=false}={}){
    const page={left:false,tickets:new Set()};
    const cards=Array.from({length:10},(_,i)=>card(number*10+i,page));
    if(leave){await tick(0);page.left=true;service.leave([...page.tickets]);}
    const outcome=await settle(cards);
    return {page:number,left:leave,shown:outcome.filter(x=>x==='shown').length,placeholders:outcome.filter(x=>x==='placeholder').length};
  }
  const visits=[];
  for(let page=1;page<=25;page++){visits.push(await visit(page,{leave:page%3===0}));time.advance(page%5===0?30000:2000);}
  for(let page=24;page>=15;page--){visits.push(await visit(page));time.advance(2000);}
  assert.ok(throttled>=2,`the site did throttle (${throttled})`);
  assert.ok(raced<=throttled*LIMITS.perHost,`only requests already on their way met a pause (${raced})`);
  assert.equal(duringPause,0,'no request is sent to a site Ravenshelf knows is paused');
  assert.ok(Math.max(...fetched.values())<=3,'no picture was requested again and again');
  assert.ok(maxInFlight<=LIMITS.perHost,'never more than four at once to one site');
  // Pictures waited out each pause instead of becoming placeholders: every
  // page that stayed open shows all its existing pictures.
  for(const v of visits.filter(v=>!v.left))assert.deepEqual([v.shown,v.placeholders],[8,2],`page ${v.page}`);
  // Revisiting recent pages is answered from memory.
  const before=[...fetched.values()].reduce((a,b)=>a+b,0),memoryBefore=counts(service,'riotpixels.net').memory;
  for(const page of [24,23,22])await visit(page);
  const after=[...fetched.values()].reduce((a,b)=>a+b,0);
  assert.equal(counts(service,'riotpixels.net').memory-memoryBefore,24,'revisits come from memory');
  assert.equal(after-before,0,'revisiting asked the network for nothing');
  // Pages left at once were cancelled by number and later show everything.
  assert.ok(counts(service,'riotpixels.net').cancelled>0,'fast page changes are counted as cancellations');
  time.advance(LIMITS.failureMs+61000);
  for(const page of [3,6,9]){const v=await visit(page);assert.deepEqual([v.shown,v.placeholders],[8,2],`page ${page} again`);}
  // Nothing is left running or waiting, and memory stays within its limits.
  await tick(10);
  assert.equal(service._state.inflight.size,0);assert.equal(service._state.tickets.size,0);
  for(const state of service._state.hosts.values()){assert.equal(state.running,0);assert.equal(state.queue.length,0);}
  const summary=service.snapshot();
  assert.ok(summary.cache.bytes<=LIMITS.cacheBytes&&summary.cache.pictures<=LIMITS.cacheEntries);
  assert.ok(summary.sites.find(entry=>entry.host==='i2.imageban.ru').counts.dns>0);
  time.advance(LIMITS.cacheMs+LIMITS.sweepMs);
  assert.equal(service._state.cache.size,0);assert.equal(service._state.failures.size,0);assert.equal(service._state.hosts.size,0);
});
