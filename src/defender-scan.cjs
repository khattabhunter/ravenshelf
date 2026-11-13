'use strict';
// Asks Microsoft Defender to scan one finished download. Defender keeps its
// normal behaviour: if it finds a threat it may quarantine or remove the file.
// Ravenshelf only reports the result; it never changes antivirus settings.
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');

const SCAN_TIMEOUT_MS=20*60*1000;
const MAX_OUTPUT=4*1024*1024;

function versionParts(name){return name.split(/[.-]/).map(part=>Number(part)||0);}
function compareVersions(a,b){
  const x=versionParts(a),y=versionParts(b);
  for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}
  return 0;
}
// The newest Defender platform folder has the current MpCmdRun; Program Files is the fallback.
function findMpCmdRun({env=process.env,fsApi=fs}={}){
  const candidates=[];
  const platform=path.win32.join(env.ProgramData||'C:\\ProgramData','Microsoft','Windows Defender','Platform');
  try{
    const versions=fsApi.readdirSync(platform,{withFileTypes:true})
      .filter(entry=>entry.isDirectory()&&/^\d+(?:\.\d+)+(?:-\d+)?$/.test(entry.name))
      .map(entry=>entry.name).sort(compareVersions).reverse();
    for(const version of versions)candidates.push(path.win32.join(platform,version,'MpCmdRun.exe'));
  }catch{}
  candidates.push(path.win32.join(env.ProgramFiles||'C:\\Program Files','Windows Defender','MpCmdRun.exe'));
  return candidates.find(file=>{try{return fsApi.statSync(file).isFile();}catch{return false;}})||null;
}
// MpCmdRun exit 0 means "no malware" OR "malware found and remediated"; 2 means
// "found and not remediated", "user action required" or a scan error. Human-
// readable output can be localized or incomplete, so ambiguous success must
// remain a review result. Never infer "no threats" from the exit code alone.
// The same results for a folder (a torrent with several files).
const FOLDER={
  found:'Microsoft Defender found a threat in this download. Do not open its files. Check Windows Security → Protection history.',
  removed:'Microsoft Defender found a threat and removed or quarantined this download. Check Windows Security → Protection history.',
  slow:'The Microsoft Defender scan took too long and was stopped. Scan the download again later.',
  gone:'The download’s folder disappeared during the scan; Microsoft Defender may have removed it. Check Windows Security → Protection history.',
  review:'Microsoft Defender finished, but its result needs review. Check Windows Security → Protection history before opening the files.',
  failed:'Microsoft Defender could not finish this scan. If you use another antivirus, scan the download’s folder there.',
  missing:'The download’s folder was not found, so it was not scanned.'
};
function interpretScan({code,stdout='',stderr='',timedOut=false,fileExists=true,file='',folder=false}){
  const result=interpretFileScan({code,stdout,stderr,timedOut,fileExists,file});
  if(!folder)return result;
  const key={'Microsoft Defender found a threat in this file. Do not open it. Check Windows Security → Protection history.':'found',
    'Microsoft Defender found a threat and removed or quarantined this file. Check Windows Security → Protection history.':'removed',
    'The Microsoft Defender scan took too long and was stopped. Scan the file again later.':'slow',
    'The file disappeared during the scan; Microsoft Defender may have removed it. Check Windows Security → Protection history.':'gone',
    'Microsoft Defender finished, but its result needs review. Check Windows Security → Protection history before opening the file.':'review',
    'Microsoft Defender could not finish this scan. If you use another antivirus, scan the file there.':'failed'}[result.message];
  return key?{...result,message:FOLDER[key]}:result;
}
function interpretFileScan({code,stdout='',stderr='',timedOut=false,fileExists=true,file=''}){
  // Do not let a phrase inside the echoed filename become scan evidence.
  const normalize=value=>{
    const text=String(value).toLowerCase();
    return typeof file==='string'&&file?text.split(file.toLowerCase()).join('<file>'):text;
  };
  const text=normalize(stdout)+'\n'+normalize(stderr);
  const threats=[...text.matchAll(/\bfound\s+(\d+)\s+threats?\b/g)].some(match=>Number(match[1])>0);
  const listed=/list of detected threats|^\s*threat\s*:/m.test(text);
  // Positive evidence survives remediation (exit 0), errors and timeouts.
  if(threats||listed){
    return fileExists
      ?{status:'threat',message:'Microsoft Defender found a threat in this file. Do not open it. Check Windows Security → Protection history.'}
      :{status:'threat',message:'Microsoft Defender found a threat and removed or quarantined this file. Check Windows Security → Protection history.'};
  }
  if(timedOut)return {status:'error',message:'The Microsoft Defender scan took too long and was stopped. Scan the file again later.'};
  if(code===0&&!fileExists)return {status:'threat',message:'The file disappeared during the scan; Microsoft Defender may have removed it. Check Windows Security → Protection history.'};
  if(code===0){
    const lines=normalize(stdout).split(/[\r\n]+/).map(line=>line.trim()).filter(Boolean);
    const cleanLine=line=>/^(?:scanning(?:\s+(?:"<file>"|<file>))?\s+)?found no threats\.?$/.test(line);
    const progressLine=line=>/^scan (?:starting|finished)(?:\.{1,3})?$/.test(line)||/^scanning (?:"<file>"|<file>)(?:\.{1,3})?$/.test(line);
    if(!String(stderr).trim()&&lines.some(cleanLine)&&lines.every(line=>cleanLine(line)||progressLine(line)))
      return {status:'clean',message:'Microsoft Defender found no threats.'};
    return {status:'review',message:'Microsoft Defender finished, but its result needs review. Check Windows Security → Protection history before opening the file.'};
  }
  return {status:'error',message:'Microsoft Defender could not finish this scan. If you use another antivirus, scan the file there.'};
}
function createDefenderScanner({execFileImpl=execFile,findTool=findMpCmdRun,fsApi=fs,platform=process.platform,timeoutMs=SCAN_TIMEOUT_MS,now=()=>new Date()}={}){
  // A folder is scanned only when the caller expects one (a torrent's folder);
  // links (junctions, symbolic links) are never followed into another place.
  const exists=(file,folder)=>{try{if(!folder)return fsApi.statSync(file).isFile();const stat=fsApi.lstatSync(file);return stat.isDirectory()&&!stat.isSymbolicLink();}catch{return false;}};
  return async function scanFile(file,{folder=false}={}){
    folder=folder===true;
    const stamp=()=>now().toISOString();
    if(platform!=='win32')return {status:'unavailable',message:'Microsoft Defender scanning is available on Windows only.',scannedAt:stamp()};
    if(typeof file!=='string'||!path.win32.isAbsolute(file)||!exists(file,folder))return {status:'missing',message:folder?FOLDER.missing:'The file was not found, so it was not scanned.',scannedAt:stamp()};
    let tool=null;try{tool=findTool();}catch{}
    if(!tool)return {status:'unavailable',message:'Microsoft Defender was not found. Scan the file with your antivirus before opening it.',scannedAt:stamp()};
    const result=await new Promise(resolve=>{
      try{
        execFileImpl(tool,['-Scan','-ScanType','3','-File',file],{windowsHide:true,timeout:timeoutMs,maxBuffer:MAX_OUTPUT,encoding:'utf8'},(error,stdout,stderr)=>{
          const timedOut=Boolean(error&&(error.killed||error.signal));
          const code=error?(Number.isInteger(error.code)?error.code:null):0;
          resolve({code,stdout:String(stdout||''),stderr:String(stderr||''),timedOut});
        });
      }catch{resolve({code:null,stdout:'',timedOut:false});}
    });
    return {...interpretScan({...result,file,folder,fileExists:exists(file,folder)}),scannedAt:stamp()};
  };
}
module.exports={createDefenderScanner,findMpCmdRun,interpretScan,compareVersions,SCAN_TIMEOUT_MS};
