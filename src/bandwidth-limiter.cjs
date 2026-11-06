'use strict';
const {performance}=require('node:perf_hooks');

const MAX_BANDWIDTH_BYTES_PER_SECOND=1024*1024*1024;
const MAX_BURST_BYTES=256*1024;
const FAIR_SHARE_BYTES=16*1024;
const MAX_GRANTS_PER_TURN=32;

function normalizeBandwidthLimit(value){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Choose a whole-number download limit of zero or more bytes per second.');
  return Math.min(value,MAX_BANDWIDTH_BYTES_PER_SECOND);
}
function cancelled(){const error=new Error('Download bandwidth wait was cancelled.');error.name='AbortError';return error;}

// One instance belongs to the entire download manager, not to an individual
// file or connection. Credits are shared, and large chunks consume them in
// bounded turns so smaller requests cannot wait behind an unlimited chunk.
class BandwidthLimiter{
  constructor({bytesPerSecond=0,now=()=>performance.now(),setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}){
    this.now=now;this.setTimeoutFn=setTimeoutFn;this.clearTimeoutFn=clearTimeoutFn;
    this.rate=normalizeBandwidthLimit(bytesPerSecond);
    this.capacity=this.rate?Math.min(this.rate,MAX_BURST_BYTES):0;
    this.tokens=this.capacity;this.updatedAt=this.now();
    this.queue=[];this.timer=null;this.draining=false;this.stopped=false;
  }
  get pending(){return this.queue.length;}
  refill(){
    const now=Math.max(this.updatedAt,this.now());
    if(this.rate)this.tokens=Math.min(this.capacity,this.tokens+(now-this.updatedAt)*this.rate/1000);
    this.updatedAt=now;
  }
  setRate(value){
    const next=normalizeBandwidthLimit(value);
    if(this.stopped)throw new Error('The download bandwidth limiter has stopped.');
    this.refill();const previous=this.rate;
    this.rate=next;this.capacity=next?Math.min(next,MAX_BURST_BYTES):0;
    this.tokens=previous?Math.min(this.tokens,this.capacity):this.capacity;
    this.drain();return this.rate;
  }
  async consume(bytes,{signal,onWait}={}){
    if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('Invalid download byte count.');
    if(this.stopped)throw new Error('The download bandwidth limiter has stopped.');
    if(signal?.aborted)throw signal.reason||cancelled();
    if(!bytes||!this.rate)return;
    this.refill();
    if(!this.queue.length&&bytes<=this.tokens){this.tokens-=bytes;return;}
    return new Promise((resolve,reject)=>{
      const job={remaining:bytes,resolve,reject,signal,onWait,waiting:true,settled:false};
      job.abort=()=>{
        const index=this.queue.indexOf(job);if(index!==-1)this.queue.splice(index,1);
        this.settle(job,signal.reason||cancelled());this.drain();
      };
      this.queue.push(job);signal?.addEventListener('abort',job.abort,{once:true});
      this.notify(job,true);
      if(signal?.aborted)job.abort();else this.drain();
    });
  }
  notify(job,waiting){
    // Observability must not strand the queue if an optional callback fails.
    try{job.onWait?.(waiting);}catch{}
  }
  settle(job,error){
    if(job.settled)return;job.settled=true;
    job.signal?.removeEventListener('abort',job.abort);
    if(job.waiting){job.waiting=false;this.notify(job,false);}
    if(error)job.reject(error);else job.resolve();
  }
  clearTimer(){if(this.timer!==null){this.clearTimeoutFn(this.timer);this.timer=null;}}
  drain(){
    if(this.draining||this.stopped)return;
    this.draining=true;this.clearTimer();
    try{
      this.refill();let grants=0;
      while(this.queue.length&&grants++<MAX_GRANTS_PER_TURN){
        if(this.rate&&this.tokens<1)break;
        const job=this.queue.shift();
        if(!this.rate){this.settle(job);continue;}
        const credit=Math.min(job.remaining,Math.floor(this.tokens),FAIR_SHARE_BYTES,this.capacity);
        this.tokens-=credit;job.remaining-=credit;
        if(!job.remaining)this.settle(job);else this.queue.push(job);
      }
    }finally{
      this.draining=false;
      if(this.queue.length&&!this.stopped){
        const target=Math.min(this.queue[0].remaining,FAIR_SHARE_BYTES,this.capacity);
        const delay=!this.rate||this.tokens>=1?0:Math.max(1,Math.ceil((target-this.tokens)*1000/this.rate));
        // Keep the timer referenced while a caller is awaiting a bandwidth
        // credit; no interval or timer survives an empty/cancelled queue.
        this.timer=this.setTimeoutFn(()=>{this.timer=null;this.drain();},delay);
      }
    }
  }
  stop(){
    if(this.stopped)return;
    this.stopped=true;this.clearTimer();
    const jobs=this.queue.splice(0),error=new Error('The download bandwidth limiter has stopped.');
    for(const job of jobs)this.settle(job,error);
  }
}

module.exports={BandwidthLimiter,normalizeBandwidthLimit,MAX_BANDWIDTH_BYTES_PER_SECOND,MAX_BURST_BYTES};
