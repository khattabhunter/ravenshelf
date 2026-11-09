'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const media=require('../src/media-downloads.cjs');
const {MESSAGES,NOTES}=media;

const ID='aqz-KE-bpKQ',URL_OF=`https://www.youtube.com/watch?v=${ID}`;
async function root(t){
  const base=path.resolve(os.tmpdir()),dir=await fs.promises.mkdtemp(path.join(base,'ravenshelf-media-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),base);return fs.promises.rm(dir,{recursive:true,force:true});});
  return dir;
}
function toolsAt(dir){
  const temp=path.join(dir,'tmp'),cache=path.join(dir,'cache');fs.mkdirSync(temp,{recursive:true});fs.mkdirSync(cache,{recursive:true});
  const paths={dir:path.join(dir,'set'),ytDlp:path.join(dir,'set','yt-dlp.exe'),deno:path.join(dir,'set','deno.exe'),ffmpeg:path.join(dir,'set','ffmpeg.exe'),ffprobe:path.join(dir,'set','ffprobe.exe'),cache,temp};
  return {temp,verified:async()=>({...paths})};
}
// A stand-in for yt-dlp: each run is driven by the test's script.
function fakeYtDlp(script){
  const calls=[];
  const finish=(child,code)=>{if(child.closed)return;child.closed=true;child.exitCode=code;child.stdout.end();child.stderr.end();setTimeout(()=>child.emit('close',code),5);};
  const spawnImpl=(file,args,options)=>{
    const child=new EventEmitter();
    Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),pid:4000+calls.length,exitCode:null,signalCode:null,closed:false});
    const call={file,args,options,child,out:text=>child.stdout.write(text),err:text=>child.stderr.write(text),exit:code=>finish(child,code)};
    calls.push(call);
    setImmediate(()=>script(call,calls.length));
    return child;
  };
  const killed=[];
  const kill=async child=>{killed.push(child.pid);finish(child,1);};
  return {calls,spawnImpl,kill,killed};
}
const probeJSON=(patch={})=>JSON.stringify({id:ID,title:'My \u202Evideo',ext:'mp4',duration:63.4,live_status:'not_live',
  requested_formats:[{format_id:'137',filesize:1000,vcodec:'avc1.640028'},{format_id:'140',filesize_approx:200.5,vcodec:'none'}],...patch});

