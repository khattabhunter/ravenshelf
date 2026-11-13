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
    assert.deepEqual(manifest.content_scripts.map(script=>script.matches),[['https://www.youtube.com/*'],['https://www.nexusmods.com/*'],['https://fitgirl-repacks.site/*']],'only YouTube, Nexus Mods and FitGirl pages get a page script');
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
  const calls=[],store={local:{},session:{}},dynamic=new Map(),hang={session:false};
  const onChanged=event();
  const area=name=>({
    // With `hang` set, the browser never answers a read of that store.
    get:async keys=>{if(hang[name])await new Promise(()=>{});const out={};for(const key of [].concat(keys))if(key in store[name])out[key]=structuredClone(store[name][key]);return out;},
    set:async values=>{Object.assign(store[name],structuredClone(values));onChanged.emit(values,name);}
  });
  const origin=firefox?'moz-extension://uuid/':'chrome-extension://ccgeallihglgkgpokepckdejgbfojcnh/';
  const menu={removeAll:async()=>{calls.push(['menus-cleared']);},create:(props,done)=>{calls.push(['menu',props.id,props.title]);done&&done();},onClicked:event()};
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
  vm.runInContext(read('text.js'),context,{filename:'text.js'});
  vm.runInContext(read('background.js'),context,{filename:'background.js'});
  const message=async(msg,url=origin+'popup.html',tab)=>new Promise(resolve=>{const handled=api.runtime.onMessage.emit(msg,{id:'self',url,tab},value=>resolve(own(value)))[0];if(handled!==true)resolve(undefined);});
  return {api,calls,store,dynamic,hang,message,of:kind=>calls.filter(call=>call[0]===kind)};
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

// ---- Nexus Mods ----
const MOD_URL='https://www.nexusmods.com/skyrimspecialedition/mods/12604?tab=files&file_id=735025';
const MOD_FILE='Simplified Chinese Patch-12604-1-1-1774443884.7z';
const MOD_PAGE=Object.freeze({gameId:'1704',gameName:'Skyrim Special Edition',modName:'SkyUI',files:[{fileId:'735025',fileName:'Simplified Chinese Patch',fileUri:MOD_FILE}]});
const MOD_LABEL=Object.freeze({site:'nexusmods',game:'skyrimspecialedition',modId:12604,gameId:1704,fileId:735025,gameName:'Skyrim Special Edition',modName:'SkyUI',fileName:'Simplified Chinese Patch'});
const CDN_ITEM=Object.freeze({url:`https://supporter-files.nexus-cdn.com/1704/12604/${encodeURIComponent(MOD_FILE)}?md5=abc&expires=1&user_id=2`,referrer:'https://www.nexusmods.com/',filename:MOD_FILE,totalBytes:3072});
const fromNexus=(b,msg,{url=MOD_URL,frameId=0,tab={id:7,incognito:false},id='self'}={})=>new Promise(resolve=>{
  const handled=b.api.runtime.onMessage.emit(msg,{id,url,tab,frameId},value=>resolve(own(value)))[0];
  if(handled!==true)resolve(undefined);
});
const startDownload=async(b,item)=>{const suggested=[];b.api.downloads.onDeterminingFilename.emit(item,()=>suggested.push(true));await tick();return suggested.length;};
const captures=b=>b.of('native').map(call=>call[1]).filter(message=>message.type==='capture');

test('a file downloaded on Nexus Mods is sent to Ravenshelf with its game and mod',async()=>{
  const b=fakeBrowser({native:message=>message.type==='capture'?{ok:true,action:'take',id:'c1'}:{ok:false,error:'invalid'}});
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE}),{ok:true});
  assert.equal(b.of('native').length,0,'reading a page sends nothing to the app');
  assert.equal(await startDownload(b,{id:1,...CDN_ITEM}),0,'Ravenshelf takes the download');
  assert.deepEqual(captures(b),[{v:1,type:'capture',url:CDN_ITEM.url,incognito:false,referrer:'https://www.nexusmods.com/',filename:MOD_FILE,totalBytes:3072,mod:MOD_LABEL}]);
  assert.doesNotThrow(()=>protocol.validateRequest(captures(b)[0]),'the app accepts the label the extension sends');
  // The same file name from another site is not a Nexus Mods download, even when the mod's own page linked to it.
  const mirror=`https://mirror.example/${encodeURIComponent(MOD_FILE)}`;
  await startDownload(b,{id:2,url:mirror,referrer:'https://mirror.example/page',filename:MOD_FILE});
  assert.equal(captures(b)[1].mod,undefined);
  await startDownload(b,{id:3,url:mirror,referrer:MOD_URL,filename:MOD_FILE});
  assert.deepEqual(captures(b)[2],{v:1,type:'capture',url:mirror,incognito:false,referrer:MOD_URL,filename:MOD_FILE});
  // Other downloads are sent exactly as before.
  await startDownload(b,{id:4,url:'https://cdn.example/game.zip',filename:'game.zip'});
  assert.deepEqual(captures(b)[3],{v:1,type:'capture',url:'https://cdn.example/game.zip',incognito:false,filename:'game.zip'});
  // The note lives in session storage only, which the browser clears when it closes.
  await tick(150);
  assert.equal(b.store.session.modPages[7].modName,'SkyUI');assert.equal(JSON.stringify(b.store.local).includes('SkyUI'),false,'nothing about the page is written to disk');
  // Closing the tab forgets the page.
  b.api.tabs.onRemoved.emit(7);await tick(150);
  assert.deepEqual(b.store.session.modPages,{});
  await startDownload(b,{id:5,...CDN_ITEM});
  assert.equal(captures(b)[4].mod,undefined,'no page, no label');
});

