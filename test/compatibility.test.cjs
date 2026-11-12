'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../src/compatibility.cjs');
const {GIB,MIB}=c;

// Made-up hardware, in the shape of the PC specs answer.
function specs(over={}){
  const base={schema:1,status:'complete',checkedAt:'2026-11-10T09:30:00.000Z',
    system:{name:'Windows 11 Home',version:'10.0.22631',build:22631,architecture:'64-bit'},
    processor:{name:'Example Core i7',sockets:1,cores:14,threads:20,megahertz:2300},
    memory:{installedBytes:16*GIB,usableBytes:16*GIB-300*MIB,modules:2},
    graphics:[{name:'Example GeForce RTX',maker:'NVIDIA',kind:'discrete',dedicatedBytes:6308233216,memorySource:'directx',directx:12,featureLevel:'12.2',driver:'1.0',problem:false,main:true}],
    display:{width:1920,height:1080,refreshHz:144},
    drives:[{letter:'C',totalBytes:512*GIB,freeBytes:120*GIB,removable:false,kind:'ssd'},{letter:'E',totalBytes:2048*GIB,freeBytes:1500*GIB,removable:true,kind:'other'}],
    notes:[]};
  return {...base,...over};
}
const LIST=[
  'Minimum:',
  'Requires a 64-bit processor and operating system',
  'OS: Windows 10',
  'Processor: Example Core i7-6700 or Example Ryzen 5 1600',
  'Memory: 12 GB RAM',
  'Graphics: Example GTX 1060 6GB or Example RX 580 8GB or Example Arc A380',
  'DirectX: Version 12',
  'Network: Broadband Internet connection',
  'Storage: 70 GB available space',
  'Additional Notes: SSD required.',
].join('\n');
const tier=(text,hardware=specs())=>c.compareTier(text,hardware);
const rowOf=(result,key)=>result.rows.find(item=>item.key===key);

test('a typical list: figures are compared, models are not',()=>{
  const result=tier(LIST);
  assert.deepEqual(result.rows.map(item=>[item.key,item.verdict]),[
    ['windows','meets'],['bits','meets'],['processor','unknown'],['memory','meets'],
    ['graphics','unknown'],['videoMemory','meets'],['directx','meets'],['storage','meets']]);
  assert.equal(result.verdict,'meets');
  assert.deepEqual(result.counts,{meets:6,below:0,unknown:2});
  assert.equal(rowOf(result,'processor').note,'model');
  assert.equal(rowOf(result,'processor').haveText,'Example Core i7');
  assert.equal(rowOf(result,'graphics').haveText,'Example GeForce RTX');
  assert.equal(rowOf(result,'graphics').needs,'Example GTX 1060 6GB or Example RX 580 8GB or Example Arc A380');
  assert.equal(rowOf(result,'windows').need,10);
  assert.equal(rowOf(result,'windows').have,11);
  assert.equal(rowOf(result,'memory').need,12*GIB);
  assert.equal(rowOf(result,'memory').have,16*GIB);
  // A "6 GB" card that Windows reports as 5.875 GB meets 6 GB.
  assert.equal(rowOf(result,'videoMemory').need,6*GIB);
  assert.equal(rowOf(result,'videoMemory').have,6308233216);
  assert.equal(rowOf(result,'videoMemory').derived,true);
  assert.deepEqual(rowOf(result,'directx').need,{version:12,level:null});
  assert.deepEqual(rowOf(result,'directx').have,{version:12,level:12.2});
  // The removable drive has more room, but a game is not installed there.
  assert.equal(rowOf(result,'storage').drive,'C');
  assert.equal(rowOf(result,'storage').have,120*GIB);
  assert.equal(rowOf(result,'storage').need,70*GIB);
  // Exactly enough is enough.
  assert.equal(rowOf(tier('Storage: 120 GB'),'storage').verdict,'meets');
  assert.equal(rowOf(tier('Storage: 121 GB'),'storage').verdict,'below');
  assert.equal(rowOf(tier('OS: Windows 11'),'windows').verdict,'meets');
  assert.equal(rowOf(tier('OS: Windows 11'),'windows').have,11);
  // The first size in a line is the one asked for.
  assert.equal(rowOf(tier('Memory: 4 GB RAM (8 GB recommended)'),'memory').need,4*GIB);
  // 64-bit: the first line that asks for it is shown.
  assert.equal(rowOf(tier('Requires a 64-bit processor and operating system\nOS: Windows 10 64-bit'),'bits').needs,'Requires a 64-bit processor and operating system');
});

test('each figure can be below',()=>{
  const hardware=specs({
    system:{name:'Windows 10 Pro',version:'10.0.19045',build:19045,architecture:'32-bit'},
    memory:{installedBytes:8*GIB,usableBytes:8*GIB-100*MIB,modules:1},
    graphics:[{name:'Example GTX',maker:'NVIDIA',kind:'discrete',dedicatedBytes:4*GIB,directx:11,featureLevel:'11.1',problem:false,main:true}],
    drives:[{letter:'C',totalBytes:256*GIB,freeBytes:40*GIB,removable:false},{letter:'D',totalBytes:1024*GIB,freeBytes:60*GIB,removable:false}],
  });
  const result=tier('OS: Windows 11 64-bit\nMemory: 12 GB RAM\nGraphics: Example card (6 GB VRAM)\nDirectX: Version 12\nStorage: 70 GB available space',hardware);
  assert.deepEqual(result.rows.map(item=>[item.key,item.verdict]),[
    ['windows','below'],['bits','below'],['memory','below'],['graphics','unknown'],['videoMemory','below'],['directx','below'],['storage','below']]);
  assert.equal(result.verdict,'below');
  assert.equal(rowOf(result,'storage').drive,'D');
  assert.equal(rowOf(result,'storage').have,60*GIB);
  assert.equal(rowOf(result,'windows').have,10);
  assert.equal(rowOf(result,'bits').have,'32');
});

