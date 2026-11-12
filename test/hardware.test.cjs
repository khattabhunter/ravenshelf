'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const os=require('node:os');
const crypto=require('node:crypto');
const {createHardwareService,summarize,parseProbe,runProbe,PROBE_FILE,TIMEOUT_MS,MAX_OUTPUT,MIN_REFRESH_MS}=require('../src/hardware.cjs');

const MIB=1024**2,GIB=1024**3;
const NEWER='134500000000000001',OLDER='134000000000000000';
// AdapterRAM as Windows reports it for any adapter with 4 GB or more.
const CAPPED=String(4*GIB-MIB);
const osApi={version:()=>'Windows 11 Home',release:()=>'10.0.22631',arch:()=>'x64',totalmem:()=>16*GIB-256*MIB,cpus:()=>[{model:'Fallback CPU',speed:3000},{model:'Fallback CPU',speed:3000}]};
const options={osApi,now:()=>Date.UTC(2026,10,10)};
// DirectX records write their numbers in decimal.
const dx=(name,vendor,device,dedicated,type,extra={})=>({name,vendor:String(vendor),device:String(device),dedicated:String(dedicated),dedicatedSystem:'0',shared:String(8*GIB),d3d11:String(0xc100),d3d12:String(0xc200),type:String(type),seen:NEWER,...extra});
const video=(name,vendor,device,extra={})=>({name,maker:'',bus:vendor?'PCI':'',vendor,device,memory:CAPPED,driver:'1.2.3.4',inf:'oem12.inf',section:'Section042',status:'0',width:'1920',height:'1080',refresh:'144',...extra});
// A made-up laptop: the names and figures are put together for these tests and
// do not describe any one real PC.
function laptop(){
  return {schema:1,
    system:{caption:'Microsoft Windows 11 Home',version:'10.0.22631',build:'22631',architecture:'64-bit'},
    processors:[{name:'Intel(R) Core(TM) i7-12700H',cores:'14',threads:'20',megahertz:'2300'}],
    memory:{modules:[String(8*GIB),String(8*GIB)]},
    video:[video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{maker:'NVIDIA'}),video('Intel(R) Iris(R) Xe Graphics','8086','46A6',{maker:'Intel Corporation',memory:String(GIB)})],
    directx:[dx('Microsoft Basic Render Driver',0x1414,0x8c,0,0x105,{d3d12:String(0xc100)}),dx('NVIDIA GeForce RTX 3060 Laptop GPU',0x10de,0x2520,6*GIB-128*MIB,0x2313),dx('Intel(R) Iris(R) Xe Graphics',0x8086,0x46a6,128*MIB,0x232b,{d3d12:String(0xc100)})],
    drivers:[{name:'Intel(R) Iris(R) Xe Graphics',memory:String(7*GIB)},{name:'NVIDIA GeForce RTX 3060 Laptop GPU',memory:String(6*GIB)}],
    disks:[{id:'0',model:'Example NVMe 1TB',media:'4',bus:'17',spindle:'0'}],
    partitions:[{letter:'C',disk:'0'}],
    volumes:[{letter:'C:',type:'3',format:'NTFS',size:'1023000000000',free:'200000000000'}]};
}
const names=result=>result.graphics.map(adapter=>adapter.name);

test('a hybrid laptop shows its graphics card’s real memory, not the 4 GB limit Windows reports',()=>{
  const result=summarize(laptop(),options);
  assert.equal(result.status,'complete');assert.deepEqual(result.notes,[]);assert.equal(result.schema,1);
  assert.equal(result.checkedAt,'2026-11-10T00:00:00.000Z');
  assert.deepEqual(result.system,{name:'Windows 11 Home',version:'10.0.22631',build:22631,architecture:'64-bit'});
  assert.deepEqual(result.processor,{name:'Intel Core i7-12700H',sockets:1,cores:14,threads:20,megahertz:2300});
  assert.deepEqual(result.memory,{installedBytes:16*GIB,usableBytes:16*GIB-256*MIB,modules:2});
  assert.deepEqual(result.graphics,[
    {name:'NVIDIA GeForce RTX 3060 Laptop GPU',maker:'NVIDIA',kind:'discrete',dedicatedBytes:6*GIB-128*MIB,memorySource:'directx',sharedBytes:8*GIB,directx:12,featureLevel:'12.2',driver:'1.2.3.4',problem:false,main:true},
    {name:'Intel Iris Xe Graphics',maker:'Intel',kind:'integrated',dedicatedBytes:128*MIB,memorySource:'directx',sharedBytes:8*GIB,directx:12,featureLevel:'12.1',driver:'1.2.3.4',problem:false,main:false}
  ]);
  assert.deepEqual(result.display,{width:1920,height:1080,refreshHz:144});
  assert.deepEqual(result.drives,[{letter:'C',totalBytes:1023000000000,freeBytes:200000000000,format:'NTFS',removable:false,kind:'ssd',bus:'NVMe',model:'Example NVMe 1TB'}]);
});

test('Windows’ stand-in drivers and screen-only adapters are not listed as graphics hardware',()=>{
  const raw=laptop();
  raw.video.push(video('Microsoft Basic Display Adapter','',''),video('Microsoft Remote Display Adapter','',''),video('Microsoft Hyper-V Video','1414','5353'),
    video('Parsec Virtual Display Adapter','',''),video('Acme Virtual Monitor','',''),
    video('Software Renderer X','1AF4','0001'),video('Indirect Thing','1AF4','0002'),video('Screen Only Thing','1AF4','0003'),
    // Recognised by how Windows reaches them, whatever they are called.
    video('Friendly Screen Mirror','','',{bus:'ROOT'}),video('Session Screen','','',{bus:'swd'}),video('Dock Screen','','',{bus:'USB'}),video('Guest Screen','','',{bus:'VMBUS'}));
  raw.directx.push(dx('Software Renderer X',0x1af4,1,0,0x5),dx('Indirect Thing',0x1af4,2,0,0x41),dx('Screen Only Thing',0x1af4,3,0,0x2));
  const result=summarize(raw,options);
  assert.deepEqual(names(result),['NVIDIA GeForce RTX 3060 Laptop GPU','Intel Iris Xe Graphics']);
  assert.deepEqual(result.notes,['basic-display-extra'],'a device on the basic display driver beside working adapters is mentioned, not listed');
  // The same beside an adapter that Windows reports a problem with, and said once however many there are.
  const beside=summarize({...laptop(),video:[video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{status:'43'}),video('Microsoft Basic Display Adapter','',''),video('Microsoft Basic Display Adapter','','')]},options);
  assert.deepEqual([names(beside),beside.notes],[['NVIDIA GeForce RTX 3060 Laptop GPU'],['basic-display-extra']]);
  // With nothing but stand-ins next to it, the basic driver is the whole story.
  const alone=summarize({...laptop(),video:[video('Dock Screen','','',{bus:'USB'}),video('Microsoft Basic Display Adapter','',''),video('Microsoft Remote Display Adapter','','')],directx:[]},options);
  assert.deepEqual([alone.graphics,alone.notes],[[],['basic-display']]);
  assert.deepEqual(summarize(laptop(),options).notes,[],'and no note at all without it');
  // A PC whose graphics driver is missing: Windows shows only its basic driver.
  const bare={...laptop(),video:[video('Microsoft Basic Display Adapter','','',{width:'1024',height:'768',refresh:'64'})],directx:[]};
  const basic=summarize(bare,options);
  assert.deepEqual(basic.graphics,[]);assert.deepEqual(basic.notes,['basic-display']);assert.deepEqual(basic.display,{width:1024,height:768,refreshHz:64});
  // On Windows in another language the basic driver has a translated name and sits
  // on the real card's numbers. It is recognised by the setup file it came from, and
  // an old DirectX record for that card is not mistaken for a working driver.
  for(const extra of [{inf:'display.inf',section:'MSBDA'},{inf:'DISPLAY.INF',section:''},{inf:'',section:'msbda'},{inf:'basicdisplay.inf',section:'x'}]){
    const translated=summarize({...laptop(),video:[video('Carte vidéo de base Microsoft','10DE','2520',{...extra,width:'1280',height:'720',refresh:'60'})]},options);
    assert.deepEqual(translated.graphics,[],JSON.stringify(extra));assert.deepEqual(translated.notes,['basic-display']);assert.deepEqual(translated.display,{width:1280,height:720,refreshHz:60});
  }
  assert.deepEqual(names(summarize({...laptop(),video:[video('Carte graphique XYZ','10DE','2520',{inf:'oem7.inf',section:'Section001'})]},options)),['Carte graphique XYZ'],'any other setup file is a real driver');
  // A virtual machine's own adapter is real enough to list.
  const vm=summarize({...laptop(),video:[video('VMware SVGA 3D','15AD','0405',{maker:'VMware, Inc.',memory:String(256*MIB)})],directx:[]},options);
  assert.deepEqual(names(vm),['VMware SVGA 3D']);assert.equal(vm.graphics[0].maker,'VMware');assert.equal(vm.graphics[0].dedicatedBytes,256*MIB);assert.equal(vm.graphics[0].memorySource,'windows');assert.equal(vm.graphics[0].kind,'unknown');
  // A virtual machine that is lent the PC's real card sees it under Microsoft's
  // numbers; the DirectX record still names the real maker, so it is listed.
  const lent=summarize({...laptop(),video:[video('NVIDIA GeForce RTX 4070','1414','008E')],directx:[dx('Microsoft Basic Render Driver',0x1414,0x8c,0,0x105),dx('NVIDIA GeForce RTX 4070',0x10de,0x2786,12*GIB,0x83)]},options).graphics;
  assert.deepEqual(lent.map(adapter=>[adapter.name,adapter.maker,adapter.kind,adapter.dedicatedBytes]),[['NVIDIA GeForce RTX 4070','NVIDIA','discrete',12*GIB]]);
  assert.deepEqual(summarize({...laptop(),video:[video('Some Adapter','1414','008E')],directx:[]},options).graphics,[],'under Microsoft’s numbers with no record of a real card, it is a stand-in');
  // The screen size comes from a listed adapter; a stand-in's is used only when no listed adapter has one.
  const sizes=summarize({...laptop(),video:[video('Dock Screen','','',{bus:'USB',width:'800',height:'600',refresh:'60'}),video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{width:'2560',height:'1440',refresh:'165'})]},options);
  assert.deepEqual(sizes.display,{width:2560,height:1440,refreshHz:165});
  const headless=summarize({...laptop(),video:[video('Dock Screen','','',{bus:'USB',width:'800',height:'600',refresh:'60'}),video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{width:'',height:'',refresh:''})]},options);
  assert.deepEqual(headless.display,{width:800,height:600,refreshHz:60});assert.equal(headless.graphics.length,1);
});

test('without DirectX records, graphics memory comes only from a source that means memory of the card’s own',()=>{
  const raw={...laptop(),directx:[]};
  raw.video.push(video('AMD Radeon RX 6700 XT','1002','73DF',{maker:'Advanced Micro Devices, Inc.'}),video('Old Card 2GB','10DE','1380',{memory:String(2*GIB)}),video('Mystery Adapter','ABCD','0001',{maker:'Mystery Corp.'}),
    video('AMD Radeon HD 7700 Series','1002','683F',{memory:String(GIB)}));
  raw.drivers.push({name:'AMD Radeon RX 6700 XT',memory:String(12*GIB)},{name:'Mystery Adapter',memory:String(3*GIB)});
  const byName=Object.fromEntries(summarize(raw,options).graphics.map(adapter=>[adapter.name,adapter]));
  const facts=name=>[byName[name].dedicatedBytes,byName[name].memorySource,byName[name].kind,byName[name].maker];
  assert.deepEqual(facts('NVIDIA GeForce RTX 3060 Laptop GPU'),[6*GIB,'driver','discrete','NVIDIA']);
  assert.deepEqual(facts('AMD Radeon RX 6700 XT'),[12*GIB,'driver','unknown','AMD']);
  // For Intel graphics neither the driver's figure nor Windows' is memory of its own, so none is shown.
  assert.deepEqual(facts('Intel Iris Xe Graphics'),[null,null,'unknown','Intel']);
  assert.deepEqual(facts('Old Card 2GB'),[2*GIB,'windows','discrete','NVIDIA']);
  assert.deepEqual(facts('AMD Radeon HD 7700 Series'),[GIB,'windows','unknown','AMD'],'an older card with little memory is not called built-in');
  // At the 4 GB limit with no trusted source, the memory is unknown rather than wrong.
  assert.deepEqual(facts('Mystery Adapter'),[null,null,'unknown','Mystery']);
  for(const adapter of Object.values(byName)){assert.equal(adapter.directx,null);assert.equal(adapter.featureLevel,null);assert.equal(adapter.sharedBytes,null);}
  // A driver figure outside any real card's range is ignored.
  for(const memory of [String(64*MIB),String(300*GIB)]){
    const odd=summarize({...laptop(),directx:[],drivers:[{name:'NVIDIA GeForce RTX 3060 Laptop GPU',memory}]},options);
    assert.equal(odd.graphics[0].dedicatedBytes,null,memory);
  }
});

