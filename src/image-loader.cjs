'use strict';
const crypto=require('node:crypto');
const {safeFetch,safeURL}=require('./net.cjs');

const MAX_IMAGE_BYTES=12*1024*1024;
const IMAGE_TIMEOUT_MS=15000;
const TYPES=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const RESPONSE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
// How pictures are fetched and kept. Everything here lives in memory only and
// is gone when Ravenshelf closes. The cache limit counts downloaded bytes; the
// window's decoded pictures use more memory than that, and are not counted.
const LIMITS=Object.freeze({
  perHost:4,                     // pictures fetched at the same time from one site
  cacheBytes:40*1024*1024,       // downloaded pictures kept for revisits
  cacheEntries:400,
  cacheEntryBytes:4*1024*1024,   // larger pictures are shown but not kept
  cacheMs:30*60*1000,
  failureMs:2*60*1000,           // a failed picture is tried again after this
  failureEntries:1000,
  cooldownMs:60*1000,            // pause after "too many requests" without a time
  minCooldownMs:5*1000,
  maxCooldownMs:10*60*1000,
  maxWaitMs:90*1000,             // longest a picture waits for its turn, pauses included
  sweepMs:60*1000,               // expired pictures and failures are dropped this often
  hosts:30,                      // sites listed separately in the summary
  tracked:2000,                  // pictures remembered for "failed, then loaded"
  leftTickets:2000,              // pictures that left the page before their request came
  leftTicketMs:60*1000           // ...kept this long, in case the request is still coming
});
// What happened to each picture request. Counts only; no addresses.
const CATEGORIES=Object.freeze(['loaded','memory','cancelled','notFound','refused','tooMany','serverError','otherStatus','timeout','dns','network','notImage','tooLarge','incomplete','blocked','cooldown','busy','recentFailure']);
// Failures worth remembering for a short while, so a missing picture is not
// requested again on every page visit.
const REMEMBERED=new Set(['notFound','refused','serverError','otherStatus','timeout','dns','network','notImage','tooLarge','incomplete','blocked']);
const NETWORK_FAILURES=new Set(['notFound','refused','tooMany','serverError','otherStatus','timeout','dns','network','notImage','tooLarge','incomplete']);

