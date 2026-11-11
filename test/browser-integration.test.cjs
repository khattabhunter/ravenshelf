'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const protocol=require('../src/browser-protocol.cjs');
const {createBrowserIntegration}=require('../src/browser-integration.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');

const tick=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t,{platform='win32',isTest=false,enabled=false,registerError=null,openPathError='',existingVersions={},exportError=null,bridge={}}={}){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-integration-'));
  t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));
  const events={registered:0,unregistered:0,exported:[],opened:[],published:0,added:[],queueChecks:0,external:[]};
  const manager={settings:{downloadDir:profile,notificationsEnabled:true,...(enabled?{browserIntegrationEnabled:true}:{})},downloads:[],
    updateSettings(changes){Object.assign(this.settings,changes);},add(batch){events.added.push(batch);return {added:1,ids:['d1']};},setReputation(){}};
  const versions={...existingVersions};
  const setup={
    exportedVersion:(root,browser)=>versions[browser]||null,
    exportExtension:async({browser,root,version})=>{if(exportError)throw exportError;events.exported.push(browser);versions[browser]=version;fs.mkdirSync(path.join(root,browser),{recursive:true});return {path:path.join(root,browser)};},
    registerNativeHost:async({hostDir})=>{assert.ok(path.isAbsolute(hostDir));if(registerError)throw registerError;events.registered++;},
    unregisterNativeHost:async()=>{events.unregistered++;}
  };
  const handles=new Map();
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('sealed:'+text),decryptString:buffer=>buffer.toString().slice(7)};
  const integration=createBrowserIntegration({
    app:{getPath:()=>profile,getVersion:()=>'0.5.0'},win:{isDestroyed:()=>false,isMinimized:()=>false,restore(){},show(){},focus(){}},manager,
    shell:{openPath:async folder=>{events.opened.push(folder);return openPathError;},openExternal:async url=>{events.external.push(url);}},
    safeStorage,Notification:null,register:(name,fn)=>handles.set(name,fn),publish:()=>{events.published++;},
    resolveProvider:null,assertQueueAvailable:()=>{events.queueChecks++;},isTest,platform,setup,
    bridgeOptions:{platform:process.platform,...bridge},
    listOptions:{fetcher:async()=>new Response('',{status:404})},
    virusTotalOptions:{fetcher:async()=>{throw new Error('no network in tests');}}
  });
  t.after(()=>integration.beforeQuit());
  const call=(name,value)=>handles.get(name)(value);
  return {profile,events,manager,integration,handles,call,endpoint:path.join(profile,'browser-host','endpoint.json')};
}

test('everything stays off until the user connects the extension',async t=>{
  const f=fixture(t);
  await tick();
  const state=f.integration.snapshot();
  assert.equal(state.enabled,false);assert.equal(state.phase,'off');assert.equal(state.supported,true);
  assert.equal(state.bridge.running,false);assert.equal(state.virusTotal.configured,false);
  assert.equal(f.events.registered,0);assert.equal(f.events.exported.length,0);
  assert.equal(fs.existsSync(f.endpoint),false,'no connector endpoint while off');
  assert.deepEqual([...f.handles.keys()].sort(),['browserCaptureAction','clearVirusTotalKey','openBrowserExtensionFolder','saveVirusTotalSettings','setBrowserIntegration','setVirusTotalKey','updateThreatLists']);
});

test('connecting registers the connector, writes both extension folders and starts the bridge; disconnecting undoes it',async t=>{
  const f=fixture(t);
  const on=await f.call('setBrowserIntegration',true);
  assert.equal(on.enabled,true);assert.equal(on.phase,'on');assert.equal(on.bridge.running,true);
  assert.equal(f.manager.settings.browserIntegrationEnabled,true);
  assert.equal(f.events.registered,1);assert.deepEqual(f.events.exported.sort(),['chromium','firefox']);
  assert.equal(on.folders.chromium.version,'0.5.0');assert.equal(on.folders.chromium.path,path.join(f.profile,'browser-extension','chromium'));
  const endpoint=JSON.parse(fs.readFileSync(f.endpoint,'utf8'));
  assert.equal(endpoint.schema,1);assert.match(endpoint.token,/^[0-9a-f]{64}$/);
  const off=await f.call('setBrowserIntegration',false);
  assert.equal(off.enabled,false);assert.equal(off.phase,'off');assert.equal(off.bridge.running,false);
  assert.equal(f.events.unregistered,1);assert.equal(fs.existsSync(f.endpoint),false);
  await assert.rejects(f.call('setBrowserIntegration','yes'),/Choose on or off/);
});

