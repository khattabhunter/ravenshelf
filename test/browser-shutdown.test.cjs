'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {BrowserBridge}=require('../src/browser-bridge.cjs');
const {shutdownServices}=require('../src/app-lifecycle.cjs');
const protocol=require('../src/browser-protocol.cjs');
const turn=()=>new Promise(setImmediate);
const request=type=>({v:1,type,...(type==='send'?{kind:'link'}:{}),url:'https://files.example/photo.png'});
function fixture(){
  let finish;const result=new Promise(resolve=>{finish=resolve;});
  const bridge=new BrowserBridge({hostDir:path.resolve(__dirname,'.unused-browser-shutdown'),inspect:()=>result});
  bridge.token=Buffer.alloc(32,1);
  return {bridge,finish:()=>finish({status:'ready',url:'https://files.example/photo.png',filename:'photo.png',size:10,chain:[],sniffed:'png'})};
}
class Socket extends EventEmitter{
  setTimeout(){}pause(){}destroy(){this.emit('close');}
  end(bytes){this.reply=JSON.parse(bytes.subarray(4).toString());this.emit('close');}
}
function nativeRequest(bridge,message){
  const socket=new Socket();bridge.connection(socket);
  const header={v:1,token:bridge.token.toString('hex'),origin:`chrome-extension://${protocol.CHROMIUM_EXTENSION_ID}/`};
  socket.emit('data',Buffer.concat([protocol.encodeFrame(header),protocol.encodeFrame(message)]));return socket;
}

test('shutdown closes native intake before waiting for the download checkpoint',async()=>{
  const {bridge,finish}=fixture(),calls=[];let release;
  const pending=shutdownServices({manager:{stop:()=>{calls.push('manager');return new Promise(resolve=>{release=resolve;});}},
    browserIntegration:{beginQuit:()=>{calls.push('gate');bridge.beginQuit();},beforeQuit:()=>calls.push('browser')},
    features:{beforeQuit:options=>calls.push(['features',options])}});
  try{
    assert.deepEqual(calls,['gate','manager']);
    for(const type of ['capture','send'])assert.deepEqual(await bridge.respond('chromium',request(type)),{ok:false,error:'not-running'});
    assert.equal(bridge.captures.size,0);assert.equal(bridge.active,0);
  }finally{release();finish();await pending;}
  assert.deepEqual(calls,['gate','manager','browser',['features',{install:true}]]);
});

test('an unsent take acknowledgement becomes browser fallback and pending inspection stays quiet',async()=>{
  for(const type of ['capture','send']){
    const {bridge,finish}=fixture();let changes=0;bridge.on('change',()=>changes++);
    const socket=nativeRequest(bridge,request(type));assert.equal(bridge.captures.size,1);
    bridge.beginQuit();const before=changes;await turn();
    assert.deepEqual(socket.reply,{ok:false,error:'not-running'});
    finish();await turn();assert.equal(changes,before);assert.equal(bridge.active,0);
    assert.equal([...bridge.captures.values()][0].status,'checking');
    assert.deepEqual(bridge.receive('chromium',{type:'capture',url:'https://files.example/late.png'}),{action:'browser'});
    assert.equal(bridge.captures.size,1);
  }
});

test('a known malicious verdict is not downgraded by a simultaneous shutdown',async()=>{
  const {bridge,finish}=fixture();bridge.threatLists={lookup:()=>({category:'malware',label:'malware sites'})};
  const socket=nativeRequest(bridge,request('capture'));bridge.beginQuit();await turn();finish();
  assert.equal(socket.reply.ok,true);assert.equal(socket.reply.action,'block');
});

test('an intake gate failure still stops every service and forbids update installation',async()=>{
  const calls=[];
  await assert.rejects(shutdownServices({manager:{stop:()=>calls.push('manager')},
    browserIntegration:{beginQuit:()=>{calls.push('gate');throw new Error('fixture failure');},beforeQuit:()=>calls.push('browser')},
    features:{beforeQuit:options=>calls.push(['features',options])}}),/could not finish shutting down/);
  assert.deepEqual(calls,['gate','manager','browser',['features',{install:false}]]);
});
