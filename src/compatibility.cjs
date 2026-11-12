'use strict';
// Can You Run It: reads a game's requirement list (plain text, one item per
// line, as Ravenshelf shows it) and compares what can be compared with this
// PC's specs. Every line says "meets", "below" or "unknown".
//
// Only figures are compared: Windows version, 64-bit Windows, memory,
// graphics memory, DirectX and free space. Processor and graphics card
// models are never compared, because no ranking of them may be bundled with
// Ravenshelf; those lines are always "unknown" and show both names.
// Nothing here reads files, starts programs or contacts anything.

const KIB=1024,MIB=KIB**2,GIB=KIB**3,TIB=KIB**4;
const MAX_TEXT=16000,MAX_LINES=80,MAX_SHOWN=300;
// Windows reports a "6 GB" card as a little less (5.875 GB is common), so
// graphics memory meets a figure within this share of it.
const GRAPHICS_TOLERANCE=0.9;

// What a line is about, by the name in front of its colon.
const LABELS=[
  ['windows',/^(?:os|operating system|operating systems|system)$/],
  ['processor',/^(?:processor|processors|cpu)$/],
  ['memory',/^(?:memory|ram|system memory|system ram)$/],
  ['graphics',/^(?:graphics|graphics card|graphics cards|video card|video cards|video|gpu|video adapter|graphics adapter)$/],
  ['videoMemory',/^(?:video memory|vram|graphics memory|video ram)$/],
  ['directx',/^(?:directx|direct x|dx)$/],
  ['storage',/^(?:storage|hard drive|hard disk|hard drive space|hard disk space|disk space|free disk space|hdd|hdd space|disk)$/],
];
// Item names that start a new item when a site writes several on one line.
// A name is not split off the word in front of it: "Video Memory:" and
// "Graphics Memory:" stay whole.
const ITEM_START=/(?<!\b(?:Video|Graphics))\s+(?=(?:OS|Operating System|Processor|CPU|System Memory|Memory|RAM|Graphics Card|Graphics Memory|Graphics|Video Card|Video Memory|VRAM|DirectX|Storage|Hard Drive Space|Hard Disk Space|Hard Drive|Hard Disk|Free Disk Space|Disk Space|Network|Sound Card|Additional Notes|VR Support)\s*[*®™]*\s*:)/g;
const CONTROLS=/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

