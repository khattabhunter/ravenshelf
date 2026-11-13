'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const magnet=require('../src/magnet.cjs');
const engineModule=require('../src/torrent-engine.cjs');
const {TorrentEngine,engineArgs,engineEnv,selection,sameFiles,errorMessage}=engineModule;
const {DownloadManager,torrentWorkspace,TORRENTS_FOLDER}=require('../src/downloads.cjs');
const {createTorrentIntegration,TOOLS,normalizeSettings,UPLOAD_LIMITS}=require('../src/torrent-integration.cjs');
const {TOOL_MESSAGES,MESSAGES:TORRENT}=require('../src/torrent-messages.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');
const {validateRequest}=require('../src/browser-protocol.cjs');

const tick=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
function scratch(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-torrent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

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
  const read=magnet.parseMagnet('magnet:?xt=urn:btih:1A7168B2475E6DAD602526A093C8E75A5EA0A27A&dn=Police+Stories%3A+Bundle%0A&tr=udp%3A%2F%2Fopentor.org%3A2710&tr=http%3A%2F%2Ftracker.example%2Fannounce&tr=wss%3A%2F%2Fpeers.example&tr=https%3A%2F%2Fuser%3Apass%40t.example%2Fa&ws=https%3A%2F%2Fseed.example%2Ff&x.pe=10.0.0.1%3A6881&xs=https%3A%2F%2Fevil.example%2Fx.torrent');
  assert.equal(read.infoHash,'1a7168b2475e6dad602526a093c8e75a5ea0a27a');
  assert.equal(read.name,'Police Stories: Bundle');
  assert.deepEqual(read.trackers,['udp://opentor.org:2710','http://tracker.example/announce']);
  assert.equal(read.magnet,'magnet:?xt=urn:btih:1a7168b2475e6dad602526a093c8e75a5ea0a27a&dn=Police%20Stories%3A%20Bundle&tr=udp%3A%2F%2Fopentor.org%3A2710&tr=http%3A%2F%2Ftracker.example%2Fannounce');
  for(const dropped of ['seed.example','10.0.0.1','evil.example','peers.example','user'])assert.equal(read.magnet.includes(dropped),false,dropped);
  // The same torrent written in base 32.
  const hex='1a7168b2475e6dad602526a093c8e75a5ea0a27a',b32=magnet.base32Hex('DJYWRMSHLZWWWAJFE2QJHSHHLJPKBITX');
  assert.equal(magnet.parseMagnet('magnet:?xt=urn:btih:DJYWRMSHLZWWWAJFE2QJHSHHLJPKBITX').infoHash,b32);
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
  const refused=[[['..','evil.exe']],[['CON']],[['nul.txt']],[['a:b.bin']],[['trailing.']],[['space ']],[['tab\there']],[['a/b']],[['back\\slash']],[['quote"']],[['star*']],[['']],[['COM\u00b9']],[['x'.repeat(181)]]];
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

test('the torrent reader refuses malformed data',()=>{
  const bad=['','i01e','i-0e','d1:ai1e1:ai2ee','d1:ai1e','l'+'l'.repeat(70)+'e'.repeat(71),'d1:ai1ee extra','4:abc','d3:keyi1e','d9999999999999999999999:x','x'];
  for(const text of bad)assert.throws(()=>magnet.decode(Buffer.from(text)),{message:magnet.MESSAGES.damaged},JSON.stringify(text));
  assert.doesNotThrow(()=>magnet.decode(Buffer.from('d1:bi1e1:ai2ee')),'keys out of order are still read');
  assert.equal(magnet.decode(Buffer.from('d1:ai99999999999999999999ee')).root.get('a'),99999999999999999999n,'large numbers stay exact');
  assert.throws(()=>magnet.decode(Buffer.from('li1ee')),{message:magnet.MESSAGES.damaged},'a torrent is a dictionary');
  assert.throws(()=>magnet.decode(Buffer.alloc(11*1024*1024,0x30)),{message:magnet.MESSAGES.damaged});
  for(const message of Object.values(magnet.MESSAGES))assert.equal(publicErrorMessage(new Error(message),'openMagnet'),message);
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
function fakeAria2({torrents={},share=0,failStatus=null,badFiles=false,startFails=0,metadataPolls=2}={}){
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
          if(d.options['seed-time']!=='0'&&d.shared<share){d.shared++;return reply({status:'active',seeder:'true',totalLength:String(total),completedLength:String(total),downloadSpeed:'0',uploadSpeed:'700',uploadLength:'9',connections:'2',numSeeders:'1',errorCode:'0'});}
          d.status='complete';
        }
        return reply({status:d.status,seeder:'false',totalLength:String(total),completedLength:String(done),downloadSpeed:'1000',uploadSpeed:'50',uploadLength:'3',connections:'5',numSeeders:'2',errorCode:'0'});
      }
      case 'forceRemove':{const d=fake.downloads.get(params[0]);if(d)d.status='removed';return reply(params[0]);}
      case 'removeDownloadResult':{fake.downloads.delete(params[0]);return reply('OK');}
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
  t.after(()=>engine.dispose());
  return {engine,root};
}

test('the engine starts aria2 with a fresh secret, finds a file list, and checks it against the magnet link',async t=>{
  const {buffer,infoHash}=torrentFile(multi());
  const fake=fakeAria2({torrents:{[infoHash]:buffer}}),{engine,root}=engineFor(t,fake);
  const parsed=magnet.parseMagnet(`magnet:?xt=urn:btih:${infoHash}&dn=Game`);
  const peers=[];
  const got=await engine.metadata(parsed,{onStatus:status=>peers.push(status.peers)});
  assert.deepEqual(got,buffer);assert.ok(peers.includes(3));
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
  // Requests without the secret are refused by aria2 (the stand-in does the same).
  const answer=await fake.fetch(`http://127.0.0.1:${fake.port}/jsonrpc`,{body:JSON.stringify({jsonrpc:'2.0',id:'x',method:'aria2.getVersion',params:['token:wrong']})});
  assert.equal((await answer.json()).error.message,'Unauthorized');
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
  const manager=new DownloadManager({stateFile:path.join(root,'library.json'),downloadDir:path.join(root,'Downloads'),torrent:runner,markFile:async file=>{marked.push(file);},scanFile:async file=>{scanned.push(file);return {status:'clean',message:''};},...more});
  manager.updateSettings({concurrency:2,defenderScan:true});
  t.after(()=>manager.stop());
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
  assert.deepEqual(q.scanned,[final],'the whole folder is scanned');
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

function integrationFor(t,{fake=fakeAria2(),platform='win32',ready=true,settings}={}){
  const root=scratch(t),registered=new Map(),published=[];
  const manager=new DownloadManager({stateFile:path.join(root,'library.json'),downloadDir:path.join(root,'Downloads')});
  if(settings)manager.settings.torrents=settings;
  t.after(()=>manager.stop());
  const tools={refresh:()=>ready?'ready':'missing',snapshot:()=>({phase:ready?'ready':'missing'}),install(){this.installed=true;},cancel(){},remove:async()=>{},removeOthers:async()=>{},dispose:async()=>{},verified:fakeTools(root).verified};
  const integration=createTorrentIntegration({app:{getPath:()=>root},win:null,manager,register:(name,fn)=>registered.set(name,fn),publish:()=>published.push(1),platform,
    folders:{tools:path.join(root,'tools'),state:path.join(root,'state'),store:path.join(root,'store')},
    toolsOptions:{},engineOptions:{spawnImpl:fake.spawn,rpcFetch:fake.fetch,kill:fake.kill,pollMs:1,idleMs:30,startTimeoutMs:500,env:{SystemRoot:'C:\\Windows'}}});
  // The pinned tool set is replaced by a stand-in that is always ready (or never).
  integration.engine.tools=tools;
  const original=integration.tools;Object.assign(original,{refresh:tools.refresh,install:()=>{tools.installed=true;return tools.snapshot();},remove:tools.remove});
  t.after(()=>integration.beforeQuit());
  return {root,manager,registered,integration,tools,call:(name,value)=>registered.get(name)(value)};
}

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
  assert.deepEqual(fs.readFileSync(path.join(s.root,'store',infoHash+'.torrent')),buffer,'the checked file list is kept for resuming');
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

test('the pinned torrent engine is aria2 1.37.0, checked by size and SHA-256',()=>{
  assert.equal(TOOLS.length,1);
  const [tool]=TOOLS;
  assert.equal(tool.url,'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip');
  assert.equal(tool.size,2475379);assert.equal(tool.sha256,'67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288');
  assert.deepEqual(tool.files.map(({role,entry,name,size,sha256})=>({role,entry,name,size,sha256})),[{role:'aria2c',entry:'aria2-1.37.0-win-64bit-build1/aria2c.exe',name:'aria2c.exe',size:5649408,sha256:'be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2'}]);
  assert.equal(Object.isFrozen(tool),true);assert.equal(Object.isFrozen(tool.files[0]),true);
  for(const message of [...Object.values(TOOL_MESSAGES),...Object.values(TORRENT)])assert.equal(publicErrorMessage(new Error(message),'setUpTorrents'),message);
});
