'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const P=require('../src/browser-extension/policy.js');
const protocol=require('../src/browser-protocol.cjs');
const mods=require('../src/mods.cjs');
const {BrowserBridge}=require('../src/browser-bridge.cjs');
const {DownloadManager}=require('../src/downloads.cjs');
const {createDownloadCleanup}=require('../src/download-cleanup.cjs');
const {MIN_PARALLEL_SIZE}=require('../src/parallel-download.cjs');

const EXTENSION=path.join(__dirname,'..','src','browser-extension');
const read=name=>fs.readFileSync(path.join(EXTENSION,name),'utf8');
const base=path.resolve(__dirname,'.mods-fixtures');fs.mkdirSync(base,{recursive:true});
// A scratch folder for one test. `closeFirst` stops whatever still writes into it before it is removed.
function scratch(t,closeFirst=async()=>{}){
  const root=fs.mkdtempSync(path.join(base,'case-'));
  t.after(async()=>{await closeFirst();assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return root;
}
const tick=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));

// A made-up mod, in the shapes each layer uses.
const GAME='skyrimspecialedition';
const PAGE_URL=`https://www.nexusmods.com/${GAME}/mods/12604`;
const FILE_URL=`${PAGE_URL}?tab=files&file_id=735025`;
const FILE_NAME='Simplified Chinese Patch-12604-1-1-1774443884.7z';
const CDN=`https://supporter-files.nexus-cdn.com/1704/12604/${encodeURIComponent(FILE_NAME)}?md5=abc&expires=1&user_id=2`;
// Newer uploads sit at an address without the game and mod numbers.
const NEWER_CDN=`https://files.nexus-cdn.com/8f14e45f-ceea-467f-9a36-dedd4bea2543/${encodeURIComponent(FILE_NAME)}?md5=abc&expires=1&user_id=2`;
// Another file of the same mod, or the same file under a newly signed link.
const cdnFile=(name,query='md5=abc&expires=1&user_id=2')=>`https://supporter-files.nexus-cdn.com/1704/12604/${encodeURIComponent(name)}?${query}`;
const SHOWN=Object.freeze({gameId:'1704',gameName:'Skyrim Special Edition',modName:'SkyUI',files:[{fileId:'735025',fileName:'Simplified Chinese Patch',fileUri:FILE_NAME}]});
const LABEL=Object.freeze({site:'nexusmods',game:GAME,modId:12604,gameId:1704,fileId:735025,gameName:'Skyrim Special Edition',modName:'SkyUI',fileName:'Simplified Chinese Patch'});
const NOW=1700000000000;
const noted=(details=SHOWN,url=FILE_URL,at=NOW-1000)=>({...P.nexusPage(details,P.nexusAddress(url)),at});

// ---------- what the extension decides ----------
test('a Nexus Mods address gives its game, mod and file, and nothing else passes for one',()=>{
  assert.deepEqual(P.nexusAddress(PAGE_URL),{game:GAME,modId:12604});
  assert.deepEqual(P.nexusAddress(FILE_URL),{game:GAME,modId:12604,fileId:735025});
  assert.deepEqual(P.nexusAddress(`${PAGE_URL}/?tab=posts#top`),{game:GAME,modId:12604});
  assert.deepEqual(P.nexusAddress('https://www.nexusmods.com/games/stardewvalley/mods/1915'),{game:'stardewvalley',modId:1915},'the newer address form');
  assert.deepEqual(P.nexusAddress('https://WWW.NexusMods.com/Fallout4/mods/7'),{game:'fallout4',modId:7});
  assert.deepEqual(P.nexusAddress(`${PAGE_URL}?file_id=abc`),{game:GAME,modId:12604},'a file number that is not a number is left out');
  assert.deepEqual(P.nexusAddress(`${PAGE_URL}?file_id=0`),{game:GAME,modId:12604});
  for(const url of [
    'http://www.nexusmods.com/skyrim/mods/1','https://nexusmods.com/skyrim/mods/1','https://users.nexusmods.com/skyrim/mods/1',
    'https://www.nexusmods.com.evil.example/skyrim/mods/1','https://evil.example/www.nexusmods.com/skyrim/mods/1','https://www.nexusmods.com@evil.example/skyrim/mods/1',
    'https://user:pass@www.nexusmods.com/skyrim/mods/1','https://user@www.nexusmods.com/skyrim/mods/1','https://:pass@www.nexusmods.com/skyrim/mods/1','https://www.nexusmods.com:8443/skyrim/mods/1','https://www.nexusmods.com:443x/skyrim/mods/1',
    'https://www.nexusmods.com/','https://www.nexusmods.com/skyrim','https://www.nexusmods.com/skyrim/mods','https://www.nexusmods.com/skyrim/mods/','https://www.nexusmods.com/skyrim/mods/abc',
    'https://www.nexusmods.com/skyrim/mods/0','https://www.nexusmods.com/skyrim/mods/99999999999','https://www.nexusmods.com/skyrim/mods/1/files','https://www.nexusmods.com/skyrim/images/1',
    'https://www.nexusmods.com/sky%20rim/mods/1','https://www.nexusmods.com//mods/1','https://www.nexusmods.com/a/b/mods/1',`https://www.nexusmods.com/${'a'.repeat(65)}/mods/1`,
    'javascript:alert(1)','not a url','',null,undefined,42,{},`https://www.nexusmods.com/skyrim/mods/1?${'x'.repeat(8200)}`
  ])assert.equal(P.nexusAddress(url),null,String(url).slice(0,80));
});

test('text read from a page is cleaned before it goes anywhere',()=>{
  assert.equal(P.nexusText('  Sky\tUI \n  5.2  ',200),'Sky UI 5.2');
  assert.equal(P.nexusText('Sky\u0000UI\u007f\u0085',200),'Sky UI','control characters');
  assert.equal(P.nexusText('gnp.exe\u202e\u2066\u2069\u200f\u200e\u061cSafe',200),'gnp.exe Safe','characters that reverse or hide text');
  assert.equal(P.nexusText('zero\u200bwidth\ufeffjoin\u2060ed',200),'zero width join ed');
  assert.equal(P.nexusText('line\u2028break\u2029s',200),'line break s');
  assert.equal(P.nexusText('soft\u00adhyphen tag\udb40\udc41s private\ue000use sep\u180eend',200),'soft hyphen tag s private use sep end','every invisible character class, not a hand-picked list');
  // Every character of the invisible and control classes is removed.
  for(const range of [[0x00,0x1f],[0x7f,0x9f],[0x200b,0x200f],[0x202a,0x202e],[0x2060,0x2064],[0x2066,0x206f],[0xe000,0xe010],[0xfff9,0xfffb],[0xe0020,0xe007f]])
    for(let code=range[0];code<=range[1];code++)assert.equal(P.nexusText(`a${String.fromCodePoint(code)}b`,10),'a b',`U+${code.toString(16)}`);
  assert.equal(P.nexusText('\u0633\u0643\u0627\u064a \u0631\u064a\u0645 \u2014 \u4e2d\u6587 \u2014 \ud83d\ude00',200),'\u0633\u0643\u0627\u064a \u0631\u064a\u0645 \u2014 \u4e2d\u6587 \u2014 \ud83d\ude00','Arabic, Chinese and emoji are kept');
  assert.equal(P.nexusText('half \ud83d pair \ude00 end',200),'half pair end','broken pairs are dropped');
  assert.equal(P.nexusText('abc\ud83d\ude00',4),'abc','a cut never leaves half a character');
  assert.equal(P.nexusText('abcdef',3),'abc');assert.equal(P.nexusText('ab   ',2),'ab');assert.equal(P.nexusText('a b',2),'a','no space is left at the end of a cut');
  assert.equal(P.nexusText('x'.repeat(100000),50).length,50);
  for(const value of ['','   ','\u200b\u202e',null,undefined,5,{},[],true])assert.equal(P.nexusText(value,10),undefined);
  assert.equal(P.nexusText(' '.repeat(3999)+'kept',10),'k','only the first 4,000 characters are looked at');assert.equal(P.nexusText(' '.repeat(4000)+'late',10),undefined);
  // Characters that no version of Unicode has assigned, and the object placeholder, show as boxes or as nothing.
  for(const code of [0x378,0xfdd0,0xfffe,0xffff,0xfffc,0x1fffe,0x10ffff])assert.equal(P.nexusText(`a${String.fromCodePoint(code)}b`,10),'a b',`U+${code.toString(16)}`);
  // Marks that sit on the letter before them: three in a row at most, and none in front of the name.
  const acute=String.fromCharCode(0x301),hook=String.fromCharCode(0x309);
  assert.equal(P.nexusText('e'+acute,10),'e'+acute);assert.equal(P.nexusText('e'+acute+hook+acute,10),'e'+acute+hook+acute);
  assert.equal(P.nexusText('Z'+acute.repeat(40)+'algo',50),'Z'+acute.repeat(3)+'algo','a pile of marks would cover the lines above and below');
  assert.equal(P.nexusText('a'+acute.repeat(4)+'b'+hook.repeat(9)+acute,50),'a'+acute.repeat(3)+'b'+hook.repeat(3));
  assert.equal(P.nexusText(acute+'abc',10),'abc','a mark in front would sit on whatever stands before the name');
  assert.equal(P.nexusText(' '+acute+' '+hook+acute+' abc',10),'abc');assert.equal(P.nexusText(acute.repeat(3),10),undefined);assert.equal(P.nexusText(acute+' '+hook,10),undefined);
  assert.equal(P.nexusText('ab '+acute+'c',10),'ab '+acute+'c','a mark after a space inside the text is left alone');
  assert.equal(P.nexusText('ab'+acute.repeat(9),4),'ab'+acute.repeat(2),'the limit on length still holds');
  assert.equal(P.nexusId('735025'),735025);assert.equal(P.nexusId(12),12);assert.equal(P.nexusId('1'),1);assert.equal(P.nexusId('2147483647'),2147483647);assert.equal(P.nexusId(2147483647),2147483647);assert.equal(P.nexusId('0000000001'),1);
  for(const value of ['0','-1','1.5','1e3',' 5','5 ','0x10','99999999999','\uff15',0,-1,1.5,2147483648,NaN,Infinity,null,undefined,'',{},[5]])assert.equal(P.nexusId(value),undefined,String(value));
});

test('file names are compared without case, punctuation or folders, and a browser’s copy number is tried second',()=>{
  const key=P.nexusKey(FILE_NAME);
  assert.equal(key,'simplified chinese patch 12604 1 1 1774443884 7z');
  for(const name of [FILE_NAME.toUpperCase(),`C:\\Users\\Player\\Downloads\\${FILE_NAME}`,`/home/player/Downloads/${FILE_NAME}`,FILE_NAME.replace(/ /g,'_'),`Simplified  Chinese${String.fromCodePoint(0xa0)}Patch-12604-1-1-1774443884.7z`])
    assert.equal(P.nexusKey(name),key,name);
  assert.notEqual(P.nexusKey(FILE_NAME.replace('1774443884','1774443885')),key);
  assert.notEqual(P.nexusKey(FILE_NAME.replace('.7z','.zip')),key);
  assert.equal(P.nexusKey(`${String.fromCodePoint(0xff33,0xff4b,0xff59)}UI-1.7z`),P.nexusKey('SkyUI-1.7z'),'full-width letters compare equal to plain ones');
  assert.equal(P.nexusKey('\u0645\u0648\u062f \u0639\u0631\u0628\u064a-1.zip'),'\u0645\u0648\u062f \u0639\u0631\u0628\u064a 1 zip','names in other scripts keep their letters');
  // The " (1)" or "(12)" a browser adds to a second copy is part of the name as it stands; the loose form drops it.
  for(const copy of [FILE_NAME.replace('.7z',' (1).7z'),FILE_NAME.replace('.7z','(12).7z'),`C:\\Users\\Player\\Downloads\\${FILE_NAME.replace('.7z',' (123).7z')}`]){
    assert.notEqual(P.nexusKey(copy),key,copy);assert.equal(P.nexusLooseKey(copy),key,copy);
  }
  assert.equal(P.nexusLooseKey(FILE_NAME),key,'a name without a copy number is unchanged');
  assert.equal(P.nexusLooseKey('Mod(1).tar.gz'),P.nexusKey('Mod.tar.gz'));assert.equal(P.nexusLooseKey('Mod.tar (1).gz'),P.nexusKey('Mod.tar.gz'),'before one ending or two');
  assert.equal(P.nexusLooseKey('Mod (2) Patch-1-0.7z'),'mod 2 patch 1 0 7z','a number in brackets inside the name is kept');
  assert.equal(P.nexusLooseKey('a (1234).7z'),'a 1234 7z','four digits are not a copy number');
  assert.equal(P.nexusLooseKey('a (123).7z'),'a 7z');assert.equal(P.nexusLooseKey('MOD (1).ZIP'),'mod zip');assert.equal(P.nexusLooseKey('a (1).x.y.z'),'a 1 x y z','three endings are a name, not endings');
  assert.equal(P.nexusLooseKey('a (1).abcdefgh'),'a abcdefgh');assert.equal(P.nexusLooseKey('a (1).abcdefghi'),'a 1 abcdefghi','nor is something that long an ending');
  assert.equal(P.nexusLooseKey('a  (1).7z'),'a 7z');assert.equal(P.nexusLooseKey('a (1) .7z'),'a 1 7z');assert.equal(P.nexusLooseKey('a (1)'),'a');assert.equal(P.nexusLooseKey('(2).7z'),'7z');
  for(const value of ['','...','---',null,undefined]){assert.equal(P.nexusKey(value),'');assert.equal(P.nexusLooseKey(value),'');}
});

test('what a page says is kept only in cleaned form, under the game and mod of its address',()=>{
  const FULL={game:GAME,modId:12604,files:[{fileId:735025,key:P.nexusKey(FILE_NAME),fileName:'Simplified Chinese Patch'}],gameId:1704,gameName:'Skyrim Special Edition',modName:'SkyUI'};
  const BARE={game:GAME,modId:12604,files:[]};
  assert.deepEqual(noted(),{...FULL,at:NOW-1000});
  // The page cannot name a different game, or add fields of its own.
  const lying=P.nexusPage({...SHOWN,game:'fallout4',site:'evil',extra:'x',at:5,files:[{...SHOWN.files[0],key:'forged',note:'x'}]},P.nexusAddress(PAGE_URL));
  assert.deepEqual(lying,FULL);
  // The site can change its address a moment before it changes what it shows. While the page
  // itself says it is another mod's page, its names and files are left out: only the address counts.
  const page=extra=>P.nexusPage({...SHOWN,...extra},P.nexusAddress(PAGE_URL));
  assert.deepEqual(page({modId:'12604',canonical:PAGE_URL}),FULL,'page and address agree');
  assert.deepEqual(page({modId:'12604'}),FULL);assert.deepEqual(page({modId:12604}),FULL);assert.deepEqual(page({canonical:`${PAGE_URL}?tab=description`}),FULL);
  assert.deepEqual(page({modId:'999'}),BARE,'the page says it is mod 999');
  assert.deepEqual(page({modId:999,canonical:PAGE_URL}),BARE);
  assert.deepEqual(page({canonical:'https://www.nexusmods.com/skyrimspecialedition/mods/999'}),BARE,'the page’s own address line names another mod');
  assert.deepEqual(page({canonical:'https://www.nexusmods.com/fallout4/mods/12604'}),BARE,'the same number in another game is another mod');
  assert.deepEqual(page({modId:'12604',canonical:'https://www.nexusmods.com/fallout4/mods/12604'}),BARE);
  // Without either sign, nothing contradicts the address.
  for(const extra of [{},{modId:''},{modId:'abc'},{modId:'0'},{modId:null},{canonical:''},{canonical:'https://evil.example/skyrimspecialedition/mods/999'},{canonical:'not an address'},{canonical:42}])assert.deepEqual(page(extra),FULL,JSON.stringify(extra));
  // Hostile or broken details shrink to what is usable.
  const messy=P.nexusPage({gameId:'abc',gameName:'\u202eevil  name'.padEnd(400,'x'),modName:42,files:[null,'x',{fileId:'1'},{fileUri:'a.zip'},{fileId:'2',fileUri:'...'},{fileId:'3',fileUri:'ok.zip',fileName:{}},...Array.from({length:40},(_,i)=>({fileId:String(100+i),fileUri:`f${i}.zip`}))]},P.nexusAddress(PAGE_URL));
  assert.equal(messy.gameId,undefined);assert.equal(messy.modName,undefined);assert.equal(messy.gameName.length,100);assert.ok(messy.gameName.startsWith('evil name'));
  assert.equal(messy.files.length,15,'only the first twenty entries are read, and unusable ones are dropped');assert.deepEqual(messy.files[0],{fileId:3,key:'ok zip'});
  const long=P.nexusPage({modName:'m'.repeat(500),files:[{fileId:'1',fileName:'f'.repeat(500),fileUri:'a.zip'}]},P.nexusAddress(PAGE_URL));
  assert.equal(long.modName.length,200);assert.equal(long.files[0].fileName.length,200);
  assert.doesNotThrow(()=>mods.modContext({site:'nexusmods',game:long.game,modId:long.modId,modName:long.modName,fileName:long.files[0].fileName}),'cut to exactly what the app accepts');
  assert.deepEqual(P.nexusPage({},P.nexusAddress(PAGE_URL)),BARE,'a mod page that shows no file is still noted');
  for(const [details,address] of [[SHOWN,null],[SHOWN,undefined],[null,P.nexusAddress(PAGE_URL)],[undefined,P.nexusAddress(PAGE_URL)],['x',P.nexusAddress(PAGE_URL)],[5,P.nexusAddress(PAGE_URL)],[SHOWN,{}],[SHOWN,{game:GAME}],[SHOWN,{modId:12604}]])assert.equal(P.nexusPage(details,address),null);
});

