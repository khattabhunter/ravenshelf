'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DownloadManager}=require('../src/downloads.cjs');
async function fixture(t,{total=6,lastResponse,unsatisfied='bytes */6',fetcher,resolveLink}={}){
  const base=path.resolve(os.tmpdir()),root=await fs.promises.mkdtemp(path.join(base,'ravenshelf-eof-')),folder=path.join(root,'downloads','Fixture');
  await fs.promises.mkdir(folder,{recursive:true});
  const partial=path.join(folder,'part01.rar.atlas-part');await fs.promises.writeFile(partial,'abcdef');
  const stateFile=path.join(root,'state.json');await fs.promises.writeFile(stateFile,JSON.stringify({settings:{downloadDir:path.dirname(folder),connectionsPerFile:1},downloads:[{id:'eof',name:'part01.rar',folder,gameTitle:'Fixture',status:'paused',url:'https://files.example.com/file',sourceUrl:'https://host.example.com/source',received:6,total,etag:'"version-1"',headers:{}}]}));
  const requests=[];
  const manager=new DownloadManager({stateFile,downloadDir:path.dirname(folder),resolveLink,fetcher:async(url,options)=>{
    const {headers}=options;requests.push({url,...headers});
    if(fetcher)return fetcher(url,options,manager,requests);
    if(requests.length===1)return new Response(null,{status:416,headers:unsatisfied===null?{}:{'content-range':unsatisfied}});
    return lastResponse?.()||new Response('f',{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1',etag:'"version-1"'}});
  }});
  t.after(async()=>{await manager.stop();assert.equal(path.dirname(path.resolve(root)),base);assert.match(path.basename(root),/^ravenshelf-eof-/);await fs.promises.rm(root,{recursive:true,force:true});});
  manager.action('eof','resume');const deadline=Date.now()+5000;while(manager.running.size||manager.downloads[0].status==='queued'){if(Date.now()>deadline)throw new Error('Fixture transfer did not settle.');await new Promise(resolve=>setTimeout(resolve,5));}
  return {manager,requests,partial,final:path.join(folder,'part01.rar')};
}
for(const total of [0,6])test(`a complete ${total?'known':'unknown'}-size prefix rechecks its last byte after interrupted EOF`,async t=>{
  const f=await fixture(t,{total});assert.equal(f.manager.downloads[0].status,'completed');
  assert.deepEqual(f.requests.map(x=>x.Range),['bytes=6-','bytes=5-']);assert.ok(f.requests.every(x=>x['If-Range']==='"version-1"'));
  assert.equal(await fs.promises.readFile(f.final,'utf8'),'abcdef');assert.equal(fs.existsSync(f.partial),false);
});
test('last-byte recovery still rejects an unverifiable response and retains the original bytes',async t=>{
  const f=await fixture(t,{lastResponse:()=>new Response('x',{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1'}})});
  assert.equal(f.requests.length,2);assert.equal(f.manager.downloads[0].status,'error');assert.equal(await fs.promises.readFile(f.partial,'utf8'),'abcdef');assert.equal(fs.existsSync(f.final),false);
});
test('last-byte recovery restarts fully when If-Range reports a new file revision',async t=>{
  const f=await fixture(t,{lastResponse:()=>new Response('uvwxyz',{headers:{'content-length':'6',etag:'"version-2"'}})});
  assert.equal(f.manager.downloads[0].status,'completed');assert.equal(await fs.promises.readFile(f.final,'utf8'),'uvwxyz');assert.equal(f.manager.downloads[0].etag,'"version-2"');
});
for(const unsatisfied of [null,'bytes */*','bytes */5','bytes */7','bytes */9007199254740992'])test(`an unverified 416 size ${String(unsatisfied)} cannot trigger last-byte recovery`,async t=>{
  const f=await fixture(t,{unsatisfied});assert.equal(f.requests.length,1);assert.equal(f.manager.downloads[0].status,'error');
  assert.equal(await fs.promises.readFile(f.partial,'utf8'),'abcdef');assert.equal(fs.existsSync(f.final),false);
});
test('last-byte recovery refuses a changed ETag before touching the saved prefix',async t=>{
  const f=await fixture(t,{lastResponse:()=>new Response('x',{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1',etag:'"version-2"'}})});
  assert.equal(f.requests.length,2);assert.equal(f.manager.downloads[0].status,'error');assert.equal(await fs.promises.readFile(f.partial,'utf8'),'abcdef');assert.equal(fs.existsSync(f.final),false);
});
test('pausing the last-byte request keeps the original file and never publishes completion',async t=>{
  const f=await fixture(t,{fetcher:async(_url,{headers},manager)=>{
    if(headers.Range==='bytes=6-')return new Response(null,{status:416,headers:{'content-range':'bytes */6'}});
    manager.action('eof','pause');return new Response('f',{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1',etag:'"version-1"'}});
  }});
  assert.equal(f.requests.length,2);assert.equal(f.manager.downloads[0].status,'paused');assert.equal(await fs.promises.readFile(f.partial,'utf8'),'abcdef');assert.equal(fs.existsSync(f.final),false);
});
test('last-byte recovery follows an expired-link refresh with only fresh request credentials',async t=>{
  let refreshed=0;
  const f=await fixture(t,{resolveLink:async()=>{refreshed++;return {status:'ready',url:'https://new.example.com/file',headers:{'X-Fixture':'fresh'}};},fetcher:async(url,{headers})=>{
    if(url==='https://files.example.com/file')return new Response(null,{status:403});
    if(headers.Range==='bytes=6-')return new Response(null,{status:416,headers:{'content-range':'bytes */6'}});
    return new Response('f',{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1',etag:'"version-1"'}});
  }});
  assert.equal(refreshed,1);assert.equal(f.manager.downloads[0].status,'completed');assert.equal(await fs.promises.readFile(f.final,'utf8'),'abcdef');
  assert.equal(f.requests.length,3);assert.ok(f.requests.slice(1).every(x=>x.url==='https://new.example.com/file'&&x['X-Fixture']==='fresh'&&x['If-Range']==='"version-1"'));
});
test('an interrupted last-byte response still needs clean EOF before publication',async t=>{
  const f=await fixture(t,{lastResponse:()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('f'));setTimeout(()=>controller.error(new Error('Fixture interrupted EOF')),5);}}),{status:206,headers:{'content-range':'bytes 5-5/6','content-length':'1',etag:'"version-1"'}})});
  assert.equal(f.requests.length,2);assert.equal(f.manager.downloads[0].status,'error');assert.equal(await fs.promises.readFile(f.partial,'utf8'),'abcdef');assert.equal(fs.existsSync(f.final),false);
});
