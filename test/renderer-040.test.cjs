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
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=code=>vm.runInContext(code,context);run('toast=()=>{};');
  const all=root=>[root,...root.children.flatMap(all)];
  return {get,lists,document,context,run,accent,Element,all};
}

test('review stars require real positive and total counts and requirements stay plain text',async()=>{
  const f=fixture({getGameMetadata:async()=>({source:'Steam',sourceUrl:'https://store.steampowered.com/app/123/',reviews:{positive:90,total:100,description:'Very Positive'},requirements:{minimum:'OS: Windows\n<img src=x onerror=bad()>',recommended:'RAM: 16 GB'}})});
  const summary=f.run('steamReviewSummary({positive:90,total:100})');assert.equal(summary.stars,4.5);assert.equal(summary.percent,90);
  for(const value of ['{stars:5,score:100}','{positive:1,total:0}','{positive:101,total:100}','{positive:"90",total:100}'])assert.equal(f.run('steamReviewSummary('+value+')'),null);
  f.context.container=new f.Element();await f.run("loadGameMetadata({title:'Game',steamAppId:123},container)");
  assert.match(f.context.container.textContent,/90% positive.*100 reviews/);
  const requirement=f.all(f.context.container).find(node=>node.textContent==='OS: Windows\n<img src=x onerror=bad()>');assert.ok(requirement);assert.equal(requirement.innerHTML,undefined);
});

test('an unmatched game shows review unavailability instead of invented stars',async()=>{
  const f=fixture({getGameMetadata:async()=>({source:'unknown',reviews:{positive:10,total:10},requirements:{}})});f.context.container=new f.Element();await f.run("loadGameMetadata({title:'Unknown'},container)");
  assert.match(f.context.container.textContent,/reviews are unavailable/);assert.doesNotMatch(f.context.container.textContent,/5\.0 \/ 5/);
});

test('lightbox uses checked images, wraps keyboard navigation and restores the opener',()=>{
  const f=fixture(),opener=new f.Element('button');f.context.opener=opener;
  f.run("openLightbox(['https://images.example/one.png','https://images.example/two.png'],0,'Game',opener)");
  assert.equal(f.get('#image-dialog').open,true);assert.match(f.get('#lightbox-image').src,/atlas:\/\/app\/image/);
  f.context.event={key:'ArrowLeft',preventDefault(){this.prevented=true;}};f.run('lightboxKey(event)');assert.match(f.get('#lightbox-image').src,/two.png/);assert.equal(f.context.event.prevented,true);
  f.context.event.key='ArrowRight';f.run('lightboxKey(event)');assert.match(f.get('#lightbox-image').src,/one.png/);
  f.context.event.key='Escape';f.run('lightboxKey(event);restoreLightboxFocus()');assert.equal(f.get('#image-dialog').open,false);assert.equal(opener.focused,true);
  assert.equal(f.run("trustedImage('javascript:alert(1)')"),'');assert.equal(f.run("trustedImage('https://user:secret@images.example/a.png')"),'');
});

test('cover accents maintain readable contrast and the opt-out avoids artwork processing',()=>{
  const f=fixture();for(const input of [[0,0,0],[8,25,40],[220,20,25],[0,80,0],[255,255,255]]){f.context.color=input;const ratio=f.run('(luminance(readableAccent(color))+0.05)/(luminance([16,18,28])+0.05)');assert.ok(ratio>=4.5);}
  f.run('state.settings.adaptiveThemeEnabled=false;applyCoverAccent({})');assert.equal(f.accent.get('--game-accent'),'rgb(185, 160, 236)');
});

test('RiotPixels lightbox uses the full image with one fallback while unrelated hosts keep their exact URL',()=>{
  const f=fixture();f.run("openLightbox(['https://images.riotpixels.net/shot.jpg.240p.jpg?image=1'],0,'Game')");
  const image=f.get('#lightbox-image');assert.equal(new URL(image.src).searchParams.get('url'),'https://images.riotpixels.net/shot.jpg?image=1');
  image.onerror();assert.equal(new URL(image.src).searchParams.get('url'),'https://images.riotpixels.net/shot.jpg.240p.jpg?image=1');const fallback=image.src;image.onerror();assert.equal(image.src,fallback);
  const unchanged=f.run("enlargedImage('https://other.example/shot.jpg.240p.jpg')");assert.equal(new URL(unchanged).searchParams.get('url'),'https://other.example/shot.jpg.240p.jpg');
});