test('a card is called built-in or separate only when that is certain',()=>{
  const kind=(vendor,dedicated,type=0x3,name='Adapter')=>summarize({...laptop(),video:[video(name,vendor,'0001')],directx:[dx(name,parseInt(vendor,16),1,dedicated,type)]},options).graphics[0].kind;
  // Windows says which is which on laptops that have both.
  assert.equal(kind('1002',512*MIB,0x2313),'discrete');assert.equal(kind('1002',8*GIB,0x232b),'integrated');
  assert.equal(kind('8086',128*MIB,0x2313),'discrete','what Windows says outranks every rule of thumb');
  // A record that claims to be both says nothing, so the rules below decide.
  assert.equal(kind('1002',8*GIB,0x2333),'unknown');assert.equal(kind('10DE',8*GIB,0x2333),'discrete');assert.equal(kind('8086',128*MIB,0x2333),'integrated');
  // Newer versions of Windows add higher bits to this number; they do not hide the ones read here.
  assert.equal(kind('1002',512*MIB,0x12313),'discrete');assert.equal(kind('1002',8*GIB,0x8000232b),'integrated');assert.equal(kind('1002',512*MIB,0xffffff9b),'discrete');
  assert.equal(kind('1002',512*MIB,2**32+0x13),'unknown','a number too large to be this field is not read at all');
  // NVIDIA: an adapter with 2 GB or more of its own is a card. Below that it may be an old card
  // or graphics built into an old motherboard, so it is not guessed.
  assert.equal(kind('10DE',2*GIB),'discrete');assert.equal(kind('10DE',24*GIB),'discrete');
  assert.equal(kind('10DE',2*GIB-1),'unknown');assert.equal(kind('10DE',512*MIB),'unknown');assert.equal(kind('10DE',0),'unknown');
  assert.equal(kind('10DE',256*MIB,0x232b),'integrated');assert.equal(kind('10DE',256*MIB,0x2313),'discrete');
  // Intel: built-in graphics have almost no memory of their own; its cards have gigabytes.
  assert.equal(kind('8086',0),'integrated');assert.equal(kind('8086',128*MIB),'integrated');assert.equal(kind('8086',GIB-1),'integrated');
  assert.equal(kind('8086',GIB),'unknown');assert.equal(kind('8086',2*GIB-1),'unknown');
  assert.equal(kind('8086',2*GIB),'discrete');assert.equal(kind('8086',16*GIB),'discrete');
  // AMD makes both, with every amount of memory, so it is never guessed. Nor is any other maker.
  for(const dedicated of [0,512*MIB,GIB-1,GIB,4*GIB,24*GIB])assert.equal(kind('1002',dedicated),'unknown',String(dedicated));
  assert.equal(kind('15AD',256*MIB),'unknown');assert.equal(kind('1AF4',0),'unknown');
});

test('of several DirectX records the right one is used, and the main adapter is the one games use',()=>{
  const raw=laptop();
  raw.directx.push(dx('NVIDIA GeForce RTX 3060 Laptop GPU',0x10de,0x2520,2*GIB,0x2313,{seen:OLDER}));
  assert.equal(summarize(raw,options).graphics[0].dedicatedBytes,6*GIB-128*MIB,'the newest record');
  raw.directx.reverse();
  assert.equal(summarize(raw,options).graphics[0].dedicatedBytes,6*GIB-128*MIB,'the order of the records does not matter');
  // Two records of the same age for the same numbers (a 4 GB card swapped for the 8 GB one):
  // the adapter's exact name decides, then the memory the current driver reports.
  const swapped=(records,drivers=[])=>summarize({...laptop(),video:[video('Radeon RX 480 Graphics','1002','67DF')],directx:records,drivers},options).graphics[0].dedicatedBytes;
  assert.equal(swapped([dx('Radeon (TM) RX 480',0x1002,0x67df,4*GIB,0x3),dx('Radeon RX 480 Graphics',0x1002,0x67df,8*GIB,0x3)]),8*GIB);
  assert.equal(swapped([dx('Radeon RX 480 Graphics',0x1002,0x67df,8*GIB,0x3),dx('Radeon (TM) RX 480',0x1002,0x67df,4*GIB,0x3)]),8*GIB);
  const same=[dx('Radeon RX 480 Graphics',0x1002,0x67df,4*GIB-64*MIB,0x3),dx('Radeon RX 480 Graphics',0x1002,0x67df,8*GIB-64*MIB,0x3)];
  assert.equal(swapped(same,[{name:'Radeon RX 480 Graphics',memory:String(8*GIB)}]),8*GIB-64*MIB);
  assert.equal(swapped([...same].reverse(),[{name:'Radeon RX 480 Graphics',memory:String(8*GIB)}]),8*GIB-64*MIB);
  assert.equal(swapped(same,[{name:'Radeon RX 480 Graphics',memory:String(4*GIB)}]),4*GIB-64*MIB);
  assert.equal(swapped(same),4*GIB-64*MIB,'with nothing to tell them apart, the first');
  assert.equal(swapped([{...same[0],seen:''},{...same[1],seen:''}],[{name:'Radeon RX 480 Graphics',memory:String(8*GIB)}]),8*GIB-64*MIB,'records without a date are compared the same way');
  // The exact name comes before the driver's figure: a record under another name does not win by being closer to it.
  const renamed=[dx('Radeon RX 480 Graphics',0x1002,0x67df,4*GIB,0x3),dx('Radeon (TM) RX 480',0x1002,0x67df,8*GIB,0x3)];
  assert.equal(swapped(renamed,[{name:'Radeon RX 480 Graphics',memory:String(8*GIB)}]),4*GIB);
  assert.equal(swapped([...renamed].reverse(),[{name:'Radeon RX 480 Graphics',memory:String(8*GIB)}]),4*GIB);
  // A record without a memory figure is never the closer one.
  const blank=[dx('Radeon RX 480 Graphics',0x1002,0x67df,'',0x3),dx('Radeon RX 480 Graphics',0x1002,0x67df,16*GIB,0x3)];
  assert.equal(swapped(blank,[{name:'Radeon RX 480 Graphics',memory:String(6*GIB)}]),16*GIB);
  assert.equal(swapped([...blank].reverse(),[{name:'Radeon RX 480 Graphics',memory:String(6*GIB)}]),16*GIB);
  const twin={...laptop(),video:[video('NVIDIA GeForce RTX 4090','10DE','2684'),video('NVIDIA GeForce RTX 4090','10DE','2684')],directx:[dx('NVIDIA GeForce RTX 4090',0x10de,0x2684,24*GIB,0x3)]};
  const twins=summarize(twin,options).graphics;
  assert.equal(twins.length,2);assert.deepEqual(twins.map(adapter=>adapter.dedicatedBytes),[24*GIB,24*GIB]);assert.deepEqual(twins.map(adapter=>adapter.main),[true,false],'exactly one main adapter');
  // Matching falls back to the name when the numbers find nothing.
  const named=summarize({...laptop(),video:[video('Some Card','','')],directx:[dx('SOME CARD',0x1002,1,8*GIB,0x3)]},options).graphics[0];
  assert.deepEqual([named.dedicatedBytes,named.maker,named.kind],[8*GIB,'AMD','unknown']);
  const renumbered=summarize({...laptop(),video:[video('Some Card','1002','9999')],directx:[dx('Some Card',0x1002,1,8*GIB,0x3),dx('Other Card',0x1002,0x9999,2*GIB,0x3)]},options).graphics[0];
  assert.equal(renumbered.dedicatedBytes,2*GIB,'the numbers come first');
  assert.equal(summarize({...laptop(),video:[video('Some Card','1002','9999')],directx:[dx('Some Card',0x1002,1,8*GIB,0x3)]},options).graphics[0].dedicatedBytes,8*GIB);
  // On ARM PCs DirectX gives the maker as four letters; the name still matches.
  const arm=summarize({...laptop(),video:[video('Qualcomm(R) Adreno(TM) X1-85 GPU','','',{bus:'ACPI',maker:'Qualcomm Incorporated'})],directx:[dx('Qualcomm(R) Adreno(TM) X1-85 GPU',0x4d4f4351,0x36334330,0,0x3)]},options).graphics[0];
  assert.deepEqual([arm.name,arm.maker,arm.dedicatedBytes,arm.sharedBytes,arm.kind,arm.directx],['Qualcomm Adreno X1-85 GPU','Qualcomm',0,8*GIB,'unknown',12]);
  // The main adapter: a separate card before built-in graphics, whatever their memory.
  const order=adapters=>summarize({...laptop(),...adapters},options).graphics.map(adapter=>[adapter.kind,adapter.main]);
  assert.deepEqual(order({video:[video('AMD Radeon(TM) Graphics','1002','164E'),video('NVIDIA GeForce RTX 4070','10DE','2786')],
    directx:[dx('AMD Radeon(TM) Graphics',0x1002,0x164e,512*MIB,0x10b),dx('NVIDIA GeForce RTX 4070',0x10de,0x2786,12*GIB,0x3)]}),[['unknown',false],['discrete',true]]);
  assert.deepEqual(order({video:[video('AMD Radeon(TM) 780M','1002','15BF'),video('NVIDIA GeForce RTX 3050','10DE','25A2')],
    directx:[dx('AMD Radeon(TM) 780M',0x1002,0x15bf,4*GIB-32*MIB,0x232b),dx('NVIDIA GeForce RTX 3050',0x10de,0x25a2,4*GIB-128*MIB,0x2313)]}),[['integrated',false],['discrete',true]],'built-in graphics given more memory than the card');
  assert.deepEqual(order({video:[video('AMD Radeon(TM) Graphics','1002','164E'),video('AMD Radeon RX 7600','1002','7480')],
    directx:[dx('AMD Radeon(TM) Graphics',0x1002,0x164e,2*GIB,0x3),dx('AMD Radeon RX 7600',0x1002,0x7480,8*GIB,0x3)]}),[['unknown',false],['unknown',true]],'between two unknowns, the one with more memory of its own');
  assert.deepEqual(order({video:[video('First','ABCD','0001'),video('Second','ABCD','0002')],directx:[]}),[['unknown',true],['unknown',false]],'with nothing to choose by, the first listed');
  // Intel's graphics cards have gigabytes of their own memory.
  assert.equal(summarize({...laptop(),video:[video('Intel(R) Arc(TM) A770 Graphics','8086','56A0')],directx:[dx('Intel(R) Arc(TM) A770 Graphics',0x8086,0x56a0,16*GIB,0x3)]},options).graphics[0].kind,'discrete');
});

test('a disabled card or one with a driver problem is marked, and is not credited with what DirectX once recorded',()=>{
  const status=value=>summarize({...laptop(),video:[video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{status:value}),video('Intel(R) Iris(R) Xe Graphics','8086','46A6')]},options).graphics;
  for(const value of ['22','43','28','1']){
    const [card,builtIn]=status(value);
    assert.deepEqual([card.problem,card.directx,card.featureLevel,card.main],[true,null,null,false],value);
    assert.equal(card.dedicatedBytes,6*GIB-128*MIB,'its memory is still a fact about the card');
    assert.deepEqual([builtIn.problem,builtIn.main,builtIn.directx],[false,true,12],'the working adapter is the main one');
  }
  for(const value of ['0','','abc','-1','1.5',undefined,null,{}]){
    const [card]=status(value);
    assert.deepEqual([card.problem,card.directx,card.main],[false,12,true],`${String(value)}: only a clear problem code counts`);
  }
  const only=summarize({...laptop(),video:[video('NVIDIA GeForce RTX 3060 Laptop GPU','10DE','2520',{status:'43'})]},options).graphics;
  assert.deepEqual([only[0].problem,only[0].main],[true,true],'a PC’s only adapter is still its main one');
});

test('Direct3D levels map to the DirectX version a game can ask for',()=>{
  const level=(d3d11,d3d12)=>{const adapter=summarize({...laptop(),video:[video('Card','10DE','0001')],directx:[dx('Card',0x10de,1,GIB,0x3,{d3d11:String(d3d11),d3d12:String(d3d12)})]},options).graphics[0];return [adapter.directx,adapter.featureLevel];};
  assert.deepEqual(level(0xc100,0xc200),[12,'12.2']);
  assert.deepEqual(level(0xb100,0xb000),[12,'11.0'],'DirectX 12 runs on feature level 11.0 hardware');
  assert.deepEqual(level(0xb100,0),[11,'11.1']);
  assert.deepEqual(level(0xb000,''),[11,'11.0']);
  assert.deepEqual(level(0xa100,0),[10,'10.1']);
  assert.deepEqual(level(0x9300,0),[9,'9.3']);
  assert.deepEqual(level(0,0),[null,null]);
  assert.deepEqual(level(12345,67890),[null,null],'unknown level numbers are not guessed');
  // The level shown is the one of the version shown, never the other record's.
  assert.deepEqual(level(0xb100,0xa000),[11,'11.1']);assert.deepEqual(level(0x9300,0xa100),[9,'9.3']);
  assert.deepEqual(level(0,0xc000),[12,'12.0'],'a Direct3D 12 record alone is enough');
  assert.deepEqual(level(0,0xa000),[null,null]);
  // A Direct3D 12 level newer than the newest one known here is still DirectX 12; only its name is left out.
  assert.deepEqual(level(0xc100,0xc300),[12,null]);assert.deepEqual(level(0xc100,0xc201),[12,null]);assert.deepEqual(level(0,0xffff),[12,null]);
  // A number between the known levels is not a level, and one too large to be this field is not read.
  assert.deepEqual(level(0xb100,0xb200),[11,'11.1']);assert.deepEqual(level(0xb100,0xc1ff),[11,'11.1']);assert.deepEqual(level(0xb100,0x10000),[11,'11.1']);
  assert.deepEqual(level(0xc300,0),[null,null],'the Direct3D 11 record is not read that way');
});

test('installed memory is the sum of the modules unless it contradicts what Windows can use',()=>{
  // Usable memory is what Node reports for this PC; the probe adds the module sizes.
  const memory=(modules,usable)=>summarize({...laptop(),memory:modules===undefined?undefined:{modules}},{...options,osApi:{...osApi,totalmem:()=>usable}}).memory;
  assert.deepEqual(memory([String(16*GIB)],15*GIB),{installedBytes:16*GIB,usableBytes:15*GIB,modules:1});
  assert.deepEqual(memory(String(16*GIB),15*GIB),{installedBytes:16*GIB,usableBytes:15*GIB,modules:1},'PowerShell writes a one-item list as a single value');
  assert.deepEqual(memory([String(8*GIB)],16*GIB),{installedBytes:null,usableBytes:16*GIB,modules:null},'fewer modules than usable memory');
  assert.deepEqual(memory([String(64*GIB)],4*GIB),{installedBytes:null,usableBytes:4*GIB,modules:null},'a virtual machine’s maximum');
  assert.deepEqual(memory([],15*GIB),{installedBytes:null,usableBytes:15*GIB,modules:null});
  assert.deepEqual(memory(['x','-1','1.5',null],8*GIB),{installedBytes:null,usableBytes:8*GIB,modules:null});
  assert.deepEqual(memory(undefined,8*GIB),{installedBytes:null,usableBytes:8*GIB,modules:null});
  // The probe no longer says how much memory Windows can use, and a value claiming to is ignored.
  assert.deepEqual(summarize({...laptop(),memory:{usable:String(GIB),modules:[String(16*GIB)]}},options).memory,{installedBytes:16*GIB,usableBytes:16*GIB-256*MIB,modules:2-1});
  // Memory set aside for built-in graphics is installed but not usable: both are shown.
  assert.deepEqual(memory([String(4*GIB),String(4*GIB)],6*GIB-200*MIB),{installedBytes:8*GIB,usableBytes:6*GIB-200*MIB,modules:2});
  for(const totalmem of [()=>{throw new Error('no');},()=>null,()=>-1,()=>1.5,()=>'x',()=>2**51])assert.equal(summarize({...laptop(),memory:null},{osApi:{totalmem},now:()=>0}).memory,null);
  assert.equal(summarize({...laptop(),memory:null},{osApi:{},now:()=>0}).memory,null);
});

