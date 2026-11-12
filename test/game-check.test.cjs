'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const GIB=1024**3;

function fixture(api={}){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this._text='';this.className='';this.isConnected=true;this.disabled=false;this.checked=false;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;this._text='';}remove(){this.isConnected=false;}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    addEventListener(name,listener){const listeners=this.events.get(name)||[];listeners.push(listener);this.events.set(name,listeners);}async emit(name,event={}){for(const listener of this.events.get(name)||[])await listener(event);}
    close(){}focus(){}contains(){return false;}
  }
  const nodes=new Map(),get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>[],createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},documentElement:{style:{setProperty(){}}}};
  const context=vm.createContext({window:{atlas:api},document,URL,console,setTimeout,clearTimeout,Intl});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=code=>vm.runInContext(code,context);run('toast=()=>{};');
  const all=root=>[root,...root.children.flatMap(all)];
  const container=new Element();context.container=container;
  return {run,context,container,Element,all,
    async open(game={title:'Game',url:'https://fitgirl-repacks.site/game/',steamAppId:'570'}){context.game=game;await run('loadGameMetadata(game,container)');},
    find:(text,root=container)=>all(root).find(node=>node.tagName==='button'&&node.textContent===text),
    withClass:(name,root=container)=>all(root).filter(node=>String(node.className).split(' ').includes(name))};
}
const METADATA={source:'Steam',sourceUrl:'https://store.steampowered.com/app/570/',reviews:null,requirements:{minimum:'Memory: 8 GB RAM',recommended:'Memory: 32 GB RAM'}};
const row=(key,verdict,extra={})=>({key,verdict,needs:'',need:null,have:null,haveText:'',note:null,...extra});
const ANSWER={schema:1,status:'complete',notes:[],tiers:{
  minimum:{verdict:'meets',counts:{meets:5,below:0,unknown:2},rows:[
    row('windows','meets',{needs:'Windows 10',need:10,have:11}),
    row('bits','meets',{needs:'Requires a 64-bit processor and operating system',need:'64',have:'64'}),
    row('processor','unknown',{needs:'Example CPU 6700',haveText:'Example Core i7',note:'model'}),
    row('memory','meets',{needs:'8 GB RAM',need:8*GIB,have:16*GIB}),
    row('graphics','unknown',{needs:'Example GTX 1060 6GB',haveText:'Example RTX',note:'model'}),
    row('videoMemory','meets',{needs:'Example GTX 1060 6GB',need:6*GIB,have:6308233216,derived:true}),
    row('directx','meets',{needs:'Version 12',need:{version:12,level:null},have:{version:12,level:12.2}}),
    row('storage','meets',{needs:'70 GB available space',need:70*GIB,have:120*GIB,drive:'C'})]},
  recommended:{verdict:'below',counts:{meets:0,below:2,unknown:1},rows:[
    row('memory','below',{needs:'32 GB RAM',need:32*GIB,have:16*GIB}),
    row('storage','below',{needs:'500 GB',need:500*GIB,have:120*GIB,drive:'C'}),
    row('videoMemory','unknown',{needs:'Video Memory: 2 GB',need:2*GIB,note:'shared'})]}}};

