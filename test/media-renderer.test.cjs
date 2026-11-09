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
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  context.recordToast=(message,isError)=>toasts.push([message,Boolean(isError)]);
  const run=code=>vm.runInContext(code,context);run('toast=recordToast;');
  const all=root=>[root,...root.children.flatMap(all)];
  const findButton=(root,label)=>all(root).find(node=>node.tagName==='button'&&node.textContent.trim()===label);
  return {get,lists,context,run,Element,all,findButton,toasts};
}
const TOOLS=[{name:'yt-dlp',version:'2026.10.26',license:'Unlicense',source:'github.com/yt-dlp/yt-dlp'},{name:'Deno',version:'2.9.8',license:'MIT',source:'github.com/denoland/deno'},{name:'FFmpeg',version:'8.1.2',license:'GPL-3.0',source:'github.com/GyanD/codexffmpeg'}];
const QUALITIES=[{id:'best',label:'Best quality'},{id:'1080',label:'1080p'},{id:'720',label:'720p'},{id:'480',label:'480p'},{id:'audio-m4a',label:'Audio (M4A)'},{id:'audio-mp3',label:'Audio (MP3)'}];
const mediaState=(tools={},changes={})=>({supported:true,quality:'1080',requests:0,waiting:[],qualities:QUALITIES,
  tools:{phase:'missing',progress:0,message:'',downloadBytes:176221256,diskBytes:325247968,tools:TOOLS,...tools},...changes});
const setMedia=(f,state)=>{f.context.nextMedia=state;f.run('mediaState=nextMedia;');};
const media={setUpYouTube:async()=>mediaState({phase:'installing'}),cancelYouTubeSetup:async()=>mediaState(),removeYouTubeTools:async()=>mediaState(),saveYouTubeSettings:async()=>mediaState(),dismissYouTubeRequests:async()=>mediaState()};

test('the YouTube card explains setup, progress, problems and readiness in plain words',()=>{
  const f=fixture(media);
  setMedia(f,mediaState());f.run('renderYouTubeSettings()');
  assert.equal(f.get('#youtube-card').hidden,false);
  assert.match(f.get('#youtube-status').textContent,/Not set up yet\. Setup downloads 168 MB once \(about 310 MB on disk\) from the programs’ official GitHub releases/);
  assert.equal(f.get('#youtube-setup').hidden,false);assert.equal(f.get('#youtube-setup').textContent,'Set up YouTube downloads');
  assert.equal(f.get('#youtube-remove').hidden,true);assert.equal(f.get('#youtube-progress').hidden,true);
  assert.match(f.get('#youtube-tools').textContent,/yt-dlp 2026\.10\.26 · Unlicense · github\.com\/yt-dlp\/yt-dlp/);
  assert.equal(f.get('#youtube-quality').children.length,6);
  setMedia(f,mediaState({phase:'installing',progress:0.42,message:'Downloading Deno 2.9.8…'}));f.run('renderYouTubeSettings()');
  assert.equal(f.get('#youtube-status').textContent,'Downloading Deno 2.9.8… 42%');
  assert.equal(f.get('#youtube-progress').hidden,false);assert.equal(f.get('#youtube-progress').value,42);
  assert.equal(f.get('#youtube-setup').hidden,true);assert.equal(f.get('#youtube-cancel').hidden,false);
  setMedia(f,mediaState({phase:'damaged',message:'The YouTube helper programs changed or are damaged. Set up YouTube downloads again in Settings.'}));f.run('renderYouTubeSettings()');
  assert.match(f.get('#youtube-status').className,/error/);assert.equal(f.get('#youtube-setup').textContent,'Set up again');assert.equal(f.get('#youtube-remove').hidden,false);
  setMedia(f,mediaState({phase:'ready'},{waiting:[]}));f.run('renderYouTubeSettings()');
  assert.match(f.get('#youtube-status').textContent,/^Ready\./);assert.match(f.get('#youtube-status').className,/ok/);
  assert.equal(f.get('#youtube-setup').hidden,true);assert.equal(f.get('#youtube-remove').hidden,false);assert.equal(f.get('#youtube-waiting').hidden,true);
  setMedia(f,mediaState({},{waiting:[{videoId:'aqz-KE-bpKQ',quality:'720'},{videoId:'dQw4w9WgXcQ',quality:'720'}]}));f.run('renderYouTubeSettings()');
  assert.equal(f.get('#youtube-waiting').textContent,'2 YouTube videos are waiting. They start when setup finishes.');assert.equal(f.get('#youtube-dismiss').hidden,false);
  setMedia(f,mediaState({phase:'unsupported'},{supported:false}));f.run('renderYouTubeSettings()');
  assert.match(f.get('#youtube-status').textContent,/on Windows/);assert.equal(f.get('#youtube-setup').hidden,true);
});

test('a video sent before setup opens the setup once, and setup finishing closes it with a note',()=>{
  const f=fixture(media);
  setMedia(f,mediaState());f.run('afterMediaState()');
  assert.equal(f.get('#youtube-dialog').open,false,'nothing opens on start');
  setMedia(f,mediaState({},{requests:1,waiting:[{videoId:'aqz-KE-bpKQ',quality:'1080'}]}));f.run('afterMediaState()');
  assert.equal(f.get('#youtube-dialog').open,true);
  assert.match(f.get('#youtube-dialog-intro').textContent,/^A YouTube video is waiting\./);
  assert.equal(f.get('#youtube-dialog-setup').textContent,'Set up and download');
  setMedia(f,mediaState({phase:'installing',progress:0.5,message:'Downloading FFmpeg 8.1.2…'},{requests:1,waiting:[{videoId:'aqz-KE-bpKQ',quality:'1080'}]}));f.run('afterMediaState()');
  assert.equal(f.get('#youtube-dialog-progress').hidden,false);assert.equal(f.get('#youtube-dialog-later').hidden,true);assert.equal(f.get('#youtube-dialog-cancel').hidden,false);
  setMedia(f,mediaState({phase:'ready'},{requests:1}));f.run('afterMediaState()');
  assert.equal(f.get('#youtube-dialog').open,false);
  assert.deepEqual(f.toasts.at(-1),['YouTube downloads are ready. Videos you send from YouTube start right away.',false]);
  setMedia(f,mediaState({phase:'ready'},{requests:2}));f.run('afterMediaState()');
  assert.equal(f.get('#youtube-dialog').open,false,'once set up, new videos never open the setup');
});

test('YouTube downloads show their quality and progress notes on their card',()=>{
  const f=fixture(media);
  f.context.item={id:'m1',kind:'media',status:'downloading',name:'Clip.mp4',gameTitle:'YouTube',received:5,total:10,speed:2,connectionMode:'media',activeConnections:0,connectionNote:'Joining video and audio…',origin:'browser',media:{videoId:'aqz-KE-bpKQ',quality:'720'}};
  f.run('card=makeDownloadCard(item)');
  assert.equal(f.get('.download-game').textContent,'YouTube · 720p');
  assert.equal(f.get('.download-connections').textContent,'Joining video and audio…');assert.equal(f.get('.download-connections').hidden,false);
  assert.match(f.get('.download-reputation').textContent,/From YouTube/);
  f.context.item={...f.context.item,status:'completed',connectionNote:'Joining video and audio…'};f.run('updateDownloadCard(card,item)');
  assert.equal(f.get('.download-connections').hidden,true,'a finished video shows no work note');
});
