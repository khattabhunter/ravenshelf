'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {MediaTools,TOOLS,MESSAGES,extractZipEntries,setName,crc32,SET_NAME}=require('../src/media-tools.cjs');

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const program=size=>Buffer.concat([Buffer.from('MZ'),crypto.randomBytes(size)]);
// A small zip writer: just enough to build archives shaped like the real ones.
function zip(entries,{zip64=false}={}){
  const parts=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name,'latin1'),method=entry.method??8;
    const data=method===0?entry.data:zlib.deflateRawSync(entry.data);
    const crc=entry.crc??crc32(entry.data),size=entry.size??entry.data.length;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(entry.flags||0,6);local.writeUInt16LE(method,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26);
    parts.push(local,name,data);
    const record=Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(entry.flags||0,8);record.writeUInt16LE(method,10);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(size,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
    central.push(record,name);
    offset+=30+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(zip64?0xffff:entries.length,8);end.writeUInt16LE(zip64?0xffff:entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
function fixtureTools(){
  const ytDlp=program(3000),deno=program(40000),ffmpeg=program(30000),ffprobe=program(25000);
  const denoZip=zip([{name:'deno.exe',data:deno}]);
  const ffZip=zip([{name:'ff-1/',data:Buffer.alloc(0),method:0},{name:'ff-1/bin/ffmpeg.exe',data:ffmpeg},{name:'ff-1/bin/ffprobe.exe',data:ffprobe,method:0},{name:'ff-1/README.txt',data:Buffer.from('readme')}]);
  const tools=[
    {id:'yt-dlp',name:'yt-dlp',version:'1.0',license:'Unlicense',source:'github.com/yt-dlp/yt-dlp',url:'https://github.com/yt-dlp/yt-dlp/releases/download/1.0/yt-dlp.exe',size:ytDlp.length,sha256:sha(ytDlp),
      files:[{role:'ytDlp',name:'yt-dlp.exe',size:ytDlp.length,sha256:sha(ytDlp)}]},
    {id:'deno',name:'Deno',version:'1.0',license:'MIT',source:'github.com/denoland/deno',archive:'zip',url:'https://github.com/denoland/deno/releases/download/v1.0/deno.zip',size:denoZip.length,sha256:sha(denoZip),
      files:[{role:'deno',entry:'deno.exe',name:'deno.exe',size:deno.length,sha256:sha(deno)}]},
    {id:'ffmpeg',name:'FFmpeg',version:'1.0',license:'GPL-3.0',source:'github.com/GyanD/codexffmpeg',archive:'zip',url:'https://github.com/GyanD/codexffmpeg/releases/download/1.0/ff.zip',size:ffZip.length,sha256:sha(ffZip),
      files:[{role:'ffmpeg',entry:'ff-1/bin/ffmpeg.exe',name:'ffmpeg.exe',size:ffmpeg.length,sha256:sha(ffmpeg)},{role:'ffprobe',entry:'ff-1/bin/ffprobe.exe',name:'ffprobe.exe',size:ffprobe.length,sha256:sha(ffprobe)}]}
  ];
  const bodies=new Map([[tools[0].url,ytDlp],[tools[1].url,denoZip],[tools[2].url,ffZip]]);
  return {tools,bodies,files:{'yt-dlp.exe':ytDlp,'deno.exe':deno,'ffmpeg.exe':ffmpeg,'ffprobe.exe':ffprobe}};
}
// GitHub answers the release address with a redirect to its download host.
// With ranges, the download host answers Range requests with 206 parts, as
// GitHub's does; part() can replace any answer, keyed by file, start and try.
function githubFetcher(bodies,{redirect=url=>'https://release-assets.githubusercontent.com/asset/'+encodeURIComponent(url),override=null,ranges=false,part=null}={}){
  const calls=[],attempts=new Map();
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'manual');assert.equal(options.headers['Accept-Encoding'],'identity');
    const address=new URL(url);
    if(address.hostname==='github.com')return new Response(null,{status:302,headers:{location:redirect(url)}});
    const original=decodeURIComponent(address.pathname.split('/').pop());
    if(override){const response=override(original);if(response)return response;}
    const body=bodies.get(original);
    if(!body)return new Response('missing',{status:404});
    const range=/^bytes=(\d+)-(\d+)$/.exec(options.headers.Range||'');
    if(ranges&&range){
      const start=Number(range[1]),end=Number(range[2]),key=`${original}@${start}`,attempt=(attempts.get(key)||0)+1;attempts.set(key,attempt);
      const slice=body.subarray(start,end+1);
      if(part){const response=part({original,start,end,attempt,signal:options.signal,body,slice});if(response)return response;}
      return new Response(slice,{status:206,headers:{'content-length':String(slice.length),'content-range':`bytes ${start}-${end}/${body.length}`}});
    }
    return new Response(body,{status:200,headers:{'content-length':String(body.length)}});
  };
  return {calls,fetcher,attempts};
}
// A part that sends its first byte, then nothing until the request is aborted.
function hangingPart({start,end,body,signal},onAbort=()=>{}){
  return new Response(new ReadableStream({start(controller){
    controller.enqueue(new Uint8Array(body.subarray(start,start+1)));
    signal.addEventListener('abort',()=>{onAbort();try{controller.error(signal.reason);}catch{}},{once:true});
  }}),{status:206,headers:{'content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${body.length}`}});
}
async function root(t){
  const base=path.resolve(os.tmpdir()),dir=await fs.promises.mkdtemp(path.join(base,'ravenshelf-tools-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),base);return fs.promises.rm(dir,{recursive:true,force:true});});
  return path.join(dir,'media-tools');
}
async function settled(tools){const end=Date.now()+5000;while(tools.task){if(Date.now()>end)throw new Error('Setup did not finish.');await new Promise(resolve=>setTimeout(resolve,5));}}
// Waits for a condition instead of a fixed time, so a slow test machine
// cannot reach the next step before setup has got that far.
async function until(condition,message){const end=Date.now()+5000;while(!condition()){if(Date.now()>end)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,5));}}

test('the pinned helper programs come from their publishers’ GitHub releases with exact sizes and hashes',()=>{
  assert.deepEqual(TOOLS.map(tool=>tool.id),['yt-dlp','deno','ffmpeg']);
  for(const tool of TOOLS){
    const url=new URL(tool.url);
    assert.equal(url.protocol,'https:');assert.equal(url.hostname,'github.com');
    const repo=tool.source.replace(/^github\.com\//,'');
    assert.ok([`/${repo}/releases/download/${tool.version}/`,`/${repo}/releases/download/v${tool.version}/`].some(prefix=>url.pathname.startsWith(prefix)),tool.id);
    assert.ok(Number.isSafeInteger(tool.size)&&tool.size>1024*1024,tool.id);assert.match(tool.sha256,/^[a-f0-9]{64}$/);
    for(const file of tool.files){assert.match(file.name,/^[a-z-]+\.exe$/);assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(file.size>1024*1024);}
    if(tool.archive)assert.equal(tool.archive,'zip');else assert.equal(tool.files[0].sha256,tool.sha256,'a program downloaded as is has one hash');
  }
  assert.deepEqual(TOOLS.flatMap(tool=>tool.files.map(file=>file.role)),['ytDlp','deno','ffmpeg','ffprobe']);
  assert.match(setName(TOOLS),SET_NAME);
  const download=TOOLS.reduce((sum,tool)=>sum+tool.size,0);
  assert.ok(download>150e6&&download<250e6,'about 176 MB to download');
});

test('setup downloads, checks and unpacks every program, then reports it ready',async t=>{
  const dir=await root(t),{tools:list,bodies,files}=fixtureTools(),{calls,fetcher}=githubFetcher(bodies);
  const changes=[],ready=[];
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,onChange:snapshot=>changes.push(snapshot),onReady:()=>ready.push(true)});
  assert.equal(tools.snapshot().phase,'missing');
  assert.equal(tools.install().phase,'installing');
  await settled(tools);
  assert.equal(tools.snapshot().phase,'ready');assert.equal(ready.length,1);
  assert.ok(changes.some(snapshot=>snapshot.phase==='installing'&&snapshot.progress>0));
  const set=path.join(dir,setName(list));
  assert.deepEqual(fs.readdirSync(set).sort(),['deno.exe','ffmpeg.exe','ffprobe.exe','installed.json','yt-dlp.exe']);
  for(const [name,bytes] of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(set,name)),bytes,name);
  assert.ok(!fs.readdirSync(dir).some(name=>name.startsWith('.staging-')),'the setup folder is gone');
  // The release address first, then GitHub's download host; never anything else.
  assert.deepEqual(calls.map(call=>new URL(call.url).hostname),['github.com','release-assets.githubusercontent.com','github.com','release-assets.githubusercontent.com','github.com','release-assets.githubusercontent.com']);
  const paths=await tools.verified();
  assert.deepEqual(Object.keys(paths).sort(),['cache','deno','dir','ffmpeg','ffprobe','temp','ytDlp']);
  assert.equal(paths.ytDlp,path.join(set,'yt-dlp.exe'));assert.ok(fs.statSync(paths.temp).isDirectory());
  assert.equal(new MediaTools({root:dir,fetcher,platform:'win32',tools:list}).snapshot().phase,'ready','a new session sees the installed programs');
  assert.equal(tools.install().phase,'ready','setting up again does nothing');
});

test('a download that does not match its pinned hash installs nothing',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools();
  const changed=Buffer.from(bodies.get(list[1].url));changed[changed.length-30]^=1;
  const {fetcher}=githubFetcher(new Map([...bodies,[list[1].url,changed]]));
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'error');assert.equal(tools.snapshot().message,MESSAGES.failed);
  assert.deepEqual(fs.readdirSync(dir),[],'neither the set nor the setup folder is left');
  await assert.rejects(tools.verified(),{message:MESSAGES.setup});
});

