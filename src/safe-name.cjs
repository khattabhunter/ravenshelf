'use strict';
// The name a file or folder is saved under. Names arrive from web pages and
// servers, so they are made safe for Windows here, in one place. Every check
// that judges a file by its name judges this form of it, so the name that was
// checked is the name that is saved.
// Windows also treats spaces before a device's extension and superscript
// port digits as device names. Readers and cleanup must reject the same names
// the downloader prefixes, without normalizing an existing path into another.
const isWindowsDeviceName=value=>typeof value==='string'&&/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/i.test(value);
function safeName(value,fallback='download') {
  let s=String(value || fallback).normalize('NFKC').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').trim().slice(0,180).replace(/[. ]+$/g,'');
  if(!s || s==='.' || s==='..') s=fallback;
  if(isWindowsDeviceName(s)) s='_'+s;
  return s;
}
// A folder name: at most 100 characters and, after that cut, still without a
// trailing dot or space. Windows drops those, so a folder made with one would
// not be the folder that Explorer and Microsoft Defender open.
function folderName(value,fallback='Imported files') {
  return safeName(safeName(value,fallback).slice(0,100).replace(/[\ud800-\udbff]$/,''),fallback);
}
module.exports={safeName,folderName,isWindowsDeviceName};
