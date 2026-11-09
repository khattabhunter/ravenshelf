'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const P=require('../src/browser-extension/policy.js');
const protocol=require('../src/browser-protocol.cjs');
const {EXTENSION_FILES,extensionManifest}=require('../src/browser-setup.cjs');
const {RULE_BASES,NEVER_BLOCK,neverBlock,validEntry}=require('../src/threat-lists.cjs');

const DIR=path.join(__dirname,'..','src','browser-extension');
const read=name=>fs.readFileSync(path.join(DIR,name),'utf8');
const tick=(ms=15)=>new Promise(resolve=>setTimeout(resolve,ms));

test('download plans keep local paths and private windows out, and match what the app accepts',()=>{
  const on={capture:true};
  assert.deepEqual(P.downloadPlan({id:1,url:'https://a.example/x.zip'},{capture:false}),{kind:'ignore'});
  assert.deepEqual(P.downloadPlan({id:1,url:'https://a.example/x.zip',incognito:true},on),{kind:'ignore'},'private windows are never captured');
  assert.deepEqual(P.downloadPlan({id:1,url:'https://a.example/x.zip',byExtensionId:'other'},on),{kind:'ignore'});
  for(const url of ['ftp://a.example/x.zip','file:///C:/x.zip','chrome://downloads/','https://a.example/'+'x'.repeat(8200)])assert.deepEqual(P.downloadPlan({id:1,url},on),{kind:'ignore'},url);
  const chrome=P.downloadPlan({id:1,url:'https://short.example/x',finalUrl:'https://cdn.example/game.zip',referrer:'https://page.example/p',filename:'C:\\Users\\Player\\Downloads\\game.zip',mime:'application/zip',totalBytes:1234,fileSize:0},on);
  assert.deepEqual(chrome,{kind:'ask',message:{type:'capture',url:'https://short.example/x',incognito:false,finalUrl:'https://cdn.example/game.zip',referrer:'https://page.example/p',filename:'game.zip',mime:'application/zip',totalBytes:1234}});
  const firefox=P.downloadPlan({id:2,url:'https://cdn.example/a.rar',referrer:'moz-extension://abc/page.html',filename:'/home/player/Downloads/a.rar',totalBytes:-1,fileSize:-1},on);
  assert.deepEqual(firefox.message,{type:'capture',url:'https://cdn.example/a.rar',incognito:false,filename:'a.rar'},'non-web referrers, unknown sizes and folders are dropped');
  assert.equal(P.downloadPlan({id:3,url:'https://a.example/x',finalUrl:'https://a.example/x'},on).message.finalUrl,undefined,'an unchanged final address is not repeated');
  for(const plan of [chrome,firefox])assert.doesNotThrow(()=>protocol.validateRequest({v:1,...plan.message}),'the app accepts every capture the extension sends');
  assert.ok(!JSON.stringify([chrome,firefox]).includes('Player')&&!JSON.stringify(firefox).includes('/home/'),'no local path leaves the browser');
});

test('programs that a page builds in the browser are blocked locally',()=>{
  const on={capture:true};
  const plan=P.downloadPlan({id:1,url:'blob:https://bad.example/1234-5678',filename:'C:\\Users\\Player\\Downloads\\setup.exe'},on);
  assert.equal(plan.kind,'block');assert.match(plan.reason,/setup\.exe/);assert.ok(!plan.reason.includes('Player'));
  for(const name of ['run.ps1','x.vbs','disk.iso','a.lnk','b.msi','c.scr','d.hta','e.js'])assert.equal(P.downloadPlan({id:1,url:'data:application/octet-stream;base64,AA==',filename:name},on).kind,'block',name);
  for(const name of ['photo.png','notes.txt','archive.zip','']) assert.equal(P.downloadPlan({id:1,url:'blob:https://site.example/1',filename:name},on).kind,'ignore',name);
});

