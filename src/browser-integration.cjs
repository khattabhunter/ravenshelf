'use strict';
// Connects the Ravenshelf browser extension to the app: the protection lists,
// optional VirusTotal checks, the local bridge the extension's connector talks
// to, and the setup steps the user starts in Settings. All of it stays off
// until the user turns on “Connect the browser extension”.
const path=require('node:path');
const {ThreatLists}=require('./threat-lists.cjs');
const {VirusTotal}=require('./virustotal.cjs');
const {BrowserBridge}=require('./browser-bridge.cjs');
const browserSetup=require('./browser-setup.cjs');
const {safeURL}=require('./net.cjs');
const {publicErrorMessage}=require('./public-errors.cjs');
const {BROWSER_FOLDER}=require('./download-cleanup.cjs');

const EXTENSION_BROWSERS=Object.freeze(['chromium','firefox']);

function createBrowserIntegration({app,win,manager,shell,safeStorage,Notification,register,publish,resolveProvider,assertQueueAvailable,isTest=false,platform=process.platform,setup=browserSetup,bridgeOptions={},listOptions={},virusTotalOptions={}}){
  manager.settings={browserIntegrationEnabled:false,...manager.settings};
  const profile=app.getPath('userData'),version=app.getVersion();
  const hostDir=path.join(profile,'browser-host'),extensionRoot=path.join(profile,'browser-extension');
  const supported=platform==='win32';
  // Isolated test profiles never write to the Windows registry.
  const registers=supported&&!isTest;
  const reveal=()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}};
  const notify=({title,body})=>{
    if(manager.settings.notificationsEnabled===false||isTest)return;
    try{if(typeof Notification==='function'&&Notification.isSupported()){const alert=new Notification({title,body});alert.on('click',reveal);alert.show();}}catch{}
  };
  const threatLists=new ThreatLists({dir:path.join(profile,'threat-lists'),onChange:()=>publish(),...listOptions});
  const virusTotal=new VirusTotal({file:path.join(profile,'virustotal.json'),storage:safeStorage,...virusTotalOptions});
  try{threatLists.load();}catch{}
  try{virusTotal.load();}catch{}
  const bridge=new BrowserBridge({hostDir,threatLists,virusTotal,resolveProvider,appVersion:version,platform,
    queueDownload:entry=>{assertQueueAvailable();return manager.add({links:[entry],gameTitle:BROWSER_FOLDER});},
    openExternal:url=>shell.openExternal(safeURL(url).href),
    reveal,notify,setReputation:(id,value)=>manager.setReputation(id,value),...bridgeOptions});
  bridge.on('change',()=>publish());
  let phase='off',problem='',closing=false,work=Promise.resolve();
  const folderVersions={};
  const readFolders=()=>{for(const browser of EXTENSION_BROWSERS)folderVersions[browser]=setup.exportedVersion(extensionRoot,browser);};
  readFolders();
  // Setup steps change the registry and the profile folder; run one at a time.
  const serial=step=>{const run=work.then(()=>step());work=run.catch(()=>{});return run;};
  // Writes the extension folders for this app version (once per version).
  async function exportFolders(){
    for(const browser of EXTENSION_BROWSERS)if(setup.exportedVersion(extensionRoot,browser)!==version)await setup.exportExtension({browser,root:extensionRoot,version});
    readFolders();
    return Object.fromEntries(EXTENSION_BROWSERS.map(browser=>[browser,path.join(extensionRoot,browser)]));
  }
  async function start(){
    phase='starting';problem='';publish();
    try{
      if(!supported)throw new Error('The browser connector is available on Windows only.');
      if(registers)await setup.registerNativeHost({hostDir});
      await exportFolders();
      await bridge.start();
      // Fetch the lists straight away the first time; later starts wait a little.
      threatLists.start({initialDelayMs:threatLists.total?15000:1000});
      phase='on';
    }catch(error){
      await bridge.stop().catch(()=>{});threatLists.stop();
      phase='error';problem=publicErrorMessage(error,'setBrowserIntegration');
      throw error;
    }finally{publish();}
  }
  async function stop(){
    await bridge.stop();threatLists.stop();
    if(registers)await setup.unregisterNativeHost({hostDir});
    phase='off';problem='';publish();
  }
  function snapshot(){
    return {supported,enabled:manager.settings.browserIntegrationEnabled===true,phase,problem,appVersion:version,
      folders:Object.fromEntries(EXTENSION_BROWSERS.map(browser=>[browser,{path:path.join(extensionRoot,browser),version:folderVersions[browser]||null}])),
      bridge:bridge.snapshot(),threatLists:threatLists.snapshot(),virusTotal:virusTotal.snapshot()};
  }
  const assertOpen=()=>{if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');};
  register('setBrowserIntegration',async enabled=>{
    if(typeof enabled!=='boolean')throw new Error('Choose on or off for this preference.');
    assertOpen();
    await serial(async()=>{
      if(!enabled){manager.updateSettings({browserIntegrationEnabled:false});await stop();return;}
      manager.updateSettings({browserIntegrationEnabled:true});
      try{await start();}catch(error){manager.updateSettings({browserIntegrationEnabled:false});throw error;}
    });
    return snapshot();
  });
  register('openBrowserExtensionFolder',async browser=>{
    if(!EXTENSION_BROWSERS.includes(browser))throw new Error('Choose Chrome, Edge, Brave or Firefox.');
    assertOpen();
    const folders=await serial(exportFolders);
    if(await shell.openPath(folders[browser]))throw new Error('Ravenshelf could not open the extension folder.');
    publish();
    return snapshot();
  });
  register('browserCaptureAction',({id,action,acknowledgeRisk}={})=>bridge.action({id,action,acknowledgeRisk:acknowledgeRisk===true}));
  register('updateThreatLists',async()=>{
    if(manager.settings.browserIntegrationEnabled!==true)throw new Error('Turn on Connect the browser extension first.');
    await threatLists.update({force:true});
    return snapshot();
  });
  // The key goes in one way only: it is sealed with Windows protected storage
  // and never sent back to the window.
  register('setVirusTotalKey',key=>{virusTotal.setKey(key);publish();return snapshot();});
  register('clearVirusTotalKey',()=>{virusTotal.clearKey();publish();return snapshot();});
  register('saveVirusTotalSettings',(options={})=>{
    if(!options||typeof options!=='object')throw new Error('Choose on or off for this preference.');
    virusTotal.setOptions({domainChecks:options.domainChecks,fileChecks:options.fileChecks});publish();return snapshot();
  });
  if(manager.settings.browserIntegrationEnabled===true)serial(start).catch(()=>{});
  return {
    snapshot,
    // VirusTotal file check for a finished download that came from the browser.
    afterDownload(download){
      if(download?.origin!=='browser'||closing)return;
      bridge.afterDownload(download,path.join(download.folder,download.name)).catch(()=>{});
    },
    async beforeQuit(){
      closing=true;
      await work;
      // The connector stays registered, so the browser can tell that Ravenshelf is closed.
      if(bridge.server)await bridge.stop().catch(()=>{});
      threatLists.stop();
    }
  };
}
module.exports={createBrowserIntegration,EXTENSION_BROWSERS};
