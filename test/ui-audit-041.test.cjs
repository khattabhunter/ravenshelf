'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(api={}){
  const nodes=new Map(),lists=new Map(),accent=new Map();
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this._text='';this.className='';this.open=false;this.isConnected=true;this.disabled=false;this.checked=false;this.value='';this.hidden=false;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;this._text='';}remove(){this.isConnected=false;}before(){}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    addEventListener(name,listener){const listeners=this.events.get(name)||[];listeners.push(listener);this.events.set(name,listeners);}async emit(name,event={}){for(const listener of this.events.get(name)||[])await listener(event);}
    showModal(){this.open=true;}close(){this.open=false;for(const listener of this.events.get('close')||[])listener({});}focus(){this.focused=true;}contains(){return false;}querySelector(selector){return get(selector);}querySelectorAll(selector){return lists.get(selector)||[];}getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
  }
  function get(selector){if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);}
  const document={querySelector:get,querySelectorAll:selector=>lists.get(selector)||[],createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},documentElement:{style:{setProperty:(key,value)=>accent.set(key,value)}}};
  const context=vm.createContext({window:{atlas:api},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=code=>vm.runInContext(code,context);run('toast=()=>{};');
  const all=root=>[root,...root.children.flatMap(all)];
  return {get,lists,document,context,run,accent,Element,all};
}

test('Check space coalesces clicks and explains missing queue files and readonly archives outside the queue',async()=>{
  let resolve,calls=0;const f=fixture({getStorageSummary:()=>{calls++;return new Promise(done=>{resolve=done;});}});f.run('wireFeatureEvents()');
  const button=f.get('#refresh-storage'),first=button.emit('click');f.run('refreshStorage()');assert.equal(button.disabled,true);assert.equal(button.textContent,'Checking…');await flush();assert.equal(calls,1);
  resolve({completedBytes:100,partialBytes:50,totalBytes:150,trackedBytes:150,untrackedBytes:300,libraryBytes:450,items:[],missingItems:[{id:'missing',name:'missing.rar',message:'File not found.'}],untrackedItems:[{name:'outside.rar',relativePath:'folder/outside.rar',bytes:300,deletable:false}],warnings:[],scan:{status:'complete'}});await first;
  assert.equal(button.disabled,false);assert.equal(button.textContent,'Check space');assert.match(f.get('#storage-summary').textContent,/450 B found.*150 B managed.*300 B other/);assert.match(f.get('#storage-checked-at').textContent,/Checked/);
  const details=f.get('#storage-details');assert.match(details.textContent,/missing files.*missing.rar/);assert.match(details.textContent,/cannot be deleted through queue cleanup.*folder\/outside.rar/);assert.equal(f.all(details).filter(node=>['button','input'].includes(node.tagName)).length,0);
  assert.ok(Math.abs(parseFloat(f.get('#storage-other-fill').style.width)-66.6667)<0.001);
});

test('incomplete storage totals are labeled and a failed check clears stale bars then permits retry',async()=>{
  let fail=false,calls=0;const f=fixture({getStorageSummary:()=>{calls++;if(fail)throw new Error('private internal detail');return {completedBytes:10,partialBytes:0,totalBytes:10,scan:{status:'partial'},warnings:['The folder limit was reached.'],items:[]};}});
  await f.run('refreshStorage()');assert.match(f.get('#storage-summary').textContent,/At least 10 B/);assert.match(f.get('#storage-details').textContent,/incomplete.*folder limit/);
  fail=true;await f.run('refreshStorage()');assert.match(f.get('#storage-summary').textContent,/could not be checked/);assert.doesNotMatch(f.get('#storage-summary').textContent,/private internal/);assert.equal(f.get('#storage-completed-fill').style.width,'0%');assert.equal(f.get('#refresh-storage').disabled,false);
  fail=false;await f.run('refreshStorage()');assert.equal(calls,3);assert.match(f.get('#storage-summary').textContent,/At least 10 B/);
});

test('unrelated state refreshes preserve unsaved speed and schedule edits after focus moves',async()=>{
  const f=fixture();f.run('wireFeatureEvents()');f.get('#speed-limit').value='3.25';await f.get('#speed-limit-form').emit('input');f.get('#schedule-start').value='22:15';await f.get('#schedule-form').emit('change');f.document.activeElement=f.get('#notifications-enabled');
  f.run('state.settings.maxDownloadBytesPerSecond=1048576;state.settings.downloadSchedule={enabled:false,start:"00:00",end:"00:00",days:[1]};renderFeatureSettings()');
  assert.equal(f.get('#speed-limit').value,'3.25');assert.equal(f.get('#schedule-start').value,'22:15');
});

test('editing a form during its pending save preserves the newer edit',async()=>{
  let resolve;const f=fixture({saveSettings:()=>new Promise(done=>{resolve=done;})});f.run('wireFeatureEvents();applyState=next=>{state.settings={...state.settings,...next.settings};};');
  f.get('#speed-limit').value='3.25';await f.get('#speed-limit-form').emit('input');const saved=f.run('saveFeatureSetting({maxDownloadBytesPerSecond:3407872})');
  f.get('#speed-limit').value='4.5';await f.get('#speed-limit-form').emit('input');resolve({settings:{maxDownloadBytesPerSecond:3407872}});await saved;
  assert.equal(f.get('#speed-limit').value,'4.5');assert.equal(f.run('state.settings.maxDownloadBytesPerSecond'),3407872);
});

test('a failed focused toggle restores the actual saved preference',async()=>{
  const f=fixture({saveSettings:async()=>{throw new Error('Save failed.');}});f.run('state.settings.clipboardWatchEnabled=false');const control=f.get('#clipboard-watch-enabled');control.checked=true;f.document.activeElement=control;f.context.control=control;
  await f.run('saveFeatureSetting({clipboardWatchEnabled:true},control)');assert.equal(control.checked,false);assert.equal(control.disabled,false);assert.equal(f.run('state.settings.clipboardWatchEnabled'),false);
});

test('an old dialog close event cannot invalidate a newly opened removal preview or lightbox',async()=>{
  let serial=0,batch;const f=fixture({previewDownloadRemoval:async({ids})=>({items:ids.map(id=>({id,name:id+'.rar',bytes:1})),totalBytes:1,warnings:[],token:'token-'+(++serial)}),removeDownloads:async value=>{batch=value;return {removedIds:value.ids,errors:[]};},getState:async()=>({})});
  f.run('wireFeatureEvents();applyState=()=>{};refreshStorage=()=>{};');await f.run("openDownloadRemoval(['first'])");f.get('#removal-dialog').open=false;await f.run("openDownloadRemoval(['second'])");await f.get('#removal-dialog').emit('close');await f.run('confirmDownloadRemoval()');assert.equal(batch.token,'token-2');assert.deepEqual(Array.from(batch.ids),['second']);
  f.run("openLightbox(['https://images.example/first.png'],0,'First')");f.get('#image-dialog').open=false;f.run("openLightbox(['https://images.example/second.png'],0,'Second');restoreLightboxFocus()");assert.equal(f.get('#image-dialog').open,true);assert.match(f.get('#lightbox-image').src,/second.png/);assert.equal(f.run('lightboxItems.length'),1);
});

test('unsupported updater builds do not offer a check button that cannot perform an update',()=>{
  const f=fixture({checkForUpdates(){}});f.run("state.updater={phase:'unavailable'};renderUpdater()");assert.equal(f.get('#check-app-updates').disabled,true);assert.match(f.get('#update-status').textContent,/not available/);
});

