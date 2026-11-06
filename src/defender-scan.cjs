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
// "found and not remediated", "user action required" or a scan error. The text
// output and whether the file still exists separate those cases.
function interpretScan({code,stdout='',timedOut=false,fileExists=true}){
  const text=String(stdout);
  if(timedOut)return {status:'error',message:'The Microsoft Defender scan took too long and was stopped. Scan the file again later.'};
  const counted=/found\s+(\d+)\s+threats?/i.exec(text);
  const threats=counted?Number(counted[1]):0;
  const listed=/LIST OF DETECTED THREATS|^\s*Threat\s*:/im.test(text);
  if(threats>0||(code===2&&listed)){
    return fileExists
      ?{status:'threat',message:'Microsoft Defender found a threat in this file. Do not open it. Check Windows Security → Protection history.'}
      :{status:'threat',message:'Microsoft Defender found a threat and removed or quarantined this file. Check Windows Security → Protection history.'};
  }
  if(code===0&&!fileExists)return {status:'threat',message:'The file disappeared during the scan; Microsoft Defender may have removed it. Check Windows Security → Protection history.'};
  if(code===0)return {status:'clean',message:'Microsoft Defender found no threats.'};
  return {status:'error',message:'Microsoft Defender could not finish this scan. If you use another antivirus, scan the file there.'};
}
function createDefenderScanner({execFileImpl=execFile,findTool=findMpCmdRun,fsApi=fs,platform=process.platform,timeoutMs=SCAN_TIMEOUT_MS,now=()=>new Date()}={}){
  const exists=file=>{try{return fsApi.statSync(file).isFile();}catch{return false;}};
  return async function scanFile(file){
    const stamp=()=>now().toISOString();
    if(platform!=='win32')return {status:'unavailable',message:'Microsoft Defender scanning is available on Windows only.',scannedAt:stamp()};
    if(typeof file!=='string'||!path.win32.isAbsolute(file)||!exists(file))return {status:'missing',message:'The file was not found, so it was not scanned.',scannedAt:stamp()};
    let tool=null;try{tool=findTool();}catch{}
    if(!tool)return {status:'unavailable',message:'Microsoft Defender was not found. Scan the file with your antivirus before opening it.',scannedAt:stamp()};
    const result=await new Promise(resolve=>{
      try{
        execFileImpl(tool,['-Scan','-ScanType','3','-File',file],{windowsHide:true,timeout:timeoutMs,maxBuffer:MAX_OUTPUT,encoding:'utf8'},(error,stdout)=>{
          const timedOut=Boolean(error&&(error.killed||error.signal));
          const code=error?(Number.isInteger(error.code)?error.code:null):0;
          resolve({code,stdout:String(stdout||''),timedOut});
        });
      }catch{resolve({code:null,stdout:'',timedOut:false});}
    });
    return {...interpretScan({...result,fileExists:exists(file)}),scannedAt:stamp()};
  };
}
module.exports={createDefenderScanner,findMpCmdRun,interpretScan,compareVersions,SCAN_TIMEOUT_MS};