test('the Nexus Mods note survives the browser putting the extension to sleep',async()=>{
  const first=fakeBrowser();
  await fromNexus(first,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});await tick(150);
  const woken=fakeBrowser({native:()=>({ok:true,action:'take'})});
  Object.assign(woken.store.session,structuredClone(first.store.session));
  await startDownload(woken,{id:1,...CDN_ITEM});
  assert.deepEqual(captures(woken)[0].mod,MOD_LABEL);
});

test('Firefox labels Nexus Mods downloads the same way',async()=>{
  const b=fakeBrowser({firefox:true,native:()=>({ok:true,action:'take'})});
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  // An address without the game and mod numbers in it: only the file's name can find the page.
  const unnumbered=`https://files.nexus-cdn.com/8f14e45f-ceea-467f-9a36-dedd4bea2543/${encodeURIComponent(MOD_FILE)}?md5=abc&expires=1&user_id=2`;
  b.api.downloads.onCreated.emit({id:1,...CDN_ITEM,url:unnumbered,filename:`/home/p/Downloads/${MOD_FILE.replace('.7z','(1).7z')}`,incognito:false});await tick();
  assert.deepEqual(captures(b)[0].mod,MOD_LABEL,'Firefox’s "(1)" for a second copy does not hide the file name');
  b.api.downloads.onCreated.emit({id:2,...CDN_ITEM,url:unnumbered,filename:'/home/p/Downloads/renamed by the browser.7z',incognito:false});await tick();
  assert.equal(captures(b)[1].mod,undefined,'a name no page showed, at an address without numbers: no label');
  b.api.downloads.onCreated.emit({id:3,...CDN_ITEM,filename:'/home/p/Downloads/renamed by the browser.7z',incognito:false});await tick();
  assert.deepEqual(captures(b)[2].mod,(({fileId,fileName,...rest})=>rest)(MOD_LABEL),'the game and mod numbers in an older address name the mod, not the file');
  assert.deepEqual(b.calls.filter(call=>['pause','cancel','resume'].includes(call[0])),[['pause',1],['cancel',1],['pause',2],['cancel',2],['pause',3],['cancel',3]]);
});

