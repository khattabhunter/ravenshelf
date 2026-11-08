'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ThreatLists,parseList,validEntry,neverBlock,SOURCES,MAX_RULE_BYTES}=require('../src/threat-lists.cjs');

const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ravenshelf-lists-'));
const SMALL=[
  {id:'malware',label:'malware download sites',source:'fixture',license:'CC0-1.0',minEntries:2,maxEntries:1000,maxBytes:64*1024,urls:['https://lists.example/malware.txt','https://mirror.example/malware.txt']},
  {id:'phishing',label:'phishing sites',source:'fixture',license:'CC0-1.0',minEntries:2,maxEntries:1000,maxBytes:64*1024,urls:['https://lists.example/phishing.txt']},
  {id:'popups',label:'malicious pop-up ad networks',source:'fixture',license:'GPL-3.0',minEntries:2,maxEntries:1000,maxBytes:64*1024,urls:['https://lists.example/popups.txt']}
];
function fetcher(routes){
  const calls=[];
  return {calls,fetch:async url=>{calls.push(url);const value=routes[url];if(value instanceof Error)throw value;if(value===undefined)return new Response('missing',{status:404});return typeof value==='number'?new Response('',{status:value}):new Response(value,{status:200,headers:{'content-type':'text/plain'}});}};
}
const LISTS={
  'https://lists.example/malware.txt':'# Title: fixture\nbad.example\n203.0.113.9\n*.wild.example\nShouty.EXAMPLE.\n',
  'https://lists.example/phishing.txt':'! comment\n0.0.0.0 login-bank.example\nbad.example\nphish.example\n',
  'https://lists.example/popups.txt':'pop.example\nunder.example\n'
};

test('list entries are validated and normalized',()=>{
  const {entries,invalid,excluded}=parseList(['# comment','! comment','','evil.example','  Evil.Example. ','*.wild.example','0.0.0.0 hosts.example','127.0.0.1 local.example','198.51.100.7','::1 v6.example','bad entry here','under_score.example','-dash.example','single','a.'+'x'.repeat(64)+'.example','10.1.2.3','192.168.0.1','2001:db8::1','xn--80ak6aa92e.com','github.com','objects.githubusercontent.com','githubusercontent.com','dl.fuckingfast.co','github.io','evil.github.io','co.uk'].join('\n'));
  assert.deepEqual([...entries].sort(),['198.51.100.7','evil.example','evil.github.io','hosts.example','local.example','under_score.example','v6.example','wild.example','xn--80ak6aa92e.com']);
  assert.equal(invalid,7);assert.equal(excluded,6);
  assert.throws(()=>parseList('a.example\nb.example\nc.example',{maxEntries:2}),/larger than expected/);
  assert.equal(validEntry('203.0.113.300'),false);assert.equal(validEntry('login_page.godaddysites.com'),true);assert.equal(validEntry('bad.under_score'),false);assert.equal(validEntry('0.0.0.0'),false);assert.equal(validEntry('example.123'),false);
  for(const keep of ['raw.githubusercontent.com','tuf-repo-cdn.sigstore.dev','www.virustotal.com','fitgirl-repacks.site','fs12.filekeeper.net'])assert.equal(neverBlock(keep),true,keep);
  assert.equal(neverBlock('not-github.com'),false);assert.equal(neverBlock('evil.pages.dev'),false);assert.equal(neverBlock('pages.dev'),true);
});

test('the shipped sources use HTTPS mirrors and sensible limits',()=>{
  assert.deepEqual(SOURCES.map(source=>source.id),['malware','phishing','threats','popups']);
  for(const source of SOURCES){
    assert.ok(source.urls.length>=2,source.id);
    for(const url of source.urls){const u=new URL(url);assert.equal(u.protocol,'https:');assert.equal(u.search,'');}
    assert.ok(source.minEntries>0&&source.maxEntries>source.minEntries&&source.maxBytes>0);
    assert.ok(Object.isFrozen(source)&&Object.isFrozen(source.urls));
  }
  // As stated by each project (checked against their READMEs): the URLhaus
  // filter is CC0, the phishing filter's lists are CC BY-SA 4.0 (its code is
  // CC0/MIT), and HaGeZi's lists are GPL-3.0. Ravenshelf downloads them for
  // local use and does not redistribute them.
  assert.deepEqual(Object.fromEntries(SOURCES.map(source=>[source.id,source.license])),{malware:'CC0-1.0',phishing:'CC-BY-SA-4.0',threats:'GPL-3.0',popups:'GPL-3.0'});
});