test('local suggestions require genre evidence and exclude already saved games',()=>{
  const f=fixture();f.context.games=[{title:'Liked',url:'liked',genres:'RPG'},{title:'New RPG',url:'new',genres:'RPG, Action'},{title:'Racer',url:'racing',genres:'Racing'}];
  assert.equal(f.run('personalSuggestions(games,{favorites:[]},[]).length'),0);
  const items=f.run('personalSuggestions(games,{favorites:[games[0]]},[])');assert.equal(items.length,1);assert.equal(items[0].game.url,'new');assert.equal(items[0].matches[0],'rpg');
});

test('deletion always defaults to keeping files and requires an explicit fresh destructive confirmation',async()=>{
  const calls=[];
  const f=fixture({previewDownloadRemoval:async({ids})=>({items:ids.map(id=>({id,name:id+'.rar',bytes:1024})),totalBytes:1024,warnings:['Active downloads were paused for review.'],token:'preview-token'}),removeDownloads:async value=>{calls.push(value);return {removedIds:value.ids,errors:[]};},getState:async()=>({settings:{}})});
  f.run('applyState=()=>{};refreshStorage=async()=>{};renderDownloadSelection=()=>{};');
  await f.run("openDownloadRemoval(['a'])");assert.equal(f.get('input[name="removal-mode"][value="list"]').checked,true);assert.match(f.get('#removal-summary').textContent,/Estimated space/);assert.match(f.get('#removal-warnings').textContent,/paused/);
  f.get('input[name="removal-mode"][value="files"]').checked=true;f.get('input[name="removal-mode"][value="list"]').checked=false;f.run('syncRemovalChoice()');assert.equal(f.get('#confirm-removal').disabled,true);
  await f.run('confirmDownloadRemoval()');assert.equal(calls.length,0);
  f.get('#removal-confirm-files').checked=true;await f.run('confirmDownloadRemoval()');assert.equal(calls[0].mode,'files');assert.equal(calls[0].token,'preview-token');
  await f.run("openDownloadRemoval(['b'])");assert.equal(f.get('input[name="removal-mode"][value="list"]').checked,true);assert.equal(f.get('#removal-confirm-files').checked,false);await f.run('confirmDownloadRemoval()');assert.equal(calls[1].mode,'list');
});

test('partial removal failures remain visible and require a new preview for only remaining entries',async()=>{
  const f=fixture({previewDownloadRemoval:async()=>({items:[{id:'a',name:'a.rar'},{id:'b',name:'b.rar'}],totalBytes:20,warnings:[],token:'token'}),removeDownloads:async()=>({removedIds:['a'],errors:[{id:'b',message:'The file is in use.'}]}),getState:async()=>({})});
  f.run('applyState=()=>{};refreshStorage=async()=>{};renderDownloadSelection=()=>{};');await f.run("openDownloadRemoval(['a','b']);");await f.run('confirmDownloadRemoval()');
  assert.equal(f.get('#removal-dialog').open,true);assert.match(f.get('#removal-error').textContent,/file is in use/);assert.equal(f.get('#confirm-removal').disabled,true);assert.deepEqual(JSON.parse(f.get('#removal-dialog').dataset.ids),['b']);
});

test('verification completion highlights mismatched and missing files instead of claiming all files passed',()=>{
  const f=fixture();f.run("verificationState={phase:'completed',completed:3,total:3,results:[{name:'one',status:'match'},{name:'two',status:'mismatch'},{name:'three',status:'missing'}]};renderVerification()");
  assert.match(f.get('#verification-status').textContent,/Some files need attention.*1 matched.*1 mismatched.*1 missing/);assert.equal(f.get('#verification-status').className,'verification-warning');assert.equal(f.get('#verification-results').children.length,3);
});

test('update restart waits for an idle queue and completed verification',()=>{
  const f=fixture({checkForUpdates(){},installUpdate(){}});f.run("state.updater={phase:'ready',availableVersion:'0.4.1'};state.downloads=[{id:'x',status:'downloading'}];renderUpdater()");assert.equal(f.get('#install-app-update').disabled,true);
  f.run("state.downloads=[];verificationState={phase:'verifying'};renderUpdater()");assert.equal(f.get('#install-app-update').disabled,true);
  f.run("verificationState={phase:'completed'};renderUpdater()");assert.equal(f.get('#install-app-update').disabled,false);assert.match(f.get('#update-status').textContent,/installs when you close/);
});