test('drives show their type, connection and free space, and unreadable volumes are left out',()=>{
  const raw={...laptop(),
    disks:[{id:'0',model:'  Fast\tNVMe  ',media:'0',bus:'17',spindle:'0',size:'1'},{id:'1',model:'Big HDD',media:'3',bus:'11',spindle:'4294967295',size:'1'},{id:'2',model:'Old HDD',media:'0',bus:'11',spindle:'7200',size:'1'},
      {id:'3',model:'SATA SSD',media:'4',bus:'11',spindle:'0',size:'1'},{id:'4',model:'USB Stick',media:'0',bus:'7',spindle:'4294967295',size:'1'},{id:'5',model:'Optane',media:'5',bus:'17',spindle:'0',size:'1'},{id:'0',model:'Duplicate',media:'3',bus:'11',spindle:'0',size:'1'}],
    partitions:[{letter:'c',disk:'0'},{letter:'D',disk:'1'},{letter:'E',disk:'2'},{letter:'F',disk:'3'},{letter:'G',disk:'4'},{letter:'H',disk:'5'},{letter:'I',disk:'99'},{letter:'??',disk:'0'}],
    volumes:[{letter:'G:',type:'2',format:'exFAT',size:'32000000000',free:'1000'},{letter:'d:',type:'3',format:'NTFS',size:'4000000000000',free:'5000000000000'},{letter:'C:',type:'3',format:'NTFS',size:'500000000000',free:'0'},
      {letter:'E:',type:'3',format:'NTFS',size:'1000',free:'10'},{letter:'F:',type:'3',format:'NTFS',size:'1000',free:''},{letter:'H:',type:'3',format:'ReFS',size:'1000',free:'1'},{letter:'I:',type:'3',format:'NTFS',size:'1000',free:'1'},
      {letter:'J:',type:'3',format:'',size:'',free:''},{letter:'K:',type:'3',format:'NTFS',size:'0',free:'0'},{letter:'C:',type:'3',format:'FAT',size:'5',free:'5'},{letter:'ZZ:',type:'3',format:'NTFS',size:'5',free:'5'},{letter:'',size:'5'}]};
  assert.deepEqual(summarize(raw,options).drives,[
    {letter:'C',totalBytes:500000000000,freeBytes:0,format:'NTFS',removable:false,kind:'ssd',bus:'NVMe',model:'Fast NVMe'},
    {letter:'D',totalBytes:4000000000000,freeBytes:null,format:'NTFS',removable:false,kind:'hdd',bus:'SATA',model:'Big HDD'},
    {letter:'E',totalBytes:1000,freeBytes:10,format:'NTFS',removable:false,kind:'hdd',bus:'SATA',model:'Old HDD'},
    {letter:'F',totalBytes:1000,freeBytes:null,format:'NTFS',removable:false,kind:'ssd',bus:'SATA',model:'SATA SSD'},
    {letter:'G',totalBytes:32000000000,freeBytes:1000,format:'exFAT',removable:true,kind:'unknown',bus:'USB',model:'USB Stick'},
    {letter:'H',totalBytes:1000,freeBytes:1,format:'ReFS',removable:false,kind:'ssd',bus:'NVMe',model:'Optane'},
    {letter:'I',totalBytes:1000,freeBytes:1,format:'NTFS',removable:false,kind:'unknown',bus:'',model:''}
  ]);
  assert.deepEqual(summarize({...laptop(),disks:'x',partitions:null,volumes:{letter:'C:',type:'3',format:'NTFS',size:'10',free:'4'}},options).drives,
    [{letter:'C',totalBytes:10,freeBytes:4,format:'NTFS',removable:false,kind:'unknown',bus:'',model:''}]);
  // One SSD behind Intel's storage driver reports "RAID": the drive type is shown without that word.
  const raid=summarize({...laptop(),disks:[{id:'0',model:'Example NVMe',media:'4',bus:'8',spindle:'0'}],connections:[{disk:'0',bus:'8'}]},options).drives[0];
  assert.deepEqual([raid.kind,raid.bus,raid.model],['ssd','','Example NVMe']);
  // A drive's details are trusted only when both of Windows' lists agree on how that disk is connected.
  const disagree=summarize({...laptop(),disks:[{id:'0',model:'A SATA hard disk',media:'3',bus:'11',spindle:'7200'}],connections:[{disk:'0',bus:'17'}]},options).drives[0];
  assert.deepEqual([disagree.kind,disagree.bus,disagree.model],['unknown','NVMe',''],'details that may belong to another drive are not shown');
  const agree=summarize({...laptop(),connections:[{disk:'0',bus:'17'},{disk:'0',bus:'11'}]},options).drives[0];
  assert.deepEqual([agree.kind,agree.bus],['ssd','NVMe'],'the first line for a disk number counts');
  // The same when Windows lists no drive under that disk's number: only the connection is named.
  const absent=connections=>{const drive=summarize({...laptop(),disks:[],connections},options).drives[0];return [drive.kind,drive.bus,drive.model];};
  assert.deepEqual(absent([{disk:'0',bus:'7'}]),['unknown','USB','']);assert.deepEqual(absent([{disk:'0',bus:'17'}]),['unknown','NVMe','']);
  assert.deepEqual(absent([{disk:'0',bus:'8'}]),['unknown','',''],'a connection without a name worth showing');
  assert.deepEqual(absent([]),['unknown','','']);
  for(const connections of [undefined,[],[{disk:'1',bus:'11'}],[{disk:'0',bus:'x'}],'x'])assert.deepEqual([summarize({...laptop(),connections},options).drives[0].kind,summarize({...laptop(),connections},options).drives[0].bus],['ssd','NVMe'],'without a second opinion the drive’s own details stand');
  // A Storage Spaces disk shares its number with one of the drives it is made of; that drive does not describe it.
  const pool={...laptop(),disks:[{id:'0',model:'Boot SSD',media:'4',bus:'17',spindle:'0',size:'1'},{id:'1',model:'Pool Member HDD',media:'3',bus:'11',spindle:'7200',size:'1'}],
    connections:[{disk:'0',bus:'17'},{disk:'1',bus:'16'}],partitions:[{letter:'C',disk:'0'},{letter:'D',disk:'1'}],
    volumes:[{letter:'C:',type:'3',format:'NTFS',size:'100',free:'1'},{letter:'D:',type:'3',format:'ReFS',size:'200',free:'2'}]};
  assert.deepEqual(summarize(pool,options).drives.map(drive=>[drive.letter,drive.kind,drive.bus,drive.model]),[['C','ssd','NVMe','Boot SSD'],['D','unknown','Storage Spaces','']]);
  // The same when the entry under the pool's disk number says "Storage Spaces" itself.
  assert.deepEqual(summarize({...pool,disks:[pool.disks[0],{id:'1',model:'Pool Disk',media:'4',bus:'16',spindle:'0'}]},options).drives.map(drive=>[drive.letter,drive.kind,drive.bus,drive.model]),[['C','ssd','NVMe','Boot SSD'],['D','unknown','Storage Spaces','']]);
  // The same when no drive shares the pool's disk number.
  assert.deepEqual(summarize({...pool,disks:[pool.disks[0]]},options).drives.map(drive=>[drive.letter,drive.kind,drive.bus,drive.model]),[['C','ssd','NVMe','Boot SSD'],['D','unknown','Storage Spaces','']]);
});

test('processor totals cover every socket and fall back to Node when Windows gives none',()=>{
  const two=summarize({...laptop(),processors:[{name:'Xeon A',cores:'8',threads:'16',megahertz:'2100'},{name:'Xeon A',cores:'8',threads:'16',megahertz:'2100'}]},options).processor;
  assert.deepEqual(two,{name:'Xeon A',sockets:2,cores:16,threads:32,megahertz:2100});
  assert.deepEqual(summarize({...laptop(),processors:{name:'Solo',cores:'4',threads:'x',megahertz:''}},options).processor,{name:'Solo',sockets:1,cores:4,threads:null,megahertz:null});
  assert.deepEqual(summarize({...laptop(),processors:[{name:'',cores:'4'}]},options).processor,{name:'Fallback CPU',sockets:null,cores:null,threads:2,megahertz:3000});
  assert.equal(summarize({...laptop(),processors:[]},{osApi:{cpus:()=>{throw new Error('no');}},now:()=>0}).processor,null);
});

test('text from Windows is cleaned and limited, and numbers must be plain whole numbers',()=>{
  const raw=laptop();
  raw.processors=[{name:'  Weird\u0000 CPU\r\n\twith   spaces \ufffd '+'x'.repeat(300),cores:'12abc',threads:' 24 ',megahertz:'3.5'}];
  raw.system={caption:'Microsoft Windows 11\u0007 Home',version:'10.0.'+'9'.repeat(100),build:'-5',architecture:{}};
  raw.video=[video('Card\u001b[31m One','10DE','1',{driver:'d'.repeat(100),width:'1e3',height:'1080',refresh:'99999'})];raw.directx=[];raw.drivers=[];
  const result=summarize(raw,options);
  assert.equal(result.processor.name.length,120);assert.match(result.processor.name,/^Weird CPU with spaces x+$/);
  assert.deepEqual([result.processor.cores,result.processor.threads,result.processor.megahertz],[null,24,null]);
  assert.equal(result.system.name,'Windows 11 Home');assert.equal(result.system.version.length,40);assert.equal(result.system.build,null);assert.equal(result.system.architecture,'64-bit');
  assert.equal(result.graphics[0].name,'Card [31m One');assert.equal(result.graphics[0].driver.length,40);assert.equal(result.graphics[0].maker,'NVIDIA');
  assert.equal(result.display,null,'a size that is not a whole number is not shown');
  // Every text in the answer, looked at one by one (JSON text would hide control characters as escapes).
  const texts=[];(function collect(value){if(typeof value==='string')texts.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collect);})(result);
  assert.ok(texts.length>10);
  for(const value of texts)assert.doesNotMatch(value,/[\x00-\x1f\x7f-\x9f\ufffd]/,JSON.stringify(value));
  // Characters that reverse, hide or join text cannot make one name read as another.
  const name=value=>summarize({...laptop(),video:[video(value,'8086','0001')],directx:[]},options).graphics[0].name;
  assert.equal(name('Intel UHD \u202e0905 XTR ecroFeG AIDIVN'),'Intel UHD 0905 XTR ecroFeG AIDIVN');
  assert.equal(name('A\u200bB\u200fC\u2066D\u2069E\ufeffF\u00adG\u061cH\u2028I\u2029J'),'A B C D E F G H I J');
  assert.equal(name('Tag\udb40\udc41s and half \ud83d pairs \ude00'),'Tag s and half pairs');
  assert.equal(name('Private \ue000 use'),'Private use');
  assert.equal(name('\u0643\u0631\u062a \u0627\u0644\u0634\u0627\u0634\u0629 \u2014 \u663e\u5361'),'\u0643\u0631\u062a \u0627\u0644\u0634\u0627\u0634\u0629 \u2014 \u663e\u5361','letters of any script are kept');
  // A cut never leaves half a character, and a huge value is not read past its start.
  const long=name('\ud83d\ude00'.repeat(200));
  assert.equal(Array.from(long).length,120);assert.equal(long,'\ud83d\ude00'.repeat(120));
  assert.equal(name('x'.repeat(5000)+'\u202e').length,120);
  assert.deepEqual(summarize({...laptop(),video:[video(' '.repeat(4096)+'Late name','8086','0001')],directx:[]},options).graphics,[],'only the first 4,096 characters are looked at');
});

test('model names lose their trademark marks and nothing else',()=>{
  const name=value=>summarize({...laptop(),processors:[{name:value,cores:'4',threads:'8',megahertz:'3000'}]},options).processor.name;
  assert.equal(name('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz'),'Intel Core i7-9750H CPU @ 2.60GHz');
  assert.equal(name('AMD Ryzen 7 5800X 8-Core Processor'),'AMD Ryzen 7 5800X 8-Core Processor');
  assert.equal(name('Intel\u00ae Core\u2122 Ultra 7 (r) (tm) 155H'),'Intel Core Ultra 7 155H');
  assert.equal(name('Snapdragon(R) X Elite - X1E80100 - Qualcomm(R) Oryon(TM) CPU'),'Snapdragon X Elite - X1E80100 - Qualcomm Oryon CPU');
  assert.equal(name('(R)'),'(R)','a name made only of marks is kept as it is');
  assert.equal(name('Model (Rev 2) (TMX)'),'Model (Rev 2) (TMX)','other brackets are left alone');
  // The fallback from Node is tidied the same way.
  assert.equal(summarize(null,{...options,osApi:{...osApi,cpus:()=>[{model:'Intel(R) Xeon(R) Gold',speed:2000}]}}).processor.name,'Intel Xeon Gold');
  // Graphics names too, and records still match on the untidied name.
  const card=summarize({...laptop(),video:[video('AMD Radeon(TM) RX 7600','','')],directx:[dx('AMD Radeon(TM) RX 7600',0x1002,0x7480,8*GIB,0x3)]},options).graphics[0];
  assert.deepEqual([card.name,card.dedicatedBytes],['AMD Radeon RX 7600',8*GIB]);
});

