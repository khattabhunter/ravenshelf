'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {VirusTotal,hashFile,parseReport,PREFIX}=require('../src/virustotal.cjs');
const {markFromInternet,ZONE_IDENTIFIER}=require('../src/motw.cjs');
const {DownloadManager}=require('../src/downloads.cjs');

const KEY='a'.repeat(63)+'b';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-vt-'));
function storage({available=true}={}){
  return {available,isEncryptionAvailable(){return this.available;},encryptString:value=>Buffer.from('sealed:'+value),decryptString:buffer=>{const text=buffer.toString();if(!text.startsWith('sealed:'))throw new Error('bad');return text.slice(7);}};
}
const report=(stats={malicious:3,suspicious:1,harmless:60,undetected:10},extra={})=>JSON.stringify({data:{attributes:{last_analysis_stats:stats,reputation:-12,last_analysis_date:1794146647,...extra}}});
function fetcher(replies){
  const calls=[];
  return {calls,fetch:async(url,options)=>{calls.push({url,options});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;}};
}

test('nothing is sent until a key is saved, and the key is stored sealed',async()=>{
  const dir=temp(),file=path.join(dir,'virustotal.json'),net=fetcher([]),vt=new VirusTotal({file,storage:storage(),fetcher:net.fetch});
  vt.load();
  assert.deepEqual(await vt.lookup('domain','example.com'),{status:'skipped',reason:'no-key',kind:'domain',subject:'example.com'});
  assert.equal(net.calls.length,0);
  assert.throws(()=>vt.setKey('not-a-key'),/64 letters and numbers/);
  assert.throws(()=>new VirusTotal({file,storage:storage({available:false})}).setKey(KEY),/protected storage is unavailable/);
  assert.equal(fs.existsSync(file),false,'an unprotectable key is never written');
  const snapshot=vt.setKey(' '+KEY.toUpperCase()+' ');
  assert.equal(snapshot.configured,true);assert.equal(JSON.stringify(snapshot).includes(KEY),false,'the renderer never sees the key');
  const saved=fs.readFileSync(file,'utf8');
  assert.equal(saved.includes(KEY),false);assert.match(JSON.parse(saved).sealedKey,new RegExp('^'+PREFIX));
  const reloaded=new VirusTotal({file,storage:storage()});assert.equal(reloaded.load().configured,true);
  const elsewhere=new VirusTotal({file,storage:{isEncryptionAvailable:()=>true,decryptString:()=>{throw new Error('other account');}}});
  const other=elsewhere.load();assert.equal(other.configured,false);assert.match(other.problem,/could not be opened/);
  elsewhere.setOptions({fileChecks:false});
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).sealedKey,JSON.parse(saved).sealedKey,'changing an option keeps the sealed key');
  vt.clearKey();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).sealedKey,null);assert.equal(vt.snapshot().configured,false);
});

test('only domain names and file fingerprints are looked up, with the key in a header',async()=>{
  const dir=temp(),net=fetcher([new Response(report(),{status:200}),new Response(report({malicious:0,harmless:70}),{status:200}),new Response('',{status:404})]);
  const vt=new VirusTotal({file:path.join(dir,'vt.json'),storage:storage(),fetcher:net.fetch});vt.load();vt.setKey(KEY);
  const domain=await vt.lookup('domain','Files.Example.COM.');
  assert.deepEqual(domain,{status:'ok',kind:'domain',subject:'files.example.com',malicious:3,suspicious:1,harmless:60,undetected:10,reputation:-12,analyzedAt:'2026-11-08T14:04:07.000Z',link:'https://www.virustotal.com/gui/domain/files.example.com'});
  assert.equal(net.calls[0].url,'https://www.virustotal.com/api/v3/domains/files.example.com');
  assert.equal(net.calls[0].options.headers['x-apikey'],KEY);
  const hash=crypto.createHash('sha256').update('x').digest('hex');
  assert.equal((await vt.lookup('file',hash)).malicious,0);assert.equal(net.calls[1].url,`https://www.virustotal.com/api/v3/files/${hash}`);
  assert.equal((await vt.lookup('file','b'.repeat(64))).status,'not-found');
  for(const [kind,value] of [['domain','https://files.example.com/path?token=1'],['domain','files.example.com/x'],['file','not-a-hash'],['url','x.example'],['domain','']])assert.equal((await vt.lookup(kind,value)).reason,'invalid',`${kind} ${value}`);
  assert.equal(net.calls.length,3,'invalid subjects never reach the network');
  assert.equal((await vt.lookup('domain','files.example.com')).cached,true);assert.equal(net.calls.length,3);
});

test('free-tier limits, refused keys and errors are reported without retries',async()=>{
  let now=Date.parse('2026-11-08T12:00:00Z');
  const ok=()=>new Response(report(),{status:200});
  const net=fetcher([ok(),ok(),ok(),ok(),ok(),new Response('',{status:401}),new Response('',{status:429}),new Error('offline'),new Response('{bad',{status:200}),new Response('',{status:500})]);
  const vt=new VirusTotal({file:path.join(temp(),'vt.json'),storage:storage(),fetcher:net.fetch,now:()=>now,perDay:6});vt.load();vt.setKey(KEY);
  for(let i=0;i<4;i++)assert.equal((await vt.lookup('domain',`d${i}.example`)).status,'ok');
  assert.deepEqual(await vt.lookup('domain','d9.example'),{status:'skipped',reason:'limit',kind:'domain',subject:'d9.example'});
  assert.equal(net.calls.length,4);
  now+=61000;
  assert.equal((await vt.lookup('domain','d5.example')).status,'ok');
  const refused=await vt.lookup('domain','d6.example');assert.equal(refused.reason,'key');assert.match(vt.snapshot().problem,/did not accept/);
  const callsBeforeDayLimit=net.calls.length;
  assert.equal((await vt.lookup('domain','d7.example')).reason,'limit','day limit reached after 6 requests');
  assert.equal(net.calls.length,callsBeforeDayLimit,'the day limit is enforced locally');
  now+=24*60*60*1000;
  assert.equal((await vt.lookup('domain','d8.example')).reason,'limit','VirusTotal 429');
  assert.equal((await vt.lookup('domain','d10.example')).reason,'network');
  assert.equal((await vt.lookup('domain','d11.example')).reason,'response');
  now+=61000;
  assert.equal((await vt.lookup('domain','d12.example')).reason,'http');
  vt.setOptions({domainChecks:false});assert.equal((await vt.lookup('domain','d13.example')).reason,'off');
  assert.throws(()=>vt.setOptions({fileChecks:'yes'}),/on or off/);
});

