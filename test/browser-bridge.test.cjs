'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const protocol=require('../src/browser-protocol.cjs');
const setup=require('../src/browser-setup.cjs');
const {BrowserBridge,MAX_PENDING,isProvider,baseName,savedName}=require('../src/browser-bridge.cjs');

const CHROME=`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}/`,FIREFOX=`firefox:${protocol.FIREFOX_EXTENSION_ID}`;
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-bridge-'));
async function until(predicate,label='condition'){const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw new Error('Timed out waiting for '+label);await new Promise(resolve=>setTimeout(resolve,5));}}

// ---------- protocol ----------
test('the pinned extension ID is derived from the public key the way browsers do',()=>{
  assert.equal(protocol.CHROMIUM_EXTENSION_ID,'ccgeallihglgkgpokepckdejgbfojcnh');
  assert.equal(protocol.extensionIdFromKey(protocol.CHROMIUM_EXTENSION_KEY),protocol.CHROMIUM_EXTENSION_ID);
  assert.match(protocol.HOST_NAME,/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
  assert.equal(protocol.allowedOrigin(CHROME),'chromium');assert.equal(protocol.allowedOrigin(FIREFOX),'firefox');
  for(const origin of ['chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/',`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}`,'firefox:other@example.com','',null,undefined,{}])assert.equal(protocol.allowedOrigin(origin),null);
});

test('frames are length-prefixed JSON objects with strict size limits',()=>{
  const frame=protocol.encodeFrame({type:'hello',n:1});
  assert.equal(frame.readUInt32LE(0),frame.length-4);
  const reader=new protocol.FrameReader(1000);
  assert.deepEqual(reader.push(frame.subarray(0,3)),[]);
  const two=Buffer.concat([frame.subarray(3),protocol.encodeFrame({b:2})]);
  assert.deepEqual(reader.push(two),[{type:'hello',n:1},{b:2}]);
  const bad=length=>{const b=Buffer.alloc(4);b.writeUInt32LE(length,0);return b;};
  assert.throws(()=>new protocol.FrameReader(10).push(bad(11)),/Invalid message length/);
  assert.throws(()=>new protocol.FrameReader(10).push(bad(1)),/Invalid message length/);
  assert.throws(()=>new protocol.FrameReader(100).push(Buffer.concat([bad(4),Buffer.from('[1] ')])),/Invalid message/);
  assert.throws(()=>new protocol.FrameReader(100).push(Buffer.concat([bad(5),Buffer.from('{bad}')])));
  assert.throws(()=>protocol.encodeFrame({x:'y'.repeat(2000)},1000),/too large/);
});

test('browser requests must match an exact shape',()=>{
  const ok=value=>protocol.validateRequest({v:1,...value});
  const bad=value=>assert.throws(()=>protocol.validateRequest({v:1,...value}),/Invalid browser request/,JSON.stringify(value).slice(0,120));
  assert.deepEqual(ok({type:'hello',extensionVersion:'0.5.0',browser:'chromium'}),{type:'hello',extensionVersion:'0.5.0',browser:'chromium'});
  bad({type:'hello',extensionVersion:'0.5',browser:'chromium'});bad({type:'hello',extensionVersion:'0.5.0',browser:'safari'});bad({type:'hello',extensionVersion:'0.5.0',browser:'chromium',extra:1});
  const capture=ok({type:'capture',url:'https://cdn.example/a b.zip',finalUrl:'https://cdn2.example/x.zip',referrer:'',pageUrl:'https://page.example/',filename:'x.zip',mime:'application/zip',totalBytes:-1,incognito:false});
  assert.deepEqual(capture,{type:'capture',url:'https://cdn.example/a%20b.zip',finalUrl:'https://cdn2.example/x.zip',referrer:undefined,pageUrl:'https://page.example/',filename:'x.zip',mime:'application/zip',totalBytes:undefined,mod:undefined});
  assert.equal(ok({type:'capture',url:'http://plain.example/a',totalBytes:42}).totalBytes,42);
  for(const url of ['blob:https://x.example/uuid','data:text/plain,hi','javascript:alert(1)','ftp://x.example/a','file:///C:/a','chrome://settings','https://','https://x.example/\u0000','https://x.example/'+'a'.repeat(8200),42])bad({type:'capture',url});
  bad({type:'capture',url:'https://x.example/a',incognito:true});bad({type:'capture',url:'https://x.example/a',totalBytes:1.5});bad({type:'capture',url:'https://x.example/a',filename:'a\nb'});
  bad({type:'capture',url:'https://x.example/a',cookie:'secret=1'});bad({type:'capture'});
  assert.deepEqual(ok({type:'send',url:'https://fuckingfast.co/abc#x.rar',kind:'page'}),{type:'send',kind:'page',url:'https://fuckingfast.co/abc#x.rar',pageUrl:undefined});
  bad({type:'send',url:'https://x.example/',kind:'video'});
  assert.deepEqual(ok({type:'threats'}),{type:'threats'});bad({type:'threats',page:1});
  assert.deepEqual(ok({type:'threatRule',id:500}),{type:'threatRule',id:500});for(const id of [0,1000,1.5,'5'])bad({type:'threatRule',id});
  assert.deepEqual(ok({type:'lookup',host:'Bad.Example'}),{type:'lookup',host:'bad.example'});bad({type:'lookup',host:'bad example'});bad({type:'lookup',host:''});
  assert.throws(()=>protocol.validateRequest({v:2,type:'threats'}));assert.throws(()=>protocol.validateRequest(null));assert.throws(()=>protocol.validateRequest({v:1,type:'unknown'}));
});

// ---------- setup ----------
test('extension manifests request only what the features need',()=>{
  const chrome=setup.extensionManifest('chromium','0.5.0'),firefox=setup.extensionManifest('firefox','0.5.0');
  assert.equal(chrome.manifest_version,3);assert.equal(chrome.key,protocol.CHROMIUM_EXTENSION_KEY);assert.equal(chrome.background.service_worker,'background.js');
  assert.deepEqual(firefox.background,{scripts:['policy.js','background.js']});
  assert.equal(firefox.browser_specific_settings.gecko.id,protocol.FIREFOX_EXTENSION_ID);assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions,{required:['browsingActivity','websiteContent']},'addresses, and the names a Nexus Mods page showed');
  for(const manifest of [chrome,firefox]){
    assert.equal(manifest.host_permissions,undefined,'no host permissions are requested');
    // The two page scripts, top frame only: the download button in YouTube's
    // player, and the reader that notes which mod a Nexus Mods page is about.
    assert.deepEqual(manifest.content_scripts,[
      {matches:['https://www.youtube.com/*'],js:['policy.js','youtube.js'],css:['youtube.css'],run_at:'document_idle',all_frames:false},
      {matches:['https://www.nexusmods.com/*'],js:['policy.js','nexus.js'],run_at:'document_idle',all_frames:false}]);
    for(const script of manifest.content_scripts)for(const file of [...script.js,...(script.css||[])])assert.ok(setup.EXTENSION_FILES.includes(file),file);
    assert.ok(manifest.description.length<=132,'browsers cut a longer description short');assert.match(manifest.description,/YouTube and Nexus Mods/);
    assert.equal(manifest.externally_connectable,undefined);assert.equal(manifest.web_accessible_resources,undefined);
    assert.ok(!manifest.permissions.some(permission=>/cookies|tabs|history|scripting|webRequest|<all_urls>|\*/.test(permission)),manifest.permissions.join());
    assert.match(manifest.content_security_policy.extension_pages,/script-src 'self'/);
  }
  assert.equal(firefox.key,undefined);assert.throws(()=>setup.extensionManifest('safari','0.5.0'));assert.throws(()=>setup.extensionManifest('chromium','5'));
});