test('downloads follow redirects only to GitHub’s release download hosts',async t=>{
  for(const redirect of [()=>'https://evil.example/yt-dlp.exe',()=>'http://release-assets.githubusercontent.com/x',()=>'https://github.com/other/repo/releases/download/1/x']){
    const dir=await root(t),{tools:list,bodies}=fixtureTools(),{fetcher}=githubFetcher(bodies,{redirect});
    const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
    tools.install();await settled(tools);
    assert.equal(tools.snapshot().phase,'error',redirect());
    assert.equal(fs.existsSync(path.join(dir,setName(list))),false);
  }
});

test('wrong sizes, wrong file types and stalled downloads are refused',async t=>{
  const cases=[
    original=>original.endsWith('yt-dlp.exe')&&new Response(Buffer.from('MZ!'),{status:200,headers:{'content-length':'3'}}),
    original=>original.endsWith('yt-dlp.exe')&&new Response(Buffer.from('xx'),{status:200,headers:{'content-length':'999999'}}),
    original=>original.endsWith('yt-dlp.exe')&&new Response('x',{status:200,headers:{'content-encoding':'gzip'}}),
    original=>original.endsWith('yt-dlp.exe')&&new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([0x4d,0x5a]));}}),{status:200})
  ];
  for(const override of cases){
    const dir=await root(t),{tools:list,bodies}=fixtureTools(),{fetcher}=githubFetcher(bodies,{override});
    const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,stallMs:150});
    tools.install();await settled(tools);
    assert.equal(tools.snapshot().phase,'error');assert.deepEqual(fs.readdirSync(dir),[]);
  }
});

