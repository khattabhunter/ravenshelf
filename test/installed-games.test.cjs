'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const { _test:t }=require('../src/installed-games.cjs');
const base=path.resolve(__dirname,'.inventory-fixtures');fs.mkdirSync(base,{recursive:true});
function fixture(ctx){const root=fs.mkdtempSync(path.join(base,'scan-'));ctx.after(()=>{assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});return root;}
const steam=(dir='Example Game',extra='')=>`"AppState" { "appid" "1234" "name" "Example Game" "StateFlags" "4" "installdir" "${dir}" "buildid" "987654" ${extra} }`;

test('Steam VDF parser handles nested current and older library paths without prototype mutation',()=>{
  const a=t.libraryRootsFromVdf('"libraryfolders" { "0" { "path" "C:\\\\Steam" "apps" { "1234" "42" } } "1" "D:\\\\SteamLibrary" "__proto__" { "bad" "yes" } }');
  assert.deepEqual(a,['C:\\Steam','D:\\SteamLibrary']);assert.equal({}.bad,undefined);
  assert.throws(()=>t.parseVdf('"AppState" { "name" "unfinished"'),/Unclosed/);
});
test('Steam installed build remains separate from the game version',()=>{
  const game=t.parseSteamManifest(steam(),path.resolve('Steam/steamapps'),'manifest.acf');
  assert.equal(game.title,'Example Game');assert.equal(game.steamAppId,'1234');assert.equal(game.buildId,'987654');assert.equal(game.version,'');assert.equal(game.versionSource,'');
});
test('Steam traversal, tool manifests and incomplete installs are not games',()=>{
  assert.equal(t.parseSteamManifest(steam('../outside'),path.resolve('Steam/steamapps'),'manifest'),null);
  assert.equal(t.parseSteamManifest(steam().replace('Example Game','Steamworks Common Redistributables'),path.resolve('Steam/steamapps'),'manifest'),null);
  assert.equal(t.parseSteamManifest(steam().replace('"StateFlags" "4"','"StateFlags" "1024"'),path.resolve('Steam/steamapps'),'manifest'),null);
});
test('Epic uses explicit manifest version and rejects escaping executables and engine tools',()=>{
  const root=path.resolve('Epic/Example');const sample={DisplayName:'Example',InstallLocation:root,AppName:'abc',AppVersionString:'1.2.3',LaunchExecutable:'Game/Binaries/Game.exe',bIsIncompleteInstall:false};
  const game=t.parseEpicManifest(JSON.stringify(sample),'manifest.item');assert.equal(game.version,'1.2.3');assert.equal(game.versionSource,'Epic manifest AppVersionString');
  assert.equal(t.parseEpicManifest(JSON.stringify({...sample,LaunchExecutable:'../../other.exe'}),'manifest'),null);
  assert.equal(t.parseEpicManifest(JSON.stringify({...sample,DisplayName:'Unreal Engine',AppName:'UE_5.8'}),'manifest'),null);
  assert.equal(t.parseEpicManifest(JSON.stringify({...sample,bIsIncompleteInstall:true}),'manifest'),null);
});
test('Local path validation excludes network shares, relative folders and drive roots',()=>{
  assert.equal(t.validLocalPath('relative/game'),null);assert.equal(t.validLocalPath('\\\\server\\game'),null);assert.equal(t.validLocalPath(path.parse(process.cwd()).root),null);
  assert.equal(t.validLocalPath(path.resolve('my games')),path.resolve('my games'));
});
test('Uninstall versions reject placeholder zero values and exclude launchers',()=>{
  const entry={title:'A Game',installPath:path.resolve('Games/A Game'),version:'0.0.0',publisher:'DODI-Repacks',key:'local test'};
  assert.equal(t.parseUninstall(entry).version,'');assert.equal(t.parseUninstall({...entry,version:'1.4.2'}).versionSource,'Windows uninstall DisplayVersion');
  assert.equal(t.parseUninstall({...entry,title:'Epic Games Launcher'}),null);
});
test('Registry and Steam entries merge by case-insensitive path while preserving sources',()=>{
  const games=[];const first={id:'steam:42',title:'Game',installPath:path.resolve('Games/Alpha'),steamAppId:'42',buildId:'123',version:'',evidence:['Steam manifest']};
  t.mergeGame(games,first);t.mergeGame(games,{id:'registry:42',title:'Game',installPath:first.installPath.toUpperCase(),version:'1.2',versionSource:'registry',evidence:['Registry entry']});
  assert.equal(games.length,1);assert.equal(games[0].buildId,'123');assert.equal(games[0].version,'1.2');assert.deepEqual(games[0].evidence,['Steam manifest','Registry entry']);
});
test('Executable metadata never replaces launcher version and labels engine-only versions',()=>{
  const exe=path.resolve('Game/Game.exe');const game={version:'1.9',versionSource:'Epic manifest AppVersionString',evidence:[],candidates:[exe]};
  t.applyVersionMetadata(game,[{path:exe,productVersion:'5.4.3',fileVersion:'5.4.3.0',productName:'Unreal Engine',description:'BootstrapPackagedGame'}]);
  assert.equal(game.version,'1.9');assert.equal(game.productVersion,'5.4.3');assert.match(game.versionNote,/engine/);
  const unknown={version:'',versionSource:'',evidence:[],candidates:[exe]};t.applyVersionMetadata(unknown,[{path:exe,productVersion:'5.4.3',productName:'Unreal Engine'}]);assert.equal(unknown.version,'');
});
test('Executable scoring excludes installers and prefers a matching shipping executable',ctx=>{
  const root=fixture(ctx);fs.mkdirSync(path.join(root,'Example','Binaries','Win64'),{recursive:true});fs.mkdirSync(path.join(root,'Engine'),{recursive:true});
  fs.writeFileSync(path.join(root,'setup.exe'),'do not execute');fs.writeFileSync(path.join(root,'unins000.exe'),'do not execute');fs.writeFileSync(path.join(root,'Example','Binaries','Win64','Example-Win64-Shipping.exe'),'metadata fixture');fs.writeFileSync(path.join(root,'Engine','Helper.exe'),'excluded');
  const result=t.findExecutables(root,'Example',{deadline:Date.now()+2000,warnings:new Set()});assert.equal(result.length,1);assert.match(result[0],/Example-Win64-Shipping\.exe$/);
});
test('Unresolved version placeholders do not become a game version or fall through to helper versions',()=>{
  const exe=path.resolve('Game/Game.exe'),helper=path.resolve('Game/Helper.exe');
  const game={version:'',versionSource:'',evidence:[],candidates:[exe,helper]};
  t.applyVersionMetadata(game,[{path:exe,productVersion:'0,14,0,$WCREV$',fileVersion:'0,14,0,$WCREV$'},{path:helper,productVersion:'1.0.0.1'}]);
  assert.equal(game.version,'');assert.equal(game.executable,exe);assert.match(game.versionNote,/placeholder/);
});
test('Update installers, verification utilities and REDlauncher are excluded',()=>{
  const root=path.resolve('Games/Title');
  for(const name of ['Title update 1.0.1 - 1.0.2.exe','InstallerMessage.exe','RapidCRC.exe','QuickSFV.EXE','ffmpeg.exe'])assert.equal(t.executableScore(path.join(root,name),root,'Title',1000000),-Infinity,name);
  assert.equal(t.parseUninstall({title:'REDlauncher',installPath:root}),null);
  assert.equal(t.parseUninstall({title:'wallpaper_engine',installPath:root}),null);
});