test('threat rules, the redirect rule and the switches build valid, correctly ranked browser rules',()=>{
  const rule=P.threatRule({id:5,category:'malware',domains:['bad.example','xn--80ak6aa92e.com','under_score.example','UPPER.example','bad example','http://x.example','1.2.3.4','-lead.example','a'.repeat(64)+'.example']});
  assert.deepEqual(rule.condition.requestDomains,['bad.example','xn--80ak6aa92e.com','under_score.example']);
  assert.equal(rule.priority,1);assert.deepEqual(rule.action,{type:'block'});assert.ok(rule.condition.resourceTypes.includes('main_frame'));
  for(const bad of [null,{id:0,domains:['a.example']},{id:1000,domains:['a.example']},{id:1,domains:'a.example'},{id:2,domains:['not a domain']}])assert.equal(P.threatRule(bad),null);
  const guard=P.guardRule(),allow=P.allowAllRule();
  assert.deepEqual(guard.condition,{initiatorDomains:[...P.PROTECTED_HOSTS],excludedRequestDomains:[...P.PROTECTED_HOSTS],resourceTypes:['main_frame']});
  assert.ok(guard.priority>allow.priority&&allow.priority>rule.priority,'redirect rule > pause switch > lists');
  assert.equal(allow.action.type,'allow');
  const ids=options=>options.addRules.map(item=>item.id);
  assert.deepEqual(P.toggleRules({guard:true,protection:true,pausedUntil:0},1000),{removeRuleIds:[1000,1001],addRules:[guard]});
  assert.deepEqual(ids(P.toggleRules({guard:true,protection:false},1000)),[1000,1001]);
  assert.deepEqual(ids(P.toggleRules({guard:false,protection:true},1000)),[]);
  assert.deepEqual(ids(P.toggleRules({guard:true,protection:true,pausedUntil:5000},1000)),[1001],'a pause lifts both protections');
  assert.deepEqual(ids(P.toggleRules({guard:true,protection:true,pausedUntil:500},1000)),[1000],'an expired pause does nothing');
});

test('the extension reads rule numbers the same way the app hands them out',()=>{
  for(const [category,base] of Object.entries(RULE_BASES))assert.equal(P.ruleCategory(base),category);
  assert.equal(P.ruleCategory(99),'malware');assert.equal(P.ruleCategory(199),'phishing');assert.equal(P.ruleCategory(499),'threats');assert.equal(P.ruleCategory(699),'popups');
  for(const id of [0,700,999,1000,1001])assert.equal(P.ruleCategory(id),null);
  assert.equal(P.HOST_NAME,protocol.HOST_NAME);
  assert.deepEqual(P.THREAT_RULE_IDS.length,999);assert.equal(P.THREAT_RULE_IDS[0],1);assert.equal(P.THREAT_RULE_IDS.at(-1),999);
  for(const host of P.SEND_PAGE_HOSTS){assert.ok(NEVER_BLOCK.includes(host),host);assert.equal(neverBlock(host),true,host);}
  for(const host of P.PROTECTED_HOSTS)assert.ok(P.SEND_PAGE_HOSTS.includes(host));
  // Every domain the app can put in a rule survives the extension's own check.
  for(const entry of ['bad.example','a-b.c-d.example','under_score.example','xn--bcher-kva.example','x1.y2.example'])if(validEntry(entry))assert.ok(P.threatRule({id:1,domains:[entry]}),entry);
});

test('pop-ups from file hosts are closed unless they stay on the same host',()=>{
  assert.equal(P.popupVerdict('fitgirl-repacks.site','https://ads.example/'),'allow');
  assert.equal(P.popupVerdict('','https://ads.example/'),'allow');
  for(const source of ['fuckingfast.co','www.fuckingfast.co','filekeeper.net','fuckingfast.net']){
    assert.equal(P.popupVerdict(source,'https://ads.example/x'),'close');
    assert.equal(P.popupVerdict(source,'https://fuckingfast.co/dl/abc'),'allow');
    assert.equal(P.popupVerdict(source,'https://fs3.filekeeper.net:8443/f'),'allow');
    assert.equal(P.popupVerdict(source,'about:blank'),'watch');assert.equal(P.popupVerdict(source,''),'watch');
    for(const url of ['javascript:alert(1)','data:text/html,x','blob:https://ads.example/1','https://fuckingfast.co.evil.example/','https://evilfuckingfast.co/'])assert.equal(P.popupVerdict(source,url),'close',url);
  }
  assert.equal(P.canSendPage('https://fuckingfast.co/abc#Game.part1.rar'),true);
  assert.equal(P.canSendPage('https://datanodes.to/abc'),true);
  for(const url of ['http://fuckingfast.co/abc','https://fuckingfast.co.evil.example/','https://example.org/','not a url'])assert.equal(P.canSendPage(url),false,url);
});

test('connector errors are told apart for the toolbar status',()=>{
  assert.equal(P.nativeError(new Error('Specified native messaging host not found.')),'not-installed');
  assert.equal(P.nativeError(new Error('No such native application io.github.khattabhunter.ravenshelf')),'not-installed');
  assert.equal(P.nativeError(new Error('Access to the specified native messaging host is forbidden.')),'not-allowed');
  assert.equal(P.nativeError(new Error('Native host has exited.')),'unavailable');
  assert.equal(P.nativeError(undefined),'unavailable');
});