test('Can You Run It: a button above the requirement lists, and only the game address goes to the app',async()=>{
  const asked=[];
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async value=>{asked.push(value);return ANSWER;}});
  await f.open();
  const section=f.withClass('fit-check')[0];
  assert.ok(section);
  assert.match(section.textContent,/Can you run it\?/);
  assert.match(section.textContent,/never sent anywhere/);
  // Nothing is read until asked.
  assert.deepEqual(asked,[]);
  // The panel comes before the requirement cards.
  const order=f.all(f.container).filter(node=>['fit-check','requirements-grid'].includes(node.className));
  assert.deepEqual(order.map(node=>node.className),['fit-check','requirements-grid']);
  const compare=f.find('Compare with this PC',section);
  await compare.emit('click');
  assert.deepEqual(JSON.parse(JSON.stringify(asked)),[{url:'https://fitgirl-repacks.site/game/'}]);
  const text=section.textContent;
  assert.match(text,/Minimum/);assert.match(text,/Recommended/);
  assert.match(text,/This PC meets the minimum requirements that can be checked\./);
  assert.match(text,/This PC is below the recommended requirements in: Memory and Free space\./);
  assert.match(text,/Windows 10.*Windows 11/);
  assert.match(text,/64-bit Windows.*Requires a 64-bit processor and operating system.*64-bit/);
  assert.match(text,/Example CPU 6700.*Example Core i7/);
  assert.match(text,/GraphicsExample GTX 1060 6GBExample RTX/);
  assert.match(text,/16 GB/);
  // Graphics memory read from the card line is shown as its figure; 5.875 GB reads as 6 GB.
  const vram=f.all(section).filter(node=>node.tagName==='tr').find(node=>/Graphics memory/.test(node.textContent));
  assert.match(vram.textContent,/^Graphics memory6 GB6 GBMeets$/);
  assert.match(text,/DirectX 12 \u00b7 feature level 12\.2/);
  assert.match(text,/120 GB free on C:/);
  assert.match(text,/Built-in graphics use part of the PC.s memory/);
  assert.match(text,/models are not compared/);
  assert.match(text,/does not promise how well the game runs/);
  const verdicts=f.withClass('fit-verdict',section).map(node=>node.textContent);
  assert.ok(verdicts.includes('Meets')&&verdicts.includes('Below')&&verdicts.includes('Can’t tell'));
  assert.equal(f.withClass('fit-check-result')[0].attributes['aria-live'],'polite');
  // Headers are real table headers.
  const headers=f.all(section).filter(node=>node.tagName==='th');
  assert.deepEqual(headers.slice(0,4).map(node=>[node.textContent,node.scope]),[['Item','col'],['This game needs','col'],['This PC','col'],['Result','col']]);
  assert.equal(headers.find(node=>node.textContent==='Memory').scope,'row');
  // The game's words and this PC's names keep their own direction.
  for(const cell of f.withClass('fit-needs',section))assert.equal(cell.dir,'auto');
  const names=f.withClass('fit-have',section).map(cell=>[cell.children[0].textContent,cell.children[0].dir]);
  assert.deepEqual(names.filter(([,dir])=>dir==='auto').map(([name])=>name),['Example Core i7','Example RTX']);
  assert.ok(f.find('Compare again',section));
  assert.equal(f.run('gameCheckReady'),true);
});

test('Can You Run It: after this PC was read once, the next game is compared at once',async()=>{
  let calls=0;
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>{calls++;return ANSWER;}});
  await f.open();await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,0);
  f.run('hardwareLoaded=true');
  f.container.replaceChildren();await f.open();await new Promise(resolve=>setTimeout(resolve,5));await flush();
  assert.equal(calls,1);
  assert.match(f.container.textContent,/This PC meets the minimum/);
  f.run('hardwareLoaded=false;gameCheckReady=true');
  f.container.replaceChildren();await f.open();await new Promise(resolve=>setTimeout(resolve,5));await flush();
  assert.equal(calls,2);
});

test('Can You Run It: a failed comparison says so and can be tried again',async()=>{
  let fail=true;
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>{if(fail)throw new Error('This PC could not be compared with the game. Try again.');return ANSWER;}});
  await f.open();
  const section=f.withClass('fit-check')[0],compare=f.find('Compare with this PC',section);
  await compare.emit('click');
  const error=f.withClass('inline-error',section)[0];
  assert.match(error.textContent,/could not be compared/);
  assert.equal(error.attributes.role,'alert');
  assert.equal(compare.disabled,false);
  assert.equal(f.run('gameCheckReady'),false);
  fail=false;await compare.emit('click');
  assert.match(section.textContent,/This PC meets the minimum/);
  // An empty answer is an error too.
  const g=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>null});
  await g.open();await g.find('Compare with this PC').emit('click');
  assert.ok(g.withClass('inline-error')[0]);
});

test('Can You Run It: an answer for a game that is no longer open is dropped',async()=>{
  let release;
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:()=>new Promise(resolve=>{release=resolve;})});
  await f.open();
  const section=f.withClass('fit-check')[0],click=f.find('Compare with this PC',section).emit('click');
  await flush();
  assert.match(section.textContent,/Comparing this game’s list with this PC/);
  f.run('detailRequest++');
  release(ANSWER);await click;
  assert.doesNotMatch(section.textContent,/This PC meets/);
});