test('the extension folder is written whole and replaced only after the new copy is complete',async()=>{
  const root=temp(),source=path.join(__dirname,'../src/browser-extension');
  const result=await setup.exportExtension({browser:'chromium',root,version:'0.5.0',sourceDir:source});
  assert.equal(result.path,path.join(root,'chromium'));
  for(const name of [...setup.EXTENSION_FILES,'manifest.json'])assert.ok(fs.statSync(path.join(root,'chromium',name)).size>0,name);
  for(const name of setup.EXTENSION_FILES)assert.deepEqual(fs.readFileSync(path.join(root,'chromium',name)),fs.readFileSync(path.join(source,name)),name);
  assert.equal(setup.exportedVersion(root,'chromium'),'0.5.0');assert.equal(setup.exportedVersion(root,'firefox'),null);
  fs.writeFileSync(path.join(root,'chromium','stale.js'),'old');
  await setup.exportExtension({browser:'chromium',root,version:'0.5.1',sourceDir:source});
  assert.equal(setup.exportedVersion(root,'chromium'),'0.5.1');assert.equal(fs.existsSync(path.join(root,'chromium','stale.js')),false);
  const broken=temp();fs.cpSync(source,broken,{recursive:true});fs.rmSync(path.join(broken,'popup.js'));
  await assert.rejects(setup.exportExtension({browser:'chromium',root,version:'0.6.0',sourceDir:broken}));
  assert.equal(setup.exportedVersion(root,'chromium'),'0.5.1','a failed export keeps the working copy');
  assert.deepEqual(fs.readdirSync(root).sort(),['chromium'],'no staging folders are left behind');
  await assert.rejects(setup.exportExtension({browser:'chromium',root:'relative',version:'0.5.0',sourceDir:source}),/Invalid extension folder/);
});

