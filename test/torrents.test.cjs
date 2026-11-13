'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const magnet=require('../src/magnet.cjs');
const engineModule=require('../src/torrent-engine.cjs');
const {TorrentEngine,engineArgs,engineEnv,selection,sameFiles,errorMessage}=engineModule;
const {DownloadManager,torrentWorkspace,TORRENTS_FOLDER}=require('../src/downloads.cjs');
const {createTorrentIntegration,TOOLS,normalizeSettings,UPLOAD_LIMITS}=require('../src/torrent-integration.cjs');
const {TOOL_MESSAGES,MESSAGES:TORRENT}=require('../src/torrent-messages.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');
const {validateRequest}=require('../src/browser-protocol.cjs');

const tick=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
const cleanups=new Map();
function scratch(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-torrent-'));cleanups.set(root,[]);t.after(async()=>{try{for(const cleanup of cleanups.get(root))await cleanup();}finally{cleanups.delete(root);fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}});return root;}
const beforeCleanup=(root,cleanup)=>cleanups.get(root).push(cleanup);

// A small bencode writer for test torrents.
function bencode(value){
  if(Buffer.isBuffer(value))return Buffer.concat([Buffer.from(value.length+':'),value]);
  if(typeof value==='string')return bencode(Buffer.from(value,'utf8'));
  if(typeof value==='number'||typeof value==='bigint')return Buffer.from(`i${value}e`);
  if(Array.isArray(value))return Buffer.concat([Buffer.from('l'),...value.map(bencode),Buffer.from('e')]);
  const keys=Object.keys(value).sort();
  return Buffer.concat([Buffer.from('d'),...keys.flatMap(key=>[bencode(key),bencode(value[key])]),Buffer.from('e')]);
}
function torrentFile(info,extra={}){
  const raw=bencode({announce:'udp://tracker.example:1337/announce',...extra,info});
  const infoBytes=bencode(info);
  return {buffer:raw,infoHash:crypto.createHash('sha1').update(infoBytes).digest('hex')};
}
const multi=(files=[[['setup.exe'],10],[['fg-01.bin'],20],[['fg-optional-bonus.bin'],5],[['MD5','fitgirl-bins.md5'],3]],name='Game [FitGirl Repack]')=>({name,'piece length':16384,pieces:Buffer.alloc(20),files:files.map(([p,length])=>({length,path:p}))});

test('magnet links are read strictly, and only the hash, name and trackers are kept',()=>{
  const read=magnet.parseMagnet('magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=Example+Game%3A+Bundle%0A&tr=udp%3A%2F%2Ftracker.example.org%3A2710&tr=http%3A%2F%2Ftracker.example%2Fannounce&tr=wss%3A%2F%2Fpeers.example&tr=https%3A%2F%2Fuser%3Apass%40t.example%2Fa&ws=https%3A%2F%2Fseed.example%2Ff&x.pe=10.0.0.1%3A6881&xs=https%3A%2F%2Fevil.example%2Fx.torrent');
  assert.equal(read.infoHash,'0123456789abcdef0123456789abcdef01234567');
  assert.equal(read.name,'Example Game: Bundle');
  assert.deepEqual(read.trackers,['udp://tracker.example.org:2710','http://tracker.example/announce']);
  assert.equal(read.magnet,'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example%20Game%3A%20Bundle&tr=udp%3A%2F%2Ftracker.example.org%3A2710&tr=http%3A%2F%2Ftracker.example%2Fannounce');
  for(const dropped of ['seed.example','10.0.0.1','evil.example','peers.example','user'])assert.equal(read.magnet.includes(dropped),false,dropped);
  // The same torrent written in base 32.
  const hex='0123456789abcdef0123456789abcdef01234567',b32='AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';
  assert.equal(magnet.base32Hex(b32),hex);
  assert.equal(magnet.parseMagnet(`magnet:?xt=urn:btih:${b32}`).infoHash,hex);
  assert.equal(magnet.base32Hex('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),'0'.repeat(40));
  assert.equal(magnet.parseMagnet(`magnet:?xt=urn:btih:${hex}&xt=urn:btih:${hex.toUpperCase()}`).infoHash,hex);
  assert.throws(()=>magnet.parseMagnet('magnet:?xt=urn:btmh:1220'+'a'.repeat(64)),{message:magnet.MESSAGES.version2});
  assert.equal(magnet.parseMagnet(`magnet:?xt=urn:btmh:1220${'a'.repeat(64)}&xt=urn:btih:${hex}`).infoHash,hex,'a hybrid torrent is read by its first-version hash');
  for(const bad of [null,'',`http://example.com/?xt=urn:btih:${hex}`,'magnet:?dn=x',`magnet:?xt=urn:btih:${hex.slice(1)}`,`magnet:?xt=urn:btih:${hex}&xt=urn:btih:${'b'.repeat(40)}`,`magnet:?xt=urn:btih:${hex}&dn=`+'x'.repeat(9000),'magnet:?xt=urn:btih:DJYWRMSHLZWWWAJFE2QJHSHHLJPKBIT1'])
    assert.throws(()=>magnet.parseMagnet(bad),{message:magnet.MESSAGES.invalid},String(bad).slice(0,60));
  const many=magnet.parseMagnet(`magnet:?xt=urn:btih:${hex}`+Array.from({length:40},(_,i)=>`&tr=udp%3A%2F%2Ft${i}.example%3A1`).join(''));
  assert.equal(many.trackers.length,30);
});

test('a torrent file is read only when it is the torrent its magnet link names',()=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash);
  assert.deepEqual(read.files,[
    {index:1,path:'Game [FitGirl Repack]/setup.exe',length:10,padding:false},
    {index:2,path:'Game [FitGirl Repack]/fg-01.bin',length:20,padding:false},
    {index:3,path:'Game [FitGirl Repack]/fg-optional-bonus.bin',length:5,padding:false},
    {index:4,path:'Game [FitGirl Repack]/MD5/fitgirl-bins.md5',length:3,padding:false}]);
  assert.equal(read.name,'Game [FitGirl Repack]');assert.equal(read.totalLength,38);
  assert.throws(()=>magnet.readTorrent(buffer,'0'.repeat(40)),{message:magnet.MESSAGES.damaged});
  // One file.
  const single=torrentFile({name:'Game.iso',length:7,'piece length':16384,pieces:Buffer.alloc(20)});
  assert.deepEqual(magnet.readTorrent(single.buffer,single.infoHash).files,[{index:1,path:'Game.iso',length:7,padding:false}]);
  // UTF-8 names are preferred, as the downloader does.
  const named=torrentFile({...multi([[['a.bin'],1]]),'name.utf-8':'لعبة',files:[{length:1,path:['x'],'path.utf-8':['ملف.bin']}]});
  assert.deepEqual(magnet.readTorrent(named.buffer,named.infoHash).files[0].path,'لعبة/ملف.bin');
  // Padding files are known, so they are never chosen.
  const padded=torrentFile({...multi(),files:[{length:4,path:['a.bin']},{length:12,path:['.pad','12'],attr:'p'}]});
  assert.equal(magnet.readTorrent(padded.buffer,padded.infoHash).files[1].padding,true);
  // A torrent of the newer format only.
  const v2=torrentFile({name:'x','piece length':16384,'meta version':2,'file tree':{}});
  assert.throws(()=>magnet.readTorrent(v2.buffer,v2.infoHash),{message:magnet.MESSAGES.version2});
});

test('a torrent with any name Windows cannot store exactly as written is refused, not renamed',()=>{
  const refused=[[['..','evil.exe']],[['CON']],[['nul.txt']],[['con .txt']],[['COM1  .bin']],[['lpt\u00b2 .txt']],[['a:b.bin']],[['trailing.']],[['space ']],[['tab\there']],[['a/b']],[['back\\slash']],[['quote"']],[['star*']],[['']],[['COM\u00b9']],[['x'.repeat(181)]]];
  for(const [parts] of refused){
    const {buffer,infoHash}=torrentFile(multi([[parts,1]]));
    assert.throws(()=>magnet.readTorrent(buffer,infoHash),{message:magnet.MESSAGES.names},JSON.stringify(parts));
  }
  const badName=torrentFile(multi([[['a'],1]],'..'));
  assert.throws(()=>magnet.readTorrent(badName.buffer,badName.infoHash),{message:magnet.MESSAGES.names});
  const twice=torrentFile(multi([[['Setup.exe'],1],[['setup.EXE'],1]]));
  assert.throws(()=>magnet.readTorrent(twice.buffer,twice.infoHash),{message:magnet.MESSAGES.names},'names that differ only in case');
  const fileAndFolder=torrentFile(multi([[['MD5'],1],[['md5','x.md5'],1]]));
  assert.throws(()=>magnet.readTorrent(fileAndFolder.buffer,fileAndFolder.infoHash),{message:magnet.MESSAGES.names});
  const invalidUtf8=torrentFile({...multi(),files:[{length:1,path:[Buffer.from([0xff,0xfe])]}]});
  assert.throws(()=>magnet.readTorrent(invalidUtf8.buffer,invalidUtf8.infoHash),{message:magnet.MESSAGES.names});
  const tooMany=torrentFile(multi(Array.from({length:10001},(_,i)=>[[`f${i}`],1])));
  assert.throws(()=>magnet.readTorrent(tooMany.buffer,tooMany.infoHash),{message:magnet.MESSAGES.tooMany});
});

test('torrent names made to look like something else are refused: hidden text, disguised endings, short-name look-alikes, upper-case twins',()=>{
  for(const [parts,message] of [
    [['Readme\u202etxt.exe'],magnet.MESSAGES.deceptive],[['a\u200bb.bin'],magnet.MESSAGES.deceptive],[['Folder\u2066x','a.bin'],magnet.MESSAGES.deceptive],
    [['invoice.pdf.exe'],magnet.MESSAGES.deceptive],[['photo.jpg      .exe'],magnet.MESSAGES.deceptive],[['notes.txt.bat'],magnet.MESSAGES.deceptive],
    [['SETUPP~1.EXE'],magnet.MESSAGES.names],[['data~2'],magnet.MESSAGES.names]
  ]){
    const {buffer,infoHash}=torrentFile(multi([[parts,1]]));
    assert.throws(()=>magnet.readTorrent(buffer,infoHash),{message},JSON.stringify(parts));
  }
  // Windows compares names in upper case: σ and ς are the same file there.
  const sigma=torrentFile(multi([[['\u03c3.bin'],1],[['\u03c2.bin'],1]]));
  assert.throws(()=>magnet.readTorrent(sigma.buffer,sigma.infoHash),{message:magnet.MESSAGES.names});
  // Ordinary game files are fine, programs included.
  const fine=torrentFile(multi([[['setup.exe'],1],[['fg-01.bin'],1],[['Redist','vc_redist.x64.exe'],1],[['Name with  two spaces.txt'],1],[['\u0627\u0644\u0644\u0639\u0628\u0629.bin'],1],[['\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645.bin'],1]]));
  assert.equal(magnet.readTorrent(fine.buffer,fine.infoHash).files.length,6,'a Persian name with a zero-width non-joiner is fine');
});

test('magnet trackers on this PC or the home network are left out; hidden text is taken out of the name',()=>{
  const hash='0123456789abcdef0123456789abcdef01234567';
  const trackers=['udp://127.1:80','udp://0177.0.0.1:1','udp://192.168.001.001:2','udp://[::ffff:127.0.0.1]:3','udp://127.0.0.1:53','http://192.168.1.1/cgi?x=1','http://[::1]/a','udp://10.1.2.3:6969','http://169.254.1.1/','http://localhost/a','http://router/a','http://nas.local/a','http://box.lan/a','http://printer.home.arpa/a','http://tracker.localhost/a','udp://tracker.example.org:1337/announce','http://93.184.216.34/announce'];
  const read=magnet.parseMagnet(`magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent('Game\u202e\u200b Name')}`+trackers.map(tracker=>'&tr='+encodeURIComponent(tracker)).join(''));
  assert.deepEqual(read.trackers,['udp://tracker.example.org:1337/announce','http://93.184.216.34/announce']);
  assert.equal(read.name,'Game Name');
});

test('the torrent reader refuses malformed data',()=>{
  const bad=['','i01e','i-0e','d1:ai1e1:ai2ee','d1:ai1e','l'+'l'.repeat(70)+'e'.repeat(71),'d1:ai1ee extra','4:abc','d3:keyi1e','d9999999999999999999999:x','x'];
  for(const text of bad)assert.throws(()=>magnet.decode(Buffer.from(text)),{message:magnet.MESSAGES.damaged},JSON.stringify(text));
  assert.doesNotThrow(()=>magnet.decode(Buffer.from('d1:bi1e1:ai2ee')),'keys out of order are still read');
  assert.equal(magnet.decode(Buffer.from('d1:ai99999999999999999999ee')).root.get('a'),99999999999999999999n,'large numbers stay exact');
  assert.throws(()=>magnet.decode(Buffer.from('li1ee')),{message:magnet.MESSAGES.damaged},'a torrent is a dictionary');
  assert.throws(()=>magnet.decode(Buffer.alloc(11*1024*1024,0x30)),{message:magnet.MESSAGES.damaged});
  for(const message of Object.values(magnet.MESSAGES))assert.equal(publicErrorMessage(new Error(message),'openMagnet'),message);
});

test('unhashed metadata cannot add trackers, web seeds or other network destinations',()=>{
  const fixture=torrentFile(multi(),{announce:'http://127.0.0.1/private','announce-list':[['https://unreviewed.example/announce']],
    'url-list':['http://192.168.1.1/seed'],'httpseeds':['https://seed.example/data'],nodes:[['private.example',1]],comment:'private fixture comment'});
  const original=magnet.decode(fixture.buffer).info;
  const allowed=['https://chosen.example/announce','udp://tracker.example:6969/announce'];
  const cleaned=magnet.sanitizeTorrent(fixture.buffer,fixture.infoHash,allowed);
  const decoded=magnet.decode(cleaned);
  assert.deepEqual([...decoded.root.keys()],['announce','announce-list','info']);
  assert.deepEqual(decoded.info,original,'info bytes, hash and piece verification remain exactly the same');
  assert.equal(decoded.root.get('announce').toString(),allowed[0]);
  assert.deepEqual(decoded.root.get('announce-list').map(tier=>tier.map(item=>item.toString())),allowed.map(item=>[item]));
  assert.deepEqual(magnet.readTorrent(cleaned,fixture.infoHash),magnet.readTorrent(fixture.buffer,fixture.infoHash));
  assert.deepEqual([...magnet.decode(magnet.sanitizeTorrent(fixture.buffer,fixture.infoHash)).root.keys()],['info']);
  assert.throws(()=>magnet.sanitizeTorrent(fixture.buffer,'0'.repeat(40)),{message:magnet.MESSAGES.damaged});
  assert.throws(()=>magnet.sanitizeTorrent(fixture.buffer,fixture.infoHash,[null]),{message:magnet.MESSAGES.damaged});
  const stripped=magnet.sanitizeTorrent(fixture.buffer,fixture.infoHash,['http://127.0.0.1/x','https://user:secret@chosen.example/x']);
  assert.deepEqual([...magnet.decode(stripped).root.keys()],['info']);
});

test('saved torrent metadata is size bounded and cannot be a hard link or directory',async t=>{
  const root=scratch(t),file=path.join(root,'metadata.torrent');
  const fixture=torrentFile(multi());fs.writeFileSync(file,fixture.buffer);
  assert.deepEqual(await engineModule.readMetadataFile(file),fixture.buffer);
  const alias=path.join(root,'alias.torrent');fs.linkSync(file,alias);
  await assert.rejects(engineModule.readMetadataFile(file),{message:engineModule.MESSAGES.stopped});
  fs.unlinkSync(alias);
  fs.truncateSync(file,10*1024*1024+1);
  await assert.rejects(engineModule.readMetadataFile(file),{message:engineModule.MESSAGES.stopped});
  await assert.rejects(engineModule.readMetadataFile(root),{message:engineModule.MESSAGES.stopped});
});

test('tracker preflight rejects private, mixed, malformed and failed DNS answers without replacing their hostname',async()=>{
  const hash='a'.repeat(40),calls=[];
  const trackers=['https://public.example/announce','udp://public.example:6969/a','http://mixed.example/a','http://private.example/a','http://missing.example/a','http://malformed.example/a','udp://93.184.216.34:6969/a'];
  const lookup=async(host,options)=>{calls.push([host,options]);
    if(host==='public.example')return [{address:'93.184.216.34',family:4}];
    if(host==='mixed.example')return [{address:'93.184.216.34',family:4},{address:'192.168.1.1',family:4}];
    if(host==='private.example')return [{address:'127.0.0.1',family:4}];
    if(host==='malformed.example')return [{address:'not an IP'}];
    throw new Error('fixture DNS failure');};
  const parsed=await engineModule.publicMagnet(`magnet:?xt=urn:btih:${hash}`+trackers.map(value=>'&tr='+encodeURIComponent(value)).join(''),{lookup});
  assert.deepEqual(parsed.trackers,[trackers[0],trackers[1],trackers[6]]);
  assert.equal(calls.filter(([host])=>host==='public.example').length,1,'one lookup per host');
  assert.ok(calls.every(([,options])=>options.all===true));
  const cancelled=new AbortController();cancelled.abort();
  let lookedUp=false;
  await assert.rejects(engineModule.publicMagnet(`magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent(trackers[0])}`,{lookup:async()=>{lookedUp=true;return new Promise(()=>{});},signal:cancelled.signal}),{name:'AbortError'});
  assert.equal(lookedUp,false,'cancelled requests do not start a DNS query');
});

test('the torrent engine’s command line is fixed and has every safety option',()=>{
  const secret='a'.repeat(64),stateDir=path.join(os.tmpdir(),'state');
  const args=engineArgs({port:50000,secret,appPid:1234,stateDir,uploadLimit:102400,downloadLimit:0});
  assert.equal(Object.isFrozen(args),true);
  for(const flag of ['--no-conf=true','--no-netrc=true','--enable-rpc=true','--rpc-listen-all=false','--rpc-listen-port=50000',`--rpc-secret=${secret}`,'--rpc-allow-origin-all=false','--rpc-save-upload-metadata=false',
    '--stop-with-process=1234','--seed-time=0','--bt-enable-lpd=false','--enable-dht6=false','--disable-ipv6=true','--follow-torrent=false','--follow-metalink=false','--max-overall-upload-limit=102400','--max-overall-download-limit=0','--allow-overwrite=false'])
    assert.ok(args.includes(flag),flag);
  for(const arg of args)assert.doesNotMatch(arg,/^--(on-|log|save-session|input-file|seed-ratio|rpc-listen-all=true|conf-path|netrc-path|enable-rpc=false|bt-external-ip|interface)/,arg);
  assert.ok(args.includes(`--dht-file-path=${path.join(stateDir,'dht.dat')}`));
  for(const options of [{uploadLimit:0},{uploadLimit:512},{uploadLimit:NaN},{secret:'short'},{port:80},{appPid:0}])
    assert.throws(()=>engineArgs({port:50000,secret,appPid:1234,stateDir,uploadLimit:102400,...options}),{message:engineModule.MESSAGES.start},JSON.stringify(options));
  const env=engineEnv({SystemRoot:'C:\\Windows',USERPROFILE:'C:\\Users\\someone',HTTPS_PROXY:'http://proxy',PATH:'C:\\tools',HOME:'C:\\h'},'C:\\temp');
  assert.deepEqual(env,{SystemRoot:'C:\\Windows',PATH:'C:\\Windows\\System32;C:\\Windows',TEMP:'C:\\temp',TMP:'C:\\temp'});
  assert.equal(errorMessage(9),engineModule.MESSAGES.space);assert.equal(errorMessage('16'),engineModule.MESSAGES.write);assert.equal(errorMessage(1),engineModule.MESSAGES.failed);
  for(const message of Object.values(engineModule.MESSAGES))assert.equal(publicErrorMessage(new Error(message),'torrent'),message);
});

test('file choices are written as aria2 ranges, and aria2’s file list must match exactly',()=>{
  assert.equal(selection([1,2,3,5,7,8,4]),'1-5,7-8');assert.equal(selection([3]),'3');assert.equal(selection([0,-1,1.5,'2']),'');
  const files=[{index:1,path:'G/a.bin',length:5},{index:2,path:'G/b.bin',length:6}],dir='C:\\Down\\.w';
  const answer=[{index:'1',path:'C:/Down/.w/G/a.bin',length:'5',selected:'true'},{index:'2',path:'C:/Down/.w/G/b.bin',length:'6',selected:'false'}];
  assert.equal(sameFiles(answer,files,dir,[1]),true);
  assert.equal(sameFiles(answer,files,dir,[1,2]),false);
  assert.equal(sameFiles([{...answer[0],path:'C:/Elsewhere/G/a.bin'},answer[1]],files,dir,[1]),false);
  assert.equal(sameFiles([{...answer[0],length:'50'},answer[1]],files,dir,[1]),false);
  assert.equal(sameFiles([answer[1],answer[0]],files,dir,[1]),false);
  assert.equal(sameFiles(answer.slice(0,1),files,dir,[1]),false);assert.equal(sameFiles(null,files,dir,[1]),false);
});

// A stand-in for aria2: a JSON-RPC answerer with downloads that progress on each status call.
function fakeAria2({torrents={},share=0,failStatus=null,badFiles=false,startFails=0,metadataPolls=2,linger=0}={}){
  const fake={spawned:[],calls:[],secret:'',downloads:new Map(),seq:0,startFails,exits:0};
  fake.spawn=(file,args,options)=>{
    const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=4242;
    fake.spawned.push({file,args,options});
    if(fake.startFails>0){fake.startFails--;setImmediate(()=>{child.exitCode=1;child.emit('exit',1);});return child;}
    fake.secret=args.find(arg=>arg.startsWith('--rpc-secret=')).slice(13);fake.port=Number(args.find(arg=>arg.startsWith('--rpc-listen-port=')).slice(18));
    fake.child=child;return child;
  };
  fake.kill=async child=>{child.exitCode=0;child.emit('exit',0);fake.exits++;};
  const gid=()=>(++fake.seq).toString(16).padStart(16,'0');
  fake.fetch=async(url,init)=>{
    const body=JSON.parse(init.body),[token,...params]=body.params;
    const method=body.method.replace(/^aria2\./,'');fake.calls.push({method,params,url});
    const reply=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}});
    if(!fake.child||fake.child.exitCode!==null||url!==`http://127.0.0.1:${fake.port}/jsonrpc`)throw new Error('connection refused');
    if(token!=='token:'+fake.secret)return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:1,message:'Unauthorized'}}),{status:400,headers:{'content-type':'application/json'}});
    switch(method){
      case 'getVersion':return reply({version:'1.37.0'});
      case 'addUri':{
        const id=gid(),hash=/btih:([0-9a-f]{40})/.exec(params[0][0])[1];
        fake.downloads.set(id,{kind:'metadata',dir:params[1].dir,hash,polls:0,status:'active'});return reply(id);
      }
      case 'addTorrent':{
        const id=gid(),buffer=Buffer.from(params[0],'base64'),options=params[2];
        const hash=crypto.createHash('sha1').update(magnet.decode(buffer).info).digest('hex');
        const read=magnet.readTorrent(buffer,hash);
        const chosen=new Set();for(const part of options['select-file'].split(','))
          {const [a,b]=part.split('-').map(Number);for(let n=a;n<=(b||a);n++)chosen.add(n);}
        fake.downloads.set(id,{kind:'torrent',read,dir:options.dir,chosen,options,status:'paused',polls:0,shared:0});return reply(id);
      }
      case 'getFiles':{
        const d=fake.downloads.get(params[0]);
        return reply(d.read.files.map(file=>({index:String(file.index),path:(d.dir+'/'+(badFiles?file.path.replace('setup','SETUP'):file.path)).replace(/\\/g,'/'),length:String(file.length),completedLength:'0',selected:String(d.chosen.has(file.index)),uris:[]})));
      }
      case 'unpause':{fake.downloads.get(params[0]).status='active';return reply(params[0]);}
      case 'tellStatus':{
        const d=fake.downloads.get(params[0]);if(!d)return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:1,message:'GID not found'}}),{status:400,headers:{'content-type':'application/json'}});
        d.polls++;
        if(d.kind==='metadata'){
          if(d.polls>=metadataPolls&&d.status==='active'){
            const saved=torrents[d.hash];if(saved)fs.writeFileSync(path.join(d.dir,d.hash+'.torrent'),saved);
            d.status='complete';
          }
          return reply({status:d.status,connections:'3',errorCode:'0'});
        }
        if(failStatus&&d.polls>=2)return reply({status:'error',errorCode:failStatus,totalLength:'0',completedLength:'0'});
        const total=d.read.files.filter(file=>d.chosen.has(file.index)).reduce((sum,file)=>sum+file.length,0);
        let done=Math.min(total,Math.floor(total*d.polls/3));
        if(d.status==='active'&&done>=total){
          // Write every chosen file, and a part of an unchosen one, as aria2 can.
          for(const file of d.read.files){
            const target=path.join(d.dir,...file.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});
            if(d.chosen.has(file.index))fs.writeFileSync(target,Buffer.alloc(file.length,1));else fs.writeFileSync(target,Buffer.alloc(1,2));
          }
          // aria2 can still say it is sharing for a moment after a download with no sharing time ends.
          if(d.options['seed-time']==='0'&&(d.lingered||0)<linger){d.lingered=(d.lingered||0)+1;return reply({status:'active',seeder:'true',totalLength:String(total),completedLength:String(total),downloadSpeed:'0',uploadSpeed:'0',uploadLength:'0',connections:'1',numSeeders:'1',errorCode:'0'});}
          if(d.options['seed-time']!=='0'&&d.shared<share){d.shared++;return reply({status:'active',seeder:'true',totalLength:String(total),completedLength:String(total),downloadSpeed:'0',uploadSpeed:'700',uploadLength:'9',connections:'2',numSeeders:'1',errorCode:'0'});}
          d.status='complete';
        }
        return reply({status:d.status,seeder:'false',totalLength:String(total),completedLength:String(done),downloadSpeed:'1000',uploadSpeed:'50',uploadLength:'3',connections:'5',numSeeders:'2',errorCode:'0'});
      }
      case 'forceRemove':{const d=fake.downloads.get(params[0]);if(d)d.status='removed';return reply(params[0]);}
      case 'removeDownloadResult':{
        // aria2 refuses to forget a download that is still running or sharing.
        const d=fake.downloads.get(params[0]);
        if(d&&['active','paused','waiting'].includes(d.status))return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:1,message:'Could not remove download result'}}),{status:400,headers:{'content-type':'application/json'}});
        fake.downloads.delete(params[0]);return reply('OK');
      }
      case 'changeGlobalOption':return reply('OK');
      case 'shutdown':{setImmediate(()=>{fake.child.exitCode=0;fake.child.emit('exit',0);});return reply('OK');}
      default:return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:1,message:'No such method'}}),{status:400,headers:{'content-type':'application/json'}});
    }
  };
  return fake;
}
const fakeTools=root=>({verified:async()=>({aria2c:path.join(root,'aria2c.exe'),dir:root,temp:path.join(root,'tmp'),cache:path.join(root,'cache')})});
function engineFor(t,fake,options={}){
  const root=scratch(t);
  const engine=new TorrentEngine({tools:fakeTools(root),stateDir:path.join(root,'state'),settings:()=>({uploadLimit:102400,downloadLimit:0}),spawnImpl:fake.spawn,rpcFetch:fake.fetch,kill:fake.kill,appPid:777,
    env:{SystemRoot:'C:\\Windows',USERPROFILE:'C:\\Users\\private-fixture'},pollMs:1,idleMs:30,startTimeoutMs:500,...options});
  beforeCleanup(root,()=>engine.dispose());
  return {engine,root};
}

