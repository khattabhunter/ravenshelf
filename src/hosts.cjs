'use strict';

// FitGirl's encrypted paste pages (PrivateBin). FitGirl's own game posts link
// both addresses; they serve the same format and are opened only with the key
// in the link's # part.
const PASTE_HOSTS=Object.freeze(['paste.fitgirl-repacks.site','pastefg.hermietkreeft.site']);
const isPasteHost=host=>typeof host==='string'&&PASTE_HOSTS.includes(host.toLowerCase());

const lower=host=>typeof host==='string'?host.toLowerCase():'';
const under=(host,roots)=>{const h=lower(host);return Boolean(h)&&roots.some(root=>h===root||h.endsWith('.'+root));};
const hostOf=value=>{try{return new URL(String(value)).hostname.toLowerCase();}catch{return '';}};

// PixelDrain answers on these exact addresses (and www.). Its API is asked on
// the address the link names.
const PIXELDRAIN_HOSTS=Object.freeze(['pixeldrain.com','pixeldrain.net']);
const isPixeldrainHost=host=>{const h=lower(host).replace(/^www\./,'');return PIXELDRAIN_HOSTS.includes(h);};

// MultiUp's mirror lists. multiup.org is its older address.
const MULTIUP_HOSTS=Object.freeze(['multiup.io','multiup.org']);
const isMultiupHost=host=>{const h=lower(host).replace(/^www\./,'');return MULTIUP_HOSTS.includes(h);};

// The app's provider resolvers may deliberately need a clean page path as a
// referrer. Ordinary browser files retain only the page's origin. Keep this
// host distinction shared by the browser bridge and saved download state.
const PROVIDER_ROOTS=Object.freeze(['fuckingfast.co','fuckingfast.net','filekeeper.net','datanodes.to','datanodes.in','datanodes.com',...PIXELDRAIN_HOSTS,...PASTE_HOSTS]);
const EXACT_PROVIDER_ROOTS=new Set([...PIXELDRAIN_HOSTS,...PASTE_HOSTS]);
const isDownloadProvider=value=>{const host=hostOf(value);return PROVIDER_ROOTS.some(root=>host===root||(!EXACT_PROVIDER_ROOTS.has(root)&&host.endsWith('.'+root)))||isPixeldrainHost(host);};

// Hosts that have shut down. Ravenshelf never contacts them: an expired name
// can be bought by someone else (one LetsUpload address now shows gambling spam).
const CLOSED_HOSTS=Object.freeze([
  Object.freeze({name:'ZippyShare',roots:Object.freeze(['zippyshare.com']),message:'ZippyShare closed in March 2023, so its links no longer work. Choose another mirror.'}),
  Object.freeze({name:'BayFiles',roots:Object.freeze(['bayfiles.com','bayfiles.net']),message:'BayFiles closed in August 2023, so its links no longer work. Choose another mirror.'}),
  Object.freeze({name:'LetsUpload',roots:Object.freeze(['letsupload.io','letsupload.org','letsupload.cc','letsupload.co','letsupload.us']),message:'LetsUpload has shut down, so its links no longer work. Choose another mirror.'})
]);
const closedHost=host=>CLOSED_HOSTS.find(entry=>under(host,entry.roots))||null;
// A mirror named in a link's text, such as "Filehoster: ZippyShare".
const closedByLabel=label=>{const text=String(label||'').toLowerCase();return CLOSED_HOSTS.find(entry=>text.includes(entry.name.toLowerCase()))||null;};

// Files on these hosts are fetched over one connection, as their free service allows.
const oneConnection=url=>isPixeldrainHost(hostOf(url));

module.exports={PASTE_HOSTS,isPasteHost,PIXELDRAIN_HOSTS,isPixeldrainHost,MULTIUP_HOSTS,isMultiupHost,CLOSED_HOSTS,closedHost,closedByLabel,oneConnection,hostOf,PROVIDER_ROOTS,isDownloadProvider};