test('a download is labelled only when it comes from Nexus Mods’ file servers and the evidence points at one mod',()=>{
  const item={url:CDN,referrer:'https://www.nexusmods.com/',filename:FILE_NAME};
  const pages=[noted()];
  assert.deepEqual(P.nexusMatch(item,pages,NOW),LABEL,'the file name a Nexus Mods file page showed');
  assert.deepEqual(P.nexusMatch({...item,url:NEWER_CDN,filename:`C:\\Users\\P\\Downloads\\${FILE_NAME.replace('.7z',' (1).7z')}`},pages,NOW),LABEL,'a second copy of it, at an address where only the name can find the page');
  assert.deepEqual(P.nexusMatch({url:'https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=735025',finalUrl:CDN,filename:FILE_NAME},pages,NOW),LABEL,'a download that began on the site and was handed to a file server');
  assert.deepEqual(P.nexusMatch({url:NEWER_CDN,finalUrl:CDN,filename:FILE_NAME},pages,NOW),LABEL,'or was handed from one file server to another');
  // A download that began on another site and only ended up on a file server is not labelled.
  for(const first of ['https://short.example/x','http://www.nexusmods.com/x','https://nexusmods.com/x','https://users.nexusmods.com/x','https://www.nexusmods.com.example.com/x','https://example.com/www.nexusmods.com/x','http://supporter-files.nexus-cdn.com/x',42,undefined,''])
    assert.equal(P.nexusMatch({url:first,finalUrl:CDN,filename:FILE_NAME},pages,NOW),null,String(first));
  assert.deepEqual(P.nexusMatch({url:CDN,filename:FILE_NAME},pages,NOW),LABEL,'which page started it does not matter');
  assert.deepEqual([...P.NEXUS_FILE_ROOTS],['nexus-cdn.com']);
  // A file kept anywhere else is never a Nexus Mods file, whatever its name and whichever page linked to it.
  for(const elsewhere of [
    {url:`https://mirror.example/${FILE_NAME}`,referrer:'https://mirror.example/'},
    {url:`https://evil.example/${FILE_NAME}`,referrer:'https://www.nexusmods.com/'},
    {url:'https://evil.example/setup.exe',referrer:FILE_URL},
    {url:`https://nexus-cdn.com.evil.example/1704/12604/${FILE_NAME}`},
    {url:`https://evilnexus-cdn.com/1704/12604/${FILE_NAME}`},
    {url:`https://www.nexusmods.com/1704/12604/${FILE_NAME}`,referrer:FILE_URL},
    {url:`https://forums.nexusmods.com/files/${FILE_NAME}`,referrer:'https://www.nexusmods.com/'},
    {url:CDN.replace('https:','http:'),referrer:'https://www.nexusmods.com/'},
    {url:CDN,finalUrl:`https://mirror.example/${FILE_NAME}`},
    {url:`https://supporter-files.nexus-cdn.com@evil.example/1704/12604/${FILE_NAME}`}
  ])assert.equal(P.nexusMatch({filename:FILE_NAME,...elsewhere},pages,NOW),null,JSON.stringify(elsewhere));
  // What a page showed is used for half an hour, and never from the future.
  assert.equal(P.NEXUS_PAGE_MS,30*60*1000);
  const unnumbered={url:NEWER_CDN,filename:FILE_NAME};
  assert.deepEqual(P.nexusMatch(unnumbered,pages,NOW),LABEL,'a newer address carries no numbers: the name alone finds the page');
  assert.deepEqual(P.nexusMatch(unnumbered,[noted(SHOWN,FILE_URL,NOW-P.NEXUS_PAGE_MS+1)],NOW),LABEL);
  for(const at of [NOW-P.NEXUS_PAGE_MS,NOW-P.NEXUS_PAGE_MS-1,NOW+1,NaN,undefined])assert.equal(P.nexusMatch(unnumbered,[{...noted(),at}],NOW),null,String(at));
  // With no matching name, the game and mod numbers in an older file address find the page.
  const other={...item,filename:'renamed.7z'},MOD_ONLY=(({fileId,fileName,...rest})=>rest)(LABEL);
  assert.deepEqual(P.nexusMatch(other,pages,NOW),MOD_ONLY,'the numbers name the mod; which of its files this is, they do not say');
  assert.equal(P.nexusMatch({...other,url:CDN.replace('/12604/','/12605/')},pages,NOW),null,'a different mod number is not this mod');
  assert.equal(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/')},pages,NOW),null,'the same mod number under another game number is another mod');
  assert.equal(P.nexusMatch({...item,url:CDN.replace('/1704/','/9999/')},pages,NOW),null,'even under a file name the page showed');
  assert.equal(P.nexusMatch({...item,url:CDN.replace('/12604/','/12605/')},pages,NOW),null);
  assert.deepEqual(P.nexusMatch({...item,url:CDN.replace('/1704/','/9999/')},[noted({...SHOWN,gameId:''})],NOW),(({gameId,...rest})=>rest)(LABEL),'a page that did not say its game number can still be found by the file name');
  assert.equal(P.nexusMatch({...other,url:'https://supporter-files.nexus-cdn.com/x/1704/12604/renamed.7z'},pages,NOW),null,'numbers deeper in the address are not game and mod numbers');
  assert.equal(P.nexusMatch({...other,url:'https://supporter-files.nexus-cdn.com/1704/12604/sub/renamed.7z'},pages,NOW),null,'nor numbers in front of a longer path');
  assert.equal(P.nexusMatch({...other,url:'https://supporter-files.nexus-cdn.com/1704/12604/'},pages,NOW),null);
  assert.equal(P.nexusMatch({...other,url:'https://supporter-files.nexus-cdn.com/8f14e45f-ceea-467f-9a36-dedd4bea2543/file.7z'},pages,NOW),null,'newer addresses carry no numbers');
  assert.deepEqual(P.nexusMatch(other,[noted({...SHOWN,files:[]},PAGE_URL)],NOW),MOD_ONLY,'the mod is known, the file is not');
  assert.deepEqual(P.nexusMatch(other,[noted({...SHOWN,files:[SHOWN.files[0],{fileId:'9',fileUri:'second.7z'}]})],NOW),MOD_ONLY,'with two files on show, the file is not guessed');
  assert.deepEqual(P.nexusMatch({...item,filename:'Optional Textures-12604-2-0.7z'},pages,NOW),MOD_ONLY,'nor with one: another file of the mod is not the one the page showed');
  assert.equal(P.nexusMatch(other,[noted({...SHOWN,gameId:''})],NOW),null,'a page that did not say its game number cannot be found by numbers');
  // A name that matches a page of a different mod than the numbers in the address says is not used.
  const elsewhere=noted({gameId:'1151',gameName:'Fallout 4',modName:'Another Mod',files:[{fileId:'5',fileUri:FILE_NAME}]},'https://www.nexusmods.com/fallout4/mods/77?file_id=5',NOW-10);
  assert.deepEqual(P.nexusMatch(item,[elsewhere,noted()],NOW),LABEL,'the numbers in the file’s address settle which page it is');
  assert.equal(P.nexusMatch(item,[elsewhere],NOW),null);
  // Without numbers in the address, the same file name on pages of two mods says nothing: no label, whichever was looked at last.
  assert.equal(P.nexusMatch(unnumbered,[noted(),elsewhere],NOW),null);
  assert.equal(P.nexusMatch(unnumbered,[elsewhere,{...noted(),at:NOW-5}],NOW),null);
  assert.equal(P.nexusMatch(unnumbered,[elsewhere],NOW).modName,'Another Mod','one page, one answer');
  // The name as it stands is tried first, then without a browser's copy number.
  assert.deepEqual(P.nexusMatch({...unnumbered,filename:FILE_NAME.replace('.7z',' (1).7z')},pages,NOW),LABEL,'a second copy, known by nothing but its name');
  const bracketed=noted({...SHOWN,files:[{fileId:'1',fileName:'First',fileUri:'Patch.7z'},{fileId:'2',fileName:'Second',fileUri:'Patch (2).7z'}]});
  assert.equal(P.nexusMatch({...unnumbered,filename:'Patch (2).7z'},[bracketed],NOW).fileId,2,'a file whose real name ends in a number in brackets is that file');
  assert.equal(P.nexusMatch({...unnumbered,filename:'Patch (3).7z'},[bracketed],NOW).fileId,1,'and a copy of the other one is the other one');
  assert.equal(P.nexusMatch({...unnumbered,filename:'Patch (2).7z'},[noted({...SHOWN,files:[{fileId:'2',fileName:'Second',fileUri:'Patch (2).7z'}]})],NOW).fileId,2);
  assert.equal(P.nexusMatch({url:NEWER_CDN},[{...noted(),files:[{fileId:9,key:'',fileName:'Nameless'}]}],NOW),null,'a download without a name matches no file');
  // Two tabs on the same mod agree; the one looked at last is used.
  assert.equal(P.nexusMatch(unnumbered,[noted({...SHOWN,modName:'Old name'},FILE_URL,NOW-60000),noted(SHOWN,FILE_URL,NOW-10)],NOW).modName,'SkyUI');
  assert.equal(P.nexusMatch(unnumbered,[noted(SHOWN,FILE_URL,NOW-10),noted({...SHOWN,modName:'Old name'},FILE_URL,NOW-60000)],NOW).modName,'SkyUI');
  // When the browser passes on the full address of the page that started the download, that page's mod is the one.
  assert.deepEqual(P.nexusMatch({...unnumbered,referrer:FILE_URL},[elsewhere,noted()],NOW),LABEL);
  assert.equal(P.nexusMatch({...unnumbered,referrer:'https://www.nexusmods.com/fallout4/mods/77?file_id=5'},[elsewhere,noted()],NOW).modName,'Another Mod');
  assert.equal(P.nexusMatch({...unnumbered,referrer:'https://www.nexusmods.com/fallout4/mods/78'},[elsewhere,noted()],NOW),null,'the name is on other mods’ pages, not on the one that started it');
  assert.deepEqual(P.nexusMatch({...item,referrer:FILE_URL,filename:'other.7z'},[elsewhere,noted()],NOW),LABEL,'its file number names the file');
  assert.deepEqual(P.nexusMatch({...item,referrer:PAGE_URL,filename:FILE_NAME},[noted({...SHOWN,files:[{fileId:'1',fileUri:'other.7z'},SHOWN.files[0]]})],NOW),LABEL,'or the file’s name does');
  assert.deepEqual(P.nexusMatch({...item,referrer:FILE_URL},[],NOW),{site:'nexusmods',game:GAME,modId:12604,fileId:735025},'with no note, the address alone gives the numbers');
  assert.deepEqual(P.nexusMatch({...unnumbered,referrer:PAGE_URL,filename:'x.7z'},[],NOW),{site:'nexusmods',game:GAME,modId:12604});
  assert.deepEqual(P.nexusMatch({...unnumbered,referrer:PAGE_URL,filename:'x.7z'},[noted({...SHOWN,gameName:'Fallout 4',modName:'Other'},'https://www.nexusmods.com/fallout4/mods/12604')],NOW),{site:'nexusmods',game:GAME,modId:12604},'the same mod number in another game is another mod');
  assert.equal(P.nexusMatch({...unnumbered,referrer:PAGE_URL,filename:'x.7z'},[noted({...SHOWN,modName:'Old name',files:[]},PAGE_URL,NOW-60000),noted({...SHOWN,files:[]},PAGE_URL,NOW-10)],NOW).modName,'SkyUI','the newest note of that mod');
  assert.equal(P.nexusMatch({...item,referrer:'https://www.nexusmods.com/fallout4/mods/77'},[elsewhere,noted()],NOW),null,'a starting page and file numbers that name different mods cancel out');
  assert.equal(P.nexusMatch({...item,filename:'other.7z',referrer:'https://www.nexusmods.com/fallout4/mods/77'},[elsewhere],NOW),null,'also when no page lists the file');
  assert.equal(P.nexusMatch({...item,filename:'other.7z',referrer:'https://www.nexusmods.com/fallout4/mods/77'},[],NOW),null);
  // The starting page's own note says which game its mod belongs to. A file address with another game's number is another game's mod of that number.
  assert.equal(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},pages,NOW),null);
  assert.equal(P.nexusMatch({...item,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},pages,NOW),null,'even under a file name the page showed');
  assert.equal(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},[noted(SHOWN,FILE_URL,NOW-60000),noted({...SHOWN,gameId:'9999'},FILE_URL,NOW-10)],NOW),null,'two notes of the page that disagree: no label');
  assert.deepEqual(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},[noted({...SHOWN,gameId:''})],NOW),(({gameId,...rest})=>rest)(LABEL),'a note that does not say its game number does not contradict the address');
  assert.deepEqual(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},[],NOW),{site:'nexusmods',game:GAME,modId:12604,fileId:735025},'and with no note there is nothing to contradict it');
  assert.deepEqual(P.nexusMatch({...other,url:CDN.replace('/1704/','/9999/'),referrer:FILE_URL},[noted(SHOWN,FILE_URL,NOW-P.NEXUS_PAGE_MS)],NOW),{site:'nexusmods',game:GAME,modId:12604,fileId:735025},'a note that is too old counts for nothing, either way');
  // Broken input never throws and never labels by accident.
  for(const bad of [[null,pages],[item,null],['x',pages],[{},pages],[{url:42},pages],[unnumbered,[null,'x',{},{files:'x',at:NOW},{...noted(),game:''},{...noted(),modId:0},{...noted(),files:'x'},{...noted(),files:null},{...noted(),at:String(NOW-1000)},{...noted(),at:null}]]])assert.equal(P.nexusMatch(bad[0],bad[1],NOW),null);
  assert.deepEqual(P.nexusMatch(item,[{...noted(),files:[null,'x',{key:5},7]}],NOW),{site:'nexusmods',game:GAME,modId:12604,gameId:1704,gameName:'Skyrim Special Edition',modName:'SkyUI'},'unusable file entries in a stored note are skipped, not tripped over');
});