test('the engine starts aria2 with a fresh secret, finds a file list, and checks it against the magnet link',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const fake=fakeAria2({torrents:{[infoHash]:buffer}}),{engine,root}=engineFor(t,fake,{idleMs:60000});
  const parsed=magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}&dn=Game`);
  const peers=[];
  const got=await engine.metadata(parsed,{onStatus:status=>peers.push(status.peers)});
  assert.deepEqual(got,magnet.sanitizeTorrent(buffer,infoHash));assert.ok(peers.includes(3));
  // Right away, before aria2's idle stop: requests without the secret are refused by aria2 (the stand-in does the same).
  const answer=await fake.fetch(`http://127.0.0.1:${fake.port}/jsonrpc`,{body:JSON.stringify({jsonrpc:'2.0',id:'x',method:'aria2.getVersion',params:['token:wrong']})});
  assert.equal((await answer.json()).error.message,'Unauthorized');
  const [spawned]=fake.spawned;
  assert.equal(spawned.file,path.join(root,'aria2c.exe'));assert.equal(spawned.options.shell,false);assert.equal(spawned.options.windowsHide,true);
  assert.equal(JSON.stringify(spawned.options.env).includes('private-fixture'),false,'the user profile is not passed on');
  assert.match(fake.secret,/^[a-f0-9]{64}$/);
  const add=fake.calls.find(call=>call.method==='addUri');
  assert.deepEqual(add.params[0],[parsed.magnet]);assert.equal(add.params[1]['bt-metadata-only'],'true');assert.equal(add.params[1]['follow-torrent'],'false');
  assert.ok(fake.calls.some(call=>call.method==='removeDownloadResult'));
  assert.equal(fs.readdirSync(path.join(root,'state','metadata')).length,0,'the temporary metadata folder is removed');
  // A file list that is not this torrent's is refused.
  const other=torrentFile(multi([[['other.bin'],1]]));
  const wrong=fakeAria2({torrents:{[infoHash]:other.buffer}}),second=engineFor(t,wrong);
  await assert.rejects(second.engine.metadata(parsed),{message:magnet.MESSAGES.damaged});
  // A file list larger than 10 MB is not read.
  const huge=fakeAria2({torrents:{[infoHash]:Buffer.alloc(10*1024*1024+1)}}),third=engineFor(t,huge);
  await assert.rejects(third.engine.metadata(parsed),{message:'The torrent downloader stopped unexpectedly. Retry to resume.'});
});

