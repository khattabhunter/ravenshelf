'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const ranges=require('../src/parallel-download.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-parallel-limits-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,workspace:path.join(root,'segments'),partialPath:path.join(root,'file.atlas-part'),sourceId:'limits',signal:new AbortController().signal};
}

// Guard only the allocation primitive so a future regression fails this test
// instead of exhausting the test runner's memory with the hostile file size.
function guardedModule(){
  const filename=require.resolve('../src/parallel-download.cjs'),attempts=[];
  class GuardedArray extends Array{
    static from(value,...args){
      const length=Number(value?.length)||0;attempts.push(length);
      if(length>ranges.MAX_SEGMENTS)throw new Error('Unbounded segment allocation attempted.');
      return Array.from(value,...args);
    }
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:createRequire(filename),Array:GuardedArray,Buffer,AbortController,setInterval,clearInterval},{filename});
  return {...module.exports,attempts};
}

test('huge remote totals fall back before allocating section metadata',async t=>{
  for(const total of [ranges.CHUNK_SIZE*ranges.MAX_SEGMENTS+1,2**50,Number.MAX_SAFE_INTEGER]){
    const options=fixture(t),guarded=guardedModule();let requests=0;
    const result=await guarded.downloadRanges({...options,request:async headers=>{
      requests++;assert.equal(headers.Range,'bytes=0-0');
      return new Response(Buffer.from([0]),{status:206,headers:{'content-range':`bytes 0-0/${total}`,'content-length':'1',etag:'"large-file"'}});
    }});
    assert.equal(result.fallback,true);
    assert.match(result.note,/too large/i);
    assert.equal(requests,1);
    assert.deepEqual(guarded.attempts,[],'no section or worker arrays are created');
    assert.equal(fs.existsSync(options.workspace),false,'no sparse file or manifest is created');
  }
});

test('manifest reader preserves ordinary saved state and accepts its byte limit',t=>{
  const {workspace}=fixture(t);fs.mkdirSync(workspace);
  const state={version:1,sourceId:'limits',chunkSize:ranges.CHUNK_SIZE,total:ranges.CHUNK_SIZE*2,validator:{kind:'etag',value:'"saved"'},segments:[{bytes:17,complete:false},{bytes:0,complete:false}]};
  const json=JSON.stringify(state),file=path.join(workspace,'state.json');
  fs.writeFileSync(file,json);
  assert.deepEqual(ranges.readState(workspace),state);
  fs.writeFileSync(file,json+' '.repeat(ranges.MAX_STATE_BYTES-Buffer.byteLength(json)));
  assert.deepEqual(ranges.readState(workspace),state);
  fs.appendFileSync(file,' ');
  assert.equal(ranges.readState(workspace),null);
});

test('oversized saved manifest falls back without reading download data or contacting host',async t=>{
  const options=fixture(t);fs.mkdirSync(options.workspace);
  const file=path.join(options.workspace,'state.json');
  fs.writeFileSync(file,' '.repeat(ranges.MAX_STATE_BYTES+1));
  let requests=0;
  const result=await ranges.downloadRanges({...options,request:async()=>{requests++;throw new Error('Host must not be contacted.');}});
  assert.equal(result.fallback,true);
  assert.match(result.note,/could not be verified/i);
  assert.equal(requests,0);
  assert.equal(fs.existsSync(options.partialPath),false);
  assert.equal(fs.existsSync(path.join(options.workspace,'data.part')),false);
});