test('yt-dlp runs without configuration, plugins, cookies or remote code, for the canonical video address only',async t=>{
  const dir=await root(t),tools=toolsAt(dir),workspace=path.join(dir,'YouTube','.work');fs.mkdirSync(workspace,{recursive:true});
  const y=fakeYtDlp((call,n)=>{
    if(n===1){call.out(probeJSON());call.exit(0);return;}
    call.out('[youtube] aqz-KE-bpKQ: Downloading webpage\n');
    call.out('RAVENSHELF-PROGRESS 500 1000 NA 137\nRAVENSHELF-PROGRESS 1000 1000 NA 137\n');
    call.out('RAVENSHELF-PROGRESS 100 NA 200.5 140\r\nRAVENSHELF-PROGRESS 200 200 NA 140\n');
    call.out('RAVENSHELF-POST Merger\n');
    fs.writeFileSync(path.join(workspace,'media.mp4'),'joined');
    call.exit(0);
  });
  const runner=media.createMediaRunner({tools,spawnImpl:y.spawnImpl,kill:y.kill,env:{SystemRoot:'C:\\Windows',HTTPS_PROXY:'http://proxy.example:8080',PATH:'C:\\Users\\Player\\bin;C:\\Windows',TEMP:'C:\\Users\\Player\\AppData\\Local\\Temp',USERPROFILE:'C:\\Users\\Player',SECRET_TOKEN:'x'}});
  const details=[],progress=[],notes=[];
  const result=await runner.download({media:{videoId:ID,quality:'1080'}},{workspace,rateLimit:2048,onDetails:value=>details.push(value),onProgress:(received,total)=>progress.push([received,total]),onNote:note=>notes.push(note)});
  assert.deepEqual(result,{file:path.join(workspace,'media.mp4'),ext:'mp4'});
  assert.deepEqual(details,[{title:'My video',ext:'mp4',formats:[{id:'137',size:1000,audio:false},{id:'140',size:201,audio:true}],total:1201,duration:63}]);
  // Planned sizes count until yt-dlp reports its own estimate for that part.
  assert.deepEqual(progress,[[500,1201],[1000,1201],[1100,1200],[1200,1200]]);
  assert.deepEqual(notes,[NOTES.details,NOTES.starting,NOTES.video,NOTES.audio,NOTES.merge]);
  assert.equal(y.calls.length,2);
  for(const call of y.calls){
    const args=call.args;
    assert.equal(call.file,path.join(dir,'set','yt-dlp.exe'));
    assert.deepEqual(args.slice(0,6),['--ignore-config','--no-plugin-dirs','--no-remote-components','--no-js-runtimes','--js-runtimes',`deno:${path.join(dir,'set','deno.exe')}`]);
    for(const flag of ['--no-cookies','--no-cookies-from-browser','--no-playlist','--no-mtime'])assert.ok(args.includes(flag),flag);
    assert.deepEqual(args.slice(-2),['--',URL_OF],'the address is last, after "--"');
    assert.equal(args.filter(arg=>arg===URL_OF).length,1,'the address appears once');
    assert.ok(!args.some(arg=>arg!==URL_OF&&/youtube/i.test(arg)),'no other argument names YouTube');
    assert.ok(!args.some(arg=>/^--?(exec|cookies$|cookies=|paths|P$|config-locations|batch-file|load-info-json|plugin-dirs$)/.test(arg)),args.join(' '));
    assert.equal(args[args.indexOf('--ffmpeg-location')+1],path.join(dir,'set'));
    // Only what Windows needs to start, with private temporary folders and no proxy or personal settings.
    const env=call.options.env;
    assert.equal(env.HTTPS_PROXY,undefined);assert.equal(env.SECRET_TOKEN,undefined);
    assert.equal(env.PATH,'C:\\Windows\\System32;C:\\Windows');
    assert.match(env.TEMP,/[\\/]tmp[\\/]run-[0-9a-f-]{36}$/);assert.equal(env.TMP,env.TEMP);
    assert.equal(env.PYTHONUTF8,'1');assert.equal(env.DENO_NO_UPDATE_CHECK,'1');assert.equal(env.USERPROFILE,'C:\\Users\\Player');
    assert.equal(env.DENO_DISABLE_NODE_SHIM,'1','Deno must not add a hard link (node.exe) to the checked deno.exe');
    assert.equal(call.options.windowsHide,true);assert.deepEqual(call.options.stdio,['ignore','pipe','pipe']);assert.equal(call.options.shell,undefined);
  }
  assert.ok(y.calls[0].args.includes('-J'));assert.equal(y.calls[0].options.cwd,y.calls[0].options.env.TEMP);
  const download=y.calls[1].args;
  assert.equal(y.calls[1].options.cwd,workspace,'files are written in the job’s working folder');
  assert.deepEqual(download.slice(download.indexOf('-o'),download.indexOf('-o')+2),['-o','media.%(ext)s']);
  assert.deepEqual(download.slice(download.indexOf('--limit-rate'),download.indexOf('--limit-rate')+2),['--limit-rate','2048']);
  assert.equal(download.includes('--concurrent-fragments'),false);
  assert.ok(download.join(' ').includes('res:1080'));
  assert.deepEqual(fs.readdirSync(tools.temp),[],'the job’s temporary folder is removed');
});

