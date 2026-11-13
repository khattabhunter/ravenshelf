'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// The same minimal DOM the other renderer tests use.
function fixture(api={}){
  const nodes=new Map(),lists=new Map();
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this._text='';this.className='';this.open=false;this.isConnected=true;this.disabled=false;this.checked=false;this.value='';this.hidden=false;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;this._text='';}remove(){this.isConnected=false;}before(){}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    addEventListener(name,listener){const listeners=this.events.get(name)||[];listeners.push(listener);this.events.set(name,listeners);}async emit(name,event={}){for(const listener of this.events.get(name)||[])await listener(event);}
    showModal(){this.open=true;}close(){this.open=false;}focus(){}contains(){return false;}querySelector(selector){return get(selector);}querySelectorAll(selector){return lists.get(selector)||[];}
  }
  function get(selector){if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);}
  const document={querySelector:get,querySelectorAll:selector=>lists.get(selector)||[],createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},documentElement:{style:{setProperty(){}}}};
  const toasts=[];
  const context=vm.createContext({window:{atlas:{setBrowserIntegration:async()=>({}),...api}},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/i18n.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  context.recordToast=(message,isError)=>toasts.push([message,Boolean(isError)]);
  const run=code=>vm.runInContext(code,context);run('toast=recordToast;');
  const all=root=>[root,...root.children.flatMap(all)];
  const findButton=(root,label)=>all(root).find(node=>node.tagName==='button'&&node.textContent.trim()===label);
  return {get,lists,context,run,Element,all,findButton,toasts};
}

const TORRENT_TOOLS=[{name:'aria2',version:'1.37.0',license:'GPL-2.0-or-later',source:'github.com/aria2/aria2'}];
const torrentState=(changes={},tools={})=>({supported:true,enabled:false,accepted:false,uploadLimit:102400,shareMinutes:0,uploadLimits:[10240,51200,102400,512000,1048576],shareChoices:[0,15,60],requests:[],
  tools:{phase:'missing',progress:0,message:'',downloadBytes:2475379,diskBytes:5649408,tools:TORRENT_TOOLS,...tools},...changes});
const setTorrents=(f,state)=>{f.context.nextTorrents=state;f.run('torrentState=nextTorrents;');};
const FILES=[{index:1,path:'Game [FitGirl Repack]/setup.exe',length:1024,padding:false},{index:2,path:'Game [FitGirl Repack]/fg-optional-bonus.bin',length:2048,padding:false},{index:3,path:'Game [FitGirl Repack]/.pad/1',length:10,padding:true}];

test('the torrent card explains what torrents share and turns them on only after the user accepts it',async()=>{
  const saved=[];
  const f=fixture({openMagnet:async()=>({}),saveTorrentSettings:async options=>{saved.push(options);return torrentState({enabled:true,accepted:true});},setUpTorrents:async()=>torrentState({enabled:true,accepted:true},{phase:'installing'}),
    cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState(),closeMagnet:async()=>torrentState(),addTorrent:async()=>({added:1,ids:['x']})});
  f.run('wireTorrentEvents()');
  setTorrents(f,torrentState());f.run('renderTorrentSettings()');
  assert.equal(f.get('#torrent-card').hidden,false);
  assert.equal(f.get('#torrent-status').textContent,'Torrent downloads are off.');
  assert.equal(f.get('#torrent-enable').hidden,false);assert.equal(f.get('#torrent-setup').hidden,true);assert.equal(f.get('#torrent-options').hidden,true);
  await f.get('#torrent-enable').emit('click');
  assert.equal(f.get('#torrent-accept-dialog').open,true);assert.equal(f.get('#torrent-accept').disabled,true);
  await f.get('#torrent-accept').emit('click');assert.deepEqual(saved,[],'nothing is saved before the box is ticked');
  f.get('#torrent-accept-check').checked=true;await f.get('#torrent-accept-check').emit('change',{target:f.get('#torrent-accept-check')});
  assert.equal(f.get('#torrent-accept').disabled,false);
  await f.get('#torrent-accept').emit('click');
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),[{enabled:true,accepted:true}]);assert.equal(f.get('#torrent-accept-dialog').open,false);
  f.run('renderTorrentSettings()');
  assert.match(f.get('#torrent-status').textContent,/^Not set up yet\. Setup downloads aria2 \(2\.4 MB\) once from its official GitHub release/);
  assert.equal(f.get('#torrent-setup').hidden,false);assert.equal(f.get('#torrent-disable').hidden,false);assert.equal(f.get('#torrent-enable').hidden,true);
  assert.equal(f.get('#torrent-options').hidden,false);
  assert.deepEqual(f.get('#torrent-upload').children.map(option=>option.textContent),['10 KB/s','50 KB/s','100 KB/s','500 KB/s','1 MB/s']);
  assert.deepEqual(f.get('#torrent-share').children.map(option=>option.textContent),['Stop uploading right away','Share for 15 more minutes','Share for an hour more']);
  assert.match(f.get('#torrent-tools').textContent,/aria2 1\.37\.0 · GPL-2\.0-or-later · github\.com\/aria2\/aria2/);
  setTorrents(f,torrentState({enabled:true,accepted:true},{phase:'ready'}));f.run('renderTorrentSettings()');
  assert.match(f.get('#torrent-status').textContent,/^Ready\./);assert.equal(f.get('#torrent-remove').hidden,false);assert.equal(f.get('#torrent-setup').hidden,true);
  setTorrents(f,torrentState({supported:false}));f.run('renderTorrentSettings()');
  assert.match(f.get('#torrent-status').textContent,/on Windows/);assert.equal(f.get('#torrent-enable').hidden,true);
});

