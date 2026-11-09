'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const protocol=require('../src/browser-protocol.cjs');
const {BrowserBridge}=require('../src/browser-bridge.cjs');
const {createMediaIntegration,toolsFolder,MAX_WAITING}=require('../src/media-integration.cjs');
const {MESSAGES:TOOL_MESSAGES}=require('../src/media-tools.cjs');

const ID='aqz-KE-bpKQ',OTHER='dQw4w9WgXcQ',CHROME=`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}/`;
const temp=prefix=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));return dir;};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

// ---------- the bridge ----------
async function ask(dir,message){
  const endpoint=JSON.parse(fs.readFileSync(path.join(dir,'endpoint.json'),'utf8'));
  const address=process.platform==='win32'?`\\\\.\\pipe\\${endpoint.pipe}`:path.join(dir,`${endpoint.pipe}.sock`);
  return new Promise((resolve,reject)=>{
    const socket=net.connect(address),chunks=[];
    socket.on('data',chunk=>chunks.push(chunk));socket.on('error',reject);
    socket.on('close',()=>{const data=Buffer.concat(chunks);resolve(data.length?JSON.parse(data.subarray(4,4+data.readUInt32LE(0)).toString('utf8')):null);});
    socket.write(Buffer.concat([{v:1,token:endpoint.token,origin:CHROME},{v:1,...message}].map(frame=>protocol.encodeFrame(frame))));
  });
}
test('the bridge passes a YouTube video on by ID and quality only, and answers with what happened',async t=>{
  const dir=temp('ravenshelf-media-bridge-'),requests=[];let answer={action:'queued'};
  const bridge=new BrowserBridge({hostDir:dir,appVersion:'0.6.0',queueDownload:async()=>({added:1}),openExternal:async()=>{},queueMedia:async request=>{requests.push(request);return answer;}});
  t.after(async()=>{await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});});
  await bridge.start();
  assert.deepEqual(await ask(dir,{type:'media',url:`https://www.youtube.com/watch?v=${ID}&list=PL1&t=9`,quality:'720'}),{ok:true,action:'queued'});
  assert.deepEqual(requests,[{videoId:ID,quality:'720',browser:'chromium'}]);
  for(const action of ['duplicate','setup','busy']){answer={action};assert.deepEqual(await ask(dir,{type:'media',url:`https://youtu.be/${ID}`,quality:'default'}),{ok:true,action});}
  answer={action:'something else'};assert.deepEqual(await ask(dir,{type:'media',url:`https://youtu.be/${ID}`,quality:'best'}),{ok:false,error:'failed'});
  const failing=new BrowserBridge({hostDir:temp('ravenshelf-media-bridge-'),queueDownload:async()=>({}),openExternal:async()=>{},queueMedia:async()=>{throw new Error('C:\\secret');}});
  t.after(async()=>{await failing.stop();fs.rmSync(failing.hostDir,{recursive:true,force:true});});await failing.start();
  assert.deepEqual(await ask(failing.hostDir,{type:'media',url:`https://youtu.be/${ID}`,quality:'best'}),{ok:false,error:'failed'},'no error text reaches the browser');
  const count=requests.length;
  assert.deepEqual(await ask(dir,{type:'media',url:'https://evil.example/watch?v=aqz-KE-bpKQ',quality:'720'}),{ok:false,error:'invalid'});
  assert.deepEqual(await ask(dir,{type:'media',url:`https://www.youtube.com/watch?v=${ID}`,quality:'8k'}),{ok:false,error:'invalid'});
  assert.equal(requests.length,count,'invalid requests never reach the queue');
  const without=new BrowserBridge({hostDir:temp('ravenshelf-media-bridge-'),queueDownload:async()=>({}),openExternal:async()=>{}});
  t.after(async()=>{await without.stop();fs.rmSync(without.hostDir,{recursive:true,force:true});});await without.start();
  assert.deepEqual(await ask(without.hostDir,{type:'media',url:`https://youtu.be/${ID}`,quality:'best'}),{ok:false,error:'invalid'});
});

// ---------- the app side ----------
function fixture(t,{platform='win32',now=()=>Date.now()}={}){
  const profile=temp('ravenshelf-media-integration-');
  t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));
  const program=Buffer.concat([Buffer.from('MZ'),crypto.randomBytes(2000)]);
  const tools=[{id:'yt-dlp',name:'yt-dlp',version:'1.0',license:'Unlicense',source:'github.com/yt-dlp/yt-dlp',url:'https://github.com/yt-dlp/yt-dlp/releases/download/1.0/yt-dlp.exe',size:program.length,sha256:sha(program),files:[{role:'ytDlp',name:'yt-dlp.exe',size:program.length,sha256:sha(program)}]}];
  const fetcher=async url=>new URL(url).hostname==='github.com'?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/a'}}):new Response(program,{status:200,headers:{'content-length':String(program.length)}});
  const events={added:[],revealed:0,published:0,queueBlocked:false,full:false};
  const manager={settings:{notificationsEnabled:true},downloads:[],bandwidthLimiter:null,
    updateSettings(changes){Object.assign(this.settings,changes);},
    addMedia(request){
      if(events.full)throw new Error('Too many YouTube downloads are waiting. Let some finish first.');
      const duplicate=events.added.some(item=>item.videoId===request.videoId&&item.quality===request.quality);
      events.added.push(request);return {added:duplicate?0:1,ids:['m1']};
    }};
  const handles=new Map();
  const integration=createMediaIntegration({app:{getPath:()=>profile},win:{isDestroyed:()=>false,isMinimized:()=>false,restore(){},show(){events.revealed++;},focus(){}},manager,Notification:null,
    register:(name,fn)=>handles.set(name,fn),publish:()=>{events.published++;},assertQueueAvailable:()=>{if(events.queueBlocked)throw new Error('The completion action has started. Wait before adding another download.');},
    isTest:true,platform,now,toolsOptions:{tools,fetcher}});
  t.after(()=>integration.beforeQuit());
  const call=(name,value)=>handles.get(name)(value);
  const ready=async()=>{const end=Date.now()+5000;while(integration.snapshot().tools.phase!=='ready'){if(Date.now()>end)throw new Error('Setup did not finish.');await new Promise(resolve=>setTimeout(resolve,5));}};
  return {profile,events,manager,integration,handles,call,ready};
}