test('setup can be cancelled and leaves nothing behind',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools();
  let release,asked=false;const gate=new Promise(resolve=>{release=resolve;});
  const {fetcher}=githubFetcher(bodies,{override:original=>original.endsWith('deno.zip')&&(asked=true)&&new Response(new ReadableStream({async pull(controller){await gate;controller.enqueue(new Uint8Array([0x50]));}}),{status:200})});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();
  await until(()=>asked,'Deno was never requested.').catch(async error=>{tools.cancel();release();await settled(tools);throw error;});
  tools.cancel();release();await settled(tools);
  assert.deepEqual({phase:tools.snapshot().phase,message:tools.snapshot().message},{phase:'missing',message:MESSAGES.cancelled});
  assert.deepEqual(fs.readdirSync(dir),[]);
});

test('setup stops early when the disk is too full',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools(),{calls,fetcher}=githubFetcher(bodies);
  const original=fs.promises.statfs;fs.promises.statfs=async()=>({bavail:1,bsize:4096});
  t.after(()=>{fs.promises.statfs=original;});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'error');assert.match(tools.snapshot().message,/not enough free disk space/);
  assert.equal(calls.length,0,'nothing is downloaded');
});

test('the programs are checked before use, and a changed program is reported as damaged',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools(),{fetcher}=githubFetcher(bodies);
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();await settled(tools);
  await tools.verified();
  const ffmpeg=path.join(dir,setName(list),'ffmpeg.exe'),bytes=fs.readFileSync(ffmpeg);bytes[100]^=0xff;fs.writeFileSync(ffmpeg,bytes);
  await assert.rejects(tools.verified(),{message:MESSAGES.damaged});
  assert.equal(tools.snapshot().phase,'damaged');
  await assert.rejects(tools.verified(),{message:MESSAGES.damaged},'stays damaged until set up again');
  // Setting up again replaces the damaged copy.
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready');await tools.verified();
  fs.unlinkSync(path.join(dir,setName(list),'deno.exe'));
  await assert.rejects(tools.verified(),{message:MESSAGES.setup},'a missing program needs setup');
});