test('after an update, an extension folder that cannot be replaced does not stop the connection',async t=>{
  const f=fixture(t,{existingVersions:{chromium:'0.4.9',firefox:'0.4.9'},exportError:Object.assign(new Error('EPERM: rename C:\\Users\\Player\\chromium'),{code:'EPERM'})});
  const on=await f.call('setBrowserIntegration',true);
  assert.equal(on.phase,'on');assert.equal(on.bridge.running,true);assert.ok(fs.existsSync(f.endpoint),'the connector can still reach Ravenshelf');
  assert.match(on.problem,/could not be updated/);assert.ok(!on.problem.includes('Player'));assert.equal(on.folders.chromium.version,'0.4.9');
});
test('without any extension folder, a failed export still stops setup',async t=>{
  const f=fixture(t,{exportError:Object.assign(new Error('no space'),{code:'ENOSPC'})});
  await assert.rejects(f.call('setBrowserIntegration',true));
  const state=f.integration.snapshot();
  assert.equal(state.phase,'error');assert.equal(state.bridge.running,false);assert.equal(fs.existsSync(f.endpoint),false);
});
test('a failed setup leaves the switch off and explains the problem',async t=>{
  const f=fixture(t,{registerError:Object.assign(new Error('reg.exe failed at C:\\Users\\Player\\x'),{code:'EPERM'})});
  await assert.rejects(f.call('setBrowserIntegration',true));
  const state=f.integration.snapshot();
  assert.equal(state.enabled,false);assert.equal(state.phase,'error');
  assert.equal(state.problem,publicErrorMessage({code:'EPERM'},'setBrowserIntegration'));
  assert.ok(!state.problem.includes('Player'),'no local path reaches the window');
  assert.equal(state.bridge.running,false);assert.equal(fs.existsSync(f.endpoint),false);
  const other=fixture(t,{platform:'linux'});
  await assert.rejects(other.call('setBrowserIntegration',true),/available on Windows only/);
  assert.equal(other.manager.settings.browserIntegrationEnabled,false);
  assert.equal(other.integration.snapshot().supported,false);
});

test('an enabled connection starts with Ravenshelf, and quitting keeps it registered',async t=>{
  const f=fixture(t,{enabled:true});
  await tick(50);
  assert.equal(f.integration.snapshot().phase,'on');assert.equal(f.events.registered,1);
  assert.equal(fs.existsSync(f.endpoint),true);
  await f.integration.beforeQuit();
  assert.equal(fs.existsSync(f.endpoint),false,'the browser can tell Ravenshelf is closed');
  assert.equal(f.events.unregistered,0,'the connector stays registered for next time');
  await assert.rejects(f.call('setBrowserIntegration',true),/closing/);
});

test('isolated test profiles never touch the registry',async t=>{
  const f=fixture(t,{isTest:true});
  const state=await f.call('setBrowserIntegration',true);
  assert.equal(state.phase,'on');assert.equal(f.events.registered,0);
  await f.call('setBrowserIntegration',false);
  assert.equal(f.events.unregistered,0);
});

test('the extension folder opens for a supported browser, exported for this version once',async t=>{
  const f=fixture(t);
  await assert.rejects(f.call('openBrowserExtensionFolder','safari'),/Choose Chrome, Edge, Brave or Firefox/);
  await f.call('openBrowserExtensionFolder','firefox');
  await f.call('openBrowserExtensionFolder','chromium');
  assert.deepEqual(f.events.opened,[path.join(f.profile,'browser-extension','firefox'),path.join(f.profile,'browser-extension','chromium')]);
  assert.deepEqual(f.events.exported.sort(),['chromium','firefox'],'each folder is written once per version');
  const g=fixture(t,{openPathError:'not found'});
  await assert.rejects(g.call('openBrowserExtensionFolder','chromium'),/could not open the extension folder/);
});

test('the VirusTotal key is sealed and never sent back, and its options can be changed',async t=>{
  const f=fixture(t);
  const key='a'.repeat(64);
  const saved=f.call('setVirusTotalKey',key);
  assert.equal(saved.virusTotal.configured,true);
  assert.ok(!JSON.stringify(saved).includes(key),'the key is not in the window state');
  const stored=fs.readFileSync(path.join(f.profile,'virustotal.json'),'utf8');
  assert.ok(!stored.includes(key),'the key is stored sealed');
  assert.throws(()=>f.call('setVirusTotalKey','short'),/64 letters and numbers/);
  const options=f.call('saveVirusTotalSettings',{fileChecks:false});
  assert.equal(options.virusTotal.fileChecks,false);assert.equal(options.virusTotal.domainChecks,true);
  assert.throws(()=>f.call('saveVirusTotalSettings',{domainChecks:'no'}),/Choose on or off/);
  assert.equal(f.call('clearVirusTotalKey').virusTotal.configured,false);
});

