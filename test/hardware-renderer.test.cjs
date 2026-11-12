'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=name=>fs.readFileSync(path.join(__dirname,'../src/renderer',name),'utf8');

// The same minimal DOM the other renderer tests use.
function fixture(api={}){
  const nodes=new Map(),lists=new Map();
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this._text='';this.className='';this.open=false;this.isConnected=true;this.disabled=false;this.checked=false;this.value='';this.hidden=false;this.classList={toggle(){}};}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    set innerHTML(value){this.markup=String(value);}get innerHTML(){return this.markup||'';}
    append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;this._text='';}remove(){this.isConnected=false;}before(){}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    addEventListener(name,listener){const listeners=this.events.get(name)||[];listeners.push(listener);this.events.set(name,listeners);}async emit(name,event={}){for(const listener of this.events.get(name)||[])await listener(event);}
    showModal(){this.open=true;}close(){this.open=false;}focus(){this.focused=(this.focused||0)+1;}contains(node){return this===node||this.children.some(child=>child.contains(node));}
    querySelector(selector){return get(selector);}querySelectorAll(selector){return lists.get(selector)||[];}
  }
  function get(selector){if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);}
  const document={querySelector:get,querySelectorAll:selector=>lists.get(selector)||[],createElement:tag=>new Element(tag),activeElement:null,body:new Element('body'),addEventListener(){},documentElement:{style:{setProperty(){}}}};
  const toasts=[];
  const context=vm.createContext({window:{atlas:{...api},scrollTo(){}},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(read('i18n.js'),context);
  vm.runInContext(read('app.js').replace(/start\(\);\s*$/,''),context);
  context.recordToast=(message,isError)=>toasts.push([message,Boolean(isError)]);
  const run=code=>vm.runInContext(code,context);run('toast=recordToast;');
  const all=root=>[root,...root.children.flatMap(all)];
  const cards=()=>get('#hardware-grid').children.filter(node=>node.className==='spec-card');
  // A card as plain data: its label, badge, title, rows and other text.
  const card=node=>{
    const nodesIn=all(node),label=nodesIn.find(item=>item.className==='spec-label');
    const rows=nodesIn.find(item=>item.className==='spec-rows');
    const pairs={};
    if(rows)for(let i=0;i<rows.children.length;i+=2)pairs[rows.children[i].textContent]=rows.children[i+1].textContent;
    return {label:label.children[0].textContent,badge:label.children[1]?.textContent||'',title:nodesIn.find(item=>item.tagName==='h3').textContent,rows:pairs,hasRows:Boolean(rows),
      icon:nodesIn.find(item=>item.className==='spec-icon').children[0].markup,
      notes:node.children.filter(item=>item.tagName==='p').map(item=>item.textContent),
      drives:node.children.filter(item=>item.className==='spec-drive').map(block=>({heading:block.children[0].children.map(item=>item.textContent),
        meter:all(block).find(item=>item.className==='spec-meter')||null,fill:all(block).find(item=>item.className.startsWith('spec-meter-fill'))||null,text:block.children.at(-1).textContent}))};
  };
  return {get,lists,context,run,Element,all,toasts,cards,card,document};
}
const GIB=1024**3,MIB=1024**2;
// A made-up gaming laptop, in the shape hardware.cjs hands to the page.
const SPECS=Object.freeze({schema:1,status:'complete',checkedAt:'2026-11-10T09:30:00.000Z',
  system:{name:'Windows 11 Home',version:'10.0.22631',build:22631,architecture:'64-bit'},
  processor:{name:'Example Core i7-12700H',sockets:1,cores:14,threads:20,megahertz:2300},
  memory:{installedBytes:16*GIB,usableBytes:16*GIB-270*MIB,modules:2},
  graphics:[
    {name:'Example Iris Xe Graphics',maker:'Intel',kind:'integrated',dedicatedBytes:128*MIB,memorySource:'directx',sharedBytes:8*GIB-135*MIB,directx:12,featureLevel:'12.1',driver:'31.0.101.5186',problem:false,main:false},
    {name:'Example GeForce RTX 3060 Laptop GPU',maker:'NVIDIA',kind:'discrete',dedicatedBytes:6*GIB-153*MIB,memorySource:'directx',sharedBytes:8*GIB-135*MIB,directx:12,featureLevel:'12.2',driver:'32.0.15.6094',problem:false,main:true}],
  display:{width:1920,height:1080,refreshHz:144},
  drives:[
    {letter:'C',totalBytes:476*GIB,freeBytes:120*GIB,format:'NTFS',removable:false,kind:'ssd',bus:'NVMe',model:'Example NVMe 512GB'},
    {letter:'D',totalBytes:931*GIB,freeBytes:40*GIB,format:'NTFS',removable:false,kind:'hdd',bus:'SATA',model:'Example HDD 1TB'},
    {letter:'F',totalBytes:1863*GIB,freeBytes:168*GIB,format:'NTFS',removable:false,kind:'ssd',bus:'',model:''},
    {letter:'E',totalBytes:58*GIB,freeBytes:null,format:'exFAT',removable:true,kind:'unknown',bus:'USB',model:''}],
  notes:[]});
const set=(f,value)=>{f.context.nextHardware=value;f.run('hardware=nextHardware;');};

test('the page lists every part in plain words, with the main graphics card first',()=>{
  const f=fixture();
  set(f,SPECS);f.run('renderHardware()');
  const cards=f.cards().map(f.card);
  assert.deepEqual(cards.map(item=>item.label),['Processor','Graphics','Graphics','Memory (RAM)','Storage','Display','System']);
  const {icon:processorIcon,...processor}=cards[0];
  assert.deepEqual(processor,{label:'Processor',badge:'',title:'Example Core i7-12700H',rows:{Cores:'14 cores · 20 threads','Clock speed':'2.3 GHz'},hasRows:true,notes:[],drives:[]});
  // Each kind of card has its own picture.
  assert.match(processorIcon,/^<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6"/,'the processor card uses the chip icon');
  assert.match(cards[1].icon,/<circle cx="8" cy="11\.5" r="2\.6"\/>/,'graphics icon');assert.equal(cards[2].icon,cards[1].icon);
  assert.match(cards[3].icon,/<rect x="2" y="7" width="20" height="9"/,'memory icon');
  assert.match(cards[4].icon,/<path d="M3 14h18M7 17h\.1M11 17h3"\/>/,'drive icon');
  assert.match(cards[5].icon,/<rect x="2" y="4" width="20" height="13"/,'monitor icon');
  assert.match(cards[6].icon,/<path d="M8 21h8M12 16v5M7 7h10"\/>/,'computer icon');
  assert.equal(new Set(cards.map(item=>item.icon)).size,6,'six pictures for the six kinds of card');
  assert.equal(cards[1].title,'Example GeForce RTX 3060 Laptop GPU');assert.equal(cards[1].badge,'Main');
  assert.deepEqual(cards[1].rows,{Type:'Graphics card','Graphics memory':'6 GB',Supports:'DirectX 12 (feature level 12.2)','Driver version':'32.0.15.6094'});
  assert.equal(cards[2].title,'Example Iris Xe Graphics');assert.equal(cards[2].badge,'');
  assert.deepEqual(cards[2].rows,{Type:'Built-in graphics','Graphics memory':'Shares system memory (up to 8 GB)',Supports:'DirectX 12 (feature level 12.1)','Driver version':'31.0.101.5186'});
  assert.equal(cards[3].title,'16 GB installed');assert.deepEqual(cards[3].rows,{'Usable by Windows':'15.7 GB','Memory modules':'2'});
  assert.equal(cards[4].title,'4 drives');
  assert.deepEqual(cards[4].drives.map(drive=>[drive.heading,drive.text]),[
    [['C:','NVMe SSD · Example NVMe 512GB'],'120 GB free of 476 GB'],
    [['D:','SATA hard disk · Example HDD 1TB'],'40.0 GB free of 931 GB · low on space'],
    [['F:','SSD'],'168 GB free of 1.8 TB'],
    [['E:','USB drive'],'58.0 GB']]);
  assert.equal(cards[4].drives[0].fill.style.width,'74.8%');assert.equal(cards[4].drives[0].fill.className,'spec-meter-fill');
  assert.equal(cards[4].drives[1].fill.className,'spec-meter-fill low');
  assert.equal(cards[4].drives[2].fill.className,'spec-meter-fill','under a tenth free but still 168 GB: a big drive is not called low');
  assert.equal(cards[4].drives[3].fill,null,'a drive with no free-space figure has no meter');
  assert.equal(cards[5].title,'1920 × 1080');assert.deepEqual(cards[5].rows,{'Refresh rate':'144 Hz'});
  assert.equal(cards[6].title,'Windows 11 Home');assert.deepEqual(cards[6].rows,{Build:'22631','System type':'64-bit'});
  assert.match(f.get('#hardware-status').textContent,/^Checked at .+ · Read on this PC only, never sent anywhere\.$/);
  assert.equal(f.get('#hardware-notes').children.length,0);assert.equal(f.get('#check-hardware').disabled,false);
});

test('one graphics adapter gets no "Main" badge, and missing details are left out instead of guessed',()=>{
  const f=fixture();
  set(f,{...SPECS,processor:{name:'Example Ryzen 5',sockets:null,cores:null,threads:12,megahertz:null},
    memory:{installedBytes:null,usableBytes:8*GIB-300*MIB,modules:null},
    graphics:[{name:'Example Radeon Graphics',maker:'AMD',kind:'unknown',dedicatedBytes:null,memorySource:null,sharedBytes:null,directx:null,featureLevel:null,driver:'',main:true}],
    display:null,drives:[],system:{name:'Windows 10 Pro',version:'',build:null,architecture:''}});
  f.run('renderHardware()');
  const cards=f.cards().map(f.card);
  assert.deepEqual(cards.map(item=>item.label),['Processor','Graphics','Memory (RAM)','Storage','System'],'no Display card without a reading');
  assert.deepEqual(cards[0].rows,{Threads:'12'});
  assert.equal(cards[1].badge,'');assert.deepEqual(cards[1].rows,{'Graphics memory':'Not reported by Windows'});
  assert.equal(cards[2].title,'7.7 GB usable');assert.deepEqual(cards[2].rows,{});
  assert.equal(cards[3].title,'No drives reported');assert.deepEqual(cards[3].drives,[]);
  assert.deepEqual(cards[4].rows,{});
});

test('graphics memory is worded by what is known about the adapter',()=>{
  const f=fixture();
  const rows=adapter=>{set(f,{...SPECS,graphics:[{name:'Adapter',maker:'',kind:'unknown',dedicatedBytes:null,memorySource:null,sharedBytes:null,directx:null,featureLevel:null,driver:'',problem:false,main:true,...adapter}]});f.run('renderHardware()');return f.card(f.cards()[1]);};
  assert.deepEqual(rows({kind:'discrete',dedicatedBytes:8*GIB}).rows,{Type:'Graphics card','Graphics memory':'8 GB'});
  assert.deepEqual(rows({kind:'integrated',dedicatedBytes:2*GIB,sharedBytes:16*GIB}).rows,{Type:'Built-in graphics','Graphics memory':'Shares system memory (up to 16 GB)'});
  assert.deepEqual(rows({kind:'integrated'}).rows,{Type:'Built-in graphics','Graphics memory':'Shares system memory'});
  // An adapter of unknown type shows its own memory when it has some, and no guess about its type.
  assert.deepEqual(rows({dedicatedBytes:GIB-64*MIB}).rows,{'Graphics memory':'960 MB'});
  assert.deepEqual(rows({dedicatedBytes:512*MIB,sharedBytes:8*GIB}).rows,{'Graphics memory':'512 MB'});
  // With none of its own it can only be borrowing the PC's memory.
  assert.deepEqual(rows({dedicatedBytes:0,sharedBytes:8*GIB}).rows,{'Graphics memory':'Shares system memory (up to 8 GB)'});
  assert.deepEqual(rows({dedicatedBytes:0}).rows,{'Graphics memory':'Not reported by Windows'});
  assert.deepEqual(rows({}).rows,{'Graphics memory':'Not reported by Windows'});
  // A device Windows reports a problem with says so, and claims no DirectX support.
  const broken=rows({kind:'discrete',dedicatedBytes:6*GIB,problem:true,driver:'1.2.3'});
  assert.deepEqual(broken.rows,{Type:'Graphics card','Graphics memory':'6 GB','Driver version':'1.2.3'});
  assert.deepEqual(broken.notes,['Windows reports a problem with this device: it is switched off or its driver is not working. Check it in Device Manager.']);
  assert.deepEqual(rows({kind:'discrete',dedicatedBytes:6*GIB}).notes,[]);
});

test('memory sizes read the way they are sold, and never show a made-up figure',()=>{
  const f=fixture();
  const size=(bytes,exact=false)=>{f.context.bytes=bytes;f.context.exact=exact;return f.run('formatMemory(bytes,exact)');};
  assert.equal(size(24*GIB-420*MIB),'24 GB','graphics memory a little under a whole number');
  assert.equal(size(8*GIB),'8 GB');assert.equal(size(12*GIB),'12 GB');
  assert.equal(size(3.5*GIB),'3.5 GB','a real half size is not rounded away');
  assert.equal(size(1.5*GIB),'1.5 GB');assert.equal(size(GIB),'1 GB');
  assert.equal(size(512*MIB),'512 MB');assert.equal(size(128*MIB),'128 MB');assert.equal(size(1),'1 MB');
  assert.equal(size(16*GIB-270*MIB,true),'15.7 GB','usable memory keeps its decimal');
  assert.equal(size(16*GIB,true),'16 GB');
  for(const bad of [0,-1,null,undefined,'',NaN,Infinity,'abc',{}])assert.equal(size(bad),'',`${String(bad)} gives no text`);
});

test('notes explain a partial answer, and a missing graphics driver',()=>{
  const f=fixture();
  set(f,{...SPECS,status:'basic',graphics:[],display:null,drives:[],notes:['probe-failed','something-new','constructor','toString','__proto__',5,null]});f.run('renderHardware()');
  const notes=f.get('#hardware-notes');
  assert.equal(notes.children.length,1,'an unknown note is ignored');
  assert.equal(notes.children[0].className,'warning-note');
  assert.equal(notes.children[0].textContent,'Windows did not answer the full hardware check, so only the basics are shown. Choose Check again to retry.');
  let cards=f.cards().map(f.card);
  assert.deepEqual(cards.map(item=>item.label),['Processor','Graphics','Memory (RAM)','System'],'no empty Storage card for a partial answer');
  assert.equal(cards[1].title,'Not read');assert.deepEqual(cards[1].notes,['Graphics details need the full hardware check.']);
  set(f,{...SPECS,graphics:[],notes:['basic-display']});f.run('renderHardware()');
  assert.match(notes.children[0].textContent,/^Windows is using its basic display driver, so the graphics adapter could not be identified\./);
  cards=f.cards().map(f.card);
  assert.equal(cards[1].title,'Not detected');assert.deepEqual(cards[1].notes,['Windows did not report a graphics adapter with a working driver.']);
  set(f,{...SPECS,status:'basic',notes:['not-windows']});f.run('renderHardware()');
  assert.equal(notes.children[0].textContent,'The full hardware check works only on Windows. Only the basics are shown here.');
  // A second adapter on the basic driver is not listed; the page says so above the adapters that are.
  set(f,{...SPECS,notes:['basic-display-extra']});f.run('renderHardware()');
  assert.deepEqual(notes.children.map(note=>[note.className,note.textContent]),[['warning-note','Another graphics adapter is running on Windows’ basic display driver, so it is not listed here. Install its driver, then check again.']]);
  assert.equal(f.cards().length,7);
  // A screen reader reads the notes out when they appear. Drawing the page again with the same
  // notes leaves them alone, so they are not read out a second time.
  const kept=notes.children[0];
  f.run('renderHardware()');assert.equal(notes.children[0],kept);
  set(f,{...SPECS,checkedAt:'2026-11-10T09:31:00.000Z',notes:['basic-display-extra']});f.run('renderHardware()');assert.equal(notes.children[0],kept,'a new answer with the same notes');
  set(f,{...SPECS,notes:['probe-failed','basic-display-extra']});f.run('renderHardware()');
  assert.equal(notes.children.length,2);assert.notEqual(notes.children[1],kept,'changed notes are written afresh');
  set(f,{...SPECS,notes:[]});f.run('renderHardware()');assert.equal(notes.children.length,0,'and they go when there is nothing to say');
  set(f,{...SPECS,notes:['basic-display-extra']});f.run('renderHardware()');assert.equal(notes.children.length,1);assert.notEqual(notes.children[0],kept);
});

test('opening the page reads the specs once; Check again asks for a fresh reading',async()=>{
  const calls=[];let release;
  const f=fixture({getHardware:options=>{calls.push({...options});return new Promise(resolve=>{release=()=>resolve({...SPECS});});}});
  f.run('wireEvents()');
  f.run('showView("hardware")');
  assert.equal(f.get('#current-view-label').textContent,'PC specs');
  assert.deepEqual(calls,[{refresh:false}]);
  assert.equal(f.get('#check-hardware').disabled,true);
  assert.equal(f.get('#hardware-status').textContent,'Reading this PC’s hardware…');
  assert.equal(f.get('#hardware-grid').children[0].className,'busy-line');
  f.run('showView("hardware")');assert.equal(calls.length,1,'a check that is running is not started twice');
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.cards().length,7);assert.equal(f.get('#check-hardware').disabled,false);
  f.run('showView("hardware")');assert.equal(calls.length,1,'the answer is kept while the app is open');
  const clicked=f.get('#check-hardware').emit('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.at(-1),{refresh:true});assert.equal(calls.length,2);
  assert.equal(f.get('#check-hardware').disabled,true);
  assert.equal(f.cards().length,7,'the last answer stays on screen while the new one is read');
  release();await clicked;
  assert.equal(f.get('#check-hardware').disabled,false);assert.deepEqual(f.toasts,[]);
});

test('a failed reading says so and offers another try',async()=>{
  let fail=true;
  const f=fixture({getHardware:async()=>{if(fail)throw new Error('This PC’s specs could not be read. Try again.');return {...SPECS};}});
  f.run('showView("hardware")');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.toasts,[['This PC’s specs could not be read. Try again.',true]]);
  const empty=f.get('#hardware-grid').children[0];
  assert.equal(empty.className,'empty-state');
  assert.equal(empty.textContent,'This PC’s specs could not be readSomething stopped the check before it finished. Nothing left this PC.Try again','the page says what happened after the message is gone');
  assert.equal(empty.attributes.role,'alert','a screen reader reads the failure out: nothing else on the page reports it');
  assert.equal(f.get('#hardware-status').textContent,'');assert.equal(f.get('#check-hardware').disabled,false);
  fail=false;
  const retry=f.all(empty).find(node=>node.tagName==='button');assert.equal(retry.textContent,'Try again');
  await retry.emit('click');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.cards().length,7);assert.equal(f.toasts.length,1);
});

