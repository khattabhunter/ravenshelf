'use strict';
const {performance}=require('node:perf_hooks');
const {isScanPending,scanCompletionBlocker,assertCompletionReady}=require('./completion-policy.cjs');

// Session-only queue action. No OS calls live here: production supplies a handler,
// and tests supply a recorder. Only a successfully completed queue can trigger it.
class CompletionAction {
  constructor({getDownloads,onExecute,onChange=()=>{},clock=()=>performance.now(),countdownMs=60000,autoTick=true}={}) {
    if(typeof getDownloads!=='function'||typeof onExecute!=='function')throw new Error('Completion action needs queue and action handlers.');
    this.getDownloads=getDownloads;this.onExecute=onExecute;this.onChange=onChange;this.clock=clock;
    this.countdownMs=countdownMs;this.autoTick=autoTick;this.timer=null;this.mode='none';this.phase='idle';
    this.targets=new Set();this.observedIds=new Set();this.deadline=null;this.message='Keep Ravenshelf open after downloads.';
  }
  snapshot(){
    const byId=new Map(this.getDownloads().map(d=>[d.id,d]));
    return {mode:this.mode,phase:this.phase,remainingSeconds:this.phase==='countdown'?Math.max(0,Math.ceil((this.deadline-this.clock())/1000)):null,
      targetCount:this.targets.size,completedCount:[...this.targets].filter(id=>byId.get(id)?.status==='completed').length,message:this.message};
  }
  emit(){this.onChange(this.snapshot());}
  arm(mode){
    if(mode==='none')return this.cancel();
    if(!['close','shutdown'].includes(mode))throw new Error('Choose keep open, close Ravenshelf, or turn off laptop.');
    if(this.phase==='executing')throw new Error('The completion action is already running.');
    const queue=this.getDownloads(),pending=queue.filter(d=>!['completed','cancelled'].includes(d.status)||isScanPending(d));
    if(!pending.length)throw new Error('Add downloads before choosing an action. Completed history cannot trigger it.');
    this.clearTimer();this.mode=mode;this.phase='armed';this.targets=new Set(pending.map(d=>d.id));this.observedIds=new Set(queue.map(d=>d.id));this.deadline=null;
    this.message=mode==='shutdown'?'Turn off laptop after every queued file completes successfully.':'Close Ravenshelf after every queued file completes successfully.';
    if(this.autoTick){this.timer=setInterval(()=>this.tick(),1000);this.timer.unref?.();}
    this.emit();return this.snapshot();
  }
  clearTimer(){if(this.timer){clearInterval(this.timer);this.timer=null;}}
  cancel(message='Keep Ravenshelf open after downloads.'){
    if(this.phase==='executing')throw new Error('The completion action has already started.');
    this.clearTimer();this.mode='none';this.phase='idle';this.targets.clear();this.observedIds.clear();this.deadline=null;this.message=message;this.emit();return this.snapshot();
  }
  refresh(){return this.tick();}
  tick(){
    if(this.mode==='none'||this.phase==='executing')return;
    const queue=this.getDownloads(),byId=new Map(queue.map(d=>[d.id,d]));
    // Remember history present when armed, so a new job still joins the queue if
    // it finishes (or is cancelled) before the next observation.
    let addedWork=false;
    for(const d of queue){
      if(!this.observedIds.has(d.id)||!['completed','cancelled'].includes(d.status)||isScanPending(d)){
        if(!this.targets.has(d.id))addedWork=true;
        this.targets.add(d.id);
      }
      this.observedIds.add(d.id);
    }
    if(addedWork&&this.phase==='countdown'){this.phase='armed';this.deadline=null;}
    if([...this.targets].some(id=>!byId.has(id)||byId.get(id).status==='cancelled')){
      this.cancel('Completion action cancelled because a queued download was cancelled or removed.');return;
    }
    const unfinished=[...this.targets].map(id=>byId.get(id)).filter(d=>d.status!=='completed');
    if(unfinished.length){
      this.phase='armed';this.deadline=null;
      this.message=unfinished.some(d=>d.status==='error')?'Waiting for failed downloads to be retried and completed.':unfinished.some(d=>d.status==='paused')?'Waiting for paused downloads to resume and complete.':
        this.mode==='shutdown'?'Laptop shutdown is armed for this queue.':'Close Ravenshelf is armed for this queue.';
      this.emit();return;
    }
    if(!this.targets.size){this.cancel();return;}
    const scanBlocker=scanCompletionBlocker([...this.targets].map(id=>byId.get(id)));
    if(scanBlocker){
      this.phase='armed';this.deadline=null;this.message=scanBlocker.message;this.emit();return;
    }
    if(this.phase!=='countdown'){
      this.phase='countdown';this.deadline=this.clock()+this.countdownMs;
      this.message=this.mode==='shutdown'?'All queued files completed. Laptop shutdown is counting down.':'All queued files completed. Ravenshelf will close after the countdown.';
      this.emit();return;
    }
    if(this.clock()<this.deadline){this.emit();return;}
    const mode=this.mode,ids=[...this.targets];this.phase='executing';this.clearTimer();this.message=mode==='shutdown'?'Requesting Windows shutdown…':'Closing Ravenshelf…';this.emit();
    Promise.resolve().then(()=>{assertCompletionReady(this.getDownloads(),ids);return this.onExecute(mode,{ids});}).then(()=>{
      this.mode='none';this.phase='idle';this.targets.clear();this.observedIds.clear();this.deadline=null;this.message='Completion action was requested.';this.emit();
    }).catch(err=>{
      this.mode='none';this.phase='error';this.deadline=null;this.targets.clear();this.observedIds.clear();this.message=err.message||'The completion action could not run.';this.emit();
    });
  }
  dispose(){this.clearTimer();this.mode='none';this.phase='idle';this.targets.clear();this.observedIds.clear();this.deadline=null;}
}
module.exports={CompletionAction};
