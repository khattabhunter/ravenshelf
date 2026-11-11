'use strict';
// Sets up the Ravenshelf browser extension and its native connector on this PC:
// writes the extension folder the user loads into the browser, copies the
// verified connector into the profile, and registers it for the current user
// only (HKCU). Nothing here needs administrator rights.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {HOST_NAME,CHROMIUM_EXTENSION_KEY,CHROMIUM_EXTENSION_ID,FIREFOX_EXTENSION_ID}=require('./browser-protocol.cjs');

const EXTENSION_FILES=Object.freeze(['background.js','policy.js','popup.html','popup.js','popup.css','blocked.html','blocked.js','youtube.js','youtube.css','nexus.js','icons/icon-16.png','icons/icon-32.png','icons/icon-48.png','icons/icon-128.png']);
const HOST_EXE='ravenshelf-browser-host.exe';
const REGISTRY_KEYS=Object.freeze([
  Object.freeze({browser:'chromium',name:'Google Chrome',key:`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`}),
  Object.freeze({browser:'chromium',name:'Microsoft Edge',key:`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`}),
  Object.freeze({browser:'chromium',name:'Brave',key:`HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`}),
  Object.freeze({browser:'firefox',name:'Firefox',key:`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`})
]);
// Browsers show at most 132 characters of this.
const DESCRIPTION='Sends downloads to Ravenshelf to be checked first, blocks dangerous sites and pop-ups, and works with YouTube and Nexus Mods.';
// The only two websites the extension has a page script on, each in the top
// frame only. On www.youtube.com it adds Ravenshelf's download button to the
// player. On www.nexusmods.com it changes nothing: it reads which game, mod
// and file the page is about, so a download started there is filed by game.
const YOUTUBE_SCRIPT=Object.freeze({matches:['https://www.youtube.com/*'],js:['policy.js','youtube.js'],css:['youtube.css'],run_at:'document_idle',all_frames:false});
const NEXUS_SCRIPT=Object.freeze({matches:['https://www.nexusmods.com/*'],js:['policy.js','nexus.js'],run_at:'document_idle',all_frames:false});
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function extensionManifest(browser,version){
  if(!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(version)))throw new Error('Invalid extension version.');
  const common={
    manifest_version:3,name:'Ravenshelf',description:DESCRIPTION,version,
    icons:{16:'icons/icon-16.png',32:'icons/icon-32.png',48:'icons/icon-48.png',128:'icons/icon-128.png'},
    action:{default_title:'Ravenshelf',default_popup:'popup.html',default_icon:{16:'icons/icon-16.png',32:'icons/icon-32.png'}},
    content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; base-uri 'none'"},
    content_scripts:[{...YOUTUBE_SCRIPT,matches:[...YOUTUBE_SCRIPT.matches],js:[...YOUTUBE_SCRIPT.js],css:[...YOUTUBE_SCRIPT.css]},
      {...NEXUS_SCRIPT,matches:[...NEXUS_SCRIPT.matches],js:[...NEXUS_SCRIPT.js]}]
  };
  if(browser==='chromium')return {...common,key:CHROMIUM_EXTENSION_KEY,minimum_chrome_version:'121',
    permissions:['downloads','nativeMessaging','declarativeNetRequest','declarativeNetRequestFeedback','webNavigation','contextMenus','notifications','storage','alarms','activeTab'],
    background:{service_worker:'background.js'}};
  if(browser==='firefox')return {...common,
    permissions:['downloads','nativeMessaging','declarativeNetRequest','webNavigation','menus','notifications','storage','alarms','activeTab'],
    background:{scripts:['policy.js','background.js']},
    browser_specific_settings:{gecko:{id:FIREFOX_EXTENSION_ID,strict_min_version:'140.0',
      // Download and page addresses go to the Ravenshelf app on this PC, which
      // Mozilla counts as transmitting browsing activity. With a download from
      // Nexus Mods go the names its page showed (game, mod, file), which
      // Mozilla counts as website content.
      data_collection_permissions:{required:['browsingActivity','websiteContent']}}}};
  throw new Error('Choose Chrome, Edge, Brave or Firefox.');
}
// Writes the extension into <root>/<browser>, replacing an older copy only
// after the new one is complete.
async function exportExtension({browser,root,sourceDir=path.join(__dirname,'browser-extension'),version,fsApi=fs}){
  const manifest=extensionManifest(browser,version);
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('Invalid extension folder.');
  const target=path.join(root,browser),staging=path.join(root,`.${browser}-${crypto.randomUUID()}`),retired=path.join(root,`.${browser}-old-${crypto.randomUUID()}`);
  await fsApi.promises.mkdir(path.join(staging,'icons'),{recursive:true});
  try{
    for(const name of EXTENSION_FILES)await fsApi.promises.writeFile(path.join(staging,name),await fsApi.promises.readFile(path.join(sourceDir,name)),{flag:'wx'});
    await fsApi.promises.writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    let hadTarget=false;
    try{await fsApi.promises.rename(target,retired);hadTarget=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await fsApi.promises.rename(staging,target);}
    catch(error){if(hadTarget)await fsApi.promises.rename(retired,target).catch(()=>{});throw error;}
    if(hadTarget)await fsApi.promises.rm(retired,{recursive:true,force:true}).catch(()=>{});
  }catch(error){await fsApi.promises.rm(staging,{recursive:true,force:true}).catch(()=>{});throw error;}
  return {path:target,version,browser};
}
function exportedVersion(root,browser,fsApi=fs){
  try{const manifest=JSON.parse(fsApi.readFileSync(path.join(root,browser,'manifest.json'),'utf8'));return typeof manifest.version==='string'?manifest.version:null;}catch{return null;}
}
function nativeHostManifests(hostPath){
  if(typeof hostPath!=='string'||!path.win32.isAbsolute(hostPath))throw new Error('Invalid connector location.');
  const base={name:HOST_NAME,description:'Ravenshelf browser connector',path:hostPath,type:'stdio'};
  return {chromium:{...base,allowed_origins:[`chrome-extension://${CHROMIUM_EXTENSION_ID}/`]},firefox:{...base,allowed_extensions:[FIREFOX_EXTENSION_ID]}};
}
function runRegistry(args,{execFileImpl=execFile,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
  const reg=path.win32.join(systemRoot,'System32','reg.exe');
  return new Promise((resolve,reject)=>execFileImpl(reg,args,{windowsHide:true,timeout:15000},error=>error?reject(error):resolve()));
}
async function writeFileAtomic(file,bytes,fsApi){
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  await fsApi.promises.writeFile(temporary,bytes,{flag:'wx'});
  try{await fsApi.promises.rename(temporary,file);}catch(error){await fsApi.promises.unlink(temporary).catch(()=>{});throw error;}
}
// Copies the bundled connector after checking it against its build record,
// writes the browser manifests and points the per-user registry keys at them.
async function registerNativeHost({hostDir,bundleDir=__dirname,platform=process.platform,fsApi=fs,execFileImpl=execFile,systemRoot}={}){
  if(platform!=='win32')throw new Error('The browser connector is available on Windows only.');
  if(typeof hostDir!=='string'||!path.win32.isAbsolute(hostDir))throw new Error('Invalid connector location.');
  const bytes=await fsApi.promises.readFile(path.join(bundleDir,HOST_EXE));
  const build=JSON.parse(await fsApi.promises.readFile(path.join(bundleDir,'browser-host-build.json'),'utf8'));
  if(build?.output?.name!==HOST_EXE||build.output.size!==bytes.length||build.output.sha256!==sha256(bytes)||bytes[0]!==0x4d||bytes[1]!==0x5a)throw new Error('The bundled browser connector changed.');
  await fsApi.promises.mkdir(hostDir,{recursive:true});
  const hostPath=path.win32.join(hostDir,HOST_EXE);
  let current=null;try{current=sha256(await fsApi.promises.readFile(hostPath));}catch{}
  if(current!==build.output.sha256)await writeFileAtomic(hostPath,bytes,fsApi);
  const manifests=nativeHostManifests(hostPath),paths={};
  for(const browser of ['chromium','firefox']){
    paths[browser]=path.win32.join(hostDir,`${browser}.json`);
    await writeFileAtomic(paths[browser],JSON.stringify(manifests[browser],null,2)+'\n',fsApi);
  }
  for(const entry of REGISTRY_KEYS)await runRegistry(['add',entry.key,'/ve','/t','REG_SZ','/d',paths[entry.browser],'/f'],{execFileImpl,systemRoot});
  return {hostPath,manifests:paths};
}
async function unregisterNativeHost({hostDir,platform=process.platform,fsApi=fs,execFileImpl=execFile,systemRoot}={}){
  if(platform!=='win32')return {removed:0};
  let removed=0;
  // A missing key is already removed; keep going so every browser is cleaned up.
  for(const entry of REGISTRY_KEYS){try{await runRegistry(['delete',entry.key,'/f'],{execFileImpl,systemRoot});removed++;}catch{}}
  if(typeof hostDir==='string'&&path.win32.isAbsolute(hostDir))for(const name of ['chromium.json','firefox.json','endpoint.json'])await fsApi.promises.unlink(path.win32.join(hostDir,name)).catch(()=>{});
  return {removed};
}
module.exports={EXTENSION_FILES,HOST_EXE,REGISTRY_KEYS,YOUTUBE_SCRIPT,NEXUS_SCRIPT,DESCRIPTION,extensionManifest,exportExtension,exportedVersion,nativeHostManifests,registerNativeHost,unregisterNativeHost};