test('graphics memory: just under the figure meets, clearly under is below',()=>{
  const card=bytes=>specs({graphics:[{name:'Example',maker:'AMD',kind:'discrete',dedicatedBytes:bytes,directx:12,featureLevel:'12.1',problem:false,main:true}]});
  const verdict=bytes=>rowOf(tier('Graphics: 4 GB VRAM',card(bytes)),'videoMemory').verdict;
  assert.equal(verdict(4*GIB),'meets');
  assert.equal(verdict(Math.ceil(4*GIB*0.95)),'meets');
  assert.equal(verdict(Math.floor(4*GIB*0.95)-1),'below');
  assert.equal(verdict(3*GIB),'below');
  // A 6 GB card that Windows reports as 5.875 GB meets 6 GB; 11 GB does not meet 12 GB, nor 10 GB 11 GB.
  const big=(have,line)=>rowOf(tier(line,card(have)),'videoMemory').verdict;
  assert.equal(big(6308233216,'Graphics: Example 6GB'),'meets');
  assert.equal(big(11*GIB,'Graphics: Example 12GB / Example 12GB'),'below');
  assert.equal(big(10*GIB,'Graphics: Example 11GB'),'below');
});

test('memory: installed memory counts; usable memory alone never says below',()=>{
  const with_=memory=>rowOf(tier('Memory: 8 GB RAM',specs({memory})),'memory');
  assert.equal(with_({installedBytes:8*GIB,usableBytes:7.8*GIB}).verdict,'meets');
  assert.equal(with_({installedBytes:8*GIB-1,usableBytes:7*GIB}).verdict,'below');
  const usable=with_({installedBytes:null,usableBytes:7.8*GIB});
  assert.equal(usable.verdict,'unknown');
  assert.equal(usable.note,'usable');
  assert.equal(usable.have,7.8*GIB);
  assert.equal(with_({installedBytes:null,usableBytes:9*GIB}).verdict,'meets');
  assert.equal(with_(null).verdict,'unknown');
  assert.equal(with_(null).note,null);
  // Impossible figures are no figures.
  assert.equal(with_({installedBytes:-1,usableBytes:null}).verdict,'unknown');
  assert.equal(with_({installedBytes:Infinity,usableBytes:null}).verdict,'unknown');
  assert.equal(with_({installedBytes:'16000000000',usableBytes:null}).verdict,'unknown');
});

test('built-in graphics, Intel graphics and a device with a problem are not compared',()=>{
  const adapter=over=>specs({graphics:[{name:'Example',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx:12,featureLevel:'12.2',problem:false,main:true,...over}]});
  const check=over=>{const result=tier('Graphics: 2 GB VRAM\nDirectX: Version 11',adapter(over));return [rowOf(result,'videoMemory'),rowOf(result,'directx')];};
  let [vram,dx]=check({kind:'integrated',maker:'AMD',dedicatedBytes:512*MIB});
  assert.equal(vram.verdict,'unknown');assert.equal(vram.note,'shared');assert.equal(dx.verdict,'meets');
  [vram]=check({kind:'unknown',maker:'Intel',dedicatedBytes:128*MIB});
  assert.equal(vram.verdict,'unknown');assert.equal(vram.note,'shared');
  // An Intel card is a card.
  [vram]=check({kind:'discrete',maker:'Intel',dedicatedBytes:8*GIB});
  assert.equal(vram.verdict,'meets');
  [vram,dx]=check({problem:true,directx:null,featureLevel:null});
  assert.equal(vram.verdict,'unknown');assert.equal(vram.note,'problem');
  assert.equal(dx.verdict,'unknown');assert.equal(dx.note,'problem');
  // Also when an old DirectX figure is still there.
  [vram,dx]=check({problem:true});
  assert.equal(vram.note,'problem');
  assert.equal(dx.verdict,'unknown');assert.equal(dx.note,'problem');assert.equal(dx.have,null);
  // Unknown memory of its own: nothing to compare.
  [vram]=check({dedicatedBytes:null});
  assert.equal(vram.verdict,'unknown');assert.equal(vram.note,null);
  // No graphics adapter at all.
  const none=tier('Graphics: 2 GB VRAM\nDirectX: Version 11',specs({graphics:[]}));
  assert.equal(rowOf(none,'videoMemory').verdict,'unknown');
  assert.equal(rowOf(none,'directx').verdict,'unknown');
  assert.equal(rowOf(none,'graphics').haveText,'');
});