test('a video whose details are known downloads without asking YouTube again',async t=>{
  const dir=await root(t),tools=toolsAt(dir),workspace=path.join(dir,'w');fs.mkdirSync(workspace);
  const y=fakeYtDlp(call=>{fs.writeFileSync(path.join(workspace,'media.mp3'),'audio');call.out('[ExtractAudio] Destination: media.mp3\n');call.exit(0);});
  const notes=[];
  const runner=media.createMediaRunner({tools,spawnImpl:y.spawnImpl,kill:y.kill,env:{}});
  const result=await runner.download({media:{videoId:ID,quality:'audio-mp3',title:'Song',ext:'mp3',formats:[{id:'251',size:10,audio:true}]}},{workspace,onNote:note=>notes.push(note)});
  assert.equal(result.ext,'mp3');assert.equal(y.calls.length,1);assert.ok(!y.calls[0].args.includes('-J'));
  assert.ok(y.calls[0].args.join(' ').includes('-x --audio-format mp3'));
  assert.deepEqual(notes,[NOTES.starting,NOTES.mp3]);
  assert.equal(y.calls[0].options.env.PATH,'C:\\Windows\\System32;C:\\Windows','without SystemRoot the standard Windows folder is used');
});

test('YouTube’s refusals become plain messages; warnings and yt-dlp’s own wording never reach the user',async t=>{
  const cases=[
    ['ERROR: [youtube] aqz-KE-bpKQ: Sign in to confirm your age. This video may be inappropriate for some users.',MESSAGES.age],
    ['ERROR: [youtube] aqz-KE-bpKQ: Join this channel to get access to members-only content like this video',MESSAGES.members],
    ['ERROR: [youtube] aqz-KE-bpKQ: Private video. Sign in if you\'ve been granted access to this video',MESSAGES.private],
    ['ERROR: [youtube] aqz-KE-bpKQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser',MESSAGES.bot],
    ['ERROR: [youtube] aqz-KE-bpKQ: This live event will begin in 3 hours.',MESSAGES.live],
    ['ERROR: [youtube] aqz-KE-bpKQ: Video unavailable. This video has been removed by the uploader',MESSAGES.unavailable],
    ['ERROR: [youtube] aqz-KE-bpKQ: The uploader has not made this video available in your country',MESSAGES.region],
    ['ERROR: [youtube] aqz-KE-bpKQ: Requested format is not available. Use --list-formats',MESSAGES.format],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden',MESSAGES.refused],
    ['ERROR: unable to download video data: HTTP Error 429: Too Many Requests',MESSAGES.limited],
    ['ERROR: [Errno 28] No space left on device',MESSAGES.space],
    ['ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>',MESSAGES.network],
    ['ERROR: Postprocessing: Conversion failed!',MESSAGES.finish],
    ['ERROR: [youtube] aqz-KE-bpKQ: This video is DRM protected',MESSAGES.drm],
    ['ERROR: [youtube] aqz-KE-bpKQ: This content isn\'t available, try again later. The current session has been rate-limited by YouTube for up to an hour.',MESSAGES.limited],
    ['ERROR: [youtube] aqz-KE-bpKQ: This video is only available for registered users. Use --cookies-from-browser',MESSAGES.signin],
    ['ERROR: [youtube] aqz-KE-bpKQ: Video unavailable. YouTube is requiring a captcha challenge before playback',MESSAGES.bot],
    ['ERROR: [youtube] aqz-KE-bpKQ: Premieres in 3 hours',MESSAGES.live],
    ['ERROR: [youtube] aqz-KE-bpKQ: This video is not available from your location due to geo restriction',MESSAGES.region],
    ['ERROR: something new C:\\Users\\Player\\secret',MESSAGES.failed],
    ['WARNING: [youtube] Sign in to confirm your age is mentioned only as a warning',MESSAGES.failed]
  ];
  for(const [stderr,message] of cases)assert.equal(media.mapError(stderr).message,message,stderr);
  assert.equal(media.mapError('WARNING: private video\nERROR: Video unavailable').message,MESSAGES.unavailable,'the error line decides');
  const dir=await root(t),tools=toolsAt(dir);
  const y=fakeYtDlp(call=>{call.err('WARNING: something\nERROR: [youtube] aqz-KE-bpKQ: Private video\n');call.exit(1);});
  const runner=media.createMediaRunner({tools,spawnImpl:y.spawnImpl,kill:y.kill,env:{}});
  await assert.rejects(runner.download({media:{videoId:ID,quality:'720'}},{workspace:dir}),{message:MESSAGES.private});
  assert.deepEqual(fs.readdirSync(tools.temp),[]);
});

