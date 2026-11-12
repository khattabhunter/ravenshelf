'use strict';
// Runs the compiled Windows browser connector exactly as a browser would: one
// length-prefixed JSON message on stdin, one reply on stdout.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const protocol=require('../src/browser-protocol.cjs');
const {BrowserBridge}=require('../src/browser-bridge.cjs');

const EXE=path.join(__dirname,'../src/ravenshelf-browser-host.exe');
const skip=process.platform!=='win32'?'the connector is a Windows program':!fs.existsSync(EXE)?'the connector was not built':false;
const CHROME=`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}/`;
const stage=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-host-'));fs.copyFileSync(EXE,path.join(dir,'ravenshelf-browser-host.exe'));return dir;};
const frame=value=>protocol.encodeFrame(value);
// Builds a frame without the protocol's size limit, to test the connector's own.
const rawFrame=value=>{const body=Buffer.from(JSON.stringify(value),'utf8'),head=Buffer.alloc(4);head.writeUInt32LE(body.length,0);return Buffer.concat([head,body]);};
function run(dir,input,args=[CHROME,'--parent-window=0']){
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const child=spawn(path.join(dir,'ravenshelf-browser-host.exe'),args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const out=[];child.stdout.on('data',chunk=>out.push(chunk));child.on('error',reject);
    child.on('close',code=>{
      const data=Buffer.concat(out);
      const length=data.length>=4?data.readUInt32LE(0):-1;
      resolve({code,ms:Date.now()-started,reply:length>0&&data.length===length+4?JSON.parse(data.subarray(4).toString('utf8')):null,raw:data});
    });
    // The connector stops reading as soon as it rejects a message, so the rest of
    // a malformed input can meet a closed pipe; that is expected, not a failure.
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
async function server(dir,handler,{token=crypto.randomBytes(32).toString('hex'),endpoint}={}){
  const pipe='ravenshelf-'+crypto.randomBytes(16).toString('hex');const seen=[];
  const srv=net.createServer(socket=>{
    const reader=new protocol.FrameReader(2*1024*1024);const frames=[];
    socket.on('data',chunk=>{for(const value of reader.push(chunk))frames.push(value);if(frames.length===2){seen.push(frames.slice());handler(socket,frames[0],frames[1]);}});
    socket.on('error',()=>{});
  });
  await new Promise(resolve=>srv.listen(`\\\\.\\pipe\\${pipe}`,resolve));
  fs.writeFileSync(path.join(dir,'endpoint.json'),JSON.stringify(endpoint||{schema:1,pipe,token}));
  return {srv,seen,token,pipe,close:()=>new Promise(resolve=>srv.close(resolve))};
}

test('without a running app the connector answers not-running at once',{skip},async()=>{
  const dir=stage();
  const result=await run(dir,frame({v:1,type:'hello',extensionVersion:'0.5.0',browser:'chromium'}));
  assert.deepEqual(result.reply,{ok:false,error:'not-running'});assert.equal(result.code,0);assert.ok(result.ms<5000,`took ${result.ms} ms`);
});

test('a message is relayed with the session token and the browser origin',{skip},async()=>{
  const dir=stage();
  const fake=await server(dir,(socket,header,message)=>socket.end(frame({ok:true,echo:message,origin:header.origin})));
  try{
    const message={v:1,type:'capture',url:'https://cdn.example/file.zip',filename:'file.zip'};
    const result=await run(dir,frame(message));
    assert.deepEqual(result.reply,{ok:true,echo:message,origin:CHROME});
    assert.deepEqual(fake.seen[0][0],{v:1,token:fake.token,origin:CHROME});
    const firefox=await run(dir,frame({v:1,type:'threats'}),['C:\\Users\\Player\\AppData\\Roaming\\atlas-repack-library\\browser-host\\firefox.json',protocol.FIREFOX_EXTENSION_ID]);
    assert.equal(firefox.reply.origin,`firefox:${protocol.FIREFOX_EXTENSION_ID}`);
    const odd=await run(dir,frame({v:1,type:'threats'}),['"quoted" origin']);
    assert.equal(odd.reply.origin,'unknown');
  }finally{await fake.close();}
});

test('malformed browser messages never reach the app',{skip},async()=>{
  const dir=stage();
  const fake=await server(dir,socket=>socket.end(frame({ok:true})));
  try{
    const length=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n,0);return b;};
    for(const input of [Buffer.concat([length(5),Buffer.from('[1,2]')]),Buffer.concat([length(4),Buffer.from('nope')]),length(0),Buffer.concat([length(70000),Buffer.alloc(70000,0x20)]),Buffer.from([1,2]),Buffer.alloc(0),Buffer.concat([length(3),Buffer.from([0x7b,0xff,0x7d])])]){
      const result=await run(dir,input);
      assert.deepEqual(result.reply,{ok:false,error:'invalid'},input.subarray(0,8).toString('hex'));
    }
    assert.equal(fake.seen.length,0);
  }finally{await fake.close();}
});

