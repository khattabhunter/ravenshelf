'use strict';
// The app side of the Ravenshelf browser extension. The browser starts a small
// connector that relays one message over a local named pipe; only a process
// that knows this session's random token can use the pipe, and web pages cannot
// reach it at all. Every download handed over by the extension is checked here
// and then waits for the user's decision in Ravenshelf. Nothing downloads on
// its own.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {MAX_HEADER_BYTES,MAX_REQUEST_BYTES,allowedOrigin,encodeFrame,FrameReader,validateRequest}=require('./browser-protocol.cjs');
const {inspectLink,assessDownload,nameReasons,nameFromURL}=require('./link-safety.cjs');
const {hashFile}=require('./virustotal.cjs');
const {fromNexus,modFolder:gameFolder,MODS_FOLDER}=require('./mods.cjs');
const {safeName,folderName}=require('./safe-name.cjs');

const PROVIDER_ROOTS=['fuckingfast.co','fuckingfast.net','filekeeper.net','datanodes.to','datanodes.in','datanodes.com','paste.fitgirl-repacks.site'];
const MAX_PENDING=50;
const CAPTURE_TTL_MS=60*60*1000;
const FINISHED_TTL_MS=10*60*1000;
const ALLOW_ONCE_MS=2*60*1000;
const REQUESTS_PER_MINUTE=240;
const hostOf=value=>{try{return new URL(value).hostname.toLowerCase();}catch{return '';}};
const isProvider=value=>{const host=hostOf(value);return PROVIDER_ROOTS.some(root=>host===root||host.endsWith('.'+root));};
const baseName=value=>String(value||'').split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[\x00-\x1f\x7f]/g,'').slice(0,240)||undefined;
// The name a download is saved under. The queue cleans the name it is handed
// once, with safeName(), before it saves the file. So the checks here judge,
// and the review shows, safeName() of the very name that is handed over: the
// name that was checked is the name that is saved (full-width letters, for
// example, are saved as plain ones).
const savedAs=value=>value?safeName(value):undefined;
// An address without what follows the "?": enough to show where a file comes
// from. A signed link has no business in the window.
const plainAddress=value=>{try{const url=new URL(value);url.search='';url.hash='';return url.href;}catch{return '';}};
const https=value=>{try{return new URL(value).protocol==='https:'?value:undefined;}catch{return undefined;}};

async function writeJSONAtomic(file,value){
  await fs.promises.mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});
  try{await fs.promises.rename(temporary,file);}catch(error){await fs.promises.unlink(temporary).catch(()=>{});throw error;}
}

