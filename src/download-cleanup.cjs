'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {workspaceFor}=require('./parallel-download.cjs');
const {scanConfiguredArchives}=require('./download-storage.cjs');
const TTL_MS=5*60*1000;
const MAX_SELECTION=500;
const ARCHIVE=/\.(?:rar|bin|zip|7z|iso|\d{3})$/i;
const WORKSPACE_FILE=/^(?:data\.part|state\.json|state\.json\.tmp|state\.json\.[a-f0-9-]{36}\.tmp)$/i;
const UNSAFE='These files changed or could not be checked safely. Make a new cleanup preview.';
const same=(a,b)=>a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const identity=s=>`${s.dev}:${s.ino}:${s.birthtimeNs}`;
const pathKey=value=>process.platform==='win32'?value.toLowerCase():value;
function bad(){throw new Error(UNSAFE);}
function within(root,target){const relative=path.relative(root,target);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
function local(value){if(typeof value!=='string'||!value||value.length>2048||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\0-\x1f]/.test(value))bad();return path.resolve(value);}
function filename(value){return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\\/<>:"|?*\0-\x1f\x7f]/.test(value)&&!/[. ]$/.test(value)&&!/^\.{1,2}$/.test(value)&&!/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);}
function idsOf(ids){if(!Array.isArray(ids)||!ids.length||ids.length>MAX_SELECTION||ids.some(id=>typeof id!=='string'||!id||id.length>200))throw new Error('Choose between 1 and 500 downloads.');return [...new Set(ids)].sort();}
async function maybeStat(file){try{return await fs.promises.lstat(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function ancestors(file){
  const result=[];
  for(let directory=path.dirname(file);;directory=path.dirname(directory)){
    const stat=await fs.promises.lstat(directory,{bigint:true});
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino===0n)bad();
    result.push({path:directory,stat});if(path.dirname(directory)===directory)break;
  }
  return result;
}
async function checkAncestors(items){for(const item of items){const current=await fs.promises.lstat(item.path,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||!same(item.stat,current))bad();}}
function regular(stat,allowHardLinks){return stat.isFile()&&!stat.isSymbolicLink()&&stat.ino!==0n&&stat.size>=0n&&stat.size<=BigInt(Number.MAX_SAFE_INTEGER)&&(allowHardLinks?stat.nlink>=1n:stat.nlink===1n);}
async function captureFile(file,kind,allowHardLinks=false){
  const parents=await ancestors(file),stat=await maybeStat(file);
  if(stat&&!regular(stat,allowHardLinks))bad();
  await checkAncestors(parents);
  return {path:file,kind,stat,parents,bytes:stat?Number(stat.size):0};
}
async function verifyFile(file){
  await checkAncestors(file.parents);
  const current=await maybeStat(file.path);
  if(!file.stat){if(current)bad();return;}
  if(!current||!regular(current,false)||!same(file.stat,current)||current.size!==file.stat.size||current.mtimeNs!==file.stat.mtimeNs||current.ctimeNs!==file.stat.ctimeNs)bad();
}
function selection(download){
  if(!download||typeof download.id!=='string'||!download.id||download.id.length>200||!filename(download.name)||!ARCHIVE.test(download.name))bad();
  const folder=local(download.folder),final=path.join(folder,download.name),partial=final+'.atlas-part',workspace=workspaceFor(partial,download.id);
  if(!within(folder,final)||!within(folder,partial)||!within(folder,workspace)||path.dirname(workspace)!==folder)bad();
  return {id:download.id,name:download.name,folder,final,partial,workspace};
}
function isStopped(download){return !['queued','downloading'].includes(download.status)&&!['queued','scanning'].includes(download.scan?.status);}
async function capture(download,{summary=false}={}){
  const item=selection(download);
  if(!summary&&!isStopped(download))bad();
  item.issues=false;item.files=[];
  // A missing parent is useful information for storage checks. Never relax
  // cleanup's stricter requirement that its original parents still exist.
  if(summary&&!await maybeStat(item.folder)){item.missing=true;return item;}
  for(const [file,kind]of [[item.final,'completed'],[item.partial,'partial']]){
    try{item.files.push(await captureFile(file,kind,summary));}catch(error){if(!summary)throw error;item.issues=true;}
  }
  try{
  item.parents=await ancestors(item.workspace);item.directory=await maybeStat(item.workspace);item.entries=[];
  if(item.directory){
    if(!item.directory.isDirectory()||item.directory.isSymbolicLink()||item.directory.ino===0n)bad();
    const directory=await fs.promises.opendir(item.workspace);
    try{while(item.entries.length<=128){const entry=await directory.read();if(!entry)break;item.entries.push(entry.name);}}finally{await directory.close();}
    item.entries.sort();
    if(item.entries.length>128||item.entries.some(name=>!WORKSPACE_FILE.test(name))){if(!summary)bad();item.issues=true;}
    for(const name of item.entries.slice(0,128).filter(name=>WORKSPACE_FILE.test(name))){
      try{item.files.push(await captureFile(path.join(item.workspace,name),'partial',summary));}catch(error){if(!summary)throw error;item.issues=true;}
    }
  }
  await checkAncestors(item.parents);
  }catch(error){if(!summary)throw error;item.issues=true;}
  return item;
}
async function verifyItem(item){
  await checkAncestors(item.parents);
  const directory=await maybeStat(item.workspace);
  if(!item.directory){if(directory)bad();}
  else{
    if(!directory||!directory.isDirectory()||directory.isSymbolicLink()||!same(item.directory,directory))bad();
    const entries=(await fs.promises.readdir(item.workspace)).sort();
    if(JSON.stringify(entries)!==JSON.stringify(item.entries))bad();
  }
  for(const file of item.files)await verifyFile(file);
}
function sameSelection(a,download){try{const b=selection(download);return a.id===b.id&&a.name===b.name&&a.folder===b.folder&&isStopped(download);}catch{return false;}}
function totals(files,seenPaths=new Set(),seenFiles=new Set()){
  let completedBytes=0,partialBytes=0;
  for(const file of files){if(!file.stat)continue;const key=pathKey(file.path),inode=identity(file.stat);if(seenPaths.has(key)||seenFiles.has(inode))continue;seenPaths.add(key);seenFiles.add(inode);if(file.kind==='completed')completedBytes+=file.bytes;else partialBytes+=file.bytes;}
  return {completedBytes,partialBytes,totalBytes:completedBytes+partialBytes};
}

function createDownloadCleanup({getDownloads,getDownloadDir,now=Date.now,scanLimits}={}){
  if(typeof getDownloads!=='function')throw new Error('Cleanup needs a download inventory.');
  const pending=new Map();
  const downloads=()=>{const list=getDownloads();if(!Array.isArray(list)||list.length>10000)throw new Error('The download inventory could not be checked.');return list;};
  const expire=()=>{for(const [token,entry]of pending)if(entry.expires<=now())pending.delete(token);};
  const otherOwner=(list,chosen,record)=>list.some(other=>!chosen.includes(other.id)&&(()=>{try{return pathKey(selection(other).partial)===pathKey(record.partial);}catch{return false;}})());
  async function preview(ids){
    const chosen=idsOf(ids),list=downloads(),records=new Map(),warnings=[],items=[],seenPaths=new Set(),seenFiles=new Set();
    let totalBytes=0;
    for(const id of chosen){
      try{
        const download=list.find(item=>item.id===id),record=await capture(download);
        // A duplicate queue row must not let selection of one row remove files
        // still used by an unselected row.
        if(otherOwner(list,chosen,record))bad();
        const bytes=totals(record.files,seenPaths,seenFiles).totalBytes;
        records.set(id,record);items.push({id,name:record.name,bytes});totalBytes+=bytes;
      }catch{records.set(id,null);warnings.push('One selected download could not be included. Stop it and check that its files are in an ordinary private folder.');}
    }
    expire();while(pending.size>=16)pending.delete(pending.keys().next().value);
    const token=crypto.randomBytes(24).toString('hex');pending.set(token,{ids:chosen,records,expires:now()+TTL_MS});
    return {items,totalBytes,warnings,token};
  }
  async function deletePreview({ids,token}={}){
    const chosen=idsOf(ids);expire();const plan=typeof token==='string'?pending.get(token):null;
    if(!plan||plan.expires<=now()||JSON.stringify(chosen)!==JSON.stringify(plan.ids))throw new Error('The cleanup preview expired or changed. Make a new preview.');
    pending.delete(token);
    const removedIds=[],failed=[],seenPaths=new Set();let bytesFreed=0;
    for(const id of chosen){
      const item=plan.records.get(id),handles=[];
      try{
        const assertOwnership=()=>{const list=downloads();if(!item||!sameSelection(item,list.find(download=>download.id===id))||otherOwner(list,chosen,item))bad();};
        assertOwnership();
        // Already-removed paths can be shared by selected duplicate rows.
        const remaining=item.files.filter(file=>!seenPaths.has(pathKey(file.path)));
        if(remaining.length===item.files.length)await verifyItem(item);
        else for(const file of remaining)await verifyFile(file);
        for(const file of remaining){
          if(!file.stat)continue;
          const handle=await fs.promises.open(file.path,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
          handles.push(handle);const stat=await handle.stat({bigint:true});
          if(!regular(stat,false)||!same(file.stat,stat)||stat.size!==file.stat.size||stat.mtimeNs!==file.stat.mtimeNs||stat.ctimeNs!==file.stat.ctimeNs)bad();
        }
        assertOwnership();
        for(const file of remaining){
          await verifyFile(file);
          assertOwnership();
          if(file.stat){await fs.promises.unlink(file.path);bytesFreed+=file.bytes;}
          seenPaths.add(pathKey(file.path));
        }
        if(item.directory){
          await checkAncestors(item.parents);
          const current=await maybeStat(item.workspace);
          if(current){if(!current.isDirectory()||current.isSymbolicLink()||!same(item.directory,current))bad();await fs.promises.rmdir(item.workspace);}
        }
        removedIds.push(id);
      }catch{failed.push({id,message:UNSAFE});}
      finally{await Promise.allSettled(handles.map(handle=>handle.close()));}
    }
    return {removedIds,failed,bytesFreed};
  }
  async function summary({signal}={}){
    const seenPaths=new Set(),seenFiles=new Set(),knownPaths=new Set(),items=[],missingItems=[],warnings=[];let completedBytes=0,partialBytes=0;
    for(const download of downloads()){
      if(signal?.aborted){const error=new Error('The storage check was cancelled.');error.name='AbortError';throw error;}
      try{
        const selected=selection(download);knownPaths.add(pathKey(selected.final));knownPaths.add(pathKey(selected.partial));
        const record=await capture(download,{summary:true}),size=totals(record.files,seenPaths,seenFiles);
        if(!Number.isSafeInteger(completedBytes+partialBytes+size.totalBytes))bad();
        completedBytes+=size.completedBytes;partialBytes+=size.partialBytes;
        const final=record.files.find(file=>file.kind==='completed'),missing=record.missing||(!record.issues&&!record.files.some(file=>file.stat));
        const completedFileMissing=download.status==='completed'&&(record.missing||Boolean(final&&!final.stat));
        items.push({id:record.id,name:record.name,bytes:size.totalBytes,...size,missing:Boolean(missing),completedFileMissing,unavailable:record.issues});
        if(missing||completedFileMissing)missingItems.push({id:record.id,name:record.name,message:completedFileMissing?'The completed archive is no longer at its saved location.':'No tracked download files were found at the saved location.'});
      }
      catch{items.push({id:typeof download?.id==='string'?download.id:'',name:filename(download?.name)?download.name:'Download',bytes:0,completedBytes:0,partialBytes:0,totalBytes:0,unavailable:true});}
    }
    if(items.some(item=>item.unavailable))warnings.push('Some tracked files could not be checked safely. Their storage totals may be incomplete.');
    for(const value of seenPaths)knownPaths.add(value);
    let root;try{root=typeof getDownloadDir==='function'?getDownloadDir():null;}catch{root=null;warnings.push('The configured download folder could not be read.');}
    const scan=await scanConfiguredArchives({root,knownPaths,knownFiles:seenFiles,signal,limits:scanLimits});
    const totalBytes=completedBytes+partialBytes,libraryBytes=totalBytes+scan.untrackedBytes;
    if(!Number.isSafeInteger(libraryBytes))throw new Error('The storage inventory is too large to report safely.');
    return {completedBytes,partialBytes,totalBytes,trackedBytes:totalBytes,libraryBytes,items,missingItems,...scan,warnings:[...warnings,...scan.warnings]};
  }
  return {preview,deletePreview,summary};
}
module.exports={createDownloadCleanup,TTL_MS};
