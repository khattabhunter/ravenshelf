'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const hosts=require('../src/hosts.cjs');
const pixeldrain=require('../src/pixeldrain.cjs');
const multiup=require('../src/multiup.cjs');
const {publicErrorMessage}=require('../src/public-errors.cjs');
const {recognizedLinks}=require('../src/clipboard-inbox.cjs');
const {isProvider}=require('../src/browser-bridge.cjs');
const {DownloadManager}=require('../src/downloads.cjs');
const {MIN_PARALLEL_SIZE}=require('../src/parallel-download.cjs');
const {_test:t}=require('../src/providers.cjs');

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const page=(body,status=200)=>new Response(body,{status,headers:{'content-type':'text/html; charset=UTF-8'}});
const HASH='ad8fa833f193abaace94819f4a8045bb';
const SECRET='server-secret-message private-fixture';
// MultiUp's mirror buttons, as its page marks them (trimmed from a real page).
const mirrorPage=links=>`<!DOCTYPE html><html><head><title>Mirror list Game.part1.rar - Mirror Upload - MultiUp.io</title></head><body>
  <a href="https://multiup.io/download-fast/${HASH}/Game.part1.rar" namehost="UseNet" link="/download-fast/${HASH}/Game.part1.rar" validity="valid" class="host btn">UseNet</a>
  ${links.map(([host,link,validity='valid'])=>`<footer class="panel-footer"><a href="${link}" target="_blank" namehost="${host}" link="${link}" validity="${validity}" class="host btn"><i class="fa fa-download"></i> Download</a></footer>`).join('\n')}
  <script>location.href='https://evil.example/'</script></body></html>`;