test('removing the programs deletes only Ravenshelf’s own folders, and never during setup',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools(),{fetcher}=githubFetcher(bodies);
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();await assert.rejects(tools.remove(),{message:MESSAGES.running});await settled(tools);
  await tools.verified();
  fs.mkdirSync(path.join(dir,'tools-0123456789abcdef'));fs.writeFileSync(path.join(dir,'notes.txt'),'mine');
  const snapshot=await tools.remove();
  assert.equal(snapshot.phase,'missing');
  assert.deepEqual(fs.readdirSync(dir),['notes.txt'],'unrelated files stay');
});

test('older sets and abandoned setup folders are cleared, other folders are kept',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools(),{fetcher}=githubFetcher(bodies);
  fs.mkdirSync(path.join(dir,'tools-0123456789abcdef'),{recursive:true});fs.writeFileSync(path.join(dir,'tools-0123456789abcdef','yt-dlp.exe'),'old');
  fs.mkdirSync(path.join(dir,'.staging-'+crypto.randomUUID()));fs.mkdirSync(path.join(dir,'keep-me'));
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list});
  tools.install();await settled(tools);
  assert.deepEqual(fs.readdirSync(dir).sort(),['keep-me',setName(list)].sort());
});

test('zip entries are read by exact name with their checksums; anything unusual is refused',async t=>{
  const dir=path.dirname(await root(t)),data=program(5000),entry={entry:'bin/tool.exe',size:data.length,sha256:sha(data)};
  const run=async(archive,want=entry)=>{
    const file=path.join(dir,crypto.randomUUID()+'.zip'),target=path.join(dir,crypto.randomUUID()+'.exe');fs.writeFileSync(file,archive);
    await extractZipEntries(file,[{...want,target}]);return fs.readFileSync(target);
  };
  assert.deepEqual(await run(zip([{name:'bin/tool.exe',data}])),data);
  assert.deepEqual(await run(zip([{name:'bin/tool.exe',data,method:0}])),data);
  for(const archive of [
    zip([{name:'bin/tool.exe',data},{name:'bin/tool.exe',data}]),
    zip([{name:'bin/tool.exe',data,flags:1}]),
    zip([{name:'bin/tool.exe',data,method:12}]),
    zip([{name:'bin/tool.exe',data,crc:1}]),
    zip([{name:'bin/tool.exe',data,size:data.length+1}]),
    zip([{name:'bin/other.exe',data}]),
    zip([{name:'bin/tool.exe',data}],{zip64:true}),
    zip([{name:'bin/tool.exe',data}]).subarray(0,200),
    Buffer.from('not a zip at all')
  ])await assert.rejects(run(archive),{message:MESSAGES.failed});
  await assert.rejects(run(zip([{name:'bin/tool.exe',data}]),{...entry,sha256:'0'.repeat(64)}),{message:MESSAGES.failed});
  assert.deepEqual(fs.readdirSync(dir).filter(name=>name.endsWith('.exe')).length,2,'refused entries leave no output');
});

test('helper programs are Windows-only',()=>{
  const tools=new MediaTools({root:path.join(os.tmpdir(),'unused'),platform:'linux'});
  assert.equal(tools.snapshot().phase,'unsupported');
  assert.throws(()=>tools.install(),{message:MESSAGES.unsupported});
  return assert.rejects(tools.verified(),{message:MESSAGES.unsupported});
});

test('a folder that antivirus holds for a moment is renamed on a later try; other errors are not retried',async t=>{
  const {renameDirectory}=require('../src/media-tools.cjs');
  const original=fs.promises.rename;t.after(()=>{fs.promises.rename=original;});
  let calls=0;
  fs.promises.rename=async()=>{calls++;if(calls<3){const error=new Error('busy');error.code='EPERM';throw error;}};
  await renameDirectory('a','b',{delayMs:1});
  assert.equal(calls,3);
  calls=0;
  fs.promises.rename=async()=>{calls++;const error=new Error('busy');error.code='EBUSY';throw error;};
  await assert.rejects(renameDirectory('a','b',{attempts:3,delayMs:1}),{code:'EBUSY'});
  assert.equal(calls,3,'gives up after the last try');
  calls=0;
  fs.promises.rename=async()=>{calls++;const error=new Error('gone');error.code='ENOENT';throw error;};
  await assert.rejects(renameDirectory('a','b',{delayMs:1}),{code:'ENOENT'});
  assert.equal(calls,1);
});