test('an older Ravenshelf that does not know about mods still gets the download',async()=>{
  const b=fakeBrowser({native:message=>message.type!=='capture'?{ok:false,error:'invalid'}:message.mod?{ok:false,error:'invalid'}:{ok:true,action:'take',id:'c1'}});
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  assert.equal(await startDownload(b,{id:1,...CDN_ITEM}),0);
  assert.deepEqual(captures(b).map(message=>Boolean(message.mod)),[true,false],'sent again once, without the label');
  assert.deepEqual(b.of('cancel'),[['cancel',1]]);
  // An app that refuses the plain download too is not asked a third time.
  const c=fakeBrowser({native:()=>({ok:false,error:'invalid'})});
  await fromNexus(c,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  assert.equal(await startDownload(c,{id:1,...CDN_ITEM}),1,'the browser keeps the download');
  assert.equal(captures(c).length,2);
  // A download without a label is never sent twice.
  assert.equal(await startDownload(c,{id:2,url:'https://cdn.example/a.zip'}),1);
  assert.equal(captures(c).length,3);
  // The second try is only for an app that refused the message itself, not for one that is closed.
  const closed=fakeBrowser();
  await fromNexus(closed,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  assert.equal(await startDownload(closed,{id:1,...CDN_ITEM}),1,'the browser keeps the download');
  assert.equal(captures(closed).length,1);
});

test('only Ravenshelf’s own script on a Nexus Mods page can leave a note, and never from a private window',async()=>{
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})});
  const note={cmd:'nexus',url:MOD_URL,page:MOD_PAGE};
  assert.equal(await fromNexus(b,note,{frameId:2}),undefined,'frames inside the page are ignored');
  assert.equal(await fromNexus(b,note,{url:'https://www.nexusmods.com.evil.example/skyrimspecialedition/mods/12604'}),undefined);
  assert.equal(await fromNexus(b,note,{url:'https://evil.example/'}),undefined);
  assert.equal(await fromNexus(b,note,{url:'https://evil.example/?next=https://www.nexusmods.com/skyrimspecialedition/mods/12604'}),undefined,'an address that only contains the site’s address');
  assert.equal(await fromNexus(b,note,{url:'https://evil.example/https://www.nexusmods.com/skyrimspecialedition/mods/12604'}),undefined);
  assert.equal(await fromNexus(b,note,{url:'http://www.nexusmods.com/skyrimspecialedition/mods/12604'}),undefined);
  assert.equal(await fromNexus(b,note,{tab:null}),undefined,'only a page in a tab');
  assert.equal(await fromNexus(b,note,{id:'another-extension'}),undefined,'only this extension’s own script');
  assert.deepEqual(await fromNexus(b,note,{tab:{id:9,incognito:true}}),{ok:false},'private windows are never noted');
  assert.deepEqual(await fromNexus(b,note,{tab:{id:-1,incognito:false}}),{ok:false});
  for(const id of [undefined,null,'7',1.5,NaN])assert.deepEqual(await fromNexus(b,note,{tab:{id,incognito:false}}),{ok:false},`tab number ${id}`);
  for(const msg of [{cmd:'set',key:'capture',value:false},{cmd:'sendPage',url:'https://fuckingfast.co/x'},{cmd:'youtube',quality:'720'},{cmd:'nexus'},{cmd:'nexus',url:MOD_URL,page:'x'},null,
    {cmd:'state',url:MOD_URL,page:MOD_PAGE},{cmd:'note',url:MOD_URL,page:MOD_PAGE},{url:MOD_URL,page:MOD_PAGE},{cmd:'NEXUS',url:MOD_URL,page:MOD_PAGE}])
    assert.deepEqual(await fromNexus(b,msg),{ok:false},JSON.stringify(msg));
  assert.equal(b.store.local.capture,undefined,'a page script cannot change settings');
  // A page that is not about a mod leaves no note, whatever it says.
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:'https://www.nexusmods.com/skyrimspecialedition',page:MOD_PAGE},{url:'https://www.nexusmods.com/skyrimspecialedition'}),{ok:false});
  await tick(150);
  assert.deepEqual(b.store.session.modPages||{},{},'nothing was noted');
  await startDownload(b,{id:1,...CDN_ITEM});
  assert.equal(captures(b)[0].mod,undefined);
  // Which game and mod a note is about comes from the page's address, not from what the page says.
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:{...MOD_PAGE,game:'fallout4',site:'evil'}});
  await startDownload(b,{id:2,...CDN_ITEM});
  assert.deepEqual(captures(b)[1].mod,MOD_LABEL);
  // A page that itself says it is another mod's page is noted by its address alone: its names and files are not used.
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:{...MOD_PAGE,modId:'1'}});await tick(150);
  assert.deepEqual({...b.store.session.modPages[7],at:0},{game:'skyrimspecialedition',modId:12604,files:[],at:0});
  await startDownload(b,{id:3,...CDN_ITEM});
  assert.equal(captures(b)[2].mod,undefined);
  await startDownload(b,{id:4,...CDN_ITEM,referrer:MOD_URL});
  assert.deepEqual(captures(b)[3].mod,{site:'nexusmods',game:'skyrimspecialedition',modId:12604,fileId:735025},'started from the mod’s own address: its numbers, and no names');
  // The address the page script reports is the one noted. It must itself be a Nexus Mods mod page; otherwise the tab's own is used.
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:'https://www.nexusmods.com/fallout4/mods/77',page:MOD_PAGE}),{ok:true});await tick(150);
  assert.equal(b.store.session.modPages[7].game,'fallout4');assert.equal(b.store.session.modPages[7].modId,77);
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:'https://evil.example/skyrimspecialedition/mods/999',page:MOD_PAGE}),{ok:true});await tick(150);
  assert.equal(b.store.session.modPages[7].modId,12604);
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:'https://www.nexusmods.com/fallout4/mods/77',page:MOD_PAGE}),{ok:true});
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',page:MOD_PAGE}),{ok:true},'no address reported at all');await tick(150);
  assert.equal(b.store.session.modPages[7].modId,12604);
});

test('the Nexus Mods switch turns the labels off and forgets what pages said',async()=>{
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})});
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});await tick(150);
  assert.equal((await b.message({cmd:'state'})).state.nexus,true,'on unless switched off');
  for(const [key,value] of [['capture',false],['youtube',false],['nexus',true],['capture',true],['youtube',true]])await b.message({cmd:'set',key,value});
  await tick(150);assert.equal(b.store.session.modPages[7].modName,'SkyUI','other switches, and switching this one on, forget nothing');
  const off=await b.message({cmd:'set',key:'nexus',value:false});
  assert.equal(off.state.nexus,false);assert.equal(b.store.local.nexus,false);
  await tick(150);assert.deepEqual(b.store.session.modPages,{});
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE}),{ok:false},'no notes while off');
  assert.equal(await startDownload(b,{id:1,...CDN_ITEM}),0,'the download itself is still checked by Ravenshelf');
  assert.equal(captures(b)[0].mod,undefined);
  await b.message({cmd:'set',key:'nexus',value:true});
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  await startDownload(b,{id:2,...CDN_ITEM});
  assert.deepEqual(captures(b)[1].mod,MOD_LABEL);
  // Private-window downloads are never sent, labelled or not.
  assert.equal(await startDownload(b,{id:3,...CDN_ITEM,incognito:true}),1);assert.equal(captures(b).length,2);
});

test('the extension keeps notes for a limited number of tabs',async()=>{
  const b=fakeBrowser();
  for(let tab=1;tab<=60;tab++)await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE},{tab:{id:tab,incognito:false}});
  await tick(150);
  const kept=Object.keys(b.store.session.modPages).map(Number).sort((x,y)=>x-y);
  assert.equal(kept.length,50);assert.equal(kept[0],11,'the oldest notes are dropped first');
  // A tab that reports again moves to the newest end.
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE},{tab:{id:11,incognito:false}});
  for(let tab=61;tab<=63;tab++)await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE},{tab:{id:tab,incognito:false}});
  await tick(150);
  assert.ok(11 in b.store.session.modPages);assert.equal(12 in b.store.session.modPages,false);
});