test('an answer in the wrong shape cannot break the page',()=>{
  const f=fixture();
  for(const odd of [{},{graphics:'x',drives:{},notes:5,processor:7,memory:'y',display:[],system:null},{graphics:[null,{}],drives:[null,{letter:''},{letter:'C',totalBytes:'x'}],checkedAt:'never'}]){
    set(f,odd);assert.doesNotThrow(()=>f.run('renderHardware()'));
    assert.ok(f.cards().length>=3);
  }
});

test('the page is wired into the app: navigation, icons, styles and wording',()=>{
  const html=read('index.html'),js=read('app.js'),css=read('styles.css');
  assert.match(html,/<button class="nav-item" data-view="hardware"><span data-icon="chip"><\/span><span data-i18n>PC specs<\/span><\/button>/);
  assert.match(html,/<section id="hardware-view" class="view" hidden>/);
  for(const id of ['check-hardware','hardware-status','hardware-notes','hardware-grid'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/<p data-i18n>What is inside this PC\. Ravenshelf reads it here when you first open this page and when you choose Check again, and never sends it anywhere\.<\/p>/);
  const icons=vm.runInNewContext(`(${/const icons = (\{[\s\S]*?\n\});/.exec(js)[1]})`);
  for(const name of [...html.matchAll(/data-icon="([^"]+)"/g)].map(match=>match[1]))assert.ok(icons[name],`icon "${name}" exists`);
  for(const name of ['chip','gpu','memory','drive','monitor'])assert.ok(icons[name],name);
  for(const selector of ['.spec-grid','.spec-card','.spec-rows','.spec-drive','.spec-meter-fill','.hardware-status'])assert.ok(css.includes(`${selector}{`),selector);
  // The new rules must mirror in right-to-left languages: no physical sides.
  const added=css.slice(css.indexOf('/* PC specs.'));
  assert.doesNotMatch(added,/(?:margin|padding|border)-(?:left|right)|text-align:(?:left|right)|[^-](?:left|right):/);
  // The page shows PC details, so nothing on it may be an inline style or markup built from data.
  const view=js.slice(js.indexOf('// ---- PC specs'),js.indexOf('function renderCompletionAction'));
  assert.doesNotMatch(view,/innerHTML|insertAdjacentHTML|outerHTML|setAttribute\('style'/);
});

// ---- wording and boundaries, one at a time ----
const BASE=Object.freeze({...SPECS,graphics:[],display:null,drives:[],processor:{name:'Example CPU',sockets:1,cores:8,threads:16,megahertz:3000}});
const render=(f,value)=>{set(f,value);f.run('renderHardware()');return f.cards().map(f.card);};
const find=(cards,label)=>cards.find(card=>card.label===label);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('memory sizes round to a whole number only within 4%, in both directions',()=>{
  const f=fixture();
  const size=(bytes,exact=false)=>{f.context.bytes=bytes;f.context.exact=exact;return f.run('formatMemory(bytes,exact)');};
  assert.equal(size(7.69*GIB),'8 GB','3.9% under');assert.equal(size(7.6*GIB),'7.6 GB','5% under');
  assert.equal(size(8.2*GIB),'8 GB','2.5% over');assert.equal(size(8.4*GIB),'8.4 GB','5% over');
  assert.equal(size(11.5*GIB),'11.5 GB');assert.equal(size(23.5*GIB),'24 GB');assert.equal(size(23.5*GIB,true),'23.5 GB');
  // The same rule just under 1 GB: a "1 GB" card that reports a little less reads "1 GB", and nothing reads "1024 MB".
  assert.equal(size(1004*MIB),'1 GB');assert.equal(size(984*MIB),'1 GB');assert.equal(size(983*MIB),'983 MB');
  assert.equal(size(GIB-1),'1 GB');assert.equal(size(GIB-1,true),'1 GB');
  assert.equal(size(1004*MIB,true),'1004 MB');assert.equal(size(1023*MIB,true),'1023 MB');assert.equal(size(1023.6*MIB,true),'1 GB');
  assert.equal(size(512*MIB,true),'512 MB');assert.equal(size(0.4*MIB),'1 MB');
});

test('one of something is singular, and processor details keep their precision',()=>{
  const f=fixture();
  const processor=value=>render(f,{...BASE,processor:{...BASE.processor,...value}})[0].rows;
  assert.equal(processor({cores:1,threads:1}).Cores,'1 core · 1 thread');
  assert.equal(processor({cores:1,threads:2}).Cores,'1 core · 2 threads');
  assert.equal(processor({cores:4,threads:null}).Cores,'4 cores');
  // Without a core count the row is not called "Cores".
  assert.deepEqual(processor({cores:null,threads:8,megahertz:null}),{Threads:'8'});
  assert.deepEqual(processor({cores:null,threads:null,megahertz:null}),{});
  assert.equal(processor({sockets:2}).Processors,'2');assert.equal(processor({sockets:1}).Processors,undefined);assert.equal(processor({sockets:null}).Processors,undefined);
  assert.deepEqual([2496,3793,800,3000].map(megahertz=>processor({megahertz})['Clock speed']),['2.5 GHz','3.79 GHz','0.8 GHz','3 GHz']);
  const drive={letter:'C',totalBytes:100*GIB,freeBytes:50*GIB,format:'NTFS',removable:false,kind:'ssd',bus:'NVMe',model:''};
  assert.equal(find(render(f,{...BASE,drives:[drive]}),'Storage').title,'1 drive');
  assert.equal(find(render(f,{...BASE,drives:[drive,{...drive,letter:'D'}]}),'Storage').title,'2 drives');
});

test('graphics rows cope with missing details',()=>{
  const f=fixture();
  const rows=adapter=>render(f,{...BASE,graphics:[adapter]})[1];
  const builtIn={name:'Built-in',kind:'integrated',dedicatedBytes:128*MIB,sharedBytes:null,directx:11,featureLevel:null,driver:'',main:true};
  assert.equal(rows(builtIn).rows['Graphics memory'],'Shares system memory');
  assert.equal(rows(builtIn).rows.Supports,'DirectX 11');
  assert.equal(rows({kind:'unknown',dedicatedBytes:null,main:true}).title,'Graphics adapter');
  // Two adapters: only the main one is marked, and it is listed first.
  const pair=render(f,{...BASE,graphics:[{name:'Second',kind:'unknown',main:false},{name:'First',kind:'unknown',main:true}]}).filter(card=>card.label==='Graphics');
  assert.deepEqual(pair.map(card=>[card.title,card.badge]),[['First','Main'],['Second','']]);
});

test('drive wording and the low-space rule at its boundaries',()=>{
  const f=fixture();
  const drive=(value,index=0)=>({letter:'CDEFGHIJKLMN'[index],totalBytes:100*GIB,freeBytes:50*GIB,format:'NTFS',removable:false,kind:'unknown',bus:'',model:'',...value});
  const shown=list=>find(render(f,{...BASE,drives:list.map(drive)}),'Storage').drives;
  assert.deepEqual(shown([{removable:true},{kind:'hdd'},{},{kind:'ssd'},{bus:'USB',removable:true},{bus:'USB',kind:'ssd'},{bus:'SAS',kind:'hdd'},{bus:'Storage Spaces'}]).map(item=>item.heading[1]),
    ['Removable drive','Hard disk','Drive','SSD','USB drive','USB SSD','SAS hard disk','Storage Spaces drive']);
  // Card and built-in flash storage are not called an SSD or a hard disk, whatever Windows says about them.
  assert.deepEqual(shown([{bus:'SD card',kind:'ssd',removable:true},{bus:'SD card'},{bus:'MMC',kind:'ssd'},{bus:'MMC'},{bus:'MMC',kind:'ssd',removable:true},{bus:'MMC',kind:'ssd',model:'Example 64G'}]).map(item=>item.heading[1]),
    ['SD card','SD card','eMMC storage','eMMC storage','MMC card','eMMC storage · Example 64G']);
  const low=(totalBytes,freeBytes)=>shown([{totalBytes,freeBytes}])[0].text.endsWith('· low on space');
  assert.equal(low(400*GIB,40*GIB),false,'exactly a tenth free');assert.equal(low(400*GIB,40*GIB-1),true);
  assert.equal(low(100*GIB,8*GIB),true,'8% of a small drive');
  assert.equal(low(2000*GIB,60*GIB),false,'3% but 60 GB');
  assert.equal(low(1000*GIB,50*GIB),false,'exactly 50 GB');assert.equal(low(1000*GIB,47*GIB),true);
  assert.equal(low(64*GIB,20*GIB),false,'little room, but a third of the drive');
  const [empty,full]=shown([{freeBytes:100*GIB},{freeBytes:0}]);
  assert.deepEqual([empty.text,empty.fill.style.width,empty.fill.className],['100 GB free of 100 GB','0.0%','spec-meter-fill']);
  assert.deepEqual([full.text,full.fill.style.width,full.fill.className],['0 B free of 100 GB · low on space','100.0%','spec-meter-fill low']);
  assert.equal(empty.meter.attributes['aria-hidden'],'true','the bar repeats the sentence under it');
  // A free-space figure that cannot be right gets no bar.
  for(const freeBytes of [101*GIB,-1,NaN,'x',undefined])assert.equal(shown([{freeBytes}])[0].fill,null,String(freeBytes));
});

test('cards for missing or odd parts',()=>{
  const f=fixture();
  const drive={letter:'C',totalBytes:100*GIB,freeBytes:50*GIB,kind:'ssd',bus:'',model:''};
  assert.ok(find(render(f,{...BASE,status:'basic',drives:[drive]}),'Storage'),'drives are shown whenever there are any');
  assert.equal(find(render(f,{...BASE,display:{width:1920,height:null,refreshHz:60}}),'Display'),undefined);
  const display=find(render(f,{...BASE,display:{width:1920,height:1080,refreshHz:null}}),'Display');
  assert.deepEqual([display.title,display.rows,display.hasRows],['1920 × 1080',{},false]);
  assert.match(display.icon,/<rect x="2" y="4" width="20" height="13"/,'monitor icon');
  assert.match(find(render(f,BASE),'Memory (RAM)').icon,/<rect x="2" y="7" width="20" height="9"/,'memory icon');
  assert.equal(render(f,{...BASE,system:{}}).at(-1).title,'Windows');
  assert.equal(render(f,{...BASE,processor:{cores:4}})[0].title,'Not reported');
  assert.equal(find(render(f,{...BASE,memory:null}),'Memory (RAM)').title,'Not reported');
  assert.equal(find(render(f,{...BASE,drives:[{letter:'',totalBytes:5},{totalBytes:5}]}),'Storage').title,'No drives reported');
  assert.equal(render(f,{...BASE,status:'something-else'})[1].title,'Not read','only "complete" is complete');
  const odd=find(render(f,{...BASE,drives:[{letter:'C',totalBytes:0,freeBytes:0}]}),'Storage').drives[0];
  assert.deepEqual([odd.fill,odd.text],[null,'Size unknown'],'a drive without a size gets no bar');
  render(f,{...BASE,checkedAt:'never'});assert.equal(f.get('#hardware-status').textContent,'');
});

test('an empty answer is not an answer: the page says the check failed and offers a fresh one',async()=>{
  const calls=[];let answer=null;
  const f=fixture({getHardware:async value=>{calls.push({...value});return answer;}});
  f.run('showView("hardware")');await tick();
  assert.equal(f.cards().length,0);
  const empty=f.get('#hardware-grid').children[0];
  assert.equal(empty.className,'empty-state');assert.match(empty.textContent,/^This PC’s specs could not be read/);
  assert.deepEqual(f.toasts,[],'the page itself says so');
  f.run('showView("hardware")');await tick();
  assert.deepEqual(calls,[{refresh:false},{refresh:false}],'nothing was kept, so opening the page asks again');
  for(const odd of ['text',7,true,undefined]){answer=odd;f.run('showView("hardware")');await tick();assert.equal(f.cards().length,0,String(odd));}
  answer={...SPECS};
  const offer=f.all(f.get('#hardware-grid')).find(node=>node.tagName==='button');
  assert.equal(offer.textContent,'Try again');
  await offer.emit('click');await tick();
  assert.deepEqual(calls.at(-1),{refresh:true});assert.equal(f.cards().length,7);
  // A later failure keeps the last answer on screen.
  answer=null;await f.get('#check-hardware').emit('click');await tick();
  assert.equal(f.cards().length,7);
});

test('exact wording, time format and the page’s accessibility attributes',()=>{
  const f=fixture();
  render(f,{...BASE,notes:['basic-display']});
  assert.equal(f.get('#hardware-notes').children[0].textContent,'Windows is using its basic display driver, so the graphics adapter could not be identified. Install the graphics driver from the maker of the PC or of the graphics adapter, then check again.');
  assert.match(f.get('#hardware-status').textContent,/^Checked at \d{1,2}[:.]\d{2}.* · Read on this PC only, never sent anywhere\.$/);
  set(f,null);f.run('renderHardware()');
  const empty=f.get('#hardware-grid').children[0];
  // Before the first check. Opening the page starts one at once, so this state has no button of its own.
  assert.equal(empty.textContent,'See what is inside this PCRavenshelf reads the processor, graphics, memory and drives when you open this page. Nothing leaves this PC.');
  assert.equal(f.all(empty).some(node=>node.tagName==='button'),false);assert.equal(empty.attributes.role,undefined);
  assert.match(f.all(empty).find(node=>node.className==='empty-icon').children[0].markup,/<rect x="6" y="6" width="12" height="12"/,'chip icon');
  const html=read('index.html');
  assert.match(html,/<button class="button primary" id="check-hardware"><span data-icon="refresh"><\/span><span data-i18n>Check again<\/span><\/button>/);
  assert.match(html,/<p id="hardware-status" class="hardware-status" role="status"><\/p>/);
  // The status line and the notes are read out by a screen reader when they change; the cards are not, all at once.
  assert.match(html,/<div id="hardware-notes" role="status"><\/div>/);
  assert.match(html,/<div id="hardware-grid" class="spec-grid"><\/div>/);
  assert.doesNotMatch(/<section id="hardware-view"[\s\S]*?<\/section>/.exec(html)[0],/aria-live/);
  const css=read('styles.css');
  assert.ok(css.includes('#hardware-notes .warning-note{margin:0 0 8px}#hardware-notes .warning-note:last-child{margin-block-end:16px}'),'the notes area takes no room while it is empty');
  assert.doesNotMatch(css,/#hardware-notes\{/);
});

test('after a check the keyboard focus goes back to Check again, unless you have moved on',async()=>{
  let release;
  const f=fixture({getHardware:()=>new Promise(resolve=>{release=()=>resolve({...SPECS});})});
  const again=f.get('#check-hardware'),grid=f.get('#hardware-grid'),other=f.get('#some-other-control');
  const check=async(before,during,view)=>{
    again.focused=0;f.document.activeElement=before;
    const done=f.run('loadHardware(true)');
    f.document.activeElement=during;if(view)f.run(`currentView=${JSON.stringify(view)}`);
    release();await done;f.run('currentView="hardware"');
    return again.focused;
  };
  f.run('currentView="hardware"');
  // The browser takes the focus away from a button that is switched off.
  assert.equal(await check(again,null),1,'started with the keyboard on Check again');
  assert.equal(await check(again,f.document.body),1);
  assert.equal(await check(again,again),1,'a browser that leaves the focus on the switched-off button');
  assert.equal(await check(again,other),0,'you moved to something else while it ran');
  assert.equal(await check(again,null,'downloads'),0,'you opened another page while it ran');
  assert.equal(await check(other,null),0,'not started from here');
  assert.equal(await check(null,null),0,'opening the page does not take the focus');
  // "Try again" is part of what the check replaces, so its focus would be lost with it.
  f.run('hardware=null;hardwareFailed=true;renderHardware()');
  const retry=f.all(grid).find(node=>node.tagName==='button');
  assert.equal(retry.textContent,'Try again');
  assert.equal(await check(retry,null),1);
});