function memoryFs(files={}){
  const store=new Map(Object.entries(files)),dirs=new Set();
  const missing=name=>Object.assign(new Error('missing '+name),{code:'ENOENT'});
  return {store,dirs,promises:{
    readFile:async(name,encoding)=>{if(!store.has(name))throw missing(name);const value=store.get(name);return encoding?value.toString(encoding):Buffer.from(value);},
    writeFile:async(name,value,options={})=>{if(options.flag==='wx'&&store.has(name))throw Object.assign(new Error('exists'),{code:'EEXIST'});store.set(name,Buffer.from(value));},
    rename:async(from,to)=>{if(!store.has(from))throw missing(from);store.set(to,store.get(from));store.delete(from);},
    unlink:async name=>{if(!store.delete(name))throw missing(name);},
    mkdir:async name=>{dirs.add(name);}
  }};
}
test('the connector is copied only after its build record matches, then registered per user',async()=>{
  const exe=Buffer.concat([Buffer.from('MZ'),crypto.randomBytes(64)]),hash=crypto.createHash('sha256').update(exe).digest('hex');
  const bundle='C:\\Program Files\\Ravenshelf\\resources\\app.asar\\src',hostDir='C:\\Users\\Player\\AppData\\Roaming\\atlas-repack-library\\browser-host';
  const record={output:{name:'ravenshelf-browser-host.exe',size:exe.length,sha256:hash}};
  const fsApi=memoryFs({[path.join(bundle,'ravenshelf-browser-host.exe')]:exe,[path.join(bundle,'browser-host-build.json')]:JSON.stringify(record)});
  const calls=[];const execFileImpl=(file,args,options,callback)=>{calls.push({file,args,options});callback(null);};
  const result=await setup.registerNativeHost({hostDir,bundleDir:bundle,platform:'win32',fsApi,execFileImpl,systemRoot:'C:\\Windows'});
  assert.equal(result.hostPath,hostDir+'\\ravenshelf-browser-host.exe');
  assert.deepEqual(fsApi.store.get(result.hostPath),exe);
  const chromium=JSON.parse(fsApi.store.get(hostDir+'\\chromium.json')),firefox=JSON.parse(fsApi.store.get(hostDir+'\\firefox.json'));
  assert.deepEqual(chromium,{name:protocol.HOST_NAME,description:'Ravenshelf browser connector',path:result.hostPath,type:'stdio',allowed_origins:[CHROME]});
  assert.deepEqual(firefox.allowed_extensions,[protocol.FIREFOX_EXTENSION_ID]);assert.equal(firefox.allowed_origins,undefined);
  assert.equal(calls.length,4);
  for(const call of calls){assert.equal(call.file,'C:\\Windows\\System32\\reg.exe');assert.equal(call.options.windowsHide,true);assert.equal(call.args[0],'add');assert.match(call.args[1],/^HKCU\\Software\\/);assert.deepEqual(call.args.slice(2,6),['/ve','/t','REG_SZ','/d']);assert.equal(call.args[7],'/f');assert.equal(call.args.length,8);}
  assert.deepEqual(calls.map(call=>call.args[6]),[hostDir+'\\chromium.json',hostDir+'\\chromium.json',hostDir+'\\chromium.json',hostDir+'\\firefox.json']);
  assert.ok(calls.some(call=>call.args[1].includes('\\Mozilla\\NativeMessagingHosts\\')));
  const writes=[];const counting={...fsApi,promises:{...fsApi.promises,writeFile:async(...args)=>{writes.push(args[0]);return fsApi.promises.writeFile(...args);}}};
  await setup.registerNativeHost({hostDir,bundleDir:bundle,platform:'win32',fsApi:counting,execFileImpl,systemRoot:'C:\\Windows'});
  assert.ok(!writes.some(name=>name.startsWith(result.hostPath+'.')),'an identical connector is not rewritten');
  fsApi.store.set(path.join(bundle,'ravenshelf-browser-host.exe'),Buffer.concat([Buffer.from('MZ'),crypto.randomBytes(64)]));
  await assert.rejects(setup.registerNativeHost({hostDir,bundleDir:bundle,platform:'win32',fsApi,execFileImpl}),/connector changed/);
  await assert.rejects(setup.registerNativeHost({hostDir,bundleDir:bundle,platform:'linux',fsApi,execFileImpl}),/Windows only/);
  await assert.rejects(setup.registerNativeHost({hostDir:'relative\\dir',bundleDir:bundle,platform:'win32',fsApi,execFileImpl}),/Invalid connector location/);
  let failures=0;const removal=(file,args,options,callback)=>{calls.push({args});callback(++failures===2?new Error('missing key'):null);};
  fsApi.store.set(hostDir+'\\endpoint.json',Buffer.from('{}'));
  const removed=await setup.unregisterNativeHost({hostDir,platform:'win32',fsApi,execFileImpl:removal});
  assert.equal(removed.removed,3);assert.equal(calls.filter(call=>call.args[0]==='delete').length,4);
  for(const name of ['chromium.json','firefox.json','endpoint.json'])assert.equal(fsApi.store.has(hostDir+'\\'+name),false,name);
  assert.deepEqual(await setup.unregisterNativeHost({hostDir,platform:'linux',fsApi,execFileImpl:removal}),{removed:0});
});