test('lists download, match subdomains and keep the first list’s category',async()=>{
  const dir=temp(),{fetch}=fetcher(LISTS);let changes=0;
  const lists=new ThreatLists({dir,fetcher:fetch,sources:SMALL,onChange:()=>changes++});
  lists.load();assert.equal(lists.total,0);assert.equal(lists.lookup('bad.example'),null);
  const snapshot=await lists.update();
  assert.equal(snapshot.total,8);assert.ok(changes>=2);
  assert.deepEqual(snapshot.sources.map(source=>source.count),[4,3,2]);
  assert.equal(lists.lookup('bad.example').category,'malware','a domain on two lists keeps the higher-priority category');
  assert.equal(lists.lookup('cdn.BAD.example.').domain,'bad.example');
  assert.equal(lists.lookup('deep.wild.example').category,'malware');
  assert.equal(lists.lookup('shouty.example').category,'malware');
  assert.equal(lists.lookup('login-bank.example').category,'phishing');
  assert.equal(lists.lookup('pop.example').label,'malicious pop-up ad networks');
  assert.equal(lists.lookup('203.0.113.9').category,'malware');
  assert.equal(lists.lookup('example'),null);assert.equal(lists.lookup('good.example'),null);
  assert.equal(lists.lookup('[2001:db8::1]'),null);assert.equal(lists.lookup(''),null);assert.equal(lists.lookup(null),null);
  assert.equal(lists.lookup('x'.repeat(300)),null);
});

test('stored lists survive a restart and tampered copies are ignored',async()=>{
  const dir=temp(),{fetch}=fetcher(LISTS);
  const first=new ThreatLists({dir,fetcher:fetch,sources:SMALL});first.load();await first.update();
  const second=new ThreatLists({dir,fetcher:()=>{throw new Error('offline');},sources:SMALL});second.load();
  assert.equal(second.total,first.total);assert.equal(second.version,first.version);assert.equal(second.lookup('phish.example').category,'phishing');
  fs.appendFileSync(path.join(dir,'phishing.txt'),'injected.example\n');
  const third=new ThreatLists({dir,fetcher:fetch,sources:SMALL});third.load();
  assert.equal(third.lookup('injected.example'),null);assert.equal(third.lookup('phish.example'),null);assert.equal(third.lookup('bad.example').category,'malware');
  assert.equal(third.snapshot().sources[1].count,0);
});

test('mirrors are tried in order and failed updates keep the previous copy',async()=>{
  const dir=temp();
  const routes={...LISTS,'https://lists.example/malware.txt':503,'https://mirror.example/malware.txt':LISTS['https://lists.example/malware.txt']};
  const {fetch,calls}=fetcher(routes);
  const lists=new ThreatLists({dir,fetcher:fetch,sources:SMALL});lists.load();await lists.update();
  assert.deepEqual(calls.slice(0,2),['https://lists.example/malware.txt','https://mirror.example/malware.txt']);
  assert.equal(lists.lookup('bad.example').category,'malware');
  const offline=new ThreatLists({dir,fetcher:async()=>{throw new Error('offline');},sources:SMALL});offline.load();
  const snapshot=await offline.update({force:true});
  assert.equal(snapshot.total,lists.total);assert.ok(snapshot.sources.every(source=>source.error));
});

