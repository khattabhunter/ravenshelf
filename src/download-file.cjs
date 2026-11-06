'use strict';
const fs=require('node:fs');
const path=require('node:path');

const unsafe=()=>new Error('The download file or folder changed or is unsafe. Choose a private download folder and retry.');
const same=(a,b)=>a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
async function directories(file){
  const result=[];
  for(let directory=path.dirname(path.resolve(file));;directory=path.dirname(directory)){
    const stat=await fs.promises.lstat(directory,{bigint:true});
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino===0n)throw unsafe();
    result.push({directory,stat});
    if(path.dirname(directory)===directory)break;
  }
  return result;
}
async function verifyDirectories(before){
  for(const {directory,stat}of before){
    const current=await fs.promises.lstat(directory,{bigint:true});
    if(!current.isDirectory()||current.isSymbolicLink()||!same(stat,current))throw unsafe();
  }
}

// Open without truncating or appending. All size checks and subsequent writes
// refer to this descriptor, including across asynchronous network requests.
// Exclusive creation never overwrites an unexpected file. Descriptor identity,
// hard-link and ancestor checks cover ordinary replacements and junctions;
// this is not isolation from malware already running as the same OS user.
async function openDownloadFile(file,{create=false,allowMissing=false,readOnly=false}={}){
  if(readOnly&&create)throw new Error('A read-only file cannot be created.');
  const parents=await directories(file);
  const flags=(readOnly?fs.constants.O_RDONLY:fs.constants.O_RDWR)|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0)|
    (create?fs.constants.O_CREAT|fs.constants.O_EXCL:0);
  let handle;
  try{handle=await fs.promises.open(file,flags,0o600);}catch(error){
    if(allowMissing&&error.code==='ENOENT'){await verifyDirectories(parents);return null;}
    if(['ELOOP','EEXIST','EISDIR'].includes(error.code))throw unsafe();
    throw error;
  }
  try{
    const initial=await handle.stat({bigint:true});
    if(!initial.isFile()||initial.ino===0n||initial.nlink!==1n||initial.size<0n||initial.size>BigInt(Number.MAX_SAFE_INTEGER))throw unsafe();
    const verify=async(size,{unchanged=false}={})=>{
      const current=await handle.stat({bigint:true});
      const named=await fs.promises.lstat(file,{bigint:true});
      if(!current.isFile()||!named.isFile()||named.isSymbolicLink()||current.nlink!==1n||!same(initial,current)||!same(current,named))throw unsafe();
      if(size!==undefined&&current.size!==BigInt(size))throw unsafe();
      if(unchanged&&(current.size!==initial.size||current.mtimeNs!==initial.mtimeNs||current.ctimeNs!==initial.ctimeNs))throw unsafe();
      await verifyDirectories(parents);
    };
    await verify(Number(initial.size),{unchanged:true});
    return {handle,size:Number(initial.size),verify,verifyUnchanged:()=>verify(Number(initial.size),{unchanged:true})};
  }catch(error){await handle.close();throw error;}
}
module.exports={openDownloadFile};