test('Bounded descriptor reads retain Steam, Epic and library manifest parsing',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');
  fs.writeFileSync(manifest,'\uFEFF'+steam());
  assert.equal(t.parseSteamManifest(t.readSmall(manifest),root,manifest).buildId,'987654');
  const epic={DisplayName:'Example',InstallLocation:path.join(root,'Game'),AppName:'example',AppVersionString:'1.2.3',LaunchExecutable:'Game.exe'};
  fs.writeFileSync(manifest,JSON.stringify(epic));
  assert.equal(t.parseEpicManifest(t.readSmall(manifest),manifest).version,'1.2.3');
  fs.writeFileSync(manifest,'"libraryfolders" { "0" "D:\\\\SteamLibrary" }');
  assert.deepEqual(t.libraryRootsFromVdf(t.readSmall(manifest)),['D:\\SteamLibrary']);
});

test('Manifest reader uses one descriptor, handles short reads and accepts the exact byte limit',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest'),content='1234567890123456';
  fs.writeFileSync(manifest,content);let opens=0,closes=0,reads=0;
  const io={...fs,openSync(...args){opens++;return fs.openSync(...args);},closeSync(fd){closes++;return fs.closeSync(fd);},
    readFileSync(){assert.fail('Manifest data must not reopen the filename.');},
    readSync(fd,buffer,offset,length,position){assert.equal(typeof fd,'number');reads++;return fs.readSync(fd,buffer,offset,Math.min(length,3),position);}};
  assert.equal(t.readSmall(manifest,content.length,io),content);
  assert.equal(opens,1);assert.equal(closes,1);assert.ok(reads>2);
});