test('a magnet link opens a review of its files, and only the ticked files are queued',async()=>{
  const opened=[],added=[];
  const f=fixture({openMagnet:async options=>{opened.push(options);return {id:'r1',status:'finding'};},saveTorrentSettings:async()=>torrentState(),closeMagnet:async()=>torrentState({enabled:true,accepted:true},{phase:'ready'}),
    addTorrent:async options=>{added.push(options);return {added:1,ids:['d1']};},setUpTorrents:async()=>torrentState(),cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState()});
  f.run('wireTorrentEvents()');
  setTorrents(f,torrentState());
  await f.run("startMagnet('magnet:?xt=urn:btih:"+'a'.repeat(40)+"','Game')");
  assert.deepEqual(opened,[]);assert.match(f.toasts.at(-1)[0],/Turn on torrent downloads/);
  setTorrents(f,torrentState({enabled:true,accepted:true},{phase:'ready'}));
  await f.run("startMagnet('magnet:?xt=urn:btih:"+'a'.repeat(40)+"','Game')");
  assert.deepEqual(JSON.parse(JSON.stringify(opened)),[{magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40),gameTitle:'Game'}]);
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'r1',status:'finding',name:'Game',peers:4,source:'app'}]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog').open,true);
  assert.equal(f.get('#torrent-dialog-status').textContent,'Finding the file list… 4 people found so far.');
  assert.equal(f.get('#torrent-download').disabled,true);
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'r1',status:'ready',name:'Game [FitGirl Repack]',peers:4,source:'app',totalLength:3082,files:FILES}]},{phase:'ready'}));f.run('afterTorrentState()');
  const rows=f.get('#torrent-files').children;
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(row=>row.children[1].textContent),['setup.exe','fg-optional-bonus.bin','.pad › 1']);
  assert.deepEqual(rows.map(row=>[row.children[0].checked,row.children[0].disabled]),[[true,false],[true,false],[false,true]]);
  assert.equal(f.get('#torrent-dialog-total').textContent,'2 files chosen · 3.0 KB');
  rows[1].children[0].checked=false;await rows[1].children[0].emit('change');
  assert.equal(f.get('#torrent-dialog-total').textContent,'1 file chosen · 1.0 KB');
  // A later state does not undo the user's ticks.
  f.run('afterTorrentState()');assert.equal(rows[1].children[0].checked,false);
  await f.get('#torrent-download').emit('click');
  assert.deepEqual(JSON.parse(JSON.stringify(added)),[{id:'r1',selected:[1]}]);
  assert.equal(f.get('#torrent-dialog').open,false);assert.equal(f.toasts.at(-1)[0],'Torrent added to your downloads.');
});

