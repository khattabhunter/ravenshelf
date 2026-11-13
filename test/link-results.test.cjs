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
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
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

// Free space before queueing: sizes are those the hosts reported.
const sized=(id,size)=>({...link(id,'ready'),size});
test('files that do not fit on the download drive need a tick before they are queued',async()=>{
  let batch=null,asked=0;
  const f=fixture({getDownloadSpace:async()=>{asked++;return {freeBytes:2000,pendingBytes:0};},addDownloads:async value=>{batch=value;return {added:2};},getState:async()=>({})});
  f.render([sized('one',1500),sized('two',1500)]);
  const download=f.button('Download all 2 files');
  // While the drive is checked, nothing can be queued.
  assert.equal(download.disabled,true);
  await settle();await settle();
  assert.equal(asked,1);
  const warning=f.withClass('space-warning')[0];
  assert.ok(warning);
  assert.equal(warning.attributes.role,'alert');
  assert.match(warning.textContent,/Not enough free space for these files\./);
  assert.match(warning.textContent,/They need 2\.9 KB, and the drive of your download folder has 2\.0 KB free\./);
  assert.match(warning.textContent,/choose another download folder in Settings/);
  assert.equal(download.disabled,true);
  const box=f.nodes().find(node=>node.tagName==='input'&&node.type==='checkbox');
  box.checked=true;box.events.get('change')();
  assert.equal(download.disabled,false);
  await download.events.get('click')();
  assert.equal(batch.links.length,2);
  box.checked=false;box.events.get('change')();
  assert.equal(download.disabled,true);
});
test('downloads already waiting on the drive count against its free space',async()=>{
  const f=fixture({getDownloadSpace:async()=>({freeBytes:5000,pendingBytes:4000})});
  f.render([sized('one',3000)]);
  await settle();await settle();
  const warning=f.withClass('space-warning')[0];
  assert.match(warning.textContent,/They need 2\.9 KB\. The drive of your download folder has 4\.9 KB free, and downloads already in your queue still need 3\.9 KB of it\./);
  assert.equal(f.button('Download all 1 file').disabled,true);
});
test('files that fit are queued without a question',async()=>{
  const f=fixture({getDownloadSpace:async()=>({freeBytes:10000,pendingBytes:1000})});
  f.render([sized('one',3000),sized('two',6000)]);
  const download=f.button('Download all 2 files');
  assert.equal(download.disabled,true);
  await settle();await settle();
  assert.equal(f.withClass('space-warning').length,0);
  assert.equal(download.disabled,false);
});
test('an unknown free space never blocks a download',async()=>{
  for(const answer of [async()=>{throw new Error('Free space could not be checked.');},async()=>({freeBytes:null,pendingBytes:0}),async()=>null,async()=>({freeBytes:'lots'}),async()=>({freeBytes:-5})]){
    const f=fixture({getDownloadSpace:answer});
    f.render([sized('one',3000)]);
    await settle();await settle();
    assert.equal(f.withClass('space-warning').length,0);
    assert.equal(f.button('Download all 1 file').disabled,false);
  }
  // An app without the check, and files of unknown size, are not held up.
  const old=fixture();old.render([sized('one',3000)]);
  assert.equal(old.button('Download all 1 file').disabled,false);
  let asked=0;const unknown=fixture({getDownloadSpace:async()=>{asked++;return {freeBytes:0,pendingBytes:0};}});
  unknown.render([link('one','ready')]);
  assert.equal(unknown.button('Download all 1 file').disabled,false);
  await settle();assert.equal(asked,0);
});
test('a free-space check that never answers lets the download go after a few seconds',async()=>{
  const f=fixture({getDownloadSpace:()=>new Promise(()=>{})});
  const delays=[];f.context.setTimeout=(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms===4000?1:ms);};
  f.render([sized('one',3000)]);
  assert.equal(f.button('Download all 1 file').disabled,true);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(delays.includes(4000));
  assert.equal(f.button('Download all 1 file').disabled,false);
});
test('a free-space check that cannot be made is said quietly, and files already queued are not counted',async()=>{
  const f=fixture({getDownloadSpace:async()=>({freeBytes:null,pendingBytes:0})});
  f.render([sized('one',3000)]);
  await settle();await settle();
  assert.match(f.withClass('space-check')[0].textContent,/Free space could not be checked\./);
  assert.equal(f.withClass('space-warning').length,0);
  assert.equal(f.button('Download all 1 file').disabled,false);
  // The same file set checked again: the queued files count once, in what the queue still needs.
  const g=fixture({getDownloadSpace:async()=>({freeBytes:5000,pendingBytes:3000})});
  g.run("state.downloads.push({sourceUrl:'https://fuckingfast.co/one#one.rar',status:'paused'},{sourceUrl:'https://fuckingfast.co/two#two.rar',status:'cancelled'})");
  g.render([sized('one',3000)]);
  await settle();await settle();
  assert.equal(g.withClass('space-warning').length,0);
  assert.equal(g.button('Download all 1 file').disabled,false);
  // A cancelled entry is downloaded again, so it counts.
  const h=fixture({getDownloadSpace:async()=>({freeBytes:5000,pendingBytes:3000})});
  h.run("state.downloads.push({sourceUrl:'https://fuckingfast.co/two#two.rar',status:'cancelled'})");
  h.render([sized('two',3000)]);
  await settle();await settle();
  assert.equal(h.withClass('space-warning').length,1);
});

test('Open in browser is offered only for PixelDrain and MultiUpload links that need a manual step',()=>{
  const f=fixture({openExternal:async()=>{}});
  f.render([
    {sourceUrl:'https://pixeldrain.com/u/abcd1234',url:'https://pixeldrain.com/u/abcd1234',filename:'a.rar',host:'PixelDrain',status:'manual',message:'PixelDrain asks for a quick browser check. Open the link in your browser, complete it, then try again.'},
    {sourceUrl:'https://multiup.io/download/'+'a'.repeat(32)+'/b.rar',url:'https://multiup.io/download/'+'a'.repeat(32)+'/b.rar',filename:'b.rar',host:'MultiUpload',status:'manual',message:'Ravenshelf can’t download this MultiUpload file itself. Open it in your browser.'},
    {sourceUrl:'https://files.example/c.rar',url:'https://files.example/c.rar',filename:'c.rar',host:'files.example',status:'manual',message:'Host returned HTTP 403.'}
  ]);
  const rows=f.withClass('link-row');
  const buttons=row=>f.nodes(row).filter(node=>node.tagName==='button').map(node=>node.textContent);
  assert.deepEqual(rows.map(buttons),[['Open in browser'],['Open in browser'],[]]);
});