test('aria2 gets a new DHT node ID each time it starts: its DHT file is removed before a start and after a stop',async t=>{
  const fake=fakeAria2(),{engine,root}=engineFor(t,fake);
  const state=path.join(root,'state');fs.mkdirSync(state,{recursive:true});
  for(const name of ['dht.dat','dht.dat__temp','keep.txt'])fs.writeFileSync(path.join(state,name),'x');
  await engine.start();
  assert.deepEqual(fs.readdirSync(state).filter(name=>name.startsWith('dht')),[],'removed before aria2 starts');
  assert.equal(fs.existsSync(path.join(state,'keep.txt')),true,'nothing else is touched');
  fs.writeFileSync(path.join(state,'dht.dat'),'written by aria2');
  await engine.stop();
  assert.equal(fs.existsSync(path.join(state,'dht.dat')),false,'removed after aria2 stops');
});

test('download RPC gets only original-magnet trackers that pass preflight, even when saved metadata was changed',async t=>{
  const fixture=torrentFile(multi(),{announce:'http://127.0.0.1/secret','url-list':['https://unreviewed.example/file'],'announce-list':[['https://extra.example/announce']]});
  const read=magnet.readTorrent(fixture.buffer,fixture.infoHash),fake=fakeAria2();
  const seen=[],{engine,root}=engineFor(t,fake,{lookup:async host=>{seen.push(host);return [{address:host==='public.example'?'93.184.216.34':'10.0.0.1',family:4}];}});
  const original=`magnet:?xt=urn:btih:${fixture.infoHash}&tr=${encodeURIComponent('https://public.example/announce')}&tr=${encodeURIComponent('https://private.example/announce')}`;
  await engine.download({torrent:fixture.buffer,infoHash:fixture.infoHash,magnet:original,files:read.files,selected:[1],dir:path.join(root,'w')});
  const sent=magnet.decode(Buffer.from(fake.calls.find(call=>call.method==='addTorrent').params[0],'base64'));
  assert.deepEqual([...sent.root.keys()],['announce','announce-list','info']);
  assert.equal(sent.root.get('announce').toString(),'https://public.example/announce');
  assert.deepEqual(sent.root.get('announce-list').map(tier=>tier.map(value=>value.toString())),[['https://public.example/announce']]);
  assert.deepEqual(seen,['public.example','private.example'],'injected metadata destinations never get DNS queries');
  assert.deepEqual(sent.info,magnet.decode(fixture.buffer).info);
});

