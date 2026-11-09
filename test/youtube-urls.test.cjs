'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const youtube=require('../src/youtube.cjs');
const P=require('../src/browser-extension/policy.js');
const protocol=require('../src/browser-protocol.cjs');

const ID='aqz-KE-bpKQ';
const ACCEPTED=[
  [`https://www.youtube.com/watch?v=${ID}`,ID],
  [`https://www.youtube.com/watch?v=${ID}&list=PL123&index=4&t=63s`,ID],
  [`https://youtube.com/watch?feature=share&v=${ID}`,ID],
  [`https://m.youtube.com/watch?v=${ID}`,ID],
  [`https://www.youtube.com/shorts/${ID}`,ID],
  [`https://www.youtube.com/shorts/${ID}/`,ID],
  [`https://www.youtube.com/live/${ID}?si=abc`,ID],
  [`https://www.youtube.com/embed/${ID}`,ID],
  [`https://youtu.be/${ID}?t=10`,ID],
  [`https://WWW.YOUTUBE.COM/watch?v=${ID}`,ID]
];
const REFUSED=[
  `http://www.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com:8443/watch?v=${ID}`,
  `https://user:pass@www.youtube.com/watch?v=${ID}`,
  `https://music.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com.evil.example/watch?v=${ID}`,
  `https://evil.example/watch?v=${ID}`,
  `https://youtu.be.evil.example/${ID}`,
  'https://www.youtube.com/watch?v=short',
  `https://www.youtube.com/watch?v=${ID}x`,
  'https://www.youtube.com/watch?v=aqz-KE-bp%3F',
  'https://www.youtube.com/playlist?list=PL123',
  'https://www.youtube.com/@channel',
  `https://www.youtube.com/shorts/${ID}/extra`,
  `https://youtu.be/${ID}/extra`,
  'https://www.youtube.com/watch',
  'not a url','',null,undefined,42,
  `https://www.youtube.com/watch?v=${ID}&x=${'y'.repeat(9000)}`
];

test('only single YouTube videos are recognized, the same way in the app and the extension',()=>{
  for(const [url,id] of ACCEPTED){assert.equal(youtube.youtubeVideoId(url),id,url);assert.equal(P.youtubeVideoId(url),id,url);}
  for(const url of REFUSED){assert.equal(youtube.youtubeVideoId(url),null,String(url).slice(0,80));assert.equal(P.youtubeVideoId(url),null,String(url).slice(0,80));}
});

test('yt-dlp only ever sees the canonical address of the video',()=>{
  assert.equal(youtube.canonicalUrl(ID),`https://www.youtube.com/watch?v=${ID}`);
  assert.equal(P.youtubeUrl(ID),youtube.canonicalUrl(ID));
  for(const bad of ['-o x','abc',`${ID}&list=1`,'','../../aaaaa',null])assert.throws(()=>youtube.canonicalUrl(bad));
  for(const bad of ['-o x','abc',null])assert.equal(P.youtubeUrl(bad),null);
});