test('a found update offers Download and install, and release notes only for the exact release page',()=>{
  const f=fixture({checkForUpdates(){},downloadUpdate(){},installUpdate(){},openExternal(){}});
  const page='https://github.com/khattabhunter/ravenshelf/releases/tag/v0.4.2';
  f.context.page=page;f.run("state.updater={phase:'available',availableVersion:'0.4.2',releaseUrl:page,message:'Ravenshelf 0.4.2 is available. Nothing is downloaded until you choose Download and install.'};renderUpdater()");
  assert.equal(f.get('#download-app-update').hidden,false);assert.equal(f.get('#download-app-update').disabled,false);assert.equal(f.get('#app-update-notes').hidden,false);assert.equal(f.get('#install-app-update').hidden,true);assert.equal(f.get('#check-app-updates').disabled,false);
  assert.equal(f.get('#update-status').textContent,'Ravenshelf 0.4.2 is available. Nothing is downloaded until you choose Download and install.','the version is not repeated');
  for(const url of ['https://github.com/khattabhunter/ravenshelf/releases/tag/v0.4.2/../../evil','https://github.com/other/ravenshelf/releases/tag/v0.4.2','http://github.com/khattabhunter/ravenshelf/releases/tag/v0.4.2','javascript:alert(1)',''])
    {f.context.url=url;f.run("state.updater={...state.updater,releaseUrl:url};renderUpdater()");assert.equal(f.get('#app-update-notes').hidden,true,url);}
  f.run("state.updater={phase:'verifying',availableVersion:'0.4.2',releaseUrl:page};renderUpdater()");
  assert.equal(f.get('#download-app-update').hidden,true);assert.equal(f.get('#check-app-updates').disabled,true);assert.equal(f.get('#app-update-notes').hidden,false);assert.match(f.get('#update-status').textContent,/signed build record.*Version 0\.4\.2\./);
  for(const phase of ['idle','checking','current','error','unavailable']){f.context.phase=phase;f.run("state.updater={phase,releaseUrl:page};renderUpdater()");assert.equal(f.get('#download-app-update').hidden,true,phase);assert.equal(f.get('#app-update-notes').hidden,!['available','verifying','downloading','ready'].includes(phase),phase);}
  const old=fixture({checkForUpdates(){}});old.run("state.updater={phase:'available',availableVersion:'0.4.2'};renderUpdater()");assert.equal(old.get('#download-app-update').disabled,true,'an older preload without the action cannot offer it');
});

test('Download and install and What’s new call only their own actions',async()=>{
  const calls=[],toasts=[];const page='https://github.com/khattabhunter/ravenshelf/releases/tag/v0.4.2';
  const f=fixture({downloadUpdate:async()=>{calls.push('download');return {phase:'ready',availableVersion:'0.4.2',installApproved:true,releaseUrl:page,message:'Update verified. It installs when you close Ravenshelf, or choose Restart now.'};},openExternal:async url=>{calls.push(url);},installUpdate:async()=>{calls.push('install');},checkForUpdates:async()=>{calls.push('check');}});
  f.run('applyState=()=>{};renderFeatureSettings=()=>{};renderDownloadSelection=()=>{};wireFeatureEvents()');f.context.toasts=toasts;f.run('toast=(message,error)=>toasts.push([message,error])');
  f.context.page=page;f.run("state.updater={phase:'available',availableVersion:'0.4.2',releaseUrl:page};renderUpdater()");
  await f.get('#app-update-notes').emit('click');await flush();assert.deepEqual(calls,[page]);
  await f.get('#download-app-update').emit('click');await flush();assert.deepEqual(calls,[page,'download']);
  assert.equal(f.get('#install-app-update').hidden,false);assert.match(f.get('#update-status').textContent,/installs when you close Ravenshelf/);
  f.run("state.updater={...state.updater,releaseUrl:'https://evil.example/'}");await f.get('#app-update-notes').emit('click');await flush();assert.deepEqual(calls,[page,'download'],'an unexpected address is never opened');
  const failing=fixture({downloadUpdate:async()=>{throw new Error("Error invoking remote method 'atlas:downloadUpdate': Error: The update could not be downloaded. Your current app is unchanged.");}});
  failing.run('applyState=()=>{};renderFeatureSettings=()=>{};renderDownloadSelection=()=>{};wireFeatureEvents()');failing.context.toasts=toasts;failing.run('toast=(message,error)=>toasts.push([message,error])');
  failing.run("state.updater={phase:'available',availableVersion:'0.4.2'};renderUpdater()");await failing.get('#download-app-update').emit('click');await flush();
  // Arrays built inside the renderer context have that context's prototypes.
  assert.equal(JSON.stringify(toasts),JSON.stringify([['The update could not be downloaded. Your current app is unchanged.',true]]));assert.equal(failing.get('#download-app-update').disabled,false,'the button is usable again after a failure');
});

test('the updater fraction is shown on the progress bar percentage scale',()=>{
  const f=fixture();f.run("state.updater={phase:'downloading',progress:0.42};renderUpdater()");
  assert.equal(f.get('#update-progress').hidden,false);assert.equal(f.get('#update-progress').value,42);
  f.run("state.updater={phase:'downloading',progress:1};renderUpdater()");assert.equal(f.get('#update-progress').value,100);
});