test('the capture message carries the label only for Nexus Mods files, and the app accepts everything the extension can send',()=>{
  const on={capture:true},context={pages:[noted()],now:NOW};
  const item={id:1,url:CDN,referrer:'https://www.nexusmods.com/',filename:`C:\\Users\\Player\\Downloads\\${FILE_NAME}`,totalBytes:3072};
  const bare={type:'capture',url:CDN,incognito:false,referrer:'https://www.nexusmods.com/',filename:FILE_NAME,totalBytes:3072};
  const plan=P.downloadPlan(item,on,context);
  assert.deepEqual(plan,{kind:'ask',message:{...bare,mod:LABEL}});
  assert.deepEqual(P.downloadPlan(item,{capture:true,nexus:false},context),{kind:'ask',message:bare},'the switch turns labels off, and nothing else');
  assert.deepEqual(P.downloadPlan(item,{capture:true,nexus:true},context).message.mod,LABEL);
  assert.equal(P.downloadPlan(item,on).message.mod,undefined);assert.equal(P.downloadPlan(item,on,{}).message.mod,undefined);assert.equal(P.downloadPlan(item,on,{pages:'x'}).message.mod,undefined);
  assert.equal(P.downloadPlan(item,on,{pages:[noted()],now:'soon'}).message.mod,undefined,'without a usable clock no note counts as recent');
  assert.deepEqual(P.downloadPlan({...item,incognito:true},on,context),{kind:'ignore'},'private windows are never captured');
  assert.deepEqual(P.downloadPlan(item,{capture:false},context),{kind:'ignore'});
  assert.equal(P.downloadPlan({id:2,url:'https://cdn.example/game.zip',filename:'game.zip'},on,context).message.mod,undefined);
  // The address the browser ended up at is the one that counts, in both directions.
  assert.deepEqual(P.downloadPlan({id:3,url:'https://www.nexusmods.com/x',finalUrl:CDN,filename:FILE_NAME},on,context).message.mod,LABEL);
  assert.equal(P.downloadPlan({id:3,url:'https://short.example/x',finalUrl:CDN,filename:FILE_NAME},on,context).message.mod,undefined,'a download that began on another site');
  assert.equal(P.downloadPlan({id:4,url:CDN,finalUrl:`https://mirror.example/${FILE_NAME}`,filename:FILE_NAME},on,context).message.mod,undefined);
  // A file whose address carries no numbers is found by its name, which the plan passes on without the folders in front of it.
  assert.deepEqual(P.downloadPlan({id:5,url:NEWER_CDN,filename:`C:\\Users\\Player\\Downloads\\${FILE_NAME}`},on,context).message.mod,LABEL);
  assert.equal(P.downloadPlan({id:6,url:NEWER_CDN,filename:'unknown.7z'},on,context).message.mod,undefined);
  assert.deepEqual(protocol.validateRequest({v:1,...plan.message}).mod,LABEL);
  assert.ok(!JSON.stringify(plan).includes('Player'),'no local path leaves the browser');
  // The label is an extra. A stored note that cannot even be read costs the label, never the check of the download.
  const unreadable=new Proxy({},{get(){throw new Error('unreadable');}});
  assert.throws(()=>P.nexusMatch({url:CDN,filename:FILE_NAME},[unreadable],NOW),/unreadable/);
  assert.deepEqual(P.downloadPlan(item,on,{pages:[unreadable],now:NOW}),{kind:'ask',message:bare});
  // Whatever a page says, the label the extension builds from it is one the app accepts.
  const nasty=['','  ','\u202e\u0000','a'.repeat(5000),'\ud83d','<img src=x onerror=alert(1)>','..\\..\\Windows','CON','\u0633\u0643\u0627\u064a\u0631\u064a\u0645','  padded  name  ','a\tb\nc',42,null,{},[],'9'.repeat(30),'-5','735025','\u3164\u2800','vs\ufe0f'];
  // The same download twice: once known only by its name and numbers, once started from the mod's own address.
  const direct={...item,url:NEWER_CDN,referrer:FILE_URL};
  let byEvidence=0,byAddress=0;
  for(let round=0;round<400;round++){
    const pick=offset=>nasty[(round*7+offset*13)%nasty.length];
    const details={gameId:round%5?'1704':pick(1),gameName:pick(2),modName:pick(3),files:[{fileId:round%3?'735025':pick(4),fileName:pick(5),fileUri:round%2?FILE_NAME:pick(6)}]};
    const page=P.nexusPage(details,P.nexusAddress(FILE_URL)),seen={pages:[{...page,at:NOW-5}],now:NOW};
    for(const candidate of [item,direct]){
      const message=P.downloadPlan(candidate,on,seen).message;
      assert.doesNotThrow(()=>protocol.validateRequest({v:1,...message}),JSON.stringify(details).slice(0,200));
      if(!message.mod)continue;
      assert.equal(message.mod.game,GAME);assert.equal(message.mod.modId,12604);
      if(candidate===item)byEvidence++;else byAddress++;
    }
  }
  assert.equal(byAddress,400,'a download started from the mod’s own address is always labelled');
  assert.ok(byEvidence>=250,`the cases above do reach the label through the file’s name and numbers (${byEvidence} of 400)`);
});

// ---------- the page script ----------
// What the page script sends for the made-up file page below.
const REPORTED_URL=`${PAGE_URL}?file_id=735025`;
const ON_PAGE=Object.freeze({...SHOWN,modId:'12604',canonical:PAGE_URL});
// nexus.js run against a fake page, with a clock the test moves by hand.
function nexusPageScript({url=FILE_URL,top=true,enabled=true,visible=true,incognito=false,storageFails=false}={}){
  let now=NOW,sequence=0;
  const timers=new Map(),sent=[],listeners={document:{},window:{},storage:[]};
  const page={url,title:'SkyUI',site:'Nexus Mods :: Skyrim Special Edition',canonical:PAGE_URL,section:{'data-game-id':'1704','data-mod-id':'12604'},
    boxes:[{'file-id':'735025',filename:'Simplified Chinese Patch','file-uri':FILE_NAME,'game-id':'1704','game-name':'Skyrim Special Edition'}],
    visible,prerendering:false,reply:{ok:true},reject:false,throws:false,orphaned:false};
  const element=attributes=>attributes?{getAttribute:name=>Object.hasOwn(attributes,name)?attributes[name]:null}:null;
  const reads=[];
  const document={
    get visibilityState(){return page.visible?'visible':'hidden';},
    get prerendering(){return page.prerendering;},
    querySelector(selector){
      reads.push(selector);
      if(selector==='#section[data-game-id]')return element(page.section);
      if(selector==='meta[property="og:site_name"]')return page.site===null?null:element({content:page.site});
      if(selector==='meta[property="og:title"]')return page.title===null?null:element({content:page.title});
      if(selector==='meta[property="og:url"]')return page.canonical===null?null:element({content:page.canonical});
      throw new Error(`unexpected selector ${selector}`);
    },
    querySelectorAll(selector){reads.push(selector);assert.equal(selector,'mod-file-download');return page.boxes.map(element);},
    addEventListener(type,listener,options){listeners.document[type]=listener;listeners.options={...listeners.options,[type]:options&&typeof options==='object'?{...options}:options};}
  };
  const api={
    runtime:{get id(){return page.orphaned?undefined:'self';},
      sendMessage:message=>{
        if(page.throws)throw new Error('Extension context invalidated.');
        sent.push(JSON.parse(JSON.stringify(message)));
        if(page.hold)return new Promise(resolve=>{page.release=resolve;});
        return page.reject?Promise.reject(new Error('gone')):Promise.resolve(page.reply);
      }},
    extension:{inIncognitoContext:incognito},
    storage:{local:{get:async defaults=>{if(storageFails)throw new Error('storage');return {...defaults,nexus:enabled};}},onChanged:{addListener:listener=>listeners.storage.push(listener)}}};
  const window={addEventListener(type,listener){listeners.window[type]=listener;}};window.top=top?window:{};
  const location={get href(){return page.url;},get hostname(){return new URL(page.url).hostname;}};
  const context=vm.createContext({window,location,document,chrome:api,URL,
    Date:{now:()=>now},
    setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,at:now+ms});return sequence;},
    setInterval:(fn,ms)=>{timers.set(++sequence,{fn,at:now+ms,every:ms});return sequence;},
    clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)});
  vm.runInContext(read('policy.js'),context,{filename:'policy.js'});
  vm.runInContext(read('nexus.js'),context,{filename:'nexus.js'});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  async function advance(ms){
    await settle();
    const end=now+ms;
    for(;;){
      const due=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      const [id,timer]=due;now=timer.at;
      if(timer.every)timer.at+=timer.every;else timers.delete(id);
      timer.fn();await settle();
    }
    now=end;await settle();
  }
  return {page,sent,reads,listeners,timers,advance,settle,
    click:(trusted=true)=>listeners.document.pointerdown({isTrusted:trusted}),
    key:(key,trusted=true)=>listeners.document.keydown({isTrusted:trusted,key}),
    setEnabled:value=>{for(const listener of listeners.storage)listener({nexus:{newValue:value}},'local');}};
}

test('on a mod’s page the script reports what the page shows, once, and again only when it changes',async()=>{
  const s=nexusPageScript();
  await s.settle();assert.deepEqual(s.sent,[],'nothing before the page has settled');
  await s.advance(400);
  assert.deepEqual(s.sent,[{cmd:'nexus',url:REPORTED_URL,page:ON_PAGE}],'the address is passed on without anything but the mod and file it names');
  await s.advance(60000);
  assert.equal(s.sent.length,1,'an unchanged page is not reported again');
  // Nexus Mods fills in the file box, or moves to another file, without reloading the page.
  s.page.url=`${PAGE_URL}?tab=files&file_id=9&utm_source=x#top`;s.page.boxes=[{'file-id':'9',filename:'Main File','file-uri':'SkyUI_5_2_SE-12604-5-2SE.7z'}];
  await s.advance(2400);
  assert.equal(s.sent.length,2);assert.deepEqual(s.sent[1].page.files,[{fileId:'9',fileName:'Main File',fileUri:'SkyUI_5_2_SE-12604-5-2SE.7z'}]);assert.equal(s.sent[1].url,`${PAGE_URL}?file_id=9`);
  assert.equal(s.sent[1].page.gameName,'Skyrim Special Edition','the game name falls back to the page’s own title line');
  // A page that is not about a mod is not read; the extension is told once to forget what the tab showed.
  s.page.url='https://www.nexusmods.com/skyrimspecialedition';const before=s.reads.length;
  await s.advance(10000);
  assert.equal(s.sent.length,3);assert.deepEqual(s.sent[2],{cmd:'nexus',page:null});assert.equal(s.reads.length,before,'nothing on such a page is read');
  // While the tab is in the background the page is not read at all.
  s.page.url=FILE_URL;s.page.boxes=[{'file-id':'735025',filename:'Simplified Chinese Patch','file-uri':FILE_NAME}];s.page.visible=false;const reads=s.reads.length;
  await s.advance(10000);assert.equal(s.reads.length,reads);assert.equal(s.sent.length,3);
  s.page.visible=true;s.listeners.document.visibilitychange({isTrusted:true});
  await s.advance(400);assert.equal(s.sent.length,4,'coming back to the tab reads it again');
  assert.deepEqual(s.sent[3].page.files,SHOWN.files);
  // The same details under a different file number in the address are not news.
  s.page.url=`${PAGE_URL}?tab=files&file_id=1`;
  await s.advance(10000);assert.equal(s.sent.length,4);
  // The address has moved on to another mod while the page still shows this one: reported, and left to the
  // extension to keep only the address until the page catches up.
  s.page.url='https://www.nexusmods.com/fallout4/mods/77';
  await s.advance(2400);assert.equal(s.sent.length,5);assert.equal(s.sent[4].url,'https://www.nexusmods.com/fallout4/mods/77');
  assert.deepEqual(P.nexusPage(s.sent[4].page,P.nexusAddress(s.sent[4].url)),{game:'fallout4',modId:77,files:[]});
  s.page.section={'data-game-id':'1151','data-mod-id':'77'};s.page.canonical='https://www.nexusmods.com/fallout4/mods/77';s.page.title='Another Mod';s.page.site='Nexus Mods :: Fallout 4';s.page.boxes=[];
  await s.advance(2400);assert.equal(s.sent.length,6);
  assert.deepEqual(P.nexusPage(s.sent[5].page,P.nexusAddress(s.sent[5].url)),{game:'fallout4',modId:77,files:[],gameId:1151,gameName:'Fallout 4',modName:'Another Mod'});
});

test('your own click or key press keeps the note fresh; ones a page invents do not',async()=>{
  const s=nexusPageScript();
  await s.advance(400);assert.equal(s.sent.length,1);
  s.click(true);await s.advance(400);
  assert.equal(s.sent.length,1,'not more often than every twenty seconds');
  await s.advance(4600);s.click(true);await s.advance(400);
  assert.equal(s.sent.length,1,'five seconds after the last report is still too soon');
  await s.advance(14499);s.click(true);await s.advance(1);
  assert.equal(s.sent.length,1,'one millisecond short of twenty seconds is too soon as well');
  // Now it is exactly twenty seconds since the last report.
  const due=()=>[...s.timers.values()].filter(timer=>!timer.every).length;
  s.click(false);
  assert.equal(due(),0,'a click made by the page itself is ignored');
  s.click(true);assert.equal(due(),1);await s.advance(400);
  assert.equal(s.sent.length,2,'twenty seconds after the last report, your click sends it again');assert.deepEqual(s.sent[1],s.sent[0]);
  assert.deepEqual(s.listeners.options.pointerdown,{capture:true,passive:true},'the click is only watched, never held up');
  assert.deepEqual(s.listeners.options.keydown,{capture:true,passive:true});
  // Pressing a button with the keyboard counts too; other keys and made-up key presses do not.
  await s.advance(21000);
  for(const [key,trusted] of [['a',true],['Tab',true],['Enter',false],[' ',false]]){s.key(key,trusted);await s.advance(400);}
  assert.equal(s.sent.length,2);
  s.key('Enter');await s.advance(400);assert.equal(s.sent.length,3);
  await s.advance(21000);s.key(' ');await s.advance(400);assert.equal(s.sent.length,4);
});

test('the script does nothing when switched off, in a private window, outside a mod page’s top frame, or on another site',async()=>{
  const off=nexusPageScript({enabled:false});
  await off.advance(30000);off.click(true);await off.advance(30000);
  assert.deepEqual(off.sent,[]);assert.deepEqual(off.reads,[],'a switched-off script does not even read the page');
  const due=()=>[...off.timers.values()].filter(timer=>!timer.every).length;
  assert.equal(due(),0,'and sets no timer of its own');
  off.setEnabled(true);await off.advance(400);
  assert.equal(off.sent.length,1,'switching it on reports the open page');
  await off.advance(1600);assert.equal(due(),1);
  off.setEnabled(false);const before=off.reads.length;
  off.page.title='Changed';await off.advance(30000);
  assert.equal(off.sent.length,1);assert.equal(off.reads.length,before,'a look that was already due finds the switch off');assert.equal(due(),0);
  off.setEnabled(true);await off.advance(400);assert.equal(off.sent.length,2,'and on again reports afresh');
  // Only the extension's own local settings switch it; a missing value means on.
  for(const listener of off.listeners.storage)listener({nexus:{newValue:false}},'session');
  off.page.title='Changed again';await off.advance(2400);assert.equal(off.sent.length,3,'a change in another storage area is not the switch');
  off.setEnabled(false);for(const listener of off.listeners.storage)listener({nexus:{oldValue:false}},'local');
  await off.advance(400);assert.equal(off.sent.length,4,'removing the stored switch means on');
  for(const listener of off.listeners.storage)listener({other:{newValue:false}},'local');
  off.page.title='Once more';await off.advance(2400);assert.equal(off.sent.length,5);
  const secret=nexusPageScript({incognito:true});
  await secret.advance(30000);assert.deepEqual(secret.sent,[]);assert.deepEqual(secret.reads,[]);assert.equal(secret.timers.size,0,'in a private window the script stops at once');
  assert.deepEqual(secret.listeners.document,{});assert.deepEqual(secret.listeners.storage,[]);
  const framed=nexusPageScript({top:false});
  await framed.advance(30000);assert.deepEqual(framed.sent,[]);assert.equal(framed.timers.size,0,'inside a frame the script stops at once');
  for(const url of ['https://users.nexusmods.com/skyrimspecialedition/mods/12604','https://www.youtube.com/watch?v=aqz-KE-bpKQ','https://www.nexusmods.com.evil.example/skyrimspecialedition/mods/12604']){
    const elsewhere=nexusPageScript({url});
    await elsewhere.advance(30000);assert.deepEqual(elsewhere.sent,[],url);assert.equal(elsewhere.timers.size,0);
  }
  // A page with almost nothing on it is still reported by its address, with empty details.
  const bare=nexusPageScript({url:PAGE_URL});bare.page.section=null;bare.page.boxes=[];bare.page.site=null;bare.page.title=null;bare.page.canonical=null;
  await bare.advance(400);
  assert.deepEqual(bare.sent,[{cmd:'nexus',url:PAGE_URL,page:{gameId:'',gameName:'',modId:'',canonical:'',modName:'',files:[]}}]);
  // Oversized attributes are cut before they are sent, and at most twenty file boxes are read.
  const huge=nexusPageScript();huge.page.title='T'.repeat(100000);huge.page.boxes=Array.from({length:60},(_,i)=>({'file-id':String(i+1),filename:'F','file-uri':`f${i}.zip`}));
  await huge.advance(400);assert.equal(huge.sent[0].page.modName.length,600);assert.equal(huge.sent[0].page.files.length,20);
  // The file box names the game before the page's title line does; the title line is read from its last "::".
  const named=nexusPageScript();named.page.boxes[0]['game-name']='From The Box';named.page.site='Nexus Mods :: From The Title';
  await named.advance(400);assert.equal(named.sent[0].page.gameName,'From The Box');
  const titled=nexusPageScript();titled.page.boxes=[];titled.page.site='Nexus Mods :: Hub :: Stardew Valley';
  await titled.advance(400);assert.equal(titled.sent[0].page.gameName,'Stardew Valley');
  const untitled=nexusPageScript();untitled.page.boxes=[];untitled.page.site='Nexus Mods';
  await untitled.advance(400);assert.equal(untitled.sent[0].page.gameName,'','a title line without "::" names no game');
  // A page that is not about a mod from the start is never read.
  const hub=nexusPageScript({url:'https://www.nexusmods.com/skyrimspecialedition'});
  await hub.advance(5000);assert.deepEqual(hub.reads,[]);assert.deepEqual(hub.sent,[{cmd:'nexus',page:null}]);
  // A switch that cannot be read counts as on.
  const unreadable=nexusPageScript({storageFails:true});
  await unreadable.advance(400);assert.equal(unreadable.sent.length,1);
});