const quick={partSize:4096,connections:3,partStallMs:5000,raceAfterMs:60000,retryDelayMs:1};
test('large downloads arrive in parts over several connections and are put together exactly',async t=>{
  const dir=await root(t),{tools:list,bodies,files}=fixtureTools();
  let active=0,most=0;
  const {calls,fetcher}=githubFetcher(bodies,{ranges:true,part:({start,end,body,slice})=>{
    active++;most=Math.max(most,active);
    return new Response(new ReadableStream({async start(controller){await new Promise(resolve=>setTimeout(resolve,5));controller.enqueue(new Uint8Array(slice));controller.close();active--;}}),
      {status:206,headers:{'content-length':String(slice.length),'content-range':`bytes ${start}-${end}/${body.length}`}});
  }});
  let limited=0;const bandwidthLimiter={consume:async bytes=>{limited+=bytes;}};
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,bandwidthLimiter,...quick});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready',tools.snapshot().message);
  for(const [name,bytes] of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(dir,setName(list),name)),bytes,name);
  for(const tool of list){
    const starts=calls.filter(call=>call.url.includes(encodeURIComponent(tool.url))).map(call=>Number(/^bytes=(\d+)-/.exec(call.options.headers.Range)[1])).sort((a,b)=>a-b);
    const expected=[];for(let start=0;start<tool.size;start+=quick.partSize)expected.push(start);
    assert.deepEqual(starts,expected,`${tool.id}: each part is asked for once`);
  }
  assert.ok(most>=2&&most<=quick.connections,`parts download side by side, at most ${quick.connections} at once (saw ${most})`);
  assert.equal(limited,list.reduce((sum,tool)=>sum+tool.size,0),'the shared speed limit sees every byte');
});

test('a part that fails or stops sending is asked for again',async t=>{
  const dir=await root(t),{tools:list,bodies,files}=fixtureTools();
  const {fetcher,attempts}=githubFetcher(bodies,{ranges:true,part:context=>{
    if(context.original===list[1].url&&context.start===4096&&context.attempt===1)return new Response('busy',{status:503});
    if(context.original===list[2].url&&context.start===0&&context.attempt===1)return hangingPart(context);
    return null;
  }});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,...quick,partStallMs:60});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready',tools.snapshot().message);
  assert.equal(attempts.get(list[1].url+'@4096'),2);assert.equal(attempts.get(list[2].url+'@0'),2);
  assert.deepEqual(fs.readFileSync(path.join(dir,setName(list),'deno.exe')),files['deno.exe']);
  assert.deepEqual(fs.readFileSync(path.join(dir,setName(list),'ffmpeg.exe')),files['ffmpeg.exe']);
});

test('near the end, a slow part gets a second connection and the first copy to arrive is kept',async t=>{
  const dir=await root(t),{tools:list,bodies,files}=fixtureTools();
  const ff=list[2],last=Math.floor((ff.size-1)/quick.partSize)*quick.partSize;let slowStopped=false;
  const {fetcher,attempts}=githubFetcher(bodies,{ranges:true,part:context=>
    context.original===ff.url&&context.start===last&&context.attempt===1?hangingPart(context,()=>{slowStopped=true;}):null});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,...quick,raceAfterMs:30});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready',tools.snapshot().message);
  assert.equal(attempts.get(ff.url+'@'+last),2,'one extra connection for the slow part');
  assert.ok(slowStopped,'the slower copy is stopped');
  assert.deepEqual(fs.readFileSync(path.join(dir,setName(list),'ffprobe.exe')),files['ffprobe.exe']);
});

