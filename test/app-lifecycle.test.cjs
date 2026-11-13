'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {AppLifecycle,closeBehavior,CLOSE_BEHAVIORS,MESSAGES,shutdownServices}=require('../src/app-lifecycle.cjs');
const turn=()=>new Promise(setImmediate);
function fixture(t,{behavior,failTray,failSave=false,ignoreAbort=false,save}={}){
  const calls=[],errors=[],dialogs=[],trays=[],settings={closeBehavior:behavior};
  const app=new EventEmitter();app.quit=()=>{calls.push('quit');app.emit('before-quit');};
  const win=new EventEmitter();let destroyed=false,minimized=false,visible=true;
  Object.assign(win,{isDestroyed:()=>destroyed,isMinimized:()=>minimized,
    restore:()=>{calls.push('restore');minimized=false;},show:()=>{calls.push('show');visible=true;},focus:()=>calls.push('focus'),hide:()=>{calls.push('hide');visible=false;}});
  class Tray extends EventEmitter{
    constructor(icon){super();if(failTray==='constructor')throw new Error('private diagnostic');this.icon=icon;this.destroyed=false;trays.push(this);calls.push('tray');}
    isDestroyed(){return this.destroyed;}
    setContextMenu(menu){if(failTray==='menu')throw new Error('private diagnostic');this.menu=menu;calls.push('menu');}
    setToolTip(value){this.tooltip=value;}
    destroy(){this.destroyed=true;calls.push('destroyTray');}
  }
  const Menu={buildFromTemplate:items=>items};
  const dialog={showMessageBox:(parent,options)=>new Promise(resolve=>{
    const done=result=>{options.signal.removeEventListener('abort',abort);resolve(result);};
    const abort=()=>{if(!ignoreAbort)done({response:2,checkboxChecked:false});};
    dialogs.push({parent,options,answer:done});options.signal.addEventListener('abort',abort,{once:true});
  })};
  const lifecycle=new AppLifecycle({app,win,Tray,Menu,dialog,icon:'fixture.ico',getSettings:()=>settings,
    saveSettings:async patch=>{calls.push('save');if(failSave)throw new Error('private saved-path failure');if(save)await save(patch);Object.assign(settings,patch);},
    onError:error=>errors.push(error.message)});
  t.after(()=>lifecycle.dispose());
  return {lifecycle,app,win,calls,errors,dialogs,trays,settings,visible:()=>visible,minimize:()=>{minimized=true;},destroy:()=>{destroyed=true;win.emit('closed');}};
}

test('closing preference accepts only the three choices and defaults to asking',()=>{
  assert.deepEqual(CLOSE_BEHAVIORS,['ask','background','quit']);
  for(const value of [undefined,null,'exit','other',{},0])assert.equal(closeBehavior(value),'ask');
  for(const value of CLOSE_BEHAVIORS)assert.equal(closeBehavior(value),value);
});

test('repeated close events share one native prompt; Cancel leaves everything running and visible',async t=>{
  const f=fixture(t);let prevented=0;
  f.win.emit('close',{preventDefault:()=>prevented++});
  const pending=f.lifecycle.requestClose();assert.equal(f.lifecycle.requestClose(),pending);
  f.win.emit('close',{preventDefault:()=>prevented++});await turn();
  assert.equal(prevented,2);assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].parent,f.win);
  assert.equal(f.dialogs[0].options.cancelId,2);assert.equal(f.dialogs[0].options.checkboxChecked,false);
  f.dialogs[0].answer({response:2,checkboxChecked:true});assert.equal(await pending,false);
  assert.equal(f.visible(),true);assert.deepEqual(f.calls,[]);assert.equal(f.settings.closeBehavior,undefined);
});

test('background mode creates a working tray before hiding and never invokes quit or service cleanup',async t=>{
  const f=fixture(t,{behavior:'background'});assert.equal(await f.lifecycle.requestClose(),true);
  assert.deepEqual(f.calls,['tray','menu','hide']);assert.equal(f.visible(),false);assert.equal(f.dialogs.length,0);
  assert.deepEqual(f.trays[0].menu.filter(item=>item.label).map(item=>item.label),['Open Ravenshelf','Exit Ravenshelf']);
  f.minimize();f.trays[0].emit('click');assert.equal(f.visible(),true);assert.deepEqual(f.calls.slice(-3),['restore','show','focus']);
  f.lifecycle.background();f.trays[0].emit('double-click');assert.equal(f.visible(),true);assert.equal(f.trays.length,1);
  f.lifecycle.background();f.trays[0].menu[0].click();assert.equal(f.visible(),true);
  assert.ok(!f.calls.includes('quit'));
});

test('the close choice is remembered only when explicitly checked',async t=>{
  const f=fixture(t),first=f.lifecycle.requestClose();await turn();
  f.dialogs[0].answer({response:0,checkboxChecked:false});await first;
  assert.equal(f.settings.closeBehavior,undefined);assert.equal(f.calls.includes('save'),false);
  f.lifecycle.show();const second=f.lifecycle.requestClose();await turn();
  f.dialogs[1].answer({response:0,checkboxChecked:true});await second;
  assert.equal(f.settings.closeBehavior,'background');assert.equal(f.calls.filter(value=>value==='save').length,1);
  f.lifecycle.show();await f.lifecycle.requestClose();assert.equal(f.dialogs.length,2);
});

