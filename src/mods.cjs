'use strict';
// Mod files that you download on Nexus Mods in your browser. The Ravenshelf
// extension can say which game, mod and file such a download belongs to. That
// label is untrusted: it is checked here before it names a folder or is shown,
// and it is kept only for a file that comes from Nexus Mods' own file servers.
// Nothing in this file contacts Nexus Mods or any other site.
const SITE='nexusmods';
// Every mod download is saved under <download folder>\Mods\<game>.
const MODS_FOLDER='Mods';
// The servers Nexus Mods' files come from. A page on the site can link to a
// file kept anywhere, so only a file fetched from one of these is a Nexus Mods
// file.
const FILE_ROOTS=Object.freeze(['nexus-cdn.com']);
const MAX_ID=2147483647;
const GAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEYS=new Set(['site','game','modId','gameId','fileId','gameName','modName','fileName']);
// Shown in the queue: Nexus Mods serves free accounts one connection per file.
const ONE_CONNECTION_NOTE='Nexus Mods files download over one connection.';
// Nexus Mods' download links stop working after a while; its servers then
// answer with one of these. Shown instead of a bare status number.
const LINK_REFUSED=Object.freeze([401,403,404,410]);
const LINK_EXPIRED_NOTE='Nexus Mods did not accept this download link. Its links expire after a while: start the download again from the mod’s page.';
// A mod file's download may be passed on from one of Nexus Mods' file servers
// to another, and nowhere else.
const LINK_MOVED_NOTE='Nexus Mods sent this download on to another site, so Ravenshelf stopped it. Start the download again from the mod’s page.';
// A cancelled mod download does not keep its link (see the queue).
const LINK_DROPPED_NOTE='Ravenshelf does not keep the link of a cancelled Nexus Mods download. Start the download again from the mod’s page.';
// The site itself. A download can begin at an address there and be handed on
// to a file server.
const SITE_HOST='www.nexusmods.com';
const invalid=()=>{throw new Error('Invalid browser request.');};

const onFileServer=value=>{
  let url;try{url=new URL(value);}catch{return false;}
  const host=url.hostname.toLowerCase();
  return url.protocol==='https:'&&FILE_ROOTS.some(root=>host===root||host.endsWith('.'+root));
};
const onSite=value=>{
  let url;try{url=new URL(value);}catch{return false;}
  return url.protocol==='https:'&&url.hostname.toLowerCase()===SITE_HOST;
};
// Text for display: no control characters, no invisible, blank or
// text-direction characters, no private-use or unassigned characters or
// broken character pairs, and single spaces only. Marks that sit on the letter
// before them (accents, for example) may not come more than three in a row,
// and not first. A value that is not usable text is refused, never repaired.
function label(value,max){
  if(value===undefined)return undefined;
  if(typeof value!=='string'||!value||value.length>max||value!==value.trim()||/\s{2,}/.test(value))invalid();
  if(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\ufffc\ufffd]/u.test(value))invalid();
  if(/^\p{M}|\p{M}{4}/u.test(value))invalid();
  return value;
}
function number(value,{optional=false}={}){
  if(optional&&value===undefined)return undefined;
  if(!Number.isSafeInteger(value)||value<1||value>MAX_ID)invalid();
  return value;
}
// The label the extension attached to a download, checked field by field.
// Absent gives undefined; anything malformed is refused.
function modContext(value){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!KEYS.has(key)))invalid();
  if(value.site!==SITE||typeof value.game!=='string'||!GAME.test(value.game))invalid();
  const mod={site:SITE,game:value.game,modId:number(value.modId)};
  for(const key of ['gameId','fileId']){const id=number(value[key],{optional:true});if(id!==undefined)mod[key]=id;}
  for(const [key,max] of [['gameName',100],['modName',200],['fileName',200]]){const text=label(value[key],max);if(text!==undefined)mod[key]=text;}
  return mod;
}
// True when a download is a Nexus Mods file: it is fetched from one of the
// site's file servers, and the address the browser first asked for is on a
// file server or on the site itself. A download that began anywhere else and
// only ended up on a file server is not labelled: "Download in browser
// instead" would open that first address again. The page that started the
// download does not count either way: any page can link to any file.
function fromNexus(request){
  if(!request||typeof request!=='object')return false;
  return onFileServer(request.finalUrl||request.url)&&(onFileServer(request.url)||onSite(request.url));
}
// Refuses an address a mod file's download is being sent on to, unless it is
// one of Nexus Mods' file servers.
function assertFileServer(address){if(!onFileServer(address))throw new Error(LINK_MOVED_NOTE);}
// The folder a mod download is saved in, inside Mods: the game's name.
const modFolder=mod=>mod.gameName||mod.game;
module.exports={SITE,MODS_FOLDER,FILE_ROOTS,ONE_CONNECTION_NOTE,LINK_REFUSED,LINK_EXPIRED_NOTE,LINK_MOVED_NOTE,LINK_DROPPED_NOTE,modContext,fromNexus,assertFileServer,modFolder};
