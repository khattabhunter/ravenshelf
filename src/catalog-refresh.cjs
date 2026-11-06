'use strict';

// Main-process polling is independent of Chromium's background-tab throttling.
// Requests, clocks and timers are injected so tests do not wait or access a site.
class CatalogRefresh {
  constructor({fetchLatest,onChange=()=>{},intervalMs=5*60*1000,clock=Date.now,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}) {
    if(typeof fetchLatest!=='function')throw new Error('Catalog refresh needs a fetch handler.');
    if(!Number.isFinite(intervalMs)||intervalMs<1||intervalMs>2147483647)throw new Error('Choose a valid catalog refresh interval.');
    this.fetchLatest=fetchLatest;this.onChange=onChange;this.intervalMs=intervalMs;this.clock=clock;
    this.setTimeoutFn=setTimeoutFn;this.clearTimeoutFn=clearTimeoutFn;
    this.enabled=false;this.checking=false;this.lastCheckedAt=null;this.lastAttemptAt=null;
    this.nextCheckMs=null;this.error='';this.revision=0;this.latest=null;this.fingerprint=null;
    this.timer=null;this.inFlight=null;this.generation=0;
  }
  snapshot(){
    return {enabled:this.enabled,checking:this.checking,lastCheckedAt:this.lastCheckedAt,lastAttemptAt:this.lastAttemptAt,
      nextCheckAt:this.nextCheckMs===null?null:new Date(this.nextCheckMs).toISOString(),intervalMs:this.intervalMs,
      error:this.error,revision:this.revision,latest:this.latest===null?null:structuredClone(this.latest)};
  }
  emit(){
    // A closed UI or failing observer must not terminate future checks.
    try{this.onChange(this.snapshot());}catch{}
  }
  clearTimer(){if(this.timer!==null){this.clearTimeoutFn(this.timer);this.timer=null;}}
  schedule(){
    this.clearTimer();
    if(!this.enabled||this.nextCheckMs===null)return;
    this.timer=this.setTimeoutFn(()=>{
      this.timer=null;
      // The elapsed timer remains authoritative even if the wall clock changed.
      this.check({force:true});
    },Math.max(1,this.nextCheckMs-this.clock()));
    this.timer?.unref?.();
  }
  start(){
    if(this.enabled)return this.check();
    this.enabled=true;this.generation++;
    if(this.inFlight){
      this.checking=true;this.emit();
      // Wait for a stopped generation to settle before beginning another fetch.
      return this.inFlight.then(()=>this.enabled?this.check():this.snapshot());
    }
    return this.check({force:true});
  }
  stop(){
    if(!this.enabled)return;
    this.enabled=false;this.generation++;this.checking=false;this.nextCheckMs=null;
    this.clearTimer();this.emit();
  }
  check({force=false}={}){
    if(!this.enabled)return Promise.resolve(this.snapshot());
    if(this.inFlight)return this.inFlight;
    const now=this.clock();
    if(!force&&this.nextCheckMs!==null&&now<this.nextCheckMs)return Promise.resolve(this.snapshot());
    this.clearTimer();this.checking=true;this.lastAttemptAt=new Date(now).toISOString();this.nextCheckMs=null;
    const generation=this.generation;
    const task=Promise.resolve().then(()=>this.enabled&&generation===this.generation?this.fetchLatest():null).then(result=>{
      if(!this.enabled||generation!==this.generation)return;
      if(!result||!Array.isArray(result.games))throw new Error('The catalogue response could not be read.');
      // The newest homepage should contain games. An empty parse often means a
      // challenge, missing page or changed markup, not that every game vanished.
      if(result.games.length===0)throw new Error('The newest catalogue response did not contain any games. Ravenshelf will retry automatically.');
      const latest=structuredClone(result),fingerprint=JSON.stringify(latest);
      if(fingerprint!==this.fingerprint){this.revision++;this.fingerprint=fingerprint;}
      this.latest=latest;this.lastCheckedAt=new Date(this.clock()).toISOString();this.error='';
    }).catch(error=>{
      if(this.enabled&&generation===this.generation)this.error=String(error?.message||'The catalogue could not be refreshed.').slice(0,900);
    }).finally(()=>{
      if(this.inFlight===task)this.inFlight=null;
      if(generation!==this.generation){
        if(this.enabled)this.check({force:true});
        return;
      }
      this.checking=false;
      if(this.enabled){this.nextCheckMs=this.clock()+this.intervalMs;this.schedule();this.emit();}
    }).then(()=>this.snapshot());
    this.inFlight=task;this.emit();return task;
  }
}

module.exports={CatalogRefresh};
