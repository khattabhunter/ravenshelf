'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const yaml=fs.readFileSync(path.resolve(__dirname,'../.github/workflows/source-integrity.yml'),'utf8');
const lines=yaml.split(/\r?\n/),scriptStart=lines.findIndex(line=>/^\s+script: \|$/.test(line));
assert.ok(scriptStart>=0,'the gate has an inline script');
const scriptLines=[];
for(const line of lines.slice(scriptStart+1)){if(line.trim()&&!line.startsWith('            '))break;scriptLines.push(line.slice(12));}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runGate=new AsyncFunction('github','context','core',scriptLines.join('\n'));
const sha=number=>number.toString(16).padStart(40,'0');
const good=(number=1,signature='-----BEGIN PGP SIGNATURE-----\nfixture')=>({sha:sha(number),commit:{verification:{verified:true,reason:'valid',signature,payload:'fixture signed commit payload',verified_at:'2026-11-07T00:00:00Z'}}});
function fixture({event='push',commits=[good()],reportedCount=commits.length,pages=null,initial={},final={},eventHead=commits.at(-1)?.sha,commitOverride=null,failAt=null,failCall=null}={}){
  const calls=[],outputs={},notices=[],tables=[];let reads=0;
  const repository={owner:'fixture-owner',repo:'fixture-repository'};
  const base={head:{sha:eventHead},base:{sha:sha(9999),ref:'main'},commits:reportedCount};
  const context={repo:repository,eventName:event,sha:sha(1),payload:event==='pull_request'?{number:7,pull_request:{head:{sha:eventHead}}}:{}};
  const api=async(name,args)=>{calls.push({name,args});assert.equal(args.owner,repository.owner);assert.equal(args.repo,repository.repo);if(failAt===name||failCall===calls.length)throw new Error('Fixture API failure');};
  const github={rest:{repos:{getCommit:async args=>{await api('getCommit',args);return {data:commitOverride||commits[0]};}},pulls:{
    get:async args=>{await api('getPull',args);return {data:{...structuredClone(base),...structuredClone(reads++?final:initial)}};},
    listCommits:async args=>{await api('listCommits',args);assert.equal(args.per_page,100);const data=pages?pages[args.page-1]||[]:commits.slice((args.page-1)*100,args.page*100);return Array.isArray(data)?{data,headers:args.page*100<commits.length?{link:'<https://api.github.com/fixture?page=2>; rel="next"'}:{}}:data;},
  }}};
  const summary={addHeading(){return this;},addTable(value){tables.push(value);return this;},async write(){}};
  const core={setOutput:(name,value)=>{outputs[name]=value;},notice:value=>notices.push(value),summary};
  return {run:()=>runGate(github,context,core),calls,outputs,notices,tables,context};
}
test('gate is standalone/reusable and has one pinned API-only step before any checkout',()=>{
  assert.match(yaml,/workflow_call:/);assert.match(yaml,/workflow_dispatch:/);assert.match(yaml,/pull_request:\s*\n\s*branches: \[main\]/);assert.match(yaml,/push:\s*\n\s*branches: \[main\]/);
  assert.equal((yaml.match(/\buses:/g)||[]).length,1);assert.match(yaml.match(/\buses: (\S+)/)?.[1]||'',/^actions\/github-script@[0-9a-f]{40}$/);
  assert.doesNotMatch(yaml,/uses: actions\/checkout|\brun:|contents: write|pull_request_target|secrets: inherit/);assert.match(yaml,/contents: read/);assert.match(yaml,/pull-requests: read/);assert.match(yaml,/timeout-minutes: 5/);
});
for(const event of ['push','workflow_dispatch','workflow_call'])test(`${event} verifies the exact context SHA`,async()=>{
  const f=fixture({event});await f.run();assert.equal(f.outputs.verified_sha,sha(1));assert.equal(f.outputs.commit_count,1);assert.deepEqual(f.calls.map(x=>[x.name,x.args.ref]),[['getCommit',sha(1)]]);
  assert.doesNotMatch(JSON.stringify([f.tables,f.notices]),/fixture signed commit payload|BEGIN PGP/);
});
for(const signature of ['-----BEGIN SSH SIGNATURE-----\nfixture','-----BEGIN SIGNED MESSAGE-----\nS/MIME fixture'])test(`GitHub-verified ${signature.includes('SSH')?'SSH':'S/MIME'} signatures are accepted`,async()=>{
  const f=fixture({commits:[good(1,signature)]});await f.run();assert.equal(f.outputs.commit_count,1);
});
for(const mutation of [v=>{v.verified=false;},v=>{v.verified='true';},v=>{v.reason='invalid';},v=>{v.reason='unsigned';},v=>{delete v.signature;},v=>{v.signature='  ';},v=>{delete v.payload;},v=>{v.payload='';}])test('unsigned, tampered, or incomplete verification records fail closed',async()=>{
  const commit=good();mutation(commit.commit.verification);const f=fixture({commits:[commit]});await assert.rejects(f.run(),/valid GitHub-verified signature/);assert.deepEqual(f.outputs,{});
});
test('missing verification and a substituted commit identity fail closed',async()=>{
  for(const commit of [{sha:sha(1),commit:{}},good(2)]){const f=fixture({commitOverride:commit});await assert.rejects(f.run());assert.deepEqual(f.outputs,{});}
});
test('verification time is audit metadata rather than an extra signature-format restriction',async()=>{
  const commit=good();commit.commit.verification.verified_at=null;const f=fixture({commits:[commit]});await f.run();assert.equal(f.tables[0][1][1],'not recorded');
});
for(const count of [1,100,101,200,250])test(`PR checks all ${count} introduced commits with bounded complete pagination`,async()=>{
  const commits=Array.from({length:count},(_,i)=>good(i+10)),f=fixture({event:'pull_request',commits});await f.run();
  assert.equal(f.outputs.verified_sha,commits.at(-1).sha);assert.equal(f.outputs.commit_count,count);assert.equal(f.calls.filter(x=>x.name==='getPull').length,2);assert.equal(f.calls.some(x=>x.name==='getCommit'),false);
  assert.deepEqual(f.calls.filter(x=>x.name==='listCommits').map(x=>x.args.page),Array.from({length:Math.floor(count/100)+1},(_,i)=>i+1));
});
test('an unsigned interior PR commit fails even when its head is signed',async()=>{
  const commits=[good(2),good(3),good(4)];commits[1].commit.verification.verified=false;const f=fixture({event:'pull_request',commits});await assert.rejects(f.run());assert.deepEqual(f.outputs,{});
});
test('an unsigned later-page commit cannot hide behind a verified first page and head',async()=>{
  const commits=Array.from({length:102},(_,i)=>good(i+10));commits[100].commit.verification.reason='unsigned';
  const f=fixture({event:'pull_request',commits});await assert.rejects(f.run());assert.deepEqual(f.outputs,{});assert.deepEqual(f.calls.filter(x=>x.name==='listCommits').map(x=>x.args.page),[1,2]);
});
test('PR never substitutes the synthetic merge SHA for its actual source head',async()=>{
  const f=fixture({event:'pull_request',commits:[good(4)]});f.context.sha=sha(888);await f.run();assert.equal(f.outputs.verified_sha,sha(4));
});
test('fork PR signatures are read through the base repository context',async()=>{
  const f=fixture({event:'pull_request'});f.context.payload.pull_request.head.repo={owner:{login:'untrusted-fork'},name:'other-repository'};
  await f.run();assert.ok(f.calls.every(x=>x.args.owner==='fixture-owner'&&x.args.repo==='fixture-repository'));
});
for(const count of [0,251,'2',null])test(`unreviewable PR count ${String(count)} fails before listing`,async()=>{
  const f=fixture({event:'pull_request',reportedCount:count});await assert.rejects(f.run());assert.equal(f.calls.some(x=>x.name==='listCommits'),false);
});
test('truncation, duplicates, missing head, and unexpected extra commits fail closed',async()=>{
  const scenarios=[
    {commits:[good(2),good(3)],pages:[[good(3)]]},
    {commits:[good(2),good(3)],pages:[[good(3),good(3)]]},
    {commits:[good(2),good(3)],pages:[[good(2),good(4)]]},
    {commits:[good(2)],pages:[[good(2),good(3)]]},
    {commits:[good(2)],pages:[{data:[good(2)],headers:{link:'<https://api.github.com/fixture?page=2>; rel="next"'}}]},
  ];
  for(const scenario of scenarios){const f=fixture({event:'pull_request',...scenario});await assert.rejects(f.run());assert.deepEqual(f.outputs,{});}
});
test('head movement before or during verification and base changes fail closed',async()=>{
  for(const changes of [{initial:{head:{sha:sha(8)}}},{final:{head:{sha:sha(8)}}},{final:{base:{sha:sha(9),ref:'main'}}},{final:{commits:2}}]){
    const f=fixture({event:'pull_request',...changes});await assert.rejects(f.run(),/head|base/);assert.deepEqual(f.outputs,{});
  }
});
for(const failAt of ['getCommit','getPull','listCommits'])test(`${failAt} API errors fail closed`,async()=>{
  const f=fixture({event:failAt==='getCommit'?'push':'pull_request',failAt});await assert.rejects(f.run(),/Fixture API failure/);assert.deepEqual(f.outputs,{});
});
test('a later-page API error or failed final PR recheck never produces verified outputs',async()=>{
  for(const commits of [[good()],Array.from({length:101},(_,i)=>good(i+10))]){
    const f=fixture({event:'pull_request',commits,failCall:3});await assert.rejects(f.run(),/Fixture API failure/);assert.deepEqual(f.outputs,{});
  }
});