test('stop failure retains the live child and never reports successful termination',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  await engine.start();
  const originalRpc=engine.rpcFetch,originalKill=engine.kill;
  engine.rpcFetch=()=>new Promise(()=>{});engine.kill=async()=>{};
  const started=Date.now();
  try{
    await assert.rejects(engine.stop(Date.now()+400),{message:engineModule.MESSAGES.stopped});
    assert.ok(Date.now()-started<1000);
    assert.equal(engine.running,true,'failed termination cannot discard the only child handle');
    await assert.rejects(engine.start(),{message:engineModule.MESSAGES.stopped},'an engine that could not be stopped cannot be silently reused');
    assert.equal(fake.spawned.length,1);
  }finally{engine.rpcFetch=originalRpc;engine.kill=originalKill;await engine.stop();}
});

test('the default stop path terminates a harmless real child when shutdown RPC stalls',async t=>{
  const fake=fakeAria2();let child;
  const {engine}=engineFor(t,fake,{kill:undefined,idleMs:60000,
    spawnImpl:()=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});return child;},
    rpcFetch:async(_url,init)=>{const request=JSON.parse(init.body);if(request.method==='aria2.shutdown')return new Promise(()=>{});return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{version:'fixture'}}));}});
  try{
    await engine.start();assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
    const started=Date.now();await engine.stop();
    assert.ok(Date.now()-started<2000,'direct process termination avoids taskkill timeout');
    assert.ok(child.exitCode!==null||child.signalCode!==null,'the child exit is observed before success');
    assert.equal(engine.running,false);
  }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});

test('DHT cleanup has the stop deadline and a new engine waits for pending cleanup',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000,startTimeoutMs:100});
  await engine.start();
  const original=engine.cleanDht;let release;
  engine.cleanDht=()=>new Promise(resolve=>{release=resolve;});
  try{
    const started=Date.now();
    await assert.rejects(engine.stop(Date.now()+300),{message:engineModule.MESSAGES.stopped});
    assert.ok(Date.now()-started<1000);
    await assert.rejects(engine.start(),{message:engineModule.MESSAGES.stopped});
    assert.equal(fake.spawned.length,1,'old cleanup cannot overlap a new engine identity');
  }finally{engine.cleanDht=original;release?.();await engine.cleaning;}
});

test('with no sharing time, a moment of aria2 still sharing is not reported as sharing',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash);
  const fake=fakeAria2({linger:3}),{engine,root}=engineFor(t,fake);
  const shared=[];
  assert.deepEqual(await engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:path.join(root,'w'),shareMinutes:0},{onSharing:minutes=>shared.push(minutes)}),{complete:true,interrupted:false});
  assert.deepEqual(shared,[]);
});

test('a hung aria2 is stopped within seconds when a sharing torrent is stopped, and its DHT file goes when it exits by itself',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash);
  const fake=fakeAria2({share:1e9}),{engine,root}=engineFor(t,fake),dir=path.join(root,'w');fs.mkdirSync(dir);
  const original=fake.fetch;
  engine.rpcFetch=async(url,init)=>{const body=JSON.parse(init.body);if(['aria2.forceRemove','aria2.removeDownloadResult','aria2.shutdown'].includes(body.method))return new Promise(()=>{});return original(url,init);};
  const ctl=new AbortController(),started=Date.now();
  // The one-second limits use timers that do not keep a test process alive, as they would not keep the app alive either.
  const alive=setInterval(()=>{},50);t.after(()=>clearInterval(alive));
  assert.deepEqual(await engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir,shareMinutes:15},{signal:ctl.signal,onSharing:()=>ctl.abort()}),{complete:true,interrupted:true});
  clearInterval(alive);
  assert.ok(Date.now()-started<6000,'one total shutdown deadline even when every RPC ignores cancellation');assert.equal(engine.running,false);assert.equal(fake.exits,1);
  // aria2 ending on its own (a crash) also takes its DHT file away.
  const crash=fakeAria2(),second=engineFor(t,crash),state=path.join(second.root,'state');
  await second.engine.start();fs.writeFileSync(path.join(state,'dht.dat'),'x');
  crash.child.exitCode=1;crash.child.emit('exit',1);
  await tick(50);
  assert.equal(fs.existsSync(path.join(state,'dht.dat')),false);
});

test('a start while aria2 is stopping waits for the stop, then starts aria2 again',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake);
  await engine.start();assert.equal(fake.spawned.length,1);
  const stopping=engine.stop();
  await engine.start();
  await stopping;
  assert.equal(engine.running,true,'aria2 runs after the start');
  assert.equal(fake.spawned.length,2,'it was started again after the stop');
});

test('the engine stops a magnet lookup when asked, and stops aria2 when nothing uses it',async t=>{
  const {infoHash}=torrentFile(multi());
  const fake=fakeAria2({metadataPolls:1e9}),{engine}=engineFor(t,fake);
  const controller=new AbortController();
  const lookup=engine.metadata(magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}`),{signal:controller.signal});
  await tick(20);controller.abort();
  await assert.rejects(lookup,error=>error.name==='AbortError');
  assert.ok(fake.calls.some(call=>call.method==='forceRemove'));
  for(let i=0;i<100&&engine.running;i++)await tick(5);
  assert.equal(engine.running,false,'aria2 stops after the idle time');
  // No file list from anyone within the time limit.
  const slow=fakeAria2({metadataPolls:1e9}),timed=engineFor(t,slow,{metadataTimeoutMs:10});
  await assert.rejects(timed.engine.metadata(magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}`)),{message:engineModule.MESSAGES.noPeers});
});