test('bandwidth, schedule and preference controls save only their own fields and validate enabled days',async()=>{
  const patches=[];const f=fixture({saveSettings:async patch=>{patches.push(patch);return {settings:patch};}});f.run('applyState=()=>{};renderFeatureSettings=()=>{};renderDownloadSelection=()=>{};wireFeatureEvents()');
  f.get('#speed-limit').value='2.5';f.get('#speed-unit').value='1048576';await f.get('#speed-limit-form').emit('submit',{preventDefault(){}});await flush();assert.deepEqual(Object.keys(patches[0]),['maxDownloadBytesPerSecond']);assert.equal(patches[0].maxDownloadBytesPerSecond,2621440);
  f.get('#schedule-enabled').checked=true;f.get('#schedule-start').value='22:00';f.get('#schedule-end').value='06:00';assert.throws(()=>f.run('scheduleFromForm()'),/Select at least one day/);
  const day=new f.Element('input');day.value='5';day.checked=true;f.lists.set('#schedule-form .schedule-days input',[day]);await f.get('#schedule-form').emit('submit',{preventDefault(){}});await flush();assert.deepEqual(Object.keys(patches[1]),['downloadSchedule']);assert.equal(patches[1].downloadSchedule.start,'22:00');assert.deepEqual(Array.from(patches[1].downloadSchedule.days),[5]);
  const control=f.get('#clipboard-watch-enabled');control.checked=true;await control.emit('change',{target:control});await flush();assert.deepEqual(Object.keys(patches[2]),['clipboardWatchEnabled']);assert.equal(patches[2].clipboardWatchEnabled,true);
});

test('archive errors require fresh explicit confirmation and only ready files enter validation and the queue',async()=>{
  const validations=[],batches=[];
  const ready={status:'ready',sourceUrl:'https://files.example/game.part01.rar',url:'https://files.example/game.part01.rar',filename:'game.part01.rar'};
  const manual={status:'manual',sourceUrl:'https://files.example/game.part02.rar',filename:'game.part02.rar'};
  const f=fixture({expandLinks:async()=>({links:[ready.sourceUrl,manual.sourceUrl]}),checkLinks:async()=>[ready,manual],validateArchiveSet:async input=>{validations.push(input);return {errors:['The archive is missing part 2.'],warnings:[]};},addDownloads:async payload=>{batches.push(payload);return {added:1};},getState:async()=>({})});
  f.run('applyState=()=>{};showView=()=>{};');f.context.container=new f.Element();
  await f.run("inspectLinks('links',container,'Game')");assert.deepEqual(Array.from(validations[0].sourceUrls),[ready.sourceUrl]);
  let all=f.all(f.context.container),download=all.find(node=>node.tagName==='button'&&node.textContent==='Download 1 ready file'),confirmation=all.find(node=>node.tagName==='input'&&node.type==='checkbox');
  assert.match(f.context.container.textContent,/missing part 2/);assert.equal(download.disabled,true);await download.emit('click');assert.equal(batches.length,0);
  confirmation.checked=true;await confirmation.emit('change');assert.equal(download.disabled,false);await download.emit('click');assert.equal(batches[0].allowIncomplete,true);assert.equal(batches[0].links.length,1);assert.equal(batches[0].links[0].status,'ready');
  await f.run("inspectLinks('links',container,'Game')");all=f.all(f.context.container);download=all.find(node=>node.tagName==='button'&&node.textContent==='Download 1 ready file');assert.equal(download.disabled,true);
});

test('unknown final archive parts warn without an override, while a failed archive check blocks queueing',async()=>{
  let batch;const f=fixture({addDownloads:async value=>{batch=value;return {added:1};},getState:async()=>({}),validateArchiveSet:async()=>{throw new Error('private path');}});
  f.run('applyState=()=>{};showView=()=>{};');f.context.container=new f.Element();f.context.links=[{status:'ready',url:'https://files.example/game.part01.rar',filename:'game.part01.rar'}];
  f.run("renderCheckedLinks(container,links,[],'Game',{warnings:['The final part cannot be confirmed.'],errors:[]})");
  let download=f.all(f.context.container).find(node=>node.tagName==='button'&&node.textContent==='Download all 1 file');assert.equal(download.disabled,false);await download.emit('click');assert.equal(batch.allowIncomplete,undefined);assert.match(f.context.container.textContent,/final part cannot be confirmed/);
  const result=await f.run('checkArchiveSelection(links)');f.context.preflight=result;f.run("renderCheckedLinks(container,links,[],'Game',preflight)");download=f.all(f.context.container).find(node=>node.tagName==='button'&&node.textContent==='Download all 1 file');assert.equal(download.disabled,true);assert.match(f.context.container.textContent,/archive set could not be checked/);assert.doesNotMatch(f.context.container.textContent,/private path/);
});
