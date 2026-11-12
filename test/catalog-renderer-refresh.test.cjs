'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const result=title=>({games:[{url:'https://fitgirl-repacks.site/'+title+'/',title}],hasMore:true,label:'Newest'});
const check=(n,title)=>({enabled:true,checking:false,lastCheckedAt:new Date(n*300000).toISOString(),intervalMs:300000,error:'',revision:n,latest:result(title)});
function fixture(){
  const requests=[],renders=[],nodes=new Map(),scrolls=[];let dialogOpen=false,skeletons=0;
  const node=()=>({textContent:'',hidden:false,disabled:false,dataset:{},childNodes:[],classList:{toggle(){}},setAttribute(){},addEventListener(){},append(...items){this.childNodes.push(...items);},replaceChildren(...items){this.childNodes=items;},contains(){return false;},querySelectorAll(){return [];},focus(){}});
  const select=selector=>selector==='dialog[open]'?(dialogOpen?node():null):(nodes.has(selector)?nodes.get(selector):(nodes.set(selector,node()),nodes.get(selector)));
  const api={listCatalog:options=>new Promise((resolve,reject)=>requests.push({options,resolve,reject}))};
  const context=vm.createContext({window:{atlas:api,scrollX:0,scrollY:220,scrollTo:(...args)=>scrolls.push(args)},document:{querySelector:select,querySelectorAll:()=>[],createElement:node,activeElement:null},console,URL,Date,JSON,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,'');
  vm.runInContext(source,context);
  context.recordRender=(data,selection,background)=>{renders.push({data,selection,background});};
  context.recordSkeleton=()=>skeletons++;
  vm.runInContext("globalThis.originalApply=applyCatalogResult;renderCatalogSections=()=>{};renderSkeletons=recordSkeleton;applyCatalogResult=(data,selection,background)=>{recordRender(data,selection,background);catalog.games=data.games;catalog.hasMore=Boolean(data.hasMore);};catalogAutoReady=true;",context);
  return {requests,renders,nodes,context,scrolls,run:code=>vm.runInContext(code,context),receive:snapshot=>{context.incoming=snapshot;vm.runInContext('receiveCatalogCheck(incoming)',context);},dialog:value=>{dialogOpen=value;},get skeletons(){return skeletons;}};
}
test('successful background checks show new uploads without clicks and ignore repeated state broadcasts',async()=>{
  const f=fixture();f.receive(check(1,'First'));f.receive(check(1,'First'));await settle();
  assert.equal(f.renders.length,1);assert.equal(f.renders[0].data.games[0].title,'First');assert.equal(f.requests.length,0);
  f.receive(check(2,'New-upload'));await settle();
  assert.equal(f.renders.length,2);assert.equal(f.renders[1].data.games[0].title,'New-upload');assert.equal(f.renders[1].background,true);assert.equal(f.skeletons,0);
});
test('updates wait during another view or an open dialog and apply automatically afterward',async()=>{
  const f=fixture();f.run("currentView='downloads'");f.receive(check(1,'New-upload'));assert.equal(f.renders.length,0);
  f.run("currentView='discover'");f.dialog(true);f.run('flushCatalogCheck()');assert.equal(f.renders.length,0);
  f.dialog(false);f.run('flushCatalogCheck()');await settle();assert.equal(f.renders.length,1);assert.equal(f.requests.length,0);
});
test('background refresh preserves the current genre, search and page and fetches fresh data quietly',async()=>{
  const f=fixture();f.run("catalog.section='arpg';catalog.page=3;catalog.search='Diablo';catalog.games=[{title:'Existing'}]");f.receive(check(1,'New-upload'));
  assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].options)),{section:'arpg',page:3,search:'Diablo',forceRefresh:true});
  assert.equal(f.run('catalog.games[0].title'),'Existing');assert.equal(f.skeletons,0);
  f.requests[0].resolve(result('Refreshed'));await settle();
  assert.equal(f.run('catalog.section'),'arpg');assert.equal(f.run('catalog.page'),3);assert.equal(f.run('catalog.search'),'Diablo');assert.equal(f.renders[0].background,true);
});
test('a slow background response cannot replace a newer user search',async()=>{
  const f=fixture();f.run("catalog.section='rpg'");f.receive(check(1,'New-upload'));
  f.run("loadCatalog({section:'rts',search:'War',page:2})");assert.equal(f.requests.length,2);
  f.requests[1].resolve(result('User-search'));await settle();f.requests[0].resolve(result('Old-background'));await settle();
  assert.equal(f.run('catalog.games[0].title'),'User-search');assert.equal(f.run('catalog.section'),'rts');assert.equal(f.renders.length,1);
});
test('failed background requests preserve visible games and recover on the next automatic check',async()=>{
  const f=fixture();f.run("catalog.section='rts';catalog.games=[{title:'Kept'}]");f.receive(check(1,'New-upload'));
  f.requests[0].reject(new Error('Temporarily offline'));await settle();
  assert.equal(f.run('catalog.games[0].title'),'Kept');assert.match(f.nodes.get('#catalog-refresh-status').textContent,/Keeping the current games/);assert.equal(f.skeletons,0);
  f.receive(check(2,'New-upload'));f.requests[1].resolve(result('Recovered'));await settle();
  assert.equal(f.run('catalog.games[0].title'),'Recovered');assert.equal(f.run('catalogBackgroundError'),'');
});
test('startup snapshots wait for initial loading and pending checks coalesce to the newest result',async()=>{
  const f=fixture();f.run('catalogAutoReady=false');f.receive(check(1,'First'));f.receive(check(2,'Latest'));
  assert.equal(f.renders.length,0);f.run('catalogAutoReady=true;flushCatalogCheck()');await settle();
  assert.equal(f.renders.length,1);assert.equal(f.run('catalog.games[0].title'),'Latest');assert.equal(f.requests.length,0);
});
test('background DOM updates restore the focused game and scroll position without touching search text',()=>{
  const f=fixture();f.run("applyCatalogResult=originalApply;renderGames=()=>{};catalog.games=[{url:'kept',title:'Old'}]");
  f.context.document.activeElement={closest:()=>({dataset:{gameUrl:'kept'}})};
  f.context.document.querySelector('#game-grid').contains=()=>true;
  let focused=false;f.nodes.get('#game-grid').querySelectorAll=()=>[{dataset:{gameUrl:'kept'},focus:options=>{focused=options.preventScroll;}}];
  f.context.document.querySelector('#search-input').value='unfinished typing';
  f.context.incoming={games:[{url:'new',title:'New'},{url:'kept',title:'Kept'}],hasMore:true};
  f.run("applyCatalogResult(incoming,{page:1,search:'',section:'newest'},true)");
  assert.equal(focused,true);assert.deepEqual(f.scrolls,[[0,220]]);assert.equal(f.nodes.get('#search-input').value,'unfinished typing');
});