test('details count as sent only when the extension took them, and a refused report is tried again later',async()=>{
  let unhandled=0;const seen=()=>{unhandled++;};process.on('unhandledRejection',seen);
  try{
    for(const refuse of [s=>{s.page.reply={ok:false};},s=>{s.page.reply=undefined;},s=>{s.page.reply={ok:'yes'};},s=>{s.page.reject=true;}]){
      const s=nexusPageScript();refuse(s);
      await s.advance(400);assert.equal(s.sent.length,1);
      await s.advance(9000);assert.equal(s.sent.length,1,'not tried again within ten seconds');
      await s.advance(3000);assert.equal(s.sent.length,2,'then tried again');
      s.page.reply={ok:true};s.page.reject=false;
      await s.advance(12000);assert.equal(s.sent.length,3,'until the extension takes it');
      await s.advance(60000);assert.equal(s.sent.length,3,'and then no more');
      assert.deepEqual(s.sent[2],s.sent[0]);
    }
    // A message that cannot be sent at all is treated the same way and breaks nothing.
    const broken=nexusPageScript();broken.page.throws=true;
    await broken.advance(400);broken.page.title='Changed';await broken.advance(2400);
    assert.equal(broken.sent.length,0);
    broken.page.throws=false;await broken.advance(12000);assert.equal(broken.sent.length,1);
    // After the extension is reloaded, this copy of the script can no longer reach it and stops for good.
    const orphan=nexusPageScript();
    await orphan.advance(400);assert.equal(orphan.sent.length,1);
    orphan.page.orphaned=true;orphan.page.title='Changed';
    await orphan.advance(2400);assert.equal(orphan.sent.length,1);assert.equal(orphan.timers.size,0,'no timer is left running');
    const reads=orphan.reads.length;await orphan.advance(25000);orphan.click(true);orphan.key('Enter');
    assert.equal(orphan.timers.size,0,'and a click or key press starts nothing again');
    await orphan.advance(30000);assert.equal(orphan.reads.length,reads);assert.equal(orphan.sent.length,1);
    // While a report is still on its way, no second one is sent.
    const slow=nexusPageScript();slow.page.hold=true;
    await slow.advance(400);assert.equal(slow.sent.length,1);
    slow.page.title='Changed';await slow.advance(6000);assert.equal(slow.sent.length,1,'the change waits for the answer');
    slow.page.hold=false;slow.page.release({ok:true});await slow.advance(2400);
    assert.equal(slow.sent.length,2);assert.equal(slow.sent[1].page.modName,'Changed');
    await tick(20);assert.equal(unhandled,0,'a refused or failed message leaves no stray error');
  }finally{process.off('unhandledRejection',seen);}
});

test('a page loaded ahead of time is reported when it is shown, and a page brought back is reported afresh',async()=>{
  // The browser can load a page before you open it. Its report would be refused, so none is made until it is shown.
  const early=nexusPageScript();early.page.prerendering=true;
  await early.advance(30000);assert.deepEqual(early.sent,[]);assert.deepEqual(early.reads,[]);
  early.page.prerendering=false;early.listeners.document.prerenderingchange({isTrusted:true});
  await early.advance(400);assert.equal(early.sent.length,1);
  // Going back to a page the browser kept: the tab has shown other pages since, so the details are sent again.
  const s=nexusPageScript();
  await s.advance(400);assert.equal(s.sent.length,1);
  s.listeners.window.pageshow({isTrusted:true,persisted:false});await s.advance(400);assert.equal(s.sent.length,1,'an ordinary first showing is not a return');
  s.listeners.window.pageshow({isTrusted:false,persisted:true});await s.advance(400);assert.equal(s.sent.length,1);
  s.listeners.window.pageshow({isTrusted:true,persisted:true});await s.advance(400);
  assert.equal(s.sent.length,2);assert.deepEqual(s.sent[1],s.sent[0]);
  // A page cannot hurry the script along with made-up events.
  await s.advance(1600);
  s.page.title='Changed';
  s.listeners.document.visibilitychange({isTrusted:false});s.listeners.document.prerenderingchange({isTrusted:false});
  await s.advance(400);assert.equal(s.sent.length,2,'the change waits for the next regular look');
  const looks=s.reads.filter(selector=>selector==='mod-file-download').length;
  s.listeners.document.visibilitychange({isTrusted:true});s.listeners.document.visibilitychange({isTrusted:true});
  await s.advance(400);assert.equal(s.sent.length,3);
  assert.equal(s.reads.filter(selector=>selector==='mod-file-download').length-looks,1,'two triggers close together read the page once');
  // The tab being hidden is not a reason to look.
  await s.advance(400);
  s.page.visible=false;s.page.title='Changed while hidden';const unseen=s.reads.length;
  s.listeners.document.visibilitychange({isTrusted:true});await s.advance(1000);
  assert.equal(s.reads.length,unseen);assert.equal(s.sent.length,3);
});