test('reports are parsed defensively',()=>{
  const parsed=parseReport('file','c'.repeat(64),JSON.stringify({data:{attributes:{last_analysis_stats:{malicious:-1,suspicious:'2',harmless:1.5},reputation:'bad'}}}));
  assert.deepEqual([parsed.malicious,parsed.suspicious,parsed.harmless,parsed.undetected,parsed.reputation,parsed.analyzedAt],[0,0,0,0,0,null]);
  assert.throws(()=>parseReport('domain','a.example','{"data":null}'),/Unexpected/);
});

test('files are fingerprinted with SHA-256 without loading them whole',async()=>{
  const file=path.join(temp(),'big.bin');fs.writeFileSync(file,Buffer.alloc(3*1024*1024+7,0x5a));
  assert.equal(await hashFile(file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
});

test('the internet-zone mark is written only on Windows and only to a plain path',async()=>{
  const writes=[];const fsApi={promises:{writeFile:async(file,content)=>writes.push([file,content])}};
  assert.equal(await markFromInternet('C:\\Users\\Player\\Downloads\\Ravenshelf\\file.zip',{platform:'linux',fsApi}),false);
  assert.equal(writes.length,0);
  assert.equal(await markFromInternet('C:\\Users\\Player\\Downloads\\Ravenshelf\\file.zip',{platform:'win32',fsApi}),true);
  assert.deepEqual(writes[0],['C:\\Users\\Player\\Downloads\\Ravenshelf\\file.zip:Zone.Identifier',ZONE_IDENTIFIER]);
  assert.match(ZONE_IDENTIFIER,/^\[ZoneTransfer\]\r\nZoneId=3\r\nHostUrl=about:internet\r\n$/);
  for(const bad of ['relative\\file.zip','C:\\file.zip:other','\\\\server\\share\\a:b',null])await assert.rejects(markFromInternet(bad,{platform:'win32',fsApi}),/Invalid file path/);
  assert.equal(writes.length,1);
});

test('the real mark is readable as a Windows alternate data stream',{skip:process.platform!=='win32'},async()=>{
  const file=path.join(temp(),'downloaded.zip');fs.writeFileSync(file,'PK');
  assert.equal(await markFromInternet(file),true);
  assert.equal(fs.readFileSync(file+':Zone.Identifier','utf8'),ZONE_IDENTIFIER);
  assert.equal(fs.readFileSync(file,'utf8'),'PK','the file contents are unchanged');
});

test('browser downloads are marked when they finish and report completion once',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-mark-'));
  const marked=[],completed=[];
  const manager=new DownloadManager({stateFile:path.join(root,'state.json'),downloadDir:path.join(root,'downloads'),
    fetcher:async()=>new Response('payload',{status:200,headers:{'content-type':'application/octet-stream','content-length':'7'}}),
    markFile:async file=>{marked.push(file);if(file.endsWith('fail.zip'))throw new Error('FAT32');},onCompleted:d=>completed.push(d.id)});
  t.after(async()=>{await manager.stop();fs.rmSync(root,{recursive:true,force:true});});
  manager.add({links:[{status:'ready',url:'https://cdn.example/a.zip',filename:'a.zip',origin:'browser',markOfTheWeb:true},{status:'ready',url:'https://cdn.example/fail.zip',filename:'fail.zip',origin:'browser',markOfTheWeb:true},{status:'ready',url:'https://cdn.example/catalog.rar',filename:'catalog.rar'}],gameTitle:'Browser downloads'});
  const deadline=Date.now()+4000;
  while(manager.downloads.some(d=>d.status!=='completed')){if(Date.now()>deadline)throw new Error('downloads did not finish');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.deepEqual(marked.map(file=>path.basename(file)).sort(),['a.zip','fail.zip']);
  assert.equal(completed.length,3);
  const byName=Object.fromEntries(manager.downloads.map(d=>[d.name,d]));
  assert.equal(byName['a.zip'].origin,'browser');assert.equal(byName['catalog.rar'].origin,undefined);assert.equal(byName['catalog.rar'].markOfTheWeb,undefined);
  assert.match(byName['fail.zip'].connectionNote,/mark could not be added/);assert.equal(byName['fail.zip'].status,'completed');
  assert.equal(manager.setReputation(byName['a.zip'].id,{virusTotal:{status:'ok',malicious:0}}),true);
  assert.equal(manager.state().downloads.find(d=>d.name==='a.zip').reputation.virusTotal.malicious,0);
  assert.equal(manager.setReputation('missing',{}),false);
  assert.equal(manager.setReputation(byName['a.zip'].id,null),true);assert.equal(manager.downloads.find(d=>d.name==='a.zip').reputation,undefined);
});
