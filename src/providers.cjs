'use strict';

// Site adapters parse data only. Remote HTML and JavaScript are never executed.
const cheerio = require('cheerio');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { safeFetch } = require('./net.cjs');
const {publicErrorMessage}=require('./public-errors.cjs');
const {fastRoot,isFastFileURL,assertFastFile}=require('./ff-policy.cjs');
const {isPasteHost,isPixeldrainHost,isMultiupHost,closedHost,closedByLabel,CLOSED_HOSTS}=require('./hosts.cjs');
const pixeldrain=require('./pixeldrain.cjs');
const multiup=require('./multiup.cjs');
const {parseMagnet}=require('./magnet.cjs');
const pbkdf2 = promisify(crypto.pbkdf2);
const BASE = 'https://fitgirl-repacks.site';
const MAX_TEXT = 6 * 1024 * 1024;
const cache = new Map();
const HOSTS = { 'fuckingfast.co': 'FuckingFast', 'fuckingfast.net': 'FuckingFast', 'datanodes.to': 'DataNodes', 'filekeeper.net': 'FileKeeper', 'pixeldrain.com': 'PixelDrain', 'pixeldrain.net': 'PixelDrain', 'multiup.io': 'MultiUpload', 'multiup.org': 'MultiUpload' };
// The host chosen when a MultiUpload file has copies on several hosts Ravenshelf can download from.
const MIRROR_ORDER = ['FuckingFast', 'FileKeeper', 'PixelDrain', 'DataNodes'];
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function validUrl(value, base) {
  const u = new URL(String(value), base);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Only public HTTPS links are supported.');
  if (u.href.length > 8192) throw new Error('Link is too long.');
  return u;
}
function imageUrl(value) {
  if (!value) return '';
  try { return validUrl(value.replace(/^http:/i, 'https:'), BASE).href; } catch { return ''; }
}
function hostName(value) {
  const h = validUrl(value).hostname.toLowerCase();
  for (const [domain, name] of Object.entries(HOSTS)) if (h === domain || h.endsWith('.' + domain)) return name;
  if (isPasteHost(h)) return 'FitGirl paste';
  const closed = closedHost(h);
  if (closed) return closed.name;
  return h;
}
function readableName(value) {
  const u = validUrl(value);
  const candidate = u.hash.slice(1) || u.pathname.split('/').filter(Boolean).at(-1) || 'download';
  try { return decodeURIComponent(candidate).replace(/[\x00-\x1f\x7f]/g, '').slice(0,240); } catch { return candidate.slice(0,240); }
}
async function limitedText(response, cap = MAX_TEXT) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const buffers = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > cap) throw new Error('The response exceeds the page size limit.');
      buffers.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(buffers).toString('utf8');
}
async function requestText(url, options = {}) {
  const response = await safeFetch(validUrl(url).href, options);
  const html = await limitedText(response);
  return { response, html };
}
function textWithLines($, node) {
  const copy = node.clone();
  copy.find('script,style,iframe').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p,li,h2,h3,h4').each((_, el) => { $(el).append('\n'); });
  return copy.text().replace(/[\t ]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}
function field($, content, name) {
  const data = textWithLines($, content);
  return clean(data.match(new RegExp(name + ':\\s*([^\\n]+)', 'i'))?.[1] || '');
}
function parseGame($, article, fallbackUrl) {
  const content = article.find('.entry-content,.entry-summary').first();
  const heading = article.find('.entry-title').first();
  const href = heading.find('a').first().attr('href') || fallbackUrl;
  if (!href) return null;
  let url;
  try { url = validUrl(href, BASE); } catch { return null; }
  if (url.hostname !== 'fitgirl-repacks.site') return null;
  const title = clean(heading.text());
  const repackSize = field($,content,'Repack Size');
  // News and donation posts are not catalog entries.
  if (!title || (!repackSize && !content.find('h3').first().text().match(/#\d/))) return null;
  const sourceImage = imageUrl(content.find('img.alignleft').first().attr('src') || content.find('img').first().attr('src'));
  // Some catalog cover hosts fail DNS on this machine. Use a screenshot from
  // this exact article as a source-backed fallback, never a guessed game image.
  const screenshotImages=[];
  content.find('img[src]').each((_,el)=>{
    const src=imageUrl($(el).attr('src'));
    if(src && /(?:^|\.)riotpixels\.(net|com)$/.test(new URL(src).hostname) && !screenshotImages.includes(src)) screenshotImages.push(src);
  });
  const coverHost=sourceImage?new URL(sourceImage).hostname:'';
  // RiotPixels' thumbnail suffix names the same asset; retain the exact source
  // thumbnail as the next fallback if a full-size variant is unavailable.
  const screenshotCandidates=screenshotImages.flatMap(src=>[src.replace(/\.jpg\.240p\.jpg(?=$|\?)/i,'.jpg'),src]);
  const imageCandidates=[...new Set((/(?:^|\.)imageban\.ru$/.test(coverHost)?[...screenshotCandidates,sourceImage]:[sourceImage,...screenshotCandidates]).filter(Boolean))].slice(0,8);
  const image=imageCandidates[0]||'';
  let steamAppId=null;
  content.find('a[href],source[src]').each((_,el)=>{
    if(steamAppId)return;
    try {
      const u=new URL($(el).attr('href')||$(el).attr('src'));
      const match=u.hostname==='store.steampowered.com'?u.pathname.match(/^\/app\/(\d+)(?:\/|$)/):u.hostname.endsWith('.steamstatic.com')?u.pathname.match(/^\/store_trailers\/(\d+)\//):null;
      if(match)steamAppId=match[1];
    }catch{}
  });
  const descriptionNode = content.find('.su-spoiler').filter((_, el) => /Game Description/i.test($(el).find('.su-spoiler-title').first().text())).first().find('.su-spoiler-content').first();
  const description = descriptionNode.length ? textWithLines($,descriptionNode) : '';
  return {id:url.pathname.replace(/^\/|\/$/g,''),url:url.href,title,image,sourceImage,imageCandidates,steamAppId,description:description.slice(0,20000),repackSize,originalSize:field($,content,'Original Size'),date:article.find('time').first().attr('datetime') || '',genres:field($,content,'Genres/Tags')};
}
function parseListing(html, {page=1,letter=''} = {}) {
  const $ = cheerio.load(html), games = [], seen = new Set();
  $('article').each((_,el) => {
    const game = parseGame($,$(el));
    if (!game || seen.has(game.url)) return;
    if (letter && !game.title.toLocaleLowerCase().startsWith(letter.toLocaleLowerCase())) return;
    seen.add(game.url); games.push(game);
  });
  return {games,page,hasMore:$('.next.page-numbers,a.nextpostslink').length > 0};
}
function parseDetail(html, url) {
  const $ = cheerio.load(html), article = $('article').first();
  const game = parseGame($,article,url);
  if (!game) throw new Error('This page is not a recognizable game listing.');
  const content = article.find('.entry-content').first();
  const groups = new Map(), closed = new Set();
  content.find('a[href]').each((_,el) => {
    const a = $(el); let href, host;
    try { href=validUrl(a.attr('href'),BASE).href; host=hostName(href); } catch { return; }
    const gone = closedHost(new URL(href).hostname);
    if (gone) { closed.add(gone.name); return; }
    if (Object.values(HOSTS).includes(host)) {
      if (!groups.has(host)) groups.set(host,{host,label:host,urls:[]});
      if (!groups.get(host).urls.includes(href)) groups.get(host).urls.push(href);
    }
  });
  // Older entries sometimes provide only encrypted paste links.
  content.find('a[href]').each((_,el) => {
    const a=$(el); let href;
    try { href=validUrl(a.attr('href'),BASE); } catch { return; }
    if (!isPasteHost(href.hostname) || !href.hash) return;
    const label=clean(a.text());
    const gone=closedByLabel(label);
    if (gone) { closed.add(gone.name); return; }
    const host=Object.values(HOSTS).find(name => label.toLowerCase().includes(name.toLowerCase()));
    if (host && !groups.has(host)) groups.set(host,{host,label:host,urls:[href.href]});
  });
  const screenshots=[];
  content.find('img').each((_,el) => {
    const src=imageUrl($(el).attr('src'));
    if (src && /riotpixels\.(net|com)\//i.test(src) && !screenshots.includes(src)) screenshots.push(src);
  });
  const installation=[];
  content.find('h3,h2').filter((_,el)=>/Repack Features|Installation/i.test($(el).text())).each((_,el)=>{
    const following=$(el).nextUntil('h2,h3');
    following.find('li').add(following.filter('li')).each((_,li)=>{
      const line=clean($(li).text());
      if (/install|HDD|RAM|selective|optional|verify|integrity/i.test(line) && !/antivirus|turn off|defender|exclusions?|rootkits?|hypervisor|100%|lossless|md5 perfect/i.test(line)) installation.push(line);
    });
  });
  const sourceNotes=[...new Set(installation)].slice(0,20);
  if(/Only updated files for a new non-HV repack/i.test(content.text()) && /unpack them OVER setup files/i.test(content.text())) sourceNotes.unshift('This mirror includes a separate replacement setup archive for the newer non-HV repack. The source says to unpack that archive over the main setup files, with overwriting. Keep it separate from the numbered multipart sequence.');
  if(/turn off AV|disable.{0,30}(?:antivirus|defender)|installation folders to exclusions/i.test(content.text())) sourceNotes.push('The source page also contains instructions to weaken antivirus protection. Ravenshelf does not apply those instructions.');
  const closedMirrors=CLOSED_HOSTS.map(entry=>entry.name).filter(name=>closed.has(name));
  // The page's magnet links, one per torrent (a page often links the same torrent twice).
  const torrents=[];
  content.find('a[href^="magnet:"]').each((_,el)=>{
    if(torrents.length>=3)return false;
    try{const parsed=parseMagnet(String($(el).attr('href')||''));if(!torrents.some(item=>item.infoHash===parsed.infoHash))torrents.push({infoHash:parsed.infoHash,name:parsed.name,magnet:parsed.magnet});}catch{}
  });
  return {...game,screenshots:screenshots.slice(0,12),groups:[...groups.values()],closedMirrors,torrents,installation:sourceNotes.length?'Source-reported installation notes (not independently verified):\n'+sourceNotes.join('\n'):''};
}
async function listGames({page=1,search='',letter=''}={}) {
  page=Math.max(1,Math.min(2000,Number.parseInt(page,10)||1));
  search=clean(search).slice(0,160); letter=clean(letter).slice(0,1);
  const url=new URL(page===1 ? '/' : `/page/${page}/`,BASE);
  if (search || letter) url.searchParams.set('s',search || letter);
  const {response,html}=await requestText(url.href);
  if(response.status===404) return {games:[],page,hasMore:false};
  if(!response.ok) throw new Error(`Catalog unavailable (HTTP ${response.status}). Try again later.`);
  return parseListing(html,{page,letter});
}
async function getGame(value) {
  const url=validUrl(value);
  if(url.hostname!=='fitgirl-repacks.site' || url.pathname==='/') throw new Error('Select a game page from fitgirl-repacks.site.');
  url.hash='';
  const saved=cache.get(url.href);
  if(saved && Date.now()-saved.time<15*60*1000) return structuredClone(saved.game);
  const {response,html}=await requestText(url.href);
  if(!response.ok) throw new Error(`Game page unavailable (HTTP ${response.status}).`);
  const game=parseDetail(html,url.href);
  if(cache.size>=200) cache.delete(cache.keys().next().value);
  cache.set(url.href,{game,time:Date.now()});
  return structuredClone(game);
}

function decodeBase58(value) {
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if(!value || value.length>100) throw new Error('Invalid paste key.');
  let num=0n;
  for(const c of value) { const ix=alphabet.indexOf(c); if(ix<0) throw new Error('Invalid paste key.'); num=num*58n+BigInt(ix); }
  let hex=num.toString(16); if(hex.length%2) hex='0'+hex;
  return Buffer.concat([Buffer.alloc(value.match(/^1*/)[0].length),num===0n?Buffer.alloc(0):Buffer.from(hex,'hex')]);
}
async function decryptPaste(data,key) {
  if(data.status!==0 || data.v!==2 || !Array.isArray(data.adata)) throw new Error('Paste is unavailable or uses an unsupported format.');
  const spec=data.adata[0];
  if(!Array.isArray(spec)||spec.length!==8||spec[3]!==256||spec[4]!==128||spec[5]!=='aes'||spec[6]!=='gcm'||!['zlib','none'].includes(spec[7])) throw new Error('Unsupported paste encryption settings.');
  if(!Number.isInteger(spec[2])||spec[2]<1||spec[2]>1000000) throw new Error('Invalid paste derivation settings.');
  if(data.adata[3]) throw new Error('Burn-after-reading pastes must be opened manually in your browser.');
  const secret=decodeBase58(key);
  const derived=await pbkdf2(secret,Buffer.from(spec[1],'base64'),spec[2],32,'sha256');
  const cipher=Buffer.from(data.ct,'base64');
  if(cipher.length<16||cipher.length>MAX_TEXT) throw new Error('Invalid paste ciphertext size.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',derived,Buffer.from(spec[0],'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(data.adata))); decipher.setAuthTag(cipher.subarray(-16));
  let decoded;
  try { decoded=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]); }
  catch { throw new Error('Paste could not be decrypted. Its key may be incorrect, or it may require a password.'); }
  if(spec[7]==='zlib') decoded=zlib.inflateRawSync(decoded,{maxOutputLength:MAX_TEXT});
  const result=JSON.parse(decoded.toString('utf8'));
  if(typeof result.paste!=='string') throw new Error('The paste contains no text links.');
  return result.paste;
}
function extractUrls(text) {
  return [...new Set((String(text).match(/https:\/\/[^\s<>"\x00-\x1f]+/gi)||[]).map(x=>x.replace(/[),.;\]]+$/,'')))].slice(0,1000);
}
// Runs `fn` over `items` with at most `limit` at once, keeping their order.
async function mapLimit(items,limit,fn){
  const results=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i]);}}));
  return results;
}
// A MultiUpload file's copy on the first host in MIRROR_ORDER that has one,
// as a link to one file (not a PixelDrain list, not another MultiUp page).
function preferredMirror(mirrors){
  const usable=url=>{try{const host=new URL(url).hostname;return !closedHost(host)&&!(isPixeldrainHost(host)&&!pixeldrain.pixeldrainLink(url))&&!pixeldrain.isPixeldrainList(url)&&!isMultiupHost(host);}catch{return false;}};
  for(const host of MIRROR_ORDER){const found=mirrors.find(url=>{try{return hostName(url)===host&&usable(url);}catch{return false;}});if(found)return found;}
  return null;
}
const readText=(response,cap)=>limitedText(response,cap);
async function expandLinks(text) {
  if(typeof text!=='string' || text.length>1024*1024) throw new Error('Paste up to 1 MB of links.');
  const found=[],warnings=[],seen=new Set(),pastes=new Set(),notices=new Set(),fromPage=new Set(),pageHost=new Map();
  const collect=url=>{ if(!seen.has(url)){seen.add(url);found.push(url);} };
  const notice=message=>{ if(!notices.has(message)){notices.add(message);warnings.push(message);} };
  for(const raw of extractUrls(text)) {
    const url=validUrl(raw);
    if(isPasteHost(url.hostname)) {
      if(pastes.has(url.href)) continue;
      pastes.add(url.href);
      if(pastes.size>20) {warnings.push('Only the first 20 paste pages were expanded.');break;}
      try {
        if(!/^[a-f0-9]{16}$/i.test(url.search.slice(1)) || !url.hash) throw new Error('A paste link needs its complete # decryption key.');
        const key=url.hash.slice(1); url.hash='';
        const {response,html}=await requestText(url.href,{headers:{'X-Requested-With':'JSONHttpRequest'}});
        if(!response.ok) throw new Error(`Paste returned HTTP ${response.status}.`);
        const decrypted=await decryptPaste(JSON.parse(html),key);
        for(const link of extractUrls(decrypted)) { try{collect(validUrl(link).href);}catch{} }
        const notes=decrypted.split(/\r?\n/).filter(line=>line.trim()&&!/https?:\/\//i.test(line)).join('\n').replace(/^#+\s*/gm,'').trim();
        if(notes) warnings.push(`Source notes: ${notes.slice(0,2000)}`);
      } catch(error) { warnings.push(`Could not expand paste: ${publicErrorMessage(error,'paste')}`); }
    } else if(url.hostname==='fitgirl-repacks.site') {
      try {
        const game=await getGame(url.href);
        // With several hosts to choose from, MultiUpload and PixelDrain-list links
        // are looked up only after the user picks that host, so that their copies
        // do not join another host's group (and nothing is requested before then).
        // Each link keeps its host group's name (a paste link under "PixelDrain" is PixelDrain's).
        for(const group of game.groups) for(const link of group.urls) { collect(link); if(!pageHost.has(link)) pageHost.set(link,group.host); if(game.groups.length>1) fromPage.add(link); }
        warnings.push('This game page contains alternative mirrors. Choose one host to avoid downloading duplicate archives.');
      }
      catch(error){warnings.push(publicErrorMessage(error,'getGame'));}
    } else collect(url.href);
    if(found.length>=1000) break;
  }
  // Links that stand for other links: a closed host's (dropped with a note),
  // a PixelDrain list (its files) and a MultiUpload file (one copy of it).
  // Each link's note is added in the links' order, whichever lookup finishes first.
  let lists=0,mirrorPages=0;
  const expanded=await mapLimit(found.slice(0,1000),4,async url=>{
    const host=new URL(url).hostname;
    const gone=closedHost(host);
    if(gone)return {urls:[],note:gone.message};
    if(fromPage.has(url))return {urls:[url]};
    if(isPixeldrainHost(host)&&pixeldrain.isPixeldrainList(url)){
      if(++lists>20)return {urls:[],note:'Only the first 20 PixelDrain lists were expanded.'};
      try{return {urls:await pixeldrain.listFiles(url,{fetcher:safeFetch,readText})};}
      catch(error){return {urls:[],note:Object.values(pixeldrain.MESSAGES).includes(error?.message)?error.message:pixeldrain.MESSAGES.failed};}
    }
    if(isMultiupHost(host)&&multiup.multiupLink(url)){
      if(++mirrorPages>500)return {urls:[],note:'Only the first 500 MultiUpload files were looked up.'};
      try{
        const list=await multiup.mirrorList(url,{fetcher:safeFetch,readText});
        if(list.missing)return {urls:[],note:multiup.MESSAGES.missing};
        if(list.unreadable)return {urls:[url],note:multiup.MESSAGES.failed};
        const chosen=preferredMirror(list.mirrors);
        // Without a copy Ravenshelf can use, the MultiUpload link stays in the list, to open in the browser.
        return chosen?{urls:[chosen]}:{urls:[url],note:multiup.MESSAGES.none};
      }catch{return {urls:[url],note:multiup.MESSAGES.failed};}
    }
    return {urls:[url]};
  });
  const links=[],kept=new Set();
  for(const {urls,note} of expanded){
    if(note)notice(note);
    for(const url of urls){ if(links.length<1000&&!kept.has(url)){kept.add(url);links.push({url,host:(fromPage.has(url)&&pageHost.get(url))||hostName(url),name:readableName(url)});} }
  }
  return {links,warnings};
}

function filenameFromHeaders(response,fallback) {
  const disposition=response.headers.get('content-disposition')||'';
  if(!disposition)return fallback;
  const invalid=()=>{throw new Error('The host sent an invalid download filename.');};
  // Split parameters without treating a quoted semicolon as a separator.
  const fields=[];let field='',quoted=false,escaped=false;
  for(const char of disposition){
    if(escaped){field+=char;escaped=false;continue;}
    if(quoted&&char==='\\'){field+=char;escaped=true;continue;}
    if(char==='"')quoted=!quoted;
    if(char===';'&&!quoted){fields.push(field);field='';}else field+=char;
  }
  fields.push(field);
  if(quoted||escaped||!/^[!#$%&'*+.^_`|~a-z0-9-]+$/i.test(fields[0].trim()))invalid();
  const names=new Map();
  for(const parameter of fields.slice(1)){
    const match=/^\s*([^=\s;]+)\s*=\s*(.*?)\s*$/.exec(parameter);
    if(!match){if(/^\s*filename(?:\*|\s|$)/i.test(parameter))invalid();continue;}
    const key=match[1].toLowerCase();if(key!=='filename'&&key!=='filename*')continue;
    if(names.has(key)||!match[2])invalid();
    const raw=match[2];let name;
    if(key==='filename*'){
      const extended=/^([^']+)'([^']*)'(.*)$/.exec(raw);
      if(!extended||!/^[a-z0-9-]*$/i.test(extended[2])||!/^(?:[!#$&+.^_`|~a-z0-9-]|%[a-f0-9]{2})+$/i.test(extended[3]))invalid();
      try{
        if(/^utf-8$/i.test(extended[1]))name=decodeURIComponent(extended[3]);
        else if(/^iso-8859-1$/i.test(extended[1]))name=extended[3].replace(/%([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
        else invalid();
      }catch{invalid();}
    }else{
      if(raw.startsWith('"')){
        if(!/^"(?:[^"\\\r\n]|\\[\x20-\x7e])*"$/.test(raw))invalid();
        name=raw.slice(1,-1).replace(/\\([\x20-\x7e])/g,'$1');
      }else{if(/["\r\n]/.test(raw))invalid();name=raw;}
      // Ordinary filename= is literal; only filename*= has percent encoding.
    }
    if(!name?.trim()||/[\x00-\x1f\x7f]/.test(name))invalid();
    names.set(key,name.trim());
  }
  return names.get('filename*')||names.get('filename')||fallback;
}
async function probeDirect(url, filename, host, referer,fetcher=safeFetch) {
  const headers={'Accept-Encoding':'identity',...(referer?{Referer:referer}:{})};
  let response=await fetcher(validUrl(url).href,{method:'HEAD',headers});
  await response.body?.cancel();
  const pageType=value=>/text\/(?:html|xml|javascript)|application\/(json|xml|xhtml|javascript)/i.test(value||'');
  const reportedLength=value=>{const raw=value.headers.get('content-length');if(raw===null||!/^\d+$/.test(raw))return 0;const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n:0;};
  // HEAD may legitimately omit size even when GET provides Content-Range.
  // Do not mistake the one-byte probe's Content-Length for the whole archive,
  // or issue a second request for a challenge/error/HTML HEAD response.
  const missingHeadSize=response.status===200&&!reportedLength(response)&&!pageType(response.headers.get('content-type'));
  if([405,501].includes(response.status)||missingHeadSize){
    // Availability only: ask for one byte and cancel as soon as headers arrive,
    // including when a server ignores Range and offers the full file instead.
    response=await fetcher(validUrl(url).href,{method:'GET',headers:{...headers,Range:'bytes=0-0'},timeoutMs:10000});
    await response.body?.cancel();
  }
  if(response.status===404||response.status===410) return {url,filename,size:0,host,status:'unavailable',message:'File not found or deleted.'};
  if(!response.ok) return {url,filename,size:0,host,status:'manual',message:`The host returned HTTP ${response.status}; open it in your browser.`};
  const type=response.headers.get('content-type')||'';
  if(pageType(type)) return {url,filename,size:0,host,status:'manual',message:'This is a web page, not a verified file download.'};
  if(![200,206].includes(response.status))return {url,filename,size:0,host,status:'manual',message:'The host did not return a verified file response.'};
  if(response.headers.get('content-encoding')&&!/^identity$/i.test(response.headers.get('content-encoding')))return {url,filename,size:0,host,status:'manual',message:'Host ignored the uncompressed transfer request. Use another mirror to preserve reliable byte ranges.'};
  const lengthHeader=response.headers.get('content-length');
  if(lengthHeader!==null&&(!/^\d+$/.test(lengthHeader)||!Number.isSafeInteger(Number(lengthHeader))))return {url,filename,size:0,host,status:'manual',message:'Host returned an invalid file length.'};
  if(lengthHeader!==null&&Number(lengthHeader)===0)return {url,filename,size:0,host,status:'manual',message:'The host returned an empty file.'};
  let size=reportedLength(response);
  if(response.status===206){
    const range=/^bytes 0-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range')||'');
    const end=range?Number(range[1]):-1,unknown=range?.[2]==='*',total=unknown?0:range?Number(range[2]):0;
    if(!Number.isSafeInteger(end)||end<0||(unknown?end!==0:!Number.isSafeInteger(total)||total<1||end>=total||![0,total-1].includes(end)))return {url,filename,size:0,host,status:'manual',message:'The host returned invalid file range information.'};
    const fastFullEndQuirk=Boolean(fastRoot(referer||url))&&!unknown&&end===total-1&&Number(lengthHeader)===1;
    if(lengthHeader!==null&&Number(lengthHeader)!==end+1&&!fastFullEndQuirk)return {url,filename,size:0,host,status:'manual',message:'Host returned inconsistent range and file lengths.'};
    // A few hosts report the full end offset for this bounded probe. The
    // download engine separately validates every range before writing bytes.
    size=total;
  }
  if(!Number.isSafeInteger(size)||size<0)size=0;
  const direct=response.url||url,actualFilename=filenameFromHeaders(response,filename);
  if(fastRoot(referer||url))assertFastFile(referer||url,direct,actualFilename);
  return {url:direct,filename:actualFilename,size,host,status:'ready',message:size?'File link responds; contents have not been scanned.':'Link responds, but this host does not report its size. The download can start; total size may remain unknown.',referer};
}
function manual(url,message,host=hostName(url)) { return {url,filename:readableName(url),size:0,host,status:'manual',message}; }
function parseFastLink(html,url) {
  const $=cheerio.load(html), candidates=[];
  $('a[href]').each((_,el)=>{ const v=$(el).attr('href'); if(v) candidates.push(v); });
  const re=/window\.open\(\s*["'](https:\/\/[^"']+)["']/g;
  for(const match of html.matchAll(re)) candidates.push(match[1]);
  for(const c of candidates) {
    try { const u=validUrl(c,url); if(isFastFileURL(u.href)) return u.href; } catch{}
  }
  return null;
}
async function resolveFast(url,fetcher=safeFetch) {
  const response=await fetcher(validUrl(url).href),html=await limitedText(response);
  if(response.status===404||/File Not Found Or Deleted/i.test(html)) return {...manual(url,'File not found or deleted.'),status:'unavailable'};
  if(!response.ok)return manual(url,'FuckingFast requires a browser verification. Open the host, complete its check, and import the resulting direct download link.');
  const direct=parseFastLink(html,url);
  if(direct) return probeDirect(direct,readableName(url),'FuckingFast',url,fetcher);
  const $=cheerio.load(html),source=new URL(url),fileId=/^\/(?:f\/)?([a-z0-9]+)\/?$/i.exec(source.pathname)?.[1];
  let target;
  if(fileId)$('[hx-post]').each((_,element)=>{
    if(target)return;
    try{
      const candidate=validUrl($(element).attr('hx-post'),url);
      if(candidate.origin===source.origin&&candidate.pathname===`/f/${fileId}/go`)target=candidate;
    }catch{}
  });
  if(target){
    const result=await fetcher(target.href,{method:'POST',redirect:'manual',headers:{'HX-Request':'true','HX-Current-URL':url,Referer:url}});
    const redirect=result.headers.get('HX-Redirect');await result.body?.cancel();
    if(!result.ok)return manual(url,`FuckingFast returned HTTP ${result.status}. Open the protected host to complete its verification.`);
    if(redirect){
      const destination=validUrl(redirect,url);
      if(!isFastFileURL(destination.href))throw new Error('Blocked an unexpected FuckingFast download destination.');
      return probeDirect(destination.href,readableName(url),'FuckingFast',url,fetcher);
    }
  }
  // Passive Cloudflare scripts also appear on usable pages. Classify an actual
  // interstitial only after checking for this file's normal download controls.
  if(/Just a moment|Attention Required.*Cloudflare/i.test($('title').text())||$('#challenge-form,#cf-challenge-running,[id^="cf-chl-"]').length||/\b_cf_chl_opt\b/.test(html))return manual(url,'FuckingFast requires a browser verification. Open the host, complete its check, and import the resulting direct download link.');
  return manual(url,'The host did not expose a supported direct file link. Open it in your browser.');
}

async function cookieRequest(start, cookies, init={}) {
  let url=start; const origin=new URL(start).origin;
  for(let i=0;i<6;i++) {
    const response=await safeFetch(url,{...init,redirect:'manual',headers:{...init.headers,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});
    for(const cookie of response.headers.getSetCookie?.()||[]) {
      const pair=cookie.split(';')[0],ix=pair.indexOf('='); if(ix>0) cookies.set(pair.slice(0,ix),pair.slice(ix+1));
    }
    const location=response.headers.get('location');
    if(!location) return {response,url,direct:null};
    await response.body?.cancel();
    const next=validUrl(location,url);
    if(next.origin!==origin) return {response,url,direct:next.href};
    url=next.href; init={};
  }
  throw new Error('The host redirected too many times.');
}
async function resolveFileKeeper(url) {
  const cookies=new Map(), page=await cookieRequest(url,cookies);
  if(page.direct) return probeDirect(page.direct,readableName(url),'FileKeeper',url);
  if(page.response.status===404) {await page.response.body?.cancel();return {...manual(url,'File not found or deleted.'),status:'unavailable'};}
  const html=await limitedText(page.response),$=cheerio.load(html),form=$('[data-code][data-countdown]').first();
  if(!page.response.ok||!form.length) return manual(url,'FileKeeper requires a browser step or has changed its download page.');
  if(form.attr('data-has-password')==='true'||form.attr('data-has-captcha')==='true') return manual(url,'FileKeeper requires a password or CAPTCHA. Complete it in your browser.');
  const countdown=Number(form.attr('data-countdown'));
  if(!Number.isFinite(countdown)||countdown<0||countdown>30) return manual(url,'FileKeeper requires a longer waiting period. Continue in your browser.');
  await delay(countdown*1000);
  const body=new URLSearchParams({op:'download2',id:form.attr('data-code'),rand:form.attr('data-rand')||'',referer:form.attr('data-referer')||'',method_free:form.attr('data-method')||'Free download',down_direct:'1'});
  const result=await cookieRequest(page.url,cookies,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:page.url},body});
  if(result.direct) return probeDirect(result.direct,readableName(url),'FileKeeper',page.url);
  await result.response.body?.cancel();
  return manual(url,'FileKeeper did not return a direct file link. Continue in your browser.');
}
async function resolveLink(value,{fastFetch}={}) {
  const url=validUrl(value).href,host=hostName(url),hostname=new URL(url).hostname;
  // A closed host is never contacted.
  const gone=closedHost(hostname);
  if(gone) return {url,filename:readableName(url),size:0,host:gone.name,status:'unavailable',message:gone.message};
  try {
    if(isPixeldrainHost(hostname)) return {url,filename:readableName(url),size:0,host:'PixelDrain',...await pixeldrain.resolvePixeldrain(url,{fetcher:safeFetch,readText})};
    if(isMultiupHost(hostname)) return manual(url,multiup.MESSAGES.expand,'MultiUpload');
    if(host==='FuckingFast'){
      const fetcher=typeof fastFetch==='function'?fastFetch:safeFetch;
      if(!isFastFileURL(url))return await resolveFast(url,fetcher);
      return await probeDirect(url,readableName(url),host,undefined,fetcher);
    }
    if(new URL(url).hostname==='filekeeper.net') return await resolveFileKeeper(url);
    if(new URL(url).hostname==='datanodes.to') return manual(url,'DataNodes requires its browser download steps. Open the host and import the final direct file URL.');
    if(host==='FitGirl paste') return manual(url,'Import this paste to expand its file links first.');
    return await probeDirect(url,readableName(url),host);
  } catch(error) { return manual(url,publicErrorMessage(error,'checkLinks'),host); }
}

module.exports={listGames,getGame,expandLinks,resolveLink,parseListing,limitedText,filenameFromHeaders};
module.exports._test={parseListing,parseDetail,decryptPaste,decodeBase58,extractUrls,parseFastLink,validUrl,limitedText};