// Text from a website: control and direction characters removed, spaces
// collapsed, and kept short.
function clean(value,limit=MAX_SHOWN){
  return String(value).replace(CONTROLS,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
function lineList(text){
  return String(text).slice(0,MAX_TEXT).split('\n')
    .flatMap(line=>clean(line,MAX_TEXT).split(ITEM_START))
    .map(line=>line.trim().replace(/^[•·*\-–—]+\s*/,''))
    .filter(Boolean).slice(0,MAX_LINES);
}
// "OS (64-bit)" and "Video Card/GPU" name one item: words in brackets are
// left out, and each name between slashes is tried.
function labelOf(name){
  const key=name.toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[*®™]/g,'').replace(/\s+/g,' ').trim();
  for(const part of [key,...key.split('/').map(value=>value.trim())])for(const [item,pattern]of LABELS)if(pattern.test(part))return item;
  return null;
}

// Reads one tier (Minimum or Recommended) into its items. The first line for
// an item counts; graphics lines are all kept, for graphics memory.
function readTier(text){
  const items={},graphics=[];let bits=null;
  for(const line of lineList(text)){
    const match=/^([A-Za-z][A-Za-z0-9 ./()*®™-]{0,40}?)\s*[*®™]*\s*:\s*(.*)$/.exec(line);
    const item=match?labelOf(match[1]):null;
    if(item){
      const value=match[2].trim();
      if(item==='graphics')graphics.push(value);
      if(!(item in items))items[item]=value;
    }
    // 64-bit Windows is asked for in the Windows or processor line, or a line
    // of its own ("Requires a 64-bit processor and operating system").
    if((!item||item==='windows'||item==='processor')&&bits===null&&wants64(line))bits=clean(line);
  }
  return {items,graphics,bits};
}
function wants64(line){
  // "32/64-bit" and "32 or 64-bit" allow both, so they ask for nothing.
  if(/\b32\s*(?:-?\s*bits?)?\s*(?:\/|or|and|,)\s*64|\bx86\s*\/\s*x64|\b64\s*(?:-?\s*bits?)?\s*(?:\/|or)\s*32\b/i.test(line))return false;
  return /\b64[\s-]?bits?\b|\bx64\b|\bx86[-_]64\b|\bamd64\b/i.test(line);
}

const UNITS={tb:TIB,tib:TIB,gb:GIB,gib:GIB,mb:MIB,mib:MIB};
const NUMBER='(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
function number(value){
  // "1,500" is fifteen hundred; "1,5" is one and a half.
  const text=/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)?value.replace(/,/g,''):value.replace(',','.');
  const result=Number(text);
  return Number.isFinite(result)?result:null;
}
// Every size in a text, in bytes, in the order written. A range ("8-16 GB")
// counts as its lower end. Sizes outside [min,max] are left out.
function sizesIn(text,{min=MIB,max=100*TIB}={}){
  const found=[];
  const pattern=new RegExp(`(?<![\\d.,])${NUMBER}(?:\\s*(?:-|–|to)\\s*${NUMBER})?\\s*(TB|TiB|GB|GiB|MB|MiB)\\b`,'gi');
  for(const match of String(text).matchAll(pattern)){
    const value=number(match[1]),unit=UNITS[match[3].toLowerCase()];
    if(value===null||!unit)continue;
    const bytes=Math.round(value*unit);
    if(bytes>=min&&bytes<=max)found.push({bytes,index:match.index,end:match.index+match[0].length});
  }
  return found;
}
function firstSize(text,limits){return sizesIn(text,limits)[0]?.bytes??null;}

// Graphics memory in a graphics line: the smallest size printed, because
// "GTX 1060 6GB / RX 580 8GB" means either card. A size said to be system
// memory, or shared, is not graphics memory.
function graphicsMemory(lines){
  let least=null;
  for(const line of lines)for(const size of sizesIn(line,{min:16*MIB,max:256*GIB})){
    const after=line.slice(size.end,size.end+24),before=line.slice(Math.max(0,size.index-24),size.index);
    if(/^\s*\)?\s*(?:of\s+)?(?:system\b|shared\b|ram\b|of\s+ram\b|memory\s+ram\b)/i.test(after))continue;
    if(/(?:system|shared)\s+(?:ram|memory)\b[^0-9]*$/i.test(before))continue;
    if(least===null||size.bytes<least)least=size.bytes;
  }
  return least;
}

const WINDOWS_RANK={xp:5.1,vista:6,'7':7,'8':8,'8.1':8.1,'10':10,'11':11};
// The oldest Windows version a line names, or null.
function windowsNeeded(line){
  let least=null;
  for(const match of String(line).matchAll(/\bwin(?:dows)?\s*(?:®|\(r\)|™)?\s*(xp|vista|8\.1|7|8|10|11)(?!\d|\.\d)/gi)){
    const rank=WINDOWS_RANK[match[1].toLowerCase()];
    if(rank!==undefined&&(least===null||rank<least))least=rank;
  }
  return least;
}
// This PC's Windows version, from its version number and build.
function windowsHave(system){
  const version=/^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,6}))?/.exec(String(system?.version||''));
  const build=Number.isSafeInteger(system?.build)&&system.build>0?system.build:version?.[3]?Number(version[3]):null;
  if(version){
    const major=Number(version[1]),minor=Number(version[2]);
    if(major===10)return build===null?null:build>=22000?11:10;
    const older={'6.3':8.1,'6.2':8,'6.1':7,'6.0':6,'5.2':5.1,'5.1':5.1}[`${major}.${minor}`];
    if(older!==undefined)return older;
    return null;
  }
  const named=/\bWindows\s+(11|10|8\.1|8|7)\b/i.exec(String(system?.name||''));
  return named?WINDOWS_RANK[named[1]]:null;
}
function bitsHave(system){
  const value=String(system?.architecture||'');
  if(/arm/i.test(value))return 'arm';
  if(/64/.test(value))return '64';
  if(/32|86/.test(value))return '32';
  return null;
}