test('the main adapter is the one compared',()=>{
  const hardware=specs({graphics:[
    {name:'Example built-in',maker:'Intel',kind:'integrated',dedicatedBytes:128*MIB,directx:12,featureLevel:'12.1',problem:false,main:false},
    {name:'Example card',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx:12,featureLevel:'12.2',problem:false,main:true}]});
  const result=tier('Graphics: Example 4GB',hardware);
  assert.equal(rowOf(result,'graphics').haveText,'Example card');
  assert.equal(rowOf(result,'videoMemory').verdict,'meets');
  // Without a main one, the first.
  const first=tier('Graphics: Example 4GB',specs({graphics:[{name:'First',maker:'NVIDIA',kind:'discrete',dedicatedBytes:2*GIB,directx:12,problem:false},{name:'Second',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx:12,problem:false}]}));
  assert.equal(rowOf(first,'graphics').haveText,'First');
  assert.equal(rowOf(first,'videoMemory').verdict,'below');
});

test('DirectX versions and feature levels',()=>{
  const need=(value,named)=>c.directxNeeded(value,{named});
  assert.deepEqual(need('Version 12'),{version:12,level:null});
  assert.deepEqual(need('Version 9.0c'),{version:9,level:null});
  assert.deepEqual(need('Version 11.0'),{version:11,level:null});
  assert.deepEqual(need('11'),{version:11,level:null});
  assert.deepEqual(need('DX11'),{version:11,level:null});
  assert.deepEqual(need('DirectX 12 Ultimate'),{version:12,level:12.2});
  assert.deepEqual(need('Version 12 (feature level 12_1)'),{version:12,level:12.1});
  assert.deepEqual(need('Version 12, feature level 11.0'),{version:12,level:11});
  assert.equal(need('Version 13'),null);
  assert.equal(need('Version 4'),null);
  assert.equal(need('None'),null);
  assert.equal(need('Example GTX 960',true),null);
  assert.deepEqual(need('Example GTX 960 (DirectX 11 compatible)',true),{version:11,level:null});
  assert.deepEqual(need('DX12 card',true),{version:12,level:null});
  // A level above the version asked for is ignored.
  assert.deepEqual(need('Version 11, 12_1'),{version:11,level:null});
  const adapter=(directx,featureLevel)=>specs({graphics:[{name:'Example',maker:'AMD',kind:'discrete',dedicatedBytes:8*GIB,directx,featureLevel,problem:false,main:true}]});
  const verdict=(text,directx,level)=>rowOf(tier(text,adapter(directx,level)),'directx').verdict;
  assert.equal(verdict('DirectX: Version 12 Ultimate',12,'12.1'),'below');
  assert.equal(verdict('DirectX: Version 12 Ultimate',12,'12.2'),'meets');
  assert.equal(verdict('DirectX: Version 12 Ultimate',12,null),'unknown');
  assert.equal(verdict('DirectX: Version 12 Ultimate',11,'11.1'),'below');
  assert.equal(verdict('DirectX: Version 11',12,null),'meets');
  assert.equal(verdict('DirectX: Version 9.0c',9,'9.3'),'meets');
  assert.equal(verdict('DirectX: Version 12',11,'11.1'),'below');
  // From the graphics line when there is no DirectX line.
  const fromGraphics=tier('Graphics: DirectX 11 compatible card with 1 GB',adapter(12,'12.0'));
  assert.equal(rowOf(fromGraphics,'directx').verdict,'meets');
  assert.equal(rowOf(fromGraphics,'directx').needs,'DirectX 11 compatible card with 1 GB');
  // A DirectX line that names no version.
  const empty=rowOf(tier('DirectX: Not required',adapter(12,'12.0')),'directx');
  assert.equal(empty.verdict,'unknown');assert.equal(empty.note,'no-value');
});

test('Windows versions asked for',()=>{
  const need=c.windowsNeeded;
  assert.equal(need('Windows 10'),10);
  assert.equal(need('Windows\u00ae 7 SP1, Windows 8.1, Windows 10'),7);
  assert.equal(need('Windows 10/11'),10);
  assert.equal(need('Windows 11 (Windows 10 supported)'),10);
  assert.equal(need('Win10 64-bit'),10);
  assert.equal(need('WIN 7'),7);
  assert.equal(need('Windows 8.1'),8.1);
  assert.equal(need('Windows 8'),8);
  assert.equal(need('Windows XP'),5.1);
  assert.equal(need('Windows Vista'),6);
  assert.equal(need('Windows 10.'),10);
  assert.equal(need('Windows 10 version 2004 or newer'),10);
  assert.equal(need('Windows 2000'),null);
  assert.equal(need('Windows 98'),null);
  assert.equal(need('64-bit'),null);
  assert.equal(need('Windows 100'),null);
});

test('this PC\u2019s Windows version',()=>{
  const have=c.windowsHave;
  assert.equal(have({version:'10.0.22631',build:22631}),11);
  assert.equal(have({version:'10.0.22000',build:22000}),11);
  assert.equal(have({version:'10.0.19045',build:19045}),10);
  assert.equal(have({version:'10.0.21999'}),10);
  assert.equal(have({version:'10.0.22631'}),11);
  assert.equal(have({version:'10.0'}),null);
  // The build Windows gives counts first.
  assert.equal(have({version:'10.0',build:22631}),11);
  assert.equal(have({version:'10.0.19045',build:22631}),11);
  assert.equal(have({version:'6.3.9600'}),8.1);
  assert.equal(have({version:'6.2.9200'}),8);
  assert.equal(have({version:'6.1.7601'}),7);
  assert.equal(have({version:'6.0.6002'}),6);
  assert.equal(have({version:'5.1.2600'}),5.1);
  // A version number Windows does not use names no Windows (compareTier
  // also ignores this PC's version on a PC that is not Windows; see below).
  assert.equal(have({version:'6.8.0-1012-example'}),null);
  assert.equal(have({name:'Windows 10 Home'}),10);
  assert.equal(have({name:'Example OS'}),null);
  assert.equal(have(null),null);
});