test('live streams, playlists and unexpected answers are refused before anything downloads',async t=>{
  const dir=await root(t),tools=toolsAt(dir);
  for(const [answer,message] of [
    [probeJSON({live_status:'is_live'}),MESSAGES.live],[probeJSON({is_live:true}),MESSAGES.live],[probeJSON({live_status:'is_upcoming'}),MESSAGES.live],
    [probeJSON({id:'zzzzzzzzzzz'}),MESSAGES.failed],[probeJSON({_type:'playlist'}),MESSAGES.failed],['[]',MESSAGES.failed],['not json',MESSAGES.failed]
  ]){
    const y=fakeYtDlp(call=>{call.out(answer);call.exit(0);});
    const runner=media.createMediaRunner({tools,spawnImpl:y.spawnImpl,kill:y.kill,env:{}});
    await assert.rejects(runner.download({media:{videoId:ID,quality:'best'}},{workspace:dir}),{message},answer.slice(0,40));
    assert.equal(y.calls.length,1,'no download starts');
  }
  const runner=media.createMediaRunner({tools,spawnImpl:()=>{throw new Error('must not run');},env:{}});
  for(const job of [{media:{videoId:'bad',quality:'720'}},{media:{videoId:ID,quality:'4k'}},{},null])await assert.rejects(runner.download(job,{workspace:dir}),{message:MESSAGES.failed});
});

test('pausing stops yt-dlp and everything it started; the job’s temporary folder is removed',async t=>{
  const dir=await root(t),tools=toolsAt(dir),workspace=path.join(dir,'w');fs.mkdirSync(workspace);
  const y=fakeYtDlp((call,n)=>{if(n===1){call.out(probeJSON());call.exit(0);}else call.out('RAVENSHELF-PROGRESS 10 1000 NA 137\n');});
  const runner=media.createMediaRunner({tools,spawnImpl:y.spawnImpl,kill:y.kill,env:{}});
  const controller=new AbortController(),progress=[];
  const job=runner.download({media:{videoId:ID,quality:'720'}},{signal:controller.signal,workspace,onProgress:(received)=>progress.push(received)});
  while(!progress.length)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(runner.active,1);
  controller.abort(new Error('Paused'));
  await assert.rejects(job,{message:'Paused'});
  assert.deepEqual(y.killed,[y.calls[1].child.pid]);assert.equal(runner.active,0);
  assert.deepEqual(fs.readdirSync(tools.temp),[]);
  await assert.rejects(runner.download({media:{videoId:ID,quality:'720'}},{signal:controller.signal,workspace}),{message:'Paused'},'an already-paused job does not start');
});

test('a silent or runaway yt-dlp is stopped',async()=>{
  const y=fakeYtDlp(()=>{});
  await assert.rejects(media.runTool('x',[],{quietMs:40,spawnImpl:y.spawnImpl,kill:y.kill}),{message:MESSAGES.stalled});
  const z=fakeYtDlp(call=>{call.out('x'.repeat(2000));});
  await assert.rejects(media.runTool('x',[],{keepStdout:1000,spawnImpl:z.spawnImpl,kill:z.kill}),{message:MESSAGES.failed});
  const w=fakeYtDlp(call=>{const tick=setInterval(()=>call.out('RAVENSHELF-PROGRESS 1 2 NA 1\n'),5);call.child.once('close',()=>clearInterval(tick));});
  await assert.rejects(media.runTool('x',[],{timeoutMs:60,spawnImpl:w.spawnImpl,kill:w.kill}),{message:MESSAGES.stalled},'a total limit applies to reading video details');
  const missing=fakeYtDlp(call=>{call.child.emit('error',Object.assign(new Error('spawn C:\\tools\\yt-dlp.exe ENOENT'),{code:'ENOENT'}));});
  await assert.rejects(media.runTool('x',[],{spawnImpl:missing.spawnImpl,kill:missing.kill}),{code:'ENOENT'});
});