// ---------- bridge ----------
function lists(listed={}){
  return {version:'v1',total:3,lookup:host=>{for(const [domain,category] of Object.entries(listed))if(host===domain||host.endsWith('.'+domain))return {category,label:category+' sites',domain};return null;},
    browserManifest:()=>({version:'v1',total:3,rules:[{id:1,category:'malware',count:2}]}),browserRule:id=>id===1?{id:1,category:'malware',domains:['bad.example','worse.example']}:null};
}
function bridgeFixture(t,options={}){
  const dir=temp(),events={queued:[],opened:[],notes:[],revealed:0,reputation:[]};
  const bridge=new BrowserBridge({hostDir:dir,threatLists:lists(options.listed||{'bad.example':'malware'}),appVersion:'0.5.0',
    inspect:options.inspect||(async(url,{lookupHost,referer})=>({status:'ready',url,sourceUrl:url,filename:new URL(url).pathname.split('/').pop()||'file',size:10,chain:[{url,host:new URL(url).hostname,listed:lookupHost(new URL(url).hostname)}],sniffed:'zip',referer})),
    resolveProvider:options.resolveProvider||null,virusTotal:options.virusTotal||null,now:options.now||Date.now,
    queueDownload:async entry=>{events.queued.push(entry);return options.queueResult||{added:1};},openExternal:async url=>{events.opened.push(url);},
    reveal:()=>{events.revealed++;},notify:note=>events.notes.push(note),setReputation:(id,value)=>events.reputation.push([id,value])});
  t.after(()=>bridge.stop());
  return {bridge,dir,events};
}
async function send(dir,frames,{raw=false}={}){
  const endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));
  const address=process.platform==='win32'?`\\\\.\\pipe\\${endpoint.pipe}`:path.join(dir,`${endpoint.pipe}.sock`);
  return new Promise((resolve,reject)=>{
    const socket=net.connect(address),chunks=[];
    socket.on('data',chunk=>chunks.push(chunk));socket.on('error',reject);
    socket.on('close',()=>{const data=Buffer.concat(chunks);if(!data.length)return resolve(null);resolve(JSON.parse(data.subarray(4,4+data.readUInt32LE(0)).toString('utf8')));});
    socket.write(raw?frames:Buffer.concat(frames.map(frame=>protocol.encodeFrame(frame))));
  });
}
async function ask(dir,message,{origin=CHROME,token}={}){
  const endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));
  return send(dir,[{v:1,token:token||endpoint.token,origin},{v:1,...message}]);
}

test('the bridge answers only connections that present this session’s token and an allowed extension',async t=>{
  const {bridge,dir}=bridgeFixture(t);await bridge.start();
  const endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));
  assert.equal(endpoint.schema,1);assert.match(endpoint.pipe,/^ravenshelf-[a-f0-9]{32}$/);assert.match(endpoint.token,/^[a-f0-9]{64}$/);
  const hello=await ask(dir,{type:'hello',extensionVersion:'0.5.0',browser:'chromium'});
  assert.deepEqual(hello,{ok:true,app:'Ravenshelf',version:'0.5.0',capture:true,protection:{version:'v1',total:3}});
  assert.equal(bridge.snapshot().contact.browser,'chromium');
  assert.equal((await ask(dir,{type:'hello',extensionVersion:'0.5.0',browser:'firefox'},{origin:FIREFOX})).ok,true);
  assert.equal(bridge.snapshot().contact.browser,'firefox');
  assert.equal(await ask(dir,{type:'threats'},{token:'f'.repeat(64)}),null,'a wrong token gets no answer');
  assert.equal(await ask(dir,{type:'threats'},{origin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'}),null,'an unknown extension gets no answer');
  assert.equal(await send(dir,Buffer.from([0xff,0xff,0xff,0xff,1,2,3]),{raw:true}),null,'an oversized frame is dropped');
  assert.equal(await send(dir,[{v:1,token:endpoint.token}]),null);
  assert.deepEqual(await ask(dir,{type:'capture',url:'blob:https://x.example/1'}),{ok:false,error:'invalid'});
  assert.deepEqual((await ask(dir,{type:'threats'})).manifest.rules,[{id:1,category:'malware',count:2}]);
  assert.deepEqual((await ask(dir,{type:'threatRule',id:1})).rule.domains,['bad.example','worse.example']);
  assert.deepEqual(await ask(dir,{type:'threatRule',id:2}),{ok:false,error:'not-found'});
  assert.deepEqual(await ask(dir,{type:'lookup',host:'cdn.bad.example'}),{ok:true,listed:{category:'malware',label:'malware sites'}});
  assert.deepEqual(await ask(dir,{type:'lookup',host:'good.example'}),{ok:true,listed:null});
  await bridge.stop();
  assert.equal(fs.existsSync(path.join(dir,'endpoint.json')),false);
});

test('listed, deceptive and unencrypted program downloads are blocked at once',async t=>{
  const {bridge,events}=bridgeFixture(t);
  const decide=message=>bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',...message}));
  let decision=decide({url:'https://cdn.example/a.zip',referrer:'https://sub.bad.example/page'});
  assert.equal(decision.action,'block');assert.match(decision.reason,/sub\.bad\.example is on Ravenshelf’s list of malware sites/);
  decision=decide({url:'https://cdn.example/a',filename:'C:\\Users\\Player\\Downloads\\invoice.pdf.exe'});
  assert.equal(decision.action,'block');assert.match(decision.reason,/really a \.exe program/);
  assert.ok(bridge.snapshot().captures.some(capture=>capture.name==='invoice.pdf.exe'),'local paths from the browser are reduced to the file name');
  assert.ok(!JSON.stringify(bridge.snapshot()).includes('Player'),'the local download folder is not kept');
  assert.equal(decide({url:'http://plain.example/setup.exe'}).action,'block');
  assert.deepEqual(decide({url:'http://plain.example/notes.zip'}),{action:'browser'});
  assert.equal(events.notes.length,0,'the browser shows quick blocks, so the app does not notify a second time');
  assert.equal(events.revealed,0,'blocked downloads do not steal focus');
  assert.ok(bridge.snapshot().captures.every(capture=>capture.status==='blocked'));
});

test('a normal download is taken, checked, and queued only when the user chooses',async t=>{
  const {bridge,events}=bridgeFixture(t);
  const decision=bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:'https://short.example/x',finalUrl:'https://cdn.example/game.zip',referrer:'http://insecure.example/',pageUrl:'https://page.example/',filename:'game.zip',totalBytes:10}));
  assert.equal(decision.action,'take');assert.equal(events.revealed,1);assert.match(events.notes[0].title,/Review a download/);
  assert.deepEqual(bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:'https://short.example/x'})),{action:'take',id:decision.id},'a repeated capture reuses the pending review');
  await until(()=>bridge.snapshot().captures[0].status==='ready','inspection');
  const capture=bridge.snapshot().captures[0];
  assert.equal(capture.verdict.level,'ok');assert.equal(capture.address,'https://cdn.example/game.zip');assert.equal(capture.pageHost,'page.example');
  assert.equal(JSON.stringify(bridge.snapshot()).includes('"entry"'),false,'queue details stay in the main process');
  assert.equal(events.queued.length,0,'nothing downloads before the user chooses');
  await assert.rejects(bridge.action({id:decision.id,action:'explode'}),/Unknown action/);
  const result=await bridge.action({id:decision.id,action:'download'});
  assert.equal(result.added,1);
  assert.deepEqual(events.queued[0],{status:'ready',url:'https://cdn.example/game.zip',sourceUrl:'https://cdn.example/game.zip',filename:'game.zip',size:10,host:'cdn.example',referer:'https://page.example/',origin:'browser',markOfTheWeb:true});
  assert.equal(bridge.snapshot().captures[0].status,'queued');
  await assert.rejects(bridge.action({id:decision.id,action:'download'}),/cannot download/);
  await assert.rejects(bridge.action({id:'missing',action:'download'}),/no longer available/);
});

