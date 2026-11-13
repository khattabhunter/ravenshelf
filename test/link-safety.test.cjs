'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectLink,assessDownload,nameReasons,contentReasons,sniffBytes,extensionOf,nameFromURL,SNIFF_BYTES}=require('../src/link-safety.cjs');

const MZ=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(200,1)]);
function response(body,{status=200,headers={}}={}){return new Response(body,{status,headers});}
function file(body=MZ,headers={}){return response(body,{status:206,headers:{'content-type':'application/octet-stream','content-range':`bytes 0-${Math.min(body.length,SNIFF_BYTES)-1}/123456`,'content-disposition':'attachment; filename="Setup.exe"',...headers}});}
function redirect(location,status=302){return response(null,{status,headers:{location}});}
function fetcherFrom(routes){
  const calls=[];
  const fetcher=async(url,options={})=>{calls.push({url,options});const route=routes[url];if(!route)throw new Error('Unexpected request to '+url);return typeof route==='function'?route(url,options):route;};
  return {fetcher,calls};
}

test('file signatures are recognized from the first bytes only',()=>{
  assert.equal(sniffBytes(MZ),'windows-program');
  assert.equal(sniffBytes(Buffer.from([0x50,0x4b,0x03,0x04,1,2])),'zip');
  assert.equal(sniffBytes(Buffer.from('Rar!\x1a\x07\x01\x00','latin1')),'rar');
  assert.equal(sniffBytes(Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c,0,4])),'7z');
  assert.equal(sniffBytes(Buffer.from('%PDF-1.7\n')),'pdf');
  for(const page of ['<!DOCTYPE html><html>','\ufeff  <html lang="en">','\n\n<head><title>x</title>','<body onload="x">'])assert.equal(sniffBytes(Buffer.from(page)),'html',page);
  assert.equal(sniffBytes(Buffer.from('#!/bin/sh\n')),'script');
  assert.equal(sniffBytes(Buffer.from('plain text')),'unknown');
  assert.equal(sniffBytes(Buffer.alloc(0)),'unknown');
  for(const page of ['<HTML><BODY>x','  <!DOCTYPE HTML>','<?xml version="1.0"?><SCRIPT src=x></SCRIPT>','<Meta charset=utf-8>'])assert.equal(sniffBytes(Buffer.from(page)),'html',page);
});

test('deceptive file names are blocked and risky types need confirmation',()=>{
  const levels=name=>nameReasons(name).map(item=>`${item.code}:${item.level}`);
  assert.deepEqual(levels('invoice.pdf.exe'),['double-extension:blocked']);
  assert.deepEqual(levels('Movie.MP4 .EXE'),['double-extension:blocked']);
  assert.deepEqual(levels('photo.jpg.scr'),['double-extension:blocked']);
  assert.deepEqual(levels('report.docx.lnk'),['double-extension:blocked']);
  assert.deepEqual(levels('readme      .exe'),['padded-name:blocked']);
  assert.deepEqual(levels('summer\u202egpj.exe'),['spoofed-name:blocked']);
  assert.deepEqual(levels('name\u200f.txt'),['spoofed-name:blocked']);
  assert.deepEqual(levels('setup.exe'),['program:warning']);
  assert.deepEqual(levels('installer.MSI'),['program:warning']);
  for(const name of ['run.bat','tool.ps1','x.js','link.lnk','app.hta','fix.reg'])assert.deepEqual(levels(name),['script:warning'],name);
  for(const name of ['game.iso','disk.vhdx','image.img'])assert.deepEqual(levels(name),['disk-image:warning'],name);
  for(const name of ['Game.part01.rar','fg-01.bin','setup-0.001','archive.7z','manual.pdf','song.mp3.zip','file.tar.gz','setup.part1.exe.txt'])assert.deepEqual(levels(name),[],name);
  assert.equal(extensionOf('archive.TAR.GZ. '),'gz');
});

test('a Windows program inside a document or media name is blocked',()=>{
  assert.deepEqual(contentReasons('statement.pdf','windows-program').map(item=>item.level),['blocked']);
  assert.deepEqual(contentReasons('clip.mp4','windows-program').map(item=>item.level),['blocked']);
  assert.deepEqual(contentReasons('bundle.zip','windows-program').map(item=>item.code),['archive-program']);
  for(const name of ['setup.exe','fg-01.bin','noextension','data.001'])assert.deepEqual(contentReasons(name,'windows-program'),[],name);
  assert.deepEqual(contentReasons('statement.pdf','pdf'),[]);
});