test('64-bit Windows',()=>{
  assert.equal(c.bitsHave({architecture:'64-bit'}),'64');
  assert.equal(c.bitsHave({architecture:'64-Bit'}),'64');
  assert.equal(c.bitsHave({architecture:'ARM 64-bit Processor'}),'arm');
  assert.equal(c.bitsHave({architecture:'ARM 64-bit'}),'arm');
  assert.equal(c.bitsHave({architecture:'32-bit'}),'32');
  assert.equal(c.bitsHave({architecture:''}),null);
  assert.equal(c.bitsHave(null),null);
  assert.equal(c.wants64('Requires a 64-bit processor and operating system'),true);
  assert.equal(c.wants64('Windows 10 (64 bit)'),true);
  assert.equal(c.wants64('Windows 10 x64'),true);
  assert.equal(c.wants64('Windows 7 32/64-bit'),false);
  assert.equal(c.wants64('Windows 7 32-bit or 64-bit'),false);
  assert.equal(c.wants64('Windows 7 (32 or 64 bit)'),false);
  assert.equal(c.wants64('Windows 10 x86/x64'),false);
  assert.equal(c.wants64('Windows 10 64 or 32 bit'),false);
  assert.equal(c.wants64('Windows 7 64-bit or 32-bit'),false);
  assert.equal(c.wants64('Windows 7 64-bit/32-bit'),false);
  assert.equal(c.wants64('Windows 10'),false);
  // ARM: not known whether this game runs.
  const arm=rowOf(tier('OS: Windows 11 64-bit',specs({system:{name:'Windows 11 Home',version:'10.0.26100',build:26100,architecture:'ARM 64-bit Processor'}})),'bits');
  assert.equal(arm.verdict,'unknown');assert.equal(arm.note,'arm');
  // 64-bit asked for in the processor line, or in a note, counts too.
  assert.ok(rowOf(tier('Processor: Example 64-bit dual core'),'bits'));
  assert.ok(rowOf(tier('Additional Notes: 64-bit Windows only'),'bits'));
  // Not in other lines: a memory line is not about Windows.
  assert.equal(rowOf(tier('Memory: 64-bit 4 GB'),'bits'),undefined);
});

test('sizes',()=>{
  const sizes=text=>c.sizesIn(text).map(item=>item.bytes);
  assert.deepEqual(sizes('8 GB RAM'),[8*GIB]);
  assert.deepEqual(sizes('1 MB'),[MIB]);
  assert.deepEqual(sizes('8GB'),[8*GIB]);
  assert.deepEqual(sizes('8 gb'),[8*GIB]);
  assert.deepEqual(sizes('4096 MB RAM'),[4096*MIB]);
  assert.deepEqual(sizes('1,500 MB'),[1500*MIB]);
  assert.deepEqual(sizes('1,5 GB'),[1.5*GIB]);
  assert.deepEqual(sizes('1.5 GB'),[1.5*GIB]);
  assert.deepEqual(sizes('1 TB'),[1024*GIB]);
  assert.deepEqual(sizes('8-16 GB'),[8*GIB]);
  assert.deepEqual(sizes('8 \u2013 16 GB'),[8*GIB]);
  assert.deepEqual(sizes('4 to 8 GB'),[4*GIB]);
  assert.deepEqual(sizes('GTX 1060 6GB / RX 580 8GB'),[6*GIB,8*GIB]);
  assert.deepEqual(sizes('Shader Model 5.0'),[]);
  assert.deepEqual(sizes('2048'),[]);
  assert.deepEqual(sizes('8GBRAM'),[]);
  // A size starts at the start of its number, never in the middle of one.
  assert.deepEqual(sizes('Example 30606GB'),[30606*GIB]);
  assert.deepEqual(sizes('x.5 GB'),[]);
  assert.deepEqual(c.sizesIn('512 KB'),[]);
  assert.deepEqual(c.sizesIn('200 TB'),[]);
});

