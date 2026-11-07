'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const load=name=>yaml.load(fs.readFileSync(path.resolve(__dirname,'../.github/workflows',name),'utf8'));
const publish=load('publish-release.yml'),preview=load('build-windows.yml');
const steps=publish.jobs['verify-checks'].steps;
assert.equal(steps.length,1);
const script=steps[0].with.script;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=new AsyncFunction('github','context','core',script);
const sha='a'.repeat(40),repo={owner:'fixture-owner',repo:'fixture-repository'},required=['test.yml','codeql.yml','source-integrity.yml'];
function run(id=100,patch={}){return {id,head_sha:sha,head_branch:'main',event:'push',head_repository:{full_name:'fixture-owner/fixture-repository'},status:'completed',conclusion:'success',...patch};}
function fixture({results={},context:changes={},failWorkflow=null}={}){
  const calls=[],notices=[];const context={repo,sha,ref:'refs/heads/main',eventName:'workflow_dispatch',...changes};
  const github={rest:{actions:{listWorkflowRuns:async args=>{
    calls.push(args);if(args.workflow_id===failWorkflow)throw new Error('Fixture API unavailable');
    return {data:Object.hasOwn(results,args.workflow_id)?results[args.workflow_id]:{workflow_runs:[run()]}};
  }}}};
  return {calls,notices,run:()=>execute(github,context,{notice:value=>notices.push(value)})};
}
const needs=job=>Array.isArray(job.needs)?job.needs:job.needs?[job.needs]:[];
function dependsOn(workflow,job,target,seen=new Set()){
  if(job===target)return true;if(seen.has(job))return false;seen.add(job);
  return needs(workflow.jobs[job]).some(parent=>dependsOn(workflow,parent,target,seen));
}
test('release checks run API-only after source verification and before build or publication',()=>{
  assert.match(steps[0].uses,/^actions\/github-script@[a-f0-9]{40}$/);assert.equal(steps[0].run,undefined);
  assert.deepEqual(publish.jobs['verify-checks'].permissions,{contents:'read',actions:'read'});assert.equal(publish.jobs['verify-checks']['timeout-minutes'],5);
  assert.equal(publish.jobs['verify-source'].uses,'./.github/workflows/source-integrity.yml');assert.deepEqual(publish.jobs['verify-source'].permissions,{contents:'read','pull-requests':'read'});
  for(const job of ['build','attest','release'])assert.ok(dependsOn(publish,job,'verify-checks'));
  for(const job of ['build','attest','verify'])assert.ok(dependsOn(preview,job,'verify-source'));
  assert.equal(publish.jobs.build.permissions?.['id-token'],undefined);assert.equal(preview.jobs.build.permissions?.['id-token'],undefined);
  for(const workflow of [publish,preview]){assert.equal(workflow.jobs.attest.permissions['id-token'],'write');assert.equal(workflow.jobs.attest.permissions.attestations,'write');assert.ok(workflow.jobs.attest.steps.every(step=>!step.run&&!step.uses?.startsWith('actions/checkout@')));}
});
test('all three required push workflows must pass for the exact release commit and repository',async()=>{
  const f=fixture();await f.run();assert.equal(f.notices.length,1);
  assert.deepEqual(f.calls,required.map(workflow_id=>({...repo,workflow_id,head_sha:sha,branch:'main',event:'push',per_page:100})));
});
for(const changes of [{eventName:'push'},{eventName:'pull_request'},{ref:'refs/heads/feature'},{ref:'refs/tags/v0.4.1'},{sha:'main'},{sha:'z'.repeat(40)}])test('release gate rejects an unsupported event, branch or nonexact source before requesting results',async()=>{
  const f=fixture({context:changes});await assert.rejects(f.run(),/exact main-branch commit/);assert.equal(f.calls.length,0);assert.equal(f.notices.length,0);
});
for(const workflow of required)test(`missing ${workflow} results block publication`,async()=>{
  const f=fixture({results:{[workflow]:{workflow_runs:[]}}});await assert.rejects(f.run(),/checks have not passed/);assert.equal(f.notices.length,0);
});
for(const patch of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{event:'pull_request'},{event:'workflow_dispatch'},{head_repository:{full_name:'different-owner/fixture-repository'}},{head_repository:null}])test('a success for the wrong commit, branch, event or repository cannot authorize publication',async()=>{
  const f=fixture({results:{'test.yml':{workflow_runs:[run(100,patch)]}}});await assert.rejects(f.run(),/checks have not passed/);assert.equal(f.notices.length,0);
});
for(const patch of [{status:'queued',conclusion:null},{status:'in_progress',conclusion:null},{conclusion:'failure'},{conclusion:'cancelled'},{conclusion:'timed_out'},{conclusion:'neutral'},{conclusion:'skipped'},{conclusion:'action_required'}])test('an older pass cannot hide a newer incomplete or unsuccessful run',async()=>{
  const f=fixture({results:{'codeql.yml':{workflow_runs:[run(5),run(10,patch)]}}});await assert.rejects(f.run(),/latest codeql.yml/);assert.equal(f.notices.length,0);
});
test('the newest eligible success wins regardless of response order; unrelated successes and failures do not substitute',async()=>{
  const f=fixture({results:{'test.yml':{workflow_runs:[run(999,{head_sha:'b'.repeat(40),conclusion:'failure'}),run(20),run(10,{conclusion:'failure'}),run(1000,{event:'workflow_dispatch'})]}}});await f.run();assert.equal(f.notices.length,1);
});
for(const id of [undefined,null,0,-1,'100',Number.MAX_SAFE_INTEGER+1])test('a malformed run ID cannot make an older success sort ahead of a newer failure',async()=>{
  const f=fixture({results:{'test.yml':{workflow_runs:[run(1,{id}),run(200,{conclusion:'failure'})]}}});await assert.rejects(f.run(),/invalid run identity/);assert.equal(f.notices.length,0);
});
for(const malformed of [{},{workflow_runs:null},{workflow_runs:{}},null])test('malformed workflow API responses fail closed',async()=>{
  const f=fixture({results:{'source-integrity.yml':malformed}});await assert.rejects(f.run());assert.equal(f.notices.length,0);
});
for(const workflow of required)test(`an API error while reading ${workflow} blocks publication`,async()=>{
  const f=fixture({failWorkflow:workflow});await assert.rejects(f.run(),/Fixture API unavailable/);assert.equal(f.notices.length,0);
});
