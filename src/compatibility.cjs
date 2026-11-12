'use strict';
// Can You Run It: reads a game's requirement list (plain text, one item per
// line, as Ravenshelf shows it) and compares what can be compared with this
// PC's specs. Every line says "meets", "below" or "unknown".
//
// Only figures are compared: Windows version, 64-bit Windows, memory,
// graphics memory, DirectX and free space. Processor and graphics card
// models are never compared, because no ranking of them may be bundled with
// Ravenshelf; those lines are always "unknown" and show both names.
// The rule throughout: when a line could be read two ways, it is "unknown".
// Nothing here reads files, starts programs or contacts anything.

const KIB=1024,MIB=KIB**2,GIB=KIB**3,TIB=KIB**4;
const MAX_TEXT=16000,MAX_LINES=80,MAX_SHOWN=300;
// Windows reports a "6 GB" card as a little less (5.875 GB is common), so
// graphics memory meets a figure within this share of it.
const GRAPHICS_TOLERANCE=0.95;

// What a line is about, by the name in front of its colon.
const LABELS=[
  ['windows',/^(?:os|operating system|operating systems|system)$/],
  ['processor',/^(?:processor|processors|cpu)$/],
  ['memory',/^(?:memory|ram|system memory|system ram)$/],
  ['graphics',/^(?:graphics|graphics card|graphics cards|video card|video cards|video|gpu|video adapter|graphics adapter)$/],
  ['videoMemory',/^(?:video memory|vram|graphics memory|video ram|gpu memory|gpu ram|graphics card memory|video card memory|dedicated video memory|dedicated video ram)$/],
  ['directx',/^(?:directx|direct x|dx)$/],
  ['storage',/^(?:storage|hard drive|hard disk|hard drive space|hard disk space|disk space|free disk space|hdd|hdd space|disk)$/],
];
// Item names that can start a new item when a site writes several on one
// line. A name only starts one after a part that already has its own colon,
// so "Video Memory:" and "GPU Memory:" stay whole.
const ITEM_NAME=/\s+(?=(?:OS|Operating System|Processor|CPU|System Memory|Memory|RAM|GPU|Graphics Card|Graphics Memory|Graphics|Video Card|Video Memory|VRAM|DirectX|Storage|Hard Drive Space|Hard Disk Space|Hard Drive|Hard Disk|HDD|Free Disk Space|Disk Space|Disk|Network|Sound Card|Additional Notes|VR Support)\s*[*®™]*\s*(?:\([^)]{0,30}\)\s*)?:)/g;
// "Minimum:", "Recommended:" and the like, on a line of their own.
const HEADER=/^(?:minimum|recommended|maximum|required|requirements)\b[^:]{0,40}:?$/i;
// Control, format (direction marks among them), surrogate, private-use and
// line-separator characters.
const CONTROLS=/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