test('a missing, stale or tampered endpoint is treated as not running',{skip},async()=>{
  const dir=stage();
  const message=frame({v:1,type:'threats'});
  for(const endpoint of [{schema:2,pipe:'ravenshelf-'+'a'.repeat(32),token:'b'.repeat(64)},{schema:1,pipe:'other-pipe',token:'b'.repeat(64)},{schema:1,pipe:'ravenshelf-'+'a'.repeat(32),token:'short'},'not json',{schema:1,pipe:'ravenshelf-'+'a'.repeat(32),token:'b'.repeat(64),padding:'x'.repeat(5000)}]){
    fs.writeFileSync(path.join(dir,'endpoint.json'),typeof endpoint==='string'?endpoint:JSON.stringify(endpoint));
    assert.deepEqual((await run(dir,message)).reply,{ok:false,error:'not-running'},JSON.stringify(endpoint).slice(0,60));
  }
  fs.writeFileSync(path.join(dir,'endpoint.json'),JSON.stringify({schema:1,pipe:'ravenshelf-'+crypto.randomBytes(16).toString('hex'),token:'c'.repeat(64)}));
  const stale=await run(dir,message);
  assert.deepEqual(stale.reply,{ok:false,error:'not-running'});assert.ok(stale.ms<10000);
});

test('oversized, invalid or missing replies from the pipe are not passed to the browser',{skip},async()=>{
  for(const [handler,label] of [[socket=>socket.end(rawFrame({blob:'x'.repeat(1000001)})),'oversized'],[socket=>{const b=Buffer.alloc(4);b.writeUInt32LE(5,0);socket.end(Buffer.concat([b,Buffer.from('[1,2]')]));},'array'],[socket=>socket.end(),'closed']]){
    const dir=stage();const fake=await server(dir,handler);
    try{assert.deepEqual((await run(dir,frame({v:1,type:'threats'}))).reply,{ok:false,error:'failed'},label);}
    finally{await fake.close();}
  }
});

test('the real bridge and the real connector work together',{skip},async t=>{
  const dir=stage();
  const bridge=new BrowserBridge({hostDir:dir,appVersion:'0.5.0',threatLists:{version:'v',total:0,lookup:()=>null,browserManifest:()=>({version:'v',total:0,rules:[]}),browserRule:()=>null},queueDownload:async()=>({added:1}),openExternal:async()=>{}});
  t.after(()=>bridge.stop());
  await bridge.start();
  const hello=await run(dir,frame({v:1,type:'hello',extensionVersion:'0.5.0',browser:'chromium'}));
  // The connector passes the app's reply on unchanged, including the app's language (0.8.0).
  assert.deepEqual(hello.reply,{ok:true,app:'Ravenshelf',version:'0.5.0',capture:true,protection:{version:'v',total:0},language:'en',digits:'latn'});
  const wrong=await run(dir,frame({v:1,type:'hello',extensionVersion:'0.5.0',browser:'chromium'}),['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']);
  assert.deepEqual(wrong.reply,{ok:false,error:'failed'},'an extension that is not allowed gets no answer from the app');
  await bridge.stop();
  assert.deepEqual((await run(dir,frame({v:1,type:'threats'}))).reply,{ok:false,error:'not-running'});
});