test('downloading a link the queue already holds says so instead of claiming it was added',async t=>{
  const {bridge,events}=bridgeFixture(t,{queueResult:{added:0,ids:[]}});
  const decision=bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:'https://cdn.example/again.zip',filename:'again.zip'}));
  assert.equal(decision.action,'take');
  await until(()=>bridge.snapshot().captures[0].status==='ready','inspection');
  const result=await bridge.action({id:decision.id,action:'download'});
  assert.equal(result.added,0);assert.equal(events.queued.length,1);
  const capture=bridge.snapshot().captures[0];
  assert.equal(capture.status,'duplicate');assert.match(capture.message,/already in your Downloads list/);
  assert.equal(bridge.snapshot().pending,0,'a duplicate no longer waits for a decision');
  await assert.rejects(bridge.action({id:decision.id,action:'download'}),/cannot download/);
});

test('risky files need explicit confirmation and blocked ones cannot be forced',async t=>{
  const inspect=async url=>({status:url.includes('blocked')?'blocked':'ready',url,sourceUrl:url,filename:url.split('/').pop(),size:5,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:url.endsWith('.pdf')?'windows-program':'unknown'});
  const {bridge,events}=bridgeFixture(t,{inspect});
  const take=url=>bridge.receive('firefox',protocol.validateRequest({v:1,type:'capture',url})).id;
  const setup=take('https://cdn.example/setup.exe'),disguised=take('https://cdn.example/report.pdf'),listed=take('https://cdn.example/blocked/file.zip');
  await until(()=>bridge.snapshot().captures.every(capture=>capture.status!=='checking'),'inspections');
  const byId=Object.fromEntries(bridge.snapshot().captures.map(capture=>[capture.id,capture]));
  assert.equal(byId[setup].verdict.level,'warning');assert.equal(byId[disguised].status,'blocked');assert.equal(byId[listed].status,'blocked');
  await assert.rejects(bridge.action({id:setup,action:'download'}),/Confirm that you understand/);
  await assert.rejects(bridge.action({id:setup,action:'download',acknowledgeRisk:'yes'}),/Confirm/);
  await bridge.action({id:setup,action:'download',acknowledgeRisk:true});assert.equal(events.queued.length,1);
  for(const id of [disguised,listed])for(const action of ['download','browser'])await assert.rejects(bridge.action({id,action,acknowledgeRisk:true}),/blocked this download/);
  assert.equal(events.queued.length,1);assert.equal(events.opened.length,0);
});

test('links Ravenshelf cannot fetch can go back to the browser once',async t=>{
  const inspect=async url=>({status:'manual',message:'This site gives the file only to your browser (it needs a sign-in, cookies or a check).',url,sourceUrl:url,chain:[{url,host:new URL(url).hostname,listed:null}]});
  const {bridge,events}=bridgeFixture(t,{inspect});
  const message={v:1,type:'capture',url:'https://login.example/file',finalUrl:'https://cdn.login.example/file.zip'};
  const {id}=bridge.receive('chromium',protocol.validateRequest(message));
  await until(()=>bridge.snapshot().captures[0].status==='manual','inspection');
  await assert.rejects(bridge.action({id,action:'download'}),/cannot download this link/);
  await bridge.action({id,action:'browser'});
  assert.deepEqual(events.opened,['https://login.example/file']);assert.equal(bridge.snapshot().captures[0].status,'sent-to-browser');
  assert.deepEqual(bridge.receive('chromium',protocol.validateRequest(message)),{action:'browser'},'the browser may now keep this one download');
  assert.equal(bridge.receive('chromium',protocol.validateRequest(message)).action,'take','the allowance is used once');
});

