'use strict';
// This PC's hardware for the "PC specs" page: processor, graphics, memory,
// drives, display and Windows version. Everything is read on this PC, only when
// the page asks, and it stays here: nothing in this file opens a network
// connection or writes a file. The Windows probe (hardware-probe.ps1) asks for
// model names, sizes and capability levels, never for serial numbers or
// anything else that identifies one machine. Its answer is untrusted text:
// every value is checked and size-limited before it is used.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

const PROBE_FILE=path.join(__dirname,'hardware-probe.ps1');
const TIMEOUT_MS=20000;
const MAX_OUTPUT=512*1024;
// "Check again" pressed twice in a row reuses an answer this fresh.
const MIN_REFRESH_MS=3000;
const MIB=1024**2,GIB=1024**3;
// Larger sizes than this (1 PiB) are treated as unreadable.
const MAX_BYTES=2**50;
// Win32_VideoController reports adapter memory as a 32-bit number, so 4 GB and
// more all arrive as a value just under 4 GiB.
const ADAPTER_RAM_CEILING=4*GIB-2*MIB;
const NVIDIA=0x10de,AMD=0x1002,INTEL=0x8086,MICROSOFT=0x1414;
// The last Qualcomm entry is the four letters "QCOM", which DirectX reports on ARM PCs.
const VENDORS=new Map([[NVIDIA,'NVIDIA'],[AMD,'AMD'],[0x1022,'AMD'],[INTEL,'Intel'],[0x17cb,'Qualcomm'],[0x5143,'Qualcomm'],[0x4d4f4351,'Qualcomm']]);
// D3D_FEATURE_LEVEL values as DirectX records them.
const FEATURE_LEVELS=new Map([[0x9100,'9.1'],[0x9200,'9.2'],[0x9300,'9.3'],[0xa000,'10.0'],[0xa100,'10.1'],[0xb000,'11.0'],[0xb100,'11.1'],[0xc000,'12.0'],[0xc100,'12.1'],[0xc200,'12.2']]);
const NEWEST_LEVEL=0xc200;
// D3DKMT_ADAPTERTYPE bits in a DirectX adapter record.
const TYPE={render:0x1,software:0x4,hybridDiscrete:0x10,hybridIntegrated:0x20,indirectDisplay:0x40};
// Windows' own stand-in drivers: shown when a graphics driver is missing, or
// inside a remote session or a virtual machine. They are not graphics hardware.
const STAND_IN=/^Microsoft (?:Basic (?:Display|Render)|Remote Display|Hyper-V Video)\b/i;
const BASIC_DISPLAY=/^Microsoft Basic Display\b/i;
// The basic display driver's name is translated with Windows; the setup file
// it was installed from is not.
const BASIC_DISPLAY_FILES=new Set(['display.inf','basicdisplay.inf']);
const BASIC_DISPLAY_SECTION='MSBDA';
// Screen-only adapters that add a virtual monitor and cannot run a game.
const SCREEN_ONLY=/\b(?:Virtual (?:Display|Monitor)|Indirect Display|IddSampleDriver|Parsec Virtual|spacedesk|DisplayLink|Remote Display|Mirror Driver)\b/i;
// How Windows reaches an adapter. Graphics hardware sits on PCI (ACPI on ARM
// PCs); software, remote and USB screens and Hyper-V's video use these instead.
const SCREEN_ONLY_BUSES=new Set(['ROOT','SWD','USB','VMBUS']);
// MSFT_PhysicalDisk.BusType values worth naming. RAID (8) is left out: a
// single drive behind Intel's storage driver reports it too.
const BUSES=new Map([[1,'SCSI'],[3,'ATA'],[7,'USB'],[10,'SAS'],[11,'SATA'],[12,'SD card'],[13,'MMC'],[16,'Storage Spaces'],[17,'NVMe']]);
const MEDIA={hdd:3,ssd:4,scm:5};
const BUS_NVME=17,BUS_STORAGE_SPACES=16;
const SPINDLE_UNKNOWN=0xffffffff;

