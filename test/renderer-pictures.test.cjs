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

const target=src=>new URL(src).searchParams.get('url');

test('cards try the small thumbnails, then the cover; a favourite with one full-size RiotPixels picture tries its thumbnail first',()=>{
  const f=fixture();
  f.context.game={image:'https://riotpixels.net/data/a/1.jpg',cardImages:['https://riotpixels.net/data/a/1.jpg.240p.jpg','https://riotpixels.net/data/a/2.jpg.240p.jpg','https://i2.imageban.ru/out/a.jpg','https://extra.example/4.jpg']};
  assert.deepEqual([...f.run('cardImageCandidates(game)')].map(target),['https://riotpixels.net/data/a/1.jpg.240p.jpg','https://riotpixels.net/data/a/2.jpg.240p.jpg','https://i2.imageban.ru/out/a.jpg']);
  f.context.game={image:'https://riotpixels.net/data/b/1.jpg'};
  assert.deepEqual([...f.run('cardImageCandidates(game)')].map(target),['https://riotpixels.net/data/b/1.jpg.240p.jpg','https://riotpixels.net/data/b/1.jpg']);
  f.context.game={image:'https://covers.example/c.png'};assert.deepEqual([...f.run('cardImageCandidates(game)')].map(target),['https://covers.example/c.png']);
  f.context.game={image:'http://covers.example/c.png',cardImages:['javascript:alert(1)','https://user:secret@covers.example/x.png',42]};assert.deepEqual([...f.run('cardImageCandidates(game)')],[]);
  f.context.game={image:'https://riotpixels.net/data/a/1.jpg',imageCandidates:['https://riotpixels.net/data/a/1.jpg','https://riotpixels.net/data/a/1.jpg.240p.jpg','https://i2.imageban.ru/out/a.jpg','https://x.example/4.jpg']};
  assert.deepEqual([...f.run('detailImageCandidates(game)')].map(target),['https://riotpixels.net/data/a/1.jpg','https://riotpixels.net/data/a/1.jpg.240p.jpg','https://i2.imageban.ru/out/a.jpg']);
});

test('a card moves to the next picture on each failure, then shows the placeholder, and counts what it showed',async()=>{
  const f=fixture();
  f.context.game={title:'Game',url:'https://fitgirl-repacks.site/game/',cardImages:['https://riotpixels.net/1.jpg.240p.jpg','https://riotpixels.net/2.jpg.240p.jpg','https://i2.imageban.ru/out/c.jpg']};
  const card=f.run('makeGameCard(game)'),image=f.all(card).find(node=>node.tagName==='img');
  assert.equal(image.loading,'lazy');assert.equal(target(image.src),'https://riotpixels.net/1.jpg.240p.jpg');
  await image.emit('error');assert.equal(target(image.src),'https://riotpixels.net/2.jpg.240p.jpg');
  await image.emit('error');assert.equal(target(image.src),'https://i2.imageban.ru/out/c.jpg');
  await image.emit('error');
  assert.equal(image.isConnected,false);assert.ok(f.all(card).some(node=>node.className==='image-placeholder'&&node.textContent==='R'));
  await image.emit('error');assert.equal(target(image.src),'https://i2.imageban.ru/out/c.jpg','nothing more is tried');
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('pictureStats'))),{shown:0,fallbacks:2,placeholders:1});
  const second=f.run('makeGameCard(game)'),shownImage=f.all(second).find(node=>node.tagName==='img');
  await shownImage.emit('error');await shownImage.emit('load');
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('pictureStats'))),{shown:1,fallbacks:3,placeholders:1});
});

test('a card that has left the page never starts another picture request',async()=>{
  const f=fixture();
  f.context.game={title:'Game',cardImages:['https://riotpixels.net/1.jpg.240p.jpg','https://riotpixels.net/2.jpg.240p.jpg']};
  const card=f.run('makeGameCard(game)'),image=f.all(card).find(node=>node.tagName==='img');
  image.isConnected=false;await image.emit('error');
  assert.equal(target(image.src),'https://riotpixels.net/1.jpg.240p.jpg');
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('pictureStats'))),{shown:0,fallbacks:0,placeholders:0});
});

