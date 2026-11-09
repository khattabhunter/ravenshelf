'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createBrowserIntegration}=require('../src/browser-integration.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');

const tick=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t,{platform='win32',isTest=false,enabled=false,registerError=null,openPathError='',existingVersions={},exportError=null}={}){
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
    bridgeOptions:{platform:process.platform},
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