test('a page that is no longer a mod’s page, or a tab that leaves Nexus Mods, is forgotten',async()=>{
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})}),nav=b.api.webNavigation;
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE},{tab:{id:8,incognito:false}});await tick(150);
  assert.deepEqual(Object.keys(b.store.session.modPages).sort(),['7','8']);
  // The site moved tab 7 to a page that is not about a mod, without reloading it.
  const elsewhere={url:'https://www.nexusmods.com/skyrimspecialedition'};
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',page:null},elsewhere),{ok:true});await tick(150);
  assert.deepEqual(Object.keys(b.store.session.modPages),['8'],'only that tab’s note goes');
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',page:null},elsewhere),{ok:true},'forgetting twice is harmless');
  assert.equal(b.of('native').length,0,'none of this is sent to the app');
  // Tab 8 loads other pages.
  nav.onCommitted.emit({tabId:8,frameId:3,url:'https://ads.example/frame',transitionType:'auto_subframe',transitionQualifiers:[]});await tick(150);
  assert.ok(8 in b.store.session.modPages,'a frame inside the page going elsewhere changes nothing');
  nav.onCommitted.emit({tabId:8,frameId:0,url:'https://www.nexusmods.com/skyrimspecialedition/mods/1',transitionType:'link',transitionQualifiers:[]});await tick(150);
  assert.ok(8 in b.store.session.modPages,'on another Nexus Mods page the note stays until that page reports');
  nav.onCommitted.emit({tabId:9,frameId:0,url:'https://news.example/',transitionType:'typed',transitionQualifiers:[]});await tick(150);
  assert.ok(8 in b.store.session.modPages,'another tab’s page is not this tab’s');
  nav.onCommitted.emit({tabId:8,frameId:0,url:'https://users.nexusmods.com/auth/sign_in',transitionType:'link',transitionQualifiers:[]});await tick(150);
  assert.deepEqual(b.store.session.modPages,{},'the tab has left www.nexusmods.com');
  await startDownload(b,{id:1,...CDN_ITEM});
  assert.equal(captures(b)[0].mod,undefined);
  // "Forget" is taken only from where notes are taken.
  await fromNexus(b,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',page:null},{tab:{id:7,incognito:true}}),{ok:false});
  assert.deepEqual(await fromNexus(b,{cmd:'other',page:null}),{ok:false});assert.deepEqual(await fromNexus(b,{page:null}),{ok:false});
  assert.deepEqual(await fromNexus(b,{cmd:'nexus'}),{ok:false},'a report without a page forgets nothing');
  assert.equal(await fromNexus(b,{cmd:'nexus',page:null},{frameId:2}),undefined);
  assert.equal(await fromNexus(b,{cmd:'nexus',page:null},{url:'https://evil.example/'}),undefined);
  await startDownload(b,{id:2,...CDN_ITEM});
  assert.deepEqual(captures(b)[1].mod,MOD_LABEL,'the note is still there');
});

test('notes past their half hour are dropped for good, and the oldest go first when there are too many',async()=>{
  const at=Date.now(),page=P.nexusPage(MOD_PAGE,P.nexusAddress(MOD_URL));
  // What the browser kept while the extension slept: one fresh note, one too old, one from the future, two broken ones.
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})});
  b.store.session.modPages={1:{...page,modName:'Fresh',at:at-60000},2:{...page,modName:'Old',at:at-P.NEXUS_PAGE_MS-1000},3:{...page,modName:'Future',at:at+600000},4:{...page,modName:'Undated'},5:null,6:{...page,modName:'Texted',at:String(at-1000)}};
  await startDownload(b,{id:1,...CDN_ITEM});
  assert.equal(captures(b)[0].mod.modName,'Fresh');
  await tick(150);
  assert.deepEqual(Object.keys(b.store.session.modPages),['1'],'gone from the browser’s store too, so setting the clock back cannot bring them back');
  // Over the limit the oldest notes go, whichever tabs they belong to; a note without a time counts as oldest.
  const c=fakeBrowser(),stored={62:{...page}};
  for(let tab=1;tab<=60;tab++)stored[tab]={...page,at:at-(tab%2?tab:100+tab)*1000};
  c.store.session.modPages=stored;
  await fromNexus(c,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE},{tab:{id:61,incognito:false}});await tick(150);
  const kept=Object.keys(c.store.session.modPages).map(Number).sort((x,y)=>x-y);
  const expected=[];for(let tab=1;tab<=61;tab++)if(tab%2||tab<40)expected.push(tab);
  assert.equal(expected.length,50);assert.deepEqual(kept,expected,'the eleven oldest and the undated one are gone');
});

