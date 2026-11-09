'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DownloadManager,MAX_MEDIA_JOBS}=require('../src/downloads.cjs');
const {createDownloadCleanup}=require('../src/download-cleanup.cjs');
const {workspaceFor}=require('../src/parallel-download.cjs');
const {MESSAGES}=require('../src/media-downloads.cjs');

const ID='aqz-KE-bpKQ',OTHER='dQw4w9WgXcQ';
async function fixture(t,{media=null,settings={}}={}){
  const base=path.resolve(os.tmpdir()),root=await fs.promises.mkdtemp(path.join(base,'ravenshelf-media-queue-')),downloadDir=path.join(root,'downloads');
  await fs.promises.mkdir(downloadDir,{recursive:true});
  const stateFile=path.join(root,'state.json');
  await fs.promises.writeFile(stateFile,JSON.stringify({settings:{downloadDir,defenderScan:true,...settings},downloads:[]}));
  const marked=[],scanned=[],completed=[];
  const manager=new DownloadManager({stateFile,downloadDir,media,markFile:async file=>{marked.push(file);},scanFile:async file=>{scanned.push(file);return {status:'clean',message:'No threats.'};},onCompleted:d=>completed.push(d.id),
    fetcher:async()=>{throw new Error('YouTube jobs never use the HTTP downloader.');}});
  t.after(async()=>{await manager.stop();assert.equal(path.dirname(path.resolve(root)),base);await fs.promises.rm(root,{recursive:true,force:true});});
  const settle=async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    const deadline=Date.now()+5000;
    while(manager.running.size||manager.scanning||manager.scanQueue.length){if(Date.now()>deadline)throw new Error('The job did not settle.');await new Promise(resolve=>setTimeout(resolve,5));}
  };
  return {manager,root,downloadDir,folder:path.join(downloadDir,'YouTube'),marked,scanned,completed,settle,job:()=>manager.downloads[0]};
}
// A stand-in for the yt-dlp runner that writes what yt-dlp would.
function fakeMedia({title='Song: Part 1/2?',ext='mp4',write='mp4',fail=null,wait=null}={}){
  const calls=[];
  return {calls,async download(d,options){
    calls.push({media:{...d.media},rateLimit:options.rateLimit,workspace:options.workspace});
    if(wait)await wait(options.signal);
    if(fail)throw fail;
    if(!d.media.title)options.onDetails({title,ext,formats:[{id:'137',size:6,audio:false},{id:'140',size:4,audio:true}],total:10,duration:61});
    options.onNote('Downloading the video…');options.onProgress(5,10);
    fs.writeFileSync(path.join(options.workspace,'media.f137.mp4.part'),'leftover');
    fs.writeFileSync(path.join(options.workspace,`media.${write}`),'0123456789');
    return {file:path.join(options.workspace,`media.${write}`),ext:write};
  }};
}