// Text from Windows: control characters, invisible and text-direction
// characters, private-use characters and broken character pairs removed,
// spaces collapsed, length limited by whole characters. Anything that is not
// text becomes ''.
function text(value,max=120){
  if(typeof value!=='string')return '';
  const clean=value.slice(0,4096).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}\ufffd]/gu,' ').replace(/\s+/g,' ').trim();
  return clean.length<=max?clean:Array.from(clean).slice(0,max).join('').trim();
}
// A whole number written in decimal digits (or a JSON number), or null.
function count(value,max=Number.MAX_SAFE_INTEGER){
  let number;
  if(typeof value==='number')number=value;
  else if(typeof value==='string'&&/^\d{1,16}$/.test(value.trim()))number=Number(value.trim());
  else return null;
  // Adding 0 turns a JSON "-0" into plain 0.
  return Number.isSafeInteger(number)&&number>=0&&number<=max?number+0:null;
}
const hex=value=>typeof value==='string'&&/^[0-9a-f]{4}$/i.test(value)?parseInt(value,16):null;
// PowerShell writes a one-item list as a single value, and on some PCs a list
// as {value:[…],Count:n}.
function list(value,max=64){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.value)&&Object.hasOwn(value,'Count'))value=value.value;
  if(Array.isArray(value))return value.slice(0,max);
  return value===undefined||value===null||value===''?[]:[value];
}
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
// A model name without its trademark marks: "Intel(R) Core(TM) i7" reads "Intel Core i7".
const tidy=value=>value.replace(/\((?:R|TM|C)\)|[\u00ae\u2122\u00a9]/gi,' ').replace(/\s+/g,' ').trim()||value;
const sameName=(a,b)=>Boolean(a)&&a.toLowerCase()===b.toLowerCase();
// A value from Node's os module; a missing or failing call gives the fallback.
function ask(osApi,name,fallback){try{const value=osApi[name]();return value===undefined||value===null?fallback:value;}catch{return fallback;}}
// Node names the processor type its own way; Windows says "64-bit".
const ARCHITECTURES=new Map([['x64','64-bit'],['arm64','ARM 64-bit']]);
function stamp(value){try{return typeof value==='string'&&/^\d{1,20}$/.test(value)?BigInt(value):0n;}catch{return 0n;}}

function readSystem(raw,osApi){
  const system=record(raw.system);
  const name=text(system.caption).replace(/^Microsoft\s+/i,'');
  return {name:name||text(ask(osApi,'version',''))||'Windows',version:text(system.version,40)||text(ask(osApi,'release',''),40),build:count(system.build,999999),architecture:text(system.architecture,20)||ARCHITECTURES.get(ask(osApi,'arch',''))||''};
}
function readProcessor(raw,osApi){
  const processors=list(raw.processors,8).map(record).map(item=>({name:text(item.name),cores:count(item.cores,4096),threads:count(item.threads,4096),megahertz:count(item.megahertz,100000)})).filter(item=>item.name);
  if(processors.length){
    const sum=key=>processors.every(item=>item[key])?processors.reduce((total,item)=>total+item[key],0):null;
    return {name:tidy(processors[0].name),sockets:processors.length,cores:sum('cores'),threads:sum('threads'),megahertz:processors[0].megahertz||null};
  }
  const found=ask(osApi,'cpus',[]),cpus=Array.isArray(found)?found:[];
  const name=text(cpus[0]?.model);
  return name?{name:tidy(name),sockets:null,cores:null,threads:cpus.length,megahertz:count(Math.round(Number(cpus[0]?.speed)||0),100000)||null}:null;
}
// Installed memory is the sum of the memory modules; Windows can use less than
// that (memory set aside for built-in graphics, for example). A module total
// that makes no sense next to it is dropped: less than Windows can use, or
// several times more, as a virtual machine reports for its allowed maximum.
function readMemory(raw,osApi){
  const memory=record(raw.memory);
  const usable=count(ask(osApi,'totalmem',null),MAX_BYTES);
  const modules=list(memory.modules,64).map(value=>count(value,MAX_BYTES)).filter(Boolean);
  let installed=modules.reduce((total,value)=>total+value,0)||null;
  if(installed&&usable&&(installed<usable||installed>usable*4+GIB))installed=null;
  return usable||installed?{installedBytes:installed,usableBytes:usable||null,modules:installed?modules.length:null}:null;
}

