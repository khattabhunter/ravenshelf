'use strict';
const cheerio=require('cheerio');
const {safeFetch}=require('./net.cjs');
const MAX_JSON=2*1024*1024;
function plain(value,limit=8000){
  if(typeof value!=='string')return '';
  const $=cheerio.load(value.slice(0,100000));
  $('script,style,iframe,object').remove();$('br').replaceWith('\n');$('li,p,div').each((_,el)=>$(el).append('\n'));
  return $.root().text().replace(/\r/g,'').split('\n').map(x=>x.replace(/[\t ]+/g,' ').trim()).filter(Boolean).join('\n').slice(0,limit);
}
async function readJSON(response){
  if(!response.ok||!response.body){await response.body?.cancel();throw new Error('Metadata unavailable.');}
  const chunks=[];let length=0;const reader=response.body.getReader();
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_JSON)throw new Error('Metadata too large.');chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
function reviewSummary(value){
  const q=value?.response?.query_summary||value?.query_summary;
  const positive=q?.total_positive,total=q?.total_reviews;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(positive)||total<=0||positive<0||positive>total)return null;
  if(q.total_negative!==undefined&&(!Number.isSafeInteger(q.total_negative)||positive+q.total_negative!==total))return null;
  const score=Math.round(100*positive/total);
  return {score,positive,total,stars:Math.round(50*positive/total)/10,description:plain(q.review_score_desc,120),label:'Steam recommendations, shown on a five-star scale'};
}
function createGameMetadata({fetcher=safeFetch,now=Date.now}={}){
  const cache=new Map(),pending=new Map();
  return async function getMetadata(game={}){
    const id=String(game.steamAppId||'');
    if(!/^[1-9]\d{0,9}$/.test(id)||Number(id)>4294967295)return {source:null,sourceUrl:null,requirements:{minimum:'',recommended:''},reviews:null,genres:[],message:'No verified Steam listing is linked to this game.'};
    const found=cache.get(id);if(found&&now()-found.at<6*60*60*1000)return structuredClone(found.value);
    if(pending.has(id))return structuredClone(await pending.get(id));
    const task=(async()=>{
      const storeUrl='https://store.steampowered.com/app/'+id+'/';
      const input={appid:Number(id),filter:0,languages:['all'],day_range:0,cursor:'*',review_type:0,purchase_type:1,num_per_page:1,filter_offtopic_activity:true,display_language:'english'};
      const urls=['https://store.steampowered.com/api/appdetails?'+new URLSearchParams({appids:id,filters:'basic,pc_requirements,genres',l:'english'}),'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/?'+new URLSearchParams({input_json:JSON.stringify(input)})];
      const results=await Promise.allSettled(urls.map(async url=>readJSON(await fetcher(url,{timeoutMs:15000,headers:{Accept:'application/json','Accept-Encoding':'identity'}}))));
      const entry=results[0].status==='fulfilled'?results[0].value?.[id]:null;
      const data=entry?.success===true&&String(entry.data?.steam_appid)===id?entry.data:null;
      const reviews=results[1].status==='fulfilled'?reviewSummary(results[1].value):null;
      const value={source:'Steam',sourceUrl:storeUrl,steamAppId:id,title:data?plain(data.name,250):'',requirements:{minimum:plain(data?.pc_requirements?.minimum),recommended:plain(data?.pc_requirements?.recommended)},reviews,genres:Array.isArray(data?.genres)?data.genres.slice(0,30).map(x=>plain(x?.description,80)).filter(Boolean):[],fetchedAt:new Date(now()).toISOString(),message:!data&&!reviews?'Steam details are temporarily unavailable. No ratings or requirements have been guessed.':''};
      if(data||reviews){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(id,{at:now(),value});}
      return value;
    })();pending.set(id,task);try{return structuredClone(await task);}finally{pending.delete(id);}
  };
}
module.exports={createGameMetadata,reviewSummary,plain};