test('the engine tries three ports and then reports that it could not start',async t=>{
  const fake=fakeAria2({startFails:3}),{engine}=engineFor(t,fake,{startTimeoutMs:50});
  const {infoHash}=torrentFile(multi());
  await assert.rejects(engine.metadata(magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}`)),{message:engineModule.MESSAGES.start});
  assert.equal(fake.spawned.length,3);
});

test('a stalled startup probe cannot hang or launch another engine when termination fails',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{startTimeoutMs:50,idleMs:60000,rpcFetch:()=>new Promise(()=>{}),kill:()=>new Promise(()=>{})});
  const originalStop=engine.stop.bind(engine),originalHalt=engine.halt.bind(engine);
  // Keep the same stop policy with a short budget for this failure fixture.
  engine.stop=deadline=>originalStop(deadline??Date.now()+400);engine.halt=deadline=>originalHalt(deadline??Date.now()+400);
  const started=Date.now();
  try{
    await assert.rejects(engine.start(),{message:engineModule.MESSAGES.stopped});
    assert.ok(Date.now()-started<1000,'both startup probe and failed termination are bounded');
    assert.equal(fake.spawned.length,1,'no second process before the first has exited');
    assert.equal(engine.running,true,'the live child remains tracked');
    await assert.rejects(engine.start(),{message:engineModule.MESSAGES.stopped});
    assert.equal(fake.spawned.length,1);
  }finally{engine.rpcFetch=fake.fetch;engine.kill=fake.kill;engine.stop=originalStop;engine.halt=originalHalt;await engine.stop();}
});

test('failed startup probes retry only after each previous child has exited',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{startTimeoutMs:30,idleMs:60000});
  const fetch=fake.fetch;
  engine.rpcFetch=async(url,init)=>JSON.parse(init.body).method==='aria2.getVersion'?new Promise(()=>{}):fetch(url,init);
  const spawn=fake.spawn;
  engine.spawnImpl=(...args)=>{if(fake.child)assert.notEqual(fake.child.exitCode,null,'previous child was stopped before another spawn');return spawn(...args);};
  await assert.rejects(engine.start(),{message:engineModule.MESSAGES.start});
  assert.equal(fake.spawned.length,3);assert.equal(engine.running,false);
});

test('concurrent starts share the readiness probe rather than accepting an unready child',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  let release,probing;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{probing=resolve;});
  engine.rpcFetch=async(url,init)=>{if(JSON.parse(init.body).method==='aria2.getVersion'){probing();await gate;}return fake.fetch(url,init);};
  let ready=0;const first=engine.start().then(()=>{ready++;});
  await seen;const second=engine.start().then(()=>{ready++;});
  try{await tick(10);assert.equal(ready,0,'a live child does not establish RPC readiness');assert.equal(fake.spawned.length,1);}
  finally{release();await Promise.all([first,second]);}
  assert.equal(ready,2);assert.equal(fake.spawned.length,1);
});

test('closing while callers wait for startup never reports a ready engine',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  let release,probing;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{probing=resolve;});
  engine.rpcFetch=async(url,init)=>{if(JSON.parse(init.body).method==='aria2.getVersion'){probing();await gate;}return fake.fetch(url,init);};
  const first=assert.rejects(engine.start(),{message:engineModule.MESSAGES.start});
  await seen;const second=assert.rejects(engine.start(),{message:engineModule.MESSAGES.start});
  const closing=engine.dispose();release();
  await Promise.all([first,second,closing]);
  assert.equal(fake.spawned.length,1);assert.equal(engine.running,false);
});

test('the engine downloads only the chosen files, after checking aria2’s file list',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash);
  const fake=fakeAria2(),{engine,root}=engineFor(t,fake),dir=path.join(root,'work');fs.mkdirSync(dir);
  const progress=[];
  const result=await engine.download({torrent:buffer,infoHash,files:read.files,selected:[1,2,4],dir},{onProgress:p=>progress.push(p)});
  assert.deepEqual(result,{complete:true,interrupted:false});
  const add=fake.calls.find(call=>call.method==='addTorrent');
  assert.equal(add.params[2]['select-file'],'1-2,4');assert.equal(add.params[2].pause,'true');assert.equal(add.params[2]['seed-time'],'0');assert.equal(add.params[2]['check-integrity'],'false');
  const order=fake.calls.map(call=>call.method);
  assert.ok(order.indexOf('getFiles')<order.indexOf('unpause'),'files are checked before anything downloads');
  assert.ok(progress.some(p=>p.peers===5&&p.uploadSpeed===50&&p.received>0&&p.total===33));
  // A file list that differs from the one shown stops the torrent before it starts.
  const other=fakeAria2({badFiles:true}),second=engineFor(t,other);
  await assert.rejects(second.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir}),{message:engineModule.MESSAGES.changed});
  assert.equal(other.calls.some(call=>call.method==='unpause'),false);assert.ok(other.calls.some(call=>call.method==='forceRemove'));
  // A saved list that changed since it was checked is refused too.
  await assert.rejects(engine.download({torrent:buffer,infoHash,files:read.files.slice(1),selected:[2],dir}),{message:engineModule.MESSAGES.changed});
  await assert.rejects(engine.download({torrent:buffer,infoHash,files:read.files,selected:[],dir}),{message:engineModule.MESSAGES.changed});
  // aria2's disk errors become plain messages.
  const full=fakeAria2({failStatus:'9'}),third=engineFor(t,full);
  await assert.rejects(third.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir}),{message:engineModule.MESSAGES.space});
});

test('sharing after a download can be stopped without losing the finished files, and stopping before the end does lose nothing',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash);
  const fake=fakeAria2({share:1e9}),{engine,root}=engineFor(t,fake),dir=path.join(root,'work');fs.mkdirSync(dir);
  const controller=new AbortController();let sharingFor=null;
  const running=engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir,shareMinutes:15},{signal:controller.signal,onSharing:minutes=>{sharingFor=minutes;controller.abort();}});
  assert.deepEqual(await running,{complete:true,interrupted:true});assert.equal(sharingFor,15);
  assert.equal(fake.calls.find(call=>call.method==='addTorrent').params[2]['seed-time'],'15');
  // Stopping while sharing really ends the sharing: aria2 removes the torrent before the call returns.
  assert.ok(fake.calls.some(call=>call.method==='forceRemove'),'the sharing torrent is removed from aria2');
  assert.equal(fake.downloads.size,0,'aria2 no longer holds it');
  // If aria2 will not let go, aria2 itself is stopped.
  const stubborn=fakeAria2({share:1e9}),held=engineFor(t,stubborn),dir2=path.join(held.root,'work');fs.mkdirSync(dir2);
  const original=stubborn.fetch;let refused=0;
  stubborn.fetch=async(url,init)=>{const body=JSON.parse(init.body);if(body.method==='aria2.forceRemove'){refused++;return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:'OK'}),{headers:{'content-type':'application/json'}});}return original(url,init);};
  held.engine.rpcFetch=stubborn.fetch;
  const ctl=new AbortController();
  assert.deepEqual(await held.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:dir2,shareMinutes:60},{signal:ctl.signal,onSharing:()=>ctl.abort()}),{complete:true,interrupted:true});
  assert.equal(refused,1);assert.equal(held.engine.running,false,'aria2 was stopped');
  // Only the offered sharing times are used.
  const odd=fakeAria2(),second=engineFor(t,odd);
  await second.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:path.join(root,'w2'),shareMinutes:999});
  assert.equal(odd.calls.find(call=>call.method==='addTorrent').params[2]['seed-time'],'0');
  // Stopping before the files are complete is a stop.
  const early=fakeAria2(),third=engineFor(t,early,{pollMs:50});
  const stop=new AbortController();
  const paused=third.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:path.join(root,'w3')},{signal:stop.signal});
  await tick(20);stop.abort();
  await assert.rejects(paused,error=>error.name==='AbortError');
  // Resuming without aria2's progress file checks the pieces first.
  const resumed=fakeAria2(),fourth=engineFor(t,resumed);
  await fourth.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:path.join(root,'w3'),resume:true});
  assert.equal(resumed.calls.find(call=>call.method==='addTorrent').params[2]['check-integrity'],'true');
  fs.mkdirSync(path.join(root,'w4'));fs.writeFileSync(path.join(root,'w4',read.name+'.aria2'),'x');
  const withProgress=fakeAria2(),fifth=engineFor(t,withProgress);
  await fifth.engine.download({torrent:buffer,infoHash,files:read.files,selected:[1],dir:path.join(root,'w4'),resume:true});
  assert.equal(withProgress.calls.find(call=>call.method==='addTorrent').params[2]['check-integrity'],'false');
});

// A torrent runner that writes the chosen files into the working folder, as the engine would.
function fakeRunner({sharing=false,missing=false}={}){
  const runner={calls:[]};
  runner.download=async(d,{signal,workspace,resume,onProgress,onSharing})=>{
    runner.calls.push({id:d.id,workspace,resume});
    for(const file of d.torrent.files){
      const target=path.join(workspace,...file.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});
      if(file.selected&&!(missing&&file.index===1))fs.writeFileSync(target,Buffer.alloc(file.length,1));
      else if(!file.selected)fs.writeFileSync(target,Buffer.alloc(1,2));
    }
    onProgress({received:5,total:10,peers:7,uploadSpeed:300,uploaded:4});
    if(sharing){onSharing(60);await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {complete:true,interrupted:true};}
    return {complete:true,interrupted:false};
  };
  return runner;
}
function managerFor(t,runner,more={}){
  const root=scratch(t),marked=[],scanned=[];
  const manager=new DownloadManager({stateFile:path.join(root,'library.json'),downloadDir:path.join(root,'Downloads'),torrent:runner,markFile:async file=>{marked.push(file);},scanFile:async (file,options)=>{scanned.push([file,options]);return {status:'clean',message:''};},...more});
  manager.updateSettings({concurrency:2,defenderScan:true});
  beforeCleanup(root,()=>manager.stop());
  const finished=async()=>{for(let i=0;i<2000&&(manager.running.size||manager.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(2);};
  return {root,manager,marked,scanned,finished};
}
const filesOf=(read,chosen)=>read.files.map(file=>({...file,selected:chosen.includes(file.index)}));

test('a torrent job downloads into a hidden folder and appears in one step, with only the chosen files',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash),runner=fakeRunner(),q=managerFor(t,runner);
  const magnetLink=`magnet:?xt=urn:btih:${infoHash}&dn=Game`;
  const added=q.manager.addTorrent({infoHash,magnet:magnetLink,name:read.name,files:filesOf(read,[1,2,4]),gameTitle:'My Game'});
  assert.equal(added.added,1);
  assert.deepEqual(q.manager.addTorrent({infoHash,magnet:magnetLink,name:read.name,files:filesOf(read,[1]),gameTitle:'My Game'}),{added:0,ids:added.ids},'the same torrent is not added twice');
  await q.finished();
  const [d]=q.manager.downloads;
  assert.equal(d.status,'completed',d.error);
  const final=path.join(q.root,'Downloads','My Game','Game [FitGirl Repack]');
  assert.equal(path.join(d.folder,d.name),final);
  assert.deepEqual(fs.readdirSync(final).sort(),['MD5','fg-01.bin','setup.exe']);
  assert.equal(fs.existsSync(path.join(final,'fg-optional-bonus.bin')),false,'a part of an unchosen file is removed');
  assert.equal(fs.existsSync(torrentWorkspace(d)),false);
  assert.deepEqual(q.marked.sort(),[path.join(final,'MD5','fitgirl-bins.md5'),path.join(final,'fg-01.bin'),path.join(final,'setup.exe')].sort());
  for(let i=0;i<200&&!q.scanned.length;i++)await tick(2);
  assert.deepEqual(q.scanned,[[final,{folder:true}]],'the whole folder is scanned as a folder');
  assert.equal(d.total,33);assert.equal(d.received,33);
  // The window gets counts, not the file list.
  const shown=q.manager.state().downloads[0].torrent;
  assert.deepEqual(shown,{infoHash,name:read.name,fileCount:4,selectedCount:3,peers:0,uploadSpeed:0,uploaded:4,sharing:false});
  // The same torrent again into the same folder gets its own name instead of mixing with the first.
  q.manager.downloads[0].status='cancelled';
  q.manager.addTorrent({infoHash,magnet:magnetLink,name:read.name,files:filesOf(read,[1]),gameTitle:'My Game'});
  await q.finished();
  assert.equal(q.manager.downloads[1].status,'completed',q.manager.downloads[1].error);
  assert.equal(q.manager.downloads[1].name,'Game [FitGirl Repack] (1)');
  assert.deepEqual(fs.readdirSync(path.join(q.root,'Downloads','My Game','Game [FitGirl Repack] (1)')),['setup.exe']);
});

test('a torrent of one file is published and scanned as that file',async t=>{
  const {buffer,infoHash}=torrentFile({name:'Game.iso',length:7,'piece length':16384,pieces:Buffer.alloc(20)});
  const read=magnet.readTorrent(buffer,infoHash),q=managerFor(t,fakeRunner());
  q.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}&dn=Game.iso`,name:read.name,files:filesOf(read,[read.files[0].index]),gameTitle:'My Game'});
  await q.finished();
  const [d]=q.manager.downloads;
  assert.equal(d.status,'completed',d.error);
  const final=path.join(q.root,'Downloads','My Game','Game.iso');
  assert.equal(fs.statSync(final).isFile(),true);
  for(let i=0;i<200&&!q.scanned.length;i++)await tick(2);
  assert.deepEqual(q.scanned,[[final,{folder:false}]]);
});

