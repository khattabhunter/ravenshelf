'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {contextOrigin,sanitizedReferrer,originReferrer}=require('../src/referrer-policy.cjs');
const extension=require('../src/browser-extension/policy.js');

test('page context keeps only a public origin and provider referrers keep only a clean path',()=>{
  const page='https://Example.com/private/account?token=synthetic-secret#private-fragment';
  assert.equal(contextOrigin(page),'https://example.com/');
  assert.equal(originReferrer(page),'https://example.com/');
  assert.equal(sanitizedReferrer(page),'https://example.com/private/account');
  assert.equal(sanitizedReferrer('https://fuckingfast.co/file#Game.part01.rar'),'https://fuckingfast.co/file');
  assert.equal(contextOrigin('http://public.example/page?private=1'),'http://public.example/');
  assert.equal(originReferrer('http://public.example/page'),undefined);
  assert.equal(sanitizedReferrer('http://public.example/page'),undefined);
});

test('context policy refuses credentials, local addresses, malformed and excessive input',()=>{
  for(const value of [undefined,null,42,{},'', 'not a url','ftp://public.example/a','file:///C:/private',
    'https://user:secret@public.example/page','https://user@public.example/',
    'https://localhost/a','https://intranet/a','https://printer.local/a','https://server.localdomain/a',
    'https://machine.internal/a','https://router.lan/a','https://router.home.arpa/a','https://public.example./a',
    'https://127.0.0.1/a','https://0x7f000001/a','https://2130706433/a','https://[::1]/a',
    'https://10.0.0.2/a','https://192.168.1.2/a','https://8.8.8.8/a','https://[2606:4700:4700::1111]/a',
    'https://public.example/a\nsecret','https://public.example/a b','https://public.example/'+'x'.repeat(8192)]){
    assert.equal(contextOrigin(value),undefined,String(value).slice(0,100));
    assert.equal(sanitizedReferrer(value),undefined,String(value).slice(0,100));
    assert.equal(originReferrer(value),undefined,String(value).slice(0,100));
    assert.equal(extension.contextOrigin(value),undefined,String(value).slice(0,100));
  }
  for(const value of ['https://public.example/account?token=secret#secret','http://public.example/page','https://bücher.example/path'])
    assert.equal(extension.contextOrigin(value),contextOrigin(value));
});
