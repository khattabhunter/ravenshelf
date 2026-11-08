'use strict';
// Public protection lists are downloaded whole and checked on this PC, so no
// list provider learns which sites you visit or download from. List contents
// are treated as data: every entry is validated before it is used.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {safeFetch}=require('./net.cjs');
const {limitedText}=require('./providers.cjs');

const HOUR=60*60*1000;
const REFRESH_MS=12*HOUR;
const SOURCES=Object.freeze([
  Object.freeze({id:'malware',label:'malware download sites',source:'URLhaus (abuse.ch), via malware-filter',license:'CC0-1.0',minEntries:50,maxEntries:100000,maxBytes:4*1024*1024,urls:Object.freeze([
    'https://raw.githubusercontent.com/curbengh/malware-filter/gh-pages/urlhaus-filter-domains-online.txt',
    'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt',
    'https://malware-filter.pages.dev/urlhaus-filter-domains-online.txt'])}),
  Object.freeze({id:'phishing',label:'phishing sites',source:'phishing-filter, via malware-filter',license:'CC-BY-SA-4.0',minEntries:1000,maxEntries:300000,maxBytes:16*1024*1024,urls:Object.freeze([
    'https://raw.githubusercontent.com/curbengh/malware-filter/gh-pages/phishing-filter-domains.txt',
    'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt',
    'https://malware-filter.pages.dev/phishing-filter-domains.txt'])}),
  Object.freeze({id:'threats',label:'malware, scam and phishing sites',source:'HaGeZi Threat Intelligence Feeds (mini)',license:'GPL-3.0',minEntries:10000,maxEntries:500000,maxBytes:24*1024*1024,urls:Object.freeze([
    'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.mini-onlydomains.txt',
    'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/tif.mini-onlydomains.txt'])}),
  Object.freeze({id:'popups',label:'malicious pop-up ad networks',source:'HaGeZi Pop-Up Ads',license:'GPL-3.0',minEntries:5000,maxEntries:300000,maxBytes:16*1024*1024,urls:Object.freeze([
    'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/popupads-onlydomains.txt',
    'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/popupads-onlydomains.txt'])})
]);
// Ravenshelf itself, its updates, its list mirrors and its supported hosts must
// keep working even if a list update is wrong. Entries equal to, above or below
// these domains are dropped.
const NEVER_BLOCK=Object.freeze(['github.com','githubusercontent.com','sigstore.dev','virustotal.com','jsdelivr.net','malware-filter.gitlab.io','malware-filter.pages.dev','fitgirl-repacks.site','fuckingfast.co','fuckingfast.net','filekeeper.net','datanodes.to','datanodes.in','datanodes.com']);
// Shared hosting suffixes: an entry for one customer's subdomain is useful, an
// entry for the whole suffix would block millions of unrelated sites.
const SHARED_SUFFIXES=new Set(['github.io','gitlab.io','pages.dev','workers.dev','blogspot.com','wordpress.com','netlify.app','vercel.app','herokuapp.com','firebaseapp.com','web.app','appspot.com','azurewebsites.net','cloudfront.net','amazonaws.com','s3.amazonaws.com','r2.dev','glitch.me','repl.co','weebly.com','wixsite.com','googleusercontent.com','sharepoint.com','dropboxusercontent.com','ngrok.io','ngrok-free.app','duckdns.org','web.core.windows.net','blob.core.windows.net','co.uk','com.au','com.br','co.jp','co.in']);
// Underscores are not valid in registered names but browsers accept them in
// subdomains, and phishing pages use them (for example on shared site builders).
const DOMAIN=/^(?=.{4,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const RULE_BASES=Object.freeze({malware:1,phishing:100,threats:200,popups:500});
const RULE_LIMITS=Object.freeze({malware:99,phishing:100,threats:300,popups:200});
const MAX_RULE_BYTES=600000;

function validEntry(value){
  if(net.isIPv4(value))return !/^(?:0|10|127)\./.test(value)&&!/^(?:169\.254|192\.168)\./.test(value)&&value!=='255.255.255.255';
  return DOMAIN.test(value);
}
function neverBlock(entry){
  if(SHARED_SUFFIXES.has(entry))return true;
  return NEVER_BLOCK.some(domain=>entry===domain||domain.endsWith('.'+entry)||entry.endsWith('.'+domain));
}
function parseList(text,{maxEntries=500000}={}){
  if(typeof text!=='string')throw new Error('Invalid protection list.');
  const entries=new Set();let invalid=0,excluded=0;
  for(const raw of text.split(/\r?\n/)){
    let line=raw.trim();
    if(!line||line.startsWith('#')||line.startsWith('!'))continue;
    const parts=line.split(/\s+/);
    if(parts.length===2&&/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(parts[0]))line=parts[1];
    else if(parts.length!==1){invalid++;continue;}
    line=line.toLowerCase().replace(/^\*\./,'').replace(/\.$/,'');
    if(!validEntry(line)){invalid++;continue;}
    if(neverBlock(line)){excluded++;continue;}
    entries.add(line);
    if(entries.size>maxEntries)throw new Error('The protection list is larger than expected.');
  }
  return {entries,invalid,excluded};
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function readState(file){
  try{
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    return value&&value.schema===1&&value.sources&&typeof value.sources==='object'?value:{schema:1,sources:{}};
  }catch{return {schema:1,sources:{}};}
}
function writeAtomic(file,content){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temporary,content,{flag:'wx',mode:0o600});
  try{fs.renameSync(temporary,file);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
}

class ThreatLists{
  constructor({dir,fetcher=safeFetch,now=Date.now,sources=SOURCES,onChange=()=>{},refreshMs=REFRESH_MS}={}){
    if(typeof dir!=='string'||!path.isAbsolute(dir))throw new Error('Protection lists need an absolute folder.');
    this.dir=dir;this.fetcher=fetcher;this.now=now;this.sources=sources;this.onChange=onChange;this.refreshMs=refreshMs;
    this.stateFile=path.join(dir,'state.json');this.state={schema:1,sources:{}};
    // One combined index is kept in memory; each list's copy stays on disk.
    this.counts=new Map();this.index=new Map();this.version='';this.rules=null;this.rulesTimer=null;
    this.errors=new Map();this.updating=null;this.timers=[];this.loaded=false;
  }
  readStored(source){
    const record=this.state.sources[source.id];if(!record)return null;
    try{
      const text=fs.readFileSync(path.join(this.dir,source.id+'.txt'),'utf8');
      if(digest(text)!==record.sha256)throw new Error('changed');
      return parseList(text,{maxEntries:source.maxEntries}).entries;
    }catch{delete this.state.sources[source.id];return null;}
  }
  rebuild(fresh=new Map()){
    const index=new Map(),counts=new Map();
    this.sources.forEach((source,position)=>{
      const entries=fresh.get(source.id)||this.readStored(source);if(!entries)return;
      counts.set(source.id,entries.size);
      for(const entry of entries)if(!index.has(entry))index.set(entry,position);
    });
    this.index=index;this.counts=counts;this.dropRules();
    this.version=digest(this.sources.map(source=>source.id+':'+(this.state.sources[source.id]?.sha256||'')).join('\n')).slice(0,16);
  }
  load(){this.state=readState(this.stateFile);this.rebuild();this.loaded=true;return this.snapshot();}
  get total(){return this.index.size;}
  lookup(host){
    if(typeof host!=='string'||!host||host.length>253)return null;
    const name=host.toLowerCase().replace(/\.$/,'');
    const hit=entry=>{const position=this.index.get(entry);if(position===undefined)return null;const source=this.sources[position];return {category:source.id,label:source.label,source:source.source,domain:entry};};
    if(net.isIPv4(name))return hit(name);
    if(name.includes(':')||name.startsWith('['))return null;
    const labels=name.split('.');
    for(let i=0;i<labels.length-1;i++){const found=hit(labels.slice(i).join('.'));if(found)return found;}
    return null;
  }
  snapshot(){
    const updatedAt=this.sources.map(source=>this.state.sources[source.id]?.updatedAt).filter(Boolean).sort()[0]||null;
    return {
      loaded:this.loaded,updating:Boolean(this.updating),total:this.total,version:this.version,updatedAt,
      sources:this.sources.map(source=>({id:source.id,label:source.label,source:source.source,license:source.license,count:this.counts.get(source.id)||0,updatedAt:this.state.sources[source.id]?.updatedAt||null,error:this.errors.get(source.id)||''}))
    };
  }
  async fetchSource(source,signal){
    for(const url of source.urls){
      try{
        const response=await this.fetcher(url,{timeoutMs:60000,signal,headers:{Accept:'text/plain'}});
        if(!response.ok){await response.body?.cancel();continue;}
        const text=await limitedText(response,source.maxBytes);
        const parsed=parseList(text,{maxEntries:source.maxEntries});
        const previous=this.counts.get(source.id)||0;
        // A drastically smaller list is more likely truncated or broken than real.
        if(parsed.entries.size<source.minEntries||(previous>=source.minEntries&&parsed.entries.size<previous/4))continue;
        return {entries:parsed.entries,url};
      }catch(error){if(signal?.aborted)throw error;}
    }
    throw new Error('This protection list could not be downloaded from any of its mirrors.');
  }
  update({force=false,signal}={}){
    if(this.updating)return this.updating;
    this.updating=(async()=>{
      this.onChange();
      const fresh=new Map();
      for(const source of this.sources){
        const record=this.state.sources[source.id];
        if(!force&&record&&this.now()-Date.parse(record.updatedAt)<this.refreshMs&&this.counts.has(source.id))continue;
        try{
          const {entries,url}=await this.fetchSource(source,signal);
          const text=[...entries].sort().join('\n')+'\n';
          writeAtomic(path.join(this.dir,source.id+'.txt'),text);
          this.state.sources[source.id]={updatedAt:new Date(this.now()).toISOString(),count:entries.size,sha256:digest(text),url};
          fresh.set(source.id,entries);this.errors.delete(source.id);
        }catch(error){
          if(signal?.aborted)throw error;
          this.errors.set(source.id,'Could not update this list. The previous copy is still used.');
        }
      }
      if(fresh.size){writeAtomic(this.stateFile,JSON.stringify(this.state,null,2));this.rebuild(fresh);}
      return this.snapshot();
    })().finally(()=>{this.updating=null;this.onChange();});
    return this.updating;
  }
  start({initialDelayMs=15000}={}){
    this.stop();
    const run=()=>{this.update().catch(()=>{});};
    const first=setTimeout(run,initialDelayMs);first.unref?.();
    const later=setInterval(run,HOUR);later.unref?.();
    this.timers=[first,later];
  }
  stop(){for(const timer of this.timers){clearTimeout(timer);clearInterval(timer);}this.timers=[];this.dropRules();}
  dropRules(){this.rules=null;clearTimeout(this.rulesTimer);this.rulesTimer=null;}
  buildRules(){
    if(!this.rules){
      const byCategory=new Map(this.sources.map(source=>[source.id,[]]));
      for(const [entry,position] of this.index){
        // Browser rules match domain names; addresses stay in the app's own checks.
        if(net.isIPv4(entry))continue;
        byCategory.get(this.sources[position].id).push(entry);
      }
      const rules=[];
      for(const source of this.sources){
        const domains=byCategory.get(source.id).sort();
        let id=RULE_BASES[source.id];const limit=id+RULE_LIMITS[source.id];let chunk=[],bytes=0;
        const flush=()=>{if(chunk.length&&id<limit)rules.push({id:id++,category:source.id,domains:chunk});chunk=[];bytes=0;};
        for(const domain of domains){
          if(bytes+domain.length+3>MAX_RULE_BYTES)flush();
          chunk.push(domain);bytes+=domain.length+3;
        }
        flush();
      }
      this.rules=rules;
    }
    // Browser rules are needed only while an extension syncs; free them afterwards.
    clearTimeout(this.rulesTimer);this.rulesTimer=setTimeout(()=>{this.rules=null;this.rulesTimer=null;},10*60*1000);this.rulesTimer.unref?.();
    return this.rules;
  }
  browserManifest(){return {version:this.version,total:this.total,rules:this.buildRules().map(rule=>({id:rule.id,category:rule.category,count:rule.domains.length}))};}
  browserRule(id){const rule=this.buildRules().find(item=>item.id===id);return rule?{id:rule.id,category:rule.category,domains:rule.domains.slice()}:null;}
}
module.exports={ThreatLists,SOURCES,NEVER_BLOCK,RULE_BASES,parseList,validEntry,neverBlock,MAX_RULE_BYTES};
