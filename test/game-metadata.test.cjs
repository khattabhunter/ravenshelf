'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGameMetadata,reviewSummary,plain}=require('../src/game-metadata.cjs');
test('review stars come only from validated recommendation totals',()=>{
  assert.deepEqual(reviewSummary({response:{query_summary:{total_positive:80,total_negative:20,total_reviews:100,review_score_desc:'Very Positive'}}}),{score:80,positive:80,total:100,stars:4,description:'Very Positive',label:'Steam recommendations, shown on a five-star scale'});
  for(const q of [{total_positive:1,total_reviews:0},{total_positive:8,total_reviews:4},{total_positive:5,total_reviews:10,total_negative:9},{total_positive:'8',total_reviews:10}])assert.equal(reviewSummary({query_summary:q}),null);
});
test('requirements are plain text and executable markup is discarded',()=>{
  assert.equal(plain('<script>secret()</script><b>Minimum</b><br>CPU: Test<img src=x onerror=evil()>'),'Minimum\nCPU: Test');
});
test('missing identity never searches or invents ratings',async()=>{
  const get=createGameMetadata({fetcher:()=>{throw new Error('No request permitted');}});
  for(const steamAppId of [null,'../1',4294967296,'0']){const result=await get({steamAppId});assert.equal(result.reviews,null);assert.equal(result.source,null);}
});
test('details and reviews are cached, bounded and failures are independent',async()=>{
  let calls=0;const get=createGameMetadata({fetcher:async url=>{calls++;if(url.includes('appdetails'))return Response.json({'570':{success:true,data:{steam_appid:570,name:'Fixture',pc_requirements:{minimum:'<b>OS</b>: Test'},genres:[{description:'Strategy'}]}}});return Response.json({response:{query_summary:{total_reviews:10,total_positive:9,total_negative:1}}});}});
  const [a,b]=await Promise.all([get({steamAppId:570}),get({steamAppId:'570'})]);assert.equal(calls,2);assert.equal(a.reviews.stars,4.5);assert.equal(a.requirements.minimum,'OS: Test');b.genres.push('changed');assert.deepEqual((await get({steamAppId:570})).genres,['Strategy']);assert.equal(calls,2);
  const unavailable=await createGameMetadata({fetcher:async()=>new Response('private path/token',{status:500})})({steamAppId:570});assert.equal(unavailable.reviews,null);assert.doesNotMatch(JSON.stringify(unavailable),/private path|token/);
});