test('a magnet link from the browser opens its review by itself; the app’s own requests wait for the user',()=>{
  const f=fixture({openMagnet:async()=>({}),saveTorrentSettings:async()=>torrentState(),closeMagnet:async()=>torrentState(),addTorrent:async()=>({}),setUpTorrents:async()=>torrentState(),cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState()});
  setTorrents(f,torrentState({enabled:true,accepted:true},{phase:'ready'}));f.run('afterTorrentState()');
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'a1',status:'finding',name:'',peers:0,source:'app'}]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog').open,false);
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'a1',status:'finding',name:'',peers:0,source:'app'},{id:'b1',status:'finding',name:'Sent',peers:0,source:'browser'}]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog').open,true);assert.equal(f.get('#torrent-dialog-name').textContent,'Sent');
  assert.equal(f.get('#torrent-dialog-status').textContent,'Finding the file list from people sharing this torrent. This can take a minute.');
  // A request that fails says why, in the app's words.
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'b1',status:'error',name:'Sent',peers:0,source:'browser',error:'This torrent uses a newer format that Ravenshelf can’t download yet.'}]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog-status').textContent,'This torrent uses a newer format that Ravenshelf can’t download yet.');
  // Closed elsewhere: the review closes too.
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog').open,false);
});

test('a torrent’s card shows the people it shares with and its upload speed instead of connections',()=>{
  const f=fixture({openMagnet:async()=>({})});
  f.context.item={id:'t1',kind:'torrent',status:'downloading',name:'Game',received:512,total:1024,speed:2048,activeConnections:0,connectionNote:'',torrent:{peers:5,uploadSpeed:1024,sharing:false}};
  f.run("updateDownloadProgress(document.createElement('div'),item)");
  assert.equal(f.get('.download-connections').textContent,'Connected to 5 people · Uploading 1.0 KB/s');
  f.run("item.torrent.peers=0;updateDownloadProgress(document.createElement('div'),item)");
  assert.match(f.get('.download-connections').textContent,/^Looking for people sharing this torrent…/);
  f.run("item.torrent.sharing=true;item.connectionNote='Download complete. Sharing with other people for up to 15 minutes.';updateDownloadProgress(document.createElement('div'),item)");
  assert.equal(f.get('.download-connections').textContent,'Download complete. Sharing with other people for up to 15 minutes.');
  f.run("item.status='paused';item.connectionNote='';updateDownloadProgress(document.createElement('div'),item)");
  assert.equal(f.get('.download-connections').hidden,true);
});

test('a magnet link from the browser that waits for setup brings Settings forward and is counted on the card',()=>{
  const f=fixture({openMagnet:async()=>({}),saveTorrentSettings:async()=>torrentState(),setUpTorrents:async()=>torrentState(),cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState(),closeMagnet:async()=>torrentState(),addTorrent:async()=>({added:0,ids:[]})});
  const shown=[];f.context.recordView=view=>shown.push(view);f.run('showView=recordView;');
  f.run('wireTorrentEvents()');
  setTorrents(f,torrentState({enabled:true,accepted:true}));f.run('afterTorrentState();renderTorrentSettings()');
  assert.deepEqual(shown,[]);assert.equal(f.get('#torrent-waiting').hidden,true);
  setTorrents(f,torrentState({enabled:true,accepted:true,waiting:1}));f.run('afterTorrentState();renderTorrentSettings()');
  assert.deepEqual(shown,['settings']);
  assert.equal(f.get('#torrent-waiting').hidden,false);
  assert.equal(f.get('#torrent-waiting').textContent,'A magnet link from your browser is waiting. It opens when setup finishes.');
  // The same count again does not move the window; a new link does.
  f.run('afterTorrentState()');assert.deepEqual(shown,['settings']);
  setTorrents(f,torrentState({enabled:true,accepted:true,waiting:2}));f.run('afterTorrentState();renderTorrentSettings()');
  assert.deepEqual(shown,['settings','settings']);
  assert.equal(f.get('#torrent-waiting').textContent,'2 magnet links from your browser are waiting. They open when setup finishes.');
  setTorrents(f,torrentState({enabled:true,accepted:true,waiting:0}));f.run('afterTorrentState();renderTorrentSettings()');
  assert.equal(f.get('#torrent-waiting').hidden,true);
});