// Text from a website: those characters replaced by spaces, spaces
// collapsed, and kept short.
function clean(value,limit=MAX_SHOWN){
  return String(value).replace(CONTROLS,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
function splitItems(line){
  const parts=[];let start=0;
  for(const match of line.matchAll(ITEM_NAME)){
    if(!line.slice(start,match.index).includes(':'))continue;
    parts.push(line.slice(start,match.index));start=match.index+match[0].length;
  }
  parts.push(line.slice(start));
  return parts;
}
function lineList(text){
  return String(text).slice(0,MAX_TEXT).split('\n')
    .flatMap(line=>splitItems(clean(line,MAX_TEXT)))
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
// an item counts; graphics lines are all kept, for graphics memory. A second
// heading ("Recommended:" inside the minimum list) ends the tier.
function readTier(text){
  const items={},graphics=[];let bits=null,headings=0;
  for(const line of lineList(text)){
    if(HEADER.test(line)){
      if(headings++||Object.keys(items).length||bits!==null)break;
      continue;
    }
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
  // A line that mentions 32-bit or x86 at all allows both, or is unclear:
  // either way it asks for nothing.
  if(/\b32(?:[\s-]*bits?)?\b(?!\s*(?:GB|MB|TB|GiB|MiB|threads?|cores?)\b)|\bx86\b(?![-_]64)|\bi[3-6]86\b/i.test(line))return false;
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
// counts as its lower end; a "range" whose first number is not the smaller
// is a model number and a size ("Vega 56 - 8 GB"). A number that follows a
// letter is part of a name ("DDR4", "R9"), and a speed ("500 MB/s") is not a
// size. Sizes outside [min,max] are left out.
function sizesIn(text,{min=MIB,max=100*TIB}={}){
  const found=[],source=String(text);
  const pattern=new RegExp(`(?<![A-Za-z\\d.,])${NUMBER}(?:\\s*(?:-|–|to)\\s*${NUMBER})?\\s*(TB|TiB|GB|GiB|MB|MiB)\\b`,'gi');
  for(const match of source.matchAll(pattern)){
    const first=number(match[1]),second=match[2]===undefined?null:number(match[2]),unit=UNITS[match[3].toLowerCase()];
    const value=second!==null&&first!==null&&!(first<second)?second:first;
    if(value===null||!unit)continue;
    const end=match.index+match[0].length;
    if(/^\s*(?:\/\s*s(?:ec)?\b|per\s+second\b)/i.test(source.slice(end,end+16)))continue;
    const bytes=Math.round(value*unit);
    if(bytes>=min&&bytes<=max)found.push({bytes,index:match.index,end});
  }
  return found;
}

// Graphics memory in graphics lines: the smallest size printed, because
// "GTX 1060 6GB / RX 580 8GB" means either card. A line about built-in
// graphics is left out (their memory is the PC's), and so is a size said to
// be system, shared or unified memory.
const BUILT_IN=/\b(?:integrated|built[-\s]?in|igpu|apu|on-?board|shared\s+(?:memory|ram)|unified\s+memory|system\s+(?:memory|ram))\b/i;
function graphicsMemory(lines){
  let least=null;
  for(const line of lines){
    if(BUILT_IN.test(line))continue;
    for(const size of sizesIn(line,{min:16*MIB,max:256*GIB})){
      const after=line.slice(size.end,size.end+24);
      if(/^\s*\)?\s*(?:of\s+)?(?:system\b|shared\b|unified\b|dual[\s-]?channel\b|(?:lp)?ddr\d*\b|ram\b|of\s+ram\b|memory\s+ram\b)/i.test(after))continue;
      if(least===null||size.bytes<least)least=size.bytes;
    }
  }
  return least;
}

const WINDOWS_RANK={xp:5.1,vista:6,'7':7,'8':8,'8.1':8.1,'10':10,'11':11};
const WINDOWS_NAME=/\bwin(?:dows)?\s*(?:®|\(r\)|™)?\s*(xp|vista|8\.1|7|8|10|11)(?!\d|\.\d)/gi;
// The oldest Windows version a line names, or null.
function windowsNeeded(line){
  let least=null;
  for(const match of String(line).matchAll(WINDOWS_NAME)){
    const rank=WINDOWS_RANK[match[1].toLowerCase()];
    if(rank!==undefined&&(least===null||rank<least))least=rank;
  }
  return least;
}
// A Windows line that rules versions out ("Windows 7 is not supported"),
// or asks for an update of a version ("version 2004", "SP1", "22H2").
const WINDOWS_EXCEPT=/\b(?:not|no\s+longer|unsupported|isn['’]t|aren['’]t|except|excluding|without|upgrade[sd]?\s+from|end\s+of\s+support|deprecated)\b/i;
const WINDOWS_UPDATE=/\b(?:version|build|update|sp\s?\d|service\s+pack|\d{2}h\d|rs\d|\d{4,5})\b/i;
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

// DirectX: every version a line names, each with the feature level it asks
// for: "12_1" or "feature level 12.1", "11.1" (a version 10 to 12 with a
// minor number), or "DirectX 12 Ultimate".
function directxList(value,{named=false}={}){
  const text=String(value).trim(),found=[];
  const pattern=named?/\b(?:directx|dx)\s*(?:version\s*)?(\d{1,2})(?:\.(\d)[a-c]?)?(?!\d|\.\d)/gi:/(?:^|\b(?:version|directx|dx)\s*|^v\.?\s*)(\d{1,2})(?:\.(\d)[a-c]?)?(?!\d|\.\d)/gi;
  const feature=/\bfeature\s+level\s*(1[12])[._](\d)\b|\b(1[12])_(\d)\b/i.exec(text);
  const ultimate=/\bultimate\b/i.test(text);
  for(const match of text.matchAll(pattern)){
    const version=Number(match[1]);
    if(version<5||version>12)continue;
    let level=null;
    if(version>=10&&match[2]!==undefined&&Number(match[2])>0)level=Number(`${version}.${match[2]}`);
    if(feature){
      const major=Number(feature[1]||feature[3]),minor=Number(feature[2]||feature[4]);
      if(major<=version)level=Math.max(level||0,Number(`${major}.${minor}`));
    }
    if(version===12&&ultimate)level=Math.max(level||0,12.2);
    found.push({version,level});
  }
  return found;
}
function directxNeeded(value,options){return directxList(value,options)[0]||null;}

function mainAdapter(specs){
  const adapters=Array.isArray(specs?.graphics)?specs.graphics.filter(Boolean):[];
  return adapters.find(adapter=>adapter.main)||adapters[0]||null;
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const row=(key,needs,verdict,extra={})=>({key,needs:clean(needs),verdict,need:null,have:null,haveText:'',note:null,...extra});
// Several figures in one line: one answer when they agree, "unknown" when
// they do not ("100 GB (150 GB during installation)").
function agree(verdicts){
  if(!verdicts.length)return 'unknown';
  return verdicts.every(value=>value===verdicts[0])?verdicts[0]:'unknown';
}

function compareTier(text,specs){
  const {items,graphics,bits}=readTier(text);
  const rows=[],specsRead=Boolean(specs&&typeof specs==='object');
  const notes=specsRead&&Array.isArray(specs.notes)?specs.notes:[];
  // On a PC that is not Windows, its own version numbers say nothing about Windows.
  const windowsKnown=specsRead&&!notes.includes('not-windows');
  const system=windowsKnown?specs.system:null;

  if('windows' in items){
    const line=items.windows,need=windowsNeeded(line),have=windowsKnown?windowsHave(system):null;
    let verdict='unknown',note=need===null?'no-value':null;
    if(need!==null&&WINDOWS_EXCEPT.test(line))note='unclear';
    else if(need!==null&&have!==null){
      // An update of the same version ("Windows 10 version 2004") is not compared.
      if(have===need&&WINDOWS_UPDATE.test(line))note='update';
      else verdict=have>=need?'meets':'below';
    }
    rows.push(row('windows',line,verdict,{need,have,note}));
  }
  if(bits!==null){
    // Only the full check says how Windows itself is built: the basic one
    // describes Ravenshelf's own build.
    const have=windowsKnown&&specs.status==='complete'?bitsHave(system):null;
    // Windows on ARM runs many 64-bit games through emulation; whether this one does is not known.
    const verdict=have==='64'?'meets':have==='32'?'below':'unknown';
    rows.push(row('bits',bits,verdict,{need:'64',have,note:have==='arm'?'arm':null}));
  }
  if('processor' in items){
    rows.push(row('processor',items.processor,'unknown',{haveText:clean(specs?.processor?.name||''),note:'model'}));
  }
  if('memory' in items){
    const needs=sizesIn(items.memory,{min:16*MIB,max:2*TIB}).map(size=>size.bytes);
    const installed=finite(specs?.memory?.installedBytes),usable=finite(specs?.memory?.usableBytes);
    let verdict='unknown',have=null,note=needs.length?null:'no-value';
    if(needs.length){
      // Installed memory is what a game's list means. When Windows gives only
      // the memory it can use, that answers "meets", never "below".
      if(installed!==null){have=installed;verdict=agree(needs.map(need=>installed>=need?'meets':'below'));if(verdict==='unknown')note='unclear';}
      else if(usable!==null){have=usable;verdict=needs.every(need=>usable>=need)?'meets':'unknown';if(verdict==='unknown')note='usable';}
    }
    rows.push(row('memory',items.memory,verdict,{need:needs[0]??null,have,note}));
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
      // problem may not have up-to-date figures: neither is compared. When
      // Windows does not say whether a device is a card, enough memory
      // meets, and less is not judged.
      if(adapter.problem)note='problem';
      else if(adapter.kind==='integrated'||(adapter.maker==='Intel'&&adapter.kind!=='discrete'))note='shared';
      else if(dedicated!==null){
        have=dedicated;
        if(dedicated>=vramNeed*GRAPHICS_TOLERANCE)verdict='meets';
        else if(adapter.kind==='discrete')verdict='below';
        else note='kind';
      }
    }
    const shown=vramLine!==null?vramLine:graphics.find(line=>graphicsMemory([line])===vramNeed)||graphics[0];
    // derived: the figure was read from the graphics card line.
    rows.push(row('videoMemory',shown,verdict,{need:vramNeed,have,note,derived:vramLine===null}));
  }
  const directxLine='directx' in items?items.directx:graphics.find(line=>directxNeeded(line,{named:true}));
  if(directxLine!==undefined){
    const needs=directxList(directxLine,{named:!('directx' in items)});
    let verdict='unknown',have=null,note=needs.length?null:'no-value';
    if(needs.length&&adapter&&!adapter.problem&&Number.isInteger(adapter.directx)){
      const level=Number.parseFloat(adapter.featureLevel);
      have={version:adapter.directx,level:Number.isFinite(level)?level:null};
      const judge=need=>{
        if(have.version<need.version)return 'below';
        if(need.level!==null)return have.level===null?'unknown':have.level>=need.level?'meets':'below';
        // A DirectX 12 card at an older feature level: whether the game needs a newer one is not known.
        if(need.version===12&&have.level!==null&&have.level<12)return 'unknown';
        return 'meets';
      };
      const answers=needs.map(judge);
      verdict=agree(answers);
      if(verdict==='unknown')note=new Set(answers).size>1?'unclear':'level';
    }else if(needs.length&&adapter?.problem)note='problem';
    rows.push(row('directx',directxLine,verdict,{need:needs[0]??null,have,note}));
  }
  if('storage' in items){
    const needs=sizesIn(items.storage,{min:MIB,max:100*TIB}).map(size=>size.bytes);
    const drives=(Array.isArray(specs?.drives)?specs.drives:[]).filter(drive=>drive&&!drive.removable&&finite(drive.freeBytes)!==null&&/^[A-Z]$/.test(String(drive.letter)));
    let verdict='unknown',have=null,drive=null,note=needs.length?null:'no-value';
    if(needs.length&&drives.length){
      // The game can go on any fixed drive: the one with the most free space counts.
      const best=drives.reduce((a,b)=>b.freeBytes>a.freeBytes?b:a);
      have=best.freeBytes;drive=best.letter;verdict=agree(needs.map(need=>have>=need?'meets':'below'));
      if(verdict==='unknown')note='unclear';
    }
    rows.push(row('storage',items.storage,verdict,{need:needs[0]??null,have,drive,note}));
  }
  const counts={meets:0,below:0,unknown:0};
  for(const item of rows)counts[item.verdict]++;
  const verdict=counts.below?'below':counts.meets?'meets':'unknown';
  return {verdict,rows,counts};
}

// The whole answer for one game. requirements: {minimum, recommended} as
// plain text; specs: the PC specs answer (or null when there is none).
// unavailable: the game's details could not be loaded this time.
function compareRequirements(requirements,specs,{unavailable=false}={}){
  const tiers={};let listed=false;
  for(const tier of ['minimum','recommended']){
    const text=requirements&&typeof requirements[tier]==='string'?requirements[tier]:'';
    if(!text.trim())continue;
    listed=true;
    const result=compareTier(text,specs);
    if(result.rows.length)tiers[tier]=result;
  }
  const notes=Array.isArray(specs?.notes)?specs.notes.filter(note=>['not-windows','probe-failed'].includes(note)):[];
  // no-requirements: the game has no list; details-unavailable: the list
  // could not be loaded this time; nothing-to-compare: it has one, but none
  // of its lines is one Ravenshelf reads.
  const status=!listed?(unavailable?'details-unavailable':'no-requirements'):!Object.keys(tiers).length?'nothing-to-compare':!specs||typeof specs!=='object'?'no-specs':specs.status==='complete'?'complete':'partial';
  return {schema:1,status,tiers,notes};
}

module.exports={compareRequirements,compareTier,readTier,sizesIn,graphicsMemory,windowsNeeded,windowsHave,bitsHave,directxNeeded,directxList,wants64,GIB,MIB};