test('Oversized manifests are rejected without reading bytes and the handle is closed',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');fs.writeFileSync(manifest,'x'.repeat(17));let closes=0;
  const io={...fs,readSync(){assert.fail('Oversized files must not be read.');},closeSync(fd){closes++;return fs.closeSync(fd);}};
  assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(closes,1);
});

test('Nonregular opened descriptors and final-path links are rejected before any data read',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');fs.writeFileSync(manifest,'small');
  for(const mode of ['nonregular','link']){
    let closes=0;
    const io={...fs,readSync(){assert.fail('Untrusted file types must not be read.');},closeSync(fd){closes++;return fs.closeSync(fd);},
      fstatSync(...args){const stat=fs.fstatSync(...args);return mode==='nonregular'?Object.assign(Object.create(stat),{isFile:()=>false}):stat;},
      lstatSync(file,...args){const stat=fs.lstatSync(file,...args);return mode==='link'&&file===manifest?Object.assign(Object.create(stat),{isSymbolicLink:()=>true}):stat;}};
    assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(closes,1);
  }
});

test('Replacing a manifest after open cannot substitute the replacement or return stale data',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest'),replacement=path.join(root,'replacement');
  fs.writeFileSync(manifest,'original');fs.writeFileSync(replacement,'replaced',{flag:'wx'});let closes=0;
  // Swap two prepared files to exercise a real identity replacement without
  // reopening the checked path for writing inside the attack simulation.
  const io={...fs,openSync(file,flags){const fd=fs.openSync(file,flags);fs.renameSync(file,path.join(root,'original'));fs.renameSync(replacement,file);return fd;},
    readSync(){assert.fail('Identity mismatch must be detected before reading.');},closeSync(fd){closes++;return fs.closeSync(fd);}};
  assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(closes,1);
});

test('A manifest growing after validation cannot cause an unbounded read',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');fs.writeFileSync(manifest,'original');let bytesRead=0,closes=0,grew=false;
  const io={...fs,readSync(fd,buffer,offset,length,position){if(!grew){grew=true;fs.appendFileSync(manifest,'x'.repeat(128));}const count=fs.readSync(fd,buffer,offset,length,position);bytesRead+=count;return count;},
    closeSync(fd){closes++;return fs.closeSync(fd);}};
  assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(bytesRead,17);assert.equal(closes,1);
});

test('Same-size mutation during a manifest read is rejected by descriptor metadata',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');fs.writeFileSync(manifest,'original');let stats=0,closes=0;
  const io={...fs,fstatSync(...args){const stat=fs.fstatSync(...args);return ++stats===2?Object.assign(Object.create(stat),{mtimeNs:stat.mtimeNs+1n}):stat;},
    closeSync(fd){closes++;return fs.closeSync(fd);}};
  assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(closes,1);
});

test('Windows junctions and directory symlinks are rejected before the manifest opens',ctx=>{
  const root=fixture(ctx),directory=path.join(root,'real'),alias=path.join(root,'alias');
  fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'manifest'),'small');fs.symlinkSync(directory,alias,process.platform==='win32'?'junction':'dir');
  const io={...fs,openSync(){assert.fail('Reparse ancestors must not be opened.');}};
  assert.throws(()=>t.readSmall(path.join(alias,'manifest'),16,io),/bounded regular file/);
});

test('Changed ancestor identity before or after reading invalidates a manifest',ctx=>{
  const root=fixture(ctx),manifest=path.join(root,'manifest');fs.writeFileSync(manifest,'small');
  for(const phase of ['before','after']){
    let opened=false,ended=false,closes=0;
    const io={...fs,openSync(...args){const fd=fs.openSync(...args);opened=true;return fd;},
      lstatSync(file,...args){const stat=fs.lstatSync(file,...args);return file===root&&(phase==='before'?opened:ended)?Object.assign(Object.create(stat),{ino:stat.ino+1n}):stat;},
      readSync(...args){if(phase==='before')assert.fail('Changed parent must be detected before reading.');const count=fs.readSync(...args);if(!count)ended=true;return count;},
      closeSync(fd){closes++;return fs.closeSync(fd);}};
    assert.throws(()=>t.readSmall(manifest,16,io),/bounded regular file/);assert.equal(closes,1);
  }
});
