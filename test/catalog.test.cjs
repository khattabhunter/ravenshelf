'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const catalog=require('../src/catalog.cjs');
const providers=require('../src/providers.cjs');
const {sourceUrlFor,matchesGenre,adultTagged,parseTop,catalogVersion}=catalog._test;
function fixtureCatalog({html='',games=[],details={}}={}){
  const requests=[];
  const module={exports:{}};
  const fixtureProviders={
    parseListing:(_html,{page})=>({games,page,hasMore:true}),
    limitedText:r=>r.text(),
    getGame:async url=>{if(details[url] instanceof Error)throw details[url];return details[url]||{url,title:'Fixture game',genres:'Action'};}
  };
  const context={module,exports:module.exports,URL,URLSearchParams,structuredClone,Date,Map,Set,Promise,Number,String,console,require:request=>{
    if(request==='./net.cjs')return {safeFetch:async url=>{requests.push(url);const body=typeof html==='function'?await html(url):html;return body instanceof Response?body:new Response(body,{headers:{'content-type':'text/html'}});}};
    if(request==='./providers.cjs')return fixtureProviders;
    return require(request);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/catalog.cjs'),'utf8'),context);
  return {catalog:module.exports,requests};
}
const chart=(entries)=>`<div class="entry-content"><h2>Most Popular Repacks of the Month</h2>${entries.map(([slug,title])=>`<a href="https://fitgirl-repacks.site/${slug}/" title="${title}"><img src="https://images.example.test/${slug}.jpg" alt="${title}"></a>`).join('')}</div>`;

test('genre sections target real paginated tag archives and encode search text',()=>{
  assert.equal(sourceUrlFor({section:'arpg',page:3}),'https://fitgirl-repacks.site/tag/action-rpg/page/3/');
  assert.equal(sourceUrlFor({section:'rpg'}),'https://fitgirl-repacks.site/tag/rpg/');
  assert.equal(sourceUrlFor({section:'rts'}),'https://fitgirl-repacks.site/tag/rts/');
  const u=new URL(sourceUrlFor({section:'rts',search:'A&B #1'}));assert.equal(u.searchParams.get('s'),'A&B #1');
  assert.throws(()=>sourceUrlFor({section:'https://evil.example'}),/available catalog/);
});
test('genre search matching uses source tags rather than text in game descriptions',()=>{
  assert.equal(matchesGenre({genres:'RPG, Action RPG, Third-person'},'arpg'),true);
  assert.equal(matchesGenre({genres:'Strategy, Turn-based',description:'Not an RTS'},'rts'),false);
  assert.equal(matchesGenre({genres:'Action, Shooter, RTS'},'rts'),true);
});
test('adult showcase filtering relies on explicit metadata, not vague game titles',()=>{
  assert.equal(adultTagged({title:'An adult life',genres:'Adventure, Simulator'}),false);
  assert.equal(adultTagged({title:'Ordinary title',genres:'Adventure, Adult, Visual novel'}),true);
});
test('monthly chart parser excludes off-site links and preserves unique source positions',()=>{
  const html=chart([['first','First game'],['second','Second game'],['first','Duplicate']]).replace('</div>','<a href="https://evil.example/third/"><img alt="Off site" src="https://evil.example/a.jpg"></a></div>');
  const parsed=parseTop(html);assert.equal(parsed.entries.length,2);assert.equal(parsed.entries[1].sourceRank,2);assert.equal(parsed.heading,'Most Popular Repacks of the Month');
  assert.throws(()=>parseTop('<div class="entry-content"><h2>Recent posts</h2></div>'),/monthly popular list/);
});
test('top hydration hides explicit adult tags without inventing ranks or unavailable metadata',async()=>{
  const {catalog:c}=fixtureCatalog({html:chart([['first','First game'],['second','Second game'],['third','Third game']]),details:{
    'https://fitgirl-repacks.site/first/':{title:'First game',genres:'Action',repackSize:'2 GB'},
    'https://fitgirl-repacks.site/second/':{title:'Second game',genres:'Adult'},
    'https://fitgirl-repacks.site/third/':new Error('Unavailable')
  }});
  const r=await c.listCatalog({section:'top'});assert.equal(r.games.length,2);assert.equal(r.games[1].sourceRank,3);assert.equal(r.games[1].metadataUnavailable,true);assert.equal(r.games[1].repackSize,'');assert.equal(r.games[1].image,'');assert.match(r.notice,/1 adult-tagged/);assert.match(r.notice,/Full details/);
});
test('catalog search filters metadata while preserving source pagination',async()=>{
  const {catalog:c,requests}=fixtureCatalog({html:'fixture',games:[{title:'One',genres:'RPG'},{title:'Two',genres:'Strategy, RTS'}]});
  const r=await c.listCatalog({section:'rts',page:4,search:'Space'});assert.equal(r.games.length,1);assert.equal(r.games[0].title,'Two');assert.equal(r.page,4);assert.equal(r.hasMore,true);assert.match(requests[0],/tag\/rts\/page\/4\//);
});
test('tag browsing trusts the source archive and does not silently omit weak metadata',async()=>{
  const {catalog:c}=fixtureCatalog({html:'fixture',games:[{title:'Archive-tagged game',genres:''}]});
  const r=await c.listCatalog({section:'rpg'});assert.equal(r.games.length,1);assert.match(r.notice,/whole source genre archive/);
});
test('version hints keep publisher version and build labels distinct',()=>{
  assert.equal(catalogVersion('Example – v1.2.3 + 4 DLCs').value,'1.2.3');
  assert.equal(catalogVersion('Example – Build 20260917T1313Z').label,'Source-listed build');
  assert.equal(catalogVersion('Civilization 7'),null);
});
test('game resources are encoded searches and exact-ID guide links, never fabricated videos',()=>{
  const r=catalog.getGameResources({title:'Test & Game – v1.2 + 3 DLCs',steamAppId:'12345'});
  assert.equal(r.title,'Test & Game');assert.equal(new URL(r.youtubeUrl).searchParams.get('search_query'),'Test & Game PC gameplay');
  assert.equal(r.guides[0].url,'https://steamcommunity.com/app/12345/guides/');assert.equal(r.steamUrl,'https://store.steampowered.com/app/12345/');
  const unsafe=catalog.getGameResources({title:'One',steamAppId:'123/../../x'});assert.equal(unsafe.steamUrl,undefined);
  assert.ok(unsafe.guides.every(g=>new URL(g.url).protocol==='https:'));
});
test('the shared provider listing helpers remain available for catalog integration',()=>{
  assert.equal(typeof providers.parseListing,'function');assert.equal(typeof providers.limitedText,'function');
});

test('forced catalogue refresh bypasses recent cache and updates subsequent normal reads',async()=>{
  const games=[{title:'Old upload',genres:'Action'}];
  const {catalog:c,requests}=fixtureCatalog({html:'fixture',games});
  await c.listCatalog({section:'newest'});games.unshift({title:'New upload',genres:'Action'});
  assert.equal((await c.listCatalog({section:'newest'})).games.length,1);assert.equal(requests.length,1);
  const updated=await c.listCatalog({section:'newest',forceRefresh:true});
  assert.equal(updated.games[0].title,'New upload');assert.equal(requests.length,2);
  updated.games[0].title='Mutated returned copy';
  assert.equal((await c.listCatalog({section:'newest'})).games[0].title,'New upload');assert.equal(requests.length,2);
});

test('forced catalogue refresh coalesces concurrent navigation and refresh requests',async()=>{
  let release;let blocked=false;
  const games=[{title:'Old upload'}],{catalog:c,requests}=fixtureCatalog({games,html:()=>blocked?new Promise(resolve=>{release=resolve;}):'fixture'});
  await c.listCatalog();blocked=true;games.unshift({title:'New upload'});
  const first=c.listCatalog({forceRefresh:true}),second=c.listCatalog({forceRefresh:true}),navigation=c.listCatalog();
  assert.equal(requests.length,2);release('fixture');
  const results=await Promise.all([first,second,navigation]);
  for(const result of results)assert.equal(result.games[0].title,'New upload');
  assert.equal(requests.length,2);
});

test('failed forced refresh keeps the last cached catalogue and can recover',async()=>{
  let failing=false;
  const {catalog:c,requests}=fixtureCatalog({games:[{title:'Available upload'}],html:()=>{if(failing)throw Error('Offline');return 'fixture';}});
  await c.listCatalog();failing=true;
  await assert.rejects(c.listCatalog({forceRefresh:true}),/Offline/);
  assert.equal((await c.listCatalog()).games[0].title,'Available upload');assert.equal(requests.length,2);
  failing=false;await c.listCatalog({forceRefresh:true});assert.equal(requests.length,3);
});

test('forced Top refresh also bypasses the separately cached monthly chart',async()=>{
  let current=chart([['first','First game']]);
  const {catalog:c,requests}=fixtureCatalog({html:()=>current});
  assert.equal((await c.listCatalog({section:'top'})).sourceTotal,1);
  current=chart([['second','Second game'],['first','First game']]);
  const result=await c.listCatalog({section:'top',forceRefresh:true});
  assert.equal(result.sourceTotal,2);assert.equal(result.games[0].url,'https://fitgirl-repacks.site/second/');assert.equal(requests.length,2);
});

test('empty newest HTML never replaces the good cache during forced refresh',async()=>{
  const games=[{title:'Last good upload'}],{catalog:c,requests}=fixtureCatalog({games,html:'fixture'});
  await c.listCatalog();games.length=0;
  await assert.rejects(c.listCatalog({forceRefresh:true}),/newest catalogue page could not be read/);
  assert.equal((await c.listCatalog()).games[0].title,'Last good upload');assert.equal(requests.length,2);
  games.push({title:'New recovered upload'});
  assert.equal((await c.listCatalog({forceRefresh:true})).games[0].title,'New recovered upload');
});

test('a missing newest homepage never replaces a cached successful result',async()=>{
  let missing=false;
  const {catalog:c,requests}=fixtureCatalog({games:[{title:'Last good upload'}],html:()=>missing?new Response('',{status:404}):'fixture'});
  await c.listCatalog();missing=true;
  await assert.rejects(c.listCatalog({forceRefresh:true}),/newest catalogue page is temporarily unavailable/);
  assert.equal((await c.listCatalog()).games[0].title,'Last good upload');assert.equal(requests.length,2);
});

test('empty searches, genre pages and later archive pages remain valid',async()=>{
  const {catalog:c}=fixtureCatalog({games:[],html:'fixture'});
  await assert.rejects(c.listCatalog(),/newest catalogue page could not be read/);
  for(const options of [{search:'No matching game'},{section:'rts'},{page:2}])assert.equal((await c.listCatalog(options)).games.length,0);
});