test('lists update only while connected, and finished browser downloads get a file check',async t=>{
  const f=fixture(t);
  await assert.rejects(f.call('updateThreatLists'),/Turn on Connect the browser extension first/);
  await f.call('setBrowserIntegration',true);
  const state=await f.call('updateThreatLists');
  assert.equal(state.threatLists.total,0);
  assert.ok(state.threatLists.sources.every(source=>source.error),'unreachable lists are reported, not invented');
  const bridge=f.integration;
  let checked=null;
  const original=require('../src/browser-bridge.cjs').BrowserBridge.prototype.afterDownload;
  t.after(()=>{require('../src/browser-bridge.cjs').BrowserBridge.prototype.afterDownload=original;});
  require('../src/browser-bridge.cjs').BrowserBridge.prototype.afterDownload=async(download,file)=>{checked=[download.id,file];return null;};
  bridge.afterDownload({id:'x',origin:'catalog',folder:f.profile,name:'a.zip'});
  assert.equal(checked,null,'only downloads from the browser are checked');
  bridge.afterDownload({id:'d1',origin:'browser',folder:f.profile,name:'game.zip'});
  assert.deepEqual(checked,['d1',path.join(f.profile,'game.zip')]);
});

// Talks to the bridge the way the extension's connector does: this session's
// token and the extension's identity first, then one message.
async function fromExtension(f,message){
  const endpoint=JSON.parse(fs.readFileSync(f.endpoint,'utf8'));
  const address=process.platform==='win32'?`\\\\.\\pipe\\${endpoint.pipe}`:path.join(path.dirname(f.endpoint),`${endpoint.pipe}.sock`);
  return new Promise((resolve,reject)=>{
    const socket=net.connect(address),chunks=[];
    socket.on('data',chunk=>chunks.push(chunk));socket.on('error',reject);
    socket.on('close',()=>{const data=Buffer.concat(chunks);resolve(data.length?JSON.parse(data.subarray(4,4+data.readUInt32LE(0)).toString('utf8')):null);});
    socket.write(Buffer.concat([{v:1,token:endpoint.token,origin:`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}/`},{v:1,...message}].map(frame=>protocol.encodeFrame(frame))));
  });
}
test('a file downloaded on Nexus Mods is queued into Mods under its game; other browser downloads go to Browser downloads',async t=>{
  const inspect=async url=>({status:'ready',url,sourceUrl:url,filename:decodeURIComponent(new URL(url).pathname.split('/').pop()),size:3072,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:'7z'});
  const f=fixture(t,{bridge:{inspect}});
  await f.call('setBrowserIntegration',true);
  const label={site:'nexusmods',game:'skyrimspecialedition',modId:12604,gameId:1704,fileId:735025,gameName:'Skyrim Special Edition',modName:'SkyUI',fileName:'Main File'};
  const ready=async id=>{for(let i=0;i<200;i++){const capture=f.integration.snapshot().bridge.captures.find(item=>item.id===id);if(capture.status!=='checking')return capture;await tick(5);}throw new Error('still checking');};
  const cdn='https://supporter-files.nexus-cdn.com/1704/12604/SkyUI_5_2_SE-12604-5-2SE.7z?md5=abc&expires=1&user_id=2';
  const mod=await fromExtension(f,{type:'capture',url:cdn,referrer:'https://www.nexusmods.com/',filename:'SkyUI_5_2_SE-12604-5-2SE.7z',totalBytes:3072,incognito:false,mod:label});
  assert.deepEqual({ok:mod.ok,action:mod.action},{ok:true,action:'take'});
  assert.deepEqual((await ready(mod.id)).mod,label,'the review window is told which mod it is');
  assert.equal(f.events.added.length,0,'nothing is queued before you choose');
  await f.call('browserCaptureAction',{id:mod.id,action:'download'});
  assert.equal(f.events.added.length,1);
  const [batch]=f.events.added;
  assert.equal(batch.group,'Mods');assert.equal(batch.gameTitle,'Skyrim Special Edition');assert.equal(batch.links.length,1);
  assert.deepEqual(batch.links[0].mod,label);assert.equal(batch.links[0].origin,'browser');assert.equal(batch.links[0].markOfTheWeb,true);assert.equal(batch.links[0].url,cdn);
  // A mod whose page gave no game name is filed under the game's short name from the address.
  const bare=await fromExtension(f,{type:'capture',url:cdn+'&again=1',referrer:'https://www.nexusmods.com/',filename:'other.7z',mod:{site:'nexusmods',game:'fallout4',modId:7}});
  await ready(bare.id);await f.call('browserCaptureAction',{id:bare.id,action:'download'});
  assert.deepEqual([f.events.added[1].group,f.events.added[1].gameTitle],['Mods','fallout4']);
  // Everything else from the browser is queued exactly as before.
  const plain=await fromExtension(f,{type:'capture',url:'https://cdn.example/game.zip',filename:'game.zip'});
  await ready(plain.id);await f.call('browserCaptureAction',{id:plain.id,action:'download'});
  assert.deepEqual(Object.keys(f.events.added[2]).sort(),['gameTitle','links']);assert.equal(f.events.added[2].gameTitle,'Browser downloads');
  assert.equal(Object.hasOwn(f.events.added[2].links[0],'mod'),false);
  // A malformed label is refused whole, so the extension sends the download again without it.
  assert.deepEqual(await fromExtension(f,{type:'capture',url:cdn+'&bad=1',mod:{...label,folder:'..\\..'}}),{ok:false,error:'invalid'});
  assert.equal(f.events.queueChecks,3,'the queue is checked for availability each time');
});