test('several magnet links from the browser open one after another, each once',async()=>{
  const req=(id,name)=>({id,status:'finding',name,peers:0,source:'browser'});
  let after=null;
  const f=fixture({openMagnet:async()=>({}),saveTorrentSettings:async()=>torrentState(),closeMagnet:async()=>after,addTorrent:async()=>({}),setUpTorrents:async()=>torrentState(),cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState()});
  f.run('wireTorrentEvents()');
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[req('b1','First'),req('b2','Second')]},{phase:'ready'}));f.run('afterTorrentState()');
  assert.equal(f.get('#torrent-dialog').open,true);assert.equal(f.get('#torrent-dialog-name').textContent,'First');
  // Closing the first opens the second.
  after=torrentState({enabled:true,accepted:true,requests:[req('b2','Second')]},{phase:'ready'});
  await f.get('#torrent-dialog-cancel').emit('click');
  assert.equal(f.get('#torrent-dialog').open,true);assert.equal(f.get('#torrent-dialog-name').textContent,'Second');
  // Closing the second, while it is still listed, does not open it again.
  after=torrentState({enabled:true,accepted:true,requests:[req('b2','Second')]},{phase:'ready'});
  await f.get('#torrent-dialog-cancel').emit('click');
  assert.equal(f.get('#torrent-dialog').open,false);
});

test('a pasted magnet link opens its review even with https trackers in it; with other links the link check runs',()=>{
  const f=fixture({openMagnet:async()=>({})});
  const hash='0123456789abcdef0123456789abcdef01234567';
  f.context.text=`magnet:?xt=urn:btih:${hash}&tr=https://t.example/announce`;
  assert.equal(f.run('pastedMagnet(text)'),f.context.text);
  f.context.text=`  magnet:?xt=urn:btih:${hash}  `;
  assert.equal(f.run('pastedMagnet(text)'),`magnet:?xt=urn:btih:${hash}`);
  f.context.text=`magnet:?xt=urn:btih:${hash}\nhttps://fuckingfast.co/abc`;
  assert.equal(f.run('pastedMagnet(text)'),null);
  f.context.text='https://fuckingfast.co/abc';
  assert.equal(f.run('pastedMagnet(text)'),null);
});

test('closing the review in any way closes its request',async()=>{
  const closed=[];
  const f=fixture({openMagnet:async()=>({}),saveTorrentSettings:async()=>torrentState(),closeMagnet:async id=>{closed.push(id);return torrentState({enabled:true,accepted:true},{phase:'ready'});},addTorrent:async()=>({}),setUpTorrents:async()=>torrentState(),cancelTorrentSetup:async()=>torrentState(),removeTorrentTools:async()=>torrentState()});
  f.run('wireTorrentEvents()');
  setTorrents(f,torrentState({enabled:true,accepted:true,requests:[{id:'r1',status:'finding',name:'Game',peers:0,source:'app'}]},{phase:'ready'}));
  f.run("openTorrentDialog('r1')");
  assert.equal(f.get('#torrent-dialog').open,true);
  // A click outside the dialog closes it without its own buttons.
  f.get('#torrent-dialog').close();await f.get('#torrent-dialog').emit('close');
  assert.deepEqual(closed,['r1']);
  assert.equal(f.run('torrentShownRequest'),null);
});