class ImageFailure extends Error{
  constructor(category,{retryAfter=null}={}){super('Image unavailable.');this.category=category;this.retryAfter=retryAfter;}
}
function hasRasterSignature(bytes,type){
  if(type==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(type==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/gif')return bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
  if(type==='image/webp')return bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}
function withAbort(promise,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>signal.removeEventListener('abort',abort);
    const abort=()=>{cleanup();reject(signal.reason||new Error('Image request cancelled.'));};
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}
function cancelBody(body){try{void body?.cancel().catch(()=>{});}catch{}}
// Retry-After: whole seconds or an HTTP date (RFC 9110). Anything else is
// unusable and falls back to the default.
const HTTP_DATE=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
function retryAfterMs(value,now){
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(/^\d+$/.test(text))return Math.min(Number(text),1e9)*1000;
  if(!HTTP_DATE.test(text))return null;
  const at=Date.parse(text);
  return Number.isFinite(at)?at-now:null;
}
function cooldownFor(retryAfter){
  const wanted=Number.isFinite(retryAfter)?retryAfter:LIMITS.cooldownMs;
  return Math.min(LIMITS.maxCooldownMs,Math.max(LIMITS.minCooldownMs,wanted));
}
// The checked picture address of an atlas://app/image request, and the
// window's number for this picture request, if it gave one (see leave()).
function checkedTarget(request){
  let route;try{route=new URL(request.url);}catch{throw new ImageFailure('blocked');}
  const params=route.searchParams,raw=params.get('r');
  if(route.protocol!=='atlas:'||route.host!=='app'||route.pathname!=='/image'||route.username||route.password||route.hash||
    !params.has('url')||params.getAll('url').length!==1||params.size!==(params.has('r')?2:1)||request.method!=='GET')throw new ImageFailure('blocked');
  const ticket=raw===null?null:ticketOf(raw);
  if(raw!==null&&ticket===null)throw new ImageFailure('blocked');
  let target;try{target=safeURL(params.get('url'));}catch{throw new ImageFailure('blocked');}
  // A site name longer than DNS allows can't be a real picture site.
  if(target.hostname.length>253)throw new ImageFailure('blocked');
  target.hash='';
  return {target,ticket};
}
// Picture request numbers are whole numbers the window counts up from 1.
function ticketOf(value){
  const text=String(value);
  if(!/^[1-9]\d{0,14}$/.test(text))return null;
  const number=Number(text);
  return Number.isSafeInteger(number)?number:null;
}
// Refusals by Ravenshelf's own address checks (net.cjs), as opposed to the
// site's behaviour.
const SAFETY_REFUSALS=new Set(['Private network destination blocked.','No compatible public address.','Only public HTTPS web addresses are supported.','Invalid web address.']);
const SITE_REPLIES=new Set(['Host returned a redirect without a destination.','Too many host redirects.']);
// Why a request failed, in one of the summary's categories.
function failureCategory(error,deadline){
  if(error instanceof ImageFailure)return error.category;
  if(deadline?.aborted||error?.name==='TimeoutError')return 'timeout';
  const codes=[],messages=[];let cause=error;
  for(let depth=0;cause&&depth<5;depth++){if(typeof cause.code==='string')codes.push(cause.code);if(typeof cause.message==='string')messages.push(cause.message);cause=cause.cause;}
  if(messages.some(message=>SAFETY_REFUSALS.has(message)))return 'blocked';
  if(messages.some(message=>SITE_REPLIES.has(message)))return 'otherStatus';
  if(codes.some(code=>['ENOTFOUND','EAI_AGAIN','EAI_NONAME','EAI_NODATA','EAI_FAIL'].includes(code)))return 'dns';
  if(codes.some(code=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)))return 'timeout';
  // safeFetch refuses unsafe addresses and redirects with plain errors before
  // or instead of a network request.
  if(error&&!(error instanceof TypeError)&&!error.cause)return 'blocked';
  return 'network';
}
function statusCategory(status){
  if(status===404||status===410)return 'notFound';
  if(status===401||status===403)return 'refused';
  if(status===429)return 'tooMany';
  if(status>=500&&status<=599)return 'serverError';
  return 'otherStatus';
}
// One bounded, cookie-free request for a picture. safeFetch validates every
// redirect and the addresses used by sockets.
async function fetchImage(target,{fetcher,signal,deadline,maxBytes,wallNow}){
  let response,reader;
  try{
    response=await withAbort(fetcher(target.href,{
      method:'GET',headers:{Accept:'image/png,image/jpeg,image/gif,image/webp','Accept-Encoding':'identity'},
      credentials:'omit',referrerPolicy:'no-referrer',signal,timeoutMs:0
    }),signal);
    if(response.status!==200||!response.body){
      const category=response.status===200?'incomplete':statusCategory(response.status);
      throw new ImageFailure(category,{retryAfter:category==='tooMany'||response.status===503?retryAfterMs(response.headers.get('retry-after'),wallNow()):null});
    }
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const encoding=(response.headers.get('content-encoding')||'identity').trim().toLowerCase();
    if(!TYPES.has(type)||encoding!=='identity')throw new ImageFailure('notImage');
    const rawLength=response.headers.get('content-length');
    const declared=rawLength===null?null:Number(rawLength);
    if(rawLength!==null&&!/^\d+$/.test(rawLength))throw new ImageFailure('incomplete');
    if(rawLength!==null&&(!Number.isSafeInteger(declared)||declared>maxBytes))throw new ImageFailure('tooLarge');
    reader=response.body.getReader();
    const chunks=[];let total=0;
    while(true){
      const {done,value}=await withAbort(reader.read(),signal);
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes)throw new ImageFailure('tooLarge');
      chunks.push(Buffer.from(value));
    }
    if(!total||(declared!==null&&declared!==total))throw new ImageFailure('incomplete');
    const bytes=Buffer.concat(chunks,total);
    if(!hasRasterSignature(bytes,type))throw new ImageFailure('notImage');
    return {type,bytes};
  }catch(error){
    if(error instanceof ImageFailure)throw error;
    if(signal.aborted&&!deadline.aborted)throw new ImageFailure('cancelled');
    throw new ImageFailure(failureCategory(error,deadline));
  }finally{
    if(reader){try{void reader.cancel().catch(()=>{});reader.releaseLock();}catch{}}
    else cancelBody(response?.body);
  }
}
const okResponse=({type,bytes})=>new Response(bytes,{headers:{...RESPONSE_HEADERS,'Content-Type':type,'Content-Length':String(bytes.length)}});
// Do not reflect private URLs, request headers, or system error paths.
const failedResponse=()=>new Response('Image unavailable',{status:502,headers:{...RESPONSE_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
const keyOf=href=>crypto.createHash('sha256').update(href).digest('hex').slice(0,32);
const emptyCounts=()=>Object.fromEntries(['fetches',...CATEGORIES].map(name=>[name,0]));

// Remote pictures enter the window only through this service. Cards that show
// the same picture share one request, which is cancelled only when no card
// needs it any more. Each site gets a few requests at a time, in the order
// they were asked for. A site that says "too many requests" gets no request
// until its pause ends: pictures wait for it, but never longer than
// maxWaitMs, so a card can always move on to its next picture.
//
// Electron does not tell this service when the window stops needing a
// picture (request.signal is never aborted when a picture leaves the page),
// so the window numbers its picture requests and reports the ones that left
// the page through leave().
//
// Waits, pauses and expiry use a steady clock (now), so changing the PC's
// clock can't stretch or skip them; wallNow is only for HTTP dates and the
// summary's start time.
function createImageService({fetcher=safeFetch,maxBytes=MAX_IMAGE_BYTES,timeoutMs=IMAGE_TIMEOUT_MS,now=()=>performance.now(),wallNow=Date.now,limits={},timers={setTimeout,clearTimeout}}={}){
  const limit={...LIMITS,...limits};
  const validLimits=Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=MAX_IMAGE_BYTES&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=IMAGE_TIMEOUT_MS;
  const startedAt=wallNow();
  const cache=new Map();let cacheBytes=0;
  const failures=new Map(),inflight=new Map(),hosts=new Map(),stats=new Map(),tracked=new Map(),tickets=new Map(),leftTickets=new Map();
  let loadedBeforeFailure=0,firstFailureAfter=null,sweptAt=now(),sweepTimer=null;
  // Timers never keep Ravenshelf (or a test run) alive on their own.
  const later=(fn,ms)=>{const timer=timers.setTimeout(fn,Math.max(0,ms));timer?.unref?.();return timer;};
  const hostState=host=>{let state=hosts.get(host);if(!state){state={running:0,queue:[],cooldownUntil:0,timer:null};hosts.set(host,state);}return state;};
  const paused=state=>Boolean(state)&&state.cooldownUntil>now();
  const statsFor=host=>{
    let entry=stats.get(host);
    if(!entry&&stats.size>=limit.hosts)entry=stats.get('other sites')||(stats.set('other sites',emptyCounts()),stats.get('other sites'));
    if(!entry){entry=emptyCounts();stats.set(host,entry);}
    return entry;
  };
  const listedSite=host=>stats.has(host)&&host!=='other sites'?host:'other sites';
  const count=(host,category)=>{statsFor(host)[category]++;};
  const track=(href,ok)=>{
    const key=keyOf(href),entry=tracked.get(key)||{failed:false,recovered:false};
    if(ok){if(entry.failed)entry.recovered=true;}else entry.failed=true;
    tracked.delete(key);tracked.set(key,entry);
    while(tracked.size>limit.tracked)tracked.delete(tracked.keys().next().value);
  };
  // Expired pictures and failures are dropped on a timer too, so nothing
  // stays in memory past its time just because no new picture was asked for.
  function sweep(force=false){
    const time=now();
    if(!force&&time-sweptAt<limit.sweepMs)return;
    sweptAt=time;
    for(const [key,entry] of cache)if(time-entry.at>limit.cacheMs){cache.delete(key);cacheBytes-=entry.bytes.length;}
    for(const [key,entry] of failures)if(time>=entry.until)failures.delete(key);
    for(const [ticket,at] of leftTickets)if(time-at>limit.leftTicketMs)leftTickets.delete(ticket);
    for(const host of [...hosts.keys()])prune(host);
  }
  function armSweep(){
    if(sweepTimer)return;
    sweepTimer=later(()=>{sweepTimer=null;sweep(true);if(cache.size||failures.size||hosts.size||leftTickets.size)armSweep();},limit.sweepMs);
  }
  function cacheGet(key){
    const entry=cache.get(key);if(!entry)return null;
    cache.delete(key);
    if(now()-entry.at>limit.cacheMs){cacheBytes-=entry.bytes.length;return null;}
    cache.set(key,entry);return entry;
  }
  function cachePut(key,result){
    if(result.bytes.length>limit.cacheEntryBytes)return;
    const old=cache.get(key);if(old){cache.delete(key);cacheBytes-=old.bytes.length;}
    cache.set(key,{...result,at:now()});cacheBytes+=result.bytes.length;
    while(cacheBytes>limit.cacheBytes||cache.size>limit.cacheEntries){const [oldest,entry]=cache.entries().next().value;cache.delete(oldest);cacheBytes-=entry.bytes.length;}
    armSweep();
  }
  function failureGet(key){
    const entry=failures.get(key);if(!entry)return null;
    if(now()>=entry.until){failures.delete(key);return null;}
    return entry;
  }
  function failurePut(key,category){
    failures.delete(key);failures.set(key,{category,until:now()+limit.failureMs});
    while(failures.size>limit.failureEntries)failures.delete(failures.keys().next().value);
    armSweep();
  }
  // A site's state is kept only while it has requests, waiting pictures or a pause.
  function prune(host){
    const state=hosts.get(host);
    if(state&&!state.running&&!state.queue.length&&!paused(state)){if(state.timer)timers.clearTimeout(state.timer);hosts.delete(host);}
  }
  // Starts waiting pictures while the site has room and is not paused.
  function pump(host){
    const state=hosts.get(host);if(!state)return;
    if(paused(state)){
      if(!state.timer&&state.queue.length)state.timer=later(()=>{state.timer=null;pump(host);},state.cooldownUntil-now());
      return;
    }
    while(state.running<limit.perHost&&state.queue.length){
      const next=state.queue.shift();
      timers.clearTimeout(next.timer);next.job.dequeue=null;state.running++;next.resolve();
    }
    prune(host);
  }
  function startCooldown(host,retryAfter){
    const state=hostState(host);
    state.cooldownUntil=Math.max(state.cooldownUntil,now()+cooldownFor(retryAfter));
    // Pictures that can't wait that long give up now, without a request.
    for(const waiter of [...state.queue])if(waiter.job.waitUntil<state.cooldownUntil)waiter.giveUp('cooldown');
    armSweep();
  }
  function acquire(job){
    const state=hostState(job.host);
    if(state.running<limit.perHost&&!state.queue.length&&!paused(state)){state.running++;return Promise.resolve();}
    return new Promise((resolve,reject)=>{
      const waiter={job,resolve,timer:null};
      const remove=()=>{const index=state.queue.indexOf(waiter);if(index<0)return false;state.queue.splice(index,1);timers.clearTimeout(waiter.timer);return true;};
      waiter.giveUp=category=>{if(remove()){job.dequeue=null;reject(new ImageFailure(category));prune(job.host);}};
      // A request nobody waits for any more leaves the line and ends.
      job.dequeue=()=>waiter.giveUp('cancelled');
      // Nobody waits in line for ever, so the card can try its next picture.
      waiter.timer=later(()=>waiter.giveUp(paused(state)?'cooldown':'busy'),job.waitUntil-now());
      state.queue.push(waiter);
      pump(job.host);
    });
  }
  function release(host){
    const state=hosts.get(host);if(!state)return;
    state.running--;pump(host);
  }
  async function run(job){
    for(;;){
      try{await acquire(job);}finally{job.dequeue=null;}
      const state=hosts.get(job.host);
      if(job.controller.signal.aborted||!paused(state))break;
      // The site was paused after this picture's turn came: back in line,
      // unless the pause outlasts the picture's wait.
      state.running--;
      if(job.waitUntil<state.cooldownUntil)throw new ImageFailure('cooldown');
    }
    try{
      if(job.controller.signal.aborted)throw new ImageFailure('cancelled');
      const deadline=AbortSignal.timeout(timeoutMs);
      const signal=AbortSignal.any([job.controller.signal,deadline]);
      statsFor(job.host).fetches++;
      return await fetchImage(job.target,{fetcher,signal,deadline,maxBytes,wallNow});
    }catch(error){
      // The pause starts before this request's place is handed on, so no
      // waiting picture from the same site starts in between.
      if(pausesSite(error))startCooldown(job.host,error.retryAfter);
      throw error;
    }finally{release(job.host);}
  }
  function start(key,target,host){
    const job={key,target,host,controller:new AbortController(),subscribers:0,dequeue:null,waitUntil:now()+limit.maxWaitMs};
    job.promise=run(job).then(result=>{
      cachePut(key,result);track(key,true);loadedBeforeFailure++;
      return result;
    },error=>{
      const category=(error instanceof ImageFailure)?error.category:'network';
      if(NETWORK_FAILURES.has(category)){track(key,false);if(firstFailureAfter===null)firstFailureAfter=loadedBeforeFailure;}
      // A site that asked for a pause is asked again after it; the picture
      // itself is not remembered as failed.
      if(REMEMBERED.has(category)&&!pausesSite(error))failurePut(key,category);
      throw error;
    }).finally(()=>{if(inflight.get(key)===job)inflight.delete(key);});
    job.promise.catch(()=>{});
    inflight.set(key,job);
    return job;
  }
  // A card waits for the shared request. Leaving the card cancels only its
  // own wait; the request is cancelled when no card is waiting any more.
  function subscribe(job,signal,ticket){
    job.subscribers++;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const cleanup=()=>{
        signal?.removeEventListener('abort',leave);
        const waiting=ticket===null?null:tickets.get(ticket);
        if(waiting){waiting.delete(leave);if(!waiting.size)tickets.delete(ticket);}
      };
      const leave=()=>{
        if(settled)return;settled=true;cleanup();
        job.subscribers--;
        if(job.subscribers===0){
          if(inflight.get(job.key)===job)inflight.delete(job.key);
          job.dequeue?.();
          job.controller.abort();
        }
        reject(new ImageFailure('cancelled'));
      };
      const finish=(fn,value)=>{if(settled)return;settled=true;cleanup();fn(value);};
      if(signal){if(signal.aborted)return leave();signal.addEventListener('abort',leave,{once:true});}
      if(ticket!==null){let waiting=tickets.get(ticket);if(!waiting){waiting=new Set();tickets.set(ticket,waiting);}waiting.add(leave);}
      job.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
  async function respond(request){
    let host='invalid requests';
    try{
      if(!validLimits)throw new ImageFailure('blocked');
      sweep();
      const {target,ticket}=checkedTarget(request);host=target.hostname;const key=target.href;
      if(ticket!==null&&leftTickets.has(ticket)){
        const fresh=now()-leftTickets.get(ticket)<=limit.leftTicketMs;leftTickets.delete(ticket);
        if(fresh)throw new ImageFailure('cancelled');
      }
      const cached=cacheGet(key);
      if(cached){count(host,'memory');return okResponse(cached);}
      if(request.signal?.aborted)throw new ImageFailure('cancelled');
      if(failureGet(key))throw new ImageFailure('recentFailure');
      // Waiting is pointless when the pause outlasts the longest wait.
      const state=hosts.get(host);
      if(paused(state)&&state.cooldownUntil-now()>limit.maxWaitMs)throw new ImageFailure('cooldown');
      const job=inflight.get(key)||start(key,target,host);
      const result=await subscribe(job,request.signal,ticket);
      count(host,'loaded');
      return okResponse(result);
    }catch(error){
      count(host,(error instanceof ImageFailure)?error.category:'network');
      return failedResponse();
    }
  }
  // The window reports picture requests it no longer needs (pictures that
  // left the page). A number not seen yet is kept for a while, in case its
  // request arrives after the report.
  function leave(numbers){
    if(!Array.isArray(numbers))return 0;
    let cancelled=0;
    for(const value of numbers.slice(0,500)){
      const ticket=ticketOf(value);if(ticket===null)continue;
      const waiting=tickets.get(ticket);
      if(waiting){for(const fn of [...waiting])fn();cancelled++;continue;}
      leftTickets.delete(ticket);leftTickets.set(ticket,now());
      while(leftTickets.size>limit.leftTickets)leftTickets.delete(leftTickets.keys().next().value);
    }
    if(leftTickets.size)armSweep();
    return cancelled;
  }
  // A local summary for Settings: sites, categories and counts only.
  function snapshot(){
    sweep(true);
    let failedThenLoaded=0,stillFailing=0;
    for(const entry of tracked.values()){if(entry.recovered)failedThenLoaded++;else if(entry.failed)stillFailing++;}
    // Paused sites use the same names as the list: the first 30, then "other sites".
    const time=now(),pausedSites=new Map();
    for(const [host,state] of hosts){
      if(state.cooldownUntil<=time)continue;
      const name=listedSite(host),seconds=Math.ceil((state.cooldownUntil-time)/1000);
      pausedSites.set(name,Math.max(pausedSites.get(name)||0,seconds));
    }
    return {
      since:new Date(startedAt).toISOString(),
      sites:[...stats].map(([host,counts])=>({host,counts:{...counts}})),
      pictures:{failedThenLoaded,stillFailing,firstFailureAfter},
      pausedSites:[...pausedSites].map(([host,seconds])=>({host,seconds})),
      cache:{pictures:cache.size,bytes:cacheBytes,limitBytes:limit.cacheBytes}
    };
  }
  return {respond,leave,snapshot,_state:{cache,failures,inflight,hosts,tickets,leftTickets}};
}
// 429, or 503 with a usable Retry-After, pauses the whole site.
function pausesSite(error){
  return (error instanceof ImageFailure)&&(error.category==='tooMany'||(error.category==='serverError'&&Number.isFinite(error.retryAfter)));
}

// A one-off request with the same checks, used where no shared service exists.
async function imageResponse(request,options={}){return createImageService(options).respond(request);}

module.exports={createImageService,imageResponse,MAX_IMAGE_BYTES,IMAGE_TIMEOUT_MS,LIMITS,CATEGORIES,retryAfterMs};
