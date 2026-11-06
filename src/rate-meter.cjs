'use strict';
const {performance}=require('node:perf_hooks');

// A recent average of cumulative bytes. Call from a timer, including during
// quiet periods; network chunk boundaries do not determine the displayed rate.
class RateMeter {
  constructor({windowMs=5000,sampleMs=500,clock=()=>performance.now()}={}) {
    if(!Number.isFinite(windowMs)||!Number.isFinite(sampleMs)||sampleMs<=0||windowMs<sampleMs) {
      throw new Error('The rate window must be at least one positive sample interval.');
    }
    if(typeof clock!=='function')throw new Error('A clock function is required.');
    this.windowMs=windowMs;
    this.sampleMs=sampleMs;
    this.clock=clock;
    this.reset();
  }
  reset(totalBytes=0) {
    this.validateBytes(totalBytes);
    const at=this.clock();
    if(!Number.isFinite(at))throw new Error('The rate clock must return a finite time.');
    this.startedAt=at;
    this.points=[{at,totalBytes}];
    this.speed=0;
    return this.speed;
  }
  validateBytes(value) {
    if(!Number.isFinite(value)||value<0)throw new Error('The byte count must be finite and non-negative.');
  }
  sample(totalBytes) {
    this.validateBytes(totalBytes);
    const at=this.clock();
    if(!Number.isFinite(at))throw new Error('The rate clock must return a finite time.');
    const previous=this.points[this.points.length-1];
    // A restarted file or discontinuous clock starts a fresh measurement.
    if(totalBytes<previous.totalBytes||at<previous.at)return this.reset(totalBytes);
    if(at-previous.at<this.sampleMs)return this.speed;
    this.points.push({at,totalBytes});
    const boundary=Math.max(this.startedAt,at-this.windowMs);
    // Preserve one sample preceding the window for boundary interpolation.
    while(this.points.length>2&&this.points[1].at<=boundary)this.points.shift();
    const first=this.points[0],next=this.points[1];
    let baseline=first.totalBytes;
    if(first.at<boundary&&next) {
      const fraction=(boundary-first.at)/(next.at-first.at);
      baseline+=(next.totalBytes-first.totalBytes)*fraction;
    }
    const elapsed=at-boundary;
    this.speed=elapsed>0?Math.max(0,(totalBytes-baseline)*1000/elapsed):0;
    return this.speed;
  }
}

module.exports={RateMeter};