test('quality choices match between the player menu, the protocol and the downloader',()=>{
  assert.deepEqual(P.PLAYER_CHOICES.map(choice=>choice.id),youtube.QUALITY_IDS);
  assert.deepEqual([...P.MEDIA_QUALITIES],[...youtube.REQUEST_QUALITIES]);
  assert.ok(youtube.QUALITY_IDS.includes(youtube.DEFAULT_QUALITY));
  assert.deepEqual([...youtube.QUALITY_IDS].sort(),Object.keys(youtube.QUALITIES).sort(),'every choice is listed once');
  for(const id of youtube.QUALITY_IDS){
    const choice=youtube.QUALITIES[id];
    assert.ok(youtube.MEDIA_EXTENSIONS.includes(choice.ext),id);
    assert.ok(choice.args.every(arg=>typeof arg==='string'&&!/[\r\n\0]/.test(arg)),id);
    // Nothing in a quality choice can run commands, read cookies or change where files go.
    assert.ok(!choice.args.some(arg=>/^--?(exec|cookies|o|output|paths|P|config|batch|load-info|plugin)/i.test(arg)),id);
  }
  assert.equal(youtube.QUALITIES['audio-mp3'].ext,'mp3');assert.equal(youtube.QUALITIES['audio-m4a'].ext,'m4a');
  assert.ok(youtube.QUALITIES['1080'].args.join(' ').includes('res:1080'));assert.ok(youtube.QUALITIES['720'].args.join(' ').includes('res:720'));
  const pick=id=>{const args=youtube.QUALITIES[id].args;return args[args.indexOf('-f')+1];};
  for(const id of ['best','1080','720','480']){
    // HLS audio (format 234) downloads in parts like HLS video; the AAC file is the fallback.
    assert.equal(pick(id),'bv*+234/bv*+ba/b',id);
    const args=youtube.QUALITIES[id].args;
    assert.deepEqual(args.slice(args.indexOf('--merge-output-format'),args.indexOf('--merge-output-format')+2),['--merge-output-format','mp4'],`${id}: joined as MP4 even though yt-dlp can't read the HLS audio's codec`);
  }
  assert.equal(pick('audio-m4a'),'234/ba[ext=m4a]/ba/b');assert.equal(pick('audio-mp3'),'234/ba/b');
});

test('the extension can send a YouTube video, and only its ID and quality reach the app',()=>{
  const ok=message=>protocol.validateRequest({v:1,...message});
  assert.deepEqual(ok({type:'media',url:`https://youtu.be/${ID}?t=1`,quality:'720'}),{type:'media',videoId:ID,quality:'720'});
  assert.deepEqual(ok({type:'media',url:`https://www.youtube.com/watch?v=${ID}`,quality:'default'}),{type:'media',videoId:ID,quality:'default'});
  for(const message of [
    {type:'media',url:`https://www.youtube.com/watch?v=${ID}`,quality:'4k'},
    {type:'media',url:`https://www.youtube.com/watch?v=${ID}`,quality:''},
    {type:'media',url:`https://www.youtube.com/watch?v=${ID}`},
    {type:'media',url:'https://evil.example/watch?v=aqz-KE-bpKQ',quality:'720'},
    {type:'media',url:`http://www.youtube.com/watch?v=${ID}`,quality:'720'},
    {type:'media',url:`https://www.youtube.com/watch?v=${ID}`,quality:'720',output:'C:\\x'},
    {type:'media',url:'https://www.youtube.com/playlist?list=PL1',quality:'720'}
  ])assert.throws(()=>ok(message),/Invalid browser request/,JSON.stringify(message));
});

test('titles cannot disguise a file name or break a line',()=>{
  assert.equal(youtube.cleanTitle('My video\u202Egpj.exe'),'My videogpj.exe');
  assert.equal(youtube.cleanTitle('  two\n lines\tand\u200Bmore  '),'two lines andmore');
  assert.equal(youtube.cleanTitle('عنوان عربي'),'عنوان عربي');
  assert.equal(youtube.cleanTitle(null),'');assert.equal(youtube.cleanTitle('x'.repeat(400)).length,300);
});

test('player messages explain each answer without technical detail',()=>{
  for(const action of ['queued','duplicate','setup','busy'])assert.notEqual(P.mediaReplyText({ok:true,action}).title,'Ravenshelf did not respond',action);
  assert.equal(P.mediaReplyText({ok:true,action:'queued'}).tone,'ok');
  assert.equal(P.mediaReplyText({ok:true,action:'setup'}).tone,'warn');
  assert.match(P.mediaReplyText({ok:false,error:'not-running'}).text,/Open Ravenshelf/);
  assert.match(P.mediaReplyText({ok:false,error:'private'}).text,/private windows/);
  assert.equal(P.mediaReplyText(undefined).tone,'error');
});