test('what the browser kept while the extension slept is still there after the first thing that happens',async()=>{
  const asleep=()=>{
    const b=fakeBrowser();
    b.store.session.tabInfo={5:{host:'fuckingfast.co',url:'https://fuckingfast.co/abc'}};
    b.store.session.modPages={3:{...P.nexusPage(MOD_PAGE,P.nexusAddress(MOD_URL)),at:Date.now()-1000}};
    return b;
  };
  // A new note.
  const noted=asleep();
  await fromNexus(noted,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});await tick(150);
  assert.deepEqual(Object.keys(noted.store.session.modPages).sort(),['3','7']);assert.equal(noted.store.session.tabInfo[5].host,'fuckingfast.co');
  // A page that is no longer a mod's page.
  const forgot=asleep();
  assert.deepEqual(await fromNexus(forgot,{cmd:'nexus',page:null},{tab:{id:3,incognito:false}}),{ok:true});await tick(150);
  assert.deepEqual(forgot.store.session.modPages,{});assert.equal(forgot.store.session.tabInfo[5].host,'fuckingfast.co');
  // The tab leaving the site.
  const left=asleep();
  left.api.webNavigation.onCommitted.emit({tabId:3,frameId:0,url:'https://news.example/',transitionType:'typed',transitionQualifiers:[]});await tick(150);
  assert.deepEqual(left.store.session.modPages,{});assert.equal(left.store.session.tabInfo[5].host,'fuckingfast.co');
  const blank=asleep();
  blank.api.webNavigation.onCommitted.emit({tabId:3,frameId:0,url:'about:blank',transitionType:'link',transitionQualifiers:[]});await tick(150);
  assert.deepEqual(blank.store.session.modPages,{},'also when it leaves for a page that is not on the web');
  // The labels being switched off.
  const off=asleep();
  await off.message({cmd:'set',key:'nexus',value:false});await tick(150);
  assert.deepEqual(off.store.session.modPages,{});assert.equal(off.store.session.tabInfo[5].host,'fuckingfast.co');
});

// ---------- 0.7.1 ----------
test('a download never waits for the browser’s storage, except a Nexus Mods file, and that one only briefly',async()=>{
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})});
  // The browser does not answer the read of its session store, where the notes of Nexus Mods pages are kept.
  b.hang.session=true;
  assert.equal(await startDownload(b,{id:1,url:'https://cdn.example/game.zip',filename:'game.zip'}),0,'an ordinary download is decided at once');
  assert.equal(captures(b).length,1);
  assert.equal(await startDownload(b,{id:2,url:'https://mirror.example/x.7z',referrer:MOD_URL,filename:'x.7z'}),0,'also one that was started on a Nexus Mods page but is kept elsewhere');
  assert.equal(captures(b).length,2);
  assert.equal(await startDownload(b,{id:3,url:'https://short.example/x',finalUrl:CDN_ITEM.url,filename:MOD_FILE}),0,'and one that only ended up on a file server');
  assert.equal(captures(b).length,3);
  // With the switch off, a Nexus Mods file has no use for the notes either.
  await b.api.storage.local.set({nexus:false});
  assert.equal(await startDownload(b,{id:4,...CDN_ITEM}),0);
  assert.equal(captures(b).length,4);assert.equal(captures(b)[3].mod,undefined);
  await b.api.storage.local.set({nexus:true});
  // A Nexus Mods file waits for the notes, but not for long. It is then sent as it is, without a label.
  const started=Date.now();
  b.api.downloads.onDeterminingFilename.emit({id:5,...CDN_ITEM},()=>{});
  await tick(1000);
  assert.equal(captures(b).length,4,'still waiting after a second');
  for(let i=0;i<120&&captures(b).length<5;i++)await tick(20);
  assert.equal(captures(b).length,5,'sent after a second and a half');assert.ok(Date.now()-started<3000);
  assert.equal(captures(b)[4].mod,undefined);assert.equal(captures(b)[4].url,CDN_ITEM.url);
  assert.deepEqual(b.of('cancel').map(call=>call[1]),[1,2,3,4,5],'each was taken by Ravenshelf');
  // When the store does answer, nothing waits.
  const quick=fakeBrowser({native:()=>({ok:true,action:'take'})});
  await fromNexus(quick,{cmd:'nexus',url:MOD_URL,page:MOD_PAGE});
  const before=Date.now();
  assert.equal(await startDownload(quick,{id:1,...CDN_ITEM}),0);
  assert.deepEqual(captures(quick)[0].mod,MOD_LABEL);assert.ok(Date.now()-before<500);
});

test('notes that are too old are dropped as soon as another note arrives',async()=>{
  const b=fakeBrowser({native:()=>({ok:true,action:'take'})});
  const page=P.nexusPage(MOD_PAGE,P.nexusAddress(MOD_URL)),other=P.nexusPage({gameId:'1151',gameName:'Fallout 4',modName:'Another Mod',files:[]},P.nexusAddress('https://www.nexusmods.com/fallout4/mods/77'));
  // What the browser kept from before it put the extension to sleep: one note that is too old, one from a clock that was since set back, one that is fresh.
  b.store.session.modPages={3:{...page,at:Date.now()-P.NEXUS_PAGE_MS-1000},4:{...page,at:Date.now()+60000},5:{...page,at:Date.now()-60000}};
  assert.deepEqual(await fromNexus(b,{cmd:'nexus',url:'https://www.nexusmods.com/fallout4/mods/77',page:{gameId:'1151',gameName:'Fallout 4',modName:'Another Mod',files:[]}},{url:'https://www.nexusmods.com/fallout4/mods/77',tab:{id:9,incognito:false}}),{ok:true});
  await tick(150);
  assert.deepEqual(Object.keys(b.store.session.modPages).sort(),['5','9'],'only the fresh note and the new one are kept, with no download in between');
  assert.equal(b.store.session.modPages[9].modName,other.modName);
});

