'use strict';
// YouTube addresses and download choices shared by the browser bridge, the
// download queue and the yt-dlp runner. Only the 11-character video ID of a
// youtube.com or youtu.be address is kept; everything else in the address
// (playlists, timestamps, tracking) is dropped before yt-dlp sees it.
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS=new Set(['www.youtube.com','youtube.com','m.youtube.com']);
const MEDIA_FOLDER='YouTube';
// Video choices prefer the most widely playable codecs (H.264 video, AAC audio)
// at the chosen size. A video that YouTube offers larger only in VP9 or AV1
// still downloads at the best size, joined as MKV when MP4 cannot hold it.
// Between video streams of the same size and codec, HLS (m3u8) streams come
// first: YouTube slows its single-file video streams to a few hundred KB/s,
// while HLS streams arrive in parts that download several at a time. The audio
// still comes from YouTube's AAC files (those arrive at full speed), which
// keeps H.264 videos in MP4.
const videoArgs=limit=>Object.freeze(['-f','bv*+ba/b','-S',`res${limit},fps,vcodec:h264,acodec:m4a,proto:m3u8`,'--merge-output-format','mp4/mkv']);
const QUALITIES=Object.freeze({
  best:Object.freeze({label:'Best quality',ext:'mp4',audio:false,args:videoArgs('')}),
  '1080':Object.freeze({label:'1080p',ext:'mp4',audio:false,args:videoArgs(':1080')}),
  '720':Object.freeze({label:'720p',ext:'mp4',audio:false,args:videoArgs(':720')}),
  '480':Object.freeze({label:'480p',ext:'mp4',audio:false,args:videoArgs(':480')}),
  'audio-m4a':Object.freeze({label:'Audio (M4A)',ext:'m4a',audio:true,args:Object.freeze(['-f','ba[ext=m4a]/ba/b','-x','--audio-format','m4a','--embed-metadata'])}),
  'audio-mp3':Object.freeze({label:'Audio (MP3)',ext:'mp3',audio:true,args:Object.freeze(['-f','ba/b','-x','--audio-format','mp3','--audio-quality','0','--embed-metadata'])})
});
// Listed in menu order (an object would put the numeric keys first).
const QUALITY_IDS=Object.freeze(['best','1080','720','480','audio-m4a','audio-mp3']);
// "default" asks the app to use the quality chosen in its settings (right-click downloads).
const REQUEST_QUALITIES=Object.freeze(['default',...QUALITY_IDS]);
const DEFAULT_QUALITY='1080';
const MEDIA_EXTENSIONS=Object.freeze(['mp4','mkv','webm','m4a','mp3']);
// yt-dlp writes only files named media.* in a download's private working
// folder (parts, the joined file and its temporary copies).
const WORKSPACE_FILE=/^media\.[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$/;
const FINAL_FILE=/^media\.(mp4|mkv|webm|m4a|mp3)$/;

function youtubeVideoId(value){
  if(typeof value!=='string'||!value||value.length>8192)return null;
  let url;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  const host=url.hostname.toLowerCase();let id=null;
  if(host==='youtu.be')id=/^\/([^/]+)\/?$/.exec(url.pathname)?.[1]||null;
  else if(YOUTUBE_HOSTS.has(host)){
    if(url.pathname==='/watch'||url.pathname==='/watch/')id=url.searchParams.get('v');
    else id=/^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1]||null;
  }
  return typeof id==='string'&&VIDEO_ID.test(id)?id:null;
}
function canonicalUrl(id){
  if(typeof id!=='string'||!VIDEO_ID.test(id))throw new Error('Only YouTube video addresses can be downloaded this way.');
  return 'https://www.youtube.com/watch?v='+id;
}
function qualityLabel(id){return QUALITIES[id]?.label||'';}
// Characters that can disguise how a file name reads (direction overrides and
// invisible marks) are removed from video titles before they become names.
const DISGUISE=/[؜​-‏‪-‮⁠-⁩﻿]/g;
function cleanTitle(value){
  return typeof value==='string'?value.replace(DISGUISE,'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,300):'';
}
module.exports={VIDEO_ID,MEDIA_FOLDER,QUALITIES,QUALITY_IDS,REQUEST_QUALITIES,DEFAULT_QUALITY,MEDIA_EXTENSIONS,WORKSPACE_FILE,FINAL_FILE,youtubeVideoId,canonicalUrl,qualityLabel,cleanTitle};