test('supported file hosts are resolved by Ravenshelf without visiting their pages',async t=>{
  const resolved=[];
  const resolveProvider=async url=>{resolved.push(url);return {status:'ready',url:'https://dl.fuckingfast.co/dl/token/Game.part01.rar',filename:'Game.part01.rar',size:2048,host:'FuckingFast',headers:{Cookie:'cf=1','User-Agent':'UA'},referer:url,message:'ok'};};
  const {bridge,events}=bridgeFixture(t,{resolveProvider,inspect:async()=>{throw new Error('generic inspection must not run');}});
  assert.equal(isProvider('https://fuckingfast.co/abc'),true);assert.equal(isProvider('https://notfuckingfast.co/abc'),false);
  const {id}=bridge.receive('chromium',protocol.validateRequest({v:1,type:'send',kind:'link',url:'https://fuckingfast.co/abc#Game.part01.rar',pageUrl:'https://fitgirl-repacks.site/game/'}));
  await until(()=>bridge.snapshot().captures[0].status==='ready','provider resolution');
  assert.deepEqual(resolved,['https://fuckingfast.co/abc#Game.part01.rar']);
  assert.deepEqual(bridge.snapshot().captures[0].chain.map(hop=>hop.host),['fuckingfast.co','dl.fuckingfast.co']);
  await bridge.action({id,action:'download'});
  assert.deepEqual(events.queued[0].headers,{Cookie:'cf=1','User-Agent':'UA'});assert.equal(events.queued[0].referer,'https://fuckingfast.co/abc#Game.part01.rar');
  assert.equal(bridge.snapshot().captures[0].source,'link');
});

test('VirusTotal domain reports join the verdict and stop at the free limit',async t=>{
  const asked=[];
  const virusTotal={snapshot:()=>({configured:true,fileChecks:true}),lookup:async(kind,subject)=>{asked.push([kind,subject]);return subject==='b.example'?{status:'skipped',reason:'limit',kind,subject}:{status:'ok',kind,subject,malicious:subject==='a.example'?4:0,suspicious:0,harmless:50,undetected:9,link:'https://www.virustotal.com/gui/domain/'+subject};}};
  const inspect=async url=>({status:'ready',url:'https://c.example/f.zip',sourceUrl:url,filename:'f.zip',size:1,chain:['a.example','b.example','c.example'].map(host=>({url:'https://'+host+'/',host,listed:null})),sniffed:'zip'});
  const {bridge}=bridgeFixture(t,{virusTotal,inspect});
  bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:'https://a.example/x'}));
  await until(()=>bridge.snapshot().captures[0].status!=='checking','inspection');
  assert.deepEqual(asked,[['domain','a.example'],['domain','b.example']],'lookups stop once the limit is reached');
  const capture=bridge.snapshot().captures[0];
  assert.equal(capture.verdict.level,'warning');assert.match(capture.verdict.reasons.find(item=>item.code==='virustotal').message,/4 security vendors/);
  assert.deepEqual(capture.virusTotal.map(item=>item.status),['ok','skipped']);
});

test('only a finished browser download’s fingerprint is checked with VirusTotal',async t=>{
  const lookups=[];let settings={configured:true,fileChecks:true};
  const virusTotal={snapshot:()=>settings,lookup:async(kind,subject)=>{lookups.push([kind,subject]);return {status:'ok',kind,subject,malicious:3,suspicious:0,harmless:1,undetected:60,link:'https://www.virustotal.com/gui/file/'+subject};}};
  const {bridge,events}=bridgeFixture(t,{virusTotal});
  const file=path.join(temp(),'game.zip');fs.writeFileSync(file,'payload');
  const hash=crypto.createHash('sha256').update('payload').digest('hex');
  const result=await bridge.afterDownload({id:'d1',origin:'browser',name:'game.zip'},file);
  assert.deepEqual(lookups,[['file',hash]]);assert.equal(result.malicious,3);
  assert.deepEqual(events.reputation[0][0],'d1');assert.match(events.notes.at(-1).body,/3 security vendors/);
  assert.equal(await bridge.afterDownload({id:'d2',name:'catalog.rar'},file),null);
  settings={configured:true,fileChecks:false};assert.equal(await bridge.afterDownload({id:'d3',origin:'browser'},file),null);
  assert.equal(lookups.length,1);
});

