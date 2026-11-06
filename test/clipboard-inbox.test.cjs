'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ClipboardInbox,recognizedLinks}=require('../src/clipboard-inbox.cjs');
test('only supported public HTTPS host links enter the optional clipboard inbox',()=>{
  assert.deepEqual(recognizedLinks('private https://example.com/password https://fuckingfast.co.evil.test/a https://user:pass@fuckingfast.co/a http://fuckingfast.co/a https://fuckingfast.co/a'),['https://fuckingfast.co/a']);
  assert.deepEqual(recognizedLinks('https://paste.fitgirl-repacks.site/?abc'),[]);
});
test('clipboard watcher starts disabled, never fetches, deduplicates and clears on disable',()=>{
  let reads=0,text='https://fuckingfast.co/a',now=100;const inbox=new ClipboardInbox({readText:()=>{reads++;return text;},now:()=>now});
  inbox.poll();assert.equal(reads,0);inbox.configure(true);inbox.poll();inbox.poll();assert.equal(inbox.snapshot().items.length,1);
  const id=inbox.snapshot().items[0].id;assert.deepEqual(inbox.import([id]),{text});assert.equal(inbox.snapshot().items.length,0);
  text='https://filekeeper.net/b';inbox.poll();now+=31*60*1000;assert.equal(inbox.snapshot().items.length,0);
  inbox.configure(false);assert.deepEqual(inbox.snapshot(),{enabled:false,items:[]});inbox.dispose();
});
