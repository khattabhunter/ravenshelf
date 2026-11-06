'use strict';

const ROOTS=['fuckingfast.co','fuckingfast.net'];
function fastRoot(value){
  try{
    const url=new URL(String(value));
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null;
    return ROOTS.find(root=>url.hostname===root||url.hostname.endsWith('.'+root))||null;
  }catch{return null;}
}
function isFastFileURL(value){
  try{return Boolean(fastRoot(value))&&/^\/dl\/[^/]+/.test(new URL(String(value)).pathname);}catch{return false;}
}
function normalizeFilename(value){
  return String(value||'').normalize('NFKC').trim().replace(/[. ]+$/g,'').toLowerCase();
}
function assertFastFile(source,direct,filename){
  if(!fastRoot(source))return;
  if(!isFastFileURL(direct))throw new Error('Blocked an unexpected download destination. FuckingFast files must use its HTTPS download servers.');
  const actual=normalizeFilename(filename);
  if(/[\x00-\x1f\x7f/\\]/.test(actual)||!/\.(?:rar|zip|7z|bin|iso|\d{3})$/.test(actual))throw new Error('Blocked an unexpected download type. FuckingFast capture accepts archive files only.');
  const fragment=new URL(String(source)).hash.slice(1);
  if(fragment){
    let expected;
    try{expected=normalizeFilename(decodeURIComponent(fragment));}catch{throw new Error('The selected FuckingFast link has an invalid file name.');}
    if(actual!==expected)throw new Error('Blocked an unexpected file. Its name does not match the selected FuckingFast download.');
  }
}
function assertFastRedirect(source,destination){
  if(fastRoot(source)&&!fastRoot(destination))throw new Error('Blocked an off-site redirect from FuckingFast. Choose another link from the same host.');
}
module.exports={fastRoot,isFastFileURL,assertFastFile,assertFastRedirect};