test('an answer of the wrong shape never throws and gives the basic result',()=>{
  for(const raw of [null,undefined,'text',42,[],[laptop()],{},{...laptop(),schema:2},{schema:1},{schema:1,system:[],processors:'',video:'card',directx:{name:{}},drivers:[null,7,'x'],disks:[[]],partitions:[{letter:{}}],volumes:[null,{letter:['C:']}],memory:[]},
    JSON.parse('{"schema":1,"__proto__":{"polluted":true},"system":{"__proto__":{"caption":"x"}},"video":[{"__proto__":{"name":"x"}}]}')]){
    const result=summarize(raw,options);
    assert.equal(result.status,'basic');assert.deepEqual(result.notes,['probe-failed']);
    assert.deepEqual(result.graphics,[]);assert.deepEqual(result.drives,[]);assert.equal(result.display,null);
    assert.deepEqual(result.processor,{name:'Fallback CPU',sockets:null,cores:null,threads:2,megahertz:3000});
    assert.deepEqual(result.system,{name:'Windows 11 Home',version:'10.0.22631',build:null,architecture:'64-bit'});
  }
  assert.equal({}.polluted,undefined);
  // Some PCs write every list as {value:[…],Count:n}.
  const wrapped=laptop();for(const key of ['processors','video','directx','drivers','disks','partitions','volumes'])wrapped[key]={value:wrapped[key],Count:wrapped[key].length};
  wrapped.memory.modules={value:wrapped.memory.modules,Count:2};
  assert.deepEqual(summarize(wrapped,options),summarize(laptop(),options));
  assert.deepEqual(summarize(null,{...options,windows:false}).notes,['not-windows']);
  const empty=summarize(null,{osApi:{},now:()=>0});
  assert.deepEqual([empty.system,empty.processor,empty.memory],[{name:'Windows',version:'',build:null,architecture:''},null,null]);
});

test('the probe’s answer must be its own JSON object',()=>{
  assert.deepEqual(parseProbe('\uFEFF  {"schema":1,"system":{}}\r\n'),{schema:1,system:{}});
  for(const bad of ['','not json','[]','null','{"schema":2}','{"schema":"1"}','{"schema":1}{"schema":1}','#< CLIXML'])assert.throws(()=>parseProbe(bad));
});