test('torrent jobs refuse unsafe paths, empty choices and paths too long for Windows',t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash),q=managerFor(t,fakeRunner()),link=`magnet:?xt=urn:btih:${infoHash}`;
  const add=patch=>q.manager.addTorrent({infoHash,magnet:link,name:read.name,files:filesOf(read,[1]),gameTitle:'G',...patch});
  assert.throws(()=>add({files:filesOf(read,[])}),{message:TORRENT.choose});
  assert.throws(()=>add({files:read.files.map(file=>({...file,selected:file.index===1,padding:true}))}),{message:TORRENT.choose},'padding files are never chosen');
  assert.throws(()=>add({files:[{index:1,path:read.name+'/../../evil.exe',length:1,selected:true}]}),{message:magnet.MESSAGES.names});
  assert.throws(()=>add({files:[{index:1,path:'Elsewhere/x.bin',length:1,selected:true}]}),{message:magnet.MESSAGES.damaged});
  assert.throws(()=>add({files:[{index:1,path:read.name+'/CON',length:1,selected:true}]}),{message:magnet.MESSAGES.names});
  assert.throws(()=>add({files:[{index:2,path:read.name+'/a',length:1,selected:true}]}),{message:magnet.MESSAGES.damaged});
  assert.throws(()=>add({name:'../x'}),{message:magnet.MESSAGES.names});
  assert.throws(()=>add({infoHash:'xyz'}),{message:magnet.MESSAGES.invalid});
  assert.throws(()=>add({magnet:`magnet:?xt=urn:btih:${'0'.repeat(40)}`}),{message:magnet.MESSAGES.invalid});
  const deep=read.name+'/'+Array.from({length:4},()=>'d'.repeat(60)).join('/')+'/f.bin';
  assert.throws(()=>add({files:[{index:1,path:deep,length:1,selected:true}]}),{message:magnet.MESSAGES.tooLong});
  assert.equal(q.manager.downloads.length,0);
  // A torrent from the browser goes to its own folder.
  add({gameTitle:''});
  assert.equal(path.basename(q.manager.downloads[0].folder),TORRENTS_FOLDER);
});

test('stopping a torrent while it shares still finishes it; a missing file is an error; progress carries people and upload',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash),runner=fakeRunner({sharing:true}),q=managerFor(t,runner);
  const updates=[];q.manager.on('progress',items=>updates.push(...items));
  q.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1]),gameTitle:'G'});
  const [d]=q.manager.downloads;
  for(let i=0;i<500&&!d.torrent.sharing;i++)await tick(2);
  assert.equal(d.connectionNote,'Download complete. Sharing with other people for up to an hour.');
  for(let i=0;i<500&&!updates.length;i++)await tick(2);
  assert.deepEqual(Object.keys(updates[0]).sort(),['activeConnections','id','peers','received','speed','total','uploadSpeed']);
  assert.equal(updates[0].peers,7);assert.equal(updates[0].uploadSpeed,300);
  q.manager.action(d.id,'pause');await q.finished();
  assert.equal(d.status,'completed',d.error);
  const broken=managerFor(t,fakeRunner({missing:true}));
  broken.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1,2]),gameTitle:'G'});
  await broken.finished();
  assert.equal(broken.manager.downloads[0].status,'error');assert.equal(broken.manager.downloads[0].error,engineModule.MESSAGES.changed);
  const none=managerFor(t,null);
  none.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1]),gameTitle:'G'});
  await none.finished();
  assert.equal(none.manager.downloads[0].error,'Turn on torrent downloads in Settings first, then retry.');
});

function integrationFor(t,{fake=fakeAria2(),platform='win32',ready=true,settings,before=null,now=Date.now,lookup}={}){
  const root=scratch(t),registered=new Map(),published=[];
  const manager=new DownloadManager({stateFile:path.join(root,'library.json'),downloadDir:path.join(root,'Downloads')});
  if(settings)manager.settings.torrents=settings;
  if(before)before(root,manager);
  beforeCleanup(root,()=>manager.stop());
  const tools={refresh:()=>ready?'ready':'missing',snapshot:()=>({phase:ready?'ready':'missing'}),install(){this.installed=true;},cancel(){},remove:async()=>{},removeOthers:async()=>{},dispose:async()=>{},verified:fakeTools(root).verified};
  const integration=createTorrentIntegration({app:{getPath:()=>root},win:null,manager,register:(name,fn)=>registered.set(name,fn),publish:()=>published.push(1),platform,now,
    folders:{tools:path.join(root,'tools'),state:path.join(root,'state'),store:path.join(root,'store')},
    toolsOptions:{},engineOptions:{spawnImpl:fake.spawn,rpcFetch:fake.fetch,kill:fake.kill,pollMs:1,idleMs:30,startTimeoutMs:500,env:{SystemRoot:'C:\\Windows'},...(lookup?{lookup}:{})}});
  // The pinned tool set is replaced by a stand-in that is always ready (or never).
  integration.engine.tools=tools;
  const original=integration.tools;Object.assign(original,{refresh:tools.refresh,install:()=>{tools.installed=true;return tools.snapshot();},remove:tools.remove});
  beforeCleanup(root,()=>integration.beforeQuit());
  return {root,manager,registered,integration,tools,call:(name,value)=>registered.get(name)(value)};
}

test('at start, saved file lists of torrents no longer in the downloads are removed, and nothing else',async t=>{
  const kept='a'.repeat(40),gone='b'.repeat(40);
  const s=integrationFor(t,{before:(root,manager)=>{
    const store=path.join(root,'store');fs.mkdirSync(path.join(store,'folder.torrent'),{recursive:true});
    for(const name of [kept+'.torrent',gone+'.torrent',gone+'.torrent.0f1e2d3c-4b5a-4968-8776-655443322110.tmp','notes.txt','C'.repeat(40)+'.torrent'])fs.writeFileSync(path.join(store,name),'x');
    manager.downloads.push({id:'job',kind:'torrent',status:'paused',folder:root,name:'Game',headers:{},torrent:{infoHash:kept,name:'Game',files:[]}});
  }});
  await s.integration.pruned;
  assert.deepEqual(fs.readdirSync(path.join(s.root,'store')).sort(),['C'.repeat(40)+'.torrent',kept+'.torrent','folder.torrent','notes.txt']);
  // No saved file lists at all is fine too.
  const empty=integrationFor(t);await empty.integration.pruned;
  assert.equal(fs.existsSync(path.join(empty.root,'store')),false);
});

test('unreadable or partly recovered queue state never prunes saved torrent metadata',async t=>{
  for(const recovery of [{stateCanSave:false},{stateRecoveryWarning:'A saved download could not be recovered.'}]){
    const name='a'.repeat(40)+'.torrent';
    const s=integrationFor(t,{before:(root,manager)=>{Object.assign(manager,recovery);fs.mkdirSync(path.join(root,'store'));fs.writeFileSync(path.join(root,'store',name),'fixture metadata');}});
    await s.integration.pruned;
    assert.equal(fs.readFileSync(path.join(s.root,'store',name),'utf8'),'fixture metadata');
  }
});

test('torrents are off until the user accepts what they share, and cannot be turned off while downloading',async t=>{
  assert.deepEqual(normalizeSettings({enabled:true}),{enabled:false,accepted:false,uploadLimit:102400,shareMinutes:0});
  assert.deepEqual(normalizeSettings({enabled:true,accepted:true,uploadLimit:999,shareMinutes:7}),{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0});
  const s=integrationFor(t);
  assert.equal(s.integration.snapshot().enabled,false);
  assert.throws(()=>s.call('saveTorrentSettings',{enabled:true}),{message:TORRENT.accept});
  assert.throws(()=>s.call('openMagnet',{magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40)}),{message:TORRENT.off});
  assert.deepEqual(s.integration.receive({magnet:'magnet:?xt=urn:btih:'+'a'.repeat(40)}),{action:'off'});
  const on=s.call('saveTorrentSettings',{enabled:true,accepted:true,uploadLimit:UPLOAD_LIMITS[1],shareMinutes:15});
  assert.deepEqual([on.enabled,on.accepted,on.uploadLimit,on.shareMinutes],[true,true,50*1024,15]);
  assert.throws(()=>s.call('saveTorrentSettings',{uploadLimit:0}),{message:TORRENT.limit},'uploading cannot be unlimited or off');
  assert.throws(()=>s.call('saveTorrentSettings',{shareMinutes:5}),{message:TORRENT.share});
  // Turned on again later without asking again.
  s.call('saveTorrentSettings',{enabled:false});assert.equal(s.call('saveTorrentSettings',{enabled:true}).enabled,true);
  const {buffer,infoHash}=torrentFile(multi()),read=magnet.readTorrent(buffer,infoHash);
  s.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1]),gameTitle:'G'});
  assert.throws(()=>s.call('saveTorrentSettings',{enabled:false}),{message:TORRENT.stillActive});
  const off=integrationFor(t,{platform:'linux'});
  assert.throws(()=>off.call('saveTorrentSettings',{enabled:true,accepted:true}),{message:TOOL_MESSAGES.unsupported});
});

test('a magnet link is read, its files are shown, and only the chosen ones are queued',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const fake=fakeAria2({torrents:{[infoHash]:buffer}}),s=integrationFor(t,{fake,settings:{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0}});
  const started=s.call('openMagnet',{magnet:`magnet:?xt=urn:btih:${infoHash}&dn=Game&ws=https%3A%2F%2Fseed.example%2F`,gameTitle:'My Game'});
  assert.equal(started.status,'finding');
  let view;for(let i=0;i<500;i++){view=s.integration.snapshot().requests[0];if(view.status!=='finding')break;await tick(2);}
  assert.equal(view.status,'ready',view.error);
  assert.deepEqual(view.files.map(file=>file.path),['Game [FitGirl Repack]/setup.exe','Game [FitGirl Repack]/fg-01.bin','Game [FitGirl Repack]/fg-optional-bonus.bin','Game [FitGirl Repack]/MD5/fitgirl-bins.md5']);
  assert.equal(view.totalLength,38);assert.equal(JSON.stringify(view).includes('seed.example'),false);
  await assert.rejects(s.call('addTorrent',{id:view.id,selected:'1'}),{message:TORRENT.choose});
  const result=await s.call('addTorrent',{id:view.id,selected:[1,2]});
  assert.equal(result.added,1);
  const [d]=s.manager.downloads;
  assert.equal(d.kind,'torrent');assert.equal(path.basename(d.folder),'My Game');
  assert.deepEqual(d.torrent.files.filter(file=>file.selected).map(file=>file.index),[1,2]);
  assert.equal(d.url.includes('seed.example'),false,'the queued link is the checked one');
  assert.deepEqual(fs.readFileSync(path.join(s.root,'store',infoHash+'.torrent')),magnet.sanitizeTorrent(buffer,infoHash),'only the checked info bytes and reviewed trackers are kept for resuming');
  assert.equal(s.integration.snapshot().requests.length,0);
  await assert.rejects(s.call('addTorrent',{id:view.id,selected:[1]}),{message:TORRENT.request});
  // A second look at the same torrent uses the kept list and asks no one.
  const before=fake.calls.filter(call=>call.method==='addUri').length;
  const again=s.call('openMagnet',{magnet:`magnet:?xt=urn:btih:${infoHash}`});
  for(let i=0;i<200&&s.integration.snapshot().requests[0]?.status==='finding';i++)await tick(2);
  assert.equal(s.integration.snapshot().requests[0].status,'ready');assert.equal(fake.calls.filter(call=>call.method==='addUri').length,before);
  s.call('closeMagnet',again.id);assert.equal(s.integration.snapshot().requests.length,0);
});

