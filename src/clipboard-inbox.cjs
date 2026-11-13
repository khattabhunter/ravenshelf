'use strict';
const crypto=require('node:crypto');
const {isPasteHost,isPixeldrainHost,isMultiupHost}=require('./hosts.cjs');
// Hosts with subdomains (file servers); PixelDrain, MultiUpload and the paste sites only at their own addresses.
const ROOTS=['fuckingfast.co','fuckingfast.net','filekeeper.net','datanodes.to','datanodes.in','datanodes.com'];
const recognized=host=>ROOTS.some(h=>host===h||host.endsWith('.'+h))||isPasteHost(host)||isPixeldrainHost(host)||isMultiupHost(host);
function recognizedLinks(text){
  if(typeof text!=='string'||text.length>32768)return [];
  const result=[];
  for(const raw of text.match(/https:\/\/[^\s<>"']+/g)||[]){
    if(raw.length>8192)continue;
    try{const u=new URL(raw.replace(/[),.;]+$/,''));if(u.username||u.password||(u.port&&u.port!=='443')||!recognized(u.hostname))continue;if(isPasteHost(u.hostname)&&!u.hash)continue;result.push(u.href);}catch{}
  }
  return [...new Set(result)].slice(0,50);
}
class ClipboardInbox{
  constructor({readText,onChange=()=>{},now=Date.now,intervalMs=1500}={}){this.readText=readText;this.onChange=onChange;this.now=now;this.intervalMs=intervalMs;this.enabled=false;this.items=[];this.timer=null;this.lastDigest='';}
  configure(enabled){
    this.enabled=enabled===true;clearInterval(this.timer);this.timer=null;
    if(this.enabled){this.timer=setInterval(()=>this.poll(),this.intervalMs);this.timer.unref?.();}
    else{this.items=[];this.lastDigest='';}this.onChange();
  }
  poll(){
    if(!this.enabled)return;
    try{
      const text=this.readText();if(typeof text!=='string'||text.length>32768)return;
      const digest=crypto.createHash('sha256').update(text).digest('hex');if(digest===this.lastDigest)return;this.lastDigest=digest;
      this.items=this.items.filter(x=>this.now()-x.detectedAt<30*60*1000);
      for(const url of recognizedLinks(text))if(!this.items.some(x=>x.url===url))this.items.push({id:crypto.randomUUID(),url,detectedAt:this.now()});
      this.items=this.items.slice(-100);this.onChange();
    }catch{/* Clipboard contention is transient; never log clipboard contents. */}
  }
  snapshot(){return {enabled:this.enabled,items:this.items.filter(x=>this.now()-x.detectedAt<30*60*1000).map(x=>({...x}))};}
  selection(ids){if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=='string'))throw new Error('Choose links from the detected-links tray.');const wanted=new Set(ids);return this.snapshot().items.filter(x=>wanted.has(x.id));}
  dismiss(ids){const selected=new Set(this.selection(ids).map(x=>x.id));this.items=this.items.filter(x=>!selected.has(x.id));this.onChange();return this.snapshot();}
  import(ids){const selected=this.selection(ids);this.dismiss(selected.map(x=>x.id));return {text:selected.map(x=>x.url).join('\n')};}
  dispose(){clearInterval(this.timer);this.timer=null;this.items=[];this.lastDigest='';this.enabled=false;}
}
module.exports={ClipboardInbox,recognizedLinks};