test('a video sent before setup waits, opens Ravenshelf, and starts once setup finishes',async t=>{
  const f=fixture(t);
  assert.deepEqual([...f.handles.keys()].sort(),['cancelYouTubeSetup','dismissYouTubeRequests','removeYouTubeTools','saveYouTubeSettings','setUpYouTube']);
  const first=f.integration.snapshot();
  assert.equal(first.tools.phase,'missing');assert.equal(first.quality,'1080');assert.equal(first.supported,true);
  assert.deepEqual(first.qualities.map(choice=>choice.id),['best','1080','720','480','audio-m4a','audio-mp3']);
  assert.deepEqual(f.integration.queue({videoId:ID,quality:'default'}),{action:'setup'});
  assert.deepEqual(f.integration.queue({videoId:ID,quality:'default'}),{action:'setup'});
  assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'audio-mp3'}),{action:'setup'});
  const waiting=f.integration.snapshot();
  assert.deepEqual(waiting.waiting,[{videoId:ID,quality:'1080'},{videoId:OTHER,quality:'audio-mp3'}],'the same video waits once');
  assert.equal(waiting.requests,3);assert.equal(f.events.revealed,3);assert.equal(f.events.added.length,0,'nothing downloads before setup');
  await f.call('setUpYouTube');await f.ready();
  assert.deepEqual(f.events.added,[{videoId:ID,quality:'1080'},{videoId:OTHER,quality:'audio-mp3'}]);
  assert.deepEqual(f.integration.snapshot().waiting,[]);
});

test('after setup, videos go straight to the queue; a full queue or a running finish action says busy',async t=>{
  const f=fixture(t);
  await f.call('setUpYouTube');await f.ready();
  assert.deepEqual(f.integration.queue({videoId:ID,quality:'720'}),{action:'queued'});
  assert.deepEqual(f.integration.queue({videoId:ID,quality:'720'}),{action:'duplicate'});
  f.call('saveYouTubeSettings',{quality:'audio-m4a'});
  assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'default'}),{action:'queued'});
  assert.deepEqual(f.events.added.at(-1),{videoId:OTHER,quality:'audio-m4a'},'right-click uses the chosen quality');
  f.events.queueBlocked=true;assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'best'}),{action:'busy'});f.events.queueBlocked=false;
  f.events.full=true;assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'480'}),{action:'busy'});f.events.full=false;
  assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'4k'}),{action:'busy'});
  assert.equal(f.events.revealed,0,'Ravenshelf stays in the background while you watch');
  for(const bad of [{quality:'4k'},{},null])assert.throws(()=>f.call('saveYouTubeSettings',bad),/Choose a YouTube download quality/);
});

test('waiting videos are limited, can be dismissed, and expire after an hour',async t=>{
  let clock=1_000_000;
  const f=fixture(t,{now:()=>clock});
  for(let i=0;i<MAX_WAITING;i++)assert.equal(f.integration.queue({videoId:`${String(i).padStart(2,'0')}aaaaaaaaa`,quality:'720'}).action,'setup');
  assert.deepEqual(f.integration.queue({videoId:OTHER,quality:'720'}),{action:'busy'});
  f.call('dismissYouTubeRequests');assert.deepEqual(f.integration.snapshot().waiting,[]);
  f.integration.queue({videoId:ID,quality:'720'});clock+=61*60*1000;
  assert.deepEqual(f.integration.snapshot().waiting,[]);
});

test('the helper programs cannot be removed while YouTube downloads run',async t=>{
  const f=fixture(t);
  await f.call('setUpYouTube');await f.ready();
  f.manager.downloads.push({kind:'media',status:'downloading'});
  await assert.rejects(f.call('removeYouTubeTools'),{message:TOOL_MESSAGES.busy});
  f.manager.downloads[0].status='paused';
  const after=await f.call('removeYouTubeTools');
  assert.equal(after.tools.phase,'missing');
});

test('outside Windows, YouTube requests are declined',t=>{
  const f=fixture(t,{platform:'linux'});
  assert.equal(f.integration.snapshot().supported,false);assert.equal(f.integration.snapshot().tools.phase,'unsupported');
  assert.deepEqual(f.integration.queue({videoId:ID,quality:'720'}),{action:'busy'});
});

test('helper programs live in the local, not roaming, profile',()=>{
  assert.equal(toolsFolder({profile:'C:\\Users\\P\\AppData\\Roaming\\atlas-repack-library',isTest:false,env:{LOCALAPPDATA:'C:\\Users\\P\\AppData\\Local'}}),'C:\\Users\\P\\AppData\\Local\\Ravenshelf\\media-tools');
  assert.equal(toolsFolder({profile:'/profile',isTest:true,env:{LOCALAPPDATA:'C:\\Users\\P\\AppData\\Local'}}),path.join('/profile','media-tools'),'test profiles stay isolated');
  assert.equal(toolsFolder({profile:'/profile',isTest:false,env:{LOCALAPPDATA:'relative'}}),path.join('/profile','media-tools'));
});
