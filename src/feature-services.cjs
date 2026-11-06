'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const {AppUpdater}=require('./app-updater.cjs');
const {ClipboardInbox}=require('./clipboard-inbox.cjs');
const {NotificationAlerts}=require('./notifications.cjs');
const {createGameMetadata}=require('./game-metadata.cjs');
const {createDownloadCleanup}=require('./download-cleanup.cjs');
const {createIntegrityVerifier}=require('./integrity-verifier.cjs');
const {analyzeArchiveSet}=require('./archive-set-validation.cjs');
const {normalizeBandwidthLimit}=require('./bandwidth-limiter.cjs');
const {normalizeSchedule}=require('./download-schedule.cjs');
const BOOLEAN_SETTINGS=['autoUpdateEnabled','clipboardWatchEnabled','notificationsEnabled','adaptiveThemeEnabled'];
function featureSettings(patch){
  const changes={};
  for(const key of BOOLEAN_SETTINGS)if(patch?.[key]!==undefined){if(typeof patch[key]!=='boolean')throw new Error('Choose on or off for this preference.');changes[key]=patch[key];}
  if(patch?.maxDownloadBytesPerSecond!==undefined)changes.maxDownloadBytesPerSecond=normalizeBandwidthLimit(patch.maxDownloadBytesPerSecond);
  if(patch?.downloadSchedule!==undefined)changes.downloadSchedule=normalizeSchedule(patch.downloadSchedule);
  return changes;
}
function createFeatureServices({app,win,manager,completion,dialog,clipboard,Notification,register,publish,providers,checked,isTest=false}){
  manager.settings={autoUpdateEnabled:true,clipboardWatchEnabled:false,notificationsEnabled:true,adaptiveThemeEnabled:true,...manager.settings};
  const cleanup=createDownloadCleanup({getDownloads:()=>manager.downloads});
  const metadata=createGameMetadata();
  const notifier=new NotificationAlerts({enabled:()=>manager.settings.notificationsEnabled!==false&&!isTest,show:options=>{if(typeof Notification==='function'&&Notification.isSupported()){const alert=new Notification(options);alert.on('click',()=>{if(!win.isDestroyed()){win.show();win.focus();}});alert.show();}}});
  notifier.observe(manager.downloads);
  const verifier=createIntegrityVerifier({onChange:()=>publish()});
  const inbox=new ClipboardInbox({readText:()=>clipboard.readText(),onChange:()=>publish()});
  const updater=new AppUpdater({currentVersion:app.getVersion(),profileDir:app.getPath('userData'),executable:process.env.PORTABLE_EXECUTABLE_FILE||'',bandwidthLimiter:manager.bandwidthLimiter,supported:Boolean(app.isPackaged&&process.platform==='win32'&&process.env.PORTABLE_EXECUTABLE_FILE&&!isTest),onChange:()=>publish(),onReady:version=>notifier.update(version)});
  let restartOnExit=false,closing=false;
  const operations=new Set();
  function track(operation){
    if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');
    if(operations.size)throw new Error('Wait for the current cleanup operation to finish.');
    const task=Promise.resolve().then(operation);operations.add(task);
    task.then(()=>operations.delete(task),()=>operations.delete(task));return task;
  }
  const idsFrom=value=>{if(!Array.isArray(value)||!value.length||value.length>500||value.some(id=>typeof id!=='string'||id.length>200))throw new Error('Choose between 1 and 500 downloads.');return [...new Set(value)];};
  const assertIdle=()=>{
    if(operations.size||manager.downloads.some(d=>['downloading','queued'].includes(d.status)||['queued','scanning'].includes(d.scan?.status))||verifier.snapshot().phase==='running'||['countdown','executing'].includes(completion?.snapshot().phase))throw new Error('Pause active work before restarting for an update.');
  };
  register('getUpdateState',()=>updater.snapshot());
  register('checkForUpdates',()=>updater.check());
  register('installUpdate',()=>{assertIdle();if(updater.snapshot().phase!=='ready')throw new Error('Check for and download an update first.');restartOnExit=true;app.quit();return {restarting:true};});
  register('getGameMetadata',async value=>{
    if(!value||typeof value.url!=='string')return metadata({});
    let game;try{game=await providers.getGame(value.url);}catch{return {source:null,requirements:{minimum:'',recommended:''},reviews:null,genres:[],message:'Game details could not be loaded. Try again later.'};}
    const result=await metadata(game);
    if(!result.requirements.minimum&&!result.requirements.recommended&&game.systemRequirements)result.requirements={minimum:String(game.systemRequirements).slice(0,12000),recommended:''};
    return result;
  });
  register('getStorageSummary',()=>cleanup.summary());
  register('previewDownloadRemoval',({ids}={})=>track(async()=>{
    const selected=idsFrom(ids),wasActive=manager.downloads.some(d=>selected.includes(d.id)&&['queued','downloading'].includes(d.status));
    try{await manager.pauseAndWait(selected);const preview=await cleanup.preview(selected);if(wasActive)preview.warnings.unshift('Selected active downloads were paused for review. Cancelling leaves them paused.');return preview;}
    finally{manager.releaseQuiescence(selected);}
  }));
  register('removeDownloads',({ids,mode,token}={})=>track(async()=>{
    const selected=idsFrom(ids);if(!['files','list'].includes(mode))throw new Error('Choose delete files or remove from list.');
    if(completion?.snapshot().phase==='executing')throw new Error('The completion action has started. Wait before changing the queue.');
    completion?.cancel('Queue cleanup cancelled the completion action.');
    try{
      await manager.pauseAndWait(selected);
      if(mode==='list'){const result=manager.removeFromList(selected);return {removedIds:result.ids,errors:[],bytesFreed:0};}
      const result=await cleanup.deletePreview({ids:selected,token});if(result.removedIds.length)manager.removeFromList(result.removedIds);
      return {...result,errors:result.failed||[]};
    }finally{manager.releaseQuiescence(selected);publish();}
  }));
  register('validateArchiveSet',({sourceUrls}={})=>{
    if(!Array.isArray(sourceUrls)||sourceUrls.length>500||sourceUrls.some(url=>typeof url!=='string'))throw new Error('Invalid download batch.');
    const links=sourceUrls.map(url=>checked.get(url));
    if(links.some(link=>!link))throw new Error('Check these links before queuing them.');
    return analyzeArchiveSet(links);
  });
  register('getClipboardInbox',()=>inbox.snapshot());
  register('dismissClipboardLinks',({ids}={})=>inbox.dismiss(ids));
  register('importClipboardLinks',({ids}={})=>inbox.import(ids));
  register('getVerificationState',()=>verifier.snapshot());
  register('verifyFiles',async()=>{
    if(verifier.snapshot().phase==='running')return verifier.snapshot();
    const manifest=await dialog.showOpenDialog(win,{title:'Choose an SFV, MD5 or SHA-256 checksum file',properties:['openFile'],filters:[{name:'Checksum manifests',extensions:['sfv','md5','sha256','txt']} ]});
    if(manifest.canceled||!manifest.filePaths?.[0])return verifier.snapshot();
    const root=await dialog.showOpenDialog(win,{title:'Choose the extracted game folder to verify',defaultPath:path.dirname(manifest.filePaths[0]),properties:['openDirectory']});
    if(root.canceled||!root.filePaths?.[0])return verifier.snapshot();
    return verifier.start({manifestPath:manifest.filePaths[0],rootPath:root.filePaths[0]});
  });
  register('cancelVerification',()=>verifier.cancel());
  function configure(changes={}){
    if('autoUpdateEnabled' in changes)updater.configure(changes.autoUpdateEnabled&&!isTest);
    if('clipboardWatchEnabled' in changes)inbox.configure(changes.clipboardWatchEnabled&&!isTest);
  }
  configure(manager.settings);
  return {
    snapshot:()=>({updater:updater.snapshot(),clipboardInbox:inbox.snapshot(),verification:verifier.snapshot()}),
    configure,observe:()=>notifier.observe(manager.downloads),
    validateBatch:(links,allowIncomplete)=>{const result=analyzeArchiveSet(links);if(result.errors.length&&allowIncomplete!==true)throw new Error('Archive parts are missing or inconsistent. Review the link set before downloading.');return result;},
    async beforeQuit(){
      closing=true;
      inbox.dispose();verifier.cancel();updater.dispose();
      await Promise.allSettled([...operations]);
      if(updater.snapshot().phase!=='ready')return;
      const prepared=await updater.prepareInstall({restart:restartOnExit});if(!prepared)return;
      await new Promise((resolve,reject)=>{const child=spawn(prepared.helper,[prepared.job],{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    }
  };
}
module.exports={createFeatureServices,featureSettings};