test('the toolbar window hides a switch that the running extension does not know',async()=>{
  const SWITCHES=['capture','protection','guard','youtube','nexus'];
  const state={version:'0.7.1',browser:'chromium',status:'connected',appVersion:'0.7.1',capture:true,protection:true,guard:false,youtube:true,nexus:true,pausedUntil:0,listTotal:5,listSyncedAt:0};
  // popup.js against a page that only records what is done to it.
  const open=async reply=>{
    const elements=new Map(),sent=[];
    const element=id=>{
      if(!elements.has(id)){const label={hidden:false};elements.set(id,{id,label,checked:false,hidden:false,disabled:false,textContent:'',className:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},closest(selector){assert.equal(selector,'label');return label;}});}
      return elements.get(id);
    };
    const api={runtime:{sendMessage:async message=>{sent.push(message);return typeof reply==='function'?reply(message):reply;}},storage:{onChanged:{addListener(){}}},tabs:{query:async()=>[{url:'https://example.com/',incognito:false}]}};
    const context=vm.createContext({chrome:api,document:{getElementById:element},Date,Number});
    vm.runInContext(read('policy.js'),context,{filename:'policy.js'});vm.runInContext(read('text.js'),context,{filename:'text.js'});vm.runInContext(read('popup.js'),context,{filename:'popup.js'});
    await tick(30);
    return {element,sent};
  };
  const current=await open({ok:true,state});
  for(const key of SWITCHES){assert.equal(current.element(key).label.hidden,false,key);assert.equal(current.element(key).checked,state[key],key);}
  // A copy from before 0.7.0 is still running: it has never heard of the Nexus Mods switch, and would refuse it.
  const {nexus,...earlier}=state;
  const older=await open({ok:true,state:earlier});
  assert.equal(older.element('nexus').label.hidden,true);
  for(const key of SWITCHES.filter(key=>key!=='nexus'))assert.equal(older.element(key).label.hidden,false,key);
  // A switch that is merely off is still shown.
  const off=await open({ok:true,state:{...state,nexus:false,youtube:false}});
  assert.equal(off.element('nexus').label.hidden,false);assert.equal(off.element('nexus').checked,false);assert.equal(off.element('youtube').checked,false);
  // Turning a switch tells the extension, with the key and the new value.
  off.element('nexus').listeners.change({target:{checked:true}});await tick(20);
  assert.deepEqual(JSON.parse(JSON.stringify(off.sent.at(-1))),{cmd:'set',key:'nexus',value:true});
});