test('graphics memory from a graphics line',()=>{
  const vram=line=>c.graphicsMemory([line]);
  assert.equal(vram('Example GTX 1060 6GB / Example RX 580 4GB'),4*GIB);
  assert.equal(vram('Example GTX 960 (4 GB VRAM)'),4*GIB);
  assert.equal(vram('Example UHD 630 (8GB system RAM)'),null);
  assert.equal(vram('Example UHD 630 with 8 GB of system memory'),null);
  // A line that names built-in graphics is left out altogether.
  assert.equal(vram('Example card 2 GB, built-in graphics with 8 GB RAM'),null);
  assert.equal(vram('Integrated GPU, 8 GB memory'),null);
  assert.equal(vram('Example APU with 16 GB unified memory'),null);
  // Sizes that are memory of the PC, or a speed.
  assert.equal(vram('Example Iris with 16GB of dual-channel RAM'),null);
  assert.equal(vram('Example 680M (16 GB LPDDR5)'),null);
  assert.equal(vram('Example GTX 1060 (192 GB/s memory bandwidth)'),null);
  // A model number before a dash is not the start of a range.
  assert.equal(vram('Example RX Vega 56 - 8 GB'),8*GIB);
  assert.equal(vram('Example R9 - 4 GB'),4*GIB);
  assert.equal(vram('Example GTX 1060 6GB / Example RX 580 - 4GB'),4*GIB);
  assert.equal(vram('Built-in graphics with shared memory of 2 GB'),null);
  assert.equal(vram('Example card with 2 GB shared'),null);
  assert.equal(vram('256 MB DirectX 9 card'),256*MIB);
  assert.equal(vram('4 GB of VRAM'),4*GIB);
  assert.equal(vram('Example GTX 970'),null);
  assert.equal(vram('8 MB'),null);
  assert.equal(c.graphicsMemory(['Example 2GB','Example 1GB']),1*GIB);
  // A line of its own.
  const own=rowOf(tier('Graphics: Example GTX 970\nVideo Memory: 3 GB'),'videoMemory');
  assert.equal(own.need,3*GIB);assert.equal(own.needs,'3 GB');assert.equal(own.derived,false);
  // The line shown is the one the figure came from.
  const shown=tier('Graphics: Example GTX 970\nGraphics: Example 2 GB card');
  assert.equal(rowOf(shown,'videoMemory').needs,'Example 2 GB card');
  // The graphics card line shown is the first.
  assert.equal(rowOf(shown,'graphics').needs,'Example GTX 970');
  // A system memory figure is not graphics memory, also when it is the smallest.
  assert.equal(vram('Example card 4 GB or example graphics with 2 GB RAM'),4*GIB);
});

test('reading the list: labels, several items on one line, bullets',()=>{
  const read=c.readTier;
  // An old list written on one line.
  const one=read('Minimum: OS: Windows XP Processor: 1.8 GHz Memory: 512 MB RAM Graphics: 64 MB DirectX 9 card Hard Drive: 2 GB free');
  assert.deepEqual(one.items,{windows:'Windows XP',processor:'1.8 GHz',memory:'512 MB RAM',graphics:'64 MB DirectX 9 card',storage:'2 GB free'});
  // Two-word names stay whole.
  assert.deepEqual(read('OS: Windows 10 Graphics Memory: 2 GB').items,{windows:'Windows 10',videoMemory:'2 GB'});
  const two=read('Graphics: Example Video Memory: 2 GB Additional Notes: none Free Disk Space: 3 GB');
  assert.deepEqual(two.items,{graphics:'Example',videoMemory:'2 GB',storage:'3 GB'});
  const bullets=read('\u2022 HDD: 9 GB\n- Video Memory: 1 GB\nOS\u00ae (64-bit): Windows 10\nExample\u0007CPU: x');
  // A control character becomes a space; "Example CPU" is not an item name.
  assert.deepEqual(bullets.items,{storage:'9 GB',videoMemory:'1 GB',windows:'Windows 10'});
  const three=read('OS *: Windows 10\n\u2022 Memory\u00ae: 4 GB\nVideo Card: Example\nSystem Memory: 6 GB\nHard Disk Space: 9 GB\nCPU: Example');
  assert.equal(three.items.windows,'Windows 10');
  assert.equal(three.items.memory,'4 GB');
  assert.equal(three.items.graphics,'Example');
  assert.equal(three.items.storage,'9 GB');
  assert.equal(three.items.processor,'Example');
  // Words in brackets and names between slashes.
  const four=read('OS (64-bit): Windows 10\nVideo Card/GPU: Example\nHDD/SSD: 9 GB\nRAM (System): 4 GB');
  assert.deepEqual(four.items,{windows:'Windows 10',graphics:'Example',storage:'9 GB',memory:'4 GB'});
  assert.equal(four.bits,'OS (64-bit): Windows 10');
  assert.deepEqual(read('Sound/Video: x\nNotes (OS): y').items,{graphics:'x'});
  // The first line for an item counts.
  assert.equal(read('Memory: 4 GB\nMemory: 8 GB').items.memory,'4 GB');
  // Unknown items are left out.
  assert.deepEqual(read('Network: Broadband\nSound Card: Example').items,{});
  // Spaces and direction characters do not break a name.
  assert.equal(read('Video\u00a0\u00a0Memory: 2 GB').items.videoMemory,'2 GB');
  assert.equal(read('OS:\u202e Windows 10').items.windows,'Windows 10');
});

test('a whole answer: status, tiers and notes',()=>{
  const both=c.compareRequirements({minimum:LIST,recommended:'Memory: 32 GB RAM'},specs());
  assert.equal(both.status,'complete');
  assert.equal(both.schema,1);
  assert.deepEqual(Object.keys(both.tiers),['minimum','recommended']);
  assert.equal(both.tiers.minimum.verdict,'meets');
  assert.equal(both.tiers.recommended.verdict,'below');
  assert.deepEqual(both.notes,[]);
  assert.equal(c.compareRequirements({minimum:'',recommended:''},specs()).status,'no-requirements');
  assert.equal(c.compareRequirements(null,specs()).status,'no-requirements');
  assert.equal(c.compareRequirements({minimum:42},specs()).status,'no-requirements');
  const nothing=c.compareRequirements({minimum:'Minimum:\nNetwork: Broadband'},specs());
  assert.equal(nothing.status,'nothing-to-compare');assert.deepEqual(nothing.tiers,{});
  const none=c.compareRequirements({minimum:LIST},null);
  assert.equal(none.status,'no-specs');
  assert.equal(none.tiers.minimum.verdict,'unknown');
  const basic=c.compareRequirements({minimum:LIST},specs({status:'basic',notes:['probe-failed','basic-display'],graphics:[],drives:[]}));
  assert.equal(basic.status,'partial');
  assert.deepEqual(basic.notes,['probe-failed']);
  assert.equal(c.compareRequirements({minimum:LIST},specs({status:'basic',notes:['not-windows']})).notes[0],'not-windows');
  // Only the recommended list.
  assert.deepEqual(Object.keys(c.compareRequirements({recommended:LIST},specs()).tiers),['recommended']);
});