function providersFixture(fetcher){
  const context={module:{exports:{}},URL,Buffer,TextDecoder,TextEncoder,console,structuredClone,require(name){
    if(name==='./net.cjs')return {safeFetch:fetcher};
    return name.startsWith('./')?require(path.join(__dirname,'../src',name)):require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/providers.cjs'),'utf8'),context);
  return context.module.exports;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('closed hosts are named from their address or a link’s text, and nothing else is',()=>{
  assert.deepEqual(hosts.CLOSED_HOSTS.map(entry=>entry.name),['ZippyShare','BayFiles','LetsUpload']);
  assert.equal(hosts.closedHost('www12.zippyshare.com').name,'ZippyShare');
  assert.equal(hosts.closedHost('bayfiles.com').name,'BayFiles');
  for(const host of ['letsupload.io','letsupload.org','letsupload.cc','LETSUPLOAD.US'])assert.equal(hosts.closedHost(host).name,'LetsUpload',host);
  for(const host of ['zippyshare.com.evil.test','notzippyshare.com','pixeldrain.com','',null])assert.equal(hosts.closedHost(host),null,String(host));
  assert.equal(hosts.closedByLabel('Filehoster: LetsUpload [Use JDownloader2]').name,'LetsUpload');
  assert.equal(hosts.closedByLabel('Filehoster: PixelDrain'),null);
  for(const entry of hosts.CLOSED_HOSTS)assert.equal(publicErrorMessage(new Error(entry.message),'checkLinks'),entry.message);
});

test('PixelDrain and MultiUp are recognised only on their own addresses',()=>{
  for(const host of ['pixeldrain.com','www.pixeldrain.com','PixelDrain.NET'])assert.equal(hosts.isPixeldrainHost(host),true,host);
  for(const host of ['cdn.pixeldrain.com','pixeldrain.com.evil.test','pixeldra.in','pd.cybar.xyz'])assert.equal(hosts.isPixeldrainHost(host),false,host);
  for(const host of ['multiup.io','www.multiup.io','multiup.org'])assert.equal(hosts.isMultiupHost(host),true,host);
  assert.equal(hosts.isMultiupHost('proxy.multiup.org'),false);
  assert.equal(hosts.oneConnection('https://pixeldrain.com/api/file/abcd1234?download'),true);
  assert.equal(hosts.oneConnection('https://datanodes.to/abc'),false);assert.equal(hosts.oneConnection('not a link'),false);
  assert.deepEqual(recognizedLinks('https://pixeldrain.com/u/abcd1234 https://multiup.io/download/'+HASH+'/a.rar https://www.zippyshare.com/v/x/file.html'),['https://pixeldrain.com/u/abcd1234','https://multiup.io/download/'+HASH+'/a.rar']);
  assert.equal(isProvider('https://pixeldrain.com/api/file/abcd1234?download'),true);
});

test('PixelDrain file and list links are read strictly',()=>{
  assert.deepEqual(pixeldrain.pixeldrainLink('https://pixeldrain.com/u/abcd1234'),{kind:'file',id:'abcd1234',origin:'https://pixeldrain.com',page:'https://pixeldrain.com/u/abcd1234'});
  assert.deepEqual(pixeldrain.pixeldrainLink('https://www.pixeldrain.net/l/List99'),{kind:'list',id:'List99',origin:'https://pixeldrain.net',page:'https://pixeldrain.net/l/List99'});
  assert.equal(pixeldrain.pixeldrainLink('https://pixeldrain.com/api/file/abcd1234?download').id,'abcd1234');
  assert.equal(pixeldrain.pixeldrainLink('https://pixeldrain.com/api/file/abcd1234/info').kind,'file');
  assert.equal(pixeldrain.pixeldrainLink('https://pixeldrain.com/api/list/abcd1234').kind,'list');
  for(const bad of ['http://pixeldrain.com/u/abcd1234','https://pixeldrain.com:8443/u/abcd1234','https://a:b@pixeldrain.com/u/abcd1234','https://pixeldrain.com/u/ab','https://pixeldrain.com/u/abcd1234/extra','https://pixeldrain.com/u/abc%2F..','https://pixeldrain.com/d/abcd1234','https://evil.test/u/abcd1234','nonsense'])
    assert.equal(pixeldrain.pixeldrainLink(bad),null,bad);
});

test('a PixelDrain file is downloaded only when its details say it can be, and server text is never shown',async()=>{
  const asked=[];
  const answer=body=>async(url,options)=>{asked.push({url,options});return typeof body==='function'?body():json(body);};
  const ready=await pixeldrain.resolvePixeldrain('https://pixeldrain.com/u/abcd1234',{fetcher:answer({success:true,name:'Game.part01.rar\u0007',size:4096,availability:'',can_download:true})});
  assert.deepEqual(ready,{status:'ready',url:'https://pixeldrain.com/api/file/abcd1234?download',filename:'Game.part01.rar',size:4096,message:pixeldrain.MESSAGES.ready});
  assert.equal(asked[0].url,'https://pixeldrain.com/api/file/abcd1234/info');assert.equal(asked[0].options.headers.Accept,'application/json');
  const cases=[
    [json({availability:'file_rate_limited_captcha_required',name:'x',size:1,message:SECRET}),'manual',pixeldrain.MESSAGES.check],
    [json({availability:'virus_detected_captcha_required',name:'x',size:1,message:SECRET}),'unavailable',pixeldrain.MESSAGES.virus],
    [json({success:false,value:'virus_detected_captcha_required',message:SECRET},403),'unavailable',pixeldrain.MESSAGES.virus],
    [json({success:false,value:'transfer_limit_exceeded',message:SECRET},403),'manual',pixeldrain.MESSAGES.limit],
    [json({success:false,value:'max_concurrent_downloads',message:SECRET},403),'manual',pixeldrain.MESSAGES.busy],
    [json({success:false,value:'unavailable_for_legal_reasons',message:SECRET},451),'unavailable',pixeldrain.MESSAGES.removed],
    [json({success:false,value:'not_found',message:SECRET},404),'unavailable',pixeldrain.MESSAGES.missing],
    [page('<html>'+SECRET+'</html>',404),'unavailable',pixeldrain.MESSAGES.missing],
    [json({success:false,value:'something_new',message:SECRET},500),'manual',pixeldrain.MESSAGES.failed],
    [json({availability:'brand_new_reason'}),'manual',pixeldrain.MESSAGES.failed],
    [json({name:'x',size:1,can_download:false}),'manual',pixeldrain.MESSAGES.check],
    [page('<html>'+SECRET+'</html>'),'manual',pixeldrain.MESSAGES.failed],
    [new Response('{not json',{headers:{'content-type':'application/json'}}),'manual',pixeldrain.MESSAGES.failed]
  ];
  for(const [response,status,message] of cases){
    const result=await pixeldrain.resolvePixeldrain('https://pixeldrain.com/u/abcd1234',{fetcher:async()=>response});
    assert.equal(result.status,status,message);assert.equal(result.message,message);
    assert.equal(JSON.stringify(result).includes('server-secret'),false);
  }
  assert.deepEqual(await pixeldrain.resolvePixeldrain('https://pixeldrain.com/l/abcd1234',{fetcher:async()=>{throw new Error('a list is never resolved as a file');}}),{status:'manual',message:pixeldrain.MESSAGES.list});
  const bigName=await pixeldrain.resolvePixeldrain('https://pixeldrain.com/u/abcd1234',{fetcher:async()=>json({name:'n'.repeat(500),size:-5})});
  assert.equal(bigName.filename.length,240);assert.equal(bigName.size,0);
  for(const message of Object.values(pixeldrain.MESSAGES))assert.equal(publicErrorMessage(new Error(message),'download'),message);
});

test('a PixelDrain list becomes its file links, in order, and an answer that is too large is refused',async()=>{
  const files=await pixeldrain.listFiles('https://pixeldrain.com/l/List1234',{fetcher:async url=>{
    assert.equal(url,'https://pixeldrain.com/api/list/List1234');
    return json({success:true,files:[{id:'aaaa1111'},{id:'bbbb2222'},{id:'../evil'},{id:42},{id:'aaaa1111'},null]});
  }});
  assert.deepEqual(files,['https://pixeldrain.com/u/aaaa1111','https://pixeldrain.com/u/bbbb2222']);
  await assert.rejects(pixeldrain.listFiles('https://pixeldrain.com/l/List1234',{fetcher:async()=>json({},404)}),{message:pixeldrain.MESSAGES.missing});
  await assert.rejects(pixeldrain.listFiles('https://pixeldrain.com/l/List1234',{fetcher:async()=>json({success:false,value:'hotlink_detected'},403)}),{message:pixeldrain.MESSAGES.check});
  await assert.rejects(pixeldrain.listFiles('https://pixeldrain.com/l/List1234',{fetcher:async()=>new Response('{"files":['+'"x",'.repeat(700000)+'"x"]}',{headers:{'content-type':'application/json'}})}),{message:pixeldrain.MESSAGES.failed});
  await assert.rejects(pixeldrain.listFiles('https://pixeldrain.com/u/abcd1234',{fetcher:async()=>json({})}),{message:pixeldrain.MESSAGES.failed});
  const many=await pixeldrain.listFiles('https://pixeldrain.com/l/List1234',{fetcher:async()=>json({files:Array.from({length:1500},(_,i)=>({id:'file'+String(i).padStart(5,'0')}))})});
  assert.equal(many.length,1000);
});

test('a refused PixelDrain download is explained from its refusal code only',async()=>{
  assert.equal(await pixeldrain.downloadRefusal(json({success:false,value:'ip_download_limited_captcha_required',message:SECRET},403)),pixeldrain.MESSAGES.check);
  assert.equal(await pixeldrain.downloadRefusal(json({success:false,value:'download_limit_exceeded'},403)),pixeldrain.MESSAGES.limit);
  assert.equal(await pixeldrain.downloadRefusal(page(SECRET,403)),null);
  assert.equal(await pixeldrain.downloadRefusal(json({success:true},200)),null);
  assert.equal(await pixeldrain.downloadRefusal(json({success:false,value:'unknown_code'},403)),null);
});

test('MultiUp links are read strictly and always looked up on its own mirror page',async()=>{
  for(const link of [`https://multiup.io/download/${HASH}/Game.part1.rar`,`https://multiup.io/en/mirror/${HASH}/Game.part1.rar`,`https://www.multiup.io/fr/download/${HASH.toUpperCase()}/x`,`https://multiup.org/mirror/${HASH}`])
    assert.deepEqual(multiup.multiupLink(link),{id:HASH,page:`https://multiup.io/en/mirror/${HASH}`},link);
  for(const bad of [`http://multiup.io/download/${HASH}/a`,`https://multiup.io/project/${HASH}`,`https://multiup.io/download/abc/a`,`https://multiup.io.evil.test/download/${HASH}/a`,`https://multiup.io:8443/download/${HASH}/a`,`https://multiup.io/eng/download/${HASH}/a`])
    assert.equal(multiup.multiupLink(bad),null,bad);
  let asked='';
  const list=await multiup.mirrorList(`https://multiup.io/download/${HASH}/Game.part1.rar`,{fetcher:async url=>{asked=url;return page(mirrorPage([['gofile.io','https://gofile.io/d/SeVS3kSe']]));},readText:response=>response.text()});
  assert.equal(asked,`https://multiup.io/en/mirror/${HASH}`);assert.deepEqual(list,{mirrors:['https://gofile.io/d/SeVS3kSe'],missing:false,unreadable:false});
  assert.deepEqual(await multiup.mirrorList(`https://multiup.io/download/${HASH}/a`,{fetcher:async()=>page('gone',404),readText:r=>r.text()}),{mirrors:[],missing:true,unreadable:false});
  await assert.rejects(multiup.mirrorList(`https://multiup.io/download/${HASH}/a`,{fetcher:async()=>page('busy',503),readText:r=>r.text()}),{message:multiup.MESSAGES.failed});
});

test('a MultiUp mirror page gives only public HTTPS copies that MultiUp does not mark invalid',()=>{
  const result=multiup.parseMirrors(mirrorPage([
    ['pixeldrain.com','https://pixeldrain.com/u/abcd1234'],
    ['1fichier.com','https://1fichier.com/?xq161wcgo0qw7uza1k24&amp;af=62851'],
    ['rapidgator.net','https://rapidgator.net/file/x','invalid'],
    ['plain','http://insecure.example/file'],
    ['account','https://user:pass@files.example/f'],
    ['itself','https://multiup.io/download/other'],
    ['again','https://pixeldrain.com/u/abcd1234'],
    ['js','javascript:alert(1)']
  ]));
  assert.deepEqual(result,{mirrors:['https://pixeldrain.com/u/abcd1234','https://1fichier.com/?xq161wcgo0qw7uza1k24&af=62851'],missing:false,unreadable:false});
  assert.deepEqual(multiup.parseMirrors('<html><head><title>MultiUp.io</title></head><body>/ File Not Found Available on USENET</body></html>'),{mirrors:[],missing:true,unreadable:false});
  assert.deepEqual(multiup.parseMirrors('<html><body>Something else</body></html>'),{mirrors:[],missing:false,unreadable:true},'a page without copies is one Ravenshelf cannot read');
  assert.deepEqual(multiup.parseMirrors(mirrorPage([['a','https://a.example/f','invalid'],['b','https://b.example/f','invalid']])),{mirrors:[],missing:true,unreadable:false},'every copy invalid: the file is gone');
  assert.equal(multiup.parseMirrors(mirrorPage(Array.from({length:150},(_,i)=>['h',`https://files${i}.example/f`]))).mirrors.length,100);
});

test('expanding links follows lists and mirror pages, never contacts closed hosts, and keeps the order',async()=>{
  const asked=[];
  const providers=providersFixture(async url=>{
    asked.push(url);
    if(/zippyshare|bayfiles|letsupload/.test(url))throw new Error('a closed host was contacted');
    if(url===`https://multiup.io/en/mirror/${HASH}`)return page(mirrorPage([['gofile.io','https://gofile.io/d/x'],['datanodes.to','https://datanodes.to/dn1/Game.part1.rar'],['pixeldrain.com','https://pixeldrain.com/u/pd111111']]));
    if(url==='https://multiup.io/en/mirror/'+'b'.repeat(32))return page(mirrorPage([['gofile.io','https://gofile.io/d/y'],['1fichier.com','https://1fichier.com/?z']]));
    if(url==='https://multiup.io/en/mirror/'+'c'.repeat(32))return page('<title>x</title>File Not Found',200);
    if(url==='https://pixeldrain.com/api/list/List1234')return json({files:[{id:'aaaa1111'},{id:'bbbb2222'}]});
    throw new Error('unexpected '+url);
  });
  const result=await providers.expandLinks([
    `https://multiup.io/download/${HASH}/Game.part1.rar`,
    'https://www.zippyshare.com/v/abc/file.html',
    'https://pixeldrain.com/l/List1234',
    `https://multiup.io/download/${'b'.repeat(32)}/Game.part2.rar`,
    'https://bayfiles.com/x/y',
    'https://www75.zippyshare.com/v/def/file.html',
    `https://multiup.io/download/${'c'.repeat(32)}/Game.part3.rar`,
    'https://fuckingfast.co/abc#Game.part4.rar'
  ].join('\n'));
  assert.deepEqual(plain(result.links).map(link=>[link.host,link.url]),[
    ['PixelDrain','https://pixeldrain.com/u/pd111111'],
    ['PixelDrain','https://pixeldrain.com/u/aaaa1111'],['PixelDrain','https://pixeldrain.com/u/bbbb2222'],
    ['MultiUpload',`https://multiup.io/download/${'b'.repeat(32)}/Game.part2.rar`],
    ['FuckingFast','https://fuckingfast.co/abc#Game.part4.rar']
  ],'a MultiUpload file without a usable copy stays, to open in the browser');
  assert.deepEqual(plain(result.warnings),[hosts.CLOSED_HOSTS[0].message,multiup.MESSAGES.none,hosts.CLOSED_HOSTS[1].message,multiup.MESSAGES.missing]);
  assert.equal(asked.some(url=>/zippyshare|bayfiles/.test(url)),false);
});

test('checking a link: closed hosts without a request, PixelDrain through its details, MultiUp asks to be imported',async()=>{
  let requests=0;
  const providers=providersFixture(async url=>{requests++;if(url==='https://pixeldrain.com/api/file/abcd1234/info')return json({name:'Game.part1.rar',size:10});throw new Error('unexpected '+url);});
  const closed=plain(await providers.resolveLink('https://www.zippyshare.com/v/abc/file.html'));
  assert.equal(closed.status,'unavailable');assert.equal(closed.host,'ZippyShare');assert.equal(closed.message,hosts.CLOSED_HOSTS[0].message);assert.equal(requests,0);
  const ready=plain(await providers.resolveLink('https://pixeldrain.com/u/abcd1234'));
  assert.deepEqual([ready.status,ready.host,ready.url,ready.filename,ready.size],['ready','PixelDrain','https://pixeldrain.com/api/file/abcd1234?download','Game.part1.rar',10]);
  const mirror=plain(await providers.resolveLink(`https://multiup.io/download/${HASH}/a.rar`));
  assert.deepEqual([mirror.status,mirror.host,mirror.message],['manual','MultiUpload',multiup.MESSAGES.expand]);
  const failed=plain(await providersFixture(async()=>{throw new Error(SECRET);}).resolveLink('https://pixeldrain.com/u/abcd1234'));
  assert.equal(failed.status,'manual');assert.equal(JSON.stringify(failed).includes('server-secret'),false);
});

test('a game page offers PixelDrain and MultiUpload and names the closed mirrors it leaves out',()=>{
  const paste=id=>`https://pastefg.hermietkreeft.site/?${id.repeat(16)}#11111111111111111111111111111112`;
  const html=`<article><h1 class="entry-title"><a href="https://fitgirl-repacks.site/old/">Old</a></h1><div class="entry-content"><h3>#1 Old</h3>
    <a href="${paste('1')}">Filehoster: MultiUpload (10+ hosters, interchangeable) [Use JDownloader2]</a>
    <a href="${paste('2')}">Filehoster: PixelDrain</a>
    <a href="${paste('3')}">Filehoster: ZippyShare</a>
    <a href="${paste('4')}">Filehoster: LetsUpload [Use JDownloader2]</a>
    <a href="https://bayfiles.com/abc/file">Filehoster: BayFiles</a></div></article>`;
  const game=t.parseDetail(html,'https://fitgirl-repacks.site/old/');
  assert.deepEqual(game.groups.map(group=>[group.host,group.urls]),[['MultiUpload',[paste('1')]],['PixelDrain',[paste('2')]]]);
  assert.deepEqual(game.closedMirrors,['ZippyShare','BayFiles','LetsUpload']);
});

test('importing a game page keeps each host its own group, and looks nothing up until a host is chosen',async()=>{
  const paste=`https://pastefg.hermietkreeft.site/?${'2'.repeat(16)}#11111111111111111111111111111112`;
  const html=`<article><h1 class="entry-title"><a href="https://fitgirl-repacks.site/game/">Game</a></h1><div class="entry-content"><h3>#1 Game</h3>
    <a href="https://fuckingfast.co/aaa#Game.part1.rar">Filehoster: FuckingFast</a>
    <a href="https://multiup.io/download/${HASH}/Game.part1.rar">Filehoster: MultiUpload</a>
    <a href="${paste}">Filehoster: PixelDrain</a></div></article>`;
  const asked=[];
  const providers=providersFixture(async url=>{asked.push(url);if(url==='https://fitgirl-repacks.site/game/')return page(html);throw new Error('unexpected '+url);});
  const result=await providers.expandLinks('https://fitgirl-repacks.site/game/');
  assert.deepEqual(plain(result.links).map(link=>[link.host,link.url]),[['FuckingFast','https://fuckingfast.co/aaa#Game.part1.rar'],['MultiUpload',`https://multiup.io/download/${HASH}/Game.part1.rar`],['PixelDrain',paste]]);
  assert.deepEqual(asked,['https://fitgirl-repacks.site/game/'],'only the game page was requested');
});

test('a MultiUpload copy must be a link to one file, and lookups that fail keep the link with a plain note',async()=>{
  const providers=providersFixture(async url=>{
    if(url===`https://multiup.io/en/mirror/${HASH}`)return page(mirrorPage([['pixeldrain.com','https://pixeldrain.com/l/List1234'],['datanodes.to','https://datanodes.to/dn1/Game.part1.rar']]));
    if(url==='https://multiup.io/en/mirror/'+'d'.repeat(32))return page('<html><body>Please wait</body></html>');
    if(url==='https://pixeldrain.com/api/list/Slow1234')throw new Error('timed out');
    throw new Error('unexpected '+url);
  });
  const result=await providers.expandLinks([`https://multiup.io/download/${HASH}/a`,`https://multiup.io/download/${'d'.repeat(32)}/b`,'https://pixeldrain.com/l/Slow1234'].join('\n'));
  assert.deepEqual(plain(result.links).map(link=>link.url),['https://datanodes.to/dn1/Game.part1.rar',`https://multiup.io/download/${'d'.repeat(32)}/b`],'a PixelDrain list is not taken as a copy');
  assert.deepEqual(plain(result.warnings),[multiup.MESSAGES.failed,pixeldrain.MESSAGES.failed]);
});

const tick=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));
test('a PixelDrain file downloads over one connection, and a refusal is shown plainly',async t2=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'rs-pd-'));
  const size=MIN_PARALLEL_SIZE+1024*1024,payload=Buffer.alloc(size,7),requests=[];let refuse=false;
  const fetcher=async(url,options={})=>{
    const headers=new Headers(options.headers),range=headers.get('range');requests.push(range||'');
    if(refuse)return json({success:false,value:'hotlink_detected',message:SECRET},403);
    const match=range&&/^bytes=(\d+)-(\d*)$/.exec(range),start=match?Number(match[1]):0,end=match&&match[2]?Number(match[2]):size-1,body=payload.subarray(start,end+1);
    return new Response(body,{status:match?206:200,headers:{'content-type':'application/octet-stream','content-length':String(body.length),etag:'"v"',...(match?{'content-range':`bytes ${start}-${end}/${size}`}:{})}});
  };
  const manager=new DownloadManager({stateFile:path.join(root,'state.json'),downloadDir:path.join(root,'dl'),fetcher,resolveLink:async()=>({status:'ready',url:'https://pixeldrain.com/api/file/abcd1234?download'})});
  t2.after(async()=>{await manager.stop();fs.rmSync(root,{recursive:true,force:true});});
  manager.updateSettings({concurrency:1,connectionsPerFile:4,defenderScan:false});
  const finished=async()=>{for(let i=0;i<3000&&(manager.running.size||manager.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(5);};
  manager.add({links:[{status:'ready',url:'https://pixeldrain.com/api/file/abcd1234?download',sourceUrl:'https://pixeldrain.com/u/abcd1234',filename:'Game.part1.rar',size}],gameTitle:'Game'});
  await finished();
  const [d]=manager.downloads;
  assert.equal(d.status,'completed',d.error);assert.deepEqual(requests,['']);
  assert.equal(d.connectionMode,'single');assert.equal(d.connectionNote,pixeldrain.MESSAGES.note);
  refuse=true;requests.length=0;
  manager.add({links:[{status:'ready',url:'https://pixeldrain.com/api/file/efgh5678?download',sourceUrl:'https://pixeldrain.com/u/efgh5678',filename:'Game.part2.rar',size}],gameTitle:'Game'});
  await finished();
  const refused=manager.downloads[1];
  assert.equal(refused.status,'error');assert.equal(refused.error,pixeldrain.MESSAGES.check);
  assert.equal(JSON.stringify(manager.state()).includes('server-secret'),false);
});
