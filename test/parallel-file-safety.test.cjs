'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CHUNK_SIZE,downloadRanges,readState}=require('../src/parallel-download.cjs');

function fixture(t){
  const base=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'ravenshelf-parallel-files-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(root)),base);
    assert.match(path.basename(root),/^ravenshelf-parallel-files-/);
    fs.rmSync(root,{recursive:true,force:true});
  });
  const workspace=path.join(root,'segments'),dataPath=path.join(workspace,'data.part'),partialPath=path.join(root,'file.atlas-part');
  fs.mkdirSync(workspace);
  fs.writeFileSync(dataPath,'abc');
  const state={version:1,sourceId:'safe-resume',total:CHUNK_SIZE*2,chunkSize:CHUNK_SIZE,validator:{kind:'etag',value:'"revision-1"'},segments:[{bytes:3,complete:false},{bytes:0,complete:false}]};
  fs.writeFileSync(path.join(workspace,'state.json'),JSON.stringify(state));
  return {root,dataPath,state,options:{workspace,partialPath,sourceId:state.sourceId,signal:new AbortController().signal}};
}

test('replacing saved segment data during the host probe stops before any segment writes',async t=>{
  const {root,dataPath,state,options}=fixture(t),original=path.join(root,'original.part');let requests=0;
  await assert.rejects(downloadRanges({...options,request:async()=>{
    requests++;
    assert.equal(requests,1,'no section request follows a changed local file');
    fs.renameSync(dataPath,original);fs.writeFileSync(dataPath,'keep replacement');
    return new Response(Buffer.from([97]),{status:206,headers:{'content-range':`bytes 0-0/${state.total}`,'content-length':'1',etag:state.validator.value}});
  }}),/changed|unsafe/i);
  assert.equal(requests,1);
  assert.equal(fs.readFileSync(dataPath,'utf8'),'keep replacement');
  assert.equal(fs.readFileSync(original,'utf8'),'abc');
  assert.equal(fs.existsSync(options.partialPath),false);
});

test('single-stream fallback refuses a hard-linked partial without truncating its other name',async t=>{
  const {root,dataPath,options}=fixture(t),victim=path.join(root,'existing-file.txt');
  fs.writeFileSync(victim,'keep existing file');fs.linkSync(victim,options.partialPath);
  await assert.rejects(downloadRanges({...options,request:async()=>new Response('range unsupported')}),/changed|unsafe/i);
  assert.equal(fs.readFileSync(victim,'utf8'),'keep existing file');
  assert.equal(fs.readFileSync(options.partialPath,'utf8'),'keep existing file');
  assert.equal(fs.readFileSync(dataPath,'utf8'),'abc');
  assert.equal(readState(options.workspace).disabled,undefined);
});

test('checkpoint creation leaves an attacker-planted fixed temporary filename untouched',async t=>{
  const {root,options}=fixture(t),victim=path.join(root,'existing-file.txt');
  fs.writeFileSync(victim,'keep existing file');fs.linkSync(victim,path.join(options.workspace,'state.json.tmp'));
  const result=await downloadRanges({...options,request:async()=>new Response('range unsupported')});
  assert.equal(result.fallback,true);assert.equal(result.prefixBytes,3);
  assert.equal(fs.readFileSync(options.partialPath,'utf8'),'abc');
  assert.equal(fs.readFileSync(victim,'utf8'),'keep existing file');
  assert.equal(readState(options.workspace).disabled,true);
  assert.deepEqual(fs.readdirSync(options.workspace).sort(),['data.part','state.json','state.json.tmp']);
});