test('suspiciously small or oversized updates are rejected',async()=>{
  const dir=temp();
  const big={...LISTS,'https://lists.example/popups.txt':Array.from({length:40},(_,i)=>`pop${i}.example`).join('\n')};
  const lists=new ThreatLists({dir,fetcher:fetcher(big).fetch,sources:SMALL});lists.load();await lists.update();
  assert.equal(lists.snapshot().sources[2].count,40);
  const shrunk={...big,'https://lists.example/popups.txt':'pop0.example\npop1.example\npop2.example\n'};
  await lists.update({force:true,signal:undefined});lists.fetcher=fetcher(shrunk).fetch;await lists.update({force:true});
  assert.equal(lists.snapshot().sources[2].count,40,'a list that shrinks below a quarter is not accepted');
  assert.ok(lists.snapshot().sources[2].error);
  const tiny=new ThreatLists({dir:temp(),fetcher:fetcher({...LISTS,'https://lists.example/popups.txt':'only.example\n'}).fetch,sources:SMALL});tiny.load();await tiny.update();
  assert.equal(tiny.snapshot().sources[2].count,0);
  const huge=new ThreatLists({dir:temp(),fetcher:fetcher({...LISTS,'https://lists.example/popups.txt':'x'.repeat(70*1024)}).fetch,sources:SMALL});huge.load();await huge.update();
  assert.equal(huge.snapshot().sources[2].count,0);assert.ok(huge.snapshot().sources[2].error);
});

test('fresh lists are not downloaded again until they expire, and updates are single-flight',async()=>{
  let now=Date.parse('2026-11-08T10:00:00Z');const {fetch,calls}=fetcher(LISTS);
  const lists=new ThreatLists({dir:temp(),fetcher:fetch,sources:SMALL,now:()=>now});lists.load();
  const [a,b]=[lists.update(),lists.update()];assert.equal(a,b);await a;
  const firstCalls=calls.length;await lists.update();assert.equal(calls.length,firstCalls);
  now+=13*60*60*1000;await lists.update();assert.equal(calls.length,firstCalls*2);
  await lists.update({force:true});assert.equal(calls.length,firstCalls*3);
});

test('browser rules hold domains only, stay under the message size and change version with content',async()=>{
  const dir=temp();
  const long=Array.from({length:30000},(_,i)=>`subdomain-number-${String(i).padStart(6,'0')}.example`);
  const routes={...LISTS,'https://lists.example/popups.txt':long.join('\n')};
  const sources=SMALL.map(source=>source.id==='popups'?{...source,maxEntries:100000,maxBytes:4*1024*1024}:source);
  const lists=new ThreatLists({dir,fetcher:fetcher(routes).fetch,sources});lists.load();await lists.update();
  const manifest=lists.browserManifest();
  assert.equal(manifest.version,lists.version);
  assert.deepEqual(manifest.rules.map(rule=>[rule.id,rule.category]),[[1,'malware'],[100,'phishing'],[500,'popups'],[501,'popups']]);
  assert.equal(manifest.rules.reduce((sum,rule)=>sum+rule.count,0),lists.total-1,'the IPv4 entry stays in the app');
  for(const {id} of manifest.rules){
    const rule=lists.browserRule(id);
    assert.ok(JSON.stringify(rule).length<MAX_RULE_BYTES+100,`rule ${id} fits one browser message`);
    assert.ok(rule.domains.every(domain=>/^[a-z0-9.-]+$/.test(domain)));
    assert.deepEqual(rule.domains,[...rule.domains].sort());
  }
  assert.equal(lists.browserRule(999),null);
  const malware=lists.browserRule(1);malware.domains.push('mutated.example');
  assert.ok(!lists.browserRule(1).domains.includes('mutated.example'),'callers get copies');
  const before=lists.version;
  lists.fetcher=fetcher({...routes,'https://lists.example/phishing.txt':'phish.example\nother-phish.example\nthird.example\n'}).fetch;
  await lists.update({force:true});
  assert.notEqual(lists.version,before);assert.ok(lists.browserRule(100).domains.includes('other-phish.example'));
  lists.stop();
});