// ---- the extension in the app's language ----
const TEXT=require('../src/browser-extension/text.js');
test('every text of the extension has an Arabic version that starts with an Arabic word',()=>{
  const LIT="'((?:[^'\\\\]|\\\\.)*)'";
  const keys=new Set(),plurals=new Map();
  for(const file of ['background.js','popup.js','blocked.js','youtube.js']){
    const source=read(file);
    for(const m of source.matchAll(new RegExp('\\bt\\(\\s*'+LIT,'g')))keys.add(m[1]);
    for(const m of source.matchAll(new RegExp('\\btn\\([^,]+,\\s*'+LIT+',\\s*'+LIT,'g')))plurals.set(m[2],m[1]);
    // The English titles and messages that are translated where they are shown.
    for(const m of source.matchAll(/notify\([^,]+,\s*'([^']+)',\s*'([^']*)'/g)){keys.add(m[1]);if(m[2])keys.add(m[2]);}
    for(const m of source.matchAll(/notify\([^,]+,\s*'([^']+)',\s*`([^`]*)`/g)){keys.add(m[1]);}
    for(const m of source.matchAll(/showMessage\(\s*'([^']+)'/g))keys.add(m[1]);
  }
  for(const html of ['popup.html','blocked.html'])for(const m of read(html).matchAll(/<[a-z0-9]+\b[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g))keys.add(m[1].replace(/\s+/g,' ').trim());
  // The texts that are kept in the extension's tables.
  const background=read('background.js'),popup=read('popup.js'),blocked=read('blocked.js');
  const categories=background.slice(background.indexOf('const CATEGORY_TEXT = '),background.indexOf('\n',background.indexOf('const CATEGORY_TEXT = ')));
  for(const m of categories.matchAll(new RegExp(LIT,'g')))if(m[1].includes(' '))keys.add('{host} is on a list of '+m[1]+'.');
  for(const m of popup.matchAll(/title: '([^']+)'/g))keys.add(m[1]);
  for(const m of blocked.matchAll(new RegExp(LIT,'g')))if(/^[A-Z{].* /.test(m[1]))keys.add(m[1]);
  for(const reply of [{ok:true,action:'queued'},{ok:true,action:'duplicate'},{ok:true,action:'setup'},{ok:true,action:'busy'},...['not-running','not-installed','not-allowed','private','busy','invalid','x'].map(error=>({ok:false,error}))]){
    const text=P.mediaReplyText(reply);keys.add(text.title);keys.add(text.text);
  }
  for(const choice of P.PLAYER_CHOICES){if(!/^\d+p$|^M4A$|^MP3$/.test(choice.label))keys.add(choice.label);keys.add(choice.hint);}
  for(const label of ['Video','Audio only','Download with Ravenshelf','Saved to Ravenshelf › YouTube'])keys.add(label);
  assert.ok(keys.size>80,`found ${keys.size}`);
  const missing=[...keys].filter(key=>!plurals.has(key)&&typeof TEXT.AR[key]!=='string'&&!TEXT.AR_PLURAL[key]);
  assert.deepEqual(missing,[]);
  for(const [other] of plurals)assert.ok(TEXT.AR_PLURAL[other],other);
  const holders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  const check=(key,value,form)=>{
    // A notification or a menu takes its direction from its first letter.
    assert.match(value,/^[^A-Za-z{]*[\u0600-\u06ff]/,`${key}: starts with an Arabic word`);
    assert.doesNotMatch(value,/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/,key);
    if(['zero','one','two'].includes(form))assert.deepEqual(holders(value).filter(n=>n!=='n'),holders(key).filter(n=>n!=='n'),key);
    else assert.deepEqual(holders(value),holders(key),key);
  };
  for(const [key,value] of Object.entries(TEXT.AR))check(key,value);
  for(const [key,forms] of Object.entries(TEXT.AR_PLURAL)){assert.deepEqual(Object.keys(forms),['zero','one','two','few','many','other']);for(const [form,value] of Object.entries(forms))check(key,value,form);}
});

test('the extension texts follow the app, then the browser, and stay English otherwise',()=>{
  assert.equal(TEXT.pick('ar','en-US'),'ar');assert.equal(TEXT.pick('en','ar'),'en');
  assert.equal(TEXT.pick(undefined,'ar'),'ar');assert.equal(TEXT.pick(undefined,'ar-IQ'),'ar');assert.equal(TEXT.pick('fr','en-GB'),'en');assert.equal(TEXT.pick(null,undefined),'en');
  const en=TEXT.create('en'),ar=TEXT.create('ar'),arab=TEXT.create('ar','arab');
  assert.equal(en.t('{source} tried to open {target}. File hosts use pop-ups for ads and fake downloads.',{source:'a.test',target:'b.test'}),'a.test tried to open b.test. File hosts use pop-ups for ads and fake downloads.');
  assert.equal(en.tn(1,'{n} min ago','{n} min ago'),'1 min ago');assert.equal(en.count(12345),'12,345');
  assert.equal(ar.t('Private window'),TEXT.AR['Private window']);
  assert.ok(ar.t('Back to {host}',{host:'a.test'}).includes('\u2068a.test\u2069'),'a site keeps its own direction');
  assert.equal(ar.tn(2,'{n} days ago','{n} days ago'),TEXT.AR_PLURAL['{n} days ago'].two);
  assert.equal(arab.tn(5,'{n} min ago','{n} min ago'),'\u0642\u0628\u0644 \u0665 \u062f\u0642\u0627\u0626\u0642');
  assert.equal(arab.t('Pause protection for 10 minutes'),TEXT.AR['Pause protection for 10 minutes'].replace('10','\u0661\u0660'));
  assert.equal(arab.t('Up to 4K'),TEXT.AR['Up to 4K'],'digits of a name stay as they are');
  assert.equal(ar.t('Something the app already wrote in Arabic'),'Something the app already wrote in Arabic');
});

test('the extension learns the app language when it says hello, and its menu and notices follow',async()=>{
  let language='ar';
  const b=fakeBrowser({native:message=>message.type==='hello'?{ok:true,version:'0.8.0',language,digits:'arab'}:message.type==='send'?{ok:true,action:'block',reason:'\u0646\u0635 \u0645\u0646 \u0627\u0644\u062a\u0637\u0628\u064a\u0642'}:{ok:false,error:'invalid'}});
  await b.message({cmd:'status'});await tick(30);
  assert.equal(b.store.local.appLanguage,'ar');assert.equal(b.store.local.appDigits,'arab');
  const titles=b.of('menu').map(call=>call[2]);
  assert.deepEqual(titles.slice(-3),[TEXT.AR['Download with Ravenshelf'],TEXT.AR['Download this file with Ravenshelf'],TEXT.AR['Download this video with Ravenshelf']]);
  // A reason the app sends is already in its language and is shown as it is.
  b.api.contextMenus.onClicked.emit({menuItemId:'ravenshelf-link',linkUrl:'https://cdn.example/a.zip',pageUrl:'https://example.com/'},{incognito:false});await tick(30);
  assert.deepEqual(b.of('notify').at(-1),['notify',TEXT.AR['Ravenshelf blocked this link'],'\u0646\u0635 \u0645\u0646 \u0627\u0644\u062a\u0637\u0628\u064a\u0642']);
  // Back to English: the menu is made again in English.
  language='en';const before=b.of('menu').length;
  await b.message({cmd:'status'});await tick(30);
  assert.equal(b.store.local.appLanguage,'en');
  assert.deepEqual(b.of('menu').slice(before).map(call=>call[2]),['Download with Ravenshelf','Download this file with Ravenshelf','Download this video with Ravenshelf']);
  // An answer with an unknown language changes nothing.
  language='fr';await b.message({cmd:'status'});await tick(30);assert.equal(b.store.local.appLanguage,'en');
});

test('a program that a page made itself is blocked with a text that can be shown in Arabic',()=>{
  const plan=P.downloadPlan({id:1,url:'blob:https://site.example/1',filename:'C:\\Downloads\\setup.exe'},{capture:true});
  assert.equal(plan.kind,'block');
  assert.equal(plan.reason,'Ravenshelf stopped setup.exe that a web page created for download. Programs made this way are a common malware trick.');
  assert.equal(TEXT.create('en').t(plan.template,plan.params),plan.reason,'English is unchanged');
  assert.ok(TEXT.create('ar').t(plan.template,plan.params).includes('\u2068setup.exe\u2069'));
  assert.match(TEXT.create('ar').t(plan.template,plan.params),/^[\u0600-\u06ff]/);
  const unnamed=P.downloadPlan({id:2,url:'data:application/octet-stream;base64,AA',filename:'.exe'},{capture:true});
  if(unnamed.kind==='block')assert.equal(TEXT.create('en').t(unnamed.template,unnamed.params),unnamed.reason);
});

// ---- magnet links on fitgirl-repacks.site ----
const MAGNET_LINK='magnet:?xt=urn:btih:1a7168b2475e6dad602526a093c8e75a5ea0a27a&dn=Game';
test('a magnet link clicked on FitGirl goes to Ravenshelf only from its own page script, in a normal window',async()=>{
  const answers=[];
  const b=fakeBrowser({native:message=>{answers.push(message);return message.type==='magnet'?{ok:true,action:'review'}:{ok:false,error:'invalid'};}});
  const send=(msg,sender)=>new Promise(resolve=>{const handled=b.api.runtime.onMessage.emit(msg,sender,value=>resolve(own(value)))[0];if(handled!==true)resolve(undefined);});
  const page={id:'self',url:'https://fitgirl-repacks.site/game/',frameId:0,tab:{id:3,incognito:false}};
  assert.deepEqual(await send({cmd:'magnet',magnet:MAGNET_LINK},page),{ok:true,action:'review'});
  assert.deepEqual(answers.filter(m=>m.type==='magnet'),[{v:1,type:'magnet',magnet:MAGNET_LINK}]);
  // Not from a FitGirl page, not the top frame, a private window, or not a magnet link: nothing is sent.
  for(const sender of [{...page,url:'https://fitgirl-repacks.site.evil.test/'},{...page,frameId:2},{...page,url:'https://evil.example/'}])
    assert.equal(await send({cmd:'magnet',magnet:MAGNET_LINK},sender),undefined,sender.url);
  assert.deepEqual(await send({cmd:'magnet',magnet:MAGNET_LINK},{...page,tab:{id:3,incognito:true}}),{ok:false});
  assert.deepEqual(await send({cmd:'magnet',magnet:'https://x.example/'},page),{ok:false});
  assert.deepEqual(await send({cmd:'magnet',magnet:'magnet:?xt=a\nb'},page),{ok:false});
  // The switch in the toolbar window turns it off.
  assert.equal((await b.message({cmd:'set',key:'magnets',value:false})).ok,true);
  assert.deepEqual(await send({cmd:'magnet',magnet:MAGNET_LINK},page),{ok:false});
  assert.equal(answers.filter(m=>m.type==='magnet').length,1);
});

test('the FitGirl page script passes on only a real left click on a magnet link, and opens it as before when Ravenshelf says no',async()=>{
  function pageScript(reply){
    const listeners=[],sent=[],opened=[];
    const document={addEventListener:(type,fn,capture)=>{assert.equal(type,'click');assert.equal(capture,true);listeners.push(fn);}};
    class Element{constructor(href){this.href=href;}closest(selector){assert.equal(selector,'a[href]');return this.href===null?null:this;}getAttribute(name){return name==='href'?this.href:null;}}
    const chrome={runtime:{sendMessage:async message=>{sent.push(own(message));if(reply instanceof Error)throw reply;return reply;}}};
    const context=vm.createContext({document,Element,chrome,location:{assign:url=>opened.push(url)},Promise});
    vm.runInContext(read('magnet.js'),context,{filename:'magnet.js'});
    const click=(href,patch={})=>{const event={isTrusted:true,defaultPrevented:false,button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,target:new Element(href),prevented:false,
      preventDefault(){this.prevented=true;},stopPropagation(){},...patch};listeners[0](event);return event;};
    return {click,sent,opened};
  }
  const taken=pageScript({ok:true,action:'review'});
  assert.equal(taken.click(MAGNET_LINK).prevented,true);await tick();
  assert.deepEqual(taken.sent,[{cmd:'magnet',magnet:MAGNET_LINK}]);assert.deepEqual(taken.opened,[]);
  for(const patch of [{isTrusted:false},{button:1},{ctrlKey:true},{shiftKey:true},{defaultPrevented:true}])assert.equal(taken.click(MAGNET_LINK,patch).prevented,false,JSON.stringify(patch));
  assert.equal(taken.click('https://fitgirl-repacks.site/other/').prevented,false);assert.equal(taken.click(null).prevented,false);
  await tick();assert.equal(taken.sent.length,1);
  for(const reply of [{ok:true,action:'off'},{ok:false},undefined,new Error('no app')]){
    const declined=pageScript(reply);declined.click(MAGNET_LINK);await tick();
    assert.deepEqual(declined.opened,[MAGNET_LINK],JSON.stringify(reply));
  }
});
