'use strict';
const fs=require('node:fs');
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
const {compareRequirements}=require('./compatibility.cjs');
const BOOLEAN_SETTINGS=['autoUpdateEnabled','clipboardWatchEnabled','notificationsEnabled','adaptiveThemeEnabled'];
function featureSettings(patch){
  const changes={};
  for(const key of BOOLEAN_SETTINGS)if(patch?.[key]!==undefined){if(typeof patch[key]!=='boolean')throw new Error('Choose on or off for this preference.');changes[key]=patch[key];}
  if(patch?.maxDownloadBytesPerSecond!==undefined)changes.maxDownloadBytesPerSecond=normalizeBandwidthLimit(patch.maxDownloadBytesPerSecond);
  if(patch?.downloadSchedule!==undefined)changes.downloadSchedule=normalizeSchedule(patch.downloadSchedule);
  return changes;
}
// Free space on the drive of a folder, in bytes, or null. A folder that does
// not exist yet is measured at its nearest existing parent.
async function freeSpace(folder,{statfs=fs.promises.statfs}={}){
  if(typeof statfs!=='function'||typeof folder!=='string'||!folder)return null;
  let current=path.resolve(folder);
  for(let i=0;i<64;i++){
    try{const stats=await statfs(current);const free=Number(stats.bavail)*Number(stats.bsize);return Number.isSafeInteger(free)&&free>=0?free:null;}
    catch(error){if(error?.code!=='ENOENT')return null;}
    const parent=path.dirname(current);if(parent===current)return null;current=parent;
  }
  return null;
}
// The same drive, by the root of each path (the drive letter on Windows).
const SPACE_TIMEOUT_MS=4000;
const driveOf=value=>{try{return path.parse(path.resolve(String(value))).root.toLowerCase();}catch{return '';}};
function createFeatureServices({app,win,manager,completion,dialog,clipboard,Notification,register,publish,providers,checked,hardware=null,statfs,isTest=false}){
  manager.settings={autoUpdateEnabled:true,clipboardWatchEnabled:false,notificationsEnabled:true,adaptiveThemeEnabled:true,...manager.settings};
  const cleanup=createDownloadCleanup({getDownloads:()=>manager.downloads,getDownloadDir:()=>manager.settings.downloadDir});
  const metadata=createGameMetadata();
  const notifier=new NotificationAlerts({enabled:()=>manager.settings.notificationsEnabled!==false&&!isTest,show:options=>{if(typeof Notification==='function'&&Notification.isSupported()){const alert=new Notification(options);alert.on('click',()=>{if(!win.isDestroyed()){win.show();win.focus();}});alert.show();}}});
  notifier.observe(manager.downloads);
  const verifier=createIntegrityVerifier({onChange:()=>publish()});
  const inbox=new ClipboardInbox({readText:()=>clipboard.readText(),onChange:()=>publish()});
  const updatesSupported=Boolean(app.isPackaged&&process.platform==='win32'&&process.env.PORTABLE_EXECUTABLE_FILE&&!isTest);
  const updater=new AppUpdater({currentVersion:app.getVersion(),profileDir:app.getPath('userData'),executable:process.env.PORTABLE_EXECUTABLE_FILE||'',bandwidthLimiter:manager.bandwidthLimiter,supported:updatesSupported,onChange:()=>publish(),onAvailable:version=>notifier.available(version),onReady:version=>notifier.update(version)});
  // Remove leftovers from earlier updates shortly after start and once more
  // after any helper launched by the previous session has certainly finished.
  // This runs whether or not automatic update checks are enabled.
  const cleanupTimers=updatesSupported?[10000,20*60*1000].map(delay=>{const timer=setTimeout(()=>{updater.cleanupLeftovers().catch(()=>{});},delay);timer.unref?.();return timer;}):[];
  let restartOnExit=false,closing=false,storageTask=null,storageController=null;
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
  register('downloadUpdate',()=>updater.download());
  register('installUpdate',()=>{assertIdle();const update=updater.snapshot();if(update.phase!=='ready'||update.installApproved!==true)throw new Error('Choose Download and install, and wait for the update to be verified first.');restartOnExit=true;app.quit();return {restarting:true};});
  async function gameDetails(value){
    if(!value||typeof value.url!=='string')return metadata({});
    let game;try{game=await providers.getGame(value.url);}catch{return {source:null,requirements:{minimum:'',recommended:''},reviews:null,genres:[],message:'Game details could not be loaded. Try again later.'};}
    const result=await metadata(game);
    if(!result.requirements.minimum&&!result.requirements.recommended&&game.systemRequirements)result.requirements={minimum:String(game.systemRequirements).slice(0,12000),recommended:''};
    return result;
  }
  register('getGameMetadata',gameDetails);
  // Can You Run It: the game's requirement list next to this PC's specs. The
  // specs are read on this PC, only when asked, and the answer is not saved.
  // refresh:true (Compare again) reads this PC again, as Check again does.
  register('checkGame',async value=>{
    if(!value||typeof value.url!=='string'||value.url.length>2000)throw new Error('Choose a game first.');
    const details=await gameDetails({url:value.url});
    let specs=null;
    if(hardware&&typeof hardware.get==='function'){try{specs=await hardware.get({refresh:value.refresh===true});}catch{specs=null;}}
    // A message without lists: the details could not be loaded this time.
    return compareRequirements(details?.requirements,specs,{unavailable:Boolean(details?.message)});
  });
  // Room for new downloads: free space on the download folder's drive, and
  // what downloads already waiting there still need.
  // A drive that does not answer (an offline network share, say) gives no
  // figure after four seconds; a check still running is shared.
  let spaceTask=null;
  function measure(folder){
    if(spaceTask?.folder===folder)return spaceTask.promise;
    let timer;
    const promise=Promise.race([freeSpace(folder,{statfs}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),SPACE_TIMEOUT_MS);timer.unref?.();})])
      .finally(()=>{clearTimeout(timer);if(spaceTask?.promise===promise)spaceTask=null;});
    spaceTask={folder,promise};
    return promise;
  }
  register('getDownloadSpace',async()=>{
    const folder=manager.settings.downloadDir,drive=driveOf(folder);
    let pendingBytes=0;
    // A download that failed can be retried, so what it still needs counts too.
    for(const item of manager.downloads){
      if(!['queued','downloading','paused','error'].includes(item.status)||driveOf(item.folder||folder)!==drive)continue;
      const total=Number(item.total),received=Number(item.received)||0;
      if(Number.isSafeInteger(total))pendingBytes+=Math.max(0,total-Math.max(0,received));
    }
    return {freeBytes:await measure(folder),pendingBytes};
  });
  register('getStorageSummary',()=>{
    if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');
    if(storageTask)return storageTask;
    storageController=new AbortController();
    storageTask=Promise.resolve().then(()=>cleanup.summary({signal:storageController.signal})).finally(()=>{storageTask=null;storageController=null;});
    return storageTask;
  });
  register('previewDownloadRemoval',({ids}={})=>track(async()=>{
    const selected=idsFrom(ids),wasActive=manager.downloads.some(d=>selected.includes(d.id)&&['queued','downloading'].includes(d.status));
    try{await manager.pauseAndWait(selected);const preview=await cleanup.preview(selected);if(wasActive)preview.warnings.unshift('Selected active downloads were paused for review. Cancelling leaves them paused.');return preview;}
    finally{manager.releaseQuiescence(selected);}
  }));
  register('removeDownloads',({ids,mode,token}={})=>track(async()=>{
    const selected=idsFrom(ids);if(!['files','list'].includes(mode))throw new Error('Choose delete files or remove from list.');
    if(completion?.snapshot().phase==='executing')throw new Error('The completion action has started. Wait before changing the queue.');
    // Only an armed finish action is cancelled; with none set there is nothing to report.
    if(completion&&completion.snapshot().mode!=='none')completion.cancel('Queue cleanup cancelled the completion action.');
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
      for(const timer of cleanupTimers)clearTimeout(timer);
      storageController?.abort();
      const pending=Promise.allSettled([...operations,...(storageTask?[storageTask]:[])]);
      inbox.dispose();verifier.cancel();await updater.dispose();
      await pending;
      // Install only an update the user chose to download and that verified.
      const update=updater.snapshot();
      if(update.phase!=='ready'||update.installApproved!==true)return;
      const prepared=await updater.prepareInstall({restart:restartOnExit});if(!prepared)return;
      await new Promise((resolve,reject)=>{const child=spawn(prepared.helper,[prepared.job],{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    }
  };
}
module.exports={createFeatureServices,featureSettings,freeSpace};