test('reviews expire, can be dismissed or rechecked, and the queue of reviews is bounded',async t=>{
  let now=Date.parse('2026-11-08T12:00:00Z');let release;const gate=new Promise(resolve=>{release=resolve;});
  const inspect=async url=>{await gate;return {status:'ready',url,sourceUrl:url,filename:'f.zip',size:1,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:'zip'};};
  const {bridge}=bridgeFixture(t,{inspect,now:()=>now});
  const ids=[];for(let i=0;i<MAX_PENDING;i++)ids.push(bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:`https://cdn.example/${i}.zip`})).id);
  const overflow=bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:'https://cdn.example/overflow.zip'}));
  assert.equal(overflow.action,'block');assert.match(overflow.reason,/Too many downloads/);
  release();await until(()=>bridge.snapshot().captures.every(capture=>capture.status==='ready'),'inspections');
  await bridge.action({id:ids[0],action:'dismiss'});assert.equal(bridge.snapshot().captures.length,MAX_PENDING-1);
  await bridge.action({id:ids[1],action:'recheck'});await until(()=>bridge.snapshot().captures.find(capture=>capture.id===ids[1]).status==='ready','recheck');
  await assert.rejects(bridge.action({id:ids[0],action:'download'}),/no longer available/);
  now+=61*60*1000;assert.equal(bridge.snapshot().captures.length,0,'old reviews expire');
});

test('requests beyond the rate limit are refused',async t=>{
  const {bridge}=bridgeFixture(t,{now:()=>1});
  let busy=0;for(let i=0;i<260;i++){const response=await bridge.respond('chromium',{v:1,type:'threats'});if(response.error==='busy')busy++;}
  assert.equal(busy,20);
});

