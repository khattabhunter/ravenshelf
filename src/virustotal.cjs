'use strict';
// Optional VirusTotal reputation checks with the user's own free API key.
// Only domain names and SHA-256 file fingerprints are sent: never full links,
// never files. The key is sealed with Windows data protection (Electron
// safeStorage) and never leaves the main process except to VirusTotal.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeFetch}=require('./net.cjs');
const {limitedText}=require('./providers.cjs');

const API='https://www.virustotal.com/api/v3';
const GUI='https://www.virustotal.com/gui';
const KEY=/^[a-f0-9]{64}$/;
const SHA256=/^[a-f0-9]{64}$/;
const DOMAIN=/^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const PREFIX='ravenshelf-vt-v1:';
const DAY_MS=24*60*60*1000;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;

function parseReport(kind,subject,text){
  const data=JSON.parse(text)?.data?.attributes;
  if(!data||typeof data!=='object')throw new Error('Unexpected VirusTotal response.');
  const stats=data.last_analysis_stats||{};
  const seconds=Number(data.last_analysis_date);
  return {
    status:'ok',kind,subject,
    malicious:count(stats.malicious),suspicious:count(stats.suspicious),harmless:count(stats.harmless),undetected:count(stats.undetected),
    reputation:Number.isSafeInteger(data.reputation)?data.reputation:0,
    analyzedAt:Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toISOString():null,
    link:`${GUI}/${kind==='file'?'file':'domain'}/${subject}`
  };
}

class VirusTotal{
  constructor({file,storage,fetcher=safeFetch,now=Date.now,perMinute=4,perDay=500,cacheMs=DAY_MS}={}){
    if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('VirusTotal settings need an absolute file path.');
    this.file=file;this.storage=storage;this.fetcher=fetcher;this.now=now;this.perMinute=perMinute;this.perDay=perDay;this.cacheMs=cacheMs;
    this.key=null;this.sealedKey=null;this.domainChecks=true;this.fileChecks=true;this.problem='';
    this.recent=[];this.day='';this.dayCount=0;this.cache=new Map();
  }
  protectedStorage(){try{return Boolean(this.storage?.isEncryptionAvailable());}catch{return false;}}
  load(){
    let saved={};try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'))||{};}catch{}
    this.domainChecks=saved.domainChecks!==false;this.fileChecks=saved.fileChecks!==false;this.key=null;this.problem='';
    // Keep the sealed copy even if it cannot be opened now, so changing an option never erases it.
    this.sealedKey=typeof saved.sealedKey==='string'&&saved.sealedKey.startsWith(PREFIX)&&saved.sealedKey.length<8192?saved.sealedKey:null;
    if(this.sealedKey){
      try{
        if(!this.protectedStorage())throw new Error('unavailable');
        const key=this.storage.decryptString(Buffer.from(this.sealedKey.slice(PREFIX.length),'base64'));
        if(!KEY.test(key))throw new Error('invalid');
        this.key=key;
      }catch{this.problem='The saved VirusTotal key could not be opened on this Windows account. Enter it again.';}
    }
    return this.snapshot();
  }
  save(sealedKey){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({sealedKey,domainChecks:this.domainChecks,fileChecks:this.fileChecks},null,2),{flag:'wx',mode:0o600});
    try{fs.renameSync(temporary,this.file);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
  }
  setKey(value){
    const key=typeof value==='string'?value.trim().toLowerCase():'';
    if(!KEY.test(key))throw new Error('Enter a VirusTotal API key: 64 letters and numbers from your VirusTotal account.');
    if(!this.protectedStorage())throw new Error('Windows protected storage is unavailable, so the VirusTotal key was not saved.');
    const sealed=PREFIX+this.storage.encryptString(key).toString('base64');
    this.save(sealed);
    this.key=key;this.sealedKey=sealed;this.problem='';this.cache.clear();return this.snapshot();
  }
  clearKey(){this.save(null);this.key=null;this.sealedKey=null;this.problem='';this.cache.clear();return this.snapshot();}
  setOptions({domainChecks,fileChecks}={}){
    if(domainChecks!==undefined){if(typeof domainChecks!=='boolean')throw new Error('Choose on or off for this preference.');this.domainChecks=domainChecks;}
    if(fileChecks!==undefined){if(typeof fileChecks!=='boolean')throw new Error('Choose on or off for this preference.');this.fileChecks=fileChecks;}
    this.save(this.sealedKey);return this.snapshot();
  }
  usage(){
    const now=this.now(),today=new Date(now).toISOString().slice(0,10);
    this.recent=this.recent.filter(time=>now-time<60000);
    if(this.day!==today){this.day=today;this.dayCount=0;}
    return {minute:this.recent.length,day:this.dayCount,perMinute:this.perMinute,perDay:this.perDay};
  }
  snapshot(){return {configured:Boolean(this.key),domainChecks:this.domainChecks,fileChecks:this.fileChecks,protectedStorage:this.protectedStorage(),problem:this.problem,usage:this.usage()};}
  async lookup(kind,value,{signal}={}){
    const subject=typeof value==='string'?value.toLowerCase().replace(/\.$/,''):'';
    if(kind==='domain'?!DOMAIN.test(subject):kind==='file'?!SHA256.test(subject):true)return {status:'skipped',reason:'invalid',kind,subject:''};
    if(!this.key)return {status:'skipped',reason:'no-key',kind,subject};
    if(kind==='domain'?!this.domainChecks:!this.fileChecks)return {status:'skipped',reason:'off',kind,subject};
    const cacheKey=kind+':'+subject,cached=this.cache.get(cacheKey);
    if(cached&&this.now()-cached.time<this.cacheMs)return {...cached.result,cached:true};
    const usage=this.usage();
    if(usage.minute>=this.perMinute||usage.day>=this.perDay)return {status:'skipped',reason:'limit',kind,subject};
    this.recent.push(this.now());this.dayCount++;
    let response;
    try{response=await this.fetcher(`${API}/${kind==='file'?'files':'domains'}/${subject}`,{headers:{'x-apikey':this.key,Accept:'application/json'},timeoutMs:20000,signal});}
    catch(error){if(signal?.aborted)throw error;return {status:'error',reason:'network',kind,subject};}
    let result;
    if(response.status===200){
      try{result=parseReport(kind,subject,await limitedText(response,2*1024*1024));}
      catch{return {status:'error',reason:'response',kind,subject};}
    }else{
      await response.body?.cancel();
      if(response.status===404)result={status:'not-found',kind,subject,link:`${GUI}/${kind==='file'?'file':'domain'}/${subject}`};
      else if(response.status===401||response.status===403){this.problem='VirusTotal did not accept the saved key. Check it in your VirusTotal account and enter it again.';return {status:'error',reason:'key',kind,subject};}
      else if(response.status===429)return {status:'skipped',reason:'limit',kind,subject};
      else return {status:'error',reason:'http',kind,subject};
    }
    this.problem='';
    if(this.cache.size>=500)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(cacheKey,{time:this.now(),result});
    return result;
  }
}
async function hashFile(file,{signal,fsApi=fs}={}){
  const hash=crypto.createHash('sha256');
  for await(const chunk of fsApi.createReadStream(file,{highWaterMark:1024*1024,signal}))hash.update(chunk);
  return hash.digest('hex');
}
module.exports={VirusTotal,hashFile,parseReport,PREFIX};
