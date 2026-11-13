'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const zlib=require('node:zlib');
const {PASTE_HOSTS,isPasteHost}=require('../src/hosts.cjs');
const {recognizedLinks}=require('../src/clipboard-inbox.cjs');
const {isProvider}=require('../src/browser-bridge.cjs');
const {_test:t}=require('../src/providers.cjs');

const KEY='11111111111111111111111111111112';
const OLD='https://paste.fitgirl-repacks.site/?0123456789abcdef#'+KEY;
const MOVED='https://pastefg.hermietkreeft.site/?0123456789abcdef#'+KEY;

function sealedPaste(text){
  const iv=crypto.randomBytes(16),salt=crypto.randomBytes(8);
  const spec=[iv.toString('base64'),salt.toString('base64'),1000,256,128,'aes','gcm','zlib'],adata=[spec,'markdown',0,0];
  const cipher=crypto.createCipheriv('aes-256-gcm',crypto.pbkdf2Sync(t.decodeBase58(KEY),salt,1000,32,'sha256'),iv);
  cipher.setAAD(Buffer.from(JSON.stringify(adata)));
  const sealed=Buffer.concat([cipher.update(zlib.deflateRawSync(Buffer.from(JSON.stringify({paste:text})))),cipher.final(),cipher.getAuthTag()]);
  return {status:0,v:2,adata,ct:sealed.toString('base64')};
}
function providersFixture(fetcher){
  const context={module:{exports:{}},URL,Buffer,TextDecoder,TextEncoder,console,require(name){
    if(name==='./net.cjs')return {safeFetch:fetcher};
    return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/providers.cjs'),'utf8'),context);
  return context.module.exports;
}

test('both FitGirl paste addresses are recognised exactly, and nothing that only looks like them',()=>{
  assert.deepEqual([...PASTE_HOSTS],['paste.fitgirl-repacks.site','pastefg.hermietkreeft.site']);
  for(const host of ['paste.fitgirl-repacks.site','pastefg.hermietkreeft.site','PASTEFG.hermietkreeft.SITE'])assert.equal(isPasteHost(host),true,host);
  for(const host of ['hermietkreeft.site','evil.pastefg.hermietkreeft.site','pastefg.hermietkreeft.site.evil.test','pastefg-hermietkreeft.site','fitgirl-repacks.site','',null,undefined,42])
    assert.equal(isPasteHost(host),false,String(host));
  assert.equal(Object.isFrozen(PASTE_HOSTS),true);
});

test('a copied link to the moved paste address is offered only with its decryption key',()=>{
  assert.deepEqual(recognizedLinks(`old ${OLD} moved ${MOVED}`),[OLD,MOVED]);
  assert.deepEqual(recognizedLinks('https://pastefg.hermietkreeft.site/?0123456789abcdef'),[]);
  assert.deepEqual(recognizedLinks('https://pastefg.hermietkreeft.site.evil.test/?0123456789abcdef#'+KEY),[]);
  assert.equal(isProvider(MOVED),true);assert.equal(isProvider('https://hermietkreeft.site/?a#b'),false);
});

test('a game page that links its mirrors through the moved paste address still offers them',()=>{
  const page=`<article><h1 class="entry-title"><a href="https://fitgirl-repacks.site/old-game/">Old Game</a></h1><div class="entry-content"><h3>#7 Old Game</h3>
    <a href="${MOVED.replace('0123456789abcdef','00000000000000aa')}">Filehoster: DataNodes</a>
    <a href="https://pastefg.hermietkreeft.site/?00000000000000bb">Filehoster: FileKeeper</a>
    <a href="https://evil.pastefg.hermietkreeft.site/?00000000000000cc#${KEY}">Filehoster: FuckingFast</a></div></article>`;
  const game=t.parseDetail(page,'https://fitgirl-repacks.site/old-game/');
  assert.deepEqual(game.groups,[{host:'DataNodes',label:'DataNodes',urls:[MOVED.replace('0123456789abcdef','00000000000000aa')]}]);
});

test('the moved paste is opened without sending its key, and its links are listed',async()=>{
  const requests=[];
  const providers=providersFixture(async(url,options)=>{
    requests.push({url,options});
    return new Response(JSON.stringify(sealedPaste('Part 1\nhttps://datanodes.to/abc/part1.rar\nhttps://datanodes.to/def/part2.rar')),{headers:{'content-type':'application/json'}});
  });
  const result=await providers.expandLinks(MOVED);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://pastefg.hermietkreeft.site/?0123456789abcdef');
  assert.equal(requests[0].url.includes(KEY),false);
  assert.equal(requests[0].options.headers['X-Requested-With'],'JSONHttpRequest');
  assert.deepEqual([...result.links.map(link=>link.url)],['https://datanodes.to/abc/part1.rar','https://datanodes.to/def/part2.rar']);
  assert.deepEqual([...result.warnings],['Source notes: Part 1']);
});
