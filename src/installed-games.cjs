'use strict';
// Local inventory only: no network calls, executable launches, or registry writes.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const MAX_FILE=2*1024*1024;
const NON_GAME=/^(?:Steamworks Shared|Steamworks Common|Steam Linux Runtime|SteamVR|Wallpaper[ _]Engine|Unreal Engine|Quixel Bridge|Fab UE Plugin|Epic Games Launcher|Epic Online Services|EA app|Ubisoft Connect|GOG GALAXY|Rockstar Games Launcher|REDlauncher|Microsoft Visual C\+\+|DirectX|dControl|Defender Control)(?:\b|$)/i;
const SKIP_DIR=/^(?:engine|content|data|paks|assets|mods|cache|shaders|screenshots|logs|movies|audio|sound|localization|translations|bundles?|_commonredist|_?redist|redistributables|directx|dotnet|support|tools|uninstall|installer|installers|easyanticheat|battleye|crashreportclient|_backups|backup|backups|node_modules|\.git|\.egstore|windows|system32|dcontrol)$|_Data$/i;
const BAD_EXE=/(?:^|[_ -])(?:unins\d*|uninstall|setup|install|update|updater|crashreport|crashpad|unitycrashhandler|dxsetup|dxwebsetup|vcredist|vc_redist|dotnet|cef|webhelper|eac|anticheat|defendercontrol|dcontrol|rapidcrc|quicksfv|ffmpeg|start_protected_game)(?:[_ .-]|$)|^(?:Installer|CrashReport|CrashPad|UnityCrashHandler|EasyAntiCheat|REDlauncher)/i;
const text=value=>String(value||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,1000);
const keyPath=value=>path.resolve(value).replace(/[\\/]+$/,'').toLowerCase();
function validLocalPath(value,{allowRoot=false}={}) {
  if(typeof value!=='string'||!value.trim()||value.includes('\0')||value.length>2048)return null;
  const p=path.resolve(value);
  if(!path.isAbsolute(value)||/^\\\\/.test(value)||/^\/\//.test(value))return null;
  if(!allowRoot&&keyPath(p)===keyPath(path.parse(p).root))return null;
  return p;
}
function inside(root,candidate) {
  const relative=path.relative(path.resolve(root),path.resolve(candidate));
  return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}
function safeDirectory(value) {
  const p=validLocalPath(value);if(!p)return null;
  try{let ancestor=p;while(ancestor!==path.parse(ancestor).root){const s=fs.lstatSync(ancestor);if(!s.isDirectory()||s.isSymbolicLink())return null;ancestor=path.dirname(ancestor);}return p;}catch{return null;}
}
function directoryEntries(dir){try{return fs.readdirSync(dir,{withFileTypes:true});}catch{return [];}}
function readSmall(file,max=MAX_FILE) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Manifest is not a bounded regular file.');
  return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
}
function parseVdf(input) {
  if(typeof input!=='string'||input.length>MAX_FILE)throw new Error('Invalid VDF size.');
  const tokens=input.match(/"(?:\\.|[^"\\])*"|[{}]|\/\/[^\r\n]*/g)||[];
  if(tokens.length>100000)throw new Error('VDF has too many fields.');
  let i=0;
  const decode=token=>token.slice(1,-1).replace(/\\([\\"])/g,'$1');
  const next=()=>{while(tokens[i]?.startsWith('//'))i++;return tokens[i++];};
  function object(depth=0,closing=false){
    if(depth>16)throw new Error('VDF is too deeply nested.');
    const out=Object.create(null);
    while(i<tokens.length){const key=next();if(!key)break;if(key==='}') {if(closing)return out;throw new Error('Unexpected VDF brace.');}
      if(!key.startsWith('"'))throw new Error('Expected VDF key.');
      const value=next();if(value==='{')out[decode(key)]=object(depth+1,true);else if(value?.startsWith('"'))out[decode(key)]=decode(value);else throw new Error('Expected VDF value.');
    }
    if(closing)throw new Error('Unclosed VDF object.');return out;
  }
  return object();
}
function field(object,name){if(!object||typeof object!=='object')return '';const k=Object.keys(object).find(x=>x.toLowerCase()===name.toLowerCase());return k===undefined?'':object[k];}
function libraryRootsFromVdf(input) {
  const folders=field(parseVdf(input),'libraryfolders');if(!folders||typeof folders!=='object')return [];
  return Object.entries(folders).filter(([k])=>/^\d+$/.test(k)).map(([,v])=>typeof v==='string'?v:field(v,'path')).filter(v=>typeof v==='string'&&v);
}
function parseSteamManifest(input,steamapps,manifestPath) {
  const data=field(parseVdf(input),'AppState');
  if(!data||typeof data!=='object')throw new Error('Missing Steam AppState.');
  const appId=text(field(data,'appid')),title=text(field(data,'name')),dir=text(field(data,'installdir'));
  if(!/^\d+$/.test(appId)||!title||NON_GAME.test(title)||!dir||/[\\/]/.test(dir)||dir==='.'||dir==='..'||/[:]/.test(dir))return null;
  const common=path.join(steamapps,'common'),installPath=path.join(common,dir);
  if(!inside(common,installPath))return null;
  const flags=Number(field(data,'StateFlags'));
  if(Number.isFinite(flags)&&flags>0&&!(flags&4))return null;
  const buildId=text(field(data,'buildid'));
  return {id:'steam:'+appId,title,launcher:'Steam',installPath,version:'',versionSource:'',buildId:/^\d+$/.test(buildId)?buildId:'',steamAppId:appId,evidence:[`Steam manifest: ${manifestPath}`],confidence:'manifest'};
}
function parseEpicManifest(input,manifestPath) {
  const m=JSON.parse(input),title=text(m.DisplayName),root=validLocalPath(m.InstallLocation);
  if(!title||!root||m.bIsIncompleteInstall||NON_GAME.test(title)||/^UE_|^Quixel|^FabPlugin/i.test(String(m.AppName||''))||!m.LaunchExecutable)return null;
  const executable=path.resolve(root,String(m.LaunchExecutable));
  if(!inside(root,executable)||!executable.toLowerCase().endsWith('.exe'))return null;
  return {id:'epic:'+text(m.AppName||m.CatalogItemId||title),title,launcher:'Epic Games',installPath:root,version:text(m.AppVersionString),versionSource:m.AppVersionString?'Epic manifest AppVersionString':'',buildId:'',executable,evidence:[`Epic installation manifest: ${manifestPath}`],confidence:'manifest'};
}
function meaningfulVersion(value) {const v=text(value);return v&&!/^(?:0(?:[., ]0)*|unknown|n\/a)$/i.test(v)&&!/[${}]|%(?:version|build|revision)%/i.test(v)?v:'';}
function parseUninstall(entry) {
  const title=text(entry.title),installPath=validLocalPath(entry.installPath);
  if(!title||NON_GAME.test(title)||!installPath)return null;
  const isSteam=/^Steam App (\d+)$/i.exec(text(entry.keyName));
  const publisher=text(entry.publisher);
  const launcher=isSteam?'Steam':/GOG/i.test(publisher)?'GOG':/FitGirl/i.test(publisher)?'FitGirl / registered':/DODI/i.test(publisher)?'DODI / registered':'Windows registration';
  const version=meaningfulVersion(entry.version);
  return {id:isSteam?'steam:'+isSteam[1]:'local:'+crypto.createHash('sha256').update(keyPath(installPath)).digest('hex').slice(0,16),title,launcher,installPath,version,versionSource:version?'Windows uninstall DisplayVersion':'',buildId:'',steamAppId:isSteam?.[1]||'',evidence:[`Windows uninstall registration: ${text(entry.key)}`],confidence:'registration'};
}
function executableScore(file,root,title,size=0) {
  const base=path.basename(file,'.exe');if(BAD_EXE.test(base+'.exe'))return -Infinity;
  const compact=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  const name=compact(base),target=compact(title);
  let score=0;if(name===target)score+=100;else if(name.length>3&&target.includes(name)||target.length>3&&name.includes(target))score+=55;
  if(/shipping/i.test(base))score+=45;
  if(/(?:x64|win64)/i.test(file))score+=12;
  if(/launcher|helper|bootstrap|editor|server/i.test(base))score-=70;
  score+=Math.min(35,Math.log2(Math.max(size,1)));
  score-=path.relative(root,file).split(path.sep).length*2;
  return score;
}
function findExecutables(root,title,context) {
  const found=[],queue=[{dir:root,depth:0}];let entries=0;
  while(queue.length&&entries<2500&&Date.now()<context.deadline){
    const {dir,depth}=queue.shift();const items=directoryEntries(dir);
    for(const item of items){if(++entries>2500)break;const file=path.join(dir,item.name);
      if(item.isSymbolicLink())continue;
      if(item.isDirectory()&&depth<4&&!SKIP_DIR.test(item.name))queue.push({dir:file,depth:depth+1});
      else if(item.isFile()&&/\.exe$/i.test(item.name)&&!BAD_EXE.test(item.name)){
        try{const stat=fs.lstatSync(file);if(stat.isSymbolicLink())continue;const score=executableScore(file,root,title,stat.size);if(score>=0)found.push({path:file,score});}catch{}
      }
    }
  }
  if(entries>=2500)context.warnings.add(`Executable search was bounded in ${root}. Add its specific game folder if a version is missing.`);
  return found.sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.path);
}
async function runPowerShell(request) {
  const script=fs.readFileSync(path.join(__dirname,'installed-scan.ps1'),'utf8');
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='',done=false;
    const partial=()=>out.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    const timer=setTimeout(()=>{child.kill();if(request.action==='versions')finish(null,{items:partial(),timedOut:true});else finish(new Error('Local registration inspection timed out.'));},request.action==='versions'?45000:20000);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);}
    child.stdout.on('data',chunk=>{out+=chunk.toString('utf8');if(out.length>6*1024*1024){child.kill();finish(new Error('Inventory response exceeded its limit.'));}});
    child.stderr.on('data',chunk=>{if(err.length<2000)err+=chunk.toString('utf8');});
    child.on('error',e=>finish(e));child.on('close',code=>{if(done)return;if(request.action==='versions')return finish(null,{items:partial(),timedOut:code!==0});if(code!==0)return finish(new Error('Windows metadata inspection could not finish.'));try{finish(null,JSON.parse(out.trim().replace(/^\uFEFF/,'')));}catch{finish(new Error('Windows metadata response was invalid.'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
  });
}
function mergeGame(games,game) {
  const existing=games.find(g=>keyPath(g.installPath)===keyPath(game.installPath)||(game.steamAppId&&g.steamAppId===game.steamAppId));
  if(!existing){games.push(game);return game;}
  for(const k of ['version','versionSource','buildId','steamAppId','executable'])if(!existing[k]&&game[k])existing[k]=game[k];
  existing.evidence=[...new Set([...existing.evidence,...game.evidence])];return existing;
}
function applyVersionMetadata(game,metadata) {
  game.versionDetails=[];
  for(const file of game.candidates||[]){const data=metadata.find(x=>keyPath(x.path)===keyPath(file));if(!data)continue;
    const detail={path:file,fileVersion:text(data.fileVersion),productVersion:text(data.productVersion),productName:text(data.productName),description:text(data.description)};
    game.versionDetails.push(detail);
  }
  // Never substitute a helper tool's version just because the primary game
  // executable omits one. Other candidate resources are evidence only.
  const chosen=game.versionDetails[0];
  if(chosen){game.executable=chosen.path;game.productVersion=chosen.productVersion;game.fileVersion=chosen.fileVersion;game.evidence.push(`Executable version resource: ${chosen.path}`);
    const engine=/Unreal Engine|UE[45]Game|BootstrapPackagedGame|\+\+UE[45]\+/i.test(chosen.productName+' '+chosen.description+' '+chosen.productVersion+' '+chosen.fileVersion);
    if(!game.version&&!engine){game.version=meaningfulVersion(chosen.productVersion)||meaningfulVersion(chosen.fileVersion);game.versionSource=game.version?(meaningfulVersion(chosen.productVersion)?'Executable ProductVersion':'Executable FileVersion'):'';}
    if(engine)game.versionNote='Executable metadata identifies an engine/bootstrap version; it is not treated as the game version.';
    else if(!game.version&&/[${}]/.test(chosen.productVersion+' '+chosen.fileVersion))game.versionNote='The executable contains an unresolved version placeholder; it is not treated as a reliable game version.';
    else if(game.versionSource.startsWith('Executable'))game.versionNote='Reported by the executable; this may differ from the version shown in the game menu.';
  }
  if(!game.version)game.versionNote=game.versionNote||'No reliable game version was exposed by local metadata.';
  delete game.candidates;
  return game;
}
async function scanInstalledGames({extraFolders=[],onProgress}={}) {
  if(process.platform!=='win32')return {games:[],scannedAt:new Date().toISOString(),locations:[],warnings:['Installed-game scanning is available on Windows.']};
  if(!Array.isArray(extraFolders)||extraFolders.length>20)throw new Error('Choose up to 20 game folders.');
  const warnings=new Set(),locations=new Set(),games=[],context={deadline:Date.now()+45000,warnings};
  const progress=message=>{try{onProgress?.({message,games:games.length});}catch{}};
  progress('Reading local launcher registrations…');
  let discovery={steamRoots:[],uninstall:[],gog:[]};
  try{discovery=await runPowerShell({action:'discover'});}catch(e){warnings.add(e.message);}
  const roots=[...(discovery.steamRoots||[]),path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Steam')];
  for(const extra of extraFolders){const p=validLocalPath(extra);if(!p)throw new Error('Choose a local game or library folder, not a whole drive or network share.');if(fs.existsSync(path.join(p,'steamapps')))roots.push(p);}
  const steamRoots=new Map();
  for(const candidate of roots){const root=safeDirectory(candidate);if(!root)continue;steamRoots.set(keyPath(root),root);
    try{for(const lib of libraryRootsFromVdf(readSmall(path.join(root,'steamapps','libraryfolders.vdf')))){const p=safeDirectory(lib);if(p)steamRoots.set(keyPath(p),p);}}catch{}
  }
  for(const root of steamRoots.values()){
    const steamapps=safeDirectory(path.join(root,'steamapps'));if(!steamapps)continue;locations.add(steamapps);progress('Reading Steam installation manifests…');
    const files=directoryEntries(steamapps).filter(x=>x.isFile()&&/^appmanifest_\d+\.acf$/i.test(x.name)).slice(0,500);
    for(const file of files){try{const manifest=path.join(steamapps,file.name),game=parseSteamManifest(readSmall(manifest),steamapps,manifest);if(game&&safeDirectory(game.installPath))mergeGame(games,game);}catch{warnings.add(`A Steam manifest could not be read: ${file.name}`);}}
  }
  const epicDir=safeDirectory(path.join(process.env.ProgramData||'C:\\ProgramData','Epic','EpicGamesLauncher','Data','Manifests'));
  if(epicDir){locations.add(epicDir);progress('Reading Epic installation manifests…');for(const file of directoryEntries(epicDir).filter(x=>x.isFile()&&/\.item$/i.test(x.name)).slice(0,500)){
    try{const p=path.join(epicDir,file.name),game=parseEpicManifest(readSmall(p),p);if(game&&safeDirectory(game.installPath)&&fs.existsSync(game.executable))mergeGame(games,game);}catch{warnings.add(`An Epic manifest could not be read: ${file.name}`);}
  }}
  for(const g of discovery.gog||[]){const root=safeDirectory(g.installPath);if(!root||NON_GAME.test(g.title))continue;locations.add(root);const version=meaningfulVersion(g.version);mergeGame(games,{id:'gog:'+text(g.id),title:text(g.title),launcher:'GOG',installPath:root,version,versionSource:version?'GOG installation registry version':'',buildId:text(g.buildId),evidence:[`GOG installation registration: ${text(g.key)}`],confidence:'registration'});}
  let stale=0;
  for(const entry of discovery.uninstall||[]){const game=parseUninstall(entry);if(!game)continue;if(!safeDirectory(game.installPath)){stale++;continue;}locations.add(game.installPath);mergeGame(games,game);}
  if(stale)warnings.add(`${stale} stale game registrations pointed to missing folders and were not counted as installed.`);
  progress('Checking executable version information…');
  for(const game of games){if(Date.now()>context.deadline)break;game.candidates=findExecutables(game.installPath,game.title,context);if(game.executable&&inside(game.installPath,game.executable)&&!BAD_EXE.test(path.basename(game.executable)))game.candidates=[game.executable,...game.candidates.filter(x=>x!==game.executable)].slice(0,3);}
  const folderRoots=[path.join((process.env.SystemDrive||'C:')+path.sep,'Games'),...[...steamRoots.values()].map(root=>path.join(root,'steamapps','common')),...extraFolders];
  for(const raw of folderRoots){const root=safeDirectory(raw);if(!root)continue;if(Date.now()>context.deadline)break;locations.add(root);
    const isExtra=extraFolders.some(x=>keyPath(x)===keyPath(root));
    const entries=directoryEntries(root),direct=entries.some(x=>x.isFile()&&/\.exe$/i.test(x.name)&&!BAD_EXE.test(x.name));
    const looksLikeGame=direct||entries.some(x=>x.isDirectory()&&/^(?:Engine|Binaries|bin|bin64|Win64)$/i.test(x.name));
    const folders=isExtra&&looksLikeGame?[root]:entries.filter(x=>x.isDirectory()&&!x.isSymbolicLink()&&!SKIP_DIR.test(x.name)).slice(0,100).map(x=>path.join(root,x.name));
    for(const folder of folders){if(Date.now()>context.deadline)break;if(games.some(g=>keyPath(g.installPath)===keyPath(folder)))continue;const title=path.basename(folder);if(NON_GAME.test(title)||SKIP_DIR.test(title)||!safeDirectory(folder))continue;const candidates=findExecutables(folder,title,context);if(!candidates.length)continue;
      mergeGame(games,{id:'folder:'+crypto.createHash('sha256').update(keyPath(folder)).digest('hex').slice(0,16),title,launcher:'Folder scan',installPath:folder,version:'',versionSource:'',buildId:'',candidates,evidence:[`Executable found in selected/known game folder: ${folder}`],confidence:'folder'});
    }
  }
  if(Date.now()>context.deadline)warnings.add('The folder search reached its time limit. Add a specific game folder to inspect missing titles.');
  const candidatePaths=[...new Set(games.flatMap(g=>g.candidates||[]))].slice(0,500);
  let metadata=[];
  if(candidatePaths.length){try{const result=await runPowerShell({action:'versions',paths:candidatePaths});metadata=result.items||[];if(result.timedOut)warnings.add('Some executable metadata could not be read within the time limit. Available results are retained; unknown versions remain blank.');}catch(e){warnings.add(e.message);}}
  const complete=games.filter(g=>g.candidates?.length||g.confidence==='manifest').map(g=>applyVersionMetadata(g,metadata)).sort((a,b)=>a.title.localeCompare(b.title));
  for(const game of complete)game.detectedAt=new Date().toISOString();
  progress('Local game scan finished.');
  return {games:complete,scannedAt:new Date().toISOString(),locations:[...locations],warnings:[...warnings]};
}
module.exports={scanInstalledGames};
module.exports._test={parseVdf,libraryRootsFromVdf,parseSteamManifest,parseEpicManifest,parseUninstall,meaningfulVersion,validLocalPath,inside,executableScore,mergeGame,applyVersionMetadata,findExecutables};
