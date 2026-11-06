'use strict';
const MIN_COOLDOWN_MS=60000;
const MAX_RETRY_AFTER_MS=7*24*60*60*1000;
function hostKey(value){return new URL(value).hostname.toLowerCase();}
function retryAfterMilliseconds(value,now=Date.now()){
  if(typeof value!=='string'||!value.trim())return 0;
  const seconds=/^\d+$/.test(value.trim())?Number(value.trim()):null;
  const delay=seconds===null?Date.parse(value)-now:seconds*1000;
  return delay>0?Math.min(delay,8640000000000000-now):0;
}
class HostBackoffError extends Error{
  constructor(retryAt,status=429,automatic=true){super(`Host returned HTTP ${status}. Check the source link or retry.`);this.code='HOST_BACKOFF';this.retryAt=retryAt;this.status=status;this.automatic=automatic;}
}
class HostBackoff{
  constructor({now=Date.now}={}){this.now=now;this.hosts=new Map();}
  restore(value,{retryAt,status,failures=1}){
    if(!Number.isSafeInteger(retryAt)||retryAt<=this.now()-2*MIN_COOLDOWN_MS||retryAt>8640000000000000||![429,503].includes(status))return;
    const key=hostKey(value),previous=this.hosts.get(key);
    if(!previous||previous.retryAt<retryAt)this.hosts.set(key,{retryAt,status,failures:Math.max(1,Math.min(5,Number(failures)||1))});
  }
  policy(value){
    const key=hostKey(value),entry=this.hosts.get(key),now=this.now();
    if(!entry)return {key,retryAt:0,connectionLimit:4,limited:false};
    if(now>=entry.retryAt+2*MIN_COOLDOWN_MS){this.hosts.delete(key);return {key,retryAt:0,connectionLimit:4,limited:false};}
    return {key,retryAt:entry.retryAt,connectionLimit:now<entry.retryAt+MIN_COOLDOWN_MS?1:2,limited:true,status:entry.status};
  }
  assertAvailable(value){const policy=this.policy(value);if(policy.retryAt>this.now())throw new HostBackoffError(policy.retryAt,policy.status,policy.retryAt-this.now()<=MAX_RETRY_AFTER_MS);return policy;}
  failure(value,response){
    const key=hostKey(value),previous=this.hosts.get(key),failures=Math.min(5,(previous?.failures||0)+1),now=this.now();
    const retry=Math.max(MIN_COOLDOWN_MS*2**(failures-1),retryAfterMilliseconds(response.headers.get('retry-after'),now));
    const entry={failures,retryAt:Math.max(previous?.retryAt||0,now+retry),status:response.status};
    this.hosts.set(key,entry);
    return new HostBackoffError(entry.retryAt,entry.status,retry<=MAX_RETRY_AFTER_MS);
  }
  success(value){const entry=this.hosts.get(hostKey(value));if(entry&&this.now()>=entry.retryAt)entry.failures=0;}
}
module.exports={HostBackoff,HostBackoffError,hostKey,retryAfterMilliseconds,MIN_COOLDOWN_MS,MAX_RETRY_AFTER_MS};