test('Can You Run It: notes about this PC and lists that cannot be compared',async()=>{
  const answer=over=>fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>({...ANSWER,...over})});
  const text=async over=>{const f=answer(over);await f.open();await f.find('Compare with this PC').emit('click');return f.withClass('fit-check')[0].textContent;};
  assert.match(await text({status:'no-specs'}),/read on Windows only/);
  assert.match(await text({status:'partial',notes:['not-windows']}),/read on Windows only/);
  assert.match(await text({status:'partial',notes:['probe-failed']}),/Windows did not give every detail/);
  assert.doesNotMatch(await text({}),/Windows did not give every detail|read on Windows only/);
  assert.match(await text({status:'no-requirements',tiers:{}}),/no requirement list to compare/);
  assert.match(await text({status:'nothing-to-compare',tiers:{}}),/None of the lines/);
  assert.match(await text({tiers:{minimum:{verdict:'unknown',rows:[row('processor','unknown',{note:'model'})]}}}),/The minimum requirements could not be checked\./);
  // Without a model line the models note is not shown.
  assert.doesNotMatch(await text({tiers:{minimum:{verdict:'meets',rows:[row('memory','meets',{need:GIB,have:2*GIB})]}}}),/models are not compared/);
});

test('Can You Run It: a strange answer cannot add rows, verdicts or markup',async()=>{
  const odd={schema:1,status:'complete',notes:['<b>x</b>'],tiers:{
    minimum:{verdict:'great',rows:[row('evil','meets',{needs:'<img src=x onerror=bad()>'}),row('memory','fantastic',{needs:'<script>bad()</script>',need:GIB,have:2*GIB,note:'<b>note</b>'}),null]},
    extra:{verdict:'meets',rows:[row('memory','meets')]}}};
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>odd});
  await f.open();await f.find('Compare with this PC').emit('click');
  const section=f.withClass('fit-check')[0];
  const rows=f.all(section).filter(node=>node.tagName==='tr');
  // A header row and the memory row only.
  assert.equal(rows.length,2);
  assert.match(rows[1].textContent,/<script>bad\(\)<\/script>/);
  assert.match(rows[1].textContent,/Can’t tell$/);
  assert.doesNotMatch(section.textContent,/evil|note<|extra/);
  assert.equal(f.withClass('fit-tier')[0].className,'fit-tier unknown');
  assert.deepEqual(f.withClass('fit-verdict',section).map(node=>node.className),['fit-verdict unknown','fit-verdict unknown']);
  for(const node of f.all(section))assert.equal(node.innerHTML===undefined||node.tagName==='span',true);
});

test('Can You Run It: no panel without a requirement list or without the app feature',async()=>{
  const none=fixture({getGameMetadata:async()=>({...METADATA,requirements:{minimum:'',recommended:''}}),checkGame:async()=>ANSWER});
  await none.open();
  assert.equal(none.withClass('fit-check').length,0);
  const old=fixture({getGameMetadata:async()=>METADATA});
  await old.open();
  assert.equal(old.withClass('fit-check').length,0);
  assert.equal(old.withClass('requirements-grid').length,1);
});

test('Can You Run It: what this PC has, written out',()=>{
  const f=fixture();
  const have=value=>f.run(`checkHave(${JSON.stringify(value)})`);
  assert.equal(have(row('windows','meets',{have:8.1})),'Windows 8.1');
  assert.equal(have(row('windows','meets',{have:5.1})),'Windows XP');
  assert.equal(have(row('windows','meets',{have:12})),'');
  assert.equal(have(row('bits','meets',{have:'32'})),'32-bit');
  assert.equal(have(row('bits','meets',{have:'arm'})),'ARM');
  assert.equal(have(row('bits','meets',{have:'16'})),'');
  assert.equal(have(row('memory','meets',{have:7.8*GIB,note:'usable'})),'7.8 GB');
  assert.equal(have(row('memory','meets',{have:0})),'');
  assert.equal(have(row('directx','meets',{have:{version:11,level:null}})),'DirectX 11');
  assert.equal(have(row('directx','meets',{have:{version:'12'}})),'');
  assert.equal(have(row('storage','meets',{have:0,drive:'D'})),'0 B free on D:');
  assert.equal(have(row('storage','meets',{have:5*GIB,drive:'<x>'})),'');
  assert.equal(have(row('processor','unknown',{haveText:7})),'');
  assert.equal(have(row('other','unknown',{have:1})),'');
  assert.equal(f.run(`checkNeeds(${JSON.stringify(row('videoMemory','meets',{needs:'Example 4GB',need:4*GIB,derived:false}))})`),'Example 4GB');
  assert.equal(f.run(`checkNeeds(${JSON.stringify(row('videoMemory','meets',{needs:'Example',need:null,derived:true}))})`),'Example');
  assert.equal(f.run(`checkNeeds({key:'memory',needs:7})`),'');
});