test('parts with the wrong range, a part that keeps failing, or a whole file mid-way install nothing',async t=>{
  const cases=[
    {name:'wrong range',part:({original,start,end,body,slice})=>original===list0().url&&start===4096&&new Response(slice,{status:206,headers:{'content-range':`bytes ${start+1}-${end+1}/${body.length}`}})},
    {name:'wrong total',part:({original,start,end,body,slice})=>original===list0().url&&start===0&&new Response(slice,{status:206,headers:{'content-range':`bytes ${start}-${end}/${body.length+1}`}})},
    {name:'keeps failing',part:({original,start})=>original===list0().url&&start===8192&&new Response('busy',{status:503})},
    {name:'whole file mid-way',part:({original,start,body})=>original===list0().url&&start===4096&&new Response(body,{status:200,headers:{'content-length':String(body.length)}})},
    {name:'too much data',part:({original,start,end,body,slice})=>original===list0().url&&start===4096&&new Response(Buffer.concat([slice,Buffer.from('x')]),{status:206,headers:{'content-range':`bytes ${start}-${end}/${body.length}`}})}
  ];
  let current=null;const list0=()=>current[1];
  for(const {name,part} of cases){
    const dir=await root(t),fixture=fixtureTools();current=fixture.tools;
    const {fetcher}=githubFetcher(fixture.bodies,{ranges:true,part});
    const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:fixture.tools,...quick,partTries:3});
    tools.install();await settled(tools);
    assert.equal(tools.snapshot().phase,'error',name);assert.equal(tools.snapshot().message,MESSAGES.failed,name);
    assert.deepEqual(fs.readdirSync(dir),[],name+': nothing is left');
  }
});

test('cancelling while parts are downloading stops every connection',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools();let open=0;
  const {fetcher}=githubFetcher(bodies,{ranges:true,part:context=>{if(context.original!==list[1].url)return null;open++;return hangingPart(context,()=>{open--;});}});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,...quick});
  tools.install();
  await until(()=>open>=2,'several parts were open').catch(async error=>{tools.cancel();await settled(tools);throw error;});
  assert.ok(open>=2,'several parts were open');
  tools.cancel();await settled(tools);
  assert.deepEqual({phase:tools.snapshot().phase,message:tools.snapshot().message},{phase:'missing',message:MESSAGES.cancelled});
  assert.equal(open,0,'all of them were stopped');
  assert.deepEqual(fs.readdirSync(dir),[]);
});

test('a connection far slower than the others is dropped and its part starts again on another one',async t=>{
  const dir=await root(t),{tools:list,bodies,files}=fixtureTools(),deno=list[1];
  const timed=({start,end,body,slice},step,every)=>new Response(new ReadableStream({async start(controller){
    for(let offset=0;offset<slice.length;offset+=step){await new Promise(resolve=>setTimeout(resolve,every));controller.enqueue(new Uint8Array(slice.subarray(offset,offset+step)));}
    controller.close();
  }}),{status:206,headers:{'content-length':String(slice.length),'content-range':`bytes ${start}-${end}/${body.length}`}});
  const {fetcher,attempts}=githubFetcher(bodies,{ranges:true,part:context=>{
    if(context.original!==deno.url)return null;
    if(context.start===4096&&context.attempt===1)return timed(context,1,25);
    return timed(context,512,5);
  }});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,...quick,slowAfterMs:40,slowRate:1e12});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready',tools.snapshot().message);
  assert.equal(attempts.get(deno.url+'@4096'),2,'the slow part started again once');
  assert.deepEqual(fs.readFileSync(path.join(dir,setName(list),'deno.exe')),files['deno.exe']);
});

test('when every connection is slow, none is dropped',async t=>{
  const dir=await root(t),{tools:list,bodies}=fixtureTools(),deno=list[1];
  const {fetcher,attempts}=githubFetcher(bodies,{ranges:true,part:({original,start,end,body,slice})=>original!==deno.url?null:new Response(new ReadableStream({async start(controller){
    for(let offset=0;offset<slice.length;offset+=256){await new Promise(resolve=>setTimeout(resolve,4));controller.enqueue(new Uint8Array(slice.subarray(offset,offset+256)));}
    controller.close();
  }}),{status:206,headers:{'content-length':String(slice.length),'content-range':`bytes ${start}-${end}/${body.length}`}})});
  const tools=new MediaTools({root:dir,fetcher,platform:'win32',tools:list,...quick,slowAfterMs:20,slowRate:1e12});
  tools.install();await settled(tools);
  assert.equal(tools.snapshot().phase,'ready',tools.snapshot().message);
  assert.ok([...attempts].filter(([key])=>key.startsWith(deno.url+'@')).every(([,count])=>count===1),'every part was asked for once');
});
