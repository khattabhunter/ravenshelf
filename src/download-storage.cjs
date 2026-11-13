'use strict';
const {isWindowsDeviceName}=require('./safe-name.cjs');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const DEFAULT_LIMITS=Object.freeze({maxEntries:5000,maxDepth:3,maxResults:200,maxMs:3000});
const ARCHIVE=/\.(?:rar|bin|zip|7z|iso|\d{3})(?:\.atlas-part)?$/i;
const key=value=>process.platform==='win32'?value.toLowerCase():value;
const identity=stat=>`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
const same=(a,b)=>a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
function inside(root,target){const relative=path.relative(root,target);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
function safeName(name){return typeof name==='string'&&name.length>0&&name.length<=255&&!/[\\/<>:"|?*\0-\x1f\x7f]/.test(name)&&!/[. ]$/.test(name)&&!/^\.{1,2}$/.test(name)&&!isWindowsDeviceName(name);}
function supportedRoot(value){
  if(typeof value!=='string'||value.length>2048||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\0-\x1f]/.test(value))return false;
  const root=path.resolve(value),home=path.resolve(os.homedir());
  if(root===path.parse(root).root||inside(root,home))return false;
  const broad=[home,...['Downloads','Desktop','Documents','Pictures','Videos','Music','AppData'].map(name=>path.join(home,name)),process.env.APPDATA,process.env.LOCALAPPDATA,process.env.WINDIR,process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData].filter(Boolean).map(value=>key(path.resolve(value)));
  return !broad.includes(key(root))&&!root.slice(path.parse(root).root.length).includes(':');
}
async function snapshotParents(directory){
  const records=[];
  for(let current=directory;;current=path.dirname(current)){
    const stat=await fs.promises.lstat(current,{bigint:true});
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino===0n)throw new Error('Unsafe directory.');
    records.push({path:current,stat});if(path.dirname(current)===current)break;
  }
  return records;
}
async function verifyParents(records){for(const record of records){const stat=await fs.promises.lstat(record.path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||!same(record.stat,stat))throw new Error('Changed directory.');}}
function limitsFrom(values={}){return Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([name,maximum])=>[name,Number.isInteger(values[name])&&values[name]>=1?Math.min(maximum,values[name]):maximum]));}
function cancelled(signal){if(signal?.aborted){const error=new Error('The storage check was cancelled.');error.name='AbortError';throw error;}}

// Metadata only: no content is opened, no links are followed deliberately and
// no untracked path is ever returned as a cleanup/delete authorization.
async function scanConfiguredArchives({root,knownPaths=new Set(),knownFiles=new Set(),signal,limits}={}){
  cancelled(signal);
  const bounds=limitsFrom(limits),items=[],warnings=[],scan={status:'complete',entriesScanned:0,archivesFound:0,reportedItems:0,limitReached:false,skippedEntries:0};
  let bytes=0;
  const result=()=>({untrackedBytes:bytes,untrackedItems:items,warnings,scan});
  if(!root){scan.status='not-configured';return result();}
  if(!supportedRoot(root)){scan.status='unsupported';warnings.push('Choose a dedicated game download folder to check other archives. Broad system or personal folders are not scanned.');return result();}
  root=path.resolve(root);
  const deadline=performance.now()+bounds.maxMs,pending=[{directory:root,depth:0}],seenPaths=new Set(knownPaths),seenFiles=new Set(knownFiles);
  let rootParents;
  try{rootParents=await snapshotParents(root);}catch{scan.status='unavailable';warnings.push('The configured download folder is missing, inaccessible, or linked. Other archives could not be checked.');return result();}
  const limited=()=>{cancelled(signal);if(performance.now()>=deadline||scan.entriesScanned>=bounds.maxEntries){scan.limitReached=true;return true;}return false;};
  while(pending.length&&!limited()){
    const {directory,depth}=pending.shift();let handle,parents;
    const candidates=[],directories=[];
    try{
      parents=await snapshotParents(directory);await verifyParents(rootParents);
      handle=await fs.promises.opendir(directory);
      while(!limited()){
        const entry=await handle.read();if(!entry)break;scan.entriesScanned++;
        if(!safeName(entry.name)){scan.skippedEntries++;continue;}
        const target=path.join(directory,entry.name);if(!inside(root,target)){scan.skippedEntries++;continue;}
        // App checkpoint folders are accounted for from their queue owners.
        if(/^\.atlas-segments-/i.test(entry.name))continue;
        try{
          const stat=await fs.promises.lstat(target,{bigint:true});
          if(stat.isSymbolicLink()||stat.ino===0n){scan.skippedEntries++;continue;}
          if(stat.isDirectory()){
            if(depth<bounds.maxDepth)directories.push({directory:target,depth:depth+1});else scan.limitReached=true;
            continue;
          }
          if(!stat.isFile()||!ARCHIVE.test(entry.name))continue;
          if(stat.size<0n||stat.size>BigInt(Number.MAX_SAFE_INTEGER)||stat.nlink<1n){scan.skippedEntries++;continue;}
          const pathname=key(target),inode=identity(stat);
          if(seenPaths.has(pathname)||seenFiles.has(inode))continue;
          candidates.push({name:entry.name,relativePath:path.relative(root,target),bytes:Number(stat.size),kind:/\.atlas-part$/i.test(entry.name)?'partial':'completed',deletable:false,pathname,inode});
        }catch{scan.skippedEntries++;}
      }
      // Discard a directory's pending entries if it was replaced while read.
      await verifyParents(parents);await verifyParents(rootParents);cancelled(signal);
      for(const item of candidates){
        if(seenPaths.has(item.pathname)||seenFiles.has(item.inode))continue;
        if(!Number.isSafeInteger(bytes+item.bytes)){scan.skippedEntries++;continue;}
        seenPaths.add(item.pathname);seenFiles.add(item.inode);bytes+=item.bytes;scan.archivesFound++;
        if(items.length<bounds.maxResults){const {pathname,inode,...publicItem}=item;items.push(publicItem);}
      }
      pending.push(...directories);
    }catch(error){if(error?.name==='AbortError')throw error;scan.skippedEntries++;}
    finally{if(handle)await handle.close().catch(()=>{});}
  }
  cancelled(signal);
  try{await verifyParents(rootParents);}catch{scan.status='unavailable';scan.archivesFound=0;scan.reportedItems=0;bytes=0;items.length=0;warnings.push('The download folder changed during the check. Check space again.');return result();}
  if(scan.limitReached||scan.skippedEntries){scan.status='partial';warnings.push('Some folders or files could not be checked, or the scan limit was reached. Totals shown are a partial snapshot.');}
  if(scan.archivesFound>items.length)warnings.push(`Only the first ${bounds.maxResults} other archives are listed; their total includes all archives counted in this check.`);
  scan.reportedItems=items.length;return result();
}
module.exports={scanConfiguredArchives,DEFAULT_LIMITS};