test('a YouTube video joins the queue in Ravenshelf’s YouTube folder, once per quality',async t=>{
  const f=await fixture(t,{media:{download:(d,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}});
  const first=f.manager.addMedia({videoId:ID,quality:'720'});
  assert.equal(first.added,1);
  const d=f.job();
  assert.deepEqual({kind:d.kind,url:d.url,name:d.name,gameTitle:d.gameTitle,folder:d.folder,origin:d.origin,markOfTheWeb:d.markOfTheWeb,media:d.media},
    {kind:'media',url:`https://www.youtube.com/watch?v=${ID}`,name:`YouTube video ${ID}.mp4`,gameTitle:'YouTube',folder:f.folder,origin:'browser',markOfTheWeb:true,media:{videoId:ID,quality:'720'}});
  assert.deepEqual(f.manager.addMedia({videoId:ID,quality:'720'}),{added:0,ids:[d.id]},'the same video and quality is not added twice');
  assert.equal(f.manager.addMedia({videoId:ID,quality:'audio-mp3'}).added,1,'another quality is a separate download');
  assert.equal(f.manager.downloads[1].name,`YouTube video ${ID}.mp3`);
  for(const bad of [{videoId:'bad',quality:'720'},{videoId:ID,quality:'4k'},{videoId:ID},{videoId:`${ID}&list=1`,quality:'720'},{}])
    assert.throws(()=>f.manager.addMedia(bad),/Only YouTube video addresses/);
});

test('too many waiting YouTube videos are refused',async t=>{
  const f=await fixture(t);
  f.manager.settings.concurrency=1;f.manager.settings.downloadSchedule={...f.manager.settings.downloadSchedule};
  f.manager.stopping=true; // keep everything queued
  const ids=Array.from({length:MAX_MEDIA_JOBS},(_,i)=>`${String(i).padStart(2,'0')}aaaaaaaaa`.slice(0,11));
  for(const id of ids)f.manager.addMedia({videoId:id,quality:'480'});
  assert.throws(()=>f.manager.addMedia({videoId:OTHER,quality:'480'}),/Too many YouTube downloads are waiting/);
  f.manager.stopping=false;
});

test('a finished video gets its title as file name, keeps the internet mark and is scanned',async t=>{
  const media=fakeMedia(),f=await fixture(t,{media,settings:{maxDownloadBytesPerSecond:1048576,concurrency:2}});
  fs.mkdirSync(f.folder,{recursive:true});fs.writeFileSync(path.join(f.folder,'Song_ Part 1_2_.mp4'),'someone else’s file');
  f.manager.addMedia({videoId:ID,quality:'1080'});await f.settle();
  const d=f.job();
  assert.equal(d.status,'completed',d.error);assert.equal(d.name,'Song_ Part 1_2_ (1).mp4','an existing file is never overwritten');
  const final=path.join(f.folder,d.name);
  assert.equal(fs.readFileSync(final,'utf8'),'0123456789');assert.equal(fs.readFileSync(path.join(f.folder,'Song_ Part 1_2_.mp4'),'utf8'),'someone else’s file');
  assert.deepEqual([d.received,d.total],[10,10]);
  assert.deepEqual(f.marked,[final]);assert.deepEqual(f.scanned,[final]);assert.deepEqual(f.completed,[d.id]);assert.equal(d.scan.status,'clean');
  assert.equal(fs.existsSync(workspaceFor(path.join(f.folder,d.name+'.atlas-part'),d.id)),false,'the working folder is removed');
  assert.equal(media.calls[0].rateLimit,524288,'the shared speed limit is split across the download slots');
  assert.deepEqual(d.media,{videoId:ID,quality:'1080',title:'Song: Part 1/2?',ext:'mp4',formats:[{id:'137',size:6,audio:false},{id:'140',size:4,audio:true}],duration:61});
  assert.equal(d.connectionNote,'');
});

test('a video joined as MKV is saved as MKV',async t=>{
  const f=await fixture(t,{media:fakeMedia({title:'Clip',write:'mkv'})});
  f.manager.addMedia({videoId:ID,quality:'best'});await f.settle();
  assert.equal(f.job().status,'completed');assert.equal(f.job().name,'Clip.mkv');
  assert.ok(fs.existsSync(path.join(f.folder,'Clip.mkv')));
});

test('a long title is shortened without cutting an emoji in half',async t=>{
  // The emoji sits across the 150th position.
  const f=await fixture(t,{media:fakeMedia({title:'a'.repeat(149)+'😀'+'b'.repeat(10)})});
  f.manager.addMedia({videoId:ID,quality:'720'});await f.settle();
  assert.equal(f.job().status,'completed');
  assert.equal(f.job().name,'a'.repeat(149)+'.mp4');
  assert.ok(fs.existsSync(path.join(f.folder,f.job().name)));
});

test('pausing stops the job without an error, and resuming continues without reading the details again',async t=>{
  let release=null;
  const media=fakeMedia({title:'Long talk',wait:signal=>new Promise((resolve,reject)=>{
    if(release===null){release=resolve;signal.addEventListener('abort',()=>reject(signal.reason||new Error('Paused')),{once:true});}else resolve();
  })});
  const f=await fixture(t,{media});
  f.manager.addMedia({videoId:ID,quality:'720'});
  while(!release)await new Promise(resolve=>setTimeout(resolve,5));
  f.manager.action(f.job().id,'pause');await f.settle();
  assert.equal(f.job().status,'paused');assert.equal(f.job().error,'');
  // Details from the first run are kept; a placeholder name stays until they arrive.
  assert.equal(f.job().name,`YouTube video ${ID}.mp4`);
  f.manager.action(f.job().id,'resume');await f.settle();
  assert.equal(f.job().status,'completed');assert.equal(f.job().name,'Long talk.mp4');assert.equal(media.calls.length,2);
});

test('YouTube problems show fixed messages; unknown failures never leak their text',async t=>{
  for(const [fail,message] of [[new Error(MESSAGES.private),MESSAGES.private],[new Error('C:\\Users\\Player\\secret.txt broke'),MESSAGES.failed],[Object.assign(new Error('x'),{code:'ENOSPC'}),'There is not enough free disk space. Free some space and try again.']]){
    const f=await fixture(t,{media:fakeMedia({fail})});
    f.manager.addMedia({videoId:ID,quality:'720'});await f.settle();
    assert.equal(f.job().status,'error');assert.equal(f.job().error,message);
  }
  const f=await fixture(t);
  f.manager.addMedia({videoId:ID,quality:'720'});await f.settle();
  assert.equal(f.job().error,'Set up YouTube downloads in Settings first, then retry.');
});

test('cleanup deletes a YouTube download and its working files, and nothing else',async t=>{
  const f=await fixture(t,{media:fakeMedia({title:'Keep or delete'})});
  f.manager.addMedia({videoId:ID,quality:'720'});await f.settle();
  const d=f.job(),final=path.join(f.folder,d.name);
  // A leftover from an earlier paused attempt sits in the job's working folder.
  const workspace=workspaceFor(path.join(f.folder,d.name+'.atlas-part'),d.id);
  fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'media.f140.m4a.part'),'xx');
  fs.writeFileSync(path.join(f.folder,'unrelated.mp4'),'mine');
  const cleanup=createDownloadCleanup({getDownloads:()=>f.manager.downloads,getDownloadDir:()=>f.downloadDir});
  const preview=await cleanup.preview([d.id]);
  assert.deepEqual(preview.warnings,[]);assert.equal(preview.totalBytes,12);
  const result=await cleanup.deletePreview({ids:[d.id],token:preview.token});
  assert.deepEqual(result.removedIds,[d.id]);
  assert.equal(fs.existsSync(final),false);assert.equal(fs.existsSync(workspace),false);
  assert.equal(fs.readFileSync(path.join(f.folder,'unrelated.mp4'),'utf8'),'mine');
  // Outside the YouTube folder, or with a program's name, a "media" entry cannot delete anything.
  for(const forged of [{...d,id:'f1',name:'tool.exe'},{...d,id:'f2',folder:path.join(f.downloadDir,'Games')},{...d,id:'f3',kind:undefined}]){
    const list=[forged],guard=createDownloadCleanup({getDownloads:()=>list});
    const check=await guard.preview([forged.id]);
    assert.equal(check.items.length,0,forged.id);assert.equal(check.warnings.length,1,forged.id);
  }
});
