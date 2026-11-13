'use strict';
// MultiUp keeps one file's copies on several other hosts and lists them on a
// mirror page. Ravenshelf reads that page as plain HTML, without running its
// scripts, takes only the listed links that are public HTTPS addresses, and
// leaves the choice of host to the caller, which keeps only hosts Ravenshelf
// can download from itself.
const cheerio=require('cheerio');
const {isMultiupHost}=require('./hosts.cjs');

const HASH=/^[a-f0-9]{32}$/i,LANGUAGE=/^[a-z]{2}$/;
const MAX_PAGE=3*1024*1024,MAX_MIRRORS=100;
const MESSAGES=Object.freeze({
  none:'MultiUpload lists some files only on hosts Ravenshelf can’t download from. Open those MultiUpload links in your browser.',
  failed:'MultiUpload’s mirror list could not be read. Open it in your browser.',
  missing:'MultiUpload no longer has some of these files. Choose another mirror.',
  expand:'Ravenshelf can’t download this MultiUpload file itself. Open it in your browser.'
});

// A MultiUp download or mirror page for one file: /download/<id>/<name>,
// /mirror/<id>/<name>, optionally after a language such as /en/.
function multiupLink(value){
  let u;try{u=new URL(String(value));}catch{return null;}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!isMultiupHost(u.hostname))return null;
  const parts=u.pathname.split('/').filter(Boolean);
  if(LANGUAGE.test(parts[0]||''))parts.shift();
  if(!['download','mirror'].includes(parts[0])||!HASH.test(parts[1]||''))return null;
  const id=parts[1].toLowerCase();
  return {id,page:`https://multiup.io/en/mirror/${id}`};
}
// The copies listed on a mirror page. Each is a link MultiUp marks on its
// buttons; copies it reports as invalid, and its own paid "fast" links, are left out.
function parseMirrors(html){
  const $=cheerio.load(String(html||'')),mirrors=[],seen=new Set();let copies=0,invalid=0;
  $('[link]').each((_,element)=>{
    if(mirrors.length>=MAX_MIRRORS)return false;
    const node=$(element),raw=String(node.attr('link')||'').trim();
    if(!raw||raw.length>2048)return;
    let u;try{u=new URL(raw);}catch{return;}
    if(u.protocol!=='https:'||u.username||u.password||u.port||isMultiupHost(u.hostname))return;
    // A copy on another host: counted, then kept unless MultiUp marks it invalid.
    copies++;
    if(String(node.attr('validity')||'').toLowerCase()==='invalid'){invalid++;return;}
    if(seen.has(u.href))return;
    seen.add(u.href);mirrors.push(u.href);
  });
  // MultiUp's own "File Not Found" page, or every copy marked invalid: the file is gone.
  const missing=!mirrors.length&&(/\bFile Not Found\b/i.test($('title').text()+' '+$('body').text().slice(0,20000))||(copies>0&&invalid===copies));
  // No copies listed at all: the page was not the mirror list Ravenshelf knows.
  return {mirrors,missing,unreadable:!copies&&!missing};
}
async function mirrorList(value,{fetcher,readText}){
  const link=multiupLink(value);
  if(!link)throw new Error(MESSAGES.failed);
  const response=await fetcher(link.page);
  if(response.status===404||response.status===410){try{await response.body?.cancel();}catch{}return {mirrors:[],missing:true,unreadable:false};}
  if(!response.ok){try{await response.body?.cancel();}catch{}throw new Error(MESSAGES.failed);}
  return parseMirrors(await readText(response,MAX_PAGE));
}

module.exports={MESSAGES,multiupLink,parseMirrors,mirrorList};
