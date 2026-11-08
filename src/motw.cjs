'use strict';
// Adds Windows' "downloaded from the internet" mark (Mark of the Web) to a file
// that Ravenshelf took over from a browser download, as the browser would have
// done. SmartScreen, Office and other Windows protections then treat it like any
// other internet download. The mark names no website, only the internet zone.
const fs=require('node:fs');
const path=require('node:path');
const ZONE_IDENTIFIER='[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n';

async function markFromInternet(file,{platform=process.platform,fsApi=fs}={}){
  if(platform!=='win32')return false;
  // Exactly one drive colon is allowed; another colon would name a different stream.
  if(typeof file!=='string'||!path.win32.isAbsolute(file)||file.slice(2).includes(':'))throw new Error('Invalid file path.');
  await fsApi.promises.writeFile(file+':Zone.Identifier',ZONE_IDENTIFIER,{encoding:'utf8'});
  return true;
}
module.exports={markFromInternet,ZONE_IDENTIFIER};
