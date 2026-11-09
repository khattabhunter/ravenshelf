'use strict';
// YouTube downloads in Ravenshelf: the one-time setup of the helper programs,
// the quality used for right-click downloads, and the videos the browser
// extension sends. A video sent before setup waits here, in memory only, and
// starts once setup finishes. Setup itself is always the user's choice.
const path=require('node:path');
const {MediaTools,MESSAGES:TOOL_MESSAGES}=require('./media-tools.cjs');
const {createMediaRunner}=require('./media-downloads.cjs');
const {QUALITIES,QUALITY_IDS,DEFAULT_QUALITY}=require('./youtube.cjs');

const MAX_WAITING=10,WAIT_MS=60*60*1000;
const FULL='Too many YouTube downloads are waiting. Let some finish first.';

// Large helper programs belong in the local (not roaming) profile.
function toolsFolder({profile,isTest,env=process.env}){
  const local=env.LOCALAPPDATA;
  return !isTest&&typeof local==='string'&&path.win32.isAbsolute(local)?path.win32.join(local,'Ravenshelf','media-tools'):path.join(profile,'media-tools');
}
function createMediaIntegration({app,win,manager,Notification,register,publish,assertQueueAvailable=()=>{},isTest=false,platform=process.platform,root=null,toolsOptions={},runnerOptions={},now=Date.now}){
  manager.settings={youtubeQuality:DEFAULT_QUALITY,...manager.settings};
  if(!QUALITY_IDS.includes(manager.settings.youtubeQuality))manager.settings.youtubeQuality=DEFAULT_QUALITY;
  let waiting=[],requests=0,closing=false;
  const reveal=()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}};
  const notify=({title,body})=>{
    if(manager.settings.notificationsEnabled===false||isTest)return;
    try{if(typeof Notification==='function'&&Notification.isSupported()){const alert=new Notification({title,body});alert.on('click',reveal);alert.show();}}catch{}
  };
  const expire=()=>{const limit=now()-WAIT_MS;waiting=waiting.filter(item=>item.at>limit);};
  function startWaiting(){
    expire();const items=waiting;waiting=[];
    for(const item of items){try{assertQueueAvailable();manager.addMedia({videoId:item.videoId,quality:item.quality});}catch{/* It can be sent again from YouTube. */}}
    publish();
  }
  const tools=new MediaTools({root:root||toolsFolder({profile:app.getPath('userData'),isTest}),bandwidthLimiter:manager.bandwidthLimiter,platform,
    onChange:()=>publish(),onReady:()=>startWaiting(),...toolsOptions});
  const runner=createMediaRunner({tools,...runnerOptions});
  manager.media=runner;
  // Leftovers of an earlier session: temporary folders of stopped jobs, an
  // abandoned setup folder or an older set of helper programs.
  runner.cleanStale().catch(()=>{});
  if(platform==='win32')tools.removeOthers().catch(()=>{});
  const busyJobs=()=>runner.active>0||manager.downloads.some(d=>d.kind==='media'&&['queued','downloading'].includes(d.status));
  function snapshot(){
    expire();
    return {supported:platform==='win32',tools:tools.snapshot(),quality:manager.settings.youtubeQuality,requests,
      waiting:waiting.map(({videoId,quality})=>({videoId,quality})),qualities:QUALITY_IDS.map(id=>({id,label:QUALITIES[id].label}))};
  }
  // One video from the browser extension: queued straight away, or kept until
  // setup finishes. 'busy' covers a full queue, a running finish action and closing.
  function queue({videoId,quality}={}){
    if(closing||platform!=='win32')return {action:'busy'};
    const selected=quality==='default'?manager.settings.youtubeQuality:quality;
    if(!QUALITY_IDS.includes(selected))return {action:'busy'};
    if(tools.refresh()!=='ready'){
      expire();
      if(!waiting.some(item=>item.videoId===videoId&&item.quality===selected)){
        if(waiting.length>=MAX_WAITING)return {action:'busy'};
        waiting.push({videoId,quality:selected,at:now()});
      }
      requests++;publish();reveal();
      notify({title:'Set up YouTube downloads',body:'Ravenshelf needs a one-time setup before it can download YouTube videos. Your video starts after that.'});
      return {action:'setup'};
    }
    try{assertQueueAvailable();}catch{return {action:'busy'};}
    let result;
    try{result=manager.addMedia({videoId,quality:selected});}
    catch(error){if(error?.message===FULL)return {action:'busy'};throw error;}
    return {action:result.added?'queued':'duplicate'};
  }
  const assertOpen=()=>{if(closing)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');};
  register('setUpYouTube',()=>{assertOpen();tools.install();return snapshot();});
  register('cancelYouTubeSetup',()=>{tools.cancel();return snapshot();});
  register('removeYouTubeTools',async()=>{
    assertOpen();
    if(busyJobs())throw new Error(TOOL_MESSAGES.busy);
    await tools.remove();publish();return snapshot();
  });
  register('saveYouTubeSettings',(options={})=>{
    if(!options||typeof options!=='object'||!QUALITY_IDS.includes(options.quality))throw new Error('Choose a YouTube download quality.');
    manager.updateSettings({youtubeQuality:options.quality});return snapshot();
  });
  register('dismissYouTubeRequests',()=>{waiting=[];publish();return snapshot();});
  return {
    snapshot,queue,
    async beforeQuit(){closing=true;await tools.dispose();}
  };
}
module.exports={createMediaIntegration,toolsFolder,MAX_WAITING};
