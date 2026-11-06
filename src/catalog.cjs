'use strict';
const cheerio=require('cheerio');
const {safeFetch}=require('./net.cjs');
const providers=require('./providers.cjs');

const BASE='https://fitgirl-repacks.site';
const TOP_URL=BASE+'/popular-repacks/';
const TOP_PAGE_SIZE=12;
const SECTIONS=[
  {id:'newest',label:'Newest',description:'Most recently published FitGirl repacks; this is not the original game release date.'},
  {id:'top',label:'Top games',description:'FitGirl’s most popular repacks of the month, in the source’s order.'},
  {id:'arpg',label:'Action RPG',tag:'action-rpg',aliases:['action rpg','arpg'],description:'Games tagged Action RPG by FitGirl.'},
  {id:'rpg',label:'RPG',tag:'rpg',aliases:['rpg'],description:'Games tagged RPG by FitGirl.'},
  {id:'rts',label:'Real-time strategy',tag:'rts',aliases:['rts','real-time strategy'],description:'Games tagged RTS by FitGirl.'},
  {id:'action',label:'Action',tag:'action',aliases:['action'],description:'Games tagged Action by FitGirl.'},
  {id:'adventure',label:'Adventure',tag:'adventure',aliases:['adventure'],description:'Games tagged Adventure by FitGirl.'},
  {id:'strategy',label:'Strategy',tag:'strategy',aliases:['strategy'],description:'Turn-based, real-time and other games tagged Strategy by FitGirl.'},
  {id:'simulation',label:'Simulation',tag:'simulator',aliases:['simulator','simulation'],description:'Games in FitGirl’s Simulator archive.'},
  {id:'racing',label:'Racing',tag:'racing',aliases:['racing'],description:'Games tagged Racing by FitGirl.'},
  {id:'sports',label:'Sports',tag:'sports',aliases:['sports'],description:'Games tagged Sports by FitGirl.'},
  {id:'horror',label:'Horror',tag:'horror',aliases:['horror'],description:'Games tagged Horror by FitGirl.'}
];
const cache=new Map();
const pending=new Map();
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
function getCatalogSections(){return SECTIONS.map(({id,label,description})=>({id,label,description}));}
function getSection(section){const found=SECTIONS.find(item=>item.id===section);if(!found)throw new Error('Choose one of the available catalog sections.');return found;}
function sourceUrlFor({section='newest',page=1,search=''}={}){
  const info=getSection(section);
  const number=Math.max(1,Math.min(2000,Number.parseInt(page,10)||1));
  if(section==='top')return TOP_URL;
  const u=new URL(info.tag?`/tag/${info.tag}/${number>1?'page/'+number+'/':''}`:number===1?'/':`/page/${number}/`,BASE);
  if(clean(search))u.searchParams.set('s',clean(search).slice(0,160));
  return u.href;
}
function genreTokens(game){return clean(game.genres).toLowerCase().split(/[,;|]/).map(x=>x.trim()).filter(Boolean);}
function matchesGenre(game,section){const info=typeof section==='string'?getSection(section):section;return !info.aliases || info.aliases.some(tag=>genreTokens(game).includes(tag));}
function adultTagged(game){return genreTokens(game).some(tag=>/^(?:adult|erotic|erotica|hentai|sexual content|nudity|pornographic)$/.test(tag));}
function safeSourceLink(value){
  try{const u=new URL(value,BASE);if(u.origin!==BASE||u.username||u.password||!/^\/[a-z0-9][a-z0-9-]*\/$/i.test(u.pathname))return null;u.hash='';u.search='';return u.href;}catch{return null;}
}
function imageLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function parseTop(html){
  const doc=cheerio.load(html),content=doc('.entry-content').first(),entries=[],seen=new Set();
  const heading=clean(content.find('h1,h2,h3,.widgettitle').map((_,el)=>doc(el).text()).get().find(text=>/Popular.*Month/i.test(text))||content.text().match(/Most Popular Repacks of the Month/i)?.[0]||'');
  if(!heading)throw new Error('The source no longer exposes its monthly popular list.');
  content.find('a[href]').each((_,el)=>{
    const a=doc(el),url=safeSourceLink(a.attr('href'));
    if(!url||seen.has(url)||url===TOP_URL||!a.find('img').length)return;
    const title=clean(a.attr('title')||a.find('img').first().attr('alt')||a.text());
    if(!title)return;
    seen.add(url);entries.push({id:new URL(url).pathname.slice(1,-1),url,title,image:imageLink(a.find('img').first().attr('src')),sourceRank:entries.length+1});
  });
  if(!entries.length)throw new Error('The monthly popular list could not be read.');
  return {heading,entries};
}
async function pageText(url){
  const response=await safeFetch(url);
  if(response.status===404){await response.body?.cancel();return null;}
  if(!response.ok){await response.body?.cancel();throw new Error(`Catalog source unavailable (HTTP ${response.status}).`);}
  return providers.limitedText(response);
}
async function cached(key,loader,ttl=5*60*1000,forceRefresh=false){
  // Join an existing fetch even if an older cached result is available. A forced
  // refresh and ordinary navigation must not race to publish different results.
  if(pending.has(key))return structuredClone(await pending.get(key));
  const entry=cache.get(key);if(!forceRefresh&&entry&&Date.now()-entry.time<ttl)return structuredClone(entry.data);
  const task=(async()=>{const data=await loader();if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),data});return data;})();
  pending.set(key,task);try{return structuredClone(await task);}finally{pending.delete(key);}
}
async function mapLimit(items,limit,fn){const output=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;output[i]=await fn(items[i],i);}}));return output;}
function catalogVersion(title){
  const text=clean(title);
  const version=text.match(/(?:^|[\s,–—])v\s*(\d[\w.]*(?:[/-]\d[\w.]*)?)/i);
  if(version)return {value:version[1],label:'Source-listed version'};
  const build=text.match(/\bBuild\s+([A-Za-z0-9._-]+)/i);
  return build?{value:build[1],label:'Source-listed build'}:null;
}
function enrich(game){return {...game,catalogVersion:catalogVersion(game.title)};}
async function listCatalog({section='newest',page=1,search='',genre='',forceRefresh=false}={}){
  section=clean(section)||'newest';if(genre&&section==='newest')section=clean(genre);
  const info=getSection(section);page=Math.max(1,Math.min(2000,Number.parseInt(page,10)||1));search=clean(search).slice(0,160);
  const newestHome=section==='newest'&&page===1&&!search;
  return cached(JSON.stringify({section,page,search}),async()=>{
    if(section==='top'){
      const chart=await cached('top-index',async()=>{const html=await pageText(TOP_URL);if(!html)throw new Error('The monthly popular list is unavailable.');return parseTop(html);},10*60*1000,forceRefresh===true);
      const candidates=search?chart.entries.filter(item=>item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())):chart.entries;
      const pageEntries=candidates.slice((page-1)*TOP_PAGE_SIZE,page*TOP_PAGE_SIZE);
      let unavailable=0,hidden=0;
      const hydrated=await mapLimit(pageEntries,4,async entry=>{
        try{const game=await providers.getGame(entry.url);if(adultTagged(game)){hidden++;return null;}return enrich({...game,sourceRank:entry.sourceRank});}
        catch{unavailable++;return {...entry,image:'',metadataUnavailable:true,description:'The source chart lists this game, but its full details could not be loaded. Open the game to try again.',repackSize:'',originalSize:'',genres:'',catalogVersion:catalogVersion(entry.title)};}
      });
      let notice='Monthly source popularity, not a review score. Explicitly adult-tagged entries are hidden in this showcase; source positions are preserved.';
      if(hidden)notice+=` ${hidden} adult-tagged ${hidden===1?'entry is':'entries are'} hidden on this page.`;
      if(unavailable)notice+=` Full details are temporarily unavailable for ${unavailable} ${unavailable===1?'entry':'entries'}.`;
      return {games:hydrated.filter(Boolean),page,hasMore:page*TOP_PAGE_SIZE<candidates.length,section,label:'Top games this month',description:info.description,sourceUrl:TOP_URL,notice,sourceHeading:chart.heading,sourceTotal:chart.entries.length};
    }
    const url=sourceUrlFor({section,page,search}),html=await pageText(url);
    if(html===null){
      if(newestHome)throw new Error('The newest catalogue page is temporarily unavailable.');
      return {games:[],page,hasMore:false,section,label:info.label,description:info.description,sourceUrl:url};
    }
    const listing=providers.parseListing(html,{page});
    const games=(search?listing.games.filter(game=>matchesGenre(game,info)):listing.games).map(enrich);
    // Do not cache challenge/error HTML as an empty newest catalogue. Empty
    // searches, genre pages and pages beyond the archive remain valid results.
    if(newestHome&&!games.length)throw new Error('The newest catalogue page could not be read. Atlas will try again.');
    const notice=info.tag?`Genre labels come from FitGirl. ${search?'Search results are also checked against the game’s genre metadata; later source pages may have more matches.':'Use Next page to browse the whole source genre archive.'}`:'Newest means the repack publication date, not the original game release date.';
    return {...listing,games,section,label:info.label,description:info.description,sourceUrl:url,notice};
  },5*60*1000,forceRefresh===true);
}
function cleanGameTitle(value){
  return clean(value).replace(/\s*\+\s*(?:all\b|\d|DLCs?\b).*$/i,'').replace(/\s*[,–—]\s*(?:v\s*\d|Build\s+\w).*/i,'').replace(/\s*[–—]\s*(?:(?:Premium|Digital|Ultimate|Deluxe|Complete|Gold|Collector[’']?s|Definitive|Enhanced|Anniversary|Standard)\s+)+(?:Edition|Bundle).*$/i,'').trim().slice(0,180);
}
function getGameResources(game={}){
  const title=cleanGameTitle(game.title||game.name);if(!title)throw new Error('A game title is required.');
  const youtubeUrl='https://www.youtube.com/results?'+new URLSearchParams({search_query:title+' PC gameplay'});
  const guides=[
    {title:'PCGamingWiki — setup & troubleshooting search',url:'https://www.pcgamingwiki.com/w/index.php?'+new URLSearchParams({search:title})},
    {title:'YouTube — walkthrough & guide search',url:'https://www.youtube.com/results?'+new URLSearchParams({search_query:title+' walkthrough guide'})}
  ];
  const appId=/^\d{1,12}$/.test(String(game.steamAppId||''))?String(game.steamAppId):null;
  const steamUrl=appId?'https://store.steampowered.com/app/'+appId+'/':undefined;
  if(appId)guides.unshift({title:'Steam community guides',url:'https://steamcommunity.com/app/'+appId+'/guides/'});
  else guides.push({title:'Steam community — game search',url:'https://steamcommunity.com/search/?'+new URLSearchParams({text:title})});
  return {title,youtubeUrl,youtubeLabel:'Find gameplay videos on YouTube',guides,...(steamUrl?{steamUrl}:{})};
}
module.exports={listCatalog,getCatalogSections,getGameResources,cleanGameTitle};
module.exports._test={sourceUrlFor,matchesGenre,adultTagged,parseTop,catalogVersion,clearCache:()=>{cache.clear();pending.clear();}};