function directxRecord(value){
  const item=record(value),name=text(item.name);
  if(!name)return null;
  const dedicated=count(item.dedicated,MAX_BYTES),system=count(item.dedicatedSystem,MAX_BYTES);
  return {name,vendorId:count(item.vendor,0xffffffff),deviceId:count(item.device,0xffffffff),
    dedicated:dedicated===null?null:dedicated+(system||0),shared:count(item.shared,MAX_BYTES),
    d3d11:count(item.d3d11,0xffff),d3d12:count(item.d3d12,0xffff),type:count(item.type,0xffffffff),seen:stamp(item.seen)};
}
// The DirectX record for an adapter: by maker and model numbers, otherwise by
// name. Of several (an old card's record stays behind when it is replaced),
// the newest wins; then the one with the adapter's exact name; then the one
// closest to the memory the current driver reports.
function pickRecord(records,{vendorId,deviceId,name,driverMemory}){
  const byNumbers=vendorId!==null&&deviceId!==null?records.filter(entry=>entry.vendorId===vendorId&&entry.deviceId===deviceId):[];
  const candidates=byNumbers.length?byNumbers:records.filter(entry=>sameName(entry.name,name));
  const distance=entry=>driverMemory&&entry.dedicated!==null?Math.abs(entry.dedicated-driverMemory):Infinity;
  let best=null;
  for(const entry of candidates){
    if(!best){best=entry;continue;}
    if(entry.seen!==best.seen){if(entry.seen>best.seen)best=entry;continue;}
    const named=sameName(entry.name,name),bestNamed=sameName(best.name,name);
    if(named!==bestNamed){if(named)best=entry;continue;}
    if(distance(entry)<distance(best))best=entry;
  }
  return best;
}
// The DirectX version a game can ask for and the adapter's feature level, both
// from the same one of its two records. A Direct3D 12 level newer than any
// listed here is still DirectX 12; only the name of the level is left out.
function directxSupport(d3d11,d3d12){
  if(FEATURE_LEVELS.has(d3d12)&&d3d12>=0xb000)return {version:12,level:FEATURE_LEVELS.get(d3d12)};
  if(d3d12>NEWEST_LEVEL)return {version:12,level:null};
  if(!FEATURE_LEVELS.has(d3d11))return {version:null,level:null};
  return {version:d3d11>=0xb000?11:d3d11>=0xa000?10:9,level:FEATURE_LEVELS.get(d3d11)};
}
// A separate graphics card, built-in graphics, or unknown. Windows says which
// on laptops that have both; a record that says both at once says nothing.
// Otherwise only what is certain is used. Built-in graphics from Intel and
// NVIDIA have almost no memory of their own, so one of their adapters with
// 2 GB or more is a card; and Intel has made no card with less than 1 GB, so
// an Intel adapter below that is built in. AMD makes both with every amount of
// memory, so an AMD adapter stays unknown, not guessed.
function adapterKind(entry,vendorId,dedicated){
  if(entry?.type!==null&&entry?.type!==undefined){
    const card=Boolean(entry.type&TYPE.hybridDiscrete),builtIn=Boolean(entry.type&TYPE.hybridIntegrated);
    if(card!==builtIn)return card?'discrete':'integrated';
  }
  if(dedicated===null||(vendorId!==NVIDIA&&vendorId!==INTEL))return 'unknown';
  if(dedicated>=2*GIB)return 'discrete';
  return vendorId===INTEL&&dedicated<GIB?'integrated':'unknown';
}
// Which adapter games use: one that works, then a separate card, then the
// most memory of its own. The first listed wins a tie.
function mainRank(adapter){return [adapter.problem?0:1,adapter.kind==='discrete'?2:adapter.kind==='unknown'?1:0,adapter.dedicatedBytes??-1];}
function outranks(a,b){const x=mainRank(a),y=mainRank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function readGraphics(raw){
  const records=list(raw.directx,64).map(directxRecord).filter(Boolean);
  const drivers=list(raw.drivers,64).map(record).map(item=>({name:text(item.name),memory:count(item.memory,MAX_BYTES)})).filter(item=>item.name&&item.memory);
  const adapters=[];let basicDisplay=false,display=null,otherDisplay=null;
  for(const value of list(raw.video,16)){
    const item=record(value),name=text(item.name);
    if(!name)continue;
    const width=count(item.width,100000),height=count(item.height,100000),refresh=count(item.refresh,1000);
    const screen=width&&height?{width,height,refreshHz:refresh||null}:null;
    // Windows' basic display driver stands in for a card whose own driver is missing.
    if(BASIC_DISPLAY.test(name)||BASIC_DISPLAY_FILES.has(text(item.inf,40).toLowerCase())||text(item.section,40).toUpperCase()===BASIC_DISPLAY_SECTION){
      basicDisplay=true;otherDisplay=otherDisplay||screen;continue;
    }
    const numbers={vendorId:hex(item.vendor),deviceId:hex(item.device)};
    const driver=drivers.find(candidate=>sameName(candidate.name,name));
    const entry=pickRecord(records,{...numbers,name,driverMemory:driver?.memory});
    const type=entry?.type??null;
    // Inside a virtual machine a real card can appear under Microsoft's
    // numbers; its DirectX record still names the real maker.
    const vendorId=numbers.vendorId===null||numbers.vendorId===MICROSOFT?entry?.vendorId??numbers.vendorId:numbers.vendorId;
    const standIn=vendorId===MICROSOFT||STAND_IN.test(name)||SCREEN_ONLY_BUSES.has(text(item.bus,16).toUpperCase())
      ||(type!==null&&(type&TYPE.software||type&TYPE.indirectDisplay||!(type&TYPE.render)))||(!entry&&SCREEN_ONLY.test(name));
    if(standIn){otherDisplay=otherDisplay||screen;continue;}
    display=display||screen;
    let dedicated=null,source=null;
    if(entry&&entry.dedicated!==null){dedicated=entry.dedicated;source='directx';}
    else{
      const reported=count(item.memory,MAX_BYTES);
      // A driver's own figure is its graphics memory for NVIDIA and AMD cards;
      // for built-in graphics it can be shared memory, so it is not used.
      if(driver&&(vendorId===NVIDIA||vendorId===AMD)&&driver.memory>=256*MIB&&driver.memory<=256*GIB){dedicated=driver.memory;source='driver';}
      // Windows' own figure stops at 4 GB, and for Intel graphics it is not
      // memory of their own at all.
      else if(reported&&reported<ADAPTER_RAM_CEILING&&vendorId!==INTEL){dedicated=reported;source='windows';}
    }
    // Windows' device status: 0 means working; anything else is a disabled
    // device or a driver problem, and what DirectX recorded may be out of date.
    const status=count(item.status,9999),problem=status!==null&&status!==0;
    const maker=VENDORS.get(vendorId)||text(item.maker,60).replace(/(?:,\s*|\s+)(?:Inc\.?|Corporation|Corp\.?|Ltd\.?|Incorporated)$/i,'').trim()||'';
    const support=entry&&!problem?directxSupport(entry.d3d11,entry.d3d12):{version:null,level:null};
    adapters.push({name:tidy(name),maker,kind:adapterKind(entry,vendorId,dedicated),dedicatedBytes:dedicated,memorySource:source,
      sharedBytes:entry?.shared||null,directx:support.version,featureLevel:support.level,
      driver:text(item.driver,40),problem,main:false});
  }
  let main=null;
  for(const adapter of adapters)if(!main||outranks(adapter,main))main=adapter;
  if(main)main.main=true;
  // The screen size comes from a listed adapter when one reports it. A device
  // on the basic display driver is the whole story when nothing else is
  // listed, and one more thing to say when something is.
  return {adapters,display:display||otherDisplay,basicDisplay:basicDisplay?(adapters.length?'beside':'only'):''};
}

const driveLetter=value=>{const match=/^([a-z]):?$/i.exec(text(value,4));return match?match[1].toUpperCase():null;};
function diskDetails(value){
  if(!value)return {kind:'unknown',bus:'',model:''};
  const media=count(value.media,99),bus=count(value.bus,99),spindle=count(value.spindle,SPINDLE_UNKNOWN);
  let kind='unknown';
  if(media===MEDIA.ssd||media===MEDIA.scm||bus===BUS_NVME)kind='ssd';
  else if(media===MEDIA.hdd||(spindle!==null&&spindle>0&&spindle<SPINDLE_UNKNOWN))kind='hdd';
  return {kind,bus:BUSES.get(bus)||'',model:text(value.model,80)};
}
function readDrives(raw){
  const disks=new Map(),partitions=new Map(),connections=new Map();
  for(const value of list(raw.disks,64)){const item=record(value),id=text(item.id,16);if(id&&!disks.has(id))disks.set(id,item);}
  // How Windows says each numbered disk is connected.
  for(const value of list(raw.connections,64)){const item=record(value),id=text(item.disk,16),bus=count(item.bus,99);if(id&&bus!==null&&!connections.has(id))connections.set(id,bus);}
  for(const value of list(raw.partitions,64)){const item=record(value),letter=driveLetter(item.letter),disk=text(item.disk,16);if(letter&&disk&&!partitions.has(letter))partitions.set(letter,disk);}
  const drives=[],seen=new Set();
  for(const value of list(raw.volumes,32)){
    const item=record(value),letter=driveLetter(item.letter),total=count(item.size,MAX_BYTES),free=count(item.free,MAX_BYTES);
    // A locked drive or an empty card reader has no size to show.
    if(!letter||seen.has(letter)||!total)continue;
    seen.add(letter);
    const disk=partitions.get(letter),connection=connections.get(disk),physical=disks.get(disk);
    // A Storage Spaces disk is made of several drives, so no single drive
    // describes it. And the drive's own details are used only when they are
    // for the same connection as the disk the letter is on; otherwise they
    // may belong to a different drive.
    // Without a drive's own details, the same holds: only the connection is named.
    const connectionOnly={kind:'unknown',bus:BUSES.get(connection)||'',model:''};
    const details=connection===BUS_STORAGE_SPACES||!physical||(connection!==undefined&&count(physical.bus,99)!==connection)?connectionOnly:diskDetails(physical);
    drives.push({letter,totalBytes:total,freeBytes:free!==null&&free<=total?free:null,format:text(item.format,16),removable:text(item.type,4)==='2',...details});
  }
  // Plain A to Z: the order must not depend on the system language.
  return drives.sort((a,b)=>a.letter<b.letter?-1:a.letter>b.letter?1:0);
}

// Turns the probe's answer (or nothing, when it could not run) into the specs
// the page shows. It never throws: unreadable parts are left out.
function summarize(raw,{osApi=os,now=Date.now,windows=true}={}){
  // An answer counts only when it is the probe's own and names the PC's
  // processor or Windows version; otherwise none of it is used.
  const answer=record(raw),system=record(answer.system);
  const complete=answer.schema===1&&(list(answer.processors,8).some(item=>text(record(item).name))||Boolean(text(system.caption)||text(system.version)));
  const source=complete?answer:{};
  const graphics=readGraphics(source);
  const notes=[];
  if(!windows)notes.push('not-windows');else if(!complete)notes.push('probe-failed');
  if(graphics.basicDisplay==='only')notes.push('basic-display');
  if(graphics.basicDisplay==='beside')notes.push('basic-display-extra');
  return {schema:1,status:complete?'complete':'basic',checkedAt:new Date(now()).toISOString(),
    system:readSystem(source,osApi),processor:readProcessor(source,osApi),memory:readMemory(source,osApi),
    graphics:graphics.adapters,display:graphics.display,drives:readDrives(source),notes};
}

function parseProbe(output){
  const value=JSON.parse(String(output).replace(/^\uFEFF/,'').trim());
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!==1)throw new Error('Unexpected hardware answer.');
  return value;
}
// Windows' own folder. The value comes from the environment, so anything that
// is not a full path on a drive, in plain characters, is not believed.
const windowsFolder=value=>typeof value==='string'&&/^[A-Za-z]:\\[^\0-\x1f]*$/.test(value)?value:'C:\\Windows';
// The environment the probe runs in: the app's own, with the place PowerShell
// looks for its commands set to the module folder inside Windows' own folder.
// Windows compares the names of environment variables without case, and of two
// spellings only one reaches the program, so every spelling of this one is
// left out first.
function probeEnvironment(env,modules){
  const own={};
  for(const [name,value] of Object.entries(env||{}))if(name.toUpperCase()!=='PSMODULEPATH')own[name]=value;
  own.PSModulePath=modules;
  return own;
}
// Runs the fixed probe script with Windows PowerShell and returns its output.
// The script takes no input, so nothing from outside Ravenshelf reaches it, and
// PowerShell is told to look for its commands in the module folder inside
// Windows' own folder. Windows PowerShell adds its module folder under Program
// Files by itself. Both can be changed only by an administrator; a module
// folder in the user's profile is not used.
function runProbe({spawnImpl=spawn,systemRoot=process.env.SystemRoot||'C:\\Windows',readFile=fs.readFileSync,timeoutMs=TIMEOUT_MS,env=process.env}={}){
  return new Promise((resolve,reject)=>{
    let child,timer=null,done=false,size=0;const chunks=[];
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const stop=()=>{try{child.kill();}catch{}};
    try{
      const script=readFile(PROBE_FILE,'utf8');
      const home=path.win32.join(windowsFolder(systemRoot),'System32','WindowsPowerShell','v1.0');
      child=spawnImpl(path.win32.join(home,'powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
        {windowsHide:true,stdio:['ignore','pipe','ignore'],env:probeEnvironment(env,path.win32.join(home,'Modules'))});
      // A program that could not start reports it through this event, so it is
      // listened for before anything else can fail.
      child.on('error',error=>finish(error));
      child.on('close',code=>{if(code===0)finish(null,Buffer.concat(chunks).toString('utf8'));else finish(new Error('The hardware check could not finish.'));});
      if(!child.stdout){stop();finish(new Error('The hardware check could not finish.'));return;}
      child.stdout.on('error',()=>{stop();finish(new Error('The hardware check could not finish.'));});
      child.stdout.on('data',chunk=>{
        size+=chunk.length;
        if(size>MAX_OUTPUT){stop();finish(new Error('The hardware answer was too large.'));}
        else chunks.push(chunk);
      });
    }catch(error){finish(error);return;}
    timer=setTimeout(()=>{stop();finish(new Error('The hardware check took too long.'));},timeoutMs);
  });
}

// Reads the specs on request and keeps the last answer in memory for the
// session. Requests made while a check is running share that check.
function createHardwareService({platform=process.platform,probe=runProbe,osApi=os,now=Date.now}={}){
  let last=null,lastAt=0,pending=null;
  async function detect(){
    const windows=platform==='win32';
    let raw=null;
    if(windows){try{raw=parseProbe(await probe());}catch{raw=null;}}
    // An answer that cannot be read must not stop the page: show the basics.
    try{return summarize(raw,{osApi,now,windows});}catch{return summarize(null,{osApi,now,windows});}
  }
  return {
    get({refresh=false}={}){
      if(pending)return pending;
      // "Check again" straight after a full answer gives that answer. After an
      // answer that is not complete, it always checks again.
      if(last&&(!refresh||(last.status==='complete'&&Math.abs(now()-lastAt)<MIN_REFRESH_MS)))return Promise.resolve(last);
      pending=detect().then(value=>{last=value;lastAt=now();return value;}).finally(()=>{pending=null;});
      return pending;
    }
  };
}
module.exports={createHardwareService,summarize,parseProbe,runProbe,PROBE_FILE,TIMEOUT_MS,MAX_OUTPUT,MIN_REFRESH_MS};