test('a tier is below when one figure is, meets when one meets and none is below',()=>{
  assert.equal(tier('Processor: Example').verdict,'unknown');
  assert.equal(tier('Processor: Example\nMemory: 8 GB').verdict,'meets');
  assert.equal(tier('Memory: 8 GB\nStorage: 999 GB').verdict,'below');
  assert.deepEqual(tier('Memory: 8 GB\nStorage: 999 GB').counts,{meets:1,below:1,unknown:0});
});

test('figures that cannot be read say so',()=>{
  const result=tier('OS: Example OS\nMemory: TBD\nStorage: lots\nGraphics: Example');
  assert.equal(rowOf(result,'windows').note,'no-value');
  assert.equal(rowOf(result,'memory').note,'no-value');
  assert.equal(rowOf(result,'storage').note,'no-value');
  assert.equal(rowOf(result,'videoMemory'),undefined);
  for(const item of result.rows)assert.equal(item.verdict,'unknown');
  // No usable drive to compare with.
  const drives=rowOf(tier('Storage: 1 GB',specs({drives:[{letter:'E',freeBytes:900*GIB,removable:true},{letter:'F',freeBytes:null,removable:false},{letter:'?',freeBytes:900*GIB,removable:false}]})),'storage');
  assert.equal(drives.verdict,'unknown');assert.equal(drives.drive,null);
});

test('text from the site is cleaned and kept short',()=>{
  const result=tier(`Processor: Example\u202e\u2066 CPU\u0007 ${'x'.repeat(1000)}`);
  const shown=rowOf(result,'processor').needs;
  assert.ok(shown.startsWith('Example CPU x'));
  assert.equal(shown.length,300);
  assert.doesNotMatch(shown,/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/);
  const name=rowOf(tier('Processor: Example',specs({processor:{name:'Example\u202e CPU'}})),'processor').haveText;
  assert.equal(name,'Example CPU');
  // A control character between two words leaves a space.
  assert.equal(rowOf(tier('Processor: Example\u0007CPU'),'processor').needs,'Example CPU');
});

test('large or hostile lists stay fast and bounded',()=>{
  const started=process.hrtime.bigint();
  const big='Memory: '+'1'.repeat(50000)+' GB\n'+'Graphics: '+'4 GB '.repeat(20000)+'\n'+'OS: '+'Windows '.repeat(20000);
  const result=c.compareRequirements({minimum:big,recommended:'\n'.repeat(100000)+'Memory: 8 GB'},specs());
  const ms=Number(process.hrtime.bigint()-started)/1e6;
  assert.ok(ms<1500,`took ${ms} ms`);
  assert.ok(result.tiers.minimum);
  // Only the first lines are read.
  assert.equal(result.tiers.recommended,undefined);
  const many=Array.from({length:100},(_,i)=>`Note ${i}: x`).join('\n')+'\nMemory: 8 GB';
  assert.equal(rowOf(tier(many),'memory'),undefined);
  // Empty lines do not count.
  assert.ok(rowOf(tier('\n'.repeat(100)+'Memory: 8 GB'),'memory'));
});

test('Windows lines that rule versions out, or ask for an update, are not judged',()=>{
  const win=(line,system)=>rowOf(tier(line,system?specs({system}):specs()),'windows');
  const seven={name:'Windows 7',version:'6.1.7601',build:7601,architecture:'64-bit'};
  for(const line of ['OS *: Windows 10/11 64-bit (Windows 7 and 8.1 are not supported)','OS: Windows 7 is no longer supported. Windows 10','OS: Windows 11 (upgrade from Windows 7 required)','OS: Windows 10, except Windows 7']){
    const found=win(line,seven);
    assert.equal(found.verdict,'unknown',line);assert.equal(found.note,'unclear',line);
  }
  const old={name:'Windows 10 Pro',version:'10.0.17763',build:17763,architecture:'64-bit'};
  for(const line of ['OS: Windows 10 version 2004 or newer','OS: Windows 10 22H2 (10.0.19045)','OS: Windows 10 RS5 x64','OS: Windows 10 build 15063 or higher','OS: Windows 10 with the latest update']){
    const found=win(line,old);
    assert.equal(found.verdict,'unknown',line);assert.equal(found.note,'update',line);
  }
  assert.equal(win('OS: Windows 10 (1909 or newer)',old).note,'update');
  assert.equal(win('OS: Windows 11 23H2').note,'update');
  // A newer version than the one named meets, whatever update of it is named.
  assert.equal(win('OS: Windows 10 version 2004 or newer').verdict,'meets');
  assert.equal(win('OS: Windows 7 SP1').verdict,'meets');
  assert.equal(win('OS: Windows 7 SP1',{name:'Windows 7',version:'6.1.7600',build:7600,architecture:'64-bit'}).note,'update');
  // "64-bit" and "x64" are not updates.
  assert.equal(win('OS: Windows 10 64-bit',old).verdict,'meets');
  assert.equal(win('OS: Windows 10 x64',old).verdict,'meets');
});

