'use strict';
const {app,BrowserWindow,ipcMain,protocol,session,dialog,shell,clipboard,powerMonitor,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {DownloadManager,safeName,atomicJSON,loadJSON}=require('./downloads.cjs');
const {safeURL}=require('./net.cjs');
const {imageResponse}=require('./image-loader.cjs');
const {createHeaderVault}=require('./header-vault.cjs');
const {fastRoot,isFastFileURL,assertFastFile}=require('./ff-policy.cjs');
const {createFastSessionFetch}=require('./fast-session.cjs');
const providers=require('./providers.cjs');
const catalog=require('./catalog.cjs');
const {scanInstalledGames}=require('./installed-games.cjs');
const {CompletionAction}=require('./completion-action.cjs');
const {CatalogRefresh}=require('./catalog-refresh.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'atlas',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,manager,completion,catalogRefresh,installedCache,scanPromise;
const checked=new Map(),hostWindows=new Set(),mediaWindows=new Set();
// Resolve only when a link is checked, after Electron and the profile are ready.
const fastFetch=createFastSessionFetch({getSession:root=>session.fromPartition('persist:atlas-host-'+root)});
async function resolveAppLink(value){
  const result=await providers.resolveLink(value,{fastFetch});
  if(result.status==='ready'&&fastRoot(value))result.headers={...result.headers,...await fastFetch.getDownloadHeaders(result.url)};
  return result;
}
const isTest=process.env.ATLAS_TEST_DIR;
if(isTest)app.setPath('userData',path.resolve(isTest));
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
function hostRoot(url){
  const host=safeURL(url).hostname;
  return ['fuckingfast.co','fuckingfast.net','datanodes.to','datanodes.in','datanodes.com','filekeeper.net'].find(h=>host===h||host.endsWith('.'+h));
}
function validateLinks(urls){
  if(!Array.isArray(urls)||!urls.length||urls.length>500)throw new Error('Enter between 1 and 500 links.');
  return [...new Set(urls.map(x=>safeURL(typeof x==='string'?x:x.url).href))];
}
function handle(name,fn){ipcMain.handle('atlas:'+name,async(event,value)=>{
  if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!=='atlas://app/index.html')throw new Error('Invalid app request.');
  return fn(value);
});}
function appState(){return {...manager.state(),completionAction:completion?.snapshot()||{mode:'none',phase:'idle'},catalogRefresh:catalogRefresh?.snapshot()||null};}
function publishState(){if(win&&!win.isDestroyed())win.webContents.send('atlas:state',appState());}
function compactGame(value){
  if(!value||typeof value!=='object')return null;
  let url;try{url=safeURL(value.url);}catch{return null;}
  if(url.hostname!=='fitgirl-repacks.site')return null;
  let image='';try{image=value.image?safeURL(value.image).href:'';}catch{}
  return {id:String(value.id||url.pathname).slice(0,1000),url:url.href,title:String(value.title||'Untitled game').slice(0,500),image,
    repackSize:String(value.repackSize||'').slice(0,100),originalSize:String(value.originalSize||'').slice(0,100),date:String(value.date||'').slice(0,100),genres:String(value.genres||'').slice(0,300),steamAppId:/^\d{1,12}$/.test(String(value.steamAppId))?String(value.steamAppId):null};
}
function compactGames(games,limit=1000){
  const seen=new Set();return (Array.isArray(games)?games:[]).slice(0,limit).map(compactGame).filter(g=>{if(!g||seen.has(g.url))return false;seen.add(g.url);return true;});
}
function assertQueueAvailable(){if(completion?.snapshot().phase==='executing')throw new Error('The completion action has started. Wait before adding another download.');}
async function performInstalledScan(){
  if(scanPromise)return scanPromise;
  scanPromise=(async()=>{
    const result=await scanInstalledGames({extraFolders:Array.isArray(manager.settings.gameFolders)?manager.settings.gameFolders:[]});
    installedCache=result;atomicJSON(path.join(app.getPath('userData'),'installed-games.json'),result);return result;
  })();
  try{return await scanPromise;}finally{scanPromise=null;}
}
async function openGameplay(game){
  const resources=catalog.getGameResources({title:String(game?.title||'').slice(0,500)});
  const start=safeURL(resources.youtubeUrl);
  if(start.hostname!=='www.youtube.com')throw new Error('Invalid gameplay link.');
  const ses=session.fromPartition('persist:atlas-gameplay');
  ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
  if(!ses.__atlasNoDownloads){ses.on('will-download',event=>event.preventDefault());ses.__atlasNoDownloads=true;}
  const allowed=value=>{try{const u=safeURL(value);return ['www.youtube.com','youtube.com','m.youtube.com','consent.youtube.com','consent.google.com'].includes(u.hostname);}catch{return false;}};
  const browser=new BrowserWindow({width:1180,height:820,parent:win,title:'Atlas — YouTube gameplay',autoHideMenuBar:true,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  mediaWindows.add(browser);
  browser.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))setImmediate(()=>{if(!browser.isDestroyed())browser.loadURL(url).catch(()=>{});});return {action:'deny'};});
  browser.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
  browser.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
  browser.webContents.on('will-attach-webview',event=>event.preventDefault());
  browser.on('closed',()=>mediaWindows.delete(browser));
  await browser.loadURL(start.href);return {opened:true};
}
async function openHost({url,gameTitle='Imported files'}={}){
  const u=safeURL(url), root=hostRoot(u.href);
  if(!root)throw new Error('Protected windows support FuckingFast, DataNodes and FileKeeper links.');
  const ses=session.fromPartition('persist:atlas-host-'+root);
  const allowed=value=>{try{const v=safeURL(value);return v.hostname===root||v.hostname.endsWith('.'+root)||v.hostname==='challenges.cloudflare.com';}catch{return false;}};
  ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
  ses.webRequest.onBeforeRequest((details,cb)=>{cb({cancel:!allowed(details.url)});});
  const browser=new BrowserWindow({width:1000,height:780,parent:win,title:'Atlas protected host — popups and off-site requests blocked',autoHideMenuBar:true,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  hostWindows.add(browser);
  browser.webContents.setWindowOpenHandler(({url:popup})=>{
    // Same-host download buttons sometimes use window.open; route only those into this window.
    if(allowed(popup)&&new URL(popup).hostname!=='challenges.cloudflare.com'&&(!fastRoot(u.href)||isFastFileURL(popup)))setImmediate(()=>{if(!browser.isDestroyed())browser.loadURL(popup).catch(()=>{});});
    return {action:'deny'};
  });
  browser.webContents.on('will-navigate',(event,dest)=>{if(!allowed(dest))event.preventDefault();});
  browser.webContents.on('will-redirect',(event,dest)=>{if(!allowed(dest))event.preventDefault();});
  browser.webContents.on('will-attach-webview',event=>event.preventDefault());
  const onDownload=async(event,item,contents)=>{
    if(contents!==browser.webContents)return;
    event.preventDefault();
    try{
      const direct=safeURL(item.getURL()).href;
      if(!allowed(direct)||new URL(direct).hostname==='challenges.cloudflare.com')throw new Error('Off-site download blocked.');
      assertFastFile(u.href,direct,item.getFilename());
      const filename=safeName(item.getFilename());
      if(!/\.(?:rar|zip|7z|bin|iso|\d{3})$/i.test(filename))throw new Error('Unexpected download type. Protected host capture accepts archive files; import other direct links explicitly.');
      const cookies=await ses.cookies.get({url:direct});
      const entry={url:direct,sourceUrl:u.href,filename,size:item.getTotalBytes(),host:root,status:'ready',headers:{'User-Agent':browser.webContents.getUserAgent(),Referer:u.href,Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')}};
      assertQueueAvailable();manager.add({links:[entry],gameTitle});browser.close();
    }catch(err){dialog.showErrorBox('Could not queue file',err.message);}
  };
  ses.on('will-download',onDownload);
  browser.on('closed',()=>{hostWindows.delete(browser);ses.removeListener('will-download',onDownload);});
  browser.loadURL(u.href).catch(()=>{});
  return {opened:true};
}
app.whenReady().then(async()=>{
  app.setName('Atlas Library');
  const resources={
    '/index.html':['index.html','text/html; charset=utf-8'],
    '/styles.css':['styles.css','text/css; charset=utf-8'],
    '/app.js':['app.js','text/javascript; charset=utf-8']
  };
  protocol.handle('atlas',request=>{
    try {
    const u=new URL(request.url);
    if(u.hostname!=='app')return new Response('Not found',{status:404});
    if(u.pathname==='/image')return imageResponse(request);
    const entry=resources[u.pathname];
    if(!entry)return new Response('Not found',{status:404});
    return new Response(fs.readFileSync(path.join(__dirname,'renderer',entry[0])),{headers:{'content-type':entry[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"}});
    } catch(err) {console.error('Protocol error',err);return new Response(String(err),{status:500});}
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  // Remove previously cached app assets on an upgrade before the renderer loads.
  // Host and gameplay windows use separate partitions and retain their sessions.
  const rendererCacheFile=path.join(app.getPath('userData'),'renderer-cache.json'),appVersion=app.getVersion();
  if(loadJSON(rendererCacheFile,{})?.version!==appVersion){
    await session.defaultSession.clearCache();
    atomicJSON(rendererCacheFile,{version:appVersion});
  }
  manager=new DownloadManager({stateFile:path.join(app.getPath('userData'),'library.json'),downloadDir:path.join(app.getPath('downloads'),'Atlas'),resolveLink:resolveAppLink,vault:createHeaderVault(safeStorage)});
  installedCache=loadJSON(path.join(app.getPath('userData'),'installed-games.json'),{games:[],scannedAt:null,warnings:[],locations:[]});
  completion=new CompletionAction({getDownloads:()=>manager.downloads,onChange:publishState,onExecute:async(mode,{ids})=>{
    if(isTest)throw new Error('System completion actions are disabled in this isolated test session.');
    if(manager.downloads.some(d=>!['completed','cancelled'].includes(d.status))||ids.some(id=>manager.downloads.find(d=>d.id===id)?.status!=='completed'))throw new Error('The queue changed; the completion action was stopped.');
    manager.save();
    if(mode==='close'){app.quit();return;}
    // Countdown stays inside Atlas. Windows /t greater than 0 implies /f, so use
    // /t 0 without /f and let Windows handle applications with unsaved work.
    const shutdown=path.join(process.env.SystemRoot||'C:\\Windows','System32','shutdown.exe');
    await new Promise((resolve,reject)=>execFile(shutdown,['/s','/t','0'],{windowsHide:true,timeout:15000},error=>error?reject(new Error('Windows could not perform the shutdown request.')):resolve()));
  }});
  manager.on('state',()=>{completion.refresh();publishState();});
  win=new BrowserWindow({width:1440,height:940,minWidth:880,minHeight:640,backgroundColor:'#10121c',title:'Atlas Library',autoHideMenuBar:true,show:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  // This timer lives in the main process so minimizing Atlas cannot throttle it.
  // A short interval is available only to isolated validation profiles.
  const testInterval=Number(process.env.ATLAS_CATALOG_INTERVAL_MS);
  catalogRefresh=new CatalogRefresh({fetchLatest:()=>catalog.listCatalog({section:'newest',page:1,forceRefresh:true}),onChange:publishState,
    intervalMs:isTest&&Number.isFinite(testInterval)&&testInterval>=15000?Math.min(testInterval,300000):300000});
  const checkCatalogIfDue=()=>{catalogRefresh.check().catch(error=>console.error('Catalogue refresh failed',error.message));};
  powerMonitor.on('resume',checkCatalogIfDue);
  win.on('focus',checkCatalogIfDue);
  win.on('restore',checkCatalogIfDue);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  handle('getState',appState);
  handle('listGames',async options=>providers.listGames({page:Math.max(1,Math.min(2000,Number(options?.page)||1)),search:String(options?.search||'').slice(0,200)}));
  handle('getCatalogSections',()=>catalog.getCatalogSections());
  handle('listCatalog',options=>catalog.listCatalog({section:String(options?.section||'newest').slice(0,40),page:Math.max(1,Math.min(2000,Number(options?.page)||1)),search:String(options?.search||'').slice(0,200),forceRefresh:options?.forceRefresh===true}));
  handle('getGameResources',game=>catalog.getGameResources({title:String(game?.title||'').slice(0,500),steamAppId:/^\d{1,12}$/.test(String(game?.steamAppId))?String(game.steamAppId):null}));
  handle('openGameplay',openGameplay);
  handle('getInstalledGames',()=>installedCache?.scannedAt?installedCache:performInstalledScan());
  handle('scanInstalledGames',performInstalledScan);
  handle('addGameFolder',async()=>{
    const result=await dialog.showOpenDialog(win,{title:'Choose an installed game or game library folder',properties:['openDirectory']});
    if(result.canceled)return null;
    const folder=result.filePaths[0],folders=Array.isArray(manager.settings.gameFolders)?manager.settings.gameFolders:[];
    if(folders.length>=20&&!folders.some(p=>p.toLowerCase()===folder.toLowerCase()))throw new Error('You can scan up to 20 custom game folders.');
    if(!folders.some(p=>p.toLowerCase()===folder.toLowerCase()))manager.updateSettings({gameFolders:[...folders,folder]});
    // Finish any in-progress scan before rescanning with the newly chosen path.
    if(scanPromise)await scanPromise;return performInstalledScan();
  });
  handle('openInstalledFolder',async id=>{
    const game=installedCache?.games?.find(g=>g.id===id);if(!game)throw new Error('Scan this game before opening its folder.');
    const stat=await fs.promises.stat(game.installPath);if(!stat.isDirectory())throw new Error('The game folder no longer exists. Scan again.');
    return shell.openPath(game.installPath);
  });
  handle('setCompletionAction',mode=>{completion.arm(mode);return appState();});
  handle('cancelCompletionAction',()=>{completion.cancel('Completion action cancelled. Atlas will stay open.');return appState();});
  handle('getGame',url=>providers.getGame(String(url)));
  handle('expandLinks',text=>{if(typeof text!=='string'||text.length>500000)throw new Error('Paste is too large.');return providers.expandLinks(text);});
  handle('checkLinks',async urls=>{
    const unique=validateLinks(urls),results=new Array(unique.length);let next=0;
    await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{while(next<unique.length){const i=next++;try{
      const result={...await resolveAppLink(unique[i]),sourceUrl:unique[i]};
      const {headers,...publicResult}=result;results[i]=publicResult;
      if(result.status==='ready')checked.set(unique[i],result);
    }catch(err){results[i]={sourceUrl:unique[i],url:unique[i],host:new URL(unique[i]).hostname,status:'unavailable',message:err.message};}}}));
    return results;
  });
  handle('addDownloads',({links,gameTitle})=>{
    assertQueueAvailable();
    if(!Array.isArray(links)||links.length>500)throw new Error('Invalid download batch.');
    const trusted=links.map(link=>checked.get(link.sourceUrl||link.url)).filter(Boolean);
    if(!trusted.length)throw new Error('Check these links before queuing them.');
    return manager.add({links:trusted,gameTitle:String(gameTitle||'Imported files').slice(0,200)});
  });
  handle('downloadAction',({id,action})=>{
    const d=manager.downloads.find(x=>x.id===id);if(!d)throw new Error('Download not found.');
    if(action==='openFolder')return shell.openPath(d.folder);
    if(!['pause','resume','cancel','retry'].includes(action))throw new Error('Unknown action.');
    if(['resume','retry'].includes(action))assertQueueAvailable();
    return manager.action(id,action);
  });
  handle('chooseFolder',async()=>{const r=await dialog.showOpenDialog(win,{title:'Choose download folder',defaultPath:manager.settings.downloadDir,properties:['openDirectory','createDirectory']});if(r.canceled)return null;manager.updateSettings({downloadDir:r.filePaths[0]});return r.filePaths[0];});
  handle('saveSettings',patch=>{
    const changes={};
    if(patch?.concurrency!==undefined)changes.concurrency=Math.max(1,Math.min(4,Number(patch.concurrency)||2));
    if(patch?.connectionsPerFile!==undefined){
      if(!Number.isInteger(patch.connectionsPerFile)||![1,2,4].includes(patch.connectionsPerFile))throw new Error('Choose 1, 2 or 4 connections per file.');
      changes.connectionsPerFile=patch.connectionsPerFile;
    }
    if(Array.isArray(patch?.favorites))changes.favorites=compactGames(patch.favorites);
    if(Array.isArray(patch?.collections)){
      const seen=new Set();changes.collections=patch.collections.slice(0,100).filter(c=>c&&typeof c.id==='string'&&/^[\w-]{1,100}$/.test(c.id)&&!seen.has(c.id)&&seen.add(c.id)).map(c=>({id:c.id,name:String(c.name||'My collection').trim().slice(0,80)||'My collection',games:compactGames(c.games,500)}));
    }
    manager.updateSettings(changes);return appState();
  });
  handle('openExternal',url=>shell.openExternal(safeURL(url).href));
  handle('openDownloadsFolder',()=>{fs.mkdirSync(manager.settings.downloadDir,{recursive:true});return shell.openPath(manager.settings.downloadDir);});
  handle('copyText',text=>{if(typeof text!=='string'||text.length>1000000)throw new Error('Text is too long.');clipboard.writeText(text);return true;});
  handle('exportLinks',async({urls,gameTitle})=>{const clean=validateLinks(urls);const result=await dialog.showSaveDialog(win,{title:'Export download links',defaultPath:path.join(app.getPath('downloads'),safeName(gameTitle,'Atlas links')+'.txt'),filters:[{name:'Link list',extensions:['txt']}]});if(result.canceled)return {cancelled:true};await fs.promises.writeFile(result.filePath,clean.join('\r\n')+'\r\n','utf8');return {saved:true,path:result.filePath};});
  handle('sendToJDownloader',async({urls,gameTitle})=>{
    const clean=validateLinks(urls);
    try{
      const res=await fetch('http://127.0.0.1:9666/flash/add',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({urls:clean.join('\n'),source:'https://fitgirl-repacks.site/',package:String(gameTitle||'Atlas links').slice(0,200)}),signal:AbortSignal.timeout(7000)});
      if(!res.ok)throw new Error('JDownloader rejected the batch.');
      const body=await res.text();if(!/success/i.test(body))throw new Error('JDownloader did not confirm receiving the links.');
      return {sent:clean.length};
    }catch{throw new Error('Open JDownloader 2 and enable Click’n’Load, then try again. You can also copy or export all links.');}
  });
  handle('openHost',openHost);
  win.once('ready-to-show',()=>win.show());
  catalogRefresh.start();
  await win.loadURL('atlas://app/index.html');
}).catch(err=>{dialog.showErrorBox('Atlas could not start',err.stack||err.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
let exiting=false;
app.on('before-quit',event=>{
  if(exiting||!manager)return;
  event.preventDefault();exiting=true;
  completion?.dispose();
  catalogRefresh?.stop();
  for(const browser of hostWindows)browser.destroy();
  for(const browser of mediaWindows)browser.destroy();
  manager.stop().finally(()=>app.quit());
});