test('extension files are local, script-free in markup, and never contact the network',()=>{
  for(const file of EXTENSION_FILES)assert.ok(fs.existsSync(path.join(DIR,file)),file);
  for(const browser of ['chromium','firefox']){
    const manifest=extensionManifest(browser,'1.2.3');
    assert.equal(manifest.host_permissions,undefined,'no host permissions are requested');
    assert.deepEqual(manifest.content_scripts.map(script=>script.matches),[['https://www.youtube.com/*']],'only YouTube pages get a page script');
    assert.match(manifest.content_security_policy.extension_pages,/script-src 'self'/);
    for(const icon of Object.values(manifest.icons))assert.ok(EXTENSION_FILES.includes(icon),icon);
    for(const script of manifest.background.scripts||[manifest.background.service_worker])assert.ok(EXTENSION_FILES.includes(script),script);
    assert.ok(EXTENSION_FILES.includes(manifest.action.default_popup));
  }
  for(const file of EXTENSION_FILES.filter(name=>name.endsWith('.js'))){
    const source=read(file);
    assert.doesNotThrow(()=>new vm.Script(source,{filename:file}),file);
    for(const pattern of [/\bfetch\s*\(/,/XMLHttpRequest/,/WebSocket/,/sendBeacon/,/\beval\s*\(/,/new Function\b/,/innerHTML|outerHTML|insertAdjacentHTML|document\.write/,/connectNative/])assert.doesNotMatch(source,pattern,`${file}: ${pattern}`);
  }
  for(const file of EXTENSION_FILES.filter(name=>name.endsWith('.html'))){
    const html=read(file);
    assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)/i,`${file} has no inline script`);
    assert.doesNotMatch(html,/\son[a-z]+\s*=/i,`${file} has no inline handlers`);
    for(const [,src] of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(EXTENSION_FILES.includes(src),`${file} uses only packaged files: ${src}`);
    const script=file.replace('.html','.js');
    for(const [,id] of read(script).matchAll(/\$\('([A-Za-z]+)'\)/g))assert.match(html,new RegExp(`id="${id}"`),`${script} uses #${id}`);
  }
  assert.doesNotMatch(read('popup.css'),/@import|url\(/,'the stylesheet loads nothing');
});

// ---- the background script, run against a fake browser ----
// Values made inside the script's own context are copied out, so strict comparisons work.
const own=value=>value===undefined?value:JSON.parse(JSON.stringify(value));
function fakeBrowser({firefox=false,native=()=>({ok:false,error:'not-running'}),matched=[]}={}){
  const event=()=>{const listeners=[];return {listeners,addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.map(fn=>fn(...args))};};
  const calls=[],store={local:{},session:{}},dynamic=new Map();
  const onChanged=event();
  const area=name=>({
    get:async keys=>{const out={};for(const key of [].concat(keys))if(key in store[name])out[key]=structuredClone(store[name][key]);return out;},
    set:async values=>{Object.assign(store[name],structuredClone(values));onChanged.emit(values,name);}
  });
  const origin=firefox?'moz-extension://uuid/':'chrome-extension://ccgeallihglgkgpokepckdejgbfojcnh/';
  const menu={removeAll:async()=>{},create:(props,done)=>{calls.push(['menu',props.id]);done&&done();},onClicked:event()};
  const api={
    runtime:{id:'self',getManifest:()=>({version:'0.5.0'}),getURL:file=>origin+file,onMessage:event(),onInstalled:event(),onStartup:event(),
      sendNativeMessage:async(host,message)=>{assert.equal(host,P.HOST_NAME);message=own(message);calls.push(['native',message]);const reply=await native(message);if(reply instanceof Error)throw reply;return reply;}},
    storage:{local:area('local'),session:area('session'),onChanged},
    downloads:{onDeterminingFilename:firefox?undefined:event(),onCreated:event(),
      search:async({id})=>[{id,state:'in_progress'}],cancel:async id=>{calls.push(['cancel',id]);},erase:async query=>{calls.push(['erase',query.id]);},
      removeFile:async id=>{calls.push(['removeFile',id]);},pause:async id=>{calls.push(['pause',id]);},resume:async id=>{calls.push(['resume',id]);}},
    declarativeNetRequest:{DYNAMIC_RULESET_ID:'_dynamic',updateDynamicRules:async options=>{options=own(options);calls.push(['rules',options]);for(const id of options.removeRuleIds||[])dynamic.delete(id);for(const rule of options.addRules||[])dynamic.set(rule.id,rule);},
      getDynamicRules:async(filter)=>[...dynamic.values()].filter(rule=>!filter||!filter.ruleIds||filter.ruleIds.includes(rule.id)),
      getMatchedRules:async()=>({rulesMatchedInfo:matched}),setExtensionActionOptions:async()=>{}},
    webNavigation:{onCreatedNavigationTarget:event(),onBeforeNavigate:event(),onCommitted:event(),onErrorOccurred:event()},
    tabs:{onRemoved:event(),remove:async id=>{calls.push(['closeTab',id]);},update:async(id,props)=>{calls.push(['navigate',id,props.url]);},goBack:async id=>{calls.push(['goBack',id]);}},
    notifications:{create:async(id,options)=>{calls.push(['notify',options.title,options.message]);}},
    alarms:{create:name=>{calls.push(['alarm',name]);},clear:async()=>true,onAlarm:event()}
  };
  if(firefox){api.runtime.getBrowserInfo=async()=>({name:'Firefox'});api.menus=menu;}else api.contextMenus=menu;
  const context=vm.createContext({console,setTimeout,clearTimeout,URL,URLSearchParams,structuredClone,[firefox?'browser':'chrome']:api});
  vm.runInContext(read('policy.js'),context,{filename:'policy.js'});
  vm.runInContext(read('background.js'),context,{filename:'background.js'});
  const message=async(msg,url=origin+'popup.html',tab)=>new Promise(resolve=>{const handled=api.runtime.onMessage.emit(msg,{id:'self',url,tab},value=>resolve(own(value)))[0];if(handled!==true)resolve(undefined);});
  return {api,calls,store,dynamic,message,of:kind=>calls.filter(call=>call[0]===kind)};
}

test('Chrome: Ravenshelf takes, blocks or leaves each download, and an unanswered one stays in the browser',async()=>{
  let answer={ok:true,action:'take',id:'c1'};
  const b=fakeBrowser({native:message=>message.type==='capture'?answer:{ok:false,error:'invalid'}});
  const run=async(item)=>{const suggested=[];const kept=b.api.downloads.onDeterminingFilename.emit(item,()=>suggested.push(true))[0];assert.equal(kept,true);await tick();return suggested.length;};
  assert.equal(await run({id:1,url:'https://cdn.example/game.zip',filename:'game.zip'}),0,'a taken download is not handed back');
  assert.deepEqual(b.of('cancel').concat(b.of('erase')),[['cancel',1],['erase',1]]);
  assert.equal(b.of('native')[0][1].type,'capture');assert.equal(b.of('native')[0][1].v,1);
  answer={ok:true,action:'block',reason:'bad.example is on Ravenshelf’s list of malware sites.'};
  assert.equal(await run({id:2,url:'https://bad.example/x.zip'}),0);
  assert.ok(b.of('notify').some(call=>/blocked a download/.test(call[1])&&/malware/.test(call[2])));
  answer={ok:true,action:'browser'};
  assert.equal(await run({id:3,url:'http://plain.example/x.zip'}),1,'the browser keeps what Ravenshelf leaves');
  answer=new Error('Specified native messaging host not found.');
  assert.equal(await run({id:4,url:'https://cdn.example/y.zip'}),1,'without the app the download carries on in the browser');
  answer={ok:true,action:'take'};
  assert.equal(await run({id:5,url:'https://cdn.example/z.zip',incognito:true}),1);
  assert.equal(b.of('native').length,4,'private-window downloads are not even sent to the app');
  assert.equal(await run({id:6,url:'blob:https://x.example/1',filename:'setup.exe'}),0);
  assert.ok(b.of('cancel').some(call=>call[1]===6));
  await b.api.storage.local.set({capture:false});
  assert.equal(await run({id:7,url:'https://cdn.example/w.zip'}),1);
  assert.equal(b.of('cancel').filter(call=>[3,4,5,7].includes(call[1])).length,0);
});

test('Firefox: new downloads are paused while Ravenshelf decides, then removed or resumed',async()=>{
  let answer={ok:true,action:'take'};
  const b=fakeBrowser({firefox:true,native:()=>answer});
  b.api.downloads.onCreated.emit({id:1,url:'https://cdn.example/game.zip',filename:'/home/p/Downloads/game.zip',incognito:false});await tick();
  assert.deepEqual(b.calls.filter(call=>['pause','cancel','erase','resume'].includes(call[0])),[['pause',1],['cancel',1],['erase',1]]);
  assert.equal(b.of('native')[0][1].filename,'game.zip');
  answer={ok:true,action:'browser'};
  b.api.downloads.onCreated.emit({id:2,url:'https://cdn.example/b.zip',incognito:false});await tick();
  assert.deepEqual(b.calls.filter(call=>call[1]===2&&call[0]!=='native'),[['pause',2],['resume',2]]);
  b.api.downloads.onCreated.emit({id:3,url:'https://cdn.example/c.zip',incognito:true});await tick();
  assert.equal(b.calls.filter(call=>call[1]===3).length,0,'private-window downloads are left alone');
});

test('protection lists sync into browser rules, and a refused rule does not cost the others',async()=>{
  const native=message=>({
    hello:{ok:true,app:'Ravenshelf',version:'0.5.0',capture:true,protection:{version:'v1',total:3}},
    threats:{ok:true,manifest:{version:'v1',total:3,rules:[{id:1,category:'malware',count:2},{id:500,category:'popups',count:1}]}},
    threatRule:message.id===1?{ok:true,rule:{id:1,category:'malware',domains:['bad.example','worse.example']}}:{ok:true,rule:{id:500,category:'popups',domains:['ads.example']}}
  })[message.type];
  const b=fakeBrowser({native});
  b.api.runtime.onInstalled.emit({reason:'install'});await tick(40);
  const rules=b.of('rules').map(call=>call[1]);
  const full=rules.find(options=>options.addRules&&options.addRules.some(rule=>rule.id===1));
  assert.equal(full.removeRuleIds.length,999);assert.deepEqual(full.addRules.map(rule=>rule.id),[1,500]);
  assert.deepEqual(full.addRules[0].condition.requestDomains,['bad.example','worse.example']);
  assert.deepEqual(rules.at(-1),P.toggleRules({guard:true,protection:true,pausedUntil:0},Date.now()));
  assert.equal(b.store.local.listVersion,'v1');assert.equal(b.store.local.listTotal,3);assert.equal(b.store.local.status,'connected');
  assert.deepEqual(b.of('menu').map(call=>call[1]),['ravenshelf-link','ravenshelf-page','ravenshelf-youtube']);
  assert.ok(b.of('alarm').some(call=>call[0]==='alarm'&&call[1]==='ravenshelf-sync'));
  const before=b.of('native').length;
  b.api.alarms.onAlarm.emit({name:'ravenshelf-sync'});await tick(40);
  assert.deepEqual(b.of('native').slice(before).map(call=>call[1].type),['hello'],'an unchanged list version is not downloaded again');
  b.dynamic.clear();
  b.api.alarms.onAlarm.emit({name:'ravenshelf-sync'});await tick(40);
  assert.deepEqual([...b.dynamic.keys()].sort((x,y)=>x-y),[1,500,1000],'rules the browser lost are downloaded again');
  // A browser that refuses the combined update still gets every rule it accepts.
  const c=fakeBrowser({native});
  let first=true;
  c.api.declarativeNetRequest.updateDynamicRules=async options=>{options=own(options);c.calls.push(['rules',options]);if(options.addRules&&options.addRules.length>1&&first){first=false;throw new Error('too big');}if(options.addRules&&options.addRules.some(rule=>rule.id===500))throw new Error('refused');};
  c.api.runtime.onInstalled.emit({reason:'install'});await tick(40);
  assert.ok(c.of('rules').some(call=>call[1].addRules&&call[1].addRules.length===1&&call[1].addRules[0].id===1),'rule 1 added on its own');
  assert.equal(c.store.local.listVersion,'','a partial sync is retried next time');
});

test('a closed app leaves the current rules in place',async()=>{
  const b=fakeBrowser();
  b.api.runtime.onStartup.emit();await tick(30);
  assert.ok(!b.of('rules').some(call=>call[1].removeRuleIds&&call[1].removeRuleIds.length===999),'threat rules are untouched');
  assert.equal(b.store.local.status,'app-closed');
});

test('file-host pop-ups are closed and redirects return you to the download page',async()=>{
  const b=fakeBrowser({matched:[{rule:{ruleId:1000,rulesetId:'_dynamic'},tabId:7,timeStamp:Date.now()}],native:message=>message.type==='lookup'?{ok:true,listed:null}:{ok:false,error:'not-running'}});
  const nav=b.api.webNavigation;
  nav.onCommitted.emit({tabId:7,frameId:0,url:'https://fuckingfast.co/abc#Game.part1.rar',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCreatedNavigationTarget.emit({sourceTabId:7,tabId:8,url:'https://ads.example/pop'});await tick();
  assert.deepEqual(b.of('closeTab'),[['closeTab',8]]);
  assert.ok(b.of('notify').some(call=>/closed a pop-up/.test(call[1])&&/fuckingfast\.co tried to open ads\.example/.test(call[2])));
  nav.onCreatedNavigationTarget.emit({sourceTabId:7,tabId:9,url:'https://fuckingfast.co/dl/xyz'});await tick();
  assert.equal(b.of('closeTab').length,1,'the host’s own file opens normally');
  nav.onCreatedNavigationTarget.emit({sourceTabId:7,tabId:10,url:'about:blank'});await tick();
  nav.onBeforeNavigate.emit({tabId:10,frameId:0,url:'https://scam.example/'});await tick();
  assert.deepEqual(b.of('closeTab').at(-1),['closeTab',10],'a blank pop-up that heads elsewhere is closed too');
  // The page itself tried to leave: the redirect rule stopped it; the download page comes back.
  nav.onErrorOccurred.emit({tabId:7,frameId:0,url:'https://ads.example/landing',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  assert.deepEqual(b.of('navigate').at(-1),['navigate',7,'https://fuckingfast.co/abc#Game.part1.rar']);
  assert.ok(b.of('notify').some(call=>/stopped a redirect/.test(call[1])));
  // It redirects again straight away: explain on Ravenshelf's own page instead of looping.
  nav.onCommitted.emit({tabId:7,frameId:0,url:'https://fuckingfast.co/abc#Game.part1.rar',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onErrorOccurred.emit({tabId:7,frameId:0,url:'https://ads.example/landing',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  const last=new URL(b.of('navigate').at(-1)[2]);
  assert.equal(last.pathname,'/blocked.html');
  const params=new URLSearchParams(last.hash.slice(1));
  assert.equal(params.get('reason'),'redirect');assert.equal(params.get('from'),'fuckingfast.co');assert.equal(params.get('back'),'1');
  assert.ok(!last.hash.includes('fuckingfast.co%2Fabc'),'the page to return to is kept by the extension, not passed to the warning page');
  const navigations=b.of('navigate').length;
  assert.deepEqual(await b.message({cmd:'return'},last.href,{id:7}),{ok:true});
  assert.deepEqual(b.of('navigate').at(-1),['navigate',7,'https://fuckingfast.co/abc#Game.part1.rar']);
  assert.deepEqual(await b.message({cmd:'return'},last.href,{id:7}),{ok:false},'it can be used once');
  assert.deepEqual(await b.message({cmd:'return'},last.href,{id:12}),{ok:false},'other tabs have nothing to return to');
  assert.equal(b.of('navigate').length,navigations+1);
  // Pages on other sites, and errors from other extensions, are left alone.
  const count=b.of('navigate').length;
  nav.onCommitted.emit({tabId:11,frameId:0,url:'https://news.example/',transitionType:'typed',transitionQualifiers:[]});await tick();
  nav.onErrorOccurred.emit({tabId:11,frameId:0,url:'https://other.example/',error:'net::ERR_NAME_NOT_RESOLVED',timeStamp:Date.now()});await tick(30);
  assert.equal(b.of('navigate').length,count);
});

test('a navigation that slips past the redirect rule is caught when it loads',async()=>{
  const b=fakeBrowser();
  const nav=b.api.webNavigation;
  nav.onCommitted.emit({tabId:3,frameId:0,url:'https://filekeeper.net/f/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCommitted.emit({tabId:3,frameId:0,url:'https://fs2.filekeeper.net:8443/x',transitionType:'link',transitionQualifiers:[]});await tick();
  assert.equal(b.of('navigate').length,0,'the host’s own servers are fine');
  nav.onCommitted.emit({tabId:3,frameId:0,url:'https://filekeeper.net/f/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCommitted.emit({tabId:3,frameId:0,url:'https://prize.example/win',transitionType:'link',transitionQualifiers:[]});await tick();
  assert.deepEqual(b.of('navigate').at(-1),['navigate',3,'https://filekeeper.net/f/abc']);
  nav.onCommitted.emit({tabId:4,frameId:0,url:'https://filekeeper.net/f/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCommitted.emit({tabId:4,frameId:0,url:'https://search.example/',transitionType:'typed',transitionQualifiers:['from_address_bar']});await tick();
  nav.onCommitted.emit({tabId:4,frameId:0,url:'https://filekeeper.net/f/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCommitted.emit({tabId:4,frameId:0,url:'https://previous.example/',transitionType:'link',transitionQualifiers:['forward_back']});await tick();
  assert.equal(b.of('navigate').filter(call=>call[1]===4).length,0,'typing an address or going back is never blocked');
  nav.onBeforeNavigate.emit({tabId:5,frameId:0,url:'https://fuckingfast.co/abc'});
  nav.onCommitted.emit({tabId:5,frameId:0,url:'https://evil.example/',transitionType:'link',transitionQualifiers:['server_redirect']});await tick();
  const blocked=new URL(b.of('navigate').at(-1)[2]);
  assert.equal(blocked.pathname,'/blocked.html');assert.equal(new URLSearchParams(blocked.hash.slice(1)).get('committed'),'1');
  await b.api.storage.local.set({guard:false});
  nav.onCommitted.emit({tabId:6,frameId:0,url:'https://filekeeper.net/f/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCommitted.emit({tabId:6,frameId:0,url:'https://prize.example/win',transitionType:'link',transitionQualifiers:[]});await tick();
  assert.equal(b.of('navigate').filter(call=>call[1]===6).length,0,'turning the switch off turns this off too');
});

test('listed sites get Ravenshelf’s warning page, and Go back skips the blocked address',async()=>{
  const b=fakeBrowser({matched:[{rule:{ruleId:3,rulesetId:'_dynamic'},tabId:2,timeStamp:Date.now()}],native:message=>message.type==='lookup'?{ok:true,listed:{category:'malware',label:'malware sites'}}:{ok:false,error:'not-running'}});
  const nav=b.api.webNavigation;
  nav.onErrorOccurred.emit({tabId:2,frameId:0,url:'https://bad.example/x',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  const page=new URL(b.of('navigate').at(-1)[2]);
  assert.equal(page.pathname,'/blocked.html');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(page.hash.slice(1))),{reason:'malware',host:'bad.example',url:'https://bad.example/x'});
  assert.ok(b.of('notify').some(call=>/dangerous site/.test(call[1])&&/bad\.example/.test(call[2])));
  nav.onErrorOccurred.emit({tabId:2,frameId:0,url:'https://bad.example/x',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  assert.equal(b.of('navigate').length,1,'the same block is answered once');
  const reply=await b.message({cmd:'back',url:'https://bad.example/x'},page.href,{id:2});
  assert.deepEqual(reply,{ok:true});assert.deepEqual(b.of('goBack'),[['goBack',2]]);
  nav.onErrorOccurred.emit({tabId:2,frameId:0,url:'https://bad.example/x',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  assert.deepEqual(b.of('goBack').length,2,'the blocked entry is skipped on the way back');
  assert.equal(b.of('navigate').length,1);
  // Another extension's block (none of Ravenshelf's rules matched) is not claimed.
  const c=fakeBrowser({matched:[{rule:{ruleId:7,rulesetId:'other'},tabId:2,timeStamp:Date.now()}],native:message=>message.type==='lookup'?{ok:true,listed:null}:{ok:false}});
  c.api.webNavigation.onErrorOccurred.emit({tabId:2,frameId:0,url:'https://tracker.example/',error:'net::ERR_BLOCKED_BY_CLIENT',timeStamp:Date.now()});await tick(30);
  assert.equal(c.of('navigate').length,0);
});

test('only the extension’s own pages can use its commands',async()=>{
  const b=fakeBrowser();
  assert.equal(await b.message({cmd:'set',key:'capture',value:false},'https://evil.example/'),undefined);
  assert.equal(b.store.local.capture,undefined);
  const reply=await b.message({cmd:'set',key:'capture',value:false});
  assert.equal(reply.ok,true);assert.equal(reply.state.capture,false);
  assert.deepEqual(await b.message({cmd:'set',key:'listVersion',value:'x'}),{ok:false});
  const paused=await b.message({cmd:'pause'});
  assert.ok(paused.state.pausedUntil>Date.now());
  assert.deepEqual(b.of('rules').at(-1)[1].addRules.map(rule=>rule.id),[1001],'paused: lists off, redirect rule off');
  const resumed=await b.message({cmd:'resume'});
  assert.equal(resumed.state.pausedUntil,0);
  assert.deepEqual(b.of('rules').at(-1)[1].addRules.map(rule=>rule.id),[1000]);
  const sent=await b.message({cmd:'sendPage',url:'https://example.org/file.zip'});
  assert.deepEqual(sent.reply,{ok:false,error:'invalid'},'only file-host pages can be sent from the toolbar');
  const privateTab=await b.message({cmd:'sendPage',url:'https://fuckingfast.co/abc',incognito:true});
  assert.equal(privateTab.reply.error,'private');
  assert.equal(b.of('native').length,0);
});

test('a blank pop-up is closed only if it never heads to the host’s own pages',async()=>{
  const b=fakeBrowser();
  const nav=b.api.webNavigation;
  nav.onCommitted.emit({tabId:1,frameId:0,url:'https://fuckingfast.co/abc',transitionType:'link',transitionQualifiers:[]});await tick();
  nav.onCreatedNavigationTarget.emit({sourceTabId:1,tabId:2,url:'about:blank'});
  nav.onCreatedNavigationTarget.emit({sourceTabId:1,tabId:3,url:'about:blank'});await tick();
  nav.onBeforeNavigate.emit({tabId:3,frameId:0,url:'https://fuckingfast.co/dl/xyz'});await tick();
  await tick(3300);
  assert.deepEqual(b.of('closeTab'),[['closeTab',2]],'the blank one the page filled in is closed; the one fetching the host’s file is not');
});

test('while Ravenshelf is still fetching its lists, the extension looks again soon',async()=>{
  const b=fakeBrowser({native:message=>message.type==='hello'?{ok:true,version:'0.5.0',capture:true,protection:{version:'empty',total:0}}:{ok:true,manifest:{version:'empty',total:0,rules:[]}}});
  b.api.runtime.onInstalled.emit({reason:'install'});await tick(40);
  assert.ok(b.of('alarm').some(call=>call[1]==='ravenshelf-sync-soon'));
  const before=b.of('native').length;
  b.api.alarms.onAlarm.emit({name:'ravenshelf-sync-soon'});await tick(40);
  assert.equal(b.of('native')[before][1].type,'hello','the retry checks in with Ravenshelf again');
});

// ---- YouTube ----
const VIDEO='aqz-KE-bpKQ',CANONICAL=`https://www.youtube.com/watch?v=${VIDEO}`;
const fromYouTube=(b,msg,{url=`https://www.youtube.com/watch?v=${VIDEO}&t=5`,frameId=0,tab={id:5,incognito:false}}={})=>new Promise(resolve=>{
  const handled=b.api.runtime.onMessage.emit(msg,{id:'self',url,tab,frameId},value=>resolve(own(value)))[0];
  if(handled!==true)resolve(undefined);
});
test('right-clicking a YouTube video or link sends only the canonical address, with the quality chosen in Ravenshelf',async()=>{
  const b=fakeBrowser({native:message=>message.type==='media'?{ok:true,action:'queued'}:{ok:true,action:'take',id:'c1'}});
  const click=(info,tab={id:1,incognito:false})=>b.api.contextMenus.onClicked.emit(info,tab);
  click({menuItemId:'ravenshelf-youtube',pageUrl:`https://www.youtube.com/watch?v=${VIDEO}&list=PL1&index=3`});await tick();
  click({menuItemId:'ravenshelf-link',linkUrl:`https://youtu.be/${VIDEO}?si=track`,pageUrl:'https://news.example/article'});await tick();
  click({menuItemId:'ravenshelf-link',linkUrl:'https://cdn.example/file.zip',pageUrl:'https://news.example/article'});await tick();
  const sent=b.of('native').map(call=>call[1]);
  assert.deepEqual(sent.slice(0,2),[{v:1,type:'media',url:CANONICAL,quality:'default'},{v:1,type:'media',url:CANONICAL,quality:'default'}]);
  assert.equal(sent[2].type,'send','other links are files, as before');
  assert.equal(b.of('notify').filter(call=>call[1]==='Downloading in Ravenshelf').length,1,'notifications are rate limited per kind');
  for(const message of sent.slice(0,2))assert.doesNotThrow(()=>protocol.validateRequest(message),'the app accepts what the extension sends');
  click({menuItemId:'ravenshelf-youtube',pageUrl:`https://www.youtube.com/shorts/${VIDEO}`},{id:2,incognito:true});await tick();
  assert.equal(b.of('native').length,3,'private windows send nothing');
});

test('the YouTube player button is answered only for Ravenshelf’s own script in YouTube’s top frame',async()=>{
  let answer={ok:true,action:'setup'};
  const b=fakeBrowser({native:message=>message.type==='media'?answer:{ok:false}});
  assert.deepEqual(await fromYouTube(b,{cmd:'youtube',quality:'720',url:`https://www.youtube.com/watch?v=${VIDEO}&t=5`}),{ok:true,action:'setup'});
  assert.deepEqual(b.of('native').map(call=>call[1]),[{v:1,type:'media',url:CANONICAL,quality:'720'}]);
  assert.equal(b.of('notify').length,0,'the button shows its own message in the player');
  answer={ok:true,action:'queued'};
  assert.deepEqual(await fromYouTube(b,{cmd:'youtube',quality:'audio-mp3',url:'javascript:alert(1)'}),{ok:true,action:'queued'},'a bad address falls back to the page’s own');
  assert.equal(b.of('native').at(-1)[1].url,CANONICAL);
  for(const msg of [{cmd:'youtube',quality:'default'},{cmd:'youtube',quality:'8k'},{cmd:'set',key:'capture',value:false},{cmd:'sendPage',url:'https://fuckingfast.co/x'}])
    assert.deepEqual(await fromYouTube(b,msg),{ok:false,error:'invalid'},JSON.stringify(msg));
  assert.equal(b.store.local.capture,undefined,'a page script cannot change settings');
  assert.equal(await fromYouTube(b,{cmd:'youtube',quality:'720'},{frameId:3}),undefined,'frames inside the page are ignored');
  assert.equal(await fromYouTube(b,{cmd:'youtube',quality:'720'},{url:'https://evil.example/watch?v=aqz-KE-bpKQ'}),undefined);
  assert.equal(await fromYouTube(b,{cmd:'youtube',quality:'720'},{url:'https://m.youtube.com/watch?v=aqz-KE-bpKQ'}),undefined);
  assert.equal(await fromYouTube(b,{cmd:'youtube',quality:'720'},{tab:null}),undefined,'only a page in a tab');
  assert.deepEqual(await fromYouTube(b,{cmd:'youtube',quality:'720'},{tab:{id:9,incognito:true}}),{ok:false,error:'private'});
  assert.equal(b.of('native').length,2);
  const off=await b.message({cmd:'set',key:'youtube',value:false});
  assert.equal(off.state.youtube,false);assert.equal(b.store.local.youtube,false);
});

test('the YouTube script uses only safe page APIs and acts only on real clicks',()=>{
  const source=read('youtube.js');
  assert.match(source,/event\.isTrusted/);assert.match(source,/sendMessage\(\{ cmd: 'youtube'/);
  assert.doesNotMatch(source,/sendNativeMessage|storage\.local\.set|chrome\.tabs|location\.(?:assign|replace)|\.href\s*=/);
  assert.doesNotMatch(read('youtube.css'),/@import|url\(/,'the stylesheet loads nothing');
  for(const choice of P.PLAYER_CHOICES)assert.ok(P.MEDIA_QUALITIES.includes(choice.id));
});