test('a magnet link from the browser waits for the user, and a bad one is refused',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const s=integrationFor(t,{fake:fakeAria2({torrents:{[infoHash]:buffer}}),settings:{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0}});
  assert.deepEqual(s.integration.receive({magnet:`magnet:?xt=urn:btih:${infoHash}`}),{action:'review'});
  assert.equal(s.integration.snapshot().requests[0].source,'browser');
  assert.deepEqual(s.integration.receive({magnet:'magnet:?xt=urn:btih:nothex'}),{action:'invalid'});
  const unset=integrationFor(t,{ready:false,settings:{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0}});
  assert.deepEqual(unset.integration.receive({magnet:`magnet:?xt=urn:btih:${infoHash}`}),{action:'setup'});
  assert.throws(()=>unset.call('openMagnet',{magnet:`magnet:?xt=urn:btih:${infoHash}`}),{message:TOOL_MESSAGES.setup});
  // Only a plain magnet link crosses from the extension.
  assert.deepEqual(validateRequest({v:1,type:'magnet',magnet:`magnet:?xt=urn:btih:${infoHash}`}),{type:'magnet',magnet:`magnet:?xt=urn:btih:${infoHash}`});
  for(const bad of [{v:1,type:'magnet'},{v:1,type:'magnet',magnet:'https://x.example/'},{v:1,type:'magnet',magnet:'magnet:?xt=a\n'},{v:1,type:'magnet',magnet:'magnet:?'+'a'.repeat(9000)},{v:1,type:'magnet',magnet:'magnet:?xt=a',pageUrl:'https://x.example/'}])
    assert.throws(()=>validateRequest(bad),/Invalid browser request/);
});

test('a magnet link from the browser waits while torrents are not set up, and opens when setup finishes',async t=>{
  const {buffer,infoHash}=torrentFile(multi()),other='c'.repeat(40);
  const on={enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0};
  const s=integrationFor(t,{ready:false,fake:fakeAria2({torrents:{[infoHash]:buffer}}),settings:on});
  const link=`magnet:?xt=urn:btih:${infoHash}&dn=Game`;
  assert.deepEqual(s.integration.receive({magnet:link}),{action:'setup'});
  assert.deepEqual(s.integration.receive({magnet:link}),{action:'setup'},'the same torrent waits once');
  assert.equal(s.integration.snapshot().waiting,1);
  assert.deepEqual(s.integration.receive({magnet:'magnet:?xt=urn:btih:nothex'}),{action:'invalid'});
  for(let i=0;i<4;i++)s.integration.receive({magnet:`magnet:?xt=urn:btih:${String(i).repeat(40)}`});
  assert.equal(s.integration.snapshot().waiting,5);
  assert.deepEqual(s.integration.receive({magnet:`magnet:?xt=urn:btih:${other}`}),{action:'busy'},'at most five wait');
  assert.equal(s.integration.snapshot().requests.length,0,'nothing is looked up before setup');
  // Setup finishes: the waiting links open for review, as links from the browser.
  const ready=()=>'ready';s.integration.tools.refresh=ready;s.integration.engine.tools.refresh=ready;s.tools.refresh=ready;
  s.integration.tools.onReady();
  const snap=s.integration.snapshot();
  assert.equal(snap.waiting,0);
  assert.equal(snap.requests.length,5);
  assert.ok(snap.requests.every(request=>request.source==='browser'));
  assert.equal(snap.requests[0].name,'Game');
  // Turning torrents off forgets links still waiting.
  const later=integrationFor(t,{ready:false,settings:on});
  later.integration.receive({magnet:link});
  later.call('saveTorrentSettings',{enabled:false});
  assert.equal(later.integration.snapshot().waiting,0);
  // A waiting link is kept for an hour at most.
  let clock=1_000_000;
  const timed=integrationFor(t,{ready:false,settings:on,now:()=>clock});
  timed.integration.receive({magnet:link});
  clock+=60*60*1000;assert.equal(timed.integration.snapshot().waiting,1);
  clock+=1;assert.equal(timed.integration.snapshot().waiting,0);
});

test('the pinned torrent engine is aria2 1.37.0, checked by size and SHA-256',()=>{
  assert.equal(TOOLS.length,1);
  const [tool]=TOOLS;
  assert.equal(tool.url,'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip');
  assert.equal(tool.size,2475379);assert.equal(tool.sha256,'67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288');
  assert.deepEqual(tool.files.map(({role,entry,name,size,sha256})=>({role,entry,name,size,sha256})),[{role:'aria2c',entry:'aria2-1.37.0-win-64bit-build1/aria2c.exe',name:'aria2c.exe',size:5649408,sha256:'be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2'}]);
  assert.equal(Object.isFrozen(tool),true);assert.equal(Object.isFrozen(tool.files[0]),true);
  for(const message of [...Object.values(TOOL_MESSAGES),...Object.values(TORRENT)])assert.equal(publicErrorMessage(new Error(message),'setUpTorrents'),message);
});

test('Delete files removes only a torrent’s own files, and never a folder another download owns',async t=>{
  const {createDownloadCleanup}=require('../src/download-cleanup.cjs');
  const {buffer,infoHash}=torrentFile(multi());
  const read=magnet.readTorrent(buffer,infoHash),q=managerFor(t,fakeRunner());
  q.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1,2,4]),gameTitle:'G'});
  await q.finished();
  const [d]=q.manager.downloads,top=path.join(d.folder,d.name);
  assert.equal(d.status,'completed',d.error);
  fs.writeFileSync(path.join(top,'my notes.txt'),'mine');
  const cleanup=createDownloadCleanup({getDownloads:()=>q.manager.downloads});
  const preview=await cleanup.preview([d.id]);
  assert.deepEqual(preview.warnings,[]);assert.equal(preview.items[0].bytes,33);
  const result=await cleanup.deletePreview({ids:[d.id],token:preview.token});
  assert.deepEqual(result.removedIds,[d.id]);assert.equal(result.bytesFreed,33);
  assert.deepEqual(fs.readdirSync(top),['my notes.txt'],'a file the torrent did not list stays, so its folder stays');
  // A torrent that is not finished owns only its working folder.
  const other=managerFor(t,{download:async(job,{workspace,signal})=>{
    const target=path.join(workspace,...job.torrent.files[0].path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.alloc(4));
    fs.writeFileSync(path.join(workspace,job.torrent.name+'.aria2'),'progress');
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Object.assign(new Error('stopped'),{name:'AbortError'});
  }});
  other.manager.addTorrent({infoHash,magnet:`magnet:?xt=urn:btih:${infoHash}`,name:read.name,files:filesOf(read,[1]),gameTitle:'G'});
  const [partial]=other.manager.downloads;
  // A finished copy under the same name, published by someone else, must never be touched.
  const published=path.join(partial.folder,read.name);fs.mkdirSync(published,{recursive:true});fs.writeFileSync(path.join(published,'setup.exe'),'other');
  for(let i=0;i<500&&!fs.existsSync(path.join(torrentWorkspace(partial),read.name+'.aria2'));i++)await tick(2);
  other.manager.action(partial.id,'pause');await other.finished();
  const otherCleanup=createDownloadCleanup({getDownloads:()=>other.manager.downloads});
  const second=await otherCleanup.preview([partial.id]);
  assert.equal(second.items[0].bytes,4+'progress'.length);
  const removed=await otherCleanup.deletePreview({ids:[partial.id],token:second.token});
  assert.deepEqual(removed.removedIds,[partial.id]);
  assert.equal(fs.existsSync(torrentWorkspace(partial)),false);
  assert.equal(fs.readFileSync(path.join(published,'setup.exe'),'utf8'),'other');
});

// 0.10.2

test('tracker DNS checks use IPv4 answers only, and hanging lookups cannot hold up the healthy ones',async()=>{
  const hash='b'.repeat(40),signals=[],options=[];
  const trackers=['udp://healthy.example:80/a','udp://dual.example:80/a','udp://v6only.example:80/a',...[1,2,3,4,5,6].map(n=>`udp://dead${n}.example:80/a`),'udp://8.8.8.8:80/a'];
  const lookup=(host,option)=>{
    options.push(option);signals.push(option.signal);
    if(host==='healthy.example')return Promise.resolve([{address:'93.184.216.34',family:4}]);
    // aria2 runs without IPv6, so IPv6 answers (here a local and a NAT64 one) do not count.
    if(host==='dual.example')return Promise.resolve([{address:'93.184.216.34',family:4},{address:'fd00::1',family:6},{address:'64:ff9b::5db8:d822',family:6}]);
    if(host==='v6only.example')return Promise.resolve([{address:'2001:4860:4860::8888',family:6}]);
    return new Promise(()=>{});
  };
  const started=Date.now();
  const parsed=await engineModule.publicMagnet(`magnet:?xt=urn:btih:${hash}`+trackers.map(value=>'&tr='+encodeURIComponent(value)).join(''),{lookup,timeoutMs:150});
  assert.ok(Date.now()-started<1000,'the whole check ends on time');
  assert.deepEqual(parsed.trackers,[trackers[0],trackers[1],trackers.at(-1)]);
  assert.equal(signals.length,9);assert.ok(signals.every(signal=>signal?.aborted),'every lookup is told to stop when the check ends');
  assert.ok(options.every(option=>option.family===4&&option.all===true));
  const literal=await engineModule.publicMagnet(`magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent('udp://[2001:4860:4860::8888]:80/a')}`,{lookup,timeoutMs:150});
  assert.deepEqual(literal.trackers,[],'an IPv6 tracker address cannot be used by aria2');
});