test('the overall verdict takes the most serious reason',()=>{
  const listed={label:'malware download sites',category:'malware'};
  assert.equal(assessDownload({filename:'a.zip',chain:[{host:'a.example',listed}]}).level,'blocked');
  assert.equal(assessDownload({filename:'setup.exe',insecure:true}).level,'blocked');
  assert.equal(assessDownload({filename:'notes.zip',insecure:true}).level,'warning');
  assert.equal(assessDownload({filename:'notes.zip'}).level,'ok');
  assert.equal(assessDownload({filename:'setup.exe'}).level,'warning');
  const chain=[{host:'a.example'},{host:'cdn.example'}];
  const redirected=assessDownload({filename:'notes.zip',chain});
  assert.equal(redirected.level,'ok');assert.match(redirected.reasons[0].message,/a\.example → cdn\.example/);
  assert.equal(assessDownload({filename:'notes.zip',virusTotal:[{status:'ok',kind:'domain',subject:'a.example',malicious:3}]}).level,'warning');
  assert.equal(assessDownload({filename:'notes.zip',virusTotal:[{status:'ok',kind:'domain',subject:'a.example',malicious:1}]}).level,'ok');
  assert.equal(assessDownload({filename:'notes.zip',virusTotal:[{status:'not-found'},{status:'ok',malicious:'9'}]}).level,'ok');
});

test('names come from the final address when the site sends none',()=>{
  assert.equal(nameFromURL('https://cdn.example/files/My%20Game.zip?x=1'),'My Game.zip');
  assert.equal(nameFromURL('https://cdn.example/'),'download');
  assert.equal(nameFromURL('https://cdn.example/%E0%A4%A'),'download');
  assert.equal(nameFromURL('https://cdn.example/a%00b%0A.zip'),'ab.zip');
});

test('a direct file is inspected with one ranged request and no cookies',async()=>{
  const {fetcher,calls}=fetcherFrom({'https://files.example/get/1':file()});
  const result=await inspectLink('https://files.example/get/1',{fetcher,referer:'https://page.example/private-account?token=synthetic-secret#hidden'});
  assert.equal(result.status,'ready');assert.equal(result.filename,'Setup.exe');assert.equal(result.size,123456);assert.equal(result.sniffed,'windows-program');
  assert.equal(calls.length,1);
  const {options}=calls[0];
  assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');
  assert.equal(options.headers.Range,`bytes=0-${SNIFF_BYTES-1}`);assert.equal(options.headers.Referer,'https://page.example/');
  assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['Accept-Encoding'],'identity');
  assert.deepEqual(result.chain.map(hop=>hop.host),['files.example']);
});

test('redirects are followed one hop at a time and recorded',async()=>{
  const {fetcher,calls}=fetcherFrom({
    'https://short.example/x':redirect('https://mid.example/y'),
    'https://mid.example/y':redirect('/z',307),
    'https://mid.example/z':redirect('https://cdn.example/file.zip',301),
    'https://cdn.example/file.zip':file(Buffer.from([0x50,0x4b,3,4]),{'content-disposition':'attachment; filename="file.zip"','content-range':'bytes 0-3/999'})
  });
  const result=await inspectLink('https://short.example/x',{fetcher,referer:'https://page.example/account?private=synthetic-secret#hidden'});
  assert.equal(result.status,'ready');assert.equal(result.url,'https://cdn.example/file.zip');assert.equal(result.sourceUrl,'https://short.example/x');
  assert.deepEqual(result.chain.map(hop=>hop.host),['short.example','mid.example','mid.example','cdn.example']);
  assert.equal(calls[0].options.headers.Referer,'https://page.example/');
  assert.ok(calls.slice(1).every(call=>call.options.headers.Referer===undefined),'the page address is not passed along a redirect chain');
});

