'use strict';
const {app,BrowserWindow,ipcMain,protocol,session,dialog,shell,clipboard,powerMonitor,safeStorage,Notification,Menu,Tray}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {DownloadManager,safeName,atomicJSON,loadJSON}=require('./downloads.cjs');
const {gameFolder}=require('./library-state.cjs');
const {safeURL}=require('./net.cjs');
const {imageResponse}=require('./image-loader.cjs');
const {createHeaderVault}=require('./header-vault.cjs');
const {createDefenderScanner}=require('./defender-scan.cjs');
const {fastRoot,isFastFileURL,assertFastFile}=require('./ff-policy.cjs');
const {createFastSessionFetch}=require('./fast-session.cjs');
const providers=require('./providers.cjs');
const catalog=require('./catalog.cjs');
const {scanInstalledGames}=require('./installed-games.cjs');
const {CompletionAction}=require('./completion-action.cjs');
const {CatalogRefresh}=require('./catalog-refresh.cjs');
const {publicErrorMessage,publicError,ERROR_RESPONSE_HEADERS}=require('./public-errors.cjs');
const {createFeatureServices,featureSettings}=require('./feature-services.cjs');
const {createBrowserIntegration}=require('./browser-integration.cjs');
const {createMediaIntegration}=require('./media-integration.cjs');
const {createTorrentIntegration}=require('./torrent-integration.cjs');
const {markFromInternet}=require('./motw.cjs');
const {createHardwareService}=require('./hardware.cjs');
const i18n=require('./i18n.cjs');
const {modContext,MODS_FOLDER}=require('./mods.cjs');
const {AppLifecycle,shutdownServices}=require('./app-lifecycle.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'atlas',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,manager,completion,catalogRefresh,installedCache,scanPromise,features,browserIntegration,media,torrents,lifecycle;
let exiting=false,exitReady=false,exitTask=null;
// The app's language outside the window: notifications, file dialogs, window
// titles and the menu. Every part of the app writes English; it is translated
// here, as it is shown. If anything about the language fails, English is used.
function local(){
  try{return i18n.translator(manager?.settings,app.getPreferredSystemLanguages());}
  catch{return {t:text=>text,localText:text=>text,arabic:false};}
}
function localOptions(options,keys){
  const tr=local(),shown={...options};
  for(const key of keys)if(typeof shown[key]==='string')shown[key]=tr.localText(shown[key]);
  if(Array.isArray(shown.filters))shown.filters=shown.filters.map(filter=>({...filter,name:tr.localText(filter.name)}));
  return shown;
}
const LocalNotification=typeof Notification==='function'?new Proxy(Notification,{construct:(target,[options])=>new target(localOptions(options,['title','subtitle','body']))}):Notification;
const localDialog={
  showOpenDialog:(window,options)=>dialog.showOpenDialog(window,localOptions(options,['title','buttonLabel','message'])),
  showSaveDialog:(window,options)=>dialog.showSaveDialog(window,localOptions(options,['title','buttonLabel','message'])),
  showErrorBox:(title,content)=>{const tr=local();dialog.showErrorBox(tr.localText(title),tr.localText(content));}
};
// The menu that Alt shows: Electron's own menu, in the app's language,
// without its Help menu (a link to Electron's website).
function setAppMenu(){
  if(typeof Menu?.setApplicationMenu!=='function')return;
  const {t}=local();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:t('File'),submenu:[{role:'quit',label:t('Exit')}]},
    {label:t('Edit'),submenu:[{role:'undo',label:t('Undo')},{role:'redo',label:t('Redo')},{type:'separator'},{role:'cut',label:t('Cut')},{role:'copy',label:t('Copy')},{role:'paste',label:t('Paste')},{role:'delete',label:t('Delete')},{type:'separator'},{role:'selectAll',label:t('Select All')}]},
    {label:t('View'),submenu:[{role:'reload',label:t('Reload')},{role:'forceReload',label:t('Force Reload')},{role:'toggleDevTools',label:t('Toggle Developer Tools')},{type:'separator'},{role:'resetZoom',label:t('Actual Size')},{role:'zoomIn',label:t('Zoom In')},{role:'zoomOut',label:t('Zoom Out')},{type:'separator'},{role:'togglefullscreen',label:t('Toggle Full Screen')}]},
    {label:t('Window'),submenu:[{role:'minimize',label:t('Minimize')},{role:'close',label:t('Close')}]}
  ]));
}
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
// Keep the profile folder used since Atlas Library so the rename keeps every user's library and queue.
else app.setPath('userData',path.join(app.getPath('appData'),'atlas-repack-library'));
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(!exiting&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
// New installs save to Downloads\Ravenshelf; existing users keep Downloads\Atlas if it is there.
function defaultDownloadDir(){
  const legacy=path.join(app.getPath('downloads'),'Atlas');
  try{if(fs.statSync(legacy).isDirectory())return legacy;}catch{}
  return path.join(app.getPath('downloads'),'Ravenshelf');
}
function hostRoot(url){
  const host=safeURL(url).hostname;
  return ['fuckingfast.co','fuckingfast.net','datanodes.to','datanodes.in','datanodes.com','filekeeper.net'].find(h=>host===h||host.endsWith('.'+h));
}
function validateLinks(urls){
  if(!Array.isArray(urls)||!urls.length||urls.length>500)throw new Error('Enter between 1 and 500 links.');
  return [...new Set(urls.map(x=>safeURL(typeof x==='string'?x:x.url).href))];
}
function handle(name,fn){ipcMain.handle('atlas:'+name,async(event,value)=>{
  if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!=='atlas://app/index.html')throw publicError(new Error('Invalid app request.'));
  if(exiting)throw publicError(new Error('Ravenshelf is closing. Wait for cleanup to finish.'));
  try{return await fn(value);}catch(error){throw publicError(error,name);}
});}
let updateSequence=0;
function appState(){return {...manager.state(),completionAction:completion?.snapshot()||{mode:'none',phase:'idle'},catalogRefresh:catalogRefresh?.snapshot()||null,...features?.snapshot(),browser:browserIntegration?.snapshot()||null,media:media?.snapshot()||null,torrents:torrents?.snapshot()||null,updateSequence:++updateSequence};}
function publishState(){if(win&&!win.isDestroyed())win.webContents.send('atlas:state',appState());}
function publishProgress(downloads){if(win&&!win.isDestroyed())win.webContents.send('atlas:progress',{updateSequence:++updateSequence,downloads});}
function compactGame(value){
  if(!value||typeof value!=='object')return null;
  let url;try{url=safeURL(value.url);}catch{return null;}
  if(url.hostname!=='fitgirl-repacks.site')return null;
  let image='';try{image=value.image?safeURL(value.image).href:'';}catch{}
  return {id:String(value.id||url.pathname).slice(0,1000),url:url.href,title:String(value.title||'Untitled game').replace(/[\0\r\n]+/g,' ').slice(0,500),image,
    repackSize:String(value.repackSize||'').slice(0,100),originalSize:String(value.originalSize||'').slice(0,100),date:String(value.date||'').slice(0,100),genres:String(value.genres||'').slice(0,300),steamAppId:/^\d{1,12}$/.test(String(value.steamAppId))?String(value.steamAppId):null};
}
function compactGames(games,limit=1000){
  const seen=new Set();return (Array.isArray(games)?games:[]).slice(0,limit).map(compactGame).filter(g=>{if(!g||seen.has(g.url))return false;seen.add(g.url);return true;});
}
function assertQueueAvailable(){if(exiting)throw new Error('Ravenshelf is closing. Wait for cleanup to finish.');if(completion?.snapshot().phase==='executing')throw new Error('The completion action has started. Wait before adding another download.');}
async function performInstalledScan(){
  if(scanPromise)return scanPromise;
  scanPromise=(async()=>{
    const result=await scanInstalledGames({extraFolders:Array.isArray(manager.settings.gameFolders)?manager.settings.gameFolders:[]});
    if(exiting)return result;
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
  const browser=new BrowserWindow({width:1180,height:820,parent:win,title:local().t('Ravenshelf — YouTube gameplay'),autoHideMenuBar:true,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
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
  const browser=new BrowserWindow({width:1000,height:780,parent:win,title:local().t('Ravenshelf protected host — popups and off-site requests blocked'),autoHideMenuBar:true,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
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
    }catch(error){localDialog.showErrorBox('Could not queue file',publicErrorMessage(error,'openHost'));}
  };
  ses.on('will-download',onDownload);
  browser.on('closed',()=>{hostWindows.delete(browser);ses.removeListener('will-download',onDownload);});
  browser.loadURL(u.href).catch(()=>{});
  return {opened:true};
}
app.whenReady().then(async()=>{
  app.setName('Ravenshelf');
  const resources={
    '/index.html':['index.html','text/html; charset=utf-8'],
    '/styles.css':['styles.css','text/css; charset=utf-8'],
    '/i18n.js':['i18n.js','text/javascript; charset=utf-8'],
    '/app.js':['app.js','text/javascript; charset=utf-8']
  };
  // The window's language and its texts, written for the current settings
  // each time the window loads (see i18n.cjs).
  const localeScript=()=>Buffer.from(i18n.windowScript(manager?.settings,app.getPreferredSystemLanguages()),'utf8');
  protocol.handle('atlas',async request=>{
    try {
    const u=new URL(request.url);
    if(u.hostname!=='app')return new Response('Not found',{status:404,headers:ERROR_RESPONSE_HEADERS});
    if(u.pathname==='/image')return await imageResponse(request);
    const entry=u.pathname==='/locale.js'?['','text/javascript; charset=utf-8']:resources[u.pathname];
    if(!entry)return new Response('Not found',{status:404,headers:ERROR_RESPONSE_HEADERS});
    return new Response(entry[0]?fs.readFileSync(path.join(__dirname,'renderer',entry[0])):localeScript(),{headers:{'content-type':entry[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"}});
    } catch {console.error('Ravenshelf could not load an app resource.');return new Response('App resource unavailable',{status:500,headers:ERROR_RESPONSE_HEADERS});}
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
  manager=new DownloadManager({stateFile:path.join(app.getPath('userData'),'library.json'),downloadDir:defaultDownloadDir(),resolveLink:resolveAppLink,vault:createHeaderVault(safeStorage),scanFile:createDefenderScanner(),
    // Files taken over from a browser keep its internet-zone mark, so Windows treats them the same way.
    markFile:markFromInternet,onCompleted:download=>browserIntegration?.afterDownload(download)});
  installedCache=loadJSON(path.join(app.getPath('userData'),'installed-games.json'),{games:[],scannedAt:null,warnings:[],locations:[]});
  completion=new CompletionAction({getDownloads:()=>manager.downloads,onChange:publishState,onExecute:async(mode,{ids})=>{
    if(isTest)throw new Error('System completion actions are disabled in this isolated test session.');
    require('./completion-policy.cjs').assertCompletionReady(manager.downloads,ids);
    manager.save();
    if(mode==='close'){app.quit();return;}
    // Countdown stays inside Ravenshelf. Windows /t greater than 0 implies /f, so use
    // /t 0 without /f and let Windows handle applications with unsaved work.
    const shutdown=path.join(process.env.SystemRoot||'C:\\Windows','System32','shutdown.exe');
    await new Promise((resolve,reject)=>execFile(shutdown,['/s','/t','0'],{windowsHide:true,timeout:15000},error=>error?reject(new Error('Windows could not perform the shutdown request.')):resolve()));
  }});
  manager.on('state',()=>{completion.refresh();features?.observe();publishState();});
  manager.on('progress',publishProgress);
  setAppMenu();
  win=new BrowserWindow({width:1440,height:940,minWidth:880,minHeight:640,backgroundColor:'#10121c',title:'Ravenshelf',autoHideMenuBar:true,show:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  app.setAppUserModelId?.('local.atlas.repacklibrary');
  // PC specs are read only when a page asks for them, and stay on this PC.
  const hardware=createHardwareService();
  features=createFeatureServices({app,win,manager,completion,dialog:localDialog,clipboard,Notification:LocalNotification,register:handle,publish:publishState,providers,checked,hardware,isTest:Boolean(isTest)});
  media=createMediaIntegration({app,win,manager,Notification:LocalNotification,register:handle,publish:publishState,assertQueueAvailable,isTest:Boolean(isTest)});
  torrents=createTorrentIntegration({app,win,manager,Notification:LocalNotification,register:handle,publish:publishState,assertQueueAvailable,isTest:Boolean(isTest)});
  browserIntegration=createBrowserIntegration({app,win,manager,shell,safeStorage,Notification:LocalNotification,local,register:handle,publish:publishState,resolveProvider:resolveAppLink,assertQueueAvailable,queueMedia:request=>media.queue(request),receiveMagnet:request=>torrents.receive(request),isTest:Boolean(isTest)});
  lifecycle=new AppLifecycle({app,win,Tray,Menu,dialog,icon:path.join(__dirname,'browser-extension','icons','icon-32.png'),
    getSettings:()=>manager.settings,saveSettings:patch=>manager.updateSettings(patch),translate:text=>local().t(text),
    onError:error=>localDialog.showErrorBox('Ravenshelf',publicErrorMessage(error))});
  // A shutdown query can be cancelled by another application: checkpoint,
  // but keep the tray usable unless Windows commits to ending the session.
  win.on('query-session-end',()=>{try{manager.save();}catch{}});
  win.on('session-end',()=>lifecycle.beginQuit());
  handle('windowAction',action=>{
    if(action==='background')return {action:lifecycle.background()?'background':'visible'};
    if(action==='quit'){setImmediate(()=>lifecycle.quit());return {action:'quit'};}
    throw new Error('Invalid app request.');
  });
  // This timer lives in the main process so minimizing Ravenshelf cannot throttle it.
  // A short interval is available only to isolated validation profiles.
  const testInterval=Number(process.env.ATLAS_CATALOG_INTERVAL_MS);
  catalogRefresh=new CatalogRefresh({fetchLatest:()=>catalog.listCatalog({section:'newest',page:1,forceRefresh:true}),onChange:publishState,
    intervalMs:isTest&&Number.isFinite(testInterval)&&testInterval>=15000?Math.min(testInterval,300000):300000});
  const checkCatalogIfDue=()=>{catalogRefresh.check().catch(()=>console.error('Catalogue refresh failed.'));};
  powerMonitor.on('resume',checkCatalogIfDue);
  win.on('focus',checkCatalogIfDue);
  win.on('restore',checkCatalogIfDue);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  handle('getHardware',options=>hardware.get({refresh:options?.refresh===true}));
  // A new language applies to the whole window at once: the choice is saved
  // and the window loads again in that language. Downloads keep running.
  handle('setLanguage',options=>{
    manager.updateSettings(i18n.languageChoice(options));
    setAppMenu();
    lifecycle?.refreshMenu();
    setImmediate(()=>{if(win&&!win.isDestroyed())win.webContents.reload();});
    return appState();
  });
  handle('getState',appState);
  handle('listGames',async options=>providers.listGames({page:Math.max(1,Math.min(2000,Number(options?.page)||1)),search:String(options?.search||'').slice(0,200)}));
  handle('getCatalogSections',()=>catalog.getCatalogSections());
  handle('listCatalog',options=>catalog.listCatalog({section:String(options?.section||'newest').slice(0,40),page:Math.max(1,Math.min(2000,Number(options?.page)||1)),search:String(options?.search||'').slice(0,200),forceRefresh:options?.forceRefresh===true}));
  handle('getGameResources',game=>catalog.getGameResources({title:String(game?.title||'').slice(0,500),steamAppId:/^\d{1,12}$/.test(String(game?.steamAppId))?String(game.steamAppId):null}));
  handle('openGameplay',openGameplay);
  handle('getInstalledGames',()=>installedCache?.scannedAt?installedCache:performInstalledScan());
  handle('scanInstalledGames',performInstalledScan);
  handle('addGameFolder',async()=>{
    const result=await localDialog.showOpenDialog(win,{title:'Choose an installed game or game library folder',properties:['openDirectory']});
    if(result.canceled)return null;
    const folder=result.filePaths[0],folders=Array.isArray(manager.settings.gameFolders)?manager.settings.gameFolders:[];
    // The scan reads only local folders; a network share is refused here, not saved and dropped later.
    if(!gameFolder(folder))throw new Error('Choose a local game or library folder, not a whole drive or network share.');
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
  handle('cancelCompletionAction',()=>{completion.cancel('Completion action cancelled. Ravenshelf will stay open.');return appState();});
  handle('getGame',url=>providers.getGame(String(url)));
  handle('expandLinks',text=>{if(typeof text!=='string'||text.length>500000)throw new Error('Paste is too large.');return providers.expandLinks(text);});
  handle('checkLinks',async urls=>{
    const unique=validateLinks(urls),results=new Array(unique.length);let next=0;
    await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{while(next<unique.length){const i=next++;try{
      checked.delete(unique[i]);
      const result={...await resolveAppLink(unique[i]),sourceUrl:unique[i]};
      const {headers,...publicResult}=result;results[i]=publicResult;
      if(result.status==='ready')checked.set(unique[i],result);
    }catch(error){results[i]={sourceUrl:unique[i],url:unique[i],host:new URL(unique[i]).hostname,status:'unavailable',message:publicErrorMessage(error,'checkLinks')};}}}));
    return results;
  });
  handle('addDownloads',({links,gameTitle,allowIncomplete})=>{
    assertQueueAvailable();
    if(!Array.isArray(links)||links.length>500)throw new Error('Invalid download batch.');
    const trusted=links.map(link=>checked.get(link.sourceUrl||link.url)).filter(Boolean);
    if(!trusted.length||trusted.length!==links.length)throw new Error('Check these links before queuing them.');
    features.validateBatch(trusted,allowIncomplete);
    return manager.add({links:trusted,gameTitle:String(gameTitle||'Imported files').slice(0,200)});
  });
  handle('downloadAction',({id,action})=>{
    const d=manager.downloads.find(x=>x.id===id);if(!d)throw new Error('Download not found.');
    if(action==='openFolder')return shell.openPath(d.folder);
    if(!['pause','resume','cancel','retry','scan'].includes(action))throw new Error('Unknown action.');
    if(['resume','retry','scan'].includes(action))assertQueueAvailable();
    return manager.action(id,action);
  });
  handle('chooseFolder',async()=>{const r=await localDialog.showOpenDialog(win,{title:'Choose download folder',defaultPath:manager.settings.downloadDir,properties:['openDirectory','createDirectory']});if(r.canceled)return null;manager.updateSettings({downloadDir:r.filePaths[0]});return r.filePaths[0];});
  handle('saveSettings',patch=>{
    const changes=featureSettings(patch);
    if(patch?.defenderScan!==undefined){if(typeof patch.defenderScan!=='boolean')throw new Error('Choose whether to scan finished downloads.');changes.defenderScan=patch.defenderScan;}
    if(patch?.concurrency!==undefined)changes.concurrency=Math.max(1,Math.min(4,Number(patch.concurrency)||2));
    if(patch?.connectionsPerFile!==undefined){
      if(!Number.isInteger(patch.connectionsPerFile)||![1,2,4].includes(patch.connectionsPerFile))throw new Error('Choose 1, 2 or 4 connections per file.');
      changes.connectionsPerFile=patch.connectionsPerFile;
    }
    if(Array.isArray(patch?.favorites))changes.favorites=compactGames(patch.favorites);
    if(Array.isArray(patch?.collections)){
      const seen=new Set();changes.collections=patch.collections.slice(0,100).filter(c=>c&&typeof c.id==='string'&&/^[\w-]{1,100}$/.test(c.id)&&!seen.has(c.id)&&seen.add(c.id)).map(c=>({id:c.id,name:String(c.name||'My collection').replace(/[\0\r\n]+/g,' ').trim().slice(0,80)||'My collection',games:compactGames(c.games,500)}));
    }
    manager.updateSettings(changes);features.configure(changes);return appState();
  });
  handle('openExternal',url=>shell.openExternal(safeURL(url).href));
  // The Mods section. A mod's page opens in your own browser, at an address
  // made only from the checked game and mod number saved with the download;
  // Ravenshelf itself never contacts Nexus Mods.
  handle('openModPage',options=>{
    const d=manager.downloads.find(x=>x.id===options?.id);
    let mod=null;try{mod=modContext(d?.mod);}catch{mod=null;}
    if(!mod)throw new Error('This download has no Nexus Mods page.');
    return shell.openExternal(`https://www.nexusmods.com/${mod.game}/mods/${mod.modId}`);
  });
  handle('openModsFolder',()=>{
    const folder=path.join(manager.settings.downloadDir,MODS_FOLDER);
    let directory=false;try{directory=fs.statSync(folder).isDirectory();}catch{directory=false;}
    if(!directory)throw new Error('No mods have been downloaded yet.');
    return shell.openPath(folder);
  });
  handle('openDownloadsFolder',()=>{fs.mkdirSync(manager.settings.downloadDir,{recursive:true});return shell.openPath(manager.settings.downloadDir);});
  handle('copyText',text=>{if(typeof text!=='string'||text.length>1000000)throw new Error('Text is too long.');clipboard.writeText(text);return true;});
  handle('exportLinks',async({urls,gameTitle})=>{const clean=validateLinks(urls);const result=await localDialog.showSaveDialog(win,{title:'Export download links',defaultPath:path.join(app.getPath('downloads'),safeName(gameTitle,'Ravenshelf links')+'.txt'),filters:[{name:'Link list',extensions:['txt']}]});if(result.canceled)return {cancelled:true};await fs.promises.writeFile(result.filePath,clean.join('\r\n')+'\r\n','utf8');return {saved:true,path:result.filePath};});
  handle('sendToJDownloader',async({urls,gameTitle})=>{
    const clean=validateLinks(urls);
    try{
      const res=await fetch('http://127.0.0.1:9666/flash/add',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({urls:clean.join('\n'),source:'https://fitgirl-repacks.site/',package:String(gameTitle||'Ravenshelf links').slice(0,200)}),signal:AbortSignal.timeout(7000)});
      if(!res.ok)throw new Error('JDownloader rejected the batch.');
      const body=await res.text();if(!/success/i.test(body))throw new Error('JDownloader did not confirm receiving the links.');
      return {sent:clean.length};
    }catch{throw new Error('Open JDownloader 2 and enable Click’n’Load, then try again. You can also copy or export all links.');}
  });
  handle('openHost',openHost);
  win.once('ready-to-show',()=>win.show());
  catalogRefresh.start();
  await win.loadURL('atlas://app/index.html');
}).catch(()=>{console.error('Ravenshelf startup failed.');localDialog.showErrorBox('Ravenshelf could not start','Ravenshelf could not start. Close it and try again. If the problem continues, replace the app with a fresh copy of the latest release.');app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(exitReady||!manager)return;
  event.preventDefault();exiting=true;lifecycle?.beginQuit();
  // Repeated tray/menu/update quit requests must not bypass in-flight writes.
  if(exitTask)return;
  completion?.dispose();
  catalogRefresh?.stop();
  for(const browser of hostWindows)browser.destroy();
  for(const browser of mediaWindows)browser.destroy();
  exitTask=shutdownServices({manager,browserIntegration,media,torrents,features})
    .catch(()=>console.error('Ravenshelf could not finish cleanup. The current app was kept.'))
    .finally(()=>{exitReady=true;lifecycle?.dispose();app.quit();});
});