test('the saved file list of a torrent keeps no trackers; the download gets only the checked ones',async t=>{
  const {buffer,infoHash}=torrentFile(multi(),{announce:'udp://embedded.example:80/a'});
  const fake=fakeAria2({torrents:{[infoHash]:buffer}});
  const lookup=async host=>[{address:host==='public.example'?'93.184.216.34':'192.168.1.20',family:4}];
  const s=integrationFor(t,{fake,lookup,settings:{enabled:true,accepted:true,uploadLimit:102400,shareMinutes:0}});
  const link=`magnet:?xt=urn:btih:${infoHash}&dn=Game&tr=${encodeURIComponent('udp://public.example:80/a')}&tr=${encodeURIComponent('udp://private.example:80/a')}`;
  const started=s.call('openMagnet',{magnet:link,gameTitle:'My Game'});
  let view;for(let i=0;i<500;i++){view=s.integration.snapshot().requests.find(request=>request.id===started.id);if(view.status!=='finding')break;await tick(2);}
  assert.equal(view.status,'ready',view.error);
  await s.call('addTorrent',{id:view.id,selected:[1]});
  const stored=fs.readFileSync(path.join(s.root,'store',infoHash+'.torrent'));
  assert.deepEqual(stored,magnet.sanitizeTorrent(buffer,infoHash,[]));
  for(const host of ['public.example','private.example','embedded.example'])assert.equal(stored.includes(host),false,host);
  let added;for(let i=0;i<500&&!added;i++){added=fake.calls.find(call=>call.method==='addTorrent');if(!added)await tick(2);}
  assert.ok(added,'the download started');
  const sent=Buffer.from(added.params[0],'base64');
  assert.ok(sent.includes('public.example'));assert.equal(sent.includes('private.example'),false);assert.equal(sent.includes('embedded.example'),false);
});

test('stopping while aria2 is still starting ends that start instead of launching another',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000,startTimeoutMs:5000});
  let probing;const seen=new Promise(resolve=>{probing=resolve;});
  engine.rpcFetch=async(url,init)=>{
    if(JSON.parse(init.body).method==='aria2.getVersion'){probing();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}
    return fake.fetch(url,init);
  };
  const started=Date.now(),first=engine.start();
  await seen;await engine.stop();
  await assert.rejects(first,{message:engineModule.MESSAGES.start});
  assert.ok(Date.now()-started<2000,'the start ends at once');assert.equal(fake.spawned.length,1);assert.equal(engine.running,false);
  // The next start is a new, ordinary one.
  engine.rpcFetch=fake.fetch;await engine.start();assert.equal(engine.running,true);assert.equal(fake.spawned.length,2);
});

test('a caller that stops waiting for aria2 to start does not stop it for the others',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  let release,probing;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{probing=resolve;});
  engine.rpcFetch=async(url,init)=>{if(JSON.parse(init.body).method==='aria2.getVersion'){probing();await gate;}return fake.fetch(url,init);};
  const first=engine.start();await seen;
  const controller=new AbortController(),second=engine.start(controller.signal);controller.abort();
  await assert.rejects(second,{name:'AbortError'});
  release();await first;assert.equal(engine.running,true);assert.equal(fake.spawned.length,1);
});

test('after a stop that could not end aria2, its later exit lets torrents start again',async t=>{
  const fake=fakeAria2();let stuck=true;
  const {engine}=engineFor(t,fake,{idleMs:60000,kill:async child=>{if(!stuck)return fake.kill(child);}});
  await engine.start();
  // aria2 answers the request to shut down, but does not.
  engine.rpcFetch=async(url,init)=>JSON.parse(init.body).method==='aria2.shutdown'?new Response(JSON.stringify({jsonrpc:'2.0',id:'1',result:'OK'}),{headers:{'content-type':'application/json'}}):fake.fetch(url,init);
  await assert.rejects(engine.stop(Date.now()+400),{message:engineModule.MESSAGES.stopped});
  await assert.rejects(engine.start(),{message:engineModule.MESSAGES.stopped});assert.equal(fake.spawned.length,1);
  stuck=false;engine.rpcFetch=fake.fetch;
  // Windows reports the process gone.
  fake.child.exitCode=0;fake.child.emit('exit',0);
  await engine.start();assert.equal(engine.running,true);assert.equal(fake.spawned.length,2);
});

test('aria2 that keeps leaving right after it starts is not started again and again',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  engine.rpcFetch=async(url,init)=>{
    const response=await fake.fetch(url,init);
    if(JSON.parse(init.body).method==='aria2.getVersion'){fake.child.exitCode=1;fake.child.emit('exit',1);}
    return response;
  };
  await assert.rejects(engine.start(),{message:engineModule.MESSAGES.start});
  assert.equal(fake.spawned.length,3);
});

test('when aria2 cannot be stopped after a failed download, the download’s own error is the one reported',async t=>{
  const {buffer,infoHash}=torrentFile(multi()),read=magnet.readTorrent(buffer,infoHash);
  const fake=fakeAria2({failStatus:'9'}),{engine,root}=engineFor(t,fake,{idleMs:60000});
  const stop=engine.stop.bind(engine);
  engine.kill=async()=>{};engine.stop=deadline=>stop(Math.min(deadline??Infinity,Date.now()+400));
  engine.rpcFetch=async(url,init)=>{if(['aria2.forceRemove','aria2.removeDownloadResult','aria2.shutdown'].includes(JSON.parse(init.body).method))throw new Error('aria2 does not answer');return fake.fetch(url,init);};
  const dir=path.join(root,'work');fs.mkdirSync(dir);
  try{
    await assert.rejects(engine.download({torrent:buffer,infoHash,files:read.files,selected:[1,2],dir}),{message:engineModule.MESSAGES.space});
    assert.equal(engine.terminationFailed,true,'aria2 is still known to be running');
  }finally{engine.kill=fake.kill;engine.rpcFetch=fake.fetch;engine.stop=stop;}
});

test('the file-list search folder is removed and its own reason kept, even when aria2 cannot be stopped',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const fake=fakeAria2({torrents:{[infoHash]:buffer},metadataPolls:1000}),{engine,root}=engineFor(t,fake,{idleMs:60000});
  const stop=engine.stop.bind(engine);
  engine.kill=async()=>{};engine.stop=deadline=>stop(Math.min(deadline??Infinity,Date.now()+400));
  engine.rpcFetch=async(url,init)=>{if(['aria2.forceRemove','aria2.removeDownloadResult','aria2.shutdown'].includes(JSON.parse(init.body).method))throw new Error('aria2 does not answer');return fake.fetch(url,init);};
  const controller=new AbortController();
  try{
    const search=engine.metadata(magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}`),{signal:controller.signal});
    for(let i=0;i<500&&!fake.calls.some(call=>call.method==='tellStatus');i++)await tick(2);
    controller.abort();
    await assert.rejects(search,error=>error.name==='AbortError');
    assert.deepEqual(fs.readdirSync(path.join(root,'state','metadata')),[],'no search folder is left behind');
  }finally{engine.kill=fake.kill;engine.rpcFetch=fake.fetch;engine.stop=stop;}
});

test('system DNS lookups run at most two at a time, and a place is freed only when its lookup has ended',async()=>{
  let running=0,most=0;const pending=new Map(),calls=[];
  const lookupImpl=(host,options)=>{calls.push([host,options]);running++;most=Math.max(most,running);return new Promise((resolve,reject)=>pending.set(host,{resolve:value=>{running--;resolve(value);},reject:error=>{running--;reject(error);}}));};
  const lookup=engineModule.createSystemLookup({lookupImpl});
  const hosts=['a.example','b.example','c.example','d.example'],results=hosts.map(host=>lookup(host,{}).then(value=>value,error=>error));
  await tick(5);assert.equal(most,2);assert.deepEqual(calls.map(([host])=>host),['a.example','b.example']);
  assert.ok(calls.every(([,options])=>options.family===4&&options.all===true),'IPv4 only, from Windows’ own resolver');
  pending.get('a.example').resolve([{address:'93.184.216.34',family:4}]);await tick(5);
  assert.deepEqual(calls.map(([host])=>host),['a.example','b.example','c.example']);
  pending.get('b.example').reject(new Error('fixture failure'));pending.get('c.example').resolve([]);await tick(5);
  assert.equal(calls.length,4);assert.equal(most,2);
  pending.get('d.example').resolve([]);await Promise.all(results);assert.equal(lookup.busy(),0);
  // A check that has already ended starts no lookup, even once a place is free.
  const ended=new AbortController();ended.abort();
  await assert.rejects(lookup('e.example',{signal:ended.signal}),{name:'AbortError'});assert.equal(calls.length,4);assert.equal(lookup.busy(),0);
});

test('a stop that arrives while aria2 answers its first check still ends that start',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  engine.rpcFetch=async(url,init)=>{const response=await fake.fetch(url,init);if(JSON.parse(init.body).method==='aria2.getVersion')engine.stop().catch(()=>{});return response;};
  await assert.rejects(engine.start(),{message:engineModule.MESSAGES.start});
  assert.equal(fake.spawned.length,1);for(let i=0;i<100&&engine.running;i++)await tick(5);assert.equal(engine.running,false);
});

test('aria2 started for a caller who gave up still stops when nobody uses it',async t=>{
  // The first attempt fails (its port is taken, say); the idle time is longer than that attempt.
  const fake=fakeAria2({startFails:1}),{engine}=engineFor(t,fake,{idleMs:400});
  const controller=new AbortController(),used=engine.use(async()=>{},controller.signal);controller.abort();
  await assert.rejects(used,{name:'AbortError'});
  for(let i=0;i<200&&fake.spawned.length<2;i++)await tick(5);
  for(let i=0;i<100&&!engine.running;i++)await tick(5);assert.equal(engine.running,true,'the second attempt started aria2');
  for(let i=0;i<300&&(engine.running||engine.starting);i++)await tick(10);
  assert.equal(fake.spawned.length,2);assert.equal(engine.running,false,'and the idle stop ended it');
});

test('removing a torrent from an aria2 that has already gone touches no newer aria2',async t=>{
  const fake=fakeAria2(),{engine}=engineFor(t,fake,{idleMs:60000});
  await engine.start();const old=engine.child;
  old.exitCode=1;old.emit('exit',1);await engine.start();assert.notEqual(engine.child,old);
  const before=fake.calls.length;
  assert.equal(await engine.drop('0000000000000001',true,old),undefined);
  assert.equal(fake.calls.length,before,'no request reached the new aria2');assert.equal(engine.running,true);
});