test('Can You Run It: Compare again reads this PC again',async()=>{
  const asked=[];
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async value=>{asked.push(JSON.parse(JSON.stringify(value)));return ANSWER;}});
  await f.open();
  const section=f.withClass('fit-check')[0];
  await f.find('Compare with this PC',section).emit('click');
  await f.find('Compare again',section).emit('click');
  assert.deepEqual(asked,[{url:'https://fitgirl-repacks.site/game/'},{url:'https://fitgirl-repacks.site/game/',refresh:true}]);
});

test('Can You Run It: a list that could not be loaded says so',async()=>{
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>({schema:1,status:'details-unavailable',tiers:{},notes:[]})});
  await f.open();await f.find('Compare with this PC').emit('click');
  assert.match(f.withClass('fit-check')[0].textContent,/requirement list could not be loaded\. Try again later\./);
});

test('Can You Run It: a broken answer shows a fixed message, and the verdict comes from the rows shown',async()=>{
  for(const tiers of [{minimum:{verdict:'meets',rows:'x'}},{minimum:{verdict:'meets',rows:{length:2}}},'x',null]){
    const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>({schema:1,status:'complete',tiers,notes:[]})});
    await f.open();await f.find('Compare with this PC').emit('click');
    assert.match(f.withClass('fit-check')[0].textContent,/no requirement list to compare/);
  }
  // A tier that claims "meets" over a row that is below is shown as below.
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>({schema:1,status:'complete',notes:[],tiers:{minimum:{verdict:'meets',rows:[row('memory','below',{need:8*GIB,have:4*GIB})]}}})});
  await f.open();await f.find('Compare with this PC').emit('click');
  assert.equal(f.withClass('fit-tier')[0].className,'fit-tier below');
  assert.match(f.withClass('fit-check')[0].textContent,/below the minimum requirements in: Memory\./);
  // A failure while drawing: a fixed message, and later games are not compared at once.
  const g=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>ANSWER});
  g.run('renderGameCheck=()=>{throw new Error("internal detail")}');
  await g.open();await g.find('Compare with this PC').emit('click');
  const error=g.withClass('inline-error')[0];
  assert.match(error.textContent,/This PC could not be compared with the game\. Try again\./);
  assert.doesNotMatch(error.textContent,/internal detail/);
  assert.equal(g.run('gameCheckReady'),false);
});

test('Can You Run It: the notes for unclear lines, updates, unknown kinds and older feature levels',async()=>{
  const answer={schema:1,status:'complete',notes:[],tiers:{minimum:{verdict:'unknown',rows:[
    row('windows','unknown',{needs:'Windows 10 (7 not supported)',note:'unclear'}),
    row('memory','unknown',{needs:'8 GB',note:'update'}),
    row('videoMemory','unknown',{needs:'2 GB',note:'kind'}),
    row('directx','unknown',{needs:'Version 12',note:'level'})]}}};
  const f=fixture({getGameMetadata:async()=>METADATA,checkGame:async()=>answer});
  await f.open();await f.find('Compare with this PC').emit('click');
  const text=f.withClass('fit-check')[0].textContent;
  assert.match(text,/can be read more than one way/);
  assert.match(text,/particular update of this Windows version/);
  assert.match(text,/card or built-in, so less memory is not judged/);
  assert.match(text,/older feature level/);
  assert.match(text,/The minimum requirements could not be checked\./);
});