test('the finished file is the one media file yt-dlp produced for the chosen kind',async t=>{
  const dir=await root(t),make=names=>{const folder=path.join(dir,crypto.randomUUID());fs.mkdirSync(folder);for(const name of names)fs.writeFileSync(path.join(folder,name),'x');return folder;};
  const mkv=make(['media.mkv','media.f137.mp4.part']);
  assert.deepEqual(await media.finalFile(mkv,'best','mp4'),{file:path.join(mkv,'media.mkv'),ext:'mkv'},'a joined MKV is accepted for a video choice');
  const both=make(['media.mp4','media.webm']);assert.equal((await media.finalFile(both,'720','mp4')).ext,'mp4');
  await assert.rejects(media.finalFile(make(['media.f137.mp4.part','media.temp.mp4']),'720','mp4'),{message:MESSAGES.finish});
  await assert.rejects(media.finalFile(make(['media.mp4']),'audio-mp3','mp3'),{message:MESSAGES.finish},'an audio choice never publishes a video');
  assert.equal((await media.finalFile(make(['media.m4a']),'audio-m4a','m4a')).ext,'m4a');
});

test('a job’s working folder loses only yt-dlp’s media files; stale temporary folders are cleared',async t=>{
  const dir=await root(t),workspace=path.join(dir,'w');fs.mkdirSync(workspace);
  for(const name of ['media.f137.mp4.part','media.f140.m4a','media.temp.mp4','media.mp4.ytdl'])fs.writeFileSync(path.join(workspace,name),'x');
  await media.removeMediaWorkspace(workspace);assert.equal(fs.existsSync(workspace),false);
  fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'media.part'),'x');fs.writeFileSync(path.join(workspace,'notes.txt'),'mine');
  await assert.rejects(media.removeMediaWorkspace(workspace));
  assert.deepEqual(fs.readdirSync(workspace),['notes.txt'],'anything else stays');
  await media.removeMediaWorkspace(path.join(dir,'missing'));
  const tools=toolsAt(dir),stale=path.join(tools.temp,`run-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(stale,'_MEI1234'),{recursive:true});fs.mkdirSync(path.join(tools.temp,'keep'));
  const runner=media.createMediaRunner({tools,env:{}});
  assert.equal(await runner.cleanStale(),1);assert.deepEqual(fs.readdirSync(tools.temp),['keep']);
});

test('progress adds up the video and audio parts, and only known numbers are read',()=>{
  assert.deepEqual(media.parseProgress('RAVENSHELF-PROGRESS 10 NA 99.7 137'),{downloaded:10,total:99,format:'137'});
  assert.deepEqual(media.parseProgress('RAVENSHELF-PROGRESS NA NA NA NA'),{downloaded:0,total:0,format:''});
  for(const line of ['[download] 10%','RAVENSHELF-PROGRESS 1 2 3','xRAVENSHELF-PROGRESS 1 2 3 4'])assert.equal(media.parseProgress(line),null);
  const track=media.progressTracker([{id:'137',size:100},{id:'140',size:50}]);
  assert.deepEqual(track({downloaded:20,total:100,format:'137'}),{received:20,total:150});
  assert.deepEqual(track({downloaded:100,total:0,format:'137'}),{received:100,total:150});
  assert.deepEqual(track({downloaded:30,total:60,format:'140'}),{received:130,total:160});
  const open=media.downloadArgs({deno:'d',dir:'t',cache:'c'},ID,'720',0);
  assert.equal(open.includes('--limit-rate'),false);
  assert.deepEqual(open.slice(open.indexOf('--concurrent-fragments'),open.indexOf('--concurrent-fragments')+2),['--concurrent-fragments','4'],'without a limit, stream parts download four at a time');
  assert.ok(open.join(' ').includes('res:720,fps,vcodec:h264,acodec:m4a,proto:m3u8'),'HLS video streams are preferred between equal choices');
  const args=media.downloadArgs({deno:'d',dir:'t',cache:'c'},ID,'720',10);
  assert.deepEqual(args.slice(args.indexOf('--limit-rate'),args.indexOf('--limit-rate')+2),['--limit-rate','1024'],'a tiny limit is raised to 1 KB/s');
  assert.equal(args.includes('--concurrent-fragments'),false,'with a limit, parts download one at a time so the limit holds');
});