test('64-bit is asked for only when 32-bit is not mentioned',()=>{
  for(const line of ['Windows 7 (32 & 64-bit)','Windows 7 64-bit and 32-bit','Windows 7 64-bit, 32-bit','Windows 7 (x86 or x64)','Windows 7 (32bit & 64bit)','Windows 7 (32- or 64-bit)','Windows 10 64-bit (32-bit not supported)','Windows XP i386 or x64'])assert.equal(c.wants64(line),false,line);
  for(const line of ['Windows 10 64-bit, 32 GB RAM recommended','Windows 10 x86_64','Windows 10 x86-64','64-bit processor with 32 threads'])assert.equal(c.wants64(line),true,line);
  const thirtyTwo=specs({system:{name:'Windows 7',version:'6.1.7601',build:7601,architecture:'32-bit'}});
  assert.equal(rowOf(tier('OS: Windows 7 (32 & 64-bit)',thirtyTwo),'bits'),undefined);
});

test('a Recommended heading inside the minimum list ends it',()=>{
  const both=tier('Minimum:\nOS: Windows 10\nMemory: 8 GB RAM\nGraphics: Example GTX 1050 Ti\nRecommended:\nGraphics: Example RTX 3070 8GB\nStorage: 100 GB SSD');
  assert.deepEqual(both.rows.map(item=>item.key),['windows','memory','graphics']);
  // Only the first heading is skipped.
  assert.deepEqual(c.readTier('Recommended:\nMemory: 16 GB\nMinimum Requirements:\nMemory: 8 GB').items,{memory:'16 GB'});
  assert.deepEqual(c.readTier('Minimum: OS: Windows 10 Memory: 4 GB').items,{windows:'Windows 10',memory:'4 GB'});
});

test('graphics memory of a device Windows does not call a card: enough meets, less is not judged',()=>{
  const amd=bytes=>specs({graphics:[{name:'Example Radeon',maker:'AMD',kind:'unknown',dedicatedBytes:bytes,directx:12,featureLevel:'12.1',problem:false,main:true}]});
  const less=rowOf(tier('Graphics: Example (2 GB VRAM)',amd(512*MIB)),'videoMemory');
  assert.equal(less.verdict,'unknown');assert.equal(less.note,'kind');assert.equal(less.have,512*MIB);
  assert.equal(rowOf(tier('Graphics: Example (2 GB VRAM)',amd(8*GIB)),'videoMemory').verdict,'meets');
});

test('several figures in one line: one answer when they agree',()=>{
  const free=bytes=>specs({drives:[{letter:'C',freeBytes:bytes,removable:false}]});
  const storage=(line,bytes)=>rowOf(tier(line,free(bytes)),'storage');
  const both=storage('Storage: 100 GB available space (150 GB needed during installation)',120*GIB);
  assert.equal(both.verdict,'unknown');assert.equal(both.note,'unclear');assert.equal(both.need,100*GIB);
  assert.equal(storage('Storage: 100 GB available space (150 GB needed during installation)',200*GIB).verdict,'meets');
  assert.equal(storage('Storage: 100 GB available space (150 GB needed during installation)',50*GIB).verdict,'below');
  assert.equal(storage('Storage: SSD (500 MB/s read), 150 GB',120*GIB).verdict,'below');
  assert.equal(storage('Storage: SSD (500 MB/s read), 150 GB',120*GIB).need,150*GIB);
  const memory=(line,bytes)=>rowOf(tier(line,specs({memory:{installedBytes:bytes,usableBytes:bytes}})),'memory');
  assert.equal(memory('Memory: 16 GB RAM (12 GB minimum on low settings)',8*GIB).verdict,'below');
  assert.equal(memory('Memory: 16 GB RAM (12 GB minimum on low settings)',14*GIB).verdict,'unknown');
  assert.equal(memory('Memory: 16 GB RAM (12 GB minimum on low settings)',14*GIB).note,'unclear');
  assert.equal(memory('Memory: DDR4 - 16 GB',8*GIB).verdict,'below');
  assert.equal(memory('Memory: DDR4 - 16 GB',8*GIB).need,16*GIB);
  // Usable memory alone: every figure must be reached.
  const usable=rowOf(tier('Memory: 8 GB (16 GB for 4K)',specs({memory:{installedBytes:null,usableBytes:12*GIB}})),'memory');
  assert.equal(usable.verdict,'unknown');assert.equal(usable.note,'usable');
  const card=(directx,featureLevel)=>specs({graphics:[{name:'Example',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx,featureLevel,problem:false,main:true}]});
  const dx=(line,directx,level)=>rowOf(tier(line,card(directx,level)),'directx');
  assert.equal(dx('DirectX: Version 12 (DirectX 11 supported)',11,'11.1').verdict,'unknown');
  assert.equal(dx('DirectX: Version 12 (DirectX 11 supported)',11,'11.1').note,'unclear');
  assert.equal(dx('DirectX: Version 12 (DirectX 11 supported)',12,'12.1').verdict,'meets');
});

