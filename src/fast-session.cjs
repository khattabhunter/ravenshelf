'use strict';
const {safeFetch,safeURL,isPublicIP}=require('./net.cjs');
const {fastRoot,isFastFileURL,assertFastRedirect}=require('./ff-policy.cjs');

const REDIRECTS=new Set([301,302,303,307,308]);
function checkedURL(value){
  const url=safeURL(String(value));
  if(!fastRoot(url.href))throw new Error('Only supported FuckingFast addresses may use this connection.');
  url.hash='';return url;
}
function isPageRequest(url,method){
  return url.hostname===fastRoot(url.href)&&!url.search&&
    ((method==='GET'&&/^\/[a-z0-9]+\/?$/i.test(url.pathname))||
     (method==='POST'&&/^\/f\/[a-z0-9]+\/go$/i.test(url.pathname)));
}
function withAbort(promise,signal){
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(signal.reason||new Error('Request cancelled.'));};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
async function cancel(response){try{await response?.body?.cancel();}catch{}}

// Chromium is used only to read the host's ordinary HTML/form response. It
// neither creates a window nor evaluates scripts. Download bytes and file
// probes retain safeFetch's socket-level public-address validation.
function createFastSessionFetch({getSession,nodeFetch=safeFetch}={}){
  if(typeof getSession!=='function')throw new Error('A FuckingFast session provider is required.');
  async function getDownloadHeaders(value,signal){
    const url=checkedURL(value);
    if(!isFastFileURL(url.href))throw new Error('Expected a FuckingFast file address.');
    const ses=getSession(fastRoot(url.href));
    const pending=ses.cookies.get({url:url.href});
    const cookies=signal?await withAbort(pending,signal):await pending;
    const headers={'User-Agent':ses.getUserAgent()};
    if(cookies.length)headers.Cookie=cookies.map(({name,value})=>`${name}=${value}`).join('; ');
    return headers;
  }
  const fetchFast=async(value,options={})=>{
    let url=checkedURL(value),method=String(options.method||'GET').toUpperCase(),body=options.body;
    if(!['GET','HEAD','POST'].includes(method))throw new Error('Unsupported FuckingFast request method.');
    const original=url.href;
    const timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?Math.min(options.timeoutMs,60000):30000;
    // The deadline remains attached to the body after headers arrive.
    const deadline=AbortSignal.timeout(timeoutMs);
    const signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
    let headers=new Headers(options.headers||{});
    for(let redirects=0;redirects<6;redirects++){
      signal.throwIfAborted();
      if(isFastFileURL(url.href)){
        if(method==='POST')throw new Error('File addresses cannot receive form submissions.');
        const shared=await getDownloadHeaders(url.href,signal);
        const finalHeaders=new Headers(shared);for(const [key,value]of headers)finalHeaders.set(key,value);
        return nodeFetch(url.href,{...options,method,body,headers:finalHeaders,signal,timeoutMs:0});
      }
      if(!isPageRequest(url,method))throw new Error('Blocked an unexpected FuckingFast page address.');
      const ses=getSession(fastRoot(url.href));
      // Preflight uses this session's resolver. It is restricted to the two
      // fixed site roots; it is not a replacement for socket DNS validation.
      const resolved=await withAbort(ses.resolveHost(url.hostname,{cacheUsage:'disallowed'}),signal);
      if(!resolved?.endpoints?.length||resolved.endpoints.some(endpoint=>!isPublicIP(endpoint.address)))throw new Error('The host resolved to a private or unsupported network address.');
      // Chromium supplies its normal user agent and session cookies. Never let
      // a stale Node header override either on the landing/form request.
      const pageHeaders=new Headers(headers);pageHeaders.delete('user-agent');pageHeaders.delete('cookie');pageHeaders.delete('authorization');
      let response=await ses.fetch(url.href,{method,body,headers:pageHeaders,signal,redirect:'manual',credentials:'include',cache:'no-store',bypassCustomProtocolHandlers:true});
      try{
        // Electron documents that Response.url may be incorrect. This value is
        // the URL whose request and redirects this adapter actually checked.
        Object.defineProperty(response,'url',{value:url.href,configurable:true});
        const nextFile=response.headers.get('hx-redirect');
        if(nextFile){const target=checkedURL(new URL(nextFile,url).href);assertFastRedirect(original,target.href);if(!isFastFileURL(target.href))throw new Error('The host returned an unexpected file destination.');}
        if(!REDIRECTS.has(response.status))return response;
        const location=response.headers.get('location');
        if(!location)throw new Error('The host returned a redirect without a destination.');
        const next=checkedURL(new URL(location,url).href);assertFastRedirect(original,next.href);
        let nextMethod=method,nextBody=body;
        if(response.status===303||((response.status===301||response.status===302)&&method==='POST')){nextMethod='GET';nextBody=undefined;}
        if(!isFastFileURL(next.href)&&!isPageRequest(next,nextMethod))throw new Error('Blocked an unexpected FuckingFast redirect.');
        if(next.origin!==url.origin&&method==='POST')throw new Error('Blocked a form redirect to another origin.');
        if(options.redirect==='manual')return response;
        await cancel(response);
        if(next.origin!==url.origin){headers.delete('authorization');headers.delete('cookie');}
        if(nextMethod!==method){headers.delete('content-type');headers.delete('content-length');}
        url=next;method=nextMethod;body=nextBody;
      }catch(error){await cancel(response);throw error;}
    }
    throw new Error('Too many FuckingFast redirects.');
  };
  fetchFast.getDownloadHeaders=getDownloadHeaders;
  return fetchFast;
}
module.exports={createFastSessionFetch,isPageRequest};