class BrowserBridge extends EventEmitter{
  constructor({hostDir,threatLists=null,virusTotal=null,resolveProvider=null,inspect=inspectLink,fetcher,queueDownload,modTitle=gameFolder,queueMedia=null,openExternal,reveal=()=>{},notify=()=>{},setReputation=()=>{},language=()=>({language:'en',digits:'latn'}),localText=text=>text,appVersion='0.0.0',now=Date.now,platform=process.platform,listenPath=null}={}){
    super();
    if(typeof hostDir!=='string'||!path.isAbsolute(hostDir))throw new Error('Invalid connector location.');
    Object.assign(this,{hostDir,threatLists,virusTotal,resolveProvider,inspectImpl:inspect,fetcher,queueDownload,modTitle,queueMedia,openExternal,reveal,notify,setReputation,language,localText,appVersion,now,platform,listenPath});
    this.server=null;this.token=null;this.sockets=new Set();this.captures=new Map();this.allowed=[];
    this.queue=[];this.active=0;this.requests=[];this.contact=null;this.controller=new AbortController();
  }
  get endpointFile(){return path.join(this.hostDir,'endpoint.json');}
  async start(){
    if(this.server)return;
    const pipe='ravenshelf-'+crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(32);
    const address=this.platform==='win32'?`\\\\.\\pipe\\${pipe}`:(this.listenPath||path.join(this.hostDir,`${pipe}.sock`));
    await fs.promises.mkdir(this.hostDir,{recursive:true});
    const server=net.createServer(socket=>this.connection(socket));server.maxConnections=16;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,()=>{server.off('error',reject);resolve();});});
    server.on('error',()=>{});
    this.server=server;this.token=token;this.address=address;this.controller=new AbortController();
    await writeJSONAtomic(this.endpointFile,{schema:1,pipe,token:token.toString('hex')});
    this.emit('change');
  }
  async stop(){
    const server=this.server;this.server=null;this.token=null;this.controller.abort();
    await fs.promises.unlink(this.endpointFile).catch(()=>{});
    for(const socket of this.sockets)socket.destroy();
    if(server)await new Promise(resolve=>server.close(()=>resolve()));
    if(server&&this.platform!=='win32')await fs.promises.unlink(this.address).catch(()=>{});
    this.emit('change');
  }
  connection(socket){
    this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));
    socket.on('error',()=>{});socket.setTimeout(20000,()=>socket.destroy());
    const reader=new FrameReader(MAX_HEADER_BYTES);let browser=null,done=false;
    socket.on('data',chunk=>{
      if(done)return;
      let frames;
      try{frames=reader.push(chunk);}catch{done=true;socket.destroy();return;}
      for(const frame of frames){
        if(!browser){
          browser=this.authenticate(frame);
          if(!browser){done=true;socket.destroy();return;}
          reader.maxBytes=MAX_REQUEST_BYTES;continue;
        }
        done=true;socket.pause();
        this.respond(browser,frame).then(response=>socket.end(encodeFrame(response)),()=>socket.destroy());
        return;
      }
    });
  }
  authenticate(header){
    if(!this.token||header?.v!==1||typeof header.token!=='string'||!/^[a-f0-9]{64}$/.test(header.token))return null;
    if(!crypto.timingSafeEqual(Buffer.from(header.token,'hex'),this.token))return null;
    return allowedOrigin(header.origin);
  }
  allowRequest(){
    const now=this.now();this.requests=this.requests.filter(time=>now-time<60000);
    if(this.requests.length>=REQUESTS_PER_MINUTE)return false;
    this.requests.push(now);return true;
  }
  // The app's language, for the extension. Only the two known values are sent.
  appLanguage(){
    try{const {language,digits}=this.language()||{};return {language:language==='ar'?'ar':'en',digits:digits==='arab'?'arab':'latn'};}
    catch{return {language:'en',digits:'latn'};}
  }
  localReason(reason){try{const local=this.localText(reason);return typeof local==='string'&&local?local.slice(0,1000):reason;}catch{return reason;}}
  async respond(browser,raw){
    if(!this.allowRequest())return {ok:false,error:'busy'};
    let message;try{message=validateRequest(raw);}catch{return {ok:false,error:'invalid'};}
    try{
      if(message.type==='hello'){
        this.contact={browser,extensionVersion:message.extensionVersion,at:new Date(this.now()).toISOString()};this.emit('change');
        return {ok:true,app:'Ravenshelf',version:this.appVersion,capture:true,protection:this.threatLists?{version:this.threatLists.version,total:this.threatLists.total}:null,...this.appLanguage()};
      }
      if(message.type==='capture'||message.type==='send'){
        // The extension shows the reason as it comes, so it is sent in the app's language.
        const result=this.receive(browser,message);
        return {ok:true,...result,...(typeof result?.reason==='string'?{reason:this.localReason(result.reason)}:{})};
      }
      // YouTube videos skip the review: the user chose the video and quality
      // themselves, and nothing but its video ID reaches Ravenshelf.
      if(message.type==='media'){
        if(typeof this.queueMedia!=='function')return {ok:false,error:'invalid'};
        const result=await this.queueMedia({videoId:message.videoId,quality:message.quality,browser});
        return ['queued','duplicate','setup','busy'].includes(result?.action)?{ok:true,action:result.action}:{ok:false,error:'failed'};
      }
      if(message.type==='threats')return {ok:true,manifest:this.threatLists?this.threatLists.browserManifest():{version:'',total:0,rules:[]}};
      if(message.type==='threatRule'){const rule=this.threatLists?.browserRule(message.id);return rule?{ok:true,rule}:{ok:false,error:'not-found'};}
      if(message.type==='lookup'){const hit=this.threatLists?.lookup(message.host);return {ok:true,listed:hit?{category:hit.category,label:hit.label}:null};}
    }catch{return {ok:false,error:'failed'};}
    return {ok:false,error:'invalid'};
  }
  lookup(host){const hit=this.threatLists?.lookup(host);return hit?{category:hit.category,label:hit.label}:null;}
  // Quick answer for the extension: take the download, block it, or let the
  // browser keep it. Slow checks happen afterwards, while the user reviews.
  // Quick blocks are recorded here; the extension shows their notification.
  receive(browser,message){
    this.expire();
    // `given` is the browser's name for the file as it arrived; `filename` is that name as it would be saved.
    const given=baseName(message.filename);
    const request={url:message.url,finalUrl:message.finalUrl,referrer:message.referrer,pageUrl:message.pageUrl,filename:savedAs(given),given,mime:message.mime,totalBytes:message.totalBytes};
    // The extension's game-and-mod label is kept only for a file from Nexus Mods' own file servers.
    if(message.mod&&fromNexus(request))request.mod={...message.mod};
    const source=message.type==='send'?message.kind:'download';
    for(const address of [request.url,request.finalUrl,request.referrer,request.pageUrl]){
      if(!address)continue;
      const host=hostOf(address),listed=this.lookup(host);
      if(listed){
        const blocked={code:'listed',level:'blocked',message:`${host} is on Ravenshelf’s list of ${listed.label}.`};
        const capture=this.record(browser,source,request,{status:'blocked',verdict:{level:'blocked',reasons:[blocked]},chain:[{host,listed}]});
        return {action:'block',id:capture.id,reason:blocked.message};
      }
    }
    const deceptive=request.filename&&nameReasons(request.filename).find(reason=>reason.level==='blocked');
    if(deceptive){
      const capture=this.record(browser,source,request,{status:'blocked',verdict:{level:'blocked',reasons:[deceptive]},filename:request.filename});
      return {action:'block',id:capture.id,reason:deceptive.message};
    }
    const target=request.finalUrl||request.url;
    if(new URL(target).protocol==='http:'){
      const verdict=assessDownload({filename:request.filename||safeName(nameFromURL(target)),insecure:true});
      if(verdict.level==='blocked'){
        const capture=this.record(browser,source,request,{status:'blocked',verdict,filename:request.filename||safeName(nameFromURL(target))});
        return {action:'block',id:capture.id,reason:verdict.reasons.find(item=>item.level==='blocked').message};
      }
      return {action:'browser'};
    }
    if(this.takeAllowance([request.url,request.finalUrl]))return {action:'browser'};
    const duplicate=[...this.captures.values()].find(capture=>capture.request.url===request.url&&this.now()-capture.createdAt<30000&&['checking','ready','manual'].includes(capture.status));
    if(duplicate)return {action:'take',id:duplicate.id};
    if(this.pendingCount()>=MAX_PENDING)return {action:'block',reason:'Too many downloads are waiting in Ravenshelf. Review them first, then try again.'};
    const capture=this.record(browser,source,request,{status:'checking'});
    this.queue.push(capture.id);this.pump();
    try{this.reveal();}catch{}
    try{this.notify({title:'Review a download in Ravenshelf',body:`${capture.displayName} was sent from your browser. Nothing downloads until you choose.`});}catch{}
    return {action:'take',id:capture.id};
  }
  record(browser,source,request,fields){
    const capture={id:crypto.randomUUID(),createdAt:this.now(),browser,source,request,status:'checking',verdict:null,chain:[],virusTotal:[],filename:request.filename,size:request.totalBytes||0,message:'',entry:null,...fields};
    capture.displayName=capture.filename||safeName(nameFromURL(request.finalUrl||request.url));
    this.captures.set(capture.id,capture);this.emit('change');return capture;
  }
  pendingCount(){return [...this.captures.values()].filter(capture=>['checking','ready','manual'].includes(capture.status)).length;}
  pump(){
    while(this.active<2&&this.queue.length){
      const capture=this.captures.get(this.queue.shift());
      if(!capture||capture.status!=='checking')continue;
      this.active++;
      this.inspect(capture).catch(()=>{
        if(capture.status==='checking'){capture.status='manual';capture.message='Ravenshelf could not check this link. You can let your browser download it.';}
      }).finally(()=>{this.active--;this.emit('change');this.pump();});
    }
  }
  async inspect(capture){
    const {request}=capture,signal=this.controller.signal;
    const start=https(request.finalUrl)||request.url;
    const lookupHost=host=>this.lookup(host);
    let result;
    if(this.resolveProvider&&isProvider(start)){
      // Supported file hosts are resolved by Ravenshelf itself, without their ads.
      const resolved=await this.resolveProvider(start);
      const chain=[{url:start,host:hostOf(start),listed:lookupHost(hostOf(start))}];
      if(resolved?.status==='ready'&&hostOf(resolved.url)!==chain[0].host)chain.push({url:resolved.url,host:hostOf(resolved.url),listed:lookupHost(hostOf(resolved.url))});
      result={...resolved,status:chain.some(hop=>hop.listed)?'blocked':resolved?.status||'manual',chain,sniffed:'unknown',provider:true};
    }else result=await this.inspectImpl(start,{fetcher:this.fetcher,referer:https(request.referrer)||https(request.pageUrl),lookupHost,signal});
    if(signal.aborted||!this.captures.has(capture.id))return;
    // The label is for the file Ravenshelf would fetch. A link that led on to
    // another site is not a Nexus Mods file.
    if(request.mod&&!fromNexus({url:result.url}))delete request.mod;
    const virusTotal=[];
    if(result.status!=='blocked'&&this.virusTotal?.snapshot().configured){
      for(const host of [...new Set(result.chain.map(hop=>hop.host))].filter(host=>!net.isIP(host)).slice(0,3)){
        const report=await this.virusTotal.lookup('domain',host,{signal});
        if(['ok','not-found'].includes(report.status))virusTotal.push(report);
        else if(report.reason==='limit'){virusTotal.push(report);break;}
      }
    }
    // The name as it arrived: the server's, else the browser's, else the one in the address.
    // The queue is handed exactly this, and saves it as safeName() of it.
    const given=baseName(result.filename)||request.given||nameFromURL(start);
    const filename=safeName(given);
    const verdict=assessDownload({filename,sniffed:result.sniffed,chain:result.chain,insecure:Boolean(result.insecure),virusTotal});
    Object.assign(capture,{filename,displayName:filename,size:Number(result.size)||request.totalBytes||0,message:String(result.message||'').slice(0,300),verdict,virusTotal,
      chain:result.chain.map(hop=>({host:hop.host,listed:hop.listed?{category:hop.listed.category,label:hop.listed.label}:null}))});
    if(result.status==='blocked'||verdict.level==='blocked'){capture.status='blocked';this.alertBlocked(capture);return;}
    capture.status=['ready','manual','unavailable'].includes(result.status)?result.status:'manual';
    if(capture.status==='ready'){
      const referer=result.provider?result.referer:https(request.referrer)||https(request.pageUrl);
      capture.entry={...(result.provider?{headers:result.headers&&typeof result.headers==='object'?{...result.headers}:{}}:{}),status:'ready',url:result.url,sourceUrl:start,filename:given,size:capture.size,host:hostOf(result.url),...(referer?{referer}:{}),...(request.mod?{mod:{...request.mod}}:{})};
    }
  }
  alertBlocked(capture){
    const reason=capture.verdict?.reasons?.find(item=>item.level==='blocked')?.message||'It failed Ravenshelf’s safety checks.';
    try{this.notify({title:'Ravenshelf blocked a download',body:`${capture.displayName}: ${reason}`});}catch{}
  }
  // One browser download is allowed for a short time; any of its addresses uses it up.
  allowOnce(...urls){this.allowed.push({urls:new Set(urls.filter(Boolean)),until:this.now()+ALLOW_ONCE_MS});if(this.allowed.length>50)this.allowed.shift();}
  takeAllowance(urls){
    const now=this.now();this.allowed=this.allowed.filter(entry=>entry.until>=now);
    const index=this.allowed.findIndex(entry=>urls.some(url=>url&&entry.urls.has(url)));
    if(index<0)return false;
    this.allowed.splice(index,1);return true;
  }
  expire(){
    const now=this.now();
    for(const [id,capture] of this.captures){
      const age=now-capture.createdAt;
      if((capture.status!=='checking'&&age>CAPTURE_TTL_MS)||(['queued','sent-to-browser','duplicate'].includes(capture.status)&&age>FINISHED_TTL_MS))this.captures.delete(id);
    }
  }
  async action({id,action,acknowledgeRisk}={}){
    if(typeof id!=='string'||!this.captures.has(id))throw new Error('This browser download is no longer available.');
    const capture=this.captures.get(id);
    if(action==='dismiss'){this.captures.delete(id);this.emit('change');return this.snapshot();}
    if(action==='recheck'){
      if(['checking','queued'].includes(capture.status))return this.snapshot();
      Object.assign(capture,{status:'checking',verdict:null,entry:null,message:'',virusTotal:[]});
      this.queue.push(id);this.pump();this.emit('change');return this.snapshot();
    }
    if(!['download','browser'].includes(action))throw new Error('Unknown action.');
    if(capture.status==='blocked'||capture.verdict?.level==='blocked')throw new Error('Ravenshelf blocked this download, so it cannot be downloaded from here.');
    if(capture.status==='checking')throw new Error('Wait for Ravenshelf to finish checking this link.');
    if(capture.verdict?.level==='warning'&&acknowledgeRisk!==true)throw new Error('Confirm that you understand the warning before continuing.');
    if(action==='download'){
      if(capture.status!=='ready'||!capture.entry)throw new Error('Ravenshelf cannot download this link. You can let your browser download it instead.');
      const result=await this.queueDownload({...capture.entry,origin:'browser',markOfTheWeb:true});
      const added=Number.isInteger(result?.added)?result.added:1;
      capture.entry=null;capture.createdAt=this.now();
      // The queue skips a link it already holds (finished, failed or paused),
      // so say so instead of reporting a download that will never start.
      if(added)capture.status='queued';
      else{capture.status='duplicate';capture.message='This file is already in your Downloads list. Resume or retry it there, or remove the old entry and download it again.';}
      this.emit('change');
      return {...this.snapshot(),added};
    }
    if(!['manual','ready'].includes(capture.status))throw new Error('This link is not available, so your browser cannot download it either.');
    this.allowOnce(capture.request.url,capture.request.finalUrl);
    await this.openExternal(capture.request.url);
    capture.status='sent-to-browser';capture.entry=null;capture.createdAt=this.now();this.emit('change');
    return this.snapshot();
  }
  // VirusTotal file check for a finished browser download: only its SHA-256 is sent.
  async afterDownload(download,file){
    if(download?.origin!=='browser'||!this.virusTotal)return null;
    const settings=this.virusTotal.snapshot();
    if(!settings.configured||!settings.fileChecks)return null;
    const report=await this.virusTotal.lookup('file',await hashFile(file,{signal:this.controller.signal}),{signal:this.controller.signal});
    if(!['ok','not-found'].includes(report.status))return null;
    const virusTotal={status:report.status,malicious:report.malicious??0,suspicious:report.suspicious??0,harmless:report.harmless??0,undetected:report.undetected??0,link:report.link,checkedAt:new Date(this.now()).toISOString()};
    this.setReputation(download.id,{virusTotal});
    if(report.status==='ok'&&report.malicious>=2){try{this.notify({title:'Check this download before opening it',body:download.name?`${report.malicious} security vendors on VirusTotal flagged ${download.name}.`:`${report.malicious} security vendors on VirusTotal flagged a downloaded file.`});}catch{}}
    return virusTotal;
  }
  snapshot(){
    this.expire();
    const captures=[...this.captures.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,MAX_PENDING).map(capture=>({
      id:capture.id,createdAt:new Date(capture.createdAt).toISOString(),browser:capture.browser,source:capture.source,status:capture.status,
      name:capture.displayName,size:capture.size,address:plainAddress(capture.request.finalUrl||capture.request.url),pageHost:hostOf(capture.request.pageUrl||capture.request.referrer||''),
      chain:capture.chain.map(hop=>({...hop})),verdict:capture.verdict?{level:capture.verdict.level,reasons:capture.verdict.reasons.map(item=>({...item}))}:null,
      virusTotal:capture.virusTotal.map(item=>({kind:item.kind,subject:item.subject,status:item.status,reason:item.reason,malicious:item.malicious,suspicious:item.suspicious,harmless:item.harmless,undetected:item.undetected,link:item.link})),
      message:capture.message,mod:capture.request.mod?{...capture.request.mod}:null,
      // Where a mod file would be saved inside the download folder, named exactly as the queue names it,
      // from the title the queue files that game's mods under.
      modFolder:capture.request.mod?`${folderName(MODS_FOLDER)} › ${folderName(this.modTitle(capture.request.mod))}`:''
    }));
    return {running:Boolean(this.server),contact:this.contact?{...this.contact}:null,pending:this.pendingCount(),captures};
  }
}
module.exports={BrowserBridge,PROVIDER_ROOTS,MAX_PENDING,isProvider,baseName};