// DirectX: the version a line asks for, and the feature level when it names
// one ("12_1", "feature level 12.1") or asks for "DirectX 12 Ultimate".
function directxNeeded(value,{named=false}={}){
  const text=String(value);
  const pattern=named?/\b(?:directx|dx)\s*(?:version\s*)?(\d{1,2})(?:\.\d+[a-c]?)?\b/i:/^(?:version\s*|v\.?\s*|directx\s*|dx\s*)?(\d{1,2})(?:\.\d+[a-c]?)?\b/i;
  const match=pattern.exec(text.trim());
  if(!match)return null;
  const version=Number(match[1]);
  if(version<5||version>12)return null;
  let level=null;
  // "11.0" after a version is the version itself; a level is written "12_1"
  // or named as a feature level.
  const feature=/\bfeature\s+level\s*(1[12])[._](\d)\b|\b(1[12])_(\d)\b/i.exec(text);
  if(feature){
    const major=Number(feature[1]||feature[3]),minor=Number(feature[2]||feature[4]);
    if(major<=version)level=Number(`${major}.${minor}`);
  }
  if(version===12&&/\bultimate\b/i.test(text))level=Math.max(level||0,12.2);
  return {version,level};
}

function mainAdapter(specs){
  const adapters=Array.isArray(specs?.graphics)?specs.graphics.filter(Boolean):[];
  return adapters.find(adapter=>adapter.main)||adapters[0]||null;
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const row=(key,needs,verdict,extra={})=>({key,needs:clean(needs),verdict,need:null,have:null,haveText:'',note:null,...extra});

function compareTier(text,specs){
  const {items,graphics,bits}=readTier(text);
  const rows=[],specsRead=specs&&typeof specs==='object';
  const system=specsRead?specs.system:null;

  if('windows' in items){
    const need=windowsNeeded(items.windows),have=specsRead?windowsHave(system):null;
    const verdict=need===null||have===null?'unknown':have>=need?'meets':'below';
    rows.push(row('windows',items.windows,verdict,{need,have,note:need===null?'no-value':null}));
  }
  if(bits!==null){
    const have=specsRead?bitsHave(system):null;
    // Windows on ARM runs many 64-bit games through emulation; whether this one does is not known.
    const verdict=have==='64'?'meets':have==='32'?'below':'unknown';
    rows.push(row('bits',bits,verdict,{need:'64',have,note:have==='arm'?'arm':null}));
  }
  if('processor' in items){
    rows.push(row('processor',items.processor,'unknown',{haveText:clean(specs?.processor?.name||''),note:'model'}));
  }
  if('memory' in items){
    const need=firstSize(items.memory,{min:16*MIB,max:2*TIB});
    const installed=finite(specs?.memory?.installedBytes),usable=finite(specs?.memory?.usableBytes);
    let verdict='unknown',have=null,note=need===null?'no-value':null;
    if(need!==null){
      // Installed memory is what a game's list means. When Windows gives only
      // the memory it can use, that answers "meets", never "below".
      if(installed!==null){have=installed;verdict=installed>=need?'meets':'below';}
      else if(usable!==null){have=usable;verdict=usable>=need?'meets':'unknown';if(verdict==='unknown')note='usable';}
    }
    rows.push(row('memory',items.memory,verdict,{need,have,note}));
  }
  const adapter=mainAdapter(specs);
  if(graphics.length){
    rows.push(row('graphics',graphics[0],'unknown',{haveText:clean(adapter?.name||''),note:'model'}));
  }
  const vramLine='videoMemory' in items?items.videoMemory:null;
  const vramNeed=vramLine!==null?graphicsMemory([vramLine]):graphicsMemory(graphics);
  if(vramLine!==null||vramNeed!==null){
    let verdict='unknown',have=null,note=vramNeed===null?'no-value':null;
    const dedicated=finite(adapter?.dedicatedBytes);
    if(vramNeed!==null&&adapter){
      // Built-in graphics use part of the PC's memory, and a device with a
      // problem may not have up-to-date figures: neither is compared.
      if(adapter.problem)note='problem';
      else if(adapter.kind==='integrated'||(adapter.maker==='Intel'&&adapter.kind!=='discrete'))note='shared';
      else if(dedicated!==null){have=dedicated;verdict=dedicated>=vramNeed*GRAPHICS_TOLERANCE?'meets':'below';}
    }
    const shown=vramLine!==null?vramLine:graphics.find(line=>graphicsMemory([line])===vramNeed)||graphics[0];
    // derived: the figure was read from the graphics card line.
    rows.push(row('videoMemory',shown,verdict,{need:vramNeed,have,note,derived:vramLine===null}));
  }
  const directxLine='directx' in items?items.directx:graphics.find(line=>directxNeeded(line,{named:true}));
  if(directxLine!==undefined){
    const need=directxNeeded(directxLine,{named:!('directx' in items)});
    let verdict='unknown',have=null,note=need===null?'no-value':null;
    if(need&&adapter&&!adapter.problem&&Number.isInteger(adapter.directx)){
      const level=Number.parseFloat(adapter.featureLevel);
      have={version:adapter.directx,level:Number.isFinite(level)?level:null};
      if(adapter.directx<need.version)verdict='below';
      else if(need.level===null)verdict='meets';
      else if(have.level!==null)verdict=have.level>=need.level?'meets':'below';
    }else if(need&&adapter?.problem)note='problem';
    rows.push(row('directx',directxLine,verdict,{need,have,note}));
  }
  if('storage' in items){
    const need=firstSize(items.storage,{min:MIB,max:100*TIB});
    const drives=(Array.isArray(specs?.drives)?specs.drives:[]).filter(drive=>drive&&!drive.removable&&finite(drive.freeBytes)!==null&&/^[A-Z]$/.test(String(drive.letter)));
    let verdict='unknown',have=null,drive=null,note=need===null?'no-value':null;
    if(need!==null&&drives.length){
      // The game can go on any fixed drive: the one with the most free space counts.
      const best=drives.reduce((a,b)=>b.freeBytes>a.freeBytes?b:a);
      have=best.freeBytes;drive=best.letter;verdict=have>=need?'meets':'below';
    }
    rows.push(row('storage',items.storage,verdict,{need,have,drive,note}));
  }
  const counts={meets:0,below:0,unknown:0};
  for(const item of rows)counts[item.verdict]++;
  const verdict=counts.below?'below':counts.meets?'meets':'unknown';
  return {verdict,rows,counts};
}

// The whole answer for one game. requirements: {minimum, recommended} as
// plain text; specs: the PC specs answer (or null when there is none).
function compareRequirements(requirements,specs){
  const tiers={};let listed=false;
  for(const tier of ['minimum','recommended']){
    const text=requirements&&typeof requirements[tier]==='string'?requirements[tier]:'';
    if(!text.trim())continue;
    listed=true;
    const result=compareTier(text,specs);
    if(result.rows.length)tiers[tier]=result;
  }
  const notes=Array.isArray(specs?.notes)?specs.notes.filter(note=>['not-windows','probe-failed'].includes(note)):[];
  // no-requirements: the game has no list; nothing-to-compare: it has one,
  // but none of its lines is one Ravenshelf reads.
  const status=!listed?'no-requirements':!Object.keys(tiers).length?'nothing-to-compare':!specs||typeof specs!=='object'?'no-specs':specs.status==='complete'?'complete':'partial';
  return {schema:1,status,tiers,notes};
}

module.exports={compareRequirements,compareTier,readTier,sizesIn,graphicsMemory,windowsNeeded,windowsHave,bitsHave,directxNeeded,wants64,GIB,MIB};