test('DirectX 12 at an older feature level, and versions with a minor number',()=>{
  const card=(directx,featureLevel)=>specs({graphics:[{name:'Example',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx,featureLevel,problem:false,main:true}]});
  const dx=(line,directx,level)=>rowOf(tier(line,card(directx,level)),'directx');
  const older=dx('DirectX: Version 12',12,'11.0');
  assert.equal(older.verdict,'unknown');assert.equal(older.note,'level');
  assert.equal(dx('DirectX: Version 12',12,'12.0').verdict,'meets');
  assert.equal(dx('DirectX: Version 12',12,null).verdict,'meets');
  assert.equal(dx('DirectX: Version 11.1',11,'11.0').verdict,'below');
  assert.equal(dx('DirectX: Version 11.1',12,'11.1').verdict,'meets');
  assert.equal(dx('DirectX: Version 11.1',11,null).verdict,'unknown');
  assert.equal(dx('DirectX: Version 12.',12,'12.1').verdict,'meets');
  assert.deepEqual(c.directxList('Version 12 (DirectX 11 supported)'),[{version:12,level:null},{version:11,level:null}]);
});

test('item names inside a name are not split off, and more names start items',()=>{
  assert.deepEqual(c.readTier('GPU Memory: 2 GB').items,{videoMemory:'2 GB'});
  assert.deepEqual(c.readTier('Graphics Card Memory: 1 GB\nGPU RAM: 3 GB').items,{videoMemory:'1 GB'});
  assert.deepEqual(c.readTier('Virtual Memory: 2 GB').items,{});
  assert.deepEqual(c.readTier('Graphics: Example GTX 960 HDD: 30 GB').items,{graphics:'Example GTX 960',storage:'30 GB'});
  assert.deepEqual(c.readTier('Processor: Example GPU: Example 2 GB').items,{processor:'Example',graphics:'Example 2 GB'});
  assert.equal(rowOf(tier('Graphics: Example GTX 960 HDD: 30 GB'),'videoMemory'),undefined);
});

test('on a PC that is not Windows, or after the basic check, Windows lines say Can\u2019t tell',()=>{
  const linux=specs({status:'basic',notes:['not-windows'],system:{name:'Example Linux',version:'6.1.0-18-amd64',build:null,architecture:'64-bit'}});
  const result=tier('OS: Windows 10 64-bit',linux);
  assert.equal(rowOf(result,'windows').verdict,'unknown');assert.equal(rowOf(result,'windows').have,null);
  assert.equal(rowOf(result,'bits').verdict,'unknown');
  assert.equal(rowOf(tier('OS: Windows XP',linux),'windows').verdict,'unknown');
  // The basic check on Windows: its version is Windows' own, its architecture is Ravenshelf's build.
  const basic=specs({status:'basic',notes:['probe-failed'],system:{name:'Windows',version:'10.0.22631',build:null,architecture:'64-bit'}});
  assert.equal(rowOf(tier('OS: Windows 10 64-bit',basic),'windows').verdict,'meets');
  assert.equal(rowOf(tier('OS: Windows 10 64-bit',basic),'bits').verdict,'unknown');
});

test('format and direction characters are removed from the list',()=>{
  const shown=rowOf(tier('Processor: A\u061cB\u206aC\ufff9D\u{e0041}E\u00adF'),'processor').needs;
  assert.equal(shown,'A B C D E F');
});

test('more edges: headings after items, unified memory, DirectX 9.1 and a full stop, lists that could not be loaded',()=>{
  assert.deepEqual(c.readTier('OS: Windows 10\nMemory: 8 GB\nRecommended:\nStorage: 9 GB').items,{windows:'Windows 10',memory:'8 GB'});
  const bitsFirst=c.readTier('Requires a 64-bit processor and operating system\nRecommended:\nMemory: 16 GB');
  assert.deepEqual(bitsFirst.items,{});assert.ok(bitsFirst.bits);
  assert.equal(c.graphicsMemory(['Example 680M (16 GB unified)']),null);
  const card=(directx,featureLevel)=>specs({graphics:[{name:'Example',maker:'NVIDIA',kind:'discrete',dedicatedBytes:8*GIB,directx,featureLevel,problem:false,main:true}]});
  assert.equal(rowOf(tier('DirectX: Version 9.1',card(9,null)),'directx').verdict,'meets');
  assert.equal(rowOf(tier('Graphics: Any DirectX 11.',card(11,null)),'directx').verdict,'meets');
  assert.equal(c.compareRequirements({minimum:'',recommended:''},specs(),{unavailable:true}).status,'details-unavailable');
  assert.equal(c.compareRequirements({minimum:'Memory: 8 GB',recommended:''},specs(),{unavailable:true}).status,'complete');
});

test('more edges: private-use characters, speeds and system memory in graphics lines',()=>{
  assert.equal(rowOf(tier('Processor: A\ue000B'),'processor').needs,'A B');
  assert.deepEqual(c.sizesIn('100 MB per second'),[]);
  assert.deepEqual(c.sizesIn('100 MBps'),[]);
  assert.deepEqual(c.sizesIn('100 MB/sec'),[]);
  assert.equal(c.graphicsMemory(['Example card 8 GB (4 GB system)']),8*GIB);
  assert.equal(c.graphicsMemory(['Example card, system memory of 8 GB']),null);
});