test('the Nexus Mods script only reads: it adds nothing to the page, presses nothing and contacts nothing',()=>{
  const source=read('nexus.js');
  const code=source.split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code,/createElement|appendChild|\.append\(|\.prepend\(|insertBefore|insertAdjacent|innerHTML|outerHTML|textContent\s*=|setAttribute|removeChild|\.remove\(|replaceWith|classList|\.style\b|document\.write|attachShadow/,'no change to the page');
  assert.doesNotMatch(code,/\.click\(|dispatchEvent|\.submit\(|\.focus\(|scrollTo|preventDefault|stopPropagation|stopImmediatePropagation/,'no acting on the page');
  assert.doesNotMatch(code,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|\bimport\s*\(|new Image|\.src\s*=|location\.(?:assign|replace|reload)|\.href\s*=|window\.open|history\./,'no network and no navigation');
  assert.doesNotMatch(code,/cookie|localStorage|sessionStorage|indexedDB|storage\.local\.set|sendNativeMessage|clipboard|password|\bform\b|user-is-premium|download-url|location\.search|location\.hash|referrer/i,'no cookies, stored data, sign-in details or download links');
  assert.doesNotMatch(code,/MutationObserver|shadowRoot|eval\(|new Function/);
  assert.equal((code.match(/isTrusted/g)||[]).length,4,'every page event the script acts on must be the browser’s own');
  assert.match(code,/window\.top !== window/);assert.match(code,/location\.hostname !== P\.NEXUS_HOST/);assert.match(code,/api\.extension\.inIncognitoContext\) return;/);
  // One kind of message, to the extension only: the mod's and file's numbers from the address plus what the page showed, or "forget".
  assert.deepEqual([...code.matchAll(/sendMessage\(([^)]*)\)/g)].map(match=>match[1]),['message']);
  assert.match(code,/\? \{ cmd: 'nexus', url: `https:\/\/\$\{P\.NEXUS_HOST\}\/\$\{address\.game\}\/mods\/\$\{address\.modId\}\$\{address\.fileId \? `\?file_id=\$\{address\.fileId\}` : ''\}`, page: details \}\n\s+: \{ cmd: 'nexus', page: null \};/);
  assert.equal((code.match(/location\.href/g)||[]).length,1,'the address is read once, to find the mod and file numbers in it');
  // Only these parts of the page are read.
  assert.deepEqual([...code.matchAll(/querySelector(?:All)?\(([^)]+)\)/g)].map(match=>match[1]).sort(),["'#section[data-game-id]'","'mod-file-download'",'`meta[property="${name}"]`']);
  assert.deepEqual([...code.matchAll(/meta\('([^']+)'\)/g)].map(match=>match[1]).sort(),['og:site_name','og:title','og:url']);
  assert.deepEqual([...new Set([...code.matchAll(/attribute\((?:[^()]|\([^()]*\))+, '([^']+)'\)/g)].map(match=>match[1]))].sort(),['content','data-game-id','data-mod-id','file-id','file-uri','filename','game-id','game-name']);
  assert.equal(P.NEXUS_HOST,'www.nexusmods.com');assert.deepEqual([...P.NEXUS_FILE_ROOTS],[...mods.FILE_ROOTS],'the extension and the app agree on which servers Nexus Mods’ files come from');
});

test('the toolbar window has a switch for every feature, Nexus Mods included',()=>{
  const html=read('popup.html'),script=read('popup.js');
  const switches=JSON.parse(/const SWITCHES = Object\.freeze\((\[[^\]]+\])\)/.exec(script)[1].replace(/'/g,'"'));
  assert.deepEqual(switches,['capture','protection','guard','youtube','nexus']);
  for(const key of switches)assert.match(html,new RegExp(`<input type="checkbox" id="${key}">`),key);
  // The switch says what it does, including that it reads the page.
  assert.match(html,/<strong>Sort Nexus Mods files by game<\/strong><small>Reads the game and mod names on Nexus Mods pages, so files you download there are saved in a Mods folder for their game\.<\/small>/);
  const background=read('background.js');
  assert.match(background,/\['capture', 'protection', 'guard', 'youtube', 'nexus'\]\.includes\(message\.key\)/,'the background accepts the same switches');
  for(const key of switches)assert.match(background,new RegExp(`\\b${key}: (?:true|current\\.${key})`),key);
});

test('the app checks every part of a mod label and refuses anything malformed',()=>{
  const ok=value=>mods.modContext(value);
  const bad=value=>assert.throws(()=>mods.modContext(value),/^Error: Invalid browser request\.$/,JSON.stringify(value)?.slice(0,120));
  assert.equal(ok(undefined),undefined);
  const copy=ok(LABEL);assert.deepEqual(copy,LABEL);assert.notEqual(copy,LABEL,'a fresh object, not the one that arrived');
  assert.deepEqual(ok({site:'nexusmods',game:'site',modId:1}),{site:'nexusmods',game:'site',modId:1},'names and other numbers are optional');
  assert.deepEqual(ok({site:'nexusmods',game:'a',modId:2147483647,gameId:2147483647,fileId:2147483647}),{site:'nexusmods',game:'a',modId:2147483647,gameId:2147483647,fileId:2147483647},'the largest number Nexus Mods could use');
  assert.equal(ok({...LABEL,gameName:'x'.repeat(100),modName:'y'.repeat(200),fileName:'z'.repeat(200)}).fileName.length,200);
  assert.deepEqual(ok({...LABEL,gameName:'\u0633\u0643\u0627\u064a\u0631\u064a\u0645',modName:'\u4e2d\u6587 \ud83d\ude00'}).modName,'\u4e2d\u6587 \ud83d\ude00');
  for(const value of [null,'x',5,[],[LABEL],{},{site:'nexusmods'},{site:'nexusmods',game:'skyrimspecialedition'},{site:'nexusmods',modId:12604},{...LABEL,site:'other'},{...LABEL,site:undefined},{...LABEL,extra:1},{...LABEL,path:'C:\\'},{...LABEL,folder:'..'},
    JSON.parse('{"site":"nexusmods","game":"a","modId":1,"__proto__":{"x":1}}'),
    {...LABEL,game:''},{...LABEL,game:'Sky Rim'},{...LABEL,game:'UPPER'},{...LABEL,game:'../x'},{...LABEL,game:'a/b'},{...LABEL,game:'a'.repeat(65)},{...LABEL,game:5},{...LABEL,game:'-lead'},
    {...LABEL,modId:0},{...LABEL,modId:-1},{...LABEL,modId:1.5},{...LABEL,modId:'12604'},{...LABEL,modId:2147483648},{...LABEL,modId:null},{...LABEL,modId:NaN},
    {...LABEL,gameId:'1704'},{...LABEL,gameId:0},{...LABEL,gameId:null},{...LABEL,fileId:1.5},{...LABEL,fileId:''},{...LABEL,fileId:Infinity},
    {...LABEL,gameName:''},{...LABEL,gameName:' padded'},{...LABEL,gameName:'padded '},{...LABEL,gameName:'two  spaces'},{...LABEL,gameName:'tab\there'},{...LABEL,gameName:'line\nbreak'},
    {...LABEL,gameName:'x'.repeat(101)},{...LABEL,modName:'x'.repeat(201)},{...LABEL,fileName:'x'.repeat(201)},{...LABEL,gameName:5},{...LABEL,modName:null},{...LABEL,fileName:{}},
    {...LABEL,modName:'gnp.exe\u202eSafe'},{...LABEL,modName:'zero\u200bwidth'},{...LABEL,modName:'bell\u0007'},{...LABEL,modName:'c1\u0085'},{...LABEL,modName:'half \ud83d'},{...LABEL,modName:'\ufeffbom'},{...LABEL,gameName:'sep\u2028'},
    {...LABEL,modName:'soft\u00adhyphen'},{...LABEL,modName:'tag\udb40\udc41'},{...LABEL,modName:'private\ue000'},{...LABEL,fileName:'\ude00 half'},{...LABEL,gameName:'replaced\ufffd'},
    // Characters that show as nothing, or as a blank, and so could make a name look empty or hide part of it.
    {...LABEL,modName:'filler\u3164'},{...LABEL,gameName:'half\uffa0width'},{...LABEL,modName:'jamo\u115f'},{...LABEL,modName:'jamo\u1160'},{...LABEL,fileName:'vs\ufe0f'},{...LABEL,modName:'cgj\u034f'},
    {...LABEL,modName:'khmer\u17b4'},{...LABEL,modName:'mongolian\u180b'},{...LABEL,modName:'vs\udb40\udd00'},{...LABEL,modName:'\u2800\u2800'},{...LABEL,gameName:'braille\u2800blank'}
  ])bad(value);
  // Unassigned characters, the object placeholder, and marks that pile up on a letter or stand in front of a name.
  const ACUTE=String.fromCharCode(0x301);
  for(const text of [`x${String.fromCodePoint(0x378)}`,`x${String.fromCodePoint(0xfffe)}`,`x${String.fromCodePoint(0xfffc)}y`,`x${String.fromCodePoint(0x10ffff)}`,`Z${ACUTE.repeat(4)}algo`,`Zalgo${ACUTE.repeat(4)}`,`${ACUTE}abc`,`a ${ACUTE.repeat(4)}`])
    for(const key of ['gameName','modName','fileName'])bad({...LABEL,[key]:text});
  for(const text of [`e${ACUTE}`,`e${ACUTE.repeat(3)}`,`a ${ACUTE}b`,`e${ACUTE.repeat(3)} o${ACUTE.repeat(3)}`])assert.equal(ok({...LABEL,modName:text}).modName,text);
  // The extension's cleaning and the app's check never disagree: what the extension lets through the app
  // accepts, and every character the app refuses is one the extension takes out.
  const refused=text=>{try{mods.modContext({...LABEL,modName:text});return false;}catch{return true;}};
  const codes=[];for(let code=0;code<=0xffff;code++)codes.push(code);
  for(const [from,to] of [[0x10000,0x100ff],[0x1bca0,0x1bcaf],[0x1d173,0x1d17a],[0x1f600,0x1f64f],[0xe0000,0xe01ef],[0xf0000,0xf00ff],[0x10fff0,0x10ffff]])for(let code=from;code<=to;code++)codes.push(code);
  let removed=0;
  for(const code of codes){
    const character=String.fromCodePoint(code),raw=`Mod${character}name`,cleaned=P.nexusText(raw,200);
    assert.equal(refused(cleaned),false,`U+${code.toString(16)} after cleaning`);
    if(!refused(raw))continue;
    removed++;assert.ok(!cleaned.includes(character),`U+${code.toString(16)} is refused by the app, so the extension must take it out`);
  }
  assert.ok(removed>=8500,`the comparison covers the refused characters (${removed})`);
  // The same for text made of awkward pieces in any order: whatever the extension's cleaning returns, the app accepts.
  const pieces=['a','Z',' ','  ',ACUTE,ACUTE.repeat(2),ACUTE.repeat(5),String.fromCharCode(0x309),String.fromCharCode(0x200b),String.fromCodePoint(0x378),String.fromCodePoint(0xfffc),String.fromCharCode(9),String.fromCodePoint(0x1f600),String.fromCharCode(0xd83d),String.fromCharCode(0x202e),'-','.'];
  let seed=20261112,kept=0;const pick=n=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed%n;};
  for(let round=0;round<5000;round++){
    let raw='';for(let n=1+pick(12);n>0;n--)raw+=pieces[pick(pieces.length)];
    for(const max of [100,200,3]){
      const cleaned=P.nexusText(raw,max);
      if(cleaned===undefined)continue;
      kept++;assert.equal(refused(cleaned),false,JSON.stringify(raw));assert.ok(cleaned.length<=max);
    }
  }
  assert.ok(kept>8000,`most of these leave some text (${kept})`);
  // One list of refused characters, written the same way in both places.
  const refusedClass=source=>/\[\\p\{Cc\}[^\]]*\]/.exec(source)[0];
  assert.equal(refusedClass(read('policy.js')),refusedClass(fs.readFileSync(path.join(__dirname,'..','src','mods.cjs'),'utf8')));
  assert.equal(mods.modFolder(LABEL),'Skyrim Special Edition');assert.equal(mods.modFolder({site:'nexusmods',game:'fallout4',modId:1}),'fallout4');
});

test('only a file fetched from Nexus Mods’ file servers can carry a label',()=>{
  assert.deepEqual([...mods.FILE_ROOTS],['nexus-cdn.com']);
  for(const request of [{url:CDN},{url:NEWER_CDN},{url:'https://files.nexus-cdn.com/a/b.zip'},{url:'https://nexus-cdn.com/x.zip'},{url:'https://SUPPORTER-FILES.NEXUS-CDN.COM/x.zip'},
    {url:'https://www.nexusmods.com/x',finalUrl:CDN},{url:'https://WWW.NEXUSMODS.COM/x?y=1',finalUrl:NEWER_CDN},{url:NEWER_CDN,finalUrl:CDN},{url:CDN,finalUrl:CDN},
    {url:CDN,referrer:'https://evil.example/'},{url:CDN,pageUrl:'https://evil.example/'}])assert.equal(mods.fromNexus(request),true,JSON.stringify(request));
  // A download that began on another site and only ended up on a file server is not Nexus Mods' own.
  for(const url of ['https://short.example/x','http://www.nexusmods.com/x','https://nexusmods.com/x','https://users.nexusmods.com/x','https://www.nexusmods.com.example.com/x','https://example.com/www.nexusmods.com/x','http://supporter-files.nexus-cdn.com/x','not an address','',42,undefined])
    assert.equal(mods.fromNexus({url,finalUrl:CDN}),false,String(url));
  // The page that started a download proves nothing: any page, Nexus Mods' own included, can link to a file kept anywhere.
  for(const request of [null,undefined,'x',5,{},{url:''},{url:42},{url:'https://mirror.example/x.zip'},
    {url:'https://new-server.example/x.zip',referrer:'https://www.nexusmods.com/'},{url:'https://new-server.example/x.zip',pageUrl:FILE_URL},{url:'https://new-server.example/x.zip',referrer:FILE_URL,pageUrl:FILE_URL},
    {url:'https://www.nexusmods.com/x.zip'},{url:'https://cf-files.nexusmods.com/x.zip'},{url:'https://files.nexusmods.com/x.zip',referrer:FILE_URL},
    {url:'https://nexus-cdn.com.evil.example/x.zip'},{url:'https://evilnexus-cdn.com/x.zip'},{url:'https://mirror.example/nexus-cdn.com/x.zip'},{url:'https://nexus-cdn.com@evil.example/x.zip'},
    {url:CDN.replace('https:','http:')},{url:CDN.replace('https:','ftp:')},{url:CDN,finalUrl:'https://mirror.example/x.zip'},{url:'not a url',referrer:'also not'},{url:'https://mirror.example/x.zip',referrer:CDN},{url:'https://mirror.example/x.zip',pageUrl:CDN}])assert.equal(mods.fromNexus(request),false,JSON.stringify(request));
  const ok=value=>protocol.validateRequest({v:1,...value});
  const bad=value=>assert.throws(()=>ok(value),/Invalid browser request/,JSON.stringify(value).slice(0,120));
  assert.deepEqual(ok({type:'capture',url:CDN,mod:LABEL}).mod,LABEL);
  assert.equal(ok({type:'capture',url:CDN}).mod,undefined);
  bad({type:'capture',url:CDN,mod:{...LABEL,extra:1}});bad({type:'capture',url:CDN,mod:'SkyUI'});bad({type:'capture',url:CDN,mod:null});bad({type:'capture',url:CDN,mod:{...LABEL,modName:'a\u202eb'}});bad({type:'capture',url:CDN,mod:{...LABEL,modName:'a\u3164b'}});
  bad({type:'send',kind:'link',url:CDN,mod:LABEL});bad({type:'media',url:'https://www.youtube.com/watch?v=aqz-KE-bpKQ',quality:'720',mod:LABEL});bad({type:'hello',extensionVersion:'0.7.0',browser:'chromium',mod:LABEL});
});

// ---------- the bridge ----------
function bridgeFor(t,options={}){
  const dir=scratch(t,()=>bridge.stop()),events={queued:[],notes:[]};
  const bridge=new BrowserBridge({hostDir:dir,threatLists:null,appVersion:'0.7.0',
    inspect:options.inspect||(async url=>({status:'ready',url,sourceUrl:url,filename:decodeURIComponent(new URL(url).pathname.split('/').pop()),size:3072,chain:[{url,host:new URL(url).hostname,listed:null}],sniffed:'7z'})),
    resolveProvider:options.resolveProvider||null,
    queueDownload:async entry=>{events.queued.push(entry);return {added:1};},openExternal:async()=>{},reveal(){},notify:note=>events.notes.push(note)});
  const take=async message=>{
    const decision=bridge.receive('chromium',protocol.validateRequest({v:1,type:'capture',...message}));
    for(let i=0;i<200&&bridge.snapshot().captures.some(capture=>capture.status==='checking');i++)await tick(5);
    return decision;
  };
  const shown=id=>bridge.snapshot().captures.find(capture=>capture.id===id);
  return {bridge,events,take,shown};
}

test('the label follows a Nexus Mods download through the review and into the queue',async t=>{
  const {bridge,events,take}=bridgeFor(t);
  const decision=await take({url:CDN,referrer:'https://www.nexusmods.com/',filename:FILE_NAME,totalBytes:3072,mod:LABEL});
  assert.equal(decision.action,'take');
  const [shown]=bridge.snapshot().captures;
  assert.equal(shown.status,'ready');assert.deepEqual(shown.mod,LABEL);assert.equal(shown.name,FILE_NAME);assert.equal(shown.modFolder,'Mods › Skyrim Special Edition');
  assert.equal(new URL(shown.address).hostname,'supporter-files.nexus-cdn.com','the review still shows where the file really comes from');
  assert.equal(shown.address,CDN.split('?')[0],'the signed part of the link is not sent to the window');
  assert.equal(events.queued.length,0,'nothing downloads until you choose');
  const result=await bridge.action({id:decision.id,action:'download'});
  assert.equal(result.added,1);assert.equal(events.queued.length,1);
  const [entry]=events.queued;
  assert.deepEqual(entry.mod,LABEL);assert.notEqual(entry.mod,LABEL);
  assert.equal(entry.origin,'browser');assert.equal(entry.markOfTheWeb,true);assert.equal(entry.url,CDN);assert.equal(entry.filename,FILE_NAME);assert.equal(entry.referer,'https://www.nexusmods.com/');
  assert.equal(entry.headers,undefined,'no cookies or sign-in details travel with it');
  assert.equal(bridge.snapshot().captures[0].status,'queued');
});

test('a label on a file that does not come from Nexus Mods’ file servers is dropped, and other downloads are untouched',async t=>{
  const {bridge,events,take,shown}=bridgeFor(t);
  const forged=await take({url:'https://mirror.example/SkyUI.7z',referrer:'https://mirror.example/page',filename:'SkyUI.7z',mod:LABEL});
  assert.equal(shown(forged.id).mod,null);
  await bridge.action({id:forged.id,action:'download'});
  assert.equal(events.queued[0].mod,undefined);assert.equal(Object.hasOwn(events.queued[0],'mod'),false);
  const plain=await take({url:'https://cdn.example/game.zip',filename:'game.zip'});
  assert.equal(shown(plain.id).mod,null);
  await bridge.action({id:plain.id,action:'download'});
  assert.equal(Object.hasOwn(events.queued[1],'mod'),false);
  // Started on a Nexus Mods page, even the mod's own, but kept on another server: any page can link to any file.
  const linked=await take({url:'https://new-files.example/SkyUI.7z',referrer:FILE_URL,pageUrl:FILE_URL,filename:'SkyUI.7z',mod:LABEL});
  assert.equal(shown(linked.id).status,'ready');assert.equal(shown(linked.id).mod,null);
  await bridge.action({id:linked.id,action:'download'});
  assert.equal(Object.hasOwn(events.queued[2],'mod'),false);
  // A download that is blocked straight away does not carry a forged label either.
  const blocked=await take({url:'https://mirror.example/a',filename:'invoice.pdf.exe',mod:LABEL});
  assert.equal(blocked.action,'block');assert.equal(shown(blocked.id).mod,null);assert.equal(shown(blocked.id).modFolder,'');
  // The address the browser ended up at decides, not the one the download started from.
  const ended=await take({url:CDN,finalUrl:'https://mirror.example/SkyUI.7z',filename:'SkyUI.7z',mod:LABEL});
  assert.equal(shown(ended.id).mod,null);
  const through=await take({url:'https://www.nexusmods.com/x',finalUrl:NEWER_CDN,filename:FILE_NAME,mod:LABEL});
  assert.deepEqual(shown(through.id).mod,LABEL);
  // But one that began on another site is not labelled: "Download in browser instead" would open that first address.
  const began=await take({url:'https://short.example/x',finalUrl:NEWER_CDN,filename:'Other File.7z',mod:LABEL});
  assert.equal(shown(began.id).status,'ready');assert.equal(shown(began.id).mod,null);assert.equal(shown(began.id).modFolder,'');
});

test('a Nexus Mods link that leads on to another site loses its label',async t=>{
  const checked=(final,extra={})=>async url=>({status:'ready',url:final||url,sourceUrl:url,filename:FILE_NAME,size:3072,sniffed:'7z',
    chain:[{url,host:new URL(url).hostname,listed:null},...(final?[{url:final,host:new URL(final).hostname,listed:null}]:[])],...extra});
  // The browser reported a file server's address, but following it ends somewhere else.
  const away=bridgeFor(t,{inspect:checked('https://mirror.example/SkyUI.7z')});
  const moved=await away.take({url:CDN,referrer:'https://www.nexusmods.com/',filename:FILE_NAME,mod:LABEL});
  assert.equal(away.shown(moved.id).status,'ready');assert.equal(away.shown(moved.id).mod,null,'the review no longer calls it a Nexus Mods file');
  await away.bridge.action({id:moved.id,action:'download'});
  assert.equal(Object.hasOwn(away.events.queued[0],'mod'),false);assert.equal(away.events.queued[0].url,'https://mirror.example/SkyUI.7z');
  // One file server handing over to another keeps it.
  const within=bridgeFor(t,{inspect:checked(NEWER_CDN)});
  const stays=await within.take({url:CDN,filename:FILE_NAME,mod:LABEL});
  await within.bridge.action({id:stays.id,action:'download'});
  assert.deepEqual(within.events.queued[0].mod,LABEL);assert.equal(within.events.queued[0].url,NEWER_CDN);
  assert.equal(within.events.queued[0].sourceUrl,CDN,'the address the browser asked for is kept beside the one the file is fetched from');
  // An unencrypted last step is not a file server's address either.
  const plain=bridgeFor(t,{inspect:checked(NEWER_CDN.replace('https:','http:'),{status:'manual',insecure:true})});
  const downgraded=await plain.take({url:CDN,filename:FILE_NAME,mod:LABEL});
  assert.equal(plain.shown(downgraded.id).mod,null);
  // A link that only the browser can use is still shown as the mod's file while you decide.
  const browserOnly=bridgeFor(t,{inspect:checked(null,{status:'manual',message:'This site gives the file only to your browser (it needs a sign-in, cookies or a check).'})});
  const manual=await browserOnly.take({url:CDN,filename:FILE_NAME,mod:LABEL});
  assert.equal(browserOnly.shown(manual.id).status,'manual');assert.deepEqual(browserOnly.shown(manual.id).mod,LABEL);
  // A check that reports no address at all cannot vouch for the file.
  const blind=bridgeFor(t,{inspect:async url=>({status:'manual',message:'Unknown.',chain:[{url,host:new URL(url).hostname,listed:null}]})});
  const unknown=await blind.take({url:CDN,filename:FILE_NAME,mod:LABEL});
  assert.equal(blind.shown(unknown.id).status,'manual');assert.equal(blind.shown(unknown.id).mod,null);
});

test('a file-host page opened from Nexus Mods is resolved as a file host, never labelled as a mod',async t=>{
  const {bridge,events,take}=bridgeFor(t,{resolveProvider:async url=>({status:'ready',url:'https://dl.fuckingfast.co/file.rar',filename:'file.rar',size:10,headers:{},referer:url})});
  const decision=await take({url:'https://fuckingfast.co/abc',referrer:'https://www.nexusmods.com/',mod:LABEL});
  await bridge.action({id:decision.id,action:'download'});
  assert.equal(Object.hasOwn(events.queued[0],'mod'),false);
});

// ---------- the download queue ----------
const MiB=1024*1024;
function fileServer(size){
  const payload=Buffer.alloc(size);for(let i=0;i<size;i+=4096)payload[i]=(i/4096)&255;
  const server={payload,requests:[]};
  server.fetch=async(url,options={})=>{
    const headers=new Headers(options.headers),range=headers.get('range'),match=range&&/^bytes=(\d+)-(\d*)$/.exec(range);
    const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),size-1):size-1;
    server.requests.push({url:String(url),range:range||'',referer:headers.get('referer')||'',cookie:headers.get('cookie')||''});
    const body=payload.subarray(start,end+1);
    return new Response(body,{status:match?206:200,headers:{'content-type':'application/octet-stream','content-length':String(body.length),etag:'"v1"',...(match?{'content-range':`bytes ${start}-${end}/${size}`}:{})}});
  };
  return server;
}
function queueFor(t,server,settings={},more={}){
  const root=scratch(t,()=>manager.stop()),options={stateFile:path.join(root,'state.json'),downloadDir:path.join(root,'downloads'),fetcher:server.fetch,...more};
  let manager=new DownloadManager(options);manager.updateSettings({concurrency:1,connectionsPerFile:4,defenderScan:false,...settings});
  const finished=async()=>{for(let i=0;i<3000&&(manager.running.size||manager.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(5);};
  return {root,options,get manager(){return manager;},finished,async reopen(){await manager.stop();manager=new DownloadManager(options);return manager;}};
}
const modLink=(extra={})=>({status:'ready',url:CDN,sourceUrl:CDN,filename:FILE_NAME,size:3072,origin:'browser',markOfTheWeb:true,mod:{...LABEL},...extra});

test('mod files are saved in Mods, in a folder named after their game, and keep their label',async t=>{
  const server=fileServer(3072),q=queueFor(t,server);
  const added=q.manager.add({links:[modLink()],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});
  assert.equal(added.added,1);await q.finished();
  const [d]=q.manager.downloads;
  assert.equal(d.status,'completed',d.error);
  assert.equal(d.folder,path.join(q.options.downloadDir,'Mods','Skyrim Special Edition'));assert.equal(d.name,FILE_NAME);assert.equal(d.gameTitle,'Skyrim Special Edition');
  assert.deepEqual(fs.readFileSync(path.join(d.folder,d.name)),server.payload);
  assert.deepEqual(d.mod,LABEL);assert.equal(d.origin,'browser');assert.equal(d.markOfTheWeb,true);
  assert.deepEqual(q.manager.state().downloads[0].mod,LABEL,'the window can show which mod it is');
  // The same file again is recognised as already there; the same file as an ordinary browser download is separate.
  assert.equal(q.manager.add({links:[modLink()],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER}).added,0);
  assert.equal(q.manager.add({links:[modLink({mod:undefined})],gameTitle:'Browser downloads'}).added,1);await q.finished();
  assert.equal(q.manager.downloads[1].folder,path.join(q.options.downloadDir,'Browser downloads'));assert.equal(Object.hasOwn(q.manager.downloads[1],'mod'),false);
  // The label is still there after Ravenshelf restarts.
  const reopened=await q.reopen();
  assert.deepEqual(reopened.downloads[0].mod,LABEL);assert.equal(reopened.downloads[0].folder,d.folder);
});

test('a game name from a web page can never move the folder outside Mods',async t=>{
  const server=fileServer(64),q=queueFor(t,server),modsRoot=path.join(q.options.downloadDir,'Mods');
  const names=['..','.','../../evil','..\\..\\evil','C:\\Windows\\System32','/etc/passwd','CON','nul.txt','Kingdom Come: Deliverance II','a/b\\c','trailing dots...','   ','<script>','x'.repeat(300),'\u0633\u0643\u0627\u064a\u0631\u064a\u0645'];
  names.forEach((gameTitle,index)=>q.manager.add({links:[modLink({url:cdnFile(`file-${index}.zip`),sourceUrl:cdnFile(`file-${index}.zip`),filename:`file-${index}.zip`})],gameTitle,group:mods.MODS_FOLDER}));
  await q.finished();
  assert.equal(q.manager.downloads.length,names.length);
  for(const d of q.manager.downloads){
    assert.equal(d.status,'completed',`${d.gameTitle}: ${d.error}`);
    assert.equal(path.dirname(d.folder),modsRoot,`${JSON.stringify(d.gameTitle)} stays one level inside Mods`);
    assert.ok(fs.existsSync(path.join(d.folder,d.name)));
    assert.doesNotMatch(path.basename(d.folder),/[<>:"/\\|?*]|^\.{1,2}$|[. ]$/);assert.ok(path.basename(d.folder).length<=100);
  }
  const folders=q.manager.downloads.map(d=>path.basename(d.folder));
  assert.equal(folders[8],'Kingdom Come_ Deliverance II');assert.equal(folders[6],'_CON');assert.equal(folders[0],'Imported files');assert.equal(folders[14],'\u0633\u0643\u0627\u064a\u0631\u064a\u0645');
  // The group name is cleaned the same way, and without a group nothing changes.
  q.manager.add({links:[modLink({url:cdnFile('g.zip'),sourceUrl:cdnFile('g.zip'),filename:'g.zip'})],gameTitle:'Game',group:'..\\..\\Elsewhere'});
  q.manager.add({links:[modLink({url:cdnFile('h.zip'),sourceUrl:cdnFile('h.zip'),filename:'h.zip',mod:undefined})],gameTitle:'Plain game'});
  await q.finished();
  assert.equal(q.manager.downloads.at(-2).folder,path.join(q.options.downloadDir,'.._.._Elsewhere','Game'));
  assert.equal(q.manager.downloads.at(-1).folder,path.join(q.options.downloadDir,'Plain game'));
  // Only a download that came through the browser keeps a label.
  q.manager.add({links:[{...modLink({url:cdnFile('i.zip'),sourceUrl:cdnFile('i.zip'),filename:'i.zip'}),origin:undefined}],gameTitle:'Game',group:mods.MODS_FOLDER});
  q.manager.add({links:[modLink({url:cdnFile('j.zip'),sourceUrl:cdnFile('j.zip'),filename:'j.zip',mod:{...LABEL,site:'elsewhere'}})],gameTitle:'Game',group:mods.MODS_FOLDER});
  await q.finished();
  assert.equal(Object.hasOwn(q.manager.downloads.at(-2),'mod'),false);assert.equal(Object.hasOwn(q.manager.downloads.at(-1),'mod'),false);
});

test('a mod file downloads over one connection, however many the settings allow',async t=>{
  const size=MIN_PARALLEL_SIZE+MiB,server=fileServer(size),q=queueFor(t,server,{connectionsPerFile:4});
  q.manager.add({links:[modLink({size})],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});await q.finished();
  const [mod]=q.manager.downloads;
  assert.equal(mod.status,'completed',mod.error);
  assert.deepEqual(server.requests.map(request=>request.range),[''],'one request for the whole file');
  assert.equal(mod.connectionMode,'single');assert.equal(mod.connectionNote,'Nexus Mods files download over one connection.');
  assert.equal(server.requests[0].cookie,'','no cookies are sent');
  assert.ok(fs.readFileSync(path.join(mod.folder,mod.name)).equals(server.payload));
  // The same file as an ordinary download uses several connections, so the limit above is the label's doing.
  server.requests.length=0;
  q.manager.add({links:[modLink({size,mod:undefined,url:`${CDN}&plain=1`,sourceUrl:`${CDN}&plain=1`})],gameTitle:'Browser downloads'});await q.finished();
  assert.equal(q.manager.downloads[1].status,'completed',q.manager.downloads[1].error);
  assert.ok(server.requests.filter(request=>request.range).length>=2,'an ordinary download is split into parts');
  // A paused mod download resumes over one connection too.
  server.requests.length=0;
  const again=await q.reopen();
  again.updateSettings({connectionsPerFile:4});
  const resumed=again.downloads[0];
  fs.renameSync(path.join(resumed.folder,resumed.name),path.join(resumed.folder,resumed.name+'.atlas-part'));
  fs.truncateSync(path.join(resumed.folder,resumed.name+'.atlas-part'),MiB);
  Object.assign(resumed,{status:'queued',received:MiB,completedAt:undefined});again.pump();
  for(let i=0;i<3000&&(again.running.size||again.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(5);
  assert.equal(resumed.status,'completed',resumed.error);
  assert.deepEqual(server.requests.map(request=>request.range),[`bytes=${MiB}-`],'one request for the rest');
  assert.ok(fs.readFileSync(path.join(resumed.folder,resumed.name)).equals(server.payload));
});

test('a mod link that Nexus Mods no longer accepts says what to do; other failures and other files keep the plain message',async t=>{
  const {publicErrorMessage}=require('../src/public-errors.cjs');
  const EXPIRED='Nexus Mods did not accept this download link. Its links expire after a while: start the download again from the mod’s page.';
  assert.equal(mods.LINK_EXPIRED_NOTE,EXPIRED);assert.deepEqual([...mods.LINK_REFUSED],[401,403,404,410]);
  let status=403;const requests=[];
  const fetcher=async url=>{requests.push(String(url));return new Response('private text from the host: token=abc',{status,headers:{'content-type':'text/html'}});};
  const q=queueFor(t,{fetch:fetcher});
  const failed=async(link,title,group)=>{q.manager.add({links:[link],gameTitle:title,group});await q.finished();const d=q.manager.downloads.at(-1);assert.equal(d.status,'error');return d.error;};
  let n=0;const fresh=extra=>{const name=`try-${++n}.7z`,url=cdnFile(name);return modLink({url,sourceUrl:url,filename:name,...extra});};
  for(status of [401,403,404,410])assert.equal(await failed(fresh(),mods.modFolder(LABEL),mods.MODS_FOLDER),EXPIRED,String(status));
  // A server fault is not an expired link.
  status=500;assert.equal(await failed(fresh(),mods.modFolder(LABEL),mods.MODS_FOLDER),'Host returned HTTP 500. Check the source link or retry.');
  // The same refusals for a download that is not a mod file read as before.
  status=403;assert.equal(await failed(fresh({mod:undefined}),'Browser downloads'),'Host returned HTTP 403. Check the source link or retry.');
  assert.equal(requests.length,6,'one request each: a refused link is not asked for twice');
  for(const d of q.manager.downloads)assert.doesNotMatch(JSON.stringify(d.error),/token|private text/);
  // The message is one of the fixed sentences allowed across the app's error boundary, and nothing can ride along with it.
  assert.equal(publicErrorMessage(new Error(EXPIRED),'download'),EXPIRED);
  assert.notEqual(publicErrorMessage(new Error(EXPIRED+' C:\\Users\\someone'),'download'),EXPIRED+' C:\\Users\\someone');
});

test('a mod file is fetched from its own link and nowhere else: Ravenshelf never looks a refused or half-kept link up again',async t=>{
  // As the app really runs, the queue can look a link up again when a host refuses it.
  const lookups=[],requests=[];let status=403;
  const resolveLink=async url=>{lookups.push(String(url));return {status:'ready',url:String(url),headers:{}};};
  const fetcher=async(url,{headers}={})=>{
    requests.push({url:String(url),referer:new Headers(headers).get('referer')||''});
    return status===200?new Response(Buffer.alloc(64,7),{status,headers:{'content-type':'application/octet-stream','content-length':'64',etag:'"v1"'}}):new Response('refused',{status,headers:{'content-type':'text/html'}});
  };
  const q=queueFor(t,{fetch:fetcher},{},{resolveLink});
  // A link that led on to another address of the file servers, and is then refused.
  const moved=name=>({sourceUrl:cdnFile(name),url:`https://cf-files.nexus-cdn.com/1704/12604/${name}?md5=def&expires=2&user_id=2`,filename:name});
  q.manager.add({links:[modLink(moved('moved.7z'))],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});await q.finished();
  const [mod]=q.manager.downloads;
  assert.equal(mod.status,'error');assert.equal(mod.error,mods.LINK_EXPIRED_NOTE);
  assert.deepEqual(lookups,[],'the link is not looked up again');
  assert.deepEqual(requests.map(request=>request.url),[moved('moved.7z').url],'and is asked for once');
  // The same link as an ordinary browser download is looked up again, as it always was.
  requests.length=0;
  q.manager.add({links:[modLink({...moved('plain.7z'),mod:undefined})],gameTitle:'Browser downloads'});await q.finished();
  const plain=q.manager.downloads[1];
  assert.equal(plain.status,'error');assert.equal(plain.error,'Host returned HTTP 403. Check the source link or retry.');
  assert.deepEqual(lookups,[moved('plain.7z').sourceUrl]);assert.deepEqual(requests.map(request=>request.url),[moved('plain.7z').url,moved('plain.7z').sourceUrl]);
  // A page address that could not be kept safely across a restart is simply left out for a mod file.
  lookups.length=0;requests.length=0;status=200;
  q.manager.add({links:[modLink({...moved('kept.7z'),size:64,referer:FILE_URL}),modLink({...moved('kept-plain.7z'),size:64,referer:FILE_URL,mod:undefined})],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});
  const waiting=q.manager.downloads.slice(2);
  for(const d of waiting)q.manager.action(d.id,'pause');
  await q.finished();
  const reopened=await q.reopen();requests.length=0;lookups.length=0;
  const [keptMod,keptPlain]=reopened.downloads.slice(2);
  // This test queue has no vault, so neither header was kept. Only the ordinary download is marked to be checked again.
  assert.deepEqual(keptMod.headers,{});assert.equal(Object.hasOwn(keptMod,'headersNeedRefresh'),false);
  assert.equal(keptPlain.headersNeedRefresh,true);
  reopened.action(keptMod.id,'resume');
  for(let i=0;i<3000&&(reopened.running.size||reopened.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(5);
  assert.equal(keptMod.status,'completed',keptMod.error);
  assert.deepEqual(lookups,[],'no look-up for the mod file');
  assert.deepEqual(requests,[{url:moved('kept.7z').url,referer:''}],'one request, at its own link, without the page address');
  assert.equal(Object.hasOwn(keptMod,'headersNeedRefresh'),false);
  // An ordinary download in the same state is looked up again first.
  reopened.action(keptPlain.id,'resume');
  for(let i=0;i<3000&&(reopened.running.size||reopened.downloads.some(d=>['queued','downloading'].includes(d.status)));i++)await tick(5);
  assert.equal(keptPlain.status,'completed',keptPlain.error);
  assert.deepEqual(lookups,[moved('kept-plain.7z').sourceUrl]);
});

test('a finished mod file keeps only the plain address of its link',async t=>{
  const server=fileServer(3072),q=queueFor(t,server),ordinary='https://cdn.example/game.zip?token=1';
  q.manager.add({links:[modLink({referer:FILE_URL})],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});
  q.manager.add({links:[modLink({mod:undefined,url:ordinary,sourceUrl:ordinary,filename:'game.zip',referer:'https://page.example/'})],gameTitle:'Browser downloads'});
  await q.finished();
  const [mod,plain]=q.manager.downloads,address=CDN.split('?')[0];
  assert.equal(server.requests[0].referer,FILE_URL);
  assert.equal(mod.status,'completed',mod.error);assert.equal(plain.status,'completed',plain.error);
  assert.equal(server.requests[0].url,CDN,'the whole link is what was fetched');
  // The part after "?" is a signed pass with the account's number in it. It was needed to fetch the file, and is not kept after that.
  assert.equal(mod.url,address);assert.equal(mod.sourceUrl,address);
  assert.deepEqual(mod.headers,{},'nor is the page address that went with the request');
  assert.equal(q.manager.state().downloads[0].url,address,'so the window does not show it');
  const saved=fs.readFileSync(q.options.stateFile,'utf8');
  assert.ok(saved.includes(address));assert.doesNotMatch(saved,/user_id|md5=|expires=/,'and it is not left on disk');
  // Other downloads keep their address as it was.
  assert.equal(plain.url,ordinary);assert.equal(plain.sourceUrl,ordinary);assert.deepEqual(plain.headers,{Referer:'https://page.example/'});
  // A mod download that has not finished keeps its link: it needs it to carry on.
  const refusing=queueFor(t,{fetch:async()=>new Response('busy',{status:500,headers:{'content-type':'text/html'}})});
  refusing.manager.add({links:[modLink()],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});await refusing.finished();
  assert.equal(refusing.manager.downloads[0].status,'error');assert.equal(refusing.manager.downloads[0].url,CDN);
});

test('the same mod file again is recognised by its address, whatever the signed part of the link says',async t=>{
  const server=fileServer(3072),q=queueFor(t,server),place={gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER};
  const signed=(name,query,extra={})=>{const url=cdnFile(name,query);return modLink({url,sourceUrl:url,filename:name,...extra});};
  assert.equal(q.manager.add({links:[modLink()],...place}).added,1);
  assert.ok(['queued','downloading'].includes(q.manager.downloads[0].status));
  assert.equal(q.manager.add({links:[signed(FILE_NAME,'md5=zzz&expires=2&user_id=2')],...place}).added,0,'while it is on its way');
  await q.finished();
  const [first]=q.manager.downloads;assert.equal(first.status,'completed',first.error);
  assert.equal(q.manager.add({links:[signed(FILE_NAME,'md5=yyy&expires=3&user_id=2')],...place}).added,0,'once it has finished');
  assert.equal(q.manager.add({links:[signed(FILE_NAME,'')],...place}).added,0);
  assert.equal(q.manager.add({links:[signed(FILE_NAME,'md5=q&expires=5&user_id=2#again')],...place}).added,0,'nor does a fragment make it another file');
  assert.equal(q.manager.downloads.length,1);
  // Another file of the mod, or the same file under another game's folder, is a download of its own.
  assert.equal(q.manager.add({links:[signed('Other File-12604-2-0.7z','md5=abc&expires=1&user_id=2')],...place}).added,1);
  assert.equal(q.manager.add({links:[signed(FILE_NAME,'md5=xxx&expires=4&user_id=2')],gameTitle:'Another game',group:mods.MODS_FOLDER}).added,1);
  await q.finished();
  assert.deepEqual(q.manager.downloads.map(d=>d.status),['completed','completed','completed']);
  // A paused one is still the same file, and keeps the link it has.
  const {ids:[pausedId]}=q.manager.add({links:[signed('Paused-12604-1-0.7z','md5=abc&expires=1&user_id=2')],...place});
  q.manager.action(pausedId,'pause');
  const paused=q.manager.downloads.find(d=>d.id===pausedId);
  assert.equal(paused.status,'paused');
  assert.equal(q.manager.add({links:[signed('Paused-12604-1-0.7z','md5=new&expires=9&user_id=2')],...place}).added,0);
  assert.equal(paused.status,'paused');assert.ok(paused.url.endsWith('?md5=abc&expires=1&user_id=2'));
  // One that was cancelled does not count, as for any download.
  q.manager.action(pausedId,'cancel');
  assert.equal(q.manager.add({links:[signed('Paused-12604-1-0.7z','md5=new&expires=9&user_id=2')],...place}).added,1);
  await q.finished();
  // Ordinary downloads are compared by their whole address, as before.
  const plain=token=>modLink({mod:undefined,url:`https://cdn.example/a.zip?token=${token}`,sourceUrl:`https://cdn.example/a.zip?token=${token}`,filename:'a.zip'});
  assert.equal(q.manager.add({links:[plain(1)],gameTitle:'Browser downloads'}).added,1);
  assert.equal(q.manager.add({links:[plain(1)],gameTitle:'Browser downloads'}).added,0);
  assert.equal(q.manager.add({links:[plain(2)],gameTitle:'Browser downloads'}).added,1,'a different link is a different download');
  // A label from anywhere but the browser, or for another site, does not change how a link is compared.
  assert.equal(q.manager.add({links:[{...plain(1),mod:{...LABEL},origin:undefined}],gameTitle:'Browser downloads'}).added,0);
  assert.equal(q.manager.add({links:[{...plain(3),mod:{...LABEL,site:'elsewhere'}}],gameTitle:'Browser downloads'}).added,1);
  assert.equal(q.manager.add({links:[{...plain(4),mod:{...LABEL,site:'elsewhere'}}],gameTitle:'Browser downloads'}).added,1);
  await q.finished();
});

test('a failed mod download takes a new link from the mod’s page and carries on where it stopped',async t=>{
  const size=3*MiB,server=fileServer(size);let refusing=true;
  const fetcher=async(url,options)=>{
    if(!refusing)return server.fetch(url,options);
    server.requests.push({url:String(url),refused:true});
    return new Response('expired',{status:403,headers:{'content-type':'text/html'}});
  };
  const q=queueFor(t,{fetch:fetcher}),place={gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER};
  const link=(expires,extra={})=>{const url=cdnFile(FILE_NAME,`md5=abc&expires=${expires}&user_id=2`);return modLink({url,sourceUrl:url,size,...extra});};
  const first=q.manager.add({links:[link(1,{referer:'https://www.nexusmods.com/old'})],...place});await q.finished();
  const [d]=q.manager.downloads;
  assert.equal(d.status,'error');assert.equal(d.error,mods.LINK_EXPIRED_NOTE);assert.equal(server.requests.length,1);
  // Part of the file had arrived before the link stopped working.
  fs.writeFileSync(path.join(d.folder,d.name+'.atlas-part'),server.payload.subarray(0,MiB));
  Object.assign(d,{received:MiB,total:size,etag:'"v1"',retryCount:2,networkRetries:2,pauseReason:'schedule',scheduleRequested:true,headersNeedRefresh:true});
  server.requests.length=0;refusing=false;
  // You press the download button on the mod's page again: the same file under a newly signed link.
  const second=q.manager.add({links:[link(2,{referer:'https://www.nexusmods.com/',mod:{...LABEL,modName:'SkyUI 5.2'}})],...place});
  assert.deepEqual(second,{added:1,ids:first.ids},'the failed entry is the one that starts again');
  assert.equal(q.manager.downloads.length,1);assert.equal(d.error,'');assert.ok(['queued','downloading'].includes(d.status));
  assert.equal(d.url,link(2).url);assert.equal(d.sourceUrl,link(2).url);
  assert.equal(d.retryCount,0);assert.equal(d.networkRetries,0);
  for(const key of ['pauseReason','scheduleRequested','headersNeedRefresh'])assert.equal(Object.hasOwn(d,key),false,key);
  await q.finished();
  assert.equal(d.status,'completed',d.error);
  assert.deepEqual(server.requests.map(request=>[new URL(request.url).searchParams.get('expires'),request.range,request.referer]),[['2',`bytes=${MiB}-`,'https://www.nexusmods.com/']],'one request, on the new link, for the part that was missing');
  assert.ok(fs.readFileSync(path.join(d.folder,d.name)).equals(server.payload));
  assert.equal(d.name,FILE_NAME,'under the same name, not as a second copy');assert.deepEqual(fs.readdirSync(d.folder),[FILE_NAME]);
  assert.deepEqual(d.mod,{...LABEL,modName:'SkyUI 5.2'},'with the label that came with the new link');
});

test('only a failed mod entry takes a new link; every other entry is left as it is',async t=>{
  const server=fileServer(3072);let refusing=false;
  const fetcher=async(url,options)=>refusing?new Response('no',{status:403,headers:{'content-type':'text/html'}}):server.fetch(url,options);
  const q=queueFor(t,{fetch:fetcher}),place={gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER};
  const signed=(name,expires,extra={})=>{const url=cdnFile(name,`md5=abc&expires=${expires}&user_id=2`);return modLink({url,sourceUrl:url,filename:name,...extra});};
  const bare=name=>cdnFile(name,'').slice(0,-1);
  const failing=async(link,where=place)=>{
    refusing=true;const {ids}=q.manager.add({links:[link],...where});await q.finished();refusing=false;
    const d=q.manager.downloads.find(item=>item.id===ids[0]);assert.equal(d.status,'error');return d;
  };
  const untouched=(d,url)=>{assert.equal(d.status,'error');assert.equal(d.url,url);assert.notEqual(d.error,'');};
  // An entry that is being removed.
  const removing=await failing(signed('a.7z',1));q.manager.quiescing.add(removing.id);
  assert.equal(q.manager.add({links:[signed('a.7z',2)],...place}).added,0);untouched(removing,signed('a.7z',1).url);
  q.manager.quiescing.delete(removing.id);
  // An ordinary download that failed: Retry is the way, as before.
  const ordinary=await failing(signed('b.7z',1,{mod:undefined}));
  assert.equal(q.manager.add({links:[signed('b.7z',1,{mod:undefined})],...place}).added,0);untouched(ordinary,signed('b.7z',1).url);
  // An ordinary download kept at the address a mod link points to is not a mod's entry.
  const unlabelled=await failing(modLink({mod:undefined,url:bare('c.7z'),sourceUrl:bare('c.7z'),filename:'c.7z'}));
  assert.equal(q.manager.add({links:[signed('c.7z',2)],...place}).added,0);untouched(unlabelled,bare('c.7z'));assert.equal(Object.hasOwn(unlabelled,'mod'),false);
  // A link without a label does not take over a mod's entry, and cannot blank its label.
  const labelled=await failing(signed('d.7z',1));
  assert.equal(q.manager.add({links:[modLink({mod:undefined,url:bare('d.7z'),sourceUrl:bare('d.7z'),filename:'d.7z'})],...place}).added,0);
  untouched(labelled,signed('d.7z',1).url);assert.deepEqual(labelled.mod,LABEL);
  // The same file for another game's folder is a download of its own.
  const elsewhere=q.manager.add({links:[signed('d.7z',2)],gameTitle:'Another game',group:mods.MODS_FOLDER});
  assert.equal(elsewhere.added,1);assert.notEqual(elsewhere.ids[0],labelled.id);untouched(labelled,signed('d.7z',1).url);
  await q.finished();
  // A new link that Ravenshelf would not fetch from changes nothing.
  assert.throws(()=>q.manager.add({links:[signed('d.7z',3,{referer:'http://192.168.1.1/'})],...place}),/Only public HTTPS web addresses are supported/);
  untouched(labelled,signed('d.7z',1).url);
  // And the entry that does qualify takes the new link, even while it still has to wait its turn.
  labelled.retryAt=Date.now()+3600000;
  assert.deepEqual(q.manager.add({links:[signed('d.7z',4)],...place}),{added:1,ids:[labelled.id]});
  assert.equal(labelled.status,'queued');assert.equal(labelled.error,'','the old failure is no longer shown');
  delete labelled.retryAt;q.manager.pump();
  await q.finished();
  assert.equal(labelled.status,'completed',labelled.error);
  assert.equal(removing.status,'error');assert.equal(ordinary.status,'error');assert.equal(unlabelled.status,'error');
});

test('the review names the folder exactly as the queue then makes it',async t=>{
  const {bridge,events,take,shown}=bridgeFor(t),q=queueFor(t,fileServer(64));
  const games=['Skyrim Special Edition','Kingdom Come: Deliverance II','..','CON','a/b\\c','trailing dots...','<script>','x'.repeat(100),'\u0633\u0643\u0627\u064a\u0631\u064a\u0645','\uff33\uff4b\uff59rim',undefined];
  const said=[];
  for(const [index,gameName] of games.entries()){
    const label={...LABEL,gameName};if(gameName===undefined)delete label.gameName;
    const decision=await take({url:cdnFile(`file-${index}.zip`),filename:`file-${index}.zip`,mod:label});
    said.push(shown(decision.id).modFolder);
    await bridge.action({id:decision.id,action:'download'});
    // What the app does with a download the review hands over (src/browser-integration.cjs).
    const entry=events.queued.at(-1),{ids}=q.manager.add({links:[entry],gameTitle:mods.modFolder(entry.mod),group:mods.MODS_FOLDER});
    const d=q.manager.downloads.find(item=>item.id===ids[0]);
    assert.equal(said.at(-1),`${path.basename(path.dirname(d.folder))} › ${path.basename(d.folder)}`,JSON.stringify(gameName));
    assert.equal(path.dirname(path.dirname(d.folder)),q.options.downloadDir);
  }
  assert.deepEqual(said.slice(0,7),['Mods › Skyrim Special Edition','Mods › Kingdom Come_ Deliverance II','Mods › Imported files','Mods › _CON','Mods › a_b_c','Mods › trailing dots','Mods › _script_']);
  assert.equal(said[9],'Mods › Skyrim');assert.equal(said[10],'Mods › skyrimspecialedition','without a game name, the game’s short name from the address');
  await q.finished();
  for(const d of q.manager.downloads)assert.equal(d.status,'completed',d.error);
  assert.equal(shown((await take({url:'https://cdn.example/game.zip',filename:'game.zip'})).id).modFolder,'','a download without a label has no such folder');
});

test('a busy file server makes a mod download wait, without talk of fewer connections',async t=>{
  const q=queueFor(t,{fetch:async()=>new Response('slow down',{status:429,headers:{'retry-after':'1','content-type':'text/plain'}})});
  q.manager.add({links:[modLink()],gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});
  q.manager.add({links:[modLink({mod:undefined,url:'https://cdn.example/a.zip',sourceUrl:'https://cdn.example/a.zip',filename:'a.zip'})],gameTitle:'Browser downloads'});
  const [mod,plain]=q.manager.downloads;
  for(let i=0;i<600&&!(mod.connectionNote&&plain.connectionNote);i++)await tick(5);
  assert.equal(mod.status,'queued');assert.equal(mod.connectionNote,'The host is busy. Waiting before retrying.');
  assert.equal(plain.connectionNote,'The host is busy. Waiting before retrying with fewer connections.');
});

test('mod files of any type can be cleaned up, but only from Ravenshelf’s own Mods folders',async t=>{
  const root=scratch(t),modsRoot=path.join(root,'Mods'),game=path.join(modsRoot,'Skyrim Special Edition'),installed=path.join(root,'Skyrim Special Edition');
  fs.mkdirSync(game,{recursive:true});fs.mkdirSync(installed);fs.mkdirSync(path.join(root,'Other','Mods','Deep'),{recursive:true});
  const job=(folder,overrides)=>({folder,status:'completed',origin:'browser',mod:{...LABEL},...overrides});
  const plugin=job(game,{id:'plugin',name:'SkyUI_SE.esp'}),tool=job(game,{id:'tool',name:'installer.exe',status:'error'});
  const inGameFolder=job(installed,{id:'in-game-folder',name:'d3d11.dll'}),noLabel=job(game,{id:'no-label',name:'notes.txt',mod:undefined});
  const otherSite=job(game,{id:'other-site',name:'pack.pak',mod:{...LABEL,site:'elsewhere'}}),notBrowser=job(game,{id:'not-browser',name:'plugin2.esp',origin:undefined});
  const directlyInMods=job(modsRoot,{id:'directly-in-mods',name:'loose.esp'}),deeper=job(path.join(root,'Other','Mods','Deep'),{id:'deeper',name:'deep.esp'});
  const archive=job(installed,{id:'archive',name:'mod.7z',mod:undefined,origin:undefined});
  const downloads=[plugin,tool,inGameFolder,noLabel,otherSite,notBrowser,directlyInMods,deeper,archive];
  for(const d of downloads)fs.writeFileSync(path.join(d.folder,d.name+(d.status==='error'?'.atlas-part':'')),'keep');
  fs.writeFileSync(path.join(game,'untracked.esp'),'keep');
  const cleanup=createDownloadCleanup({getDownloads:()=>downloads,getDownloadDir:()=>root});
  const ids=downloads.map(d=>d.id),preview=await cleanup.preview(ids);
  assert.deepEqual(preview.items.map(item=>item.id).sort(),['archive','deeper','plugin','tool'],'label + browser + a folder directly inside a folder named Mods; archives as before');
  const result=await cleanup.deletePreview({ids,token:preview.token});
  assert.deepEqual(result.removedIds.sort(),['archive','deeper','plugin','tool']);
  for(const d of [inGameFolder,noLabel,otherSite,notBrowser,directlyInMods])assert.equal(fs.readFileSync(path.join(d.folder,d.name),'utf8'),'keep',d.id);
  assert.equal(fs.readFileSync(path.join(game,'untracked.esp'),'utf8'),'keep','files Ravenshelf did not download are never touched');
  assert.equal(fs.existsSync(path.join(game,plugin.name)),false);assert.equal(fs.existsSync(path.join(game,tool.name+'.atlas-part')),false);
});

// ---------- 0.7.1 ----------
const PLACE=Object.freeze({gameTitle:mods.modFolder(LABEL),group:mods.MODS_FOLDER});
const MOVED='Nexus Mods sent this download on to another site, so Ravenshelf stopped it. Start the download again from the mod’s page.';
const DROPPED='Ravenshelf does not keep the link of a cancelled Nexus Mods download. Start the download again from the mod’s page.';

test('a mod download that a file server sends on to another site is stopped before that site is contacted',async t=>{
  assert.equal(mods.LINK_MOVED_NOTE,MOVED);
  assert.equal(mods.assertFileServer('https://cf-files.nexus-cdn.com/1/2/a.7z?x=1'),undefined);assert.equal(mods.assertFileServer('https://NEXUS-CDN.com/a'),undefined);
  for(const address of ['https://files.example.com/a.7z','http://files.nexus-cdn.com/a.7z','https://nexus-cdn.com.example.com/a.7z','https://notnexus-cdn.com/a.7z','https://www.nexusmods.com/a.7z','not an address','',undefined])
    assert.throws(()=>mods.assertFileServer(address),error=>error.message===MOVED,String(address));
  // What the queue fetches with: like the real one, it asks before it follows a hand-over.
  const server=fileServer(3072),asked=[];let onward='';
  const fetcher=async(url,options={})=>{
    asked.push(typeof options.checkRedirect);
    if(!onward)return server.fetch(url,options);
    if(options.checkRedirect)options.checkRedirect(onward);
    return server.fetch(onward,options);
  };
  const q=queueFor(t,{fetch:fetcher});
  const start=(name,extra={},where=PLACE)=>{const url=cdnFile(name);const {ids}=q.manager.add({links:[modLink({url,sourceUrl:url,filename:name,...extra})],...where});return q.manager.downloads.find(d=>d.id===ids[0]);};
  // Another of Nexus Mods' file servers is fine.
  onward='https://cf-files.nexus-cdn.com/1704/12604/a.7z?md5=n&expires=9&user_id=2';
  const within=start('a.7z');await q.finished();
  assert.equal(within.status,'completed',within.error);assert.deepEqual(server.requests.map(request=>request.url),[onward]);
  // Anywhere else: the download stops, and that address is never asked for.
  for(const [i,elsewhere] of ['https://files.example.com/b.7z','http://files.nexus-cdn.com/b.7z','https://nexus-cdn.com.example.com/b.7z','https://www.nexusmods.com/b.7z'].entries()){
    onward=elsewhere;server.requests.length=0;
    const d=start(`b${i}.7z`);await q.finished();
    assert.equal(d.status,'error',elsewhere);assert.equal(d.error,MOVED,elsewhere);assert.deepEqual(server.requests,[],elsewhere);
    assert.deepEqual(d.mod,LABEL);assert.deepEqual(fs.readdirSync(d.folder).filter(name=>name.startsWith(`b${i}`)),[],elsewhere);
    assert.equal(q.manager.state().downloads.find(item=>item.id===d.id).error,MOVED,'the window is given the sentence as it is');
  }
  assert.ok(asked.length>=5&&asked.every(kind=>kind==='function'),'every request for a mod file carries the rule');
  // The rule is for mod files only: an ordinary download is followed wherever it leads, as before.
  onward='https://files.example.com/c.7z';server.requests.length=0;asked.length=0;
  const plain=start('c.7z',{mod:undefined},{gameTitle:'Browser downloads'});await q.finished();
  assert.equal(plain.status,'completed',plain.error);assert.deepEqual(asked,['undefined']);assert.deepEqual(server.requests.map(request=>request.url),[onward]);
});

test('a mod file is the same file when its path on the file servers and its saved name are the same',async t=>{
  const server=fileServer(3072);let refusing=false;
  const fetcher=async(url,options)=>refusing?new Response('no',{status:403,headers:{'content-type':'text/html'}}):server.fetch(url,options);
  const q=queueFor(t,{fetch:fetcher});
  const at=(host,name,expires)=>`https://${host}.nexus-cdn.com/1704/12604/${encodeURIComponent(name)}?md5=abc&expires=${expires}&user_id=2`;
  const link=(host,name,expires,extra={})=>{const url=at(host,name,expires);return modLink({url,sourceUrl:url,filename:name,...extra});};
  const add=entry=>q.manager.add({links:[entry],...PLACE});
  const failing=async entry=>{refusing=true;const {ids}=add(entry);await q.finished();refusing=false;const d=q.manager.downloads.find(item=>item.id===ids[0]);assert.equal(d.status,'error');return d;};
  // The next click can name another of the file servers: it is still the same file.
  const moved=await failing(link('supporter-files','moved.7z',1));
  assert.deepEqual(add(link('cf-files','moved.7z',2)),{added:1,ids:[moved.id]},'the failed entry takes the link from the other server');
  await q.finished();assert.equal(moved.status,'completed',moved.error);assert.equal(moved.name,'moved.7z');
  assert.equal(add(link('files','moved.7z',3)).added,0,'and the finished file is known on any of them');
  assert.equal(q.manager.downloads.length,1);
  // The same path under another name is another download. Nothing is renamed, and nothing is saved under a name that was not checked.
  const named=await failing(link('supporter-files','tool.7z',1));
  const other=add(link('supporter-files','tool.7z',2,{filename:'tool.exe'}));
  assert.equal(other.added,1);assert.notEqual(other.ids[0],named.id);
  assert.equal(named.status,'error');assert.equal(named.name,'tool.7z');assert.equal(named.url,at('supporter-files','tool.7z',1));
  await q.finished();
  const second=q.manager.downloads.find(d=>d.id===other.ids[0]);
  assert.equal(second.status,'completed',second.error);assert.equal(second.name,'tool.exe');assert.equal(named.status,'error');
  // A name that was in use got a copy number: the entry is still that file.
  fs.writeFileSync(path.join(moved.folder,'again.7z'),'a file that was already there');
  const copy=await failing(link('supporter-files','again.7z',1));
  assert.equal(copy.name,'again (1).7z');
  assert.deepEqual(add(link('cf-files','again.7z',2)),{added:1,ids:[copy.id]});
  await q.finished();assert.equal(copy.status,'completed',copy.error);assert.equal(copy.name,'again (1).7z');
  assert.equal(add(link('files','again.7z',3)).added,0);
  // Only the name itself, or the name with a real copy number, counts.
  const variants=[[s=>`${s}.7z`,true],[s=>`${s} (1).7z`,true],[s=>`${s} (12).7z`,true],[s=>`${s} (0).7z`,false],[s=>`${s} (01).7z`,false],[s=>`${s} (1) .7z`,false],[s=>`${s}(1).7z`,false],
    [s=>`${s} (1).7z.bak`,false],[s=>`${s} (x).7z`,false],[s=>`${s} ().7z`,false],[s=>`x${s} (1).7z`,false],[s=>`${s} (1).zip`,false],[s=>`${s} (1)`,false],
    [s=>`${'z'.repeat(s.length)} (1).7z`,false],[s=>`${s} (1).7q`,false],[s=>`${s}_(1).7z`,false],[s=>`${s} (1].7z`,false],[s=>`${s} [1).7z`,false],[s=>`${s} (1)).7z`,false],[s=>`${s}x (1).7z`,false]];
  for(const [i,[rename,same]] of variants.entries()){
    const stem=`odd${i}`,held=await failing(link('supporter-files',`${stem}.7z`,1));
    held.name=rename(stem);
    const result=add(link('cf-files',`${stem}.7z`,2));
    assert.equal(result.added,1,held.name);assert.equal(result.ids[0]===held.id,same,held.name);
    await q.finished();
  }
  // The same name at another place on the file servers is another file: it gets the copy number, and is known by it from then on.
  const elsewhere=name=>{const url=`https://supporter-files.nexus-cdn.com/1704/777/${name}?md5=abc&expires=1&user_id=2`;return modLink({url,sourceUrl:url,filename:name});};
  assert.equal(add(link('files','moved.7z',4)).added,0);
  const twin=add(elsewhere('moved.7z'));assert.equal(twin.added,1);await q.finished();
  assert.equal(q.manager.downloads.find(d=>d.id===twin.ids[0]).name,'moved (1).7z');
  assert.equal(add(elsewhere('moved.7z')).added,0);assert.equal(add(link('cf-files','moved.7z',5)).added,0);
  // A download with a label and one without are never one file by this rule; they are compared by address, as in 0.7.0.
  const unlabelled=`https://supporter-files.nexus-cdn.com/1704/12604/mixed.7z?token=1`;
  assert.equal(q.manager.add({links:[modLink({mod:undefined,url:unlabelled,sourceUrl:unlabelled,filename:'mixed.7z'})],...PLACE}).added,1);await q.finished();
  assert.equal(add(link('supporter-files','mixed.7z',1)).added,1,'same path and name, but the entry in the list has no label');await q.finished();
  const labelled=await failing(link('supporter-files','mixed2.7z',1));
  const second2=q.manager.add({links:[modLink({mod:undefined,url:at('supporter-files','mixed2.7z',2),sourceUrl:at('supporter-files','mixed2.7z',2),filename:'mixed2.7z'})],...PLACE});
  assert.equal(second2.added,1,'same path and name, but the new link has no label');assert.notEqual(second2.ids[0],labelled.id);assert.equal(labelled.status,'error');await q.finished();
  // A name without an ending works the same way.
  const bare=await failing(link('supporter-files','README',1));bare.name='README (3)';
  assert.deepEqual(add(link('cf-files','README',2)),{added:1,ids:[bare.id]});await q.finished();
  // The address the browser first asked for does not matter. Two files of a mod can start from one page address...
  assert.equal(add(link('files','one.7z',1,{sourceUrl:FILE_URL})).added,1);
  assert.equal(add(link('files','two.7z',1,{sourceUrl:`${PAGE_URL}?tab=files&file_id=735026`})).added,1,'another file that was started from the same page');
  // ...and one file can be reached from two.
  assert.equal(add(link('files','one.7z',2,{sourceUrl:CDN})).added,0);
  await q.finished();
  const viaPage=await failing(link('files','three.7z',1,{sourceUrl:FILE_URL}));
  assert.deepEqual(add(link('cf-files','three.7z',2,{sourceUrl:`${PAGE_URL}?tab=files`})),{added:1,ids:[viaPage.id]});
  await q.finished();assert.equal(viaPage.status,'completed',viaPage.error);
  assert.equal(viaPage.url,at('cf-files','three.7z',2).split('?')[0]);
});

test('a cancelled mod download gives up its link at once, and takes a new one from the mod’s page',async t=>{
  assert.equal(mods.LINK_DROPPED_NOTE,DROPPED);
  const size=3*MiB,server=fileServer(size),q=queueFor(t,server),address=CDN.split('?')[0];
  const {ids:[id]}=q.manager.add({links:[modLink({size,referer:FILE_URL})],...PLACE});
  q.manager.action(id,'pause');await q.finished();
  const d=q.manager.downloads[0];
  assert.equal(d.status,'paused');assert.equal(d.url,CDN,'a paused download keeps its link: it needs it to carry on');assert.deepEqual(d.headers,{Referer:FILE_URL});
  // Part of the file had arrived.
  fs.writeFileSync(path.join(d.folder,d.name+'.atlas-part'),server.payload.subarray(0,MiB));Object.assign(d,{received:MiB,total:size,etag:'"v1"'});
  q.manager.action(id,'cancel');
  assert.equal(d.status,'cancelled');assert.equal(d.url,address);assert.equal(d.sourceUrl,address);assert.deepEqual(d.headers,{});assert.equal(d.needsNewLink,true);
  assert.doesNotMatch(fs.readFileSync(q.options.stateFile,'utf8'),/user_id|md5=|expires=|file_id/,'nothing of the link or of the page address is left on disk');
  // Retry and Resume cannot bring the link back. They say what to do, and ask nothing of the file server.
  server.requests.length=0;
  for(const action of ['retry','resume','retry']){
    q.manager.action(id,action);await q.finished();
    assert.equal(d.status,'error',action);assert.equal(d.error,DROPPED,action);assert.deepEqual(server.requests,[],action);
  }
  assert.equal(q.manager.state().downloads[0].error,DROPPED,'the window is given the sentence as it is');
  // The download button on the mod's page again: the entry takes the new link and carries on where it stopped.
  const fresh=cdnFile(FILE_NAME,'md5=new&expires=9&user_id=2');
  assert.deepEqual(q.manager.add({links:[modLink({url:fresh,sourceUrl:fresh,size,referer:PAGE_URL})],...PLACE}),{added:1,ids:[id]});
  assert.equal(Object.hasOwn(d,'needsNewLink'),false);
  await q.finished();
  assert.equal(d.status,'completed',d.error);
  assert.deepEqual(server.requests.map(request=>[request.url,request.range,request.referer]),[[fresh,`bytes=${MiB}-`,PAGE_URL]]);
  assert.ok(fs.readFileSync(path.join(d.folder,d.name)).equals(server.payload));
  assert.equal(d.url,address);assert.deepEqual(d.headers,{});
  // Cancelled while it runs, or after it failed: the same.
  const running=cdnFile('running.7z');
  const {ids:[runningId]}=q.manager.add({links:[modLink({url:running,sourceUrl:running,filename:'running.7z',size})],...PLACE});
  q.manager.action(runningId,'cancel');
  const stopped=q.manager.downloads.find(item=>item.id===runningId);
  assert.equal(stopped.url,running.split('?')[0],'at once, not when the transfer has wound down');assert.equal(stopped.needsNewLink,true);
  await q.finished();
  assert.equal(stopped.status,'cancelled');assert.equal(fs.existsSync(path.join(stopped.folder,'running.7z')),false);
  const refusing=queueFor(t,{fetch:async()=>new Response('no',{status:500,headers:{'content-type':'text/html'}})});
  const {ids:[failedId]}=refusing.manager.add({links:[modLink()],...PLACE});await refusing.finished();
  const failed=refusing.manager.downloads[0];
  assert.equal(failed.status,'error');assert.equal(failed.url,CDN,'a failed download keeps its link: Retry may still work');assert.equal(Object.hasOwn(failed,'needsNewLink'),false);
  // Retry on a failed download asks again with the link it has.
  const again=[];
  refusing.manager.fetcher=async url=>{again.push(String(url));return new Response('no',{status:500,headers:{'content-type':'text/html'}});};
  refusing.manager.action(failedId,'retry');await refusing.finished();
  assert.deepEqual(again,[CDN]);assert.equal(failed.status,'error');assert.match(failed.error,/HTTP 500/);
  refusing.manager.action(failedId,'cancel');
  assert.equal(failed.url,address);assert.equal(failed.needsNewLink,true);
  // A finished one cannot be cancelled, and is not marked.
  q.manager.action(id,'cancel');assert.equal(d.status,'completed');assert.equal(Object.hasOwn(d,'needsNewLink'),false);
  // An ordinary download is not touched by any of this: cancelled, it keeps its address and can be retried.
  const ordinary='https://cdn.example/game.zip?token=1';
  const {ids:[plainId]}=q.manager.add({links:[modLink({mod:undefined,url:ordinary,sourceUrl:ordinary,filename:'game.zip',size,referer:'https://page.example/'})],gameTitle:'Browser downloads'});
  q.manager.action(plainId,'pause');await q.finished();q.manager.action(plainId,'cancel');
  const plain=q.manager.downloads.find(item=>item.id===plainId);
  assert.equal(plain.status,'cancelled');assert.equal(plain.url,ordinary);assert.deepEqual(plain.headers,{Referer:'https://page.example/'});assert.equal(Object.hasOwn(plain,'needsNewLink'),false);
  q.manager.action(plainId,'retry');await q.finished();
  assert.equal(plain.status,'completed',plain.error);assert.equal(plain.url,ordinary);
});

test('what Ravenshelf 0.7.0 still kept of a finished or cancelled mod download’s link is dropped when the app starts',async t=>{
  let manager=null;
  const root=scratch(t,async()=>{await manager?.stop();}),stateFile=path.join(root,'state.json'),downloadDir=path.join(root,'downloads');
  const folder=path.join(downloadDir,'Mods','Skyrim Special Edition'),plainAddress=name=>cdnFile(name).split('?')[0];
  const entry=(name,status,extra={})=>({id:`id-${name}`,url:cdnFile(name),sourceUrl:cdnFile(name),name,gameTitle:'Skyrim Special Edition',folder,status,received:0,total:0,speed:0,error:'',etag:null,lastModified:null,
    headers:{Referer:FILE_URL},connectionMode:'single',activeConnections:0,connectionNote:'',createdAt:'2026-11-11T00:00:00.000Z',origin:'browser',markOfTheWeb:true,mod:{...LABEL},...extra});
  const ordinary=(name,status)=>{const {mod,...rest}=entry(name,status);return {...rest,url:`https://cdn.example/${name}?token=1`,sourceUrl:`https://cdn.example/${name}?token=1`,folder:path.join(downloadDir,'Browser downloads')};};
  const stored=[entry('cancelled.7z','cancelled'),entry('done.7z','completed',{url:plainAddress('done.7z'),sourceUrl:plainAddress('done.7z')}),entry('paused.7z','paused'),entry('failed.7z','error',{error:'Host returned HTTP 500. Check the source link or retry.'}),
    ordinary('plain.zip','cancelled'),ordinary('plain-done.zip','completed'),entry('elsewhere.7z','cancelled',{mod:{...LABEL,site:'elsewhere'}}),entry('tidy.7z','cancelled',{url:plainAddress('tidy.7z'),sourceUrl:plainAddress('tidy.7z'),headers:{},needsNewLink:true})];
  fs.writeFileSync(stateFile,JSON.stringify({settings:{},downloads:stored}));
  const before=fs.statSync(stateFile).mtimeMs;
  manager=new DownloadManager({stateFile,downloadDir,fetcher:async()=>{throw new Error('This test uses no network.');}});
  const now=Object.fromEntries(manager.downloads.map(d=>[d.name,d]));
  // Cancelled: the signed link and the page address go, and the entry is marked as needing a new link.
  assert.equal(now['cancelled.7z'].url,plainAddress('cancelled.7z'));assert.equal(now['cancelled.7z'].sourceUrl,plainAddress('cancelled.7z'));
  assert.deepEqual(now['cancelled.7z'].headers,{});assert.equal(now['cancelled.7z'].needsNewLink,true);
  // Finished: 0.7.0 had already dropped the link, but kept the page address.
  assert.equal(now['done.7z'].url,plainAddress('done.7z'));assert.deepEqual(now['done.7z'].headers,{});assert.equal(Object.hasOwn(now['done.7z'],'needsNewLink'),false);
  // Paused or failed: still needed.
  for(const name of ['paused.7z','failed.7z']){assert.equal(now[name].url,cdnFile(name),name);assert.deepEqual(now[name].headers,{Referer:FILE_URL},name);assert.equal(Object.hasOwn(now[name],'needsNewLink'),false,name);}
  // Anything that is not a Nexus Mods file from the browser is left as it was.
  for(const name of ['plain.zip','plain-done.zip'])assert.equal(now[name].url,`https://cdn.example/${name}?token=1`,name);
  assert.equal(now['elsewhere.7z'].url,cdnFile('elsewhere.7z'));assert.equal(Object.hasOwn(now['elsewhere.7z'],'needsNewLink'),false);
  // And it is written back at once, not at some later change.
  const saved=Object.fromEntries(JSON.parse(fs.readFileSync(stateFile,'utf8')).downloads.map(d=>[d.name,d]));
  assert.equal(saved['cancelled.7z'].url,plainAddress('cancelled.7z'));assert.equal(saved['cancelled.7z'].needsNewLink,true);
  assert.equal(saved['paused.7z'].url,cdnFile('paused.7z'));
  assert.doesNotMatch(JSON.stringify([saved['cancelled.7z'],saved['done.7z']]),/user_id|md5=|expires=|file_id|Referer/);
  assert.ok(fs.statSync(stateFile).mtimeMs>=before);
  // The cancelled entry now behaves like one that 0.7.1 cancelled.
  manager.action('id-cancelled.7z','retry');
  assert.equal(now['cancelled.7z'].status,'error');assert.equal(now['cancelled.7z'].error,DROPPED);
  // The mark means nothing on a download that is not a Nexus Mods file: Retry starts it, as always.
  now['plain.zip'].needsNewLink=true;manager.action('id-plain.zip','retry');
  assert.ok(['queued','downloading'].includes(now['plain.zip'].status),now['plain.zip'].status);
  for(let i=0;i<600&&manager.running.size;i++)await tick(5);
  assert.notEqual(now['plain.zip'].error,DROPPED);
  // It is written back even when nothing else in the state needs it.
  await manager.stop();manager=null;
  fs.writeFileSync(stateFile,JSON.stringify({settings:{},downloads:[entry('late.7z','cancelled',{headers:{}})]}));
  manager=new DownloadManager({stateFile,downloadDir,fetcher:async()=>{throw new Error('This test uses no network.');}});
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).downloads[0].url,plainAddress('late.7z'));
  // A state that needs nothing is not rewritten for this.
  await manager.stop();manager=null;
  fs.writeFileSync(stateFile,JSON.stringify({settings:{},downloads:[stored.at(-1)]}));
  const marker=fs.readFileSync(stateFile,'utf8');
  manager=new DownloadManager({stateFile,downloadDir,fetcher:async()=>{throw new Error('This test uses no network.');}});
  assert.equal(fs.readFileSync(stateFile,'utf8'),marker,'nothing to drop, nothing written');
  assert.equal(manager.downloads[0].needsNewLink,true);
});

test('a mod download is never the reason for the warning about sign-in details that could not be saved',async t=>{
  // These queues have no vault: no header can be sealed.
  const server=fileServer(3072),q=queueFor(t,server);
  const {ids:[id]}=q.manager.add({links:[modLink({referer:FILE_URL})],...PLACE});q.manager.action(id,'pause');await q.finished();
  assert.equal(q.manager.state().headerStorageWarning,'');
  const saved=JSON.parse(fs.readFileSync(q.options.stateFile,'utf8')).downloads[0];
  assert.deepEqual(saved.headers,{});assert.equal(Object.hasOwn(saved,'headersNeedRefresh'),false);assert.equal(Object.hasOwn(saved,'sealedHeaders'),false);
  // An ordinary download whose header cannot be sealed still raises it.
  const ordinary='https://cdn.example/game.zip?token=1';
  const {ids:[plainId]}=q.manager.add({links:[modLink({mod:undefined,url:ordinary,sourceUrl:ordinary,filename:'game.zip',referer:'https://page.example/'})],gameTitle:'Browser downloads'});
  q.manager.action(plainId,'pause');await q.finished();
  assert.match(q.manager.state().headerStorageWarning,/could not be saved securely/);
  q.manager.action(plainId,'cancel');q.manager.quiescing.add(plainId);q.manager.removeFromList([plainId]);
  assert.equal(q.manager.state().headerStorageWarning,'');
  // A state written by 0.7.0 can carry the mark on a mod entry. It is not a reason for the warning either.
  let manager=null;
  const root=scratch(t,async()=>{await manager?.stop();}),stateFile=path.join(root,'state.json');
  fs.writeFileSync(stateFile,JSON.stringify({settings:{},downloads:[{...q.manager.downloads[0],headers:{},headersNeedRefresh:true}]}));
  const {headers,...withoutHeaders}=q.manager.downloads[0];
  fs.writeFileSync(stateFile,JSON.stringify({settings:{},downloads:[{...q.manager.downloads[0],headers:{},headersNeedRefresh:true},{...withoutHeaders,id:'sealed',name:'sealed.7z',sealedHeaders:'cannot-be-opened-here'}]}));
  manager=new DownloadManager({stateFile,downloadDir:path.join(root,'downloads'),fetcher:server.fetch});
  assert.equal(manager.state().headerStorageWarning,'');
  manager.updateSettings({defenderScan:false});
  assert.equal(manager.state().headerStorageWarning,'');
  // A sealed header that cannot be opened here (another PC or Windows account) is dropped, and the mod entry is not marked.
  const sealed=manager.downloads.find(d=>d.id==='sealed');
  assert.deepEqual(sealed.headers,{});assert.equal(Object.hasOwn(sealed,'sealedHeaders'),false);assert.equal(Object.hasOwn(sealed,'headersNeedRefresh'),false);
});