test('listed, private and unencrypted destinations are never contacted',async()=>{
  const lookupHost=host=>host==='bad.example'?{category:'malware',label:'malware download sites'}:null;
  const listed=fetcherFrom({'https://start.example/a':redirect('https://sub.bad.example/payload.exe')});
  let result=await inspectLink('https://start.example/a',{fetcher:listed.fetcher,lookupHost:host=>host.endsWith('bad.example')?lookupHost('bad.example'):null});
  assert.equal(result.status,'blocked');assert.equal(listed.calls.length,1);assert.equal(result.chain.at(-1).listed.category,'malware');
  const first=fetcherFrom({});
  result=await inspectLink('https://bad.example/x',{fetcher:first.fetcher,lookupHost});
  assert.equal(result.status,'blocked');assert.equal(first.calls.length,0);
  for(const destination of ['https://192.168.1.1/admin','https://localhost/x','https://router.local/x','https://[::1]/x','https://10.0.0.8/file']){
    const local=fetcherFrom({'https://start.example/a':redirect(destination)});
    result=await inspectLink('https://start.example/a',{fetcher:local.fetcher});
    assert.equal(result.status,'blocked',destination);assert.equal(result.privateDestination,true);assert.equal(local.calls.length,1,destination);
  }
  const insecure=fetcherFrom({'https://start.example/a':redirect('http://plain.example/file.exe')});
  result=await inspectLink('https://start.example/a',{fetcher:insecure.fetcher});
  assert.equal(result.status,'manual');assert.equal(result.insecure,true);assert.equal(insecure.calls.length,1);
  const scheme=fetcherFrom({'https://start.example/a':redirect('file:///C:/Windows/system32/calc.exe')});
  result=await inspectLink('https://start.example/a',{fetcher:scheme.fetcher});
  assert.equal(result.status,'blocked');
  const rebinding=fetcherFrom({'https://start.example/a':()=>{throw new Error('Private network destination blocked.');}});
  result=await inspectLink('https://start.example/a',{fetcher:rebinding.fetcher});
  assert.equal(result.status,'blocked');assert.equal(result.privateDestination,true);
});

test('web pages, missing files and protected downloads are reported, not downloaded',async()=>{
  const cases=[
    [response('<!doctype html><title>Download</title>',{headers:{'content-type':'text/html; charset=utf-8'}}),'manual',/web page/],
    [response('<html><body>ad</body></html>',{headers:{'content-type':'application/octet-stream'}}),'manual',/web page/],
    [response(null,{status:404}),'unavailable',/not found/],
    [response(null,{status:410}),'unavailable',/not found/],
    [response(null,{status:403}),'manual',/only to your browser/],
    [response(null,{status:401}),'manual',/only to your browser/],
    [response(null,{status:429}),'manual',/busy/],
    [response(null,{status:500}),'manual',/HTTP 500/],
    [response(MZ,{headers:{'content-encoding':'gzip'}}),'manual',/compressed/],
    [response(MZ,{headers:{'content-disposition':'attachment; filename="unterminated.exe'}}),'manual',/invalid file name/],
    [redirect(''),'unavailable',/without a destination/]
  ];
  for(const [reply,status,message] of cases){
    const {fetcher}=fetcherFrom({'https://site.example/f':reply});
    const result=await inspectLink('https://site.example/f',{fetcher});
    assert.equal(result.status,status,String(message));assert.match(result.message,message);
  }
  assert.equal((await inspectLink('not a url',{fetcher:()=>{throw new Error('no');}})).status,'unavailable');
  assert.equal((await inspectLink('https://site.example/f',{fetcher:async()=>{throw new Error('ENOTFOUND');}})).status,'manual');
});

test('a plain 200 response reports its full length and the reader stops early',async()=>{
  let pulls=0,cancelled=false;
  const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1024).fill(0x41));if(pulls>100)controller.close();},cancel(){cancelled=true;}});
  const {fetcher}=fetcherFrom({'https://site.example/big.bin':new Response(body,{status:200,headers:{'content-length':'1048576','content-type':'application/octet-stream'}})});
  const result=await inspectLink('https://site.example/big.bin',{fetcher});
  assert.equal(result.status,'ready');assert.equal(result.size,1048576);assert.equal(result.filename,'big.bin');
  assert.ok(pulls<=6,`read ${pulls} chunks`);assert.equal(cancelled,true);
});

test('redirect loops stop after the hop limit',async()=>{
  const {fetcher,calls}=fetcherFrom({'https://loop.example/a':redirect('https://loop.example/b'),'https://loop.example/b':redirect('https://loop.example/a')});
  const result=await inspectLink('https://loop.example/a',{fetcher,maxHops:5});
  assert.equal(result.status,'unavailable');assert.match(result.message,/too many/);assert.equal(calls.length,6);
});

test('a browser download from a host that has shut down is not contacted, also after a redirect',async()=>{
  const {fetcher,calls}=fetcherFrom({'https://short.example/x':redirect('https://www.zippyshare.com/v/abc/file.html')});
  const viaRedirect=await inspectLink('https://short.example/x',{fetcher});
  assert.equal(viaRedirect.status,'unavailable');assert.match(viaRedirect.message,/^ZippyShare closed in March 2023/);
  assert.deepEqual(calls.map(call=>call.url),['https://short.example/x']);
  const direct=await inspectLink('https://letsupload.io/file/abc',{fetcher});
  assert.equal(direct.status,'unavailable');assert.match(direct.message,/^LetsUpload has shut down/);
  assert.equal(calls.length,1,'nothing more was requested');
});