function fakeChild(){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.killed=0;child.kill=()=>{child.killed++;};
  return child;
}
test('the probe runs Windows PowerShell from System32 with the fixed script and no input',async()=>{
  const calls=[];let child;
  const promise=runProbe({systemRoot:'D:\\Win',spawnImpl:(file,args,settings)=>{calls.push({file,args,settings});child=fakeChild();return child;}});
  child.stdout.emit('data',Buffer.from('{"schema":1,'));child.stdout.emit('data',Buffer.from('"system":{"caption":"Windows \u00e9"}}'));child.emit('close',0);
  assert.equal(await promise,'{"schema":1,"system":{"caption":"Windows \u00e9"}}');
  assert.equal(calls.length,1);
  assert.equal(calls[0].file,'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0].args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
  assert.equal(calls[0].args.length,5);
  assert.equal(Buffer.from(calls[0].args[4],'base64').toString('utf16le'),fs.readFileSync(PROBE_FILE,'utf8'),'exactly the bundled script, with nothing added');
  const {env,...settings}=calls[0].settings;
  assert.deepEqual(settings,{windowsHide:true,stdio:['ignore','pipe','ignore']},'hidden, no input, errors discarded');
  // PowerShell finds its commands in Windows' own folder only.
  assert.equal(env.PSModulePath,'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules');
  const planted=runProbe({systemRoot:'D:\\Win',env:{PSModulePath:'C:\\Users\\Someone\\Documents\\WindowsPowerShell\\Modules',TEMP:'T'},spawnImpl:(file,args,options)=>{calls.push({file,args,settings:options});child=fakeChild();return child;}});
  child.emit('close',0);await planted;
  assert.deepEqual(calls[1].settings.env,{PSModulePath:'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules',TEMP:'T'},'a module folder from the environment is replaced, the rest is passed on');
  assert.equal(child.killed,0);
  // Windows compares the names of environment variables without case, and of two spellings only one reaches
  // the program. So every spelling is left out, and exactly one is passed on: Ravenshelf's.
  const inherited={PSMODULEPATH:'X:\\one',psmodulepath:'X:\\two',PsModulePath:'X:\\three',PSModulePath:'X:\\four',PSModulePath2:'kept',Path:'P'};
  const before=JSON.stringify(inherited);
  const spelled=runProbe({systemRoot:'D:\\Win',env:inherited,spawnImpl:(file,args,options)=>{calls.push({file,args,settings:options});child=fakeChild();return child;}});
  child.emit('close',0);await spelled;
  assert.deepEqual(Object.entries(calls[2].settings.env).sort(),[['PSModulePath','D:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules'],['PSModulePath2','kept'],['Path','P']].sort());
  assert.notEqual(calls[2].settings.env,inherited);assert.equal(JSON.stringify(inherited),before,'the app’s own environment is left as it was');
  for(const env of [null,{}]){
    const empty=runProbe({systemRoot:'D:\\Win',env,spawnImpl:(file,args,options)=>{calls.push({file,args,settings:options});child=fakeChild();return child;}});
    child.emit('close',0);await empty;
    assert.deepEqual(calls.at(-1).settings.env,{PSModulePath:'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\Modules'});
  }
  // Windows' folder is taken from the environment only as a full path on a drive. Anything else could
  // point at a folder next to wherever Ravenshelf was started, or at another computer.
  const started=async systemRoot=>{
    let file,modules;
    const probe=runProbe({systemRoot,spawnImpl:(executable,args,options)=>{file=executable;modules=options.env.PSModulePath;child=fakeChild();return child;},env:{}});
    child.emit('close',0);await probe;
    assert.equal(modules,file.replace(/powershell\.exe$/,'Modules'),'the module folder is the one beside that PowerShell');
    return file;
  };
  assert.equal(await started('D:\\WINNT'),'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(await started('c:\\windows'),'c:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(await started('E:\\'),'E:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(await started('z:\\My Windows (2)\\'),'z:\\My Windows (2)\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  for(const odd of ['windows','.','..\\Windows','\\Windows','\\\\server\\share\\Windows','\\\\?\\C:\\Windows','C:','C:Windows','C:/Windows','/c/Windows',' C:\\Windows','CD:\\Windows','1:\\Windows','C:\\Win\0dows','C:\\Win\ndows','C:\\Windows\t','C:\\Win\x1fdows','',null,5,true,{},['C:\\Windows']])
    assert.equal(await started(odd),'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',JSON.stringify(odd));
  // Windows refuses a command line longer than 32,767 characters. The script is
  // sent as one argument, so it must stay well under that with Windows line endings too.
  const windowsText=fs.readFileSync(PROBE_FILE,'utf8').replace(/\r?\n/g,'\r\n');
  assert.ok(Buffer.from(windowsText,'utf16le').toString('base64').length<24000,'the probe script fits in one command line');
  assert.doesNotMatch(windowsText,/[^\x00-\x7f]/,'plain ASCII, so the script reads the same in every code page');
});

test('the probe stops on a time-out, on too much output, on a failed start and on a failed exit',async()=>{
  let child;const spawnImpl=()=>{child=fakeChild();return child;};
  const slow=runProbe({spawnImpl,timeoutMs:20});
  await assert.rejects(slow,/took too long/);assert.equal(child.killed,1);
  child.emit('close',0);
  const big=runProbe({spawnImpl});
  child.stdout.emit('data',Buffer.alloc(MAX_OUTPUT));child.stdout.emit('data',Buffer.alloc(1));
  await assert.rejects(big,/too large/);assert.equal(child.killed,1);
  const failed=runProbe({spawnImpl});child.emit('close',1);
  await assert.rejects(failed,/could not finish/);
  const signalled=runProbe({spawnImpl});child.emit('close',null);
  await assert.rejects(signalled,/could not finish/);
  const missing=runProbe({spawnImpl});child.emit('error',Object.assign(new Error('spawn ENOENT'),{code:'ENOENT'}));
  await assert.rejects(missing,/ENOENT/);
  await assert.rejects(runProbe({spawnImpl:()=>{throw new Error('blocked');}}),/blocked/);
  await assert.rejects(runProbe({spawnImpl,readFile:()=>{throw new Error('no script');}}),/no script/);
  // A check that could not start leaves no timer behind; one that started has exactly one, for its time limit.
  const realSetTimeout=globalThis.setTimeout;let armed=0,refused,unreadable,running;
  globalThis.setTimeout=(...args)=>{armed++;return realSetTimeout(...args);};
  try{
    refused=runProbe({spawnImpl:()=>{throw new Error('blocked');}});unreadable=runProbe({spawnImpl,readFile:()=>{throw new Error('no script');}});
    assert.equal(armed,0);
    running=runProbe({spawnImpl});
    assert.equal(armed,1);
  }finally{globalThis.setTimeout=realSetTimeout;}
  child.emit('close',0);await running;
  await assert.rejects(refused,/blocked/);await assert.rejects(unreadable,/no script/);
  // A program that could not start has no output to read and reports the
  // failure a moment later; neither may crash the app.
  let bare;
  const unstarted=runProbe({spawnImpl:()=>{bare=new EventEmitter();bare.kill=()=>{bare.killed=true;};return bare;}});
  await assert.rejects(unstarted,/could not finish/);
  assert.equal(bare.listenerCount('error'),1);assert.doesNotThrow(()=>bare.emit('error',new Error('spawn EMFILE')));assert.equal(bare.killed,true);
  // A late answer after a failure changes nothing.
  const late=runProbe({spawnImpl});child.emit('error',new Error('first'));child.stdout.emit('data',Buffer.from('{}'));child.emit('close',0);
  await assert.rejects(late,/first/);
});

test('the service checks once, shares a running check, checks again on request and never fails',async()=>{
  let runs=0,release,clock=Date.UTC(2026,10,10);
  const service=createHardwareService({platform:'win32',osApi,now:()=>clock,probe:()=>{runs++;return new Promise(resolve=>{release=()=>resolve(JSON.stringify(laptop()));});}});
  const first=service.get(),second=service.get({refresh:true});
  assert.equal(first,second,'a check that is running is shared');
  release();
  const result=await first;
  assert.equal(result.status,'complete');assert.equal(runs,1);
  assert.equal(await service.get(),result,'the last answer is kept for the session');assert.equal(runs,1);
  // Pressing "Check again" twice in a row does not read the PC twice.
  clock+=MIN_REFRESH_MS-1;
  assert.equal(await service.get({refresh:true}),result);assert.equal(runs,1);
  clock+=1;
  const again=service.get({refresh:true});release();
  const fresh=await again;
  assert.notEqual(fresh,result);assert.equal(runs,2);assert.equal(fresh.checkedAt,new Date(clock).toISOString());
  assert.equal(await service.get(),fresh);
  // A clock that jumps backwards cannot hold the page on an old answer for long.
  clock-=60000;
  const afterJump=service.get({refresh:true});release();
  const jumped=await afterJump;
  assert.notEqual(jumped,fresh);assert.equal(runs,3);
  // Three seconds, counted in either direction of the clock.
  assert.equal(MIN_REFRESH_MS,3000);
  clock-=2999;assert.equal(await service.get({refresh:true}),jumped);assert.equal(runs,3);
  clock-=1;
  const setBack=service.get({refresh:true});release();
  assert.notEqual(await setBack,jumped);assert.equal(runs,4);
  // An answer that is not complete is never held on to: its note says to choose Check again, and that checks at once.
  let attempts=0;
  const flaky=createHardwareService({platform:'win32',osApi,now:()=>clock,probe:()=>++attempts===1?Promise.reject(new Error('blocked')):Promise.resolve(JSON.stringify(laptop()))});
  const basics=await flaky.get();
  assert.equal(basics.status,'basic');assert.equal(attempts,1);
  assert.equal(await flaky.get(),basics,'opening the page again shows what there is');assert.equal(attempts,1);
  const full=await flaky.get({refresh:true});
  assert.equal(full.status,'complete');assert.equal(attempts,2,'no three-second wait after a check that failed');
  assert.equal(await flaky.get({refresh:true}),full);assert.equal(attempts,2,'the full answer is then kept for three seconds as usual');
  for(const probe of [()=>Promise.reject(new Error('blocked')),()=>Promise.resolve('not json'),()=>Promise.resolve('{"schema":1}'),()=>{throw new Error('sync');}]){
    const broken=await createHardwareService({platform:'win32',osApi,now:()=>0,probe}).get();
    assert.equal(broken.status,'basic');assert.deepEqual(broken.notes,['probe-failed']);assert.equal(broken.processor.name,'Fallback CPU');
  }
  let asked=0;
  const elsewhere=await createHardwareService({platform:'linux',osApi,now:()=>0,probe:()=>{asked++;return Promise.resolve('{}');}}).get();
  assert.equal(asked,0,'the Windows probe only runs on Windows');assert.deepEqual(elsewhere.notes,['not-windows']);assert.equal(elsewhere.status,'basic');
});

// ---- limits, boundaries and names, one at a time ----
const bare=(extra={})=>({...laptop(),video:[],directx:[],drivers:[],disks:[],partitions:[],volumes:[],...extra});
const read=extra=>summarize(bare(extra),options);
const adaptersOf=extra=>read(extra).graphics;

test('an answer counts with a processor name, a Windows name or a Windows version alone',()=>{
  assert.equal(summarize({schema:1,processors:[{name:'Solo CPU'}]},options).status,'complete');
  assert.equal(summarize({schema:1,system:{caption:'Microsoft Windows 11 Home'}},options).status,'complete');
  assert.equal(summarize({schema:1,system:{version:'10.0.22631'}},options).status,'complete');
  assert.equal(summarize({schema:1,system:{caption:' \u0000 ',version:''},processors:[{name:'  '}]},options).status,'basic');
});

test('numbers are accepted up to their limit and refused one above it',()=>{
  const build=value=>read({system:{caption:'Windows',build:value}}).system.build;
  assert.deepEqual([build('999999'),build('1000000')],[999999,null]);
  assert.deepEqual([build('0000000000022631'),build('00000000000022631'),build(' 22631 '),build('22631.0'),build('2.26e4'),build('0x5867'),build('+22631')],[22631,null,22631,null,null,null,null],'plain digits only, at most 16 of them');
  const cpu=item=>read({processors:[{name:'CPU',...item}]}).processor;
  assert.deepEqual([cpu({cores:'4096'}).cores,cpu({cores:'4097'}).cores],[4096,null]);
  assert.deepEqual([cpu({threads:'4096'}).threads,cpu({threads:'4097'}).threads],[4096,null]);
  assert.deepEqual([cpu({megahertz:'100000'}).megahertz,cpu({megahertz:'100001'}).megahertz],[100000,null]);
  const display=item=>read({video:[video('Card','ABCD','0001',item)]}).display;
  assert.deepEqual(display({width:'100000',height:'100000',refresh:'1000'}),{width:100000,height:100000,refreshHz:1000});
  assert.deepEqual(display({refresh:'1001'}),{width:1920,height:1080,refreshHz:null});
  assert.equal(display({width:'100001'}),null);assert.equal(display({height:'100001'}),null);
  // Sizes above 1 PiB are unreadable.
  const sizes=read({volumes:[{letter:'C:',type:'3',size:String(2**50),free:'1'},{letter:'D:',type:'3',size:String(2**50+1),free:'1'}]}).drives;
  assert.deepEqual(sizes.map(drive=>drive.letter),['C']);
  const usable=totalmem=>summarize(bare({memory:null}),{...options,osApi:{...osApi,totalmem:()=>totalmem}}).memory;
  assert.deepEqual(usable(2**50),{installedBytes:null,usableBytes:2**50,modules:null});
  assert.equal(usable(2**50+1),null);
  // A number written as "-0" is plain 0, so it can never print as "-0".
  assert.ok(Object.is(summarize({...laptop(),system:{caption:'Windows',build:-0}},options).system.build,0));
});

test('lists and texts are cut at their limits',()=>{
  // Connections and partitions: 64 lines each, counted before anything is checked.
  const onDisk=extra=>read({disks:[{id:'0',model:'M',media:'4',bus:'17'}],partitions:[{letter:'C',disk:'0'}],volumes:[{letter:'C:',type:'3',size:'10',free:'1'}],...extra}).drives[0];
  const elsewhere=Array.from({length:63},(_,index)=>({disk:String(100+index),bus:'11'}));
  assert.equal(onDisk({connections:[...elsewhere,{disk:'0',bus:'16'}]}).bus,'Storage Spaces','the 64th connection is read');
  assert.equal(onDisk({connections:[...elsewhere,{disk:'200',bus:'11'},{disk:'0',bus:'16'}]}).bus,'NVMe','the 65th is not');
  const unlettered=Array.from({length:63},()=>({letter:'',disk:'9'}));
  assert.equal(onDisk({partitions:[...unlettered,{letter:'C',disk:'0'}]}).model,'M','the 64th partition is read');
  assert.equal(onDisk({partitions:[...unlettered,{letter:'',disk:'9'},{letter:'C',disk:'0'}]}).model,'','the 65th is not');
  const socket={name:'CPU',cores:'2',threads:'4',megahertz:'2000'};
  assert.equal(read({processors:Array(5).fill(socket)}).processor.sockets,5);
  assert.deepEqual(read({processors:Array(9).fill(socket)}).processor,{name:'CPU',sockets:8,cores:16,threads:32,megahertz:2000});
  assert.deepEqual(read({memory:{modules:Array(4).fill(String(4*GIB))}}).memory,{installedBytes:16*GIB,usableBytes:16*GIB-256*MIB,modules:4});
  assert.deepEqual(summarize(bare({memory:{modules:Array(65).fill(String(GIB))}}),{...options,osApi:{...osApi,totalmem:()=>60*GIB}}).memory,{installedBytes:64*GIB,usableBytes:60*GIB,modules:64},'the 65th module is not read');
  assert.equal(adaptersOf({video:Array.from({length:17},(_,index)=>video(`Card ${index}`,'ABCD','0001'))}).length,16);
  const many=Array.from({length:64},(_,index)=>dx(`Other ${index}`,0xabcd,100+index,GIB,0x3));
  assert.equal(adaptersOf({video:[video('Card','ABCD','0001')],directx:[...many.slice(0,8),dx('Card',0xabcd,1,8*GIB,0x3)]})[0].dedicatedBytes,8*GIB,'the ninth record is still read');
  assert.equal(adaptersOf({video:[video('Card','ABCD','0001')],directx:[...many,dx('Card',0xabcd,1,8*GIB,0x3)]})[0].dedicatedBytes,null,'the 65th record is not');
  const figures=Array.from({length:64},(_,index)=>({name:`Other ${index}`,memory:String(GIB)}));
  const driverFigure=list=>adaptersOf({video:[video('GeForce','10DE','0001')],drivers:list})[0].dedicatedBytes;
  assert.equal(driverFigure([...figures.slice(0,63),{name:'GeForce',memory:String(8*GIB)}]),8*GIB);
  assert.equal(driverFigure([...figures,{name:'GeForce',memory:String(8*GIB)}]),null,'the 65th driver entry is not read');
  const junk=Array(32).fill({letter:'',size:'1'});
  assert.deepEqual(read({volumes:[...junk.slice(0,31),{letter:'C:',type:'3',size:'10',free:'1'}]}).drives.map(drive=>drive.letter),['C']);
  assert.deepEqual(read({volumes:[...junk,{letter:'C:',type:'3',size:'10',free:'1'}]}).drives,[]);
  const numbered=count=>Array.from({length:count},(_,index)=>({id:String(100+index),model:'Other',media:'3',bus:'11'}));
  const model=disks=>read({disks,partitions:[{letter:'C',disk:'0'}],volumes:[{letter:'C:',type:'3',size:'10',free:'1'}]}).drives[0].model;
  assert.equal(model([...numbered(63),{id:'0',model:'Mine',media:'4',bus:'17'}]),'Mine');
  assert.equal(model([...numbered(64),{id:'0',model:'Mine',media:'4',bus:'17'}]),'','the 65th disk is not read');
  assert.equal(read({system:{caption:'Windows',architecture:'a'.repeat(30)}}).system.architecture,'a'.repeat(20));
  assert.equal(summarize(null,{...options,osApi:{...osApi,release:()=>'r'.repeat(60)}}).system.version,'r'.repeat(40));
  const drive=read({disks:[{id:'0',model:'m'.repeat(100),media:'4',bus:'11'}],partitions:[{letter:'C',disk:'0'}],volumes:[{letter:'C:',type:'3',format:'f'.repeat(30),size:'10',free:'1'}]}).drives[0];
  assert.deepEqual([drive.model,drive.format],['m'.repeat(80),'f'.repeat(16)]);
  assert.equal(adaptersOf({video:[video('Card','ABCD','0001',{maker:'k'.repeat(90)})]})[0].maker,'k'.repeat(60));
  // A cut that lands on a space does not leave it at the end.
  assert.equal(read({system:{caption:'Windows',architecture:'a'.repeat(19)+' bcd'}}).system.architecture,'a'.repeat(19));
});

test('without Windows’ own wording, the system type is named the way Windows names it',()=>{
  const type=arch=>summarize(null,{...options,osApi:{...osApi,arch}}).system.architecture;
  assert.equal(type(()=>'x64'),'64-bit');assert.equal(type(()=>'arm64'),'ARM 64-bit');
  for(const arch of [()=>'ia32',()=>'mips',()=>'',()=>null,()=>({}),()=>{throw new Error('no');}])assert.equal(type(arch),'','an unknown type is left out, not guessed');
  assert.equal(summarize(laptop(),{...options,osApi:{...osApi,arch:()=>'arm64'}}).system.architecture,'64-bit','what Windows says comes first');
});

test('text loses every control character, and marks are removed without joining words',()=>{
  const name=value=>read({processors:[{name:value}]}).processor.name;
  assert.equal(name('A\u007fB\u0085C\u009fD'),'A B C D');
  assert.equal(name('Acme(C) Chip'),'Acme Chip');
  assert.equal(name('Acme\u00a9 Chip'),'Acme Chip');
  assert.equal(name('Intel\u00aeCore\u2122i7'),'Intel Core i7');
  assert.equal(read({system:{caption:'MICROSOFT Windows 11 Home'}}).system.name,'Windows 11 Home');
});

test('only a real PowerShell list wrapper is unwrapped, and short hex numbers are not maker numbers',()=>{
  assert.equal(summarize({schema:1,system:{caption:'Windows'},processors:{value:[{name:'Wrapped'}]}},options).processor.name,'Fallback CPU');
  assert.equal(summarize({schema:1,system:{caption:'Windows'},processors:{value:[{name:'Wrapped'}],Count:1}},options).processor.name,'Wrapped');
  const card=adaptersOf({video:[video('Card','10D','1')],directx:[dx('Other name',0x10d,1,8*GIB,0x3)]})[0];
  assert.equal(card.dedicatedBytes,null,'"10D" and "1" are not four-digit numbers, so nothing matches by number');
  // Nor is a longer text read as a number by its first four digits.
  assert.equal(adaptersOf({video:[video('Card','10DE5','0001')],directx:[dx('Other name',0x10de5,1,8*GIB,0x3)]})[0].dedicatedBytes,null);
  assert.equal(adaptersOf({video:[video('Card','10DE','00015')],directx:[dx('Other name',0x10de,0x15,8*GIB,0x3)]})[0].dedicatedBytes,null);
  assert.equal(adaptersOf({video:[video('Card','10DE','0015')],directx:[dx('Other name',0x10de,0x15,8*GIB,0x3)]})[0].dedicatedBytes,8*GIB,'four digits are');
});

test('a missing count on one processor leaves the total unknown, and a speed of zero is unknown',()=>{
  assert.deepEqual(read({processors:[{name:'Xeon A',cores:'8',threads:'16',megahertz:'2100'},{name:'Xeon A',cores:'',threads:'16',megahertz:'2100'}]}).processor,{name:'Xeon A',sockets:2,cores:null,threads:32,megahertz:2100});
  assert.equal(read({processors:[{name:'CPU',cores:'4',threads:'8',megahertz:'0'}]}).processor.megahertz,null);
  assert.deepEqual(summarize(null,{...options,osApi:{...osApi,cpus:()=>[{model:'First',speed:2495.6},{model:'Second',speed:1000}]}}).processor,{name:'First',sockets:null,cores:null,threads:2,megahertz:2496});
});

test('installed memory is kept from "equal to usable" up to four times usable plus 1 GB',()=>{
  const memory=(modules,usable)=>summarize(bare({memory:{modules}}),{...options,osApi:{...osApi,totalmem:()=>usable}}).memory;
  assert.equal(memory([String(8*GIB)],8*GIB).installedBytes,8*GIB,'equal');
  assert.equal(memory([String(33*GIB)],8*GIB).installedBytes,33*GIB,'exactly at the limit');
  assert.equal(memory([String(33*GIB+1)],8*GIB).installedBytes,null,'one byte over');
  assert.equal(memory([String(8*GIB-1)],8*GIB).installedBytes,null,'one byte under');
  // A handheld that gives 6 GB of its 16 GB to graphics still has 16 GB installed.
  assert.deepEqual(memory([String(8*GIB),String(8*GIB)],10*GIB-400*MIB),{installedBytes:16*GIB,usableBytes:10*GIB-400*MIB,modules:2});
  assert.deepEqual(memory([String(8*GIB),'0','x',null],8*GIB-MIB),{installedBytes:8*GIB,usableBytes:8*GIB-MIB,modules:1},'empty slots are not counted');
  assert.deepEqual(summarize(bare({memory:{modules:[String(8*GIB)]}}),{osApi:{},now:()=>0}).memory,{installedBytes:8*GIB,usableBytes:null,modules:1},'nothing to compare with');
});

test('Windows’ own adapter memory is used just below its 4 GB ceiling and not at it',()=>{
  const windows=memory=>adaptersOf({video:[video('Mystery','ABCD','0001',{memory:String(memory)})]})[0];
  assert.deepEqual([windows(4*GIB-2*MIB-1).dedicatedBytes,windows(4*GIB-2*MIB-1).memorySource],[4*GIB-2*MIB-1,'windows']);
  assert.deepEqual([windows(4*GIB-2*MIB).dedicatedBytes,windows(4*GIB-2*MIB).memorySource],[null,null]);
  assert.equal(windows(3*GIB).dedicatedBytes,3*GIB);
});

test('makers are named from their numbers, and anything made by Microsoft is a stand-in',()=>{
  const maker=(vendor,record)=>adaptersOf({video:[video('Card',vendor,vendor?'0001':'')],directx:record?[record]:[]})[0].maker;
  assert.deepEqual([maker('1022'),maker('17CB'),maker('5143')],['AMD','Qualcomm','Qualcomm']);
  assert.equal(maker('',dx('Card',0x5143,1,0,0x3)),'Qualcomm','from the record when Windows gave no numbers');
  const listed=extra=>adaptersOf(extra).map(adapter=>adapter.name);
  assert.deepEqual(listed({video:[video('Plain Name','1414','008E')]}),[],'maker number 1414 from Windows');
  assert.deepEqual(listed({video:[video('Plain Name','','')],directx:[dx('Plain Name',0x1414,0x8e,GIB,0x3)]}),[],'maker number 1414 from the DirectX record');
  assert.deepEqual(listed({video:[video('Microsoft Hyper-V Video','','')]}),[],'by name alone');
  assert.deepEqual(listed({video:[video('Microsoft Basic Render Driver','','')]}),[]);
  assert.deepEqual(listed({video:[video('Microsoft Remote Display Adapter','ABCD','0001')],directx:[dx('Microsoft Remote Display Adapter',0xabcd,1,GIB,0x3)]}),[],'even with a DirectX record of its own');
  // The record's maker decides the kind when Windows gave no numbers.
  assert.equal(adaptersOf({video:[video('Some GeForce','','')],directx:[dx('Some GeForce',0x10de,1,4*GIB,0x3)]})[0].kind,'discrete');
  assert.equal(adaptersOf({video:[video('Some Radeon','','')],directx:[dx('Some Radeon',0x1002,1,4*GIB,0x3)]})[0].kind,'unknown');
  // With no maker text from Windows, the maker's name comes from the record's number alone.
  assert.equal(adaptersOf({video:[video('Adreno GPU','','',{bus:'ACPI',maker:''})],directx:[dx('Adreno GPU',0x4d4f4351,0x36334330,0,0x3)]})[0].maker,'Qualcomm');
});

test('screen-only adapters are recognised by each known name, unless DirectX says they render',()=>{
  const listed=extra=>adaptersOf(extra).map(adapter=>adapter.name);
  for(const name of ['Acme Indirect Display','IddSampleDriver Device','spacedesk Graphics Adapter','DisplayLink Adapter','Acme Mirror Driver','Parsec Virtual Adapter','Acme Remote Display','Acme Virtual Display','Acme Virtual Monitor'])
    assert.deepEqual(listed({video:[video(name,'','')]}),[],name);
  assert.deepEqual(listed({video:[video('Fancy Virtual Display GPU','ABCD','0009')],directx:[dx('Fancy Virtual Display GPU',0xabcd,9,8*GIB,0x3)]}),['Fancy Virtual Display GPU']);
  assert.deepEqual(listed({video:[video('','ABCD','0001'),video('Real','ABCD','0002')]}),['Real'],'an adapter without a name is not listed');
  // Windows' own stand-ins are known by how their name begins, not by those words somewhere in a name.
  const lookalikes=['Acme Microsoft Hyper-V Video Card','Acme Microsoft Basic Display Bridge','Acme Microsoft Basic Render Card','Acme Microsoft Remote Display Card'];
  const records=lookalikes.map((name,index)=>dx(name,0xabcd,index+1,GIB,0x3));
  assert.deepEqual(listed({video:lookalikes.map((name,index)=>video(name,'ABCD',`000${index+1}`)),directx:records}),lookalikes);
  assert.deepEqual(read({video:[video(lookalikes[1],'ABCD','0002')],directx:records}).notes,[]);
  // The connection is read in any letter case.
  for(const bus of ['root','Swd','usb','VmBus'])assert.deepEqual(listed({video:[video('Plain Screen','','',{bus})]}),[],bus);
  assert.deepEqual(listed({video:[video('Plain Card','','',{bus:'PCI'}),video('ARM Card','','',{bus:'ACPI'})]}),['Plain Card','ARM Card']);
});

test('every Direct3D level has its DirectX version',()=>{
  const level=(d3d11,d3d12)=>{const adapter=adaptersOf({video:[video('Card','10DE','0001')],directx:[dx('Card',0x10de,1,GIB,0x3,{d3d11:String(d3d11),d3d12:String(d3d12)})]})[0];return [adapter.directx,adapter.featureLevel];};
  assert.deepEqual(level(0x9100,0),[9,'9.1']);assert.deepEqual(level(0x9200,0),[9,'9.2']);
  assert.deepEqual(level(0xa000,0),[10,'10.0']);assert.deepEqual(level(0xb100,0xc000),[12,'12.0']);
  assert.deepEqual(level(0xb100,0x1000),[11,'11.1'],'an unknown Direct3D 12 level is ignored');
  assert.deepEqual(level(0xa100,0xa100),[10,'10.1'],'a Direct3D 12 level below 11.0 does not make DirectX 12');
});

test('graphics memory: record totals, zero, limits, and which record or driver entry is used',()=>{
  const one=(directx,extra={})=>adaptersOf({video:[video('Card','ABCD','0001',extra.video)],directx,drivers:extra.drivers||[]})[0];
  assert.equal(one([dx('Card',0xabcd,1,GIB,0x3,{dedicatedSystem:String(GIB)})]).dedicatedBytes,2*GIB,'dedicated system memory is part of it');
  const zero=one([dx('Card',0xabcd,1,0,0x3)],{video:{memory:String(GIB)}});
  assert.deepEqual([zero.dedicatedBytes,zero.memorySource],[0,'directx'],'a record of 0 is kept, not replaced by Windows’ figure');
  assert.equal(one([dx('Card',0xabcd,1,2**50,0x3)]).dedicatedBytes,2**50);
  assert.equal(one([dx('Card',0xabcd,1,2**50+1,0x3)],{video:{memory:String(GIB)}}).dedicatedBytes,GIB,'above 1 PiB is unreadable');
  assert.equal(one([dx('Card',0xabcd,1,8*GIB,0x3,{shared:'0'})]).sharedBytes,null);
  assert.equal(one([dx('',0xabcd,1,8*GIB,0x3)],{video:{memory:String(GIB)}}).memorySource,'windows','a record without a name is not used');
  assert.equal(one([dx('Card','','',8*GIB,0x3)]).dedicatedBytes,8*GIB,'a record without numbers is matched by name');
  assert.equal(one([dx('Card',0xabcd,1,4*GIB,0x3,{seen:'134500000000000001'}),dx('Card',0xabcd,1,8*GIB,0x3,{seen:'134500000000000002'})]).dedicatedBytes,8*GIB,'times one tick apart are told apart');
  // Two makers can use the same model number: both numbers must match.
  assert.equal(adaptersOf({video:[video('Adapter X','ABCD','0002')],directx:[dx('Wrong',0x1234,2,6*GIB,0x3),dx('Right',0xabcd,2,4*GIB,0x3)]})[0].dedicatedBytes,4*GIB);
  // Two cards from one maker, and two makers using the same model number.
  const pair=adaptersOf({video:[video('Card A','ABCD','0001'),video('Card B','ABCD','0002'),video('Card C','1234','0002')],directx:[dx('Card A',0xabcd,1,2*GIB,0x3),dx('Card B',0xabcd,2,4*GIB,0x3),dx('Card C',0x1234,2,6*GIB,0x3)]});
  assert.deepEqual(pair.map(adapter=>adapter.dedicatedBytes),[2*GIB,4*GIB,6*GIB]);
  // The driver's own figure: NVIDIA and AMD only, 256 MB to 256 GB, entries without a figure skipped.
  const driver=(memory,vendor='10DE')=>adaptersOf({video:[video('GeForce',vendor,'0001')],drivers:[{name:'GeForce',memory:''},{name:'GeForce',memory:String(memory)}]})[0].dedicatedBytes;
  assert.deepEqual([driver(256*MIB),driver(256*MIB-1),driver(256*GIB),driver(256*GIB+1)],[256*MIB,null,256*GIB,null]);
  assert.deepEqual([driver(8*GIB,'1002'),driver(8*GIB,'8086'),driver(8*GIB,'ABCD')],[8*GIB,null,null]);
  // Windows' own figure is not used for Intel graphics, whatever it says.
  assert.equal(adaptersOf({video:[video('Intel Graphics','8086','0001',{memory:String(GIB)})]})[0].dedicatedBytes,null);
});

test('makers lose their company endings and nothing else; the display comes from the first adapter with a full size',()=>{
  const maker=value=>adaptersOf({video:[video('Card','ABCD','0001',{maker:value})]})[0].maker;
  assert.deepEqual([maker('Acme Ltd.'),maker('Acme Incorporated'),maker('Acme Corporation'),maker('Acme, Inc.'),maker('Acme,Inc'),maker('Acme Corp')],['Acme','Acme','Acme','Acme','Acme','Acme']);
  assert.deepEqual([maker('Zinc'),maker('Zotacorp'),maker('Inc.'),maker('Acme Inc. Group')],['Zinc','Zotacorp','Inc.','Acme Inc. Group'],'an ending is only removed as a separate last word');
  const display=read({video:[video('A','ABCD','0001',{width:'800',height:''}),video('B','ABCD','0002',{width:'2560',height:'1440',refresh:'0'}),video('C','ABCD','0003')]}).display;
  assert.deepEqual(display,{width:2560,height:1440,refreshHz:null});
  assert.deepEqual(read({video:[video('Microsoft Hyper-V Video','1414','5353',{bus:'VMBUS'})]}).notes,[],'only the basic display driver means a missing driver');
  assert.deepEqual(read({video:[video('Acme Basic Display Dock','','',{bus:'USB'})]}).notes,[]);
});

test('with equal memory the separate card is the main adapter',()=>{
  const result=adaptersOf({video:[video('Radeon','1002','73FF'),video('GeForce','10DE','2507')],directx:[dx('Radeon',0x1002,0x73ff,8*GIB,0x3),dx('GeForce',0x10de,0x2507,8*GIB,0x3)]});
  assert.deepEqual(result.map(adapter=>[adapter.kind,adapter.main]),[['unknown',false],['discrete',true]]);
  // An adapter of unknown type still comes before built-in graphics, and a working one before any with a problem.
  const mixed=adaptersOf({video:[video('Intel Graphics','8086','0001'),video('Radeon','1002','73FF')],directx:[dx('Intel Graphics',0x8086,1,128*MIB,0x3),dx('Radeon',0x1002,0x73ff,64*MIB,0x3)]});
  assert.deepEqual(mixed.map(adapter=>[adapter.kind,adapter.main]),[['integrated',false],['unknown',true]]);
  const broken=adaptersOf({video:[video('GeForce','10DE','2507',{status:'43'}),video('Intel Graphics','8086','0001')],directx:[dx('GeForce',0x10de,0x2507,8*GIB,0x3),dx('Intel Graphics',0x8086,1,128*MIB,0x3)]});
  assert.deepEqual(broken.map(adapter=>[adapter.problem,adapter.main]),[[true,false],[false,true]]);
  assert.deepEqual(adaptersOf({video:[video('Unknown memory','ABCD','0001'),video('No memory','ABCD','0002')],directx:[dx('No memory',0xabcd,2,0,0x3)]}).map(adapter=>adapter.main),[false,true],'a known 0 outranks an unknown figure');
});

test('drives: every named connection, memory-class storage, and the boundaries',()=>{
  const drive=(disk,volume={})=>read({disks:[{id:'0',model:'M',media:'0',bus:'11',spindle:'4294967295',...disk}],partitions:[{letter:'C',disk:'0'}],volumes:[{letter:'C:',type:'3',format:'NTFS',size:'10',free:'1',...volume}]}).drives[0];
  assert.deepEqual(['1','3','7','8','10','11','12','13','16','17','0','99'].map(bus=>drive({bus}).bus),['SCSI','ATA','USB','','SAS','SATA','SD card','MMC','Storage Spaces','NVMe','','']);
  assert.equal(drive({media:'5',bus:'11'}).kind,'ssd');
  assert.equal(drive({media:'0',bus:'11',spindle:'0'}).kind,'unknown','no spindle speed is not proof of a hard disk');
  assert.equal(drive({media:'0',bus:'11',spindle:'1'}).kind,'hdd');
  assert.equal(drive({media:'0',bus:'11',spindle:'4294967294'}).kind,'hdd');
  assert.equal(drive({},{free:'10'}).freeBytes,10,'an empty drive');
  assert.equal(drive({},{free:'11'}).freeBytes,null,'more free than its size is not a figure');
  assert.deepEqual([drive({},{type:'2'}).removable,drive({},{type:'3'}).removable,drive({},{type:''}).removable,drive({},{type:'5'}).removable],[true,false,false,false]);
  const twice=read({disks:[{id:'0',model:'First',media:'4',bus:'17'},{id:'1',model:'Second',media:'3',bus:'11'}],partitions:[{letter:'C',disk:''},{letter:'C',disk:'0'},{letter:'C',disk:'1'}],volumes:[{letter:'C:',type:'3',size:'10',free:'1'}]}).drives[0];
  assert.equal(twice.model,'First','a partition without a disk number is skipped, then the first one wins');
});

test('drive letters are listed A to Z, whatever language Windows is set to',()=>{
  const letters='ZTSYJICQAB'.split('');
  const drives=read({volumes:letters.map(letter=>({letter:`${letter}:`,type:'3',size:'10',free:'1'}))}).drives.map(drive=>drive.letter);
  assert.deepEqual(drives,[...letters].sort());
  assert.equal(drives.join(''),'ABCIJQSTYZ');
  // Sorting by the system language would put Z before T in Estonian and Y before J in Lithuanian.
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src/hardware.cjs'),'utf8'),/localeCompare|Intl\.|toLocale/);
});

test('the probe decodes its output once, clears its timer, and uses the default limits',async t=>{
  let child;const spawnImpl=()=>(child=fakeChild());
  const bytes=Buffer.from('{"schema":1,"system":{"caption":"Windows \u00e9\u4e2d\ud83d\ude00"}}');
  const split=runProbe({spawnImpl});
  for(const byte of bytes)child.stdout.emit('data',Buffer.from([byte]));
  child.emit('close',0);
  assert.equal(await split,bytes.toString('utf8'),'a character cut across two chunks is still one character');
  const exact=runProbe({spawnImpl});child.stdout.emit('data',Buffer.alloc(MAX_OUTPUT,0x20));child.emit('close',0);
  assert.equal((await exact).length,MAX_OUTPUT);assert.equal(child.killed,0);
  const quick=runProbe({spawnImpl,timeoutMs:20});const finished=child;finished.emit('close',0);await quick;
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(finished.killed,0,'a finished check is not killed when its time limit passes');
  assert.equal(TIMEOUT_MS,20000);assert.equal(MAX_OUTPUT,512*1024);
  t.mock.timers.enable({apis:['setTimeout']});
  const slow=runProbe({spawnImpl});const waiting=child;
  t.mock.timers.tick(TIMEOUT_MS-1);assert.equal(waiting.killed,0);
  t.mock.timers.tick(1);assert.equal(waiting.killed,1);
  await assert.rejects(slow,/took too long/);
  t.mock.timers.reset();
  const before=process.env.SystemRoot;const files=[];
  try{
    for(const root of ['E:\\Win',undefined]){
      if(root===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=root;
      const probe=runProbe({spawnImpl:executable=>{files.push(executable);return (child=fakeChild());}});child.emit('close',0);await probe;
    }
  }finally{if(before===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=before;}
  assert.deepEqual(files,['E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']);
});

test('a broken output pipe ends the check instead of crashing the app',async()=>{
  let child;const spawnImpl=()=>(child=fakeChild());
  const broken=runProbe({spawnImpl});
  assert.equal(child.stdout.listenerCount('error'),1);
  assert.doesNotThrow(()=>child.stdout.emit('error',new Error('read EPIPE at C:\\Users\\someone')));
  await assert.rejects(broken,error=>{assert.equal(error.message,'The hardware check could not finish.');return true;});
  assert.equal(child.killed,1);
  child.stdout.emit('data',Buffer.from('{}'));child.emit('close',0);
});

test('the service falls back to the basics when the answer cannot be summarised, and reads the platform itself',async()=>{
  let calls=0;
  const once=await createHardwareService({platform:'win32',osApi,now:()=>{if(++calls===1)throw new Error('clock');return 0;},probe:async()=>JSON.stringify(laptop())}).get();
  assert.equal(once.status,'basic');assert.deepEqual(once.notes,['probe-failed']);
  if(process.platform!=='win32'){
    let asked=0;
    const here=await createHardwareService({osApi,now:()=>0,probe:()=>{asked++;return Promise.resolve('{}');}}).get();
    assert.equal(asked,0);assert.deepEqual(here.notes,['not-windows']);
  }
});

// ---- what the probe script may contain ----
// The script is checked against lists of everything it is allowed to say, so a
// change that reads anything new fails here until someone has looked at it.
const PROBE={
  // Each question to Windows: the class, and exactly the properties asked for.
  questions:[
    ['Win32_OperatingSystem',['Caption','Version','BuildNumber','OSArchitecture']],
    ['Win32_Processor',['Name','NumberOfCores','NumberOfLogicalProcessors','MaxClockSpeed']],
    ['Win32_PhysicalMemory',['Capacity']],
    ['Win32_VideoController',['Name','AdapterCompatibility','PNPDeviceID','AdapterRAM','DriverVersion','InfFilename','InfSection','ConfigManagerErrorCode','CurrentHorizontalResolution','CurrentVerticalResolution','CurrentRefreshRate']],
    ['MSFT_PhysicalDisk',['DeviceId','FriendlyName','MediaType','BusType','SpindleSpeed']],
    ['MSFT_Disk',['Number','BusType']],
    ['MSFT_Partition',['DriveLetter','DiskNumber']],
    ['Win32_LogicalDisk',['DeviceID','DriveType','FileSystem','Size','FreeSpace']]],
  // Every quoted text: two settings, the two patterns applied to a device path,
  // the two registry keys, one value name, the storage namespace, the pattern
  // for a drive letter and the drive filter.
  quoted:['','SilentlyContinue','^([A-Za-z]+)\\\\','VEN_([0-9A-Fa-f]{4})&DEV_([0-9A-Fa-f]{4})','HKLM:\\SOFTWARE\\Microsoft\\DirectX',
    'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}','^\\d{4}$','HardwareInformation.qwMemorySize','root/Microsoft/Windows/Storage','[A-Za-z]','DriveType=2 OR DriveType=3'],
  commands:['ConvertTo-Json','ForEach-Object','Get-ChildItem','Get-CimInstance','Get-ItemProperty','Where-Object'],
  options:['-ClassName','-Compress','-Depth','-Filter','-LiteralPath','-Namespace','-Property','-match','-ne'],
  variables:['$ErrorActionPreference','$Matches','$ProgressPreference','$_','$bus','$device','$false','$null','$os','$path','$record','$result','$vendor'],
  // The registry values read from the two keys. Each is printed only in its own section.
  registryValues:{directx:['Description','VendorId','DeviceId','DedicatedVideoMemory','DedicatedSystemMemory','SharedSystemMemory','MaxD3D11FeatureLevel','MaxD3D12FeatureLevel','AdapterType','LastSeen'],drivers:['DriverDesc']},
  // The two item properties used to walk the keys. They are never printed: the
  // name or path of a key can identify one device.
  walking:['PSPath','PSChildName'],
  // The two walks through the registry, word for word.
  walks:["$result.directx = @(Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' | ForEach-Object {",
    "$result.drivers = @(Get-ChildItem -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' | Where-Object { $_.PSChildName -match '^\\d{4}$' } | ForEach-Object {"],
  language:['try','catch','if','string','Console','OutputEncoding','Text','UTF8Encoding','new'],
  // The sections of the answer and the names inside them.
  sections:['system','processors','memory','video','directx','drivers','disks','connections','partitions','volumes'],
  keys:['schema','caption','version','build','architecture','name','cores','threads','megahertz','modules','maker','bus','vendor','device','memory','driver','inf','section','status','width','height','refresh',
    'dedicated','dedicatedSystem','shared','d3d11','d3d12','type','seen','id','model','media','spindle','disk','letter','format','size','free'],
  // The statements that are neither a question to Windows nor a printed value.
  statements:['try','catch','@',')','| ForEach-Object','[string]$_.Capacity',"$_.PSChildName -match ''","$_.DriveLetter -match ''","if ($path -match '')",'if ($null -ne $record.Description)',
    '$result = @','$result | ConvertTo-Json -Depth 4 -Compress','[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',"$ErrorActionPreference = ''","$ProgressPreference = ''",
    "$bus = ''","$vendor = ''","$device = ''",'$bus = $Matches[1]','$vendor = $Matches[1]','$device = $Matches[2]','$path = [string]$_.PNPDeviceID','$record = Get-ItemProperty -LiteralPath $_.PSPath'],
  // Changing the script changes this. Before updating it, check every list above
  // against the new script and against docs/PRIVACY.md.
  fingerprint:'7ac4549300816e168f54736b9da21b4dd116d2145c45e19ac17a7437a9dae222'
};
function probeProblems(script){
  const problems=[],text=script.replace(/\r\n/g,'\n');
  // Plain printable characters and line breaks only, in the comments too. A lone
  // carriage return ends a comment line for PowerShell, and what follows it would
  // run as code that the line-by-line reading below takes for part of the comment.
  if(/[^\n\x20-\x7e]/.test(text))problems.push('a character that is not plain text');
  const code=text.split('\n').filter(line=>!line.trim().startsWith('#')).join('\n');
  const quoted=[];
  const bare=code.replace(/'[^'\n]*'/g,match=>{quoted.push(match.slice(1,-1));return "''";});
  for(const value of new Set(quoted))if(!PROBE.quoted.includes(value))problems.push(`quoted text: ${value}`);
  // Only these characters outside quoted text: no double quotes, backticks,
  // shortcuts (% ?), calls (&), joins (+) or comments after code.
  const odd=bare.match(/[^A-Za-z0-9_$@{}()[\]=;,.|:\-' \n]/g);
  if(odd)problems.push(`characters: ${[...new Set(odd)].join(' ')}`);
  for(const [pattern,label] of [[/\$\(/,'$('],[/\.\s*\$/,'.$'],[/\$\{/,'${'],[/::(?!OutputEncoding = \[Text\.UTF8Encoding\]::new\(\$false\))(?!new\(\$false\))/,'::'],[/\.\s*\(/,'.('],[/\)\s*\./,').'],[/\]\s*\./,'].'],[/''\s*\./,"''."]])if(pattern.test(bare))problems.push(`construct: ${label}`);
  const properties=new Set(PROBE.questions.flatMap(([,names])=>names)),classes=new Set(PROBE.questions.map(([name])=>name));
  const allowed=new Set([...PROBE.commands,...PROBE.options,...PROBE.variables,...Object.values(PROBE.registryValues).flat(),...PROBE.walking,...PROBE.language,...PROBE.sections,...PROBE.keys,...properties,...classes]);
  for(const word of new Set(bare.match(/\$[A-Za-z_]\w*|-[A-Za-z]+|[A-Za-z]+-[A-Za-z]+|[A-Za-z_]\w*/g)))if(!allowed.has(word))problems.push(`word: ${word}`);
  // Every question to Windows names its class and the exact properties wanted.
  const questions=[...bare.matchAll(/Get-CimInstance(?: -Namespace '')? -ClassName (\w+)(?: -Filter '')? -Property ([\w,]+)(?= \||\n)/g)].map(match=>[match[1],match[2].split(',')]);
  if(JSON.stringify(questions)!==JSON.stringify(PROBE.questions))problems.push('the questions to Windows changed');
  if((bare.match(/Get-CimInstance/g)||[]).length!==PROBE.questions.length)problems.push('a question to Windows without its exact property list');
  // The registry is walked twice, each time exactly as written above, and the
  // properties that name a key are used for that walk and nothing else.
  for(const walk of PROBE.walks)if(!code.includes(`\n  ${walk}\n`))problems.push('a walk through the registry changed');
  if((bare.match(/Get-ChildItem/g)||[]).length!==PROBE.walks.length||(bare.match(/Get-ItemProperty/g)||[]).length!==PROBE.walks.length)problems.push('another walk through the registry');
  if((bare.match(/PSPath/g)||[]).length!==2||(bare.match(/PSChildName/g)||[]).length!==1)problems.push('the name or path of a registry key used for something else');
  // Every value that is printed is one property, as text, of what its own section
  // asked for: nothing is printed whole, and nothing that was not asked for there.
  let from=null;
  for(const piece of bare.split(/[;{}\n]/).map(part=>part.trim()).filter(Boolean)){
    let match;
    const asked=/Get-CimInstance(?: -Namespace '')? -ClassName \w+(?: -Filter '')? -Property ([\w,]+)/.exec(piece);
    if(asked)from={object:piece.startsWith('$os = ')?'os':'_',names:asked[1].split(',')};
    const walked=/^\$result\.(directx|drivers) = @\(Get-ChildItem /.exec(piece);
    if(walked)from={object:'record',names:[...PROBE.registryValues[walked[1]],...(walked[1]==='drivers'?["''"]:[])]};
    // And every statement is one of the few shapes the script is made of.
    if(PROBE.statements.includes(piece))continue;
    if((match=/^([a-z][A-Za-z0-9]*) = (.+)$/.exec(piece))){
      const printed=/^\[string\]\$(_|os|record)\.([A-Za-z0-9]+|'')$/.exec(match[2]);
      const fits=printed?Boolean(from)&&printed[1]===from.object&&from.names.includes(printed[2])
        :/^(?:\$bus|\$vendor|\$device|1|@\(Get-CimInstance -ClassName Win32_PhysicalMemory -Property Capacity \| ForEach-Object)$/.test(match[2]);
      if(!PROBE.keys.includes(match[1])||!fits)problems.push(`printed value: ${piece}`);
    }
    else if((match=/^\$result\.(\w+) = (.+)$/.exec(piece))){
      const shape=/^@(?:\(Get-CimInstance(?: -Namespace '')? -ClassName \w+(?: -Filter '')? -Property [\w,]+ \| (?:ForEach-Object|Where-Object)|\(Get-ChildItem -LiteralPath '' \| (?:ForEach-Object|Where-Object))?$/;
      if(!PROBE.sections.includes(match[1])||!shape.test(match[2]))problems.push(`section: ${piece}`);
    }
    else if(!/^\$os = Get-CimInstance -ClassName Win32_OperatingSystem -Property [\w,]+$/.test(piece))problems.push(`statement: ${piece}`);
  }
  if(!text.endsWith('\n$result | ConvertTo-Json -Depth 4 -Compress\n'))problems.push('the script must end by printing the answer');
  if(crypto.createHash('sha256').update(text).digest('hex')!==PROBE.fingerprint)problems.push('fingerprint');
  return problems;
}

test('the probe script asks Windows only for what the page shows, and prints nothing whole',()=>{
  const script=fs.readFileSync(PROBE_FILE,'utf8');
  assert.equal(path.basename(PROBE_FILE),'hardware-probe.ps1');
  assert.deepEqual(probeProblems(script),[]);
  // The device path is used once, only to pick out the connection and the maker and model numbers.
  const code=script.split(/\r?\n/).filter(line=>!line.trim().startsWith('#')).join('\n');
  assert.deepEqual(code.match(/\$path\b[^;\n]*/g),["$path = [string]$_.PNPDeviceID","$path -match '^([A-Za-z]+)\\\\') { $bus = $Matches[1] }","$path -match 'VEN_([0-9A-Fa-f]{4})&DEV_([0-9A-Fa-f]{4})') { $vendor = $Matches[1]"]);
  assert.equal(code.match(/PNPDeviceID/g).length,2,'asked for once, used once');
  // Nothing that identifies one PC or person is among the allowed words.
  for(const word of [...PROBE.questions.flatMap(([name,properties])=>[name,...properties]),...Object.values(PROBE.registryValues).flat(),...PROBE.quoted])
    assert.doesNotMatch(word,/Serial|UUID|GUID|MAC|Address|IdentifyingNumber|User|Owner|Host|Computer|CSName|Registered|ProductId|InstallDate|Volume|Label|Luid|Account|SID|Network|BIOS|BaseBoard|Asset|Tag/i,word);
});

test('the probe check itself catches every way of reading or printing something else',()=>{
  const script=fs.readFileSync(PROBE_FILE,'utf8').replace(/\r\n/g,'\n');
  const edits={
    'a whole object printed':s=>s.replace('$result.system = @{','$result.pc = $os\n  $result.system = @{'),
    'a whole object as a section':s=>s.replace("$result.system = @{ caption = [string]$os.Caption;","$result.system = $os\n  $result.memory = @{ caption = [string]$os.Caption;"),
    'a whole object as a value':s=>s.replace('caption = [string]$os.Caption','caption = $os'),
    'another class':s=>s.replace('-ClassName Win32_PhysicalMemory -Property Capacity','-ClassName Win32_ComputerSystem -Property Name'),
    'another property asked for':s=>s.replace('-Property Caption,Version','-Property Caption,CSName,Version'),
    'a property that was not asked for':s=>s.replace('caption = [string]$os.Caption','caption = [string]$os.SerialNumber'),
    'the user-set description of the PC':s=>s.replace('-Property Caption,Version','-Property Caption,Description,Version').replace('caption = [string]$os.Caption','caption = [string]$os.Description'),
    'a question without a property list':s=>s.replace(' -Property Capacity',''),
    'a drive’s unique id as its model':s=>s.replace('model = [string]$_.FriendlyName','model = [string]$_.UniqueId'),
    'the whole device path':s=>s.replace("bus = $bus;","bus = $path;"),
    'another registry key':s=>s.replace("'HKLM:\\SOFTWARE\\Microsoft\\DirectX'","'HKLM:\\SOFTWARE\\Microsoft\\Cryptography'"),
    'a registry value by method':s=>s.replace('[string]$record.Description;',"[string]$record.GetValue('MachineGuid');"),
    'a program':s=>s.replace("$result = @{ schema = 1 }","$result = @{ schema = 1 }\n$result.who = [string](whoami)"),
    'a short command name':s=>s.replace('Get-CimInstance -ClassName Win32_Processor','gcim -ClassName Win32_Processor'),
    'a command in other letter case':s=>s.replace('Get-CimInstance -ClassName Win32_Processor','get-ciminstance -ClassName Win32_Processor'),
    'the % shortcut':s=>s.replace('| ForEach-Object { [string]$_.Capacity }','| % { [string]$_.Capacity }'),
    'a backtick':s=>s.replace('[string]$os.Caption','[string]$os.`Caption'),
    'a double-quoted name':s=>s.replace('[string]$os.Caption','[string]$os."Caption"'),
    'a name from a variable':s=>s.replace('[string]$os.Caption','[string]$os.$vendor'),
    'a .NET call':s=>s.replace("$result = @{ schema = 1 }","$result = @{ schema = 1 }\n$result.system = [Environment]::MachineName"),
    'an environment variable':s=>s.replace("$result = @{ schema = 1 }","$result = @{ schema = 1; name = $env:COMPUTERNAME }"),
    'a sub-expression':s=>s.replace('[string]$os.Caption','[string]$(hostname)'),
    'a type shortcut':s=>s.replace('$os = Get-CimInstance','$os = [wmi]'),
    'the call operator':s=>s.replace("$result = @{ schema = 1 }","$result = @{ schema = 1 }\n& 'whoami'"),
    'a web request':s=>s.replace("$result | ConvertTo-Json","Invoke-WebRequest -Uri 'https://example.com' | Out-Null\n$result | ConvertTo-Json"),
    'writing a file':s=>s.replace("$result | ConvertTo-Json -Depth 4 -Compress\n","$result | ConvertTo-Json -Depth 4 -Compress | Out-File 'C:\\x.json'\n"),
    'a comment hiding code':s=>s.replace('$result = @{ schema = 1 }','$result = @{ schema = 1 } <# #>'),
    'an unlisted answer name':s=>s.replace('caption = [string]$os.Caption','computer = [string]$os.Caption'),
    'something printed beside the answer':s=>s.replace("\n$result | ConvertTo-Json","\n[string]$os.Caption\n$result | ConvertTo-Json"),
    'code after a lone carriage return in a comment':s=>s.replace('# Fixed and removable drives only, so network drives are never contacted.','# Fixed and removable drives only.\r$result.who = [string](whoami)'),
    'a tab':s=>s.replace('$result = @{ schema = 1 }','$result = @{\tschema = 1 }'),
    'a character outside plain text in a comment':s=>s.replace('# Graphics adapters','# Graphics adapters'),
    'a listing of folders in place of a walk through the registry':s=>s.replace(PROBE.walks[1],'$result.drivers = @(Get-ChildItem .. -Depth 4 | ForEach-Object {'),
    'another registry key walked the same way':s=>s.replace(PROBE.walks[0],PROBE.walks[0].replace('DirectX','Cryptography')),
    'a third walk through the registry':s=>s.replace('\n$result | ConvertTo-Json',"\ntry { $result.volumes = @(Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' | ForEach-Object { 1 }) } catch { }\n$result | ConvertTo-Json"),
    // Three edits made only of words, texts and statements the script already has, each caught by one rule alone.
    'the two registry keys swapped between their sections':s=>{const [first,second]=PROBE.quoted.filter(text=>text.startsWith('HKLM:'));return s.replace(first,'<key>').replace(second,first).replace('<key>',second);},
    'another walk that prints a value the section before it may print':s=>s.replace("memory = [string]$record.'HardwareInformation.qwMemorySize' }\n  })\n} catch { }\n","memory = [string]$record.'HardwareInformation.qwMemorySize' }\n  })\n} catch { }\ntry {\n  $result.volumes = @(Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' | ForEach-Object {\n    @{ name = [string]$record.DriverDesc }\n  })\n} catch { }\n"),
    'the registry filter put on another question':s=>s.replace('-Property DeviceID,DriveType,FileSystem,Size,FreeSpace | ForEach-Object {',()=>"-Property DeviceID,DriveType,FileSystem,Size,FreeSpace | Where-Object { $_.PSChildName -match '^\\d{4}$' } | ForEach-Object {"),
    'the name of a registry key printed':s=>s.replace('seen = [string]$record.LastSeen','seen = [string]$_.PSChildName'),
    'the path of a registry key printed':s=>s.replace('name = [string]$record.Description;','name = [string]$_.PSPath;'),
    'the full name of a registry key printed':s=>s.replace('name = [string]$record.Description;','name = [string]$_.Name;'),
    'a registry value of the other key':s=>s.replace('name = [string]$record.DriverDesc;','name = [string]$record.Description;'),
    'a property that another section asked for':s=>s.replace('cores = [string]$_.NumberOfCores','cores = [string]$_.PNPDeviceID'),
    'a property of the wrong thing':s=>s.replace('caption = [string]$os.Caption','caption = [string]$_.Caption'),
    'a drive letter test that lets everything through':s=>s.replace("{ $_.DriveLetter -match '[A-Za-z]' }",'{ $_.DriveLetter }'),
    'any other change at all':s=>s.replace('# Graphics adapters','#  Graphics adapters')
  };
  for(const [label,edit] of Object.entries(edits)){
    const changed=edit(script);
    assert.notEqual(changed,script,`${label}: the edit applies`);
    assert.notDeepEqual(probeProblems(changed),[],label);
    if(label!=='any other change at all')assert.notDeepEqual(probeProblems(changed),['fingerprint'],`${label}: caught by the lists, not only by the fingerprint`);
  }
  assert.deepEqual(probeProblems(script.replace(/\n/g,'\r\n')),[],'Windows line endings are the same script');
});

test('on Windows the real probe describes this PC within the time limit',{skip:process.platform!=='win32'},async()=>{
  const raw=await runProbe(),answer=parseProbe(raw);
  // Exactly the sections and names the script is allowed to print, and nothing naming this PC or its user.
  for(const [section,value] of Object.entries(answer)){
    if(section==='schema')continue;
    assert.ok(PROBE.sections.includes(section),section);
    const rows=Array.isArray(value)?value:[value];
    for(const row of rows)for(const key of Object.keys(row))assert.ok(PROBE.keys.includes(key),`${section}.${key}`);
  }
  for(const personal of [os.hostname(),os.userInfo().username])if(personal.length>=4)assert.equal(raw.toLowerCase().includes(personal.toLowerCase()),false,'the answer does not name this PC or its user');
  // Only partitions that have a drive letter are printed.
  const partitions=answer.partitions===undefined?[]:Array.isArray(answer.partitions)?answer.partitions:[answer.partitions];
  for(const partition of partitions)assert.match(String(partition.letter),/^[A-Za-z]$/,'a partition without a drive letter is left out');
  assert.ok(partitions.length>=1,'the drive Windows runs from has a letter, so at least one partition is printed');
  assert.doesNotMatch(raw,/VEN_|DEV_|SUBSYS|\\\\\?\\/,'no device paths are printed');
  const result=await createHardwareService().get();
  assert.equal(result.status,'complete',`notes: ${result.notes.join(', ')}`);
  assert.ok(result.processor.name.length>0);assert.ok(result.processor.threads>=1);
  assert.ok(result.memory.usableBytes>=GIB);
  assert.ok(result.system.build>=10240);assert.match(result.system.name,/Windows/);
  assert.ok(result.drives.length>=1);
  for(const drive of result.drives){assert.match(drive.letter,/^[A-Z]$/);assert.ok(drive.totalBytes>0);assert.ok(['ssd','hdd','unknown'].includes(drive.kind));}
  for(const adapter of result.graphics){assert.ok(adapter.name.length>0);assert.ok(['discrete','integrated','unknown'].includes(adapter.kind));}
  assert.equal(result.graphics.filter(adapter=>adapter.main).length,result.graphics.length?1:0);
});

// main.cjs with Electron and the hardware service replaced, to see what the
// page can reach and when the PC is read.
async function mainFixture(answer){
  const f={handles:new Map(),windows:[],calls:[],created:0,sent:[]};
  class Manager extends EventEmitter{
    constructor(){super();this.settings={downloadDir:'C:\\Fixture',favorites:[],collections:[]};this.downloads=[];f.manager=this;}
    state(){return {settings:{...this.settings},downloads:[],version:'fixture'};}save(){}stop(){return Promise.resolve();}updateSettings(){}
  }
  class Completion{snapshot(){return {mode:'none',phase:'idle'};}refresh(){}dispose(){}}
  class Refresher{snapshot(){return {enabled:true};}start(){}stop(){}check(){return Promise.resolve();}}
  class Window{
    constructor(){this.webContents={mainFrame:{url:'atlas://app/index.html'},on(){},setWindowOpenHandler(){},send:(channel,payload)=>f.sent.push([channel,JSON.stringify(payload)])};f.windows.push(this);}
    on(){}once(){}isDestroyed(){return false;}loadURL(){return Promise.resolve();}
  }
  const profile=path.join(__dirname,'.unused-hardware-profile');
  const electron={
    app:{setPath(){},getPath:()=>profile,getVersion:()=>'fixture',requestSingleInstanceLock:()=>true,on(){},setName(){},whenReady:()=>Promise.resolve(),quit(){throw new Error('No app exit in this test');}},
    BrowserWindow:Window,ipcMain:{handle:(name,callback)=>f.handles.set(name,callback)},
    protocol:{registerSchemesAsPrivileged(){},handle(){}},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{}}},
    powerMonitor:{on(){}},dialog:{showErrorBox:(_title,error)=>{throw new Error(error);}},shell:{},clipboard:{},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../src'),module:{exports:{}},exports:{},console,URL,Buffer,Response,setImmediate,
    process:{env:{ATLAS_TEST_DIR:profile}},
    require:request=>{
      if(request==='electron')return electron;
      if(request==='node:child_process')return {execFile(){throw new Error('No programs are started in this test');},spawn(){throw new Error('No programs are started in this test');}};
      if(request==='./downloads.cjs')return {DownloadManager:Manager,safeName:value=>value,atomicJSON(){},loadJSON:(_file,fallback)=>fallback};
      if(request==='./completion-action.cjs')return {CompletionAction:Completion};
      if(request==='./catalog-refresh.cjs')return {CatalogRefresh:Refresher};
      if(request==='./providers.cjs'||request==='./catalog.cjs')return {};
      if(request==='./installed-games.cjs')return {scanInstalledGames:async()=>({games:[]})};
      if(request==='./hardware.cjs')return {createHardwareService:()=>{f.created++;return {get:async options=>{f.calls.push({...options});if(answer instanceof Error)throw answer;return answer;}};}};
      return request.startsWith('./')?require(path.join(__dirname,'../src',request)):require(request);
    },
  });
  await new Promise(resolve=>setImmediate(resolve));
  const page=()=>({sender:f.windows[0].webContents,senderFrame:f.windows[0].webContents.mainFrame});
  f.invoke=(name,value,event)=>f.handles.get('atlas:'+name)(event||page(),value);
  return f;
}

test('the app reads the PC only when its own page asks, and only a plain "true" forces a new reading',async()=>{
  const answer=summarize(laptop(),options);
  const f=await mainFixture(answer);
  assert.equal(f.created,1);assert.deepEqual(f.calls,[],'nothing is read when the app starts');
  await f.invoke('getState');assert.deepEqual(f.calls,[],'asking for the app state reads nothing');
  assert.deepEqual(await f.invoke('getHardware'),answer);
  // Once read, the specs still go nowhere but to the page that asked: not into the
  // app state, and not into anything the app pushes to its window.
  const marker=answer.processor.name;assert.ok(marker.length>8);
  assert.equal(JSON.stringify(await f.invoke('getState')).includes(marker),false,'the app state never carries PC specs');
  f.manager.emit('state',f.manager.state());f.manager.emit('progress',[]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.sent.some(([channel])=>channel==='atlas:state'),'the app did push its state');
  for(const [channel,payload] of f.sent){assert.equal(payload.includes(marker),false,channel);assert.doesNotMatch(payload,/"graphics"|"processor"|"drives"/,channel);}
  for(const value of [undefined,null,{},{refresh:false},{refresh:'true'},{refresh:1},{refresh:{}},'refresh',7,[true]])await f.invoke('getHardware',value);
  assert.ok(f.calls.every(call=>call.refresh===false),'anything but refresh:true reuses the last reading');
  for(const call of f.calls)assert.deepEqual(Object.keys(call),['refresh'],'nothing else from the page reaches the service');
  await f.invoke('getHardware',{refresh:true,probe:()=>'x',platform:'linux'});
  assert.deepEqual(f.calls.at(-1),{refresh:true});
  // Another window, a sub-frame or another address cannot ask.
  const main=f.windows[0].webContents,before=f.calls.length;
  for(const event of [{sender:{},senderFrame:main.mainFrame},{sender:main,senderFrame:{url:'atlas://app/index.html'}},{sender:main,senderFrame:{...main.mainFrame}}]){
    await assert.rejects(f.invoke('getHardware',{refresh:true},event),/Invalid app request/);
  }
  main.mainFrame.url='https://example.com/';
  await assert.rejects(f.invoke('getHardware'),/Invalid app request/);
  assert.equal(f.calls.length,before,'a refused request reads nothing');
});

test('a failure inside the hardware service reaches the page as one plain sentence',async()=>{
  const f=await mainFixture(new Error('spawn C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe ENOENT at C:\\Users\\someone\\secret'));
  await assert.rejects(f.invoke('getHardware'),error=>{
    assert.equal(error.message,'This PC’s specs could not be read. Try again.');
    assert.doesNotMatch(String(error.stack||''),/someone|secret|powershell/i);
    return true;
  });
});

test('the page can ask for PC specs through the preload bridge, with one value and nothing else',async()=>{
  const invoked=[];let exposed;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:request=>{
    assert.equal(request,'electron');
    return {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'atlas');exposed=api;}},ipcRenderer:{invoke:(...args)=>{invoked.push(args);return Promise.resolve('answer');},on(){},removeListener(){}}};
  }});
  assert.equal(typeof exposed.getHardware,'function');
  assert.equal(await exposed.getHardware({refresh:true},'extra'),'answer');
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)),[['atlas:getHardware',{refresh:true}]]);
});

