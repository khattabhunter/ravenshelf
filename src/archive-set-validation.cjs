'use strict';
const MAX_LINKS=2000,MAX_PART_NUMBER=10000,MAX_MISSING_DISPLAY=100;
function safeName(value){return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\\/<>:"|?*\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)&&value!=='.'&&value!=='..';}
function describe(name){
  let match=/^(.*)\.part(\d+)\.rar$/i.exec(name);
  if(match)return {name:match[1],key:'rar:'+match[1].toLowerCase(),pattern:'part-rar',number:Number(match[2]),first:1};
  match=/^(.+)\.(\d{3,})$/i.exec(name);
  if(match)return {name:match[1],key:'split:'+match[1].toLowerCase(),pattern:'numbered',number:Number(match[2]),first:1};
  match=/^(.+)\.r(\d{2,})$/i.exec(name);
  if(match)return {name:match[1],key:'legacy:'+match[1].toLowerCase(),pattern:'legacy-rar',number:Number(match[2])+1,first:0};
  return null;
}
function analyzeArchiveSet(links){
  const warnings=[],errors=[],groups=[],sets=new Map();
  if(!Array.isArray(links)||links.length>MAX_LINKS)return {warnings,errors:['Choose up to 2,000 resolved files to inspect.'],groups};
  const entries=[];let unresolved=0;
  for(const link of links){
    const name=typeof link==='string'?link:link?.filename||link?.name;
    if(!safeName(name)){unresolved++;continue;}
    const rawSize=typeof link==='object'?(link.size??link.total):undefined;
    entries.push({name,size:Number.isSafeInteger(rawSize)&&rawSize>0?rawSize:null,optional:typeof link==='object'&&(link.optional===true||link.required===false)});
  }
  const legacy=new Set(entries.flatMap(entry=>{const info=describe(entry.name);return info?.pattern==='legacy-rar'?[info.name.toLowerCase()]:[];}));
  for(const entry of entries){
    let info=describe(entry.name);
    if(!info&&/\.rar$/i.test(entry.name)&&legacy.has(entry.name.slice(0,-4).toLowerCase()))info={name:entry.name.slice(0,-4),key:'legacy:'+entry.name.slice(0,-4).toLowerCase(),pattern:'legacy-rar',number:0,first:0};
    if(!info)continue; // A standalone bin/zip is not a volume of another file.
    if(!Number.isSafeInteger(info.number)||info.number<info.first||info.number>MAX_PART_NUMBER){errors.push('An archive part number is outside the supported range.');continue;}
    if(!sets.has(info.key))sets.set(info.key,{name:info.name,pattern:info.pattern,first:info.first,parts:[],missing:[],missingCount:0,duplicates:[],lastPartKnown:false,complete:null,optional:true,warnings:[],errors:[]});
    const group=sets.get(info.key);group.parts.push({number:info.number,name:entry.name,size:entry.size});group.optional=group.optional&&entry.optional;
  }
  for(const group of sets.values()){
    group.parts.sort((a,b)=>a.number-b.number||a.name.localeCompare(b.name));
    const numbers=new Set();for(const part of group.parts){if(numbers.has(part.number)&&!group.duplicates.includes(part.number))group.duplicates.push(part.number);numbers.add(part.number);}
    let expected=group.first;
    for(const number of [...numbers].sort((a,b)=>a-b)){
      if(number>expected){group.missingCount+=number-expected;for(let missing=expected;missing<number&&group.missing.length<MAX_MISSING_DISPLAY;missing++)group.missing.push(missing);}
      expected=number+1;
    }
    const highest=Math.max(...numbers),nonfinal=group.parts.filter(part=>part.number<highest&&part.size!==null);
    if(group.missingCount)group.errors.push(`${group.missingCount} earlier or internal archive part(s) are missing from this selection.`);
    if(group.duplicates.length)group.errors.push('Duplicate archive part numbers were found. Choose one copy of each part.');
    if(new Set(nonfinal.map(part=>part.size)).size>1)group.errors.push('Known sizes differ between nonfinal archive parts. Recheck these links.');
    if(group.parts.some(part=>part.size===null))group.warnings.push('Some part sizes are unavailable, so size comparisons are limited.');
    group.warnings.push('The final part number is unknown. A gap-free selection does not establish that every required part is present.');
    for(const message of group.errors)errors.push(`${group.name}: ${message}`);
    for(const message of group.warnings)warnings.push(`${group.name}: ${message}`);
    delete group.first;groups.push(group);
  }
  if(unresolved)warnings.push(`${unresolved} file name(s) are unresolved or unsupported and were not checked.`);
  if(!groups.length)warnings.push('No recognized multipart filename pattern was found. Archive completeness has not been established.');
  return {warnings,errors,groups};
}
module.exports={analyzeArchiveSet};