test('Settings shows picture loading as site names and counts only',async()=>{
  const report={since:'2026-11-13T12:00:00.000Z',sites:[{host:'riotpixels.net',counts:{fetches:12,loaded:10,memory:4,cancelled:3,notFound:1,refused:0,tooMany:1,serverError:0,otherStatus:0,timeout:0,dns:0,network:0,notImage:0,tooLarge:0,incomplete:0,blocked:0,cooldown:2,recentFailure:0}},{host:'other sites',counts:{fetches:0,loaded:0,memory:0,cancelled:0,notFound:0,refused:0,tooMany:0,serverError:0,otherStatus:0,timeout:0,dns:5,network:0,notImage:0,tooLarge:0,incomplete:0,blocked:0,cooldown:0,recentFailure:0}}],
    pictures:{failedThenLoaded:1,stillFailing:2,firstFailureAfter:60},pausedSites:[{host:'riotpixels.net',seconds:12}],cache:{pictures:9,bytes:2048,limitBytes:41943040}};
  const f=fixture({imageDiagnostics:async()=>report});
  await f.run('showPictureLoading()');
  const box=f.get('#picture-loading-summary'),text=box.textContent;
  assert.equal(box.hidden,false);
  for(const expected of ['riotpixels.net','Requests sent: 12','Loaded: 10','From memory: 4','Cancelled when leaving a page: 3','Not found (404): 1','Too many requests (429): 1','Skipped while the site is paused: 2','Other sites','Site name not found (DNS): 5','Pictures that failed, then loaded later: 1','Pictures still failing: 2','First failure after 60 pictures loaded.','riotpixels.net asked for a pause: 12 s left.','In this window: 0 shown','Kept in memory: 9'])
    assert.ok(text.includes(expected),expected);
  assert.ok(!text.includes('Refused'),'zero counts are left out');
  const failing=fixture({imageDiagnostics:async()=>{throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');}});
  await failing.run('showPictureLoading()');assert.ok(failing.get('#picture-loading-summary').textContent.length>0);
  const empty=fixture({imageDiagnostics:async()=>({sites:[],pictures:{failedThenLoaded:0,stillFailing:0,firstFailureAfter:null},pausedSites:[],cache:{pictures:0,bytes:0,limitBytes:41943040}})});
  await empty.run('showPictureLoading()');assert.match(empty.get('#picture-loading-summary').textContent,/Nothing loaded yet in this session.*No picture has failed yet/);
});

test('each picture request carries a new number, and pictures that left the page are reported by number',async()=>{
  const reports=[];
  const f=fixture({leavePictures:async numbers=>{reports.push([...numbers]);return numbers.length;}});
  const timers=[];f.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  // The window checks after something leaves the page (a MutationObserver there).
  const runTimers=async()=>{f.run('checkLeftPictures()');while(timers.length){timers.shift().fn();await flush();}};
  f.context.game={title:'Game',image:'https://riotpixels.net/data/a/1.jpg',cardImages:['https://riotpixels.net/1.jpg.240p.jpg','https://riotpixels.net/2.jpg.240p.jpg']};
  const first=f.all(f.run('makeGameCard(game)')).find(node=>node.tagName==='img');
  const second=f.all(f.run('makeGameCard(game)')).find(node=>node.tagName==='img');
  const number=image=>Number(new URL(image.src).searchParams.get('r'));
  const base=number(first);assert.ok(Number.isSafeInteger(base)&&base>=1&&base<=999999999999999);assert.equal(number(second),base+1);assert.equal(target(first.src),'https://riotpixels.net/1.jpg.240p.jpg');
  assert.equal([...new URL(first.src).searchParams.keys()].join(),'url,r','only the picture and its number');
  assert.equal(timers.length,0,'nothing runs while the page stays as it is');
  // The second card's picture fails and moves on: the new request has a new number.
  await second.emit('error');assert.equal(number(second),base+2);assert.equal(second.dataset.picture.includes('2.jpg.240p.jpg'),true);
  // Both cards leave the page before their pictures arrive.
  first.isConnected=false;second.isConnected=false;
  await runTimers();
  assert.deepEqual(reports,[[base,base+2]],'each left picture is reported once, with its current number');
  // A picture that loaded is never reported, and a late load after leaving is not counted as shown.
  const third=f.all(f.run('makeGameCard(game)')).find(node=>node.tagName==='img');
  await third.emit('load');assert.equal(f.run('pictureStats').shown,1);
  third.isConnected=false;await runTimers();assert.deepEqual(reports,[[base,base+2]]);
  const fourth=f.all(f.run('makeGameCard(game)')).find(node=>node.tagName==='img');
  fourth.isConnected=false;await fourth.emit('load');assert.equal(f.run('pictureStats').shown,1,'not shown: it left the page');
  await runTimers();assert.deepEqual(reports,[[base,base+2]],'nothing to cancel once it has loaded');
  assert.equal(f.run('picturesOnPage.size'),0);f.run('checkLeftPictures()');assert.equal(timers.length,0,'no check when no picture is waiting');
});

test('the game page cover opens the lightbox with the picture address, not the numbered request',async()=>{
  const opened=[];
  const f=fixture();f.context.opened=opened;f.run('applyCoverAccent=()=>{};openLightbox=(urls)=>{opened.push(...urls);};');
  f.context.game={title:'Game',url:'https://fitgirl-repacks.site/game/',image:'https://riotpixels.net/data/a/1.jpg',imageCandidates:['https://riotpixels.net/data/a/1.jpg'],screenshots:[]};
  f.run('currentDetail=game;renderGameDetails(game)');
  const content=f.get('#detail-content'),cover=f.all(content).find(node=>node.className==='detail-cover');
  assert.ok(new URL(cover.src).searchParams.has('r'));
  const button=f.all(content).find(node=>node.className==='detail-cover-button');
  await button.emit('click');
  assert.equal(opened[0],cover.dataset.picture);assert.ok(!opened[0].includes('&r='));
});

test('numbering starts at a random point on each window load, so reports from before a reload never match',()=>{
  const starts=new Set();
  for(let i=0;i<5;i++){const f=fixture();f.context.game={title:'Game',cardImages:['https://riotpixels.net/1.jpg.240p.jpg']};const image=f.all(f.run('makeGameCard(game)')).find(node=>node.tagName==='img');starts.add(new URL(image.src).searchParams.get('r'));}
  assert.equal(starts.size,5);
});

test('screenshots and the enlarged picture are numbered too, and the enlarged one is reported when you move on or close it',async()=>{
  const reports=[];
  const f=fixture({leavePictures:async numbers=>{reports.push(...numbers);return numbers.length;}});
  f.run('applyCoverAccent=()=>{};');
  f.context.game={title:'Game',url:'https://fitgirl-repacks.site/game/',image:'https://riotpixels.net/data/a/1.jpg',screenshots:['https://riotpixels.net/data/a/2.jpg.240p.jpg','https://riotpixels.net/data/a/3.jpg.240p.jpg']};
  f.run('currentDetail=game;renderGameDetails(game)');
  const shots=f.all(f.get('#detail-content')).filter(node=>node.tagName==='img'&&node.className!=='detail-cover');
  assert.equal(shots.length,2);for(const shot of shots)assert.ok(new URL(shot.src).searchParams.has('r'));
  await shots[0].emit('load');assert.equal(f.run('picturesOnPage.size'),2,'cover and second screenshot still waiting');
  f.context.list=[f.run('safeImageUrl')(f.context.game.screenshots[0]),f.run('safeImageUrl')(f.context.game.screenshots[1])];
  f.run('openLightbox(list,0,"Game",null)');
  const big=f.get('#lightbox-image'),firstNumber=new URL(big.src).searchParams.get('r');
  assert.equal(new URL(new URL(big.src).searchParams.get('url')).pathname,'/data/a/2.jpg','the full-size picture is asked for first');
  f.run('moveLightbox(1)');assert.deepEqual(reports,[Number(firstNumber)],'moving on reports the picture not yet shown');
  const secondNumber=Number(new URL(big.src).searchParams.get('r'));
  big.onerror();assert.equal(new URL(new URL(big.src).searchParams.get('url')).pathname,'/data/a/3.jpg.240p.jpg','falls back to the small picture once');
  const third=Number(new URL(big.src).searchParams.get('r'));assert.ok(!reports.includes(secondNumber),'a failed picture is not reported');
  big.onload();f.get('#image-dialog').open=false;f.run('restoreLightboxFocus()');
  assert.deepEqual(reports,[Number(firstNumber)],'a shown picture is not reported on close');
  f.run('openLightbox(list,1,"Game",null)');const fourth=Number(new URL(big.src).searchParams.get('r'));
  f.get('#image-dialog').open=false;f.run('restoreLightboxFocus()');
  assert.deepEqual(reports,[Number(firstNumber),fourth],'closing reports a picture still on its way');assert.ok(third>secondNumber);
});

test('a failed screenshot loses its button and is never reported; the enlarged picture falls back only once; one picture ignores arrow keys',async()=>{
  const reports=[];
  const f=fixture({leavePictures:async numbers=>{reports.push(...numbers);return numbers.length;}});
  f.run('applyCoverAccent=()=>{};');
  f.context.game={title:'Game',url:'https://fitgirl-repacks.site/game/',screenshots:['https://riotpixels.net/data/a/2.jpg.240p.jpg']};
  f.run('currentDetail=game;renderGameDetails(game)');
  const shot=f.all(f.get('#detail-content')).find(node=>node.tagName==='img');
  const holder=f.all(f.get('#detail-content')).find(node=>node.className==='screenshot-button');
  await shot.emit('error');
  assert.equal(holder.isConnected,false,'the button of a failed screenshot is removed');
  assert.equal(f.run('picturesOnPage.size'),0,'and its number is not waiting to be reported');
  f.context.list=[f.run('safeImageUrl')('https://riotpixels.net/data/a/2.jpg.240p.jpg')];
  f.run('openLightbox(list,0,"Game",null)');
  const big=f.get('#lightbox-image'),asked=()=>new URL(new URL(big.src).searchParams.get('url')).pathname;
  assert.equal(asked(),'/data/a/2.jpg');
  big.onerror();assert.equal(asked(),'/data/a/2.jpg.240p.jpg');
  const last=big.src;big.onerror();assert.equal(big.src,last,'no second fallback');
  f.run('openLightbox(list,0,"Game",null)');const shown=big.src;
  f.run('moveLightbox(1)');f.run('moveLightbox(-1)');
  assert.equal(big.src,shown,'one picture: moving does not ask for it again');assert.deepEqual(reports,[]);
});