test('remembered Exit uses quit, and explicit tray or app exit bypasses background behavior',async t=>{
  const ask=fixture(t),pending=ask.lifecycle.requestClose();await turn();ask.dialogs[0].answer({response:1,checkboxChecked:true});await pending;
  assert.equal(ask.settings.closeBehavior,'quit');assert.equal(ask.calls.at(-1),'quit');assert.equal(ask.trays.length,0);
  const tray=fixture(t,{behavior:'background'});await tray.lifecycle.requestClose();tray.trays[0].menu[2].click();assert.equal(tray.calls.at(-1),'quit');
  let prevented=false;tray.win.emit('close',{preventDefault:()=>{prevented=true;}});assert.equal(prevented,false);
  const external=fixture(t,{behavior:'background'});external.app.quit();external.win.emit('close',{preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,false);assert.equal(external.trays.length,0);assert.equal(external.dialogs.length,0);
});

test('tray failures keep the window visible and never save a background preference',async t=>{
  for(const failTray of ['constructor','menu']){
    const f=fixture(t,{failTray}),pending=f.lifecycle.requestClose();await turn();f.dialogs[0].answer({response:0,checkboxChecked:true});
    assert.equal(await pending,false);assert.equal(f.visible(),true);assert.equal(f.settings.closeBehavior,undefined);
    assert.ok(!f.calls.includes('hide')&&!f.calls.includes('save'));assert.deepEqual(f.errors,[MESSAGES.trayUnavailable]);
    assert.ok(f.trays.every(tray=>tray.destroyed));
  }
});

test('a failed remembered-choice save keeps the window open for either choice',async t=>{
  for(const response of [0,1]){
    const f=fixture(t,{failSave:true}),pending=f.lifecycle.requestClose();await turn();f.dialogs[0].answer({response,checkboxChecked:true});
    assert.equal(await pending,false);assert.equal(f.visible(),true);assert.equal(f.settings.closeBehavior,undefined);
    assert.ok(!f.calls.includes('hide')&&!f.calls.includes('quit'));assert.deepEqual(f.errors,[MESSAGES.saveFailed]);
  }
});

test('quitting aborts the prompt and ignores even a late remembered background answer',async t=>{
  const f=fixture(t,{ignoreAbort:true}),pending=f.lifecycle.requestClose();await turn();
  f.app.quit();assert.equal(f.dialogs[0].options.signal.aborted,true);
  f.dialogs[0].answer({response:0,checkboxChecked:true});assert.equal(await pending,false);
  assert.equal(f.trays.length,0);assert.equal(f.settings.closeBehavior,undefined);assert.deepEqual(f.calls,['quit']);
  assert.equal(f.lifecycle.show(),false);assert.equal(f.lifecycle.background(),false);
});

test('a quit during a pending save cannot later hide or restart the window',async t=>{
  let finish;const f=fixture(t,{save:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=f.lifecycle.requestClose();await turn();f.dialogs[0].answer({response:0,checkboxChecked:true});await turn();
  f.lifecycle.quit();finish();assert.equal(await pending,false);assert.ok(!f.calls.includes('hide'));assert.equal(f.calls.at(-1),'quit');
});

test('tray labels refresh with the language and disposal removes listeners and aborts prompts',async t=>{
  const f=fixture(t,{behavior:'background'});await f.lifecycle.requestClose();
  f.lifecycle.translate=value=>'translated: '+value;f.lifecycle.refreshMenu();assert.equal(f.trays[0].menu[0].label,'translated: Open Ravenshelf');
  f.lifecycle.dispose();f.lifecycle.dispose();assert.equal(f.calls.filter(value=>value==='destroyTray').length,1);
  assert.equal(f.win.listenerCount('close'),0);assert.equal(f.win.listenerCount('closed'),0);assert.equal(f.app.listenerCount('before-quit'),0);
  assert.equal(f.trays[0].listenerCount('click'),0);assert.equal(f.trays[0].listenerCount('double-click'),0);
  const asking=fixture(t),pending=asking.lifecycle.requestClose();await turn();asking.lifecycle.dispose();assert.equal(await pending,false);assert.equal(asking.dialogs[0].options.signal.aborted,true);
});

test('shutdown waits for downloads first and checks updates only after every service is stopped',async()=>{
  const calls=[];let stop;
  const pending=shutdownServices({manager:{stop:()=>{calls.push('manager');return new Promise(resolve=>{stop=resolve;});}},
    browserIntegration:{beforeQuit:()=>calls.push('browser')},media:{beforeQuit:()=>calls.push('media')},torrents:{beforeQuit:()=>calls.push('torrents')},
    features:{beforeQuit:options=>calls.push(['features',options])}});
  await turn();assert.deepEqual(calls,['manager']);stop();await pending;
  assert.deepEqual(calls,['manager','browser','media','torrents',['features',{install:true}]]);
});

test('every shutdown cleanup is attempted after a failure and update installation is skipped',async()=>{
  for(const failed of ['manager','browser','media','torrents','features']){
    const calls=[],work=name=>{calls.push(name);if(name===failed)throw new Error('private helper details');};
    let install;
    await assert.rejects(shutdownServices({manager:{stop:()=>work('manager')},browserIntegration:{beforeQuit:()=>work('browser')},media:{beforeQuit:()=>work('media')},torrents:{beforeQuit:()=>work('torrents')},
      features:{beforeQuit:options=>{install=options.install;work('features');}}}),{message:MESSAGES.shutdown});
    assert.deepEqual(calls,['manager','browser','media','torrents','features']);assert.equal(install,failed==='features');
  }
  await shutdownServices();
});
