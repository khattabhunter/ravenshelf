'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// A small DOM fixture exercises the real renderer/card code. Its write counter
// detects work on historical cards without imposing a wall-clock performance test.
class Element {
  constructor(tag='div'){
    this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.events=new Map();
    this.hidden=false;this.disabled=false;this.value='';this.open=false;this.writes=0;this._className='';this._text='';
    this.style=new Proxy({}, {set:(object,key,value)=>{this.writes++;object[key]=value;return true;}});
    this.classList={toggle:(name,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));if(on)names.add(name);else names.delete(name);this.className=[...names].join(' ');}};
  }
  get className(){return this._className;}set className(value){this.writes++;this._className=value;}
  get textContent(){return this._text;}set textContent(value){this.writes++;this._text=String(value);}
  setAttribute(name,value){this.writes++;this.attributes[name]=String(value);}
  removeAttribute(name){this.writes++;delete this.attributes[name];}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}this.writes++;}
  replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...nodes);}
  insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):-1;node.parentNode=this;if(index<0)this.children.push(node);else this.children.splice(index,0,node);this.writes++;}
  remove(){if(this.parentNode){const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1);parent.writes++;this.parentNode=null;}}
  matches(selector){return selector.startsWith('.')?this.className.split(/\s+/).includes(selector.slice(1)):selector.startsWith('#')?this.id===selector.slice(1):this.tagName.toLowerCase()===selector;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,listener){this.events.set(name,listener);}
  showModal(){this.open=true;}close(){this.open=false;}focus(){}
}
function rendererFixture(){
  const nodes=new Map();
  const get=selector=>{if(!nodes.has(selector)){const node=new Element();if(selector.startsWith('#'))node.id=selector.slice(1);nodes.set(selector,node);}return nodes.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>[],createElement:tag=>new Element(tag),activeElement:null,addEventListener(){}};
  const context=vm.createContext({window:{atlas:{},scrollTo(){}},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  const run=source=>vm.runInContext(source,context);
  const call=(name,value)=>{context.payload=structuredClone(value);return run(`${name}(payload)`);};
  const snapshot=()=>JSON.parse(run('JSON.stringify(state)'));
  return {get,run,call,snapshot};
}
const transfer=(id,extra={})=>({id,name:`${id}.rar`,gameTitle:'Fixture game',status:'downloading',received:10,total:100,speed:2,activeConnections:2,connectionMode:'parallel',connectionNote:'',...extra});
const full=(updateSequence,downloads,extra={})=>({updateSequence,downloads,settings:{favorites:[],collections:[],connectionsPerFile:4,defenderScan:true},completionAction:{mode:'none',phase:'idle'},headerStorageWarning:'',...extra});
const progress=(updateSequence,downloads)=>({updateSequence,downloads});
const totalWrites=node=>node.writes+node.children.reduce((sum,child)=>sum+totalWrites(child),0);

test('progress before the initial snapshot is ignored without preventing initial state loading',()=>{
  const f=rendererFixture();
  f.call('applyProgress',progress(9,[{id:'a',received:90,total:100,speed:9,activeConnections:4}]));
  assert.equal(f.snapshot().downloads.length,0);
  f.call('applyState',full(1,[transfer('a')]));
  f.call('applyProgress',progress(2,[{id:'a',received:20,total:100,speed:3,activeConnections:3}]));
  assert.equal(f.snapshot().downloads[0].received,20);
});

test('stale full replies and progress cannot undo pause, resume, completion or scan review',()=>{
  const f=rendererFixture();
  f.call('applyState',full(1,[transfer('a')]));
  f.call('applyProgress',progress(3,[{id:'a',received:30,total:100,speed:3,activeConnections:3}]));
  f.call('applyState',full(2,[transfer('a',{received:20})]));
  assert.equal(f.snapshot().downloads[0].received,30,'a late getState response must not move progress backwards');
  f.call('applyState',full(4,[transfer('a',{status:'paused',received:35,speed:0,activeConnections:0})]));
  f.call('applyProgress',progress(3,[{id:'a',received:30,total:100,speed:3,activeConnections:3}]));
  f.call('applyProgress',progress(5,[{id:'a',received:50,total:100,speed:5,activeConnections:4,status:'downloading'}]));
  assert.equal(f.snapshot().downloads[0].status,'paused');assert.equal(f.snapshot().downloads[0].received,35);assert.equal(f.snapshot().downloads[0].speed,0);
  f.call('applyState',full(6,[transfer('a',{received:35})]));
  f.call('applyProgress',progress(7,[{id:'a',received:70,total:100,speed:7,activeConnections:2}]));
  f.call('applyState',full(8,[transfer('a',{status:'completed',received:100,speed:0,activeConnections:0,scan:{status:'review',message:'Needs review'}})],{completionAction:{mode:'close',phase:'armed',message:'Waiting for review'},headerStorageWarning:'Headers are memory only.'}));
  f.call('applyState',full(6,[transfer('a')]));
  f.call('applyProgress',progress(9,[{id:'a',received:75,total:100,speed:7,activeConnections:2,status:'downloading',scan:{status:'clean'}}]));
  const result=f.snapshot();
  assert.equal(result.downloads[0].status,'completed');assert.equal(result.downloads[0].received,100);assert.equal(result.downloads[0].speed,0);
  assert.equal(result.downloads[0].scan.status,'review');assert.equal(result.completionAction.phase,'armed');assert.equal(result.headerStorageWarning,'Headers are memory only.');
});

test('progress only changes allowed numbers on existing active records',()=>{
  const f=rendererFixture();
  f.call('applyState',full(1,[transfer('a',{url:'https://files.example.com/a',folder:'C:\\Fixture',error:'',headersNeedRefresh:true}),transfer('done',{status:'completed',received:100,speed:0,scan:{status:'review'}})],{headerStorageWarning:'Headers are memory only.'}));
  f.call('applyProgress',{...progress(2,[
    {id:'a',received:40,total:200,speed:12,activeConnections:4,status:'completed',scan:{status:'clean'},url:'https://untrusted.example/',folder:'elsewhere',error:'replaced',headersNeedRefresh:false,headers:{Cookie:'do not copy'}},
    {id:'done',received:1,total:1,speed:500,activeConnections:4},
    {id:'unknown',received:1,total:1,speed:1,activeConnections:1},
  ]),settings:{defenderScan:false},headerStorageWarning:'',completionAction:{mode:'shutdown',phase:'executing'}});
  const result=f.snapshot(),active=result.downloads[0],done=result.downloads[1];
  assert.equal(result.downloads.length,2);assert.equal(active.received,40);assert.equal(active.total,200);assert.equal(active.speed,12);assert.equal(active.activeConnections,4);
  assert.equal(active.status,'downloading');assert.equal(active.scan,undefined);assert.equal(active.url,'https://files.example.com/a');assert.equal(active.folder,'C:\\Fixture');assert.equal(active.error,'');assert.equal(active.headersNeedRefresh,true);assert.equal(active.headers,undefined);
  assert.equal(done.received,100);assert.equal(done.scan.status,'review');assert.equal(result.settings.defenderScan,true);assert.equal(result.headerStorageWarning,'Headers are memory only.');assert.equal(result.completionAction.mode,'none');
});

test('invalid progress cannot corrupt counters, and valid zero-speed updates are shown',()=>{
  const f=rendererFixture();f.call('applyState',full(1,[transfer('a')]));
  const valid={id:'a',received:50,total:100,speed:10,activeConnections:2};
  for(const sequence of [undefined,-1,1.5,NaN,Infinity,'2'])f.call('applyProgress',progress(sequence,[valid]));
  assert.equal(f.snapshot().downloads[0].received,10);
  let sequence=2;
  for(const patch of [{received:NaN},{received:-1},{total:Infinity},{speed:'<img src=x>'},{speed:-1},{activeConnections:5},{activeConnections:1.5}]){
    f.call('applyProgress',progress(sequence++,[{...valid,...patch}]));
    assert.equal(f.snapshot().downloads[0].received,10);assert.equal(f.snapshot().downloads[0].speed,2);
  }
  f.call('applyProgress',progress(sequence,[{...valid,received:10,speed:0,activeConnections:0}]));
  assert.equal(f.snapshot().downloads[0].speed,0);assert.equal(f.snapshot().downloads[0].activeConnections,0);
});

test('progress updates active card counters and aggregate speed without touching historical cards or controls',()=>{
  const f=rendererFixture();f.run('currentView="downloads"');
  f.call('applyState',full(1,[transfer('a'),transfer('b'),transfer('old',{status:'completed',received:100,speed:0,scan:{status:'review',message:'Review'}})]));
  const list=f.get('#download-list'),[a,b,old]=list.children;
  const oldWrites=totalWrites(old),oldScan=old.querySelector('.download-scan').children[0],aControls=a.querySelector('.download-actions').children[0],aIcon=a.querySelector('.download-file-icon').children[0];
  f.call('applyProgress',progress(2,[{id:'a',received:50,total:100,speed:1024,activeConnections:4},{id:'b',received:25,total:100,speed:2048,activeConnections:1}]));
  assert.equal(list.children[0],a);assert.equal(list.children[1],b);assert.equal(list.children[2],old);
  assert.equal(a.querySelector('.download-progress').attributes['aria-valuenow'],'50');assert.equal(b.querySelector('.download-progress').attributes['aria-valuenow'],'25');
  assert.equal(a.querySelector('.download-progress-fill').style.width,'50%');assert.match(a.querySelector('.download-connections').textContent,/4 active connections/);
  assert.match(f.get('#stat-speed').textContent,/3(?:\.0)?\s*(?:KB|KiB)\/s/);
  assert.equal(a.querySelector('.download-actions').children[0],aControls);assert.equal(a.querySelector('.download-file-icon').children[0],aIcon);
  assert.equal(old.querySelector('.download-scan').children[0],oldScan);assert.equal(totalWrites(old),oldWrites,'steady progress should not redraw completed history');
});

test('hidden and filtered downloads keep fresh counters without inserting hidden cards',()=>{
  const f=rendererFixture();
  f.call('applyState',full(1,[transfer('a'),transfer('old',{status:'completed',received:100,speed:0})]));
  const list=f.get('#download-list');assert.equal(list.children.length,0);
  f.call('applyProgress',progress(2,[{id:'a',received:60,total:100,speed:100,activeConnections:2}]));
  assert.equal(list.children.length,0);assert.equal(f.snapshot().downloads[0].received,60);
  f.run('showView("downloads")');assert.equal(list.children[0].querySelector('.download-progress').attributes['aria-valuenow'],'60');
  f.run('downloadFilter="completed";renderDownloads()');assert.equal(list.children.length,1);assert.equal(list.children[0].dataset.id,'old');
  f.call('applyProgress',progress(3,[{id:'a',received:80,total:100,speed:120,activeConnections:3}]));
  assert.equal(list.children.length,1);assert.equal(list.children[0].dataset.id,'old');
  f.run('downloadFilter="all";renderDownloads()');assert.equal(list.children[0].querySelector('.download-progress').attributes['aria-valuenow'],'80');
});