test('a name is judged in the form it will be saved in, and the review shows that form',async t=>{
  const {safeName,folderName}=require('../src/safe-name.cjs');
  // Names that only look harmless until Windows-safe cleaning turns them into programs.
  const FULLWIDTH_EXE='SkyUI patch.\uff45\uff58\uff45',FULLWIDTH_DOT='photo.jpg\uff0eexe';
  assert.equal(safeName(FULLWIDTH_EXE),'SkyUI patch.exe');assert.equal(safeName(FULLWIDTH_DOT),'photo.jpg.exe');
  const inspect=async url=>({status:'ready',url,sourceUrl:url,filename:decodeURIComponent(url.split('/').pop()),size:5,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:'windows-program'});
  const {bridge,events}=bridgeFixture(t,{inspect});
  const decide=message=>bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',...message}));
  // From the browser's own file name: blocked at once, like the plain spelling.
  let decision=decide({url:'https://cdn.example/a',filename:FULLWIDTH_DOT});
  assert.equal(decision.action,'block');assert.match(decision.reason,/really a \.exe program/);
  decision=decide({url:'http://plain.example/a',filename:'tool.\uff45\uff58\uff45'});
  assert.equal(decision.action,'block','a program over plain HTTP, however its ending is spelled');
  // From the server's name for the file: a warning that must be confirmed, and the saved name on show.
  const id=decide({url:`https://cdn.example/${encodeURIComponent(FULLWIDTH_EXE)}`}).id;
  const dotted=decide({url:'https://cdn.example/setup.exe.'}).id;
  // The browser's own name for the file is cleaned as soon as it arrives: the notice already shows it.
  decide({url:'https://cdn.example/b',filename:'run.scr  '});
  assert.match(events.notes.at(-1).body,/^run\.scr was sent from your browser/);
  await until(()=>bridge.snapshot().captures.every(capture=>capture.status!=='checking'),'inspections');
  const byId=Object.fromEntries(bridge.snapshot().captures.map(capture=>[capture.id,capture]));
  assert.equal(byId[id].name,'SkyUI patch.exe');assert.equal(byId[id].verdict.level,'warning');
  assert.ok(byId[id].verdict.reasons.some(reason=>reason.code==='program'),JSON.stringify(byId[id].verdict));
  assert.equal(byId[dotted].name,'setup.exe');assert.equal(byId[dotted].verdict.level,'warning');
  await assert.rejects(bridge.action({id,action:'download'}),/Confirm that you understand/);
  await bridge.action({id,action:'download',acknowledgeRisk:true});
  assert.equal(events.queued[0].filename,'SkyUI patch.exe');
  assert.equal(safeName(events.queued[0].filename),events.queued[0].filename,'the queue saves it under exactly this name');
  // With no name from the browser or the server, the name comes from the address, and is judged in its saved form too.
  decision=decide({url:`http://plain.example/${encodeURIComponent('tool.\uff45\uff58\uff45')}`});
  assert.equal(decision.action,'block','a program over plain HTTP whose name is only in the address');
  assert.equal(bridge.snapshot().captures.find(capture=>capture.id===decision.id).name,'tool.exe');
  const bare=bridgeFixture(t,{inspect:async url=>({status:'ready',url,sourceUrl:url,size:5,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:'windows-program'})});
  const taken=bare.bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',url:`https://cdn.example/${encodeURIComponent(FULLWIDTH_EXE)}`}));
  assert.match(bare.events.notes.at(-1).body,/^SkyUI patch\.exe was sent from your browser/,'the notice names it as it will be saved');
  await until(()=>bare.bridge.snapshot().captures.every(capture=>capture.status!=='checking'),'inspection');
  const [named]=bare.bridge.snapshot().captures;
  assert.equal(named.id,taken.id);assert.equal(named.name,'SkyUI patch.exe');assert.equal(named.verdict.level,'warning');
  // Every name the review can show is already in its saved form.
  for(const capture of bridge.snapshot().captures)assert.equal(safeName(capture.name),capture.name,capture.name);
  // Cleaning a name can uncover something to clean again. The judged name is the one that no longer
  // changes, because the queue cleans every name once more before it saves the file.
  const LONG_DEVICE='con.'+'a'.repeat(171)+'.exex';
  assert.equal(LONG_DEVICE.length,180);assert.equal(safeName(LONG_DEVICE).slice(-5),'.exex','cleaned once, it still looks harmless');
  assert.equal(safeName(safeName(LONG_DEVICE)).slice(-4),'.exe','cleaned again, as the queue would, it is a program');
  assert.equal(savedName(LONG_DEVICE),'_con.'+'a'.repeat(171)+'.exe');
  const device=decide({url:`https://cdn.example/${LONG_DEVICE}`}).id;
  decide({url:'https://cdn.example/d',filename:'run.bat'+'\ufeff.'.repeat(3)});
  assert.match(events.notes.at(-1).body,/^run\.bat was sent from your browser/,'layers of invisible characters and dots are gone from the first moment');
  await until(()=>bridge.snapshot().captures.every(capture=>capture.status!=='checking'),'more inspections');
  const later=Object.fromEntries(bridge.snapshot().captures.map(capture=>[capture.id,capture]));
  assert.equal(later[device].name,'_con.'+'a'.repeat(171)+'.exe');assert.equal(later[device].verdict.level,'warning');
  assert.ok(later[device].verdict.reasons.some(reason=>reason.code==='program'),JSON.stringify(later[device].verdict));
  await bridge.action({id:device,action:'download',acknowledgeRisk:true});
  assert.equal(events.queued.at(-1).filename,later[device].name);assert.equal(safeName(events.queued.at(-1).filename),later[device].name,'saved under the judged name');
  assert.equal(savedName('run.bat'+'\ufeff.'.repeat(3)),'run.bat');assert.equal(savedName('a'+'\ufeff.'.repeat(119)),'a','however deep the layers go');
  assert.equal(savedName(''),undefined);assert.equal(savedName(undefined),undefined);assert.equal(savedName('game.zip'),'game.zip');
  // The same holds for names made of the awkward pieces in any order, and ordinary names are not touched.
  const pieces=['con','NUL','com1','.','..',' ','a','.exe','.bat','x','\ufeff','\u2028','\u1680','\u00a0','\u3000','\uff0e','\uff23\uff2f\uff2e','\ud83d\ude00','_',':','/','*','\t','\u200b','e\u0301','\ufdfa','\ufeff.'];
  let seed=20261111,unsettled=0,uncovered=0;const pick=n=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed%n;};
  for(let i=0;i<20000;i++){
    let odd='';for(let j=1+pick(6);j>0;j--){const piece=pieces[pick(pieces.length)];odd+=pick(4)?piece:piece.repeat(1+pick(190));}
    const name=savedName(odd);
    if(name===undefined){assert.equal(odd,'');continue;}
    if(safeName(name)!==name)unsettled++;
    if(safeName(odd)!==name)uncovered++;
  }
  assert.equal(unsettled,0,'every judged name is saved unchanged');assert.ok(uncovered>50,`${uncovered} of these names needed more than one cleaning`);
  for(const plain of ['game.zip','Setup (1).exe','My Mod v1.2-12604-1-2.7z','\u0633\u0643\u0627\u064a.rar','archive.part01.rar'])assert.equal(savedName(plain),safeName(plain));
  // Folder names: cut to 100 characters, and still without a trailing dot or space after the cut.
  assert.equal(folderName('a'.repeat(97)+'\u2026b'),'a'.repeat(97));
  assert.equal(folderName('\u2025'.repeat(50)+'x'),'Imported files');
  assert.equal(folderName('a'.repeat(96)+'\ufdfa'),'a'.repeat(96)+'\u0635\u0644\u0649','a letter that spells out several words: cut at 100, then the space the cut left is removed');
  for(const odd of ['a'.repeat(97)+'\u2026b','\u2025'.repeat(50)+'x','a'.repeat(96)+'\ufdfa','b'.repeat(99)+'. .','c'.repeat(99)+'\ud83d\ude00','CON','con.txt','..','.',' ','x'.repeat(300)]){
    const name=folderName(odd);
    assert.ok(name.length>0&&name.length<=100,odd);assert.doesNotMatch(name,/[. ]$/,odd);assert.doesNotMatch(name,/[\ud800-\udbff]$/,odd);
    assert.doesNotMatch(name,/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i,odd);assert.equal(folderName(name),name,'cleaning twice changes nothing');
  }
  // The cleaning normalises before it replaces path characters, so look-alike dots and slashes cannot survive as real ones.
  assert.equal(safeName('\uff0e\uff0e\uff0f\uff0e\uff0e\uff0fWindows'),'.._.._Windows');
  assert.equal(folderName('\uff0e\uff0e'),'Imported files');
});

test('file names from the browser are reduced to a safe base name',()=>{
  assert.equal(baseName('C:\\Users\\Player\\Downloads\\game.zip'),'game.zip');
  assert.equal(baseName('/home/user/file.rar'),'file.rar');assert.equal(baseName('name\u0007.zip'),'name.zip');assert.equal(baseName(''),undefined);assert.equal(baseName(undefined),undefined);
});
