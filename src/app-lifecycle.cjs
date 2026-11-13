'use strict';

const CLOSE_BEHAVIORS=Object.freeze(['ask','background','quit']);
const closeBehavior=value=>CLOSE_BEHAVIORS.includes(value)?value:'ask';
const MESSAGES=Object.freeze({
  preference:'Choose what closing the window should do.',
  trayUnavailable:'Ravenshelf could not stay in the background. The window is still open.',
  saveFailed:'Your close preference could not be saved. The window is still open.',
  promptFailed:'Ravenshelf could not show the close options. Try again.',
  shutdown:'Ravenshelf could not finish shutting down. Try Exit again.'
});

// Window visibility does not own services. Hiding keeps downloads and browser
// handoffs running; only the application's serialized quit path stops them.
class AppLifecycle{
  constructor({app,win,Tray,Menu,dialog,icon,getSettings=()=>({}),saveSettings=()=>{},translate=value=>value,onError=()=>{}}){
    Object.assign(this,{app,win,Tray,Menu,dialog,icon,getSettings,saveSettings,translate,onError});
    this.tray=null;this.pending=null;this.promptAbort=null;this.quitting=false;this.disposed=false;
    this.onClose=event=>{if(this.quitting||this.disposed)return;event.preventDefault();void this.requestClose();};
    this.onBeforeQuit=()=>this.beginQuit();
    this.onClosed=()=>this.dispose();
    this.onShow=()=>this.show();this.onQuit=()=>this.quit();
    win.on('close',this.onClose);win.on('closed',this.onClosed);app.on('before-quit',this.onBeforeQuit);
  }
  report(message){try{this.onError(new Error(message));}catch{}}
  live(){return !this.disposed&&!this.win.isDestroyed();}
  show(){
    if(this.quitting||!this.live())return false;
    if(this.win.isMinimized())this.win.restore();
    this.win.show();this.win.focus();return true;
  }
  destroyTray(){
    const tray=this.tray;this.tray=null;if(!tray)return;
    tray.removeListener('click',this.onShow);tray.removeListener('double-click',this.onShow);
    try{if(!tray.isDestroyed())tray.destroy();}catch{}
  }
  refreshMenu(){
    if(this.disposed||!this.tray||this.tray.isDestroyed())return false;
    const t=this.translate;
    const menu=this.Menu.buildFromTemplate([
      {label:t('Open Ravenshelf'),click:this.onShow},
      {type:'separator'},
      {label:t('Exit Ravenshelf'),click:this.onQuit}
    ]);
    this.tray.setContextMenu(menu);this.tray.setToolTip('Ravenshelf');return true;
  }
  ensureTray(){
    try{
      if(this.tray?.isDestroyed())this.destroyTray();
      if(!this.tray){
        this.tray=new this.Tray(this.icon);
        this.tray.on('click',this.onShow);this.tray.on('double-click',this.onShow);
      }
      if(!this.refreshMenu())throw new Error();
      return true;
    }catch{this.destroyTray();this.show();this.report(MESSAGES.trayUnavailable);return false;}
  }
  background(){
    if(this.quitting||!this.live()||!this.ensureTray())return false;
    this.win.hide();return true;
  }
  requestClose(){
    if(this.quitting||!this.live())return Promise.resolve(false);
    if(this.pending)return this.pending;
    // A promise boundary covers both a thrown dialog error and synchronous
    // repeated close events before Electron returns the native-dialog promise.
    const pending=Promise.resolve().then(()=>this.chooseClose()).catch(()=>{
      if(!this.quitting&&this.live()){this.show();this.report(MESSAGES.promptFailed);}return false;
    }).finally(()=>{if(this.pending===pending)this.pending=null;});
    this.pending=pending;return pending;
  }
  async chooseClose(){
    if(this.quitting||!this.live())return false;
    const behavior=closeBehavior(this.getSettings()?.closeBehavior);
    if(behavior==='background')return this.background();
    if(behavior==='quit')return this.quit();
    const controller=new AbortController();this.promptAbort=controller;
    const t=this.translate;
    let result;
    try{
      result=await this.dialog.showMessageBox(this.win,{
        type:'question',title:'Ravenshelf',message:t('What should Ravenshelf do when you close this window?'),
        detail:t('Keep running to continue downloads and receive files from your browser, or exit Ravenshelf. Browser requests waiting for review are forgotten on exit. Choose Download first to keep them in your queue.'),
        buttons:[t('Keep running in background'),t('Exit Ravenshelf'),t('Cancel')],
        defaultId:0,cancelId:2,noLink:true,checkboxLabel:t('Remember my choice'),checkboxChecked:false,signal:controller.signal
      });
    }finally{if(this.promptAbort===controller)this.promptAbort=null;}
    // A real quit wins over any late response, including a remembered choice.
    if(controller.signal.aborted||this.quitting||!this.live()||![0,1].includes(result?.response))return false;
    const selected=result.response===0?'background':'quit';
    // Do not remember background behavior if its only way back cannot be made.
    if(selected==='background'&&!this.ensureTray())return false;
    if(result.checkboxChecked===true){
      try{if(await this.saveSettings({closeBehavior:selected})===false)throw new Error();}
      catch{if(!this.quitting&&this.live()){this.show();this.report(MESSAGES.saveFailed);}return false;}
    }
    if(this.quitting||!this.live())return false;
    return selected==='background'?this.background():this.quit();
  }
  beginQuit(){
    this.quitting=true;this.promptAbort?.abort();
  }
  quit(){
    if(this.disposed)return false;
    this.beginQuit();this.app.quit();return true;
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.beginQuit();
    this.win.removeListener('close',this.onClose);this.win.removeListener('closed',this.onClosed);
    this.app.removeListener('before-quit',this.onBeforeQuit);this.destroyTray();
  }
}

// Every service gets its cleanup attempt even when an earlier one fails.
// Installing a previously verified, approved update is allowed only after all
// preceding shutdown steps succeeded; ordinary background hiding never calls it.
async function shutdownServices({manager,browserIntegration,media,torrents,features}={}){
  let failed=false;
  // Closing intake is synchronous: a slow download checkpoint must not allow
  // another browser file to be handed to a review that is about to disappear.
  try{browserIntegration?.beginQuit?.();}catch{failed=true;}
  for(const [service,method]of [[manager,'stop'],[browserIntegration,'beforeQuit'],[media,'beforeQuit'],[torrents,'beforeQuit']]){
    try{await service?.[method]?.();}catch{failed=true;}
  }
  try{await features?.beforeQuit?.({install:!failed});}catch{failed=true;}
  if(failed)throw new Error(MESSAGES.shutdown);
}

module.exports={AppLifecycle,closeBehavior,CLOSE_BEHAVIORS,MESSAGES,shutdownServices};
