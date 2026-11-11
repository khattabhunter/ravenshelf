'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// The same minimal DOM the other renderer tests use.
function fixture(api={}){
  const nodes=new Map(),lists=new Map();
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this._text='';this.className='';this.open=false;this.isConnected=true;this.disabled=false;this.checked=false;this.value='';this.hidden=false;}
    set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
    append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;this._text='';}remove(){this.isConnected=false;}before(){}
    setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}
    addEventListener(name,listener){const listeners=this.events.get(name)||[];listeners.push(listener);this.events.set(name,listeners);}async emit(name,event={}){for(const listener of this.events.get(name)||[])await listener(event);}
    showModal(){this.open=true;}close(){this.open=false;}focus(){}contains(){return false;}querySelector(selector){return get(selector);}querySelectorAll(selector){return lists.get(selector)||[];}
  }
  function get(selector){if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);}
  const document={querySelector:get,querySelectorAll:selector=>lists.get(selector)||[],createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},documentElement:{style:{setProperty(){}}}};
  const toasts=[];
  const context=vm.createContext({window:{atlas:{setBrowserIntegration:async()=>({}),...api}},document,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8').replace(/start\(\);\s*$/,''),context);
  context.recordToast=(message,isError)=>toasts.push([message,Boolean(isError)]);
  const run=code=>vm.runInContext(code,context);run('toast=recordToast;');
  const all=root=>[root,...root.children.flatMap(all)];
  const findButton=(root,label)=>all(root).find(node=>node.tagName==='button'&&node.textContent.trim()===label);
  return {get,lists,context,run,Element,all,findButton,toasts};
}
const baseState=(changes={})=>({supported:true,enabled:false,phase:'off',problem:'',appVersion:'0.5.0',
  folders:{chromium:{path:'C:\\P\\browser-extension\\chromium',version:'0.5.0'},firefox:{path:'C:\\P\\browser-extension\\firefox',version:'0.5.0'}},
  bridge:{running:false,contact:null,pending:0,captures:[]},
  threatLists:{loaded:true,updating:false,total:0,version:'',updatedAt:null,sources:[]},
  virusTotal:{configured:false,domainChecks:true,fileChecks:true,protectedStorage:true,problem:'',usage:{minute:0,day:0,perMinute:4,perDay:500}},...changes});
const setState=(f,state)=>{f.context.nextState=state;f.run('browserState=nextState;');};

test('the settings card explains each connection state in plain words',()=>{
  const f=fixture();
  setState(f,baseState());f.run('renderBrowserSettings()');
  assert.equal(f.get('#browser-card').hidden,false);
  assert.match(f.get('#browser-status').textContent,/^Off\. Downloads in your browser are not sent/);
  assert.equal(f.get('#browser-setup').hidden,true);assert.equal(f.get('#browser-enabled').checked,false);
  setState(f,baseState({enabled:true,phase:'on',bridge:{running:true,contact:null,pending:0,captures:[]}}));f.run('renderBrowserSettings()');
  assert.match(f.get('#browser-status').textContent,/Load the extension in your browser/);
  assert.equal(f.get('#browser-setup').hidden,false);assert.equal(f.get('#browser-enabled').checked,true);
  const lists={loaded:true,updating:false,total:260990,version:'v',updatedAt:new Date(Date.now()-2*3600000).toISOString(),
    sources:[{id:'malware',label:'malware sites',source:'URLhaus via malware-filter',license:'CC0',count:1858,error:''},{id:'phishing',label:'phishing sites',source:'malware-filter',license:'CC0',count:20629,error:'Could not update this list. The previous copy is still used.'}]};
  setState(f,baseState({enabled:true,phase:'on',threatLists:lists,bridge:{running:true,pending:0,captures:[],contact:{browser:'chromium',extensionVersion:'0.4.9',at:new Date().toISOString()}}}));
  f.run('renderBrowserSettings()');
  assert.match(f.get('#browser-status').textContent,/Chrome, Edge or Brave \(version 0\.4\.9\) was last in touch just now\. It is out of date/);
  assert.match(f.get('#browser-status').className,/warn/);
  assert.equal(f.get('#threat-status').textContent,'260,990 dangerous sites from 2 lists, updated 2 h ago. One list could not be updated; the previous copy is still used.');
  assert.match(f.get('#threat-sources').textContent,/Malware sites: 1,858 entries · URLhaus via malware-filter \(CC0\)/);
  setState(f,baseState({phase:'error',problem:'Ravenshelf could not connect the browser extension. Try again; if it keeps failing, restart Ravenshelf.'}));f.run('renderBrowserSettings()');
  assert.match(f.get('#browser-status').textContent,/could not connect/);assert.match(f.get('#browser-status').className,/error/);
  setState(f,baseState({supported:false}));f.run('renderBrowserSettings()');
  assert.equal(f.get('#browser-enabled').disabled,true);assert.match(f.get('#browser-status').textContent,/on Windows/);
});

test('the VirusTotal section never shows the key and explains its state',()=>{
  const f=fixture();
  setState(f,baseState({enabled:true,phase:'on'}));f.run('renderBrowserSettings()');
  assert.match(f.get('#vt-status').textContent,/No key saved/);assert.equal(f.get('#vt-clear').hidden,true);
  assert.equal(f.get('#vt-domains').disabled,true,'options wait for a key');
  setState(f,baseState({enabled:true,phase:'on',virusTotal:{configured:true,domainChecks:true,fileChecks:false,protectedStorage:true,problem:'',usage:{minute:1,day:7,perMinute:4,perDay:500}}}));f.run('renderBrowserSettings()');
  assert.equal(f.get('#vt-status').textContent,'Key saved and sealed with Windows protected storage. 7 of 500 lookups used today.');
  assert.equal(f.get('#vt-clear').hidden,false);assert.equal(f.get('#vt-domains').checked,true);assert.equal(f.get('#vt-files').checked,false);assert.equal(f.get('#vt-files').disabled,false);
  setState(f,baseState({enabled:true,phase:'on',virusTotal:{configured:false,protectedStorage:false,usage:{}}}));f.run('renderBrowserSettings()');
  assert.match(f.get('#vt-status').textContent,/protected storage is unavailable/);
});

test('a new browser download opens its review, with risky files needing a clear confirmation',async()=>{
  const calls=[];
  const f=fixture({browserCaptureAction:async args=>{calls.push(JSON.parse(JSON.stringify(args)));return {running:true,contact:null,pending:0,captures:[]};}});
  const captures=[
    {id:'w',status:'ready',browser:'chromium',source:'download',name:'setup.exe',size:1048576,address:'https://cdn.example/setup.exe',pageHost:'site.example',chain:[{host:'short.example',listed:null},{host:'cdn.example',listed:null}],
      verdict:{level:'warning',reasons:[{code:'program',level:'warning',message:'This is a Windows program. Open it only if you trust where it came from.'}]},virusTotal:[{kind:'domain',subject:'cdn.example',status:'ok',malicious:0,suspicious:0,harmless:60,undetected:10,link:'https://www.virustotal.com/gui/domain/cdn.example'}],message:''},
    {id:'b',status:'blocked',browser:'firefox',source:'download',name:'invoice.pdf.exe',size:0,address:'https://bad.example/i',pageHost:'',chain:[],verdict:{level:'blocked',reasons:[{code:'double-extension',level:'blocked',message:'The name looks like a .pdf file, but it is really a .exe program.'}]},virusTotal:[],message:''},
    {id:'c',status:'checking',browser:'chromium',source:'link',name:'game.zip',size:0,address:'https://files.example/game.zip',pageHost:'',chain:[],verdict:null,virusTotal:[],message:''}
  ];
  setState(f,baseState({enabled:true,phase:'on',bridge:{running:true,contact:null,pending:2,captures:[]}}));
  f.run('afterBrowserState()');
  assert.equal(f.get('#browser-dialog').open,false);assert.equal(f.get('#browser-captures-button').hidden,true);
  setState(f,baseState({enabled:true,phase:'on',bridge:{running:true,contact:null,pending:2,captures}}));
  f.run('afterBrowserState()');
  assert.equal(f.get('#browser-dialog').open,true,'the review opens when a download arrives');
  assert.equal(f.get('#browser-captures-button').hidden,false);assert.equal(f.get('#browser-captures-count').textContent,'2');
  const cards=f.get('#browser-captures').children;assert.equal(cards.length,3);
  const [warning,blocked,checking]=cards;
  assert.match(warning.textContent,/setup\.exe/);assert.match(warning.textContent,/1\.0 MB · cdn\.example · from site\.example · in Chrome, Edge or Brave/);
  assert.match(warning.textContent,/Redirects: short\.example → cdn\.example/);assert.match(warning.textContent,/VirusTotal: no vendor flags cdn\.example \(70 checked\)/);
  const anyway=f.findButton(warning,'Download anyway'),inBrowser=f.findButton(warning,'Download in browser instead');
  assert.equal(anyway.disabled,true);assert.equal(inBrowser.disabled,true,'risky files wait for the confirmation');
  const box=f.all(warning).find(node=>node.tagName==='input');assert.equal(box.type,'checkbox');
  f.lists.set('[data-needs-ack]',[anyway,inBrowser]);
  box.checked=true;await box.emit('change');
  assert.equal(anyway.disabled,false);
  await anyway.emit('click');
  assert.deepEqual(calls,[{id:'w',action:'download',acknowledgeRisk:true}]);
  assert.equal(f.findButton(blocked,'Download'),undefined);assert.equal(f.findButton(blocked,'Download in browser instead'),undefined);
  assert.ok(f.findButton(blocked,'Dismiss'));assert.match(blocked.textContent,/really a \.exe program/);
  assert.match(checking.textContent,/Checking the link without opening the page/);assert.equal(f.findButton(checking,'Download'),undefined);
});

test('reviews do not reopen for downloads already seen, or over another window',()=>{
  const f=fixture();
  const capture={id:'one',status:'ready',browser:'chromium',source:'download',name:'a.zip',size:1,address:'https://a.example/a.zip',pageHost:'',chain:[],verdict:{level:'ok',reasons:[]},virusTotal:[],message:''};
  setState(f,baseState({bridge:{running:true,contact:null,pending:1,captures:[capture]}}));
  f.run('capturesPrimed=true;afterBrowserState()');
  assert.equal(f.get('#browser-dialog').open,true);
  f.get('#browser-dialog').close();f.run('afterBrowserState()');
  assert.equal(f.get('#browser-dialog').open,false,'closing it is respected');
  f.lists.set('dialog',[{open:true}]);
  setState(f,baseState({bridge:{running:true,contact:null,pending:2,captures:[{...capture,id:'two'},capture]}}));
  f.run('afterBrowserState()');
  assert.equal(f.get('#browser-dialog').open,false,'another open window is not interrupted');
  assert.equal(f.get('#browser-captures-count').textContent,'2','the top bar still shows what waits');
});

test('download cards show browser origin and VirusTotal results, linking only to VirusTotal',()=>{
  const f=fixture();
  f.context.card=new f.Element();
  const report={status:'ok',malicious:3,suspicious:0,harmless:50,undetected:10,link:'https://www.virustotal.com/gui/file/'+'a'.repeat(64)};
  f.context.item={origin:'browser',reputation:{virusTotal:report}};
  f.run('renderDownloadReputation(card,item)');
  assert.equal(f.context.card.hidden,false);
  assert.match(f.context.card.textContent,/From your browser/);assert.match(f.context.card.textContent,/3 of 63 security vendors flag this file as malicious/);
  assert.match(f.context.card.className,/threat/);assert.ok(f.findButton(f.context.card,'View report'));
  f.context.item={origin:'browser',reputation:{virusTotal:{...report,malicious:0,link:'https://evil.example/gui/file/x'}}};
  f.run('renderDownloadReputation(card,item)');
  assert.equal(f.findButton(f.context.card,'View report'),undefined,'other sites are never linked');
  assert.doesNotMatch(f.context.card.className,/threat/);
  f.context.item={origin:'catalog'};f.run('renderDownloadReputation(card,item)');
  assert.equal(f.context.card.hidden,true);
  assert.equal(f.run("virusTotalSummary({status:'skipped',reason:'limit'})").text,'VirusTotal’s free limit was reached, so the rest was not checked. Try again later.');
  assert.equal(f.run("virusTotalSummary({status:'error'})"),null);
});

test('a Nexus Mods file says which mod it is in the review window and in the download list',()=>{
  const f=fixture();
  const mod={site:'nexusmods',game:'skyrimspecialedition',modId:12604,gameId:1704,fileId:735025,gameName:'Skyrim Special Edition',modName:'SkyUI',fileName:'Main File'};
  const capture={id:'m',status:'ready',browser:'chromium',source:'download',name:'SkyUI_5_2_SE-12604-5-2SE.7z',size:2811904,address:'https://supporter-files.nexus-cdn.com/1704/12604/SkyUI_5_2_SE-12604-5-2SE.7z',pageHost:'www.nexusmods.com',chain:[],verdict:{level:'ok',reasons:[]},virusTotal:[],message:'',mod,modFolder:'Mods › Skyrim Special Edition'};
  const review=item=>{f.context.capture=item;const card=f.run('captureCard(capture)');return {card,line:f.all(card).find(node=>node.className==='capture-mod')};};
  const {card,line}=review(capture);
  assert.equal(line.textContent,'Nexus Mods file: “SkyUI” for “Skyrim Special Edition”. Ravenshelf saves it in your download folder, in: Mods › Skyrim Special Edition');
  assert.match(card.textContent,/supporter-files\.nexus-cdn\.com · from www\.nexusmods\.com/,'where the file really comes from is still shown');
  assert.ok(f.findButton(card,'Download'));
  // Each name is a piece of text of its own, kept apart from Ravenshelf's words around it, whichever way its script reads.
  assert.deepEqual(line.children.map(node=>[node.tagName,node.textContent]),[['span','Nexus Mods file: '],['span','“'],['bdi','SkyUI'],['span','”'],['span',' for '],['span','“'],['bdi','Skyrim Special Edition'],['span','”'],['span','.'],
    ['span',' Ravenshelf saves it in your download folder, in: '],['bdi','Mods › Skyrim Special Edition']]);
  // The folder's name can hold words from the page. It stands apart as a path, and nothing of Ravenshelf's own comes after it.
  assert.equal(line.children.at(-1).className,'capture-folder');assert.ok(line.children.slice(0,-1).every(node=>node.className===''));
  // Where it will be saved is said only while that is still what will happen, and only with the folder name the app gave.
  for(const status of ['checking','queued'])assert.match(review({...capture,status}).line.textContent,/, in: Mods › Skyrim Special Edition$/,status);
  for(const status of ['manual','blocked','unavailable','duplicate','dismissed'])assert.equal(review({...capture,status}).line.textContent,'Nexus Mods file: “SkyUI” for “Skyrim Special Edition”.',status);
  for(const modFolder of [undefined,'',null,5,{}])assert.equal(review({...capture,modFolder}).line.textContent,'Nexus Mods file: “SkyUI” for “Skyrim Special Edition”.',String(modFolder));
  // The folder is shown as the app names it, which is not always how the page spelled the game.
  assert.equal(review({...capture,mod:{...mod,gameName:'Kingdom Come: Deliverance II'},modFolder:'Mods › Kingdom Come_ Deliverance II'}).line.textContent,
    'Nexus Mods file: “SkyUI” for “Kingdom Come: Deliverance II”. Ravenshelf saves it in your download folder, in: Mods › Kingdom Come_ Deliverance II');
  // Missing names fall back to the mod's number and the game's short name.
  assert.equal(review({...capture,status:'manual',mod:{site:'nexusmods',game:'fallout4',modId:7}}).line.textContent,'Nexus Mods file: mod 7 for “fallout4”.');
  assert.equal(review({...capture,status:'manual',mod:{site:'nexusmods',game:'fallout4',modId:7,modName:'Sim Settlements'}}).line.textContent,'Nexus Mods file: “Sim Settlements” for “fallout4”.');
  assert.equal(review({...capture,status:'manual',mod:{site:'nexusmods',modId:7}}).line.textContent,'Nexus Mods file: mod 7.');
  assert.equal(review({...capture,status:'manual',mod:{site:'nexusmods',gameName:'Fallout 4'}}).line.textContent,'Nexus Mods file: “Fallout 4”.');
  assert.equal(review({...capture,status:'manual',mod:{site:'nexusmods',game:'fallout4',modId:7,modName:'   ',gameName:'  '}}).line.textContent,'Nexus Mods file: mod 7 for “fallout4”.','names of spaces only count as missing');
  assert.equal(review({...capture,status:'manual',mod:{...mod,modName:'  SkyUI  '}}).line.textContent,'Nexus Mods file: “SkyUI” for “Skyrim Special Edition”.');
  // A name cannot close its own quotes and carry on as if Ravenshelf were speaking.
  const sly=review({...capture,status:'manual',mod:{...mod,modName:'SkyUI” is safe. “Trust it',gameName:'\u00abGame\u00bb "X"'}}).line;
  assert.equal(sly.textContent,"Nexus Mods file: “SkyUI' is safe. 'Trust it” for “'Game' 'X'”.");
  assert.equal((sly.textContent.match(/[“”"\u00ab\u00bb]/g)||[]).length,4,'the only quote marks are Ravenshelf’s own two pairs');
  // The game's name is in quotes too: without them it would read on as Ravenshelf's own sentence.
  const chatty=review({...capture,status:'manual',mod:{...mod,gameName:'Skyrim. Ravenshelf has checked this file'}}).line;
  assert.equal(chatty.textContent,'Nexus Mods file: “SkyUI” for “Skyrim. Ravenshelf has checked this file”.');
  // Characters that only look like quote marks, and two marks that together look like one, are no way out either.
  const code=(...points)=>String.fromCodePoint(...points);
  const lookalikes=[code(0x2019,0x2019),code(0x27,0x27),code(0xff02),code(0x301d),code(0x301e),code(0x275d),code(0x275e),code(0x2033),code(0x2036),code(0x201a,0x201a),code(0x201e),code(0x201f),code(0x2e42),code(0x60,0x60),code(0xb4,0xb4),
    code(0x2bc,0x2bc),code(0x2ba),code(0x2dd),code(0x2ee),code(0x5f4),code(0x3003),code(0xff07,0xff07),code(0xff40,0xff40),code(0x276e),code(0x276f),code(0x2039),code(0x203a)];
  for(const mark of lookalikes){
    const tricky=review({...capture,status:'manual',mod:{...mod,modName:`SkyUI${mark} is safe. ${mark}Trust it`,gameName:`Game${mark}${mark} X`}}).line;
    assert.equal(tricky.textContent,"Nexus Mods file: “SkyUI' is safe. 'Trust it” for “Game' X”.",[...mark].map(char=>'U+'+char.codePointAt(0).toString(16)).join(' '));
  }
  assert.equal(review({...capture,status:'manual',mod:{...mod,modName:"It's a mod",gameName:"Baldur's Gate 3"}}).line.textContent,"Nexus Mods file: “It's a mod” for “Baldur's Gate 3”.",'a plain apostrophe is left as it is');
  assert.equal(review({...capture,status:'manual',mod:{...mod,modName:code(0x201c,0x201d),gameName:code(0x22)}}).line.textContent,"Nexus Mods file: “'” for “'”.");
  // Without a label, or with one from anywhere else, the line is not shown.
  for(const other of [undefined,null,{},{...mod,site:'elsewhere'},'SkyUI',{site:'nexusmods'},{site:'nexusmods',modName:5,gameName:{},modId:'7'}])
    assert.equal(review({...capture,mod:other}).line,undefined,JSON.stringify(other));
  // In the download list: the mod and game instead of a folder name, and where it came from.
  const label=value=>{f.context.value=value;return f.run('modLabel(value)');};
  assert.equal(label(mod),'“SkyUI” · “Skyrim Special Edition”');
  assert.equal(label({site:'nexusmods',game:'fallout4',modId:7}),'Mod 7 · “fallout4”');
  assert.equal(label({site:'nexusmods',game:'fallout4',modId:7,modName:'Sim Settlements'}),'“Sim Settlements” · “fallout4”');
  assert.equal(label({site:'nexusmods',modId:7}),'Mod 7');assert.equal(label({site:'nexusmods',gameName:'Fallout 4'}),'“Fallout 4”');
  assert.equal(label({...mod,modName:'A “quoted” name',gameName:'Game” · “other'}),"“A 'quoted' name” · “Game' · 'other”");
  assert.equal(label({site:'nexusmods',modName:5,gameName:{}}),'');
  for(const other of [undefined,null,{},'SkyUI',{...mod,site:'elsewhere'}])assert.equal(label(other),'',JSON.stringify(other));
  f.context.item={id:'d1',status:'completed',name:'SkyUI_5_2_SE-12604-5-2SE.7z',gameTitle:'Skyrim Special Edition',received:10,total:10,speed:0,connectionMode:'single',activeConnections:0,connectionNote:'Nexus Mods files download over one connection.',origin:'browser',mod};
  f.run('card=makeDownloadCard(item)');
  assert.equal(f.get('.download-game').textContent,'“SkyUI” · “Skyrim Special Edition”');
  assert.match(f.get('.download-reputation').textContent,/^From Nexus Mods/);
  f.context.item={...f.context.item,mod:undefined};f.run('updateDownloadCard(card,item)');
  assert.equal(f.get('.download-game').textContent,'Skyrim Special Edition');assert.match(f.get('.download-reputation').textContent,/^From your browser/);
});
