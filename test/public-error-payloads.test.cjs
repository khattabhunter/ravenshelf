'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {CatalogRefresh}=require('../src/catalog-refresh.cjs');
const {CompletionAction}=require('../src/completion-action.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');
const privateMessage='Read failed at C:\\Users\\private-fixture\\secret.txt for https://hidden.example/file?token=private-signed-token; Authorization: Bearer private-auth-token';
const privateError=()=>new Error(privateMessage);
const containsNoPrivateData=value=>{
  const text=typeof value==='string'?value:JSON.stringify(value);
  for(const part of ['private-fixture','hidden.example','private-signed-token','private-auth-token'])assert.equal(text.includes(part),false,part);
};

function providersFixture(fetcher){
  const context={module:{exports:{}},URL,Buffer,TextDecoder,TextEncoder,console,require(name){
    if(name==='./net.cjs')return {safeFetch:fetcher};
    return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/providers.cjs'),'utf8'),context);
  return context.module.exports;
}

test('link-check failure payloads omit raw exceptions while retaining the link chosen by the user',async()=>{
  const providers=providersFixture(async()=>{throw privateError();});
  const selected='https://files.example/game.rar?token=user-selected-token';
  const result=await providers.resolveLink(selected);
  assert.equal(result.status,'manual');assert.equal(result.url,selected);
  assert.equal(result.message,'The link could not be checked. Try again or choose another mirror.');
  containsNoPrivateData(result);
});

test('paste expansion does not copy network errors or remote paste error messages into warnings',async()=>{
  const selected='https://paste.fitgirl-repacks.site/?0123456789abcdef#11111111111111111111111111111112';
  const responses=[
    async()=>{throw privateError();},
    async()=>new Response(JSON.stringify({status:1,message:privateMessage}),{headers:{'content-type':'application/json'}}),
    async()=>new Response('invalid JSON '+privateMessage,{headers:{'content-type':'application/json'}})
  ];
  for(const fetcher of responses){
    const result=await providersFixture(fetcher).expandLinks(selected);
    assert.equal(result.links.length,0);assert.equal(result.warnings.length,1);
    assert.match(result.warnings[0],/^Could not expand paste:/);containsNoPrivateData(result);
  }
});

test('game-page expansion sanitizes caught errors while authored actionable errors still reach the user',async()=>{
  const result=await providersFixture(async()=>{throw privateError();}).expandLinks('https://fitgirl-repacks.site/game/');
  assert.equal(result.links.length,0);assert.equal(result.warnings[0],'The game page could not be loaded. Please try again.');containsNoPrivateData(result);
  const rejected=await providersFixture(async()=>{throw new Error('Blocked an off-site redirect from FuckingFast. Choose another link from the same host.');}).resolveLink('https://fuckingfast.co/file#game.rar');
  assert.equal(rejected.status,'manual');assert.match(rejected.message,/Blocked an off-site redirect/);
});

test('catalogue failure snapshots preserve the last good games without publishing private exception text',async t=>{
  let fail=false;
  const good={games:[{title:'Game',url:'https://fitgirl-repacks.site/game/'}]},states=[];
  const refresh=new CatalogRefresh({fetchLatest:async()=>{if(fail)throw privateError();return good;},onChange:state=>states.push(state),setTimeoutFn:()=>({unref(){}}),clearTimeoutFn(){}});
  t.after(()=>refresh.stop());
  await refresh.start();fail=true;await refresh.check({force:true});
  const state=refresh.snapshot();assert.deepEqual(state.latest,good);assert.equal(state.checking,false);
  assert.equal(state.error,'The catalogue could not be refreshed. Ravenshelf will try again.');
  containsNoPrivateData(state);containsNoPrivateData(states);
});

test('failed completion callbacks report a safe error and never retry an unattended action',async()=>{
  for(const mode of ['close','shutdown']){
    let now=0,calls=0;const queue=[{id:'game',status:'queued'}],states=[];
    const action=new CompletionAction({getDownloads:()=>queue,onExecute:async()=>{calls++;throw privateError();},onChange:state=>states.push(state),clock:()=>now,countdownMs:1,autoTick:false});
    action.arm(mode);queue[0].status='completed';action.tick();now=1;action.tick();
    await new Promise(resolve=>setImmediate(resolve));
    const result=action.snapshot();assert.equal(result.phase,'error');assert.equal(result.mode,'none');
    assert.equal(result.message,'The completion action could not run. Please try again.');containsNoPrivateData(result);containsNoPrivateData(states);
    now=10000;action.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);action.dispose();
  }
});

test('download-facing errors keep fixed integrity guidance and numeric HTTP status but reject appended details',()=>{
  for(const message of [
    'Host sent an invalid resume range. File was not modified.',
    'The file changed on the host. Cancel and queue it again.',
    'Host returned an invalid file length.',
    'The download file or folder changed or is unsafe. Choose a private download folder and retry.',
    'The host returned a web page instead of a file. Open the protected host.',
    'Host returned HTTP 503. Check the source link or retry.',
    'FuckingFast returned HTTP 403. Open the protected host to complete its verification.'
  ])assert.equal(publicErrorMessage(new Error(message),'download'),message);
  for(const message of [privateMessage,'Host returned HTTP 503. Check the source link or retry. '+privateMessage,'Host returned HTTP private-auth-token. Check the source link or retry.']){
    const result=publicErrorMessage(new Error(message),'download');
    assert.equal(result,'The file could not be downloaded. Check the link, connection and download folder, then retry.');containsNoPrivateData(result);
  }
  const providerMessage=publicErrorMessage(privateError(),'checkLinks');
  assert.equal(publicErrorMessage(new Error(providerMessage),'download'),providerMessage,'already safe provider guidance survives another error boundary');
});

test('network failures wrapped as "fetch failed" get a clear fixed message without private details',()=>{
  const wrapped=cause=>Object.assign(new TypeError('fetch failed'),{cause});
  const coded=(code,message=privateMessage)=>Object.assign(new Error(message),{code});
  assert.equal(publicErrorMessage(wrapped(coded('ECONNRESET')),'download'),'The connection was interrupted. Please try again.');
  assert.equal(publicErrorMessage(wrapped(coded('UND_ERR_CONNECT_TIMEOUT')),'download'),'The connection timed out. Check your connection and try again.');
  assert.equal(publicErrorMessage(wrapped(wrapped(coded('EAI_AGAIN'))),'download'),'The host could not be reached. Check your connection and try again.');
  assert.equal(publicErrorMessage(wrapped(new Error('Private network destination blocked.')),'download'),'Private network destination blocked.');
  const unknown=publicErrorMessage(wrapped(privateError()),'download');
  assert.equal(unknown,'The file could not be downloaded. Check the link, connection and download folder, then retry.');containsNoPrivateData(unknown);
  const loop={message:'fetch failed'};loop.cause=loop;
  assert.equal(publicErrorMessage(loop,'download'),'The file could not be downloaded. Check the link, connection and download folder, then retry.');
});
