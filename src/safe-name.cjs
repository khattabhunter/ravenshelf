'use strict';
// The name a file or folder is saved under. Names arrive from web pages and
// servers, so they are made safe for Windows here, in one place. Every check
// that judges a file by its name judges this form of it, so the name that was
// checked is the name that is saved.
// Windows also treats spaces before a device's extension and superscript
// port digits as device names, and CONIN$ and CONOUT$ name the console.
// Readers and cleanup must reject the same names the downloader prefixes,
// without normalizing an existing path into another.
// A long name is cut at 180 UTF-16 units (181 with a device name's "_", see
// below), never through an emoji (two units):
// half of one cannot be passed to Windows, which would get U+FFFD instead.
// DEL (0x7f) becomes "_" like the other control characters: the storage check
// and Delete files refuse a name that has it.
// Cleaning a clean name changes nothing. Some names are cleaned twice (a
// protected host's file is checked, then queued), so both must be the same:
// the "_" before a device name is the one character a name may have past 180,
// and a blank that trim() would drop (U+1680, U+2028, U+2029, U+FEFF) never
// stays at the end.
const isWindowsDeviceName=value=>typeof value==='string'&&/^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/i.test(value);
const cut=(value,limit)=>value.slice(0,limit).replace(/[\s.\ud800-\udbff]+$/,'');
function safeName(value,fallback='download') {
  const clean=String(value || fallback).normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').trim();
  let s=cut(clean,clean.startsWith('_')&&isWindowsDeviceName(clean.slice(1))?181:180);
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
