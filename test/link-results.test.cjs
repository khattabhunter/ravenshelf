'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(api={}){
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.events=new Map();this.attributes={};this._text='';this.disabled=false;this.className='';}
    get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    set textContent(value){this._text=String(value);this.children=[];}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this._text='';this.children=children;}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,listener){this.events.set(name,listener);}
    close(){}remove(){}
  }
  const elements=new Map();
  const document={createElement:tag=>new Element(tag),querySelector:selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);}};
  const context=vm.createContext({document,window:{atlas:api},URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=code=>vm.runInContext(code,context);
  run('toast=()=>{};showView=()=>{};applyState=()=>{};');
  const container=new Element();context.container=container;
  function nodes(root=container){return [root,...root.children.flatMap(child=>nodes(child))];}
  return {context,container,run,nodes,render(links){context.links=links;run("renderCheckedLinks(container,links,[],'Game')");},button(label){return nodes().find(node=>node.tagName==='button'&&node.textContent===label);},withClass(name){return nodes().filter(node=>node.className.split(' ').includes(name));}};
}
const link=(id,status,message='')=>({sourceUrl:`https://fuckingfast.co/${id}#${id}.rar`,url:`https://fuckingfast.co/dl/${id}`,filename:`${id}.rar`,host:'FuckingFast',status,message});

test('browser verification is explained without calling the file missing or allowing an unverified download',()=>{
  const f=fixture();
  f.render([link('game','manual','FuckingFast requires a browser verification. Open the host and complete its check.')]);
  assert.match(f.container.textContent,/1 need a browser step/);
  assert.match(f.container.textContent,/does not mean the files were deleted/);
  assert.doesNotMatch(f.container.textContent,/reported some files missing|before extracting/);
  assert.equal(f.button('Download 0 ready files').disabled,true);
  assert.ok(f.button('Open protected host'));
  assert.ok(f.button('Check links again'));
  assert.equal(f.withClass('link-row').length,1);
  assert.match(f.withClass('link-message')[0].textContent,/FuckingFast requires a browser verification/);
});

test('missing files and temporary failed checks have separate summaries and retain their exact reasons',()=>{
  const f=fixture();
  f.render([link('deleted','unavailable','File not found or deleted.'),link('network','unavailable','Connection timed out.'),link('blocked','manual','Blocked an off-site redirect from FuckingFast.')]);
  assert.match(f.container.textContent,/1 not found/);
  assert.match(f.container.textContent,/2 not verified/);
  assert.doesNotMatch(f.container.textContent,/need a browser step/);
  assert.equal(f.withClass('link-row').length,3);
  assert.match(f.container.textContent,/Connection timed out/);
  assert.match(f.container.textContent,/Blocked an off-site redirect/);
  assert.equal(f.button('Download 0 ready files').disabled,true);
});

test('a mixed set queues only verified files while keeping all other links visible',async()=>{
  let batch;
  const f=fixture({addDownloads:async value=>{batch=value;return {added:1};},getState:async()=>({})});
  f.render([link('ready','ready'),link('challenge','manual','Browser verification required.'),link('missing','unavailable','File not found or deleted.')]);
  const download=f.button('Download 1 ready file');assert.equal(download.disabled,false);
  await download.events.get('click')();
  assert.equal(batch.links.length,1);assert.equal(batch.links[0].status,'ready');assert.equal(batch.links[0].filename,'ready.rar');
  assert.equal(f.withClass('link-row').length,3);
});

test('rechecking uses the original source links and updates readiness only from a fresh check',async()=>{
  const expanded=[],checked=[];let release;
  const f=fixture({expandLinks:text=>{expanded.push(text);return new Promise(resolve=>{release=resolve;});},checkLinks:async urls=>{checked.push(urls);return [link('game','ready')];}});
  const old=link('game','manual','FuckingFast requires a browser verification.');f.render([old]);
  const recheck=f.button('Check links again'),pending=recheck.events.get('click')();
  assert.equal(recheck.disabled,true);assert.equal(expanded[0],old.sourceUrl);
  assert.match(f.container.textContent,/Expanding the file list/);
  release({links:[old.sourceUrl],warnings:[]});await pending;
  assert.equal(checked[0][0],old.sourceUrl);
  assert.match(f.container.textContent,/1 ready/);
  assert.equal(f.button('Download all 1 file').disabled,false);
});

test('an older host check cannot overwrite the result of a later check',async()=>{
  const requests=[];
  const f=fixture({expandLinks:async text=>({links:[`https://fuckingfast.co/${text}`]}),checkLinks:urls=>new Promise(resolve=>requests.push({urls,resolve}))});
  const first=f.run("inspectLinks('old',container,'Game')");await settle();
  const second=f.run("inspectLinks('new',container,'Game')");await settle();
  requests[1].resolve([link('new','ready')]);await second;
  requests[0].resolve([link('old','manual','Browser verification required.')]);await first;
  assert.equal(f.withClass('link-name')[0].textContent,'new.rar');
  assert.equal(f.button('Download all 1 file').disabled,false);
});
