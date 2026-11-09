'use strict';
// Runs yt-dlp for the YouTube downloads chosen in the browser extension. Only
// the canonical address of one YouTube video reaches yt-dlp, always after
// "--". Configuration files, plugins, browser cookies and remote components
// are switched off, and the checked Deno is the only JavaScript runtime yt-dlp
// may use. yt-dlp runs without a shell, with a minimal environment, inside a
// private working folder next to the final file. Its output is read for
// progress only: the user sees fixed messages, never yt-dlp's own text.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const {VIDEO_ID,QUALITIES,FINAL_FILE,WORKSPACE_FILE,canonicalUrl,cleanTitle}=require('./youtube.cjs');

const MESSAGES=Object.freeze({
  failed:'The YouTube download failed. Try again; if it keeps failing, update Ravenshelf.',
  age:'This video is age-restricted. Ravenshelf does not use your YouTube sign-in, so it cannot download it.',
  members:'This video is for channel members only, so Ravenshelf cannot download it.',
  private:'This video is private, so Ravenshelf cannot download it.',
  signin:'YouTube asks for a sign-in for this video. Ravenshelf does not use your YouTube sign-in, so it cannot download it.',
  drm:'This video is copy-protected, so it cannot be downloaded.',
  unavailable:'This video is unavailable or was removed.',
  region:'This video is not available in your country.',
  bot:'YouTube asked to confirm this is not a bot, so the download stopped. Try again later.',
  live:'Live streams and premieres can be downloaded only after they end.',
  format:'This quality is not available for this video. Choose another quality.',
  refused:'YouTube refused the download. Try again later; if it keeps happening, update Ravenshelf.',
  limited:'YouTube is limiting downloads right now. Try again later.',
  network:'The connection to YouTube failed. Check your connection and retry.',
  stalled:'The YouTube download stopped responding. Retry to resume.',
  finish:'The video was downloaded, but the file could not be finished. Retry to try again.',
  space:'There is not enough free disk space. Free some space and try again.'
});
const NOTES=Object.freeze({details:'Getting video details…',starting:'Starting the download…',video:'Downloading the video…',audio:'Downloading the audio…',
  merge:'Joining video and audio…',mp3:'Converting to MP3…',audioFile:'Preparing the audio file…',metadata:'Adding the title to the file…',finishing:'Finishing the file…'});
// Only lines that yt-dlp marks as errors are matched, most specific first.
const ERROR_RULES=Object.freeze([
  [/confirm your age|age[- ]restricted|inappropriate for some users/i,MESSAGES.age],
  [/members[- ]only|join this channel|channel'?s members/i,MESSAGES.members],
  [/private video|video is private/i,MESSAGES.private],
  [/not a bot|captcha/i,MESSAGES.bot],
  [/drm protected/i,MESSAGES.drm],
  [/rate-limited|isn.t available, try again later/i,MESSAGES.limited],
  [/live event will begin|premieres? in|premiere will begin|is live|live stream|this live event/i,MESSAGES.live],
  [/available in your country|blocked it in your country|geo[- ]?restrict/i,MESSAGES.region],
  [/video unavailable|video is unavailable|has been removed|been terminated|no longer available|copyright claim|does not exist/i,MESSAGES.unavailable],
  [/requested format is not available/i,MESSAGES.format],
  [/sign in|registered users|login details|log in/i,MESSAGES.signin],
  [/no space left|errno 28|not enough space|disk full/i,MESSAGES.space],
  [/http error 429|too many requests/i,MESSAGES.limited],
  [/http error 403|403: forbidden/i,MESSAGES.refused],
  [/timed out|connection (?:reset|refused|aborted)|getaddrinfo|failed to resolve|name resolution|network is unreachable|unable to connect|ssl|certificate|remote end closed/i,MESSAGES.network],
  [/ffmpeg|ffprobe|postprocessing|conversion failed|merging/i,MESSAGES.finish]
]);
const PROGRESS='RAVENSHELF-PROGRESS',POST='RAVENSHELF-POST';
const PROGRESS_LINE=/^RAVENSHELF-PROGRESS (\S+) (\S+) (\S+) (\S+)\s*$/;
const POST_LINE=/^RAVENSHELF-POST (\S+)\s*$/;
const STAGE_LINE=/^\[(Merger|ExtractAudio|Metadata|EmbedThumbnail|VideoRemuxer|VideoConvertor|Fixup[A-Za-z0-9]*|MoveFiles)\]/;
const MAX_PROBE_OUTPUT=32*1024*1024,PROBE_TIMEOUT_MS=3*60*1000,QUIET_LIMIT_MS=15*60*1000;
const ENV_KEEP=['systemroot','windir','temp','tmp','localappdata','appdata','userprofile','homedrive','homepath','number_of_processors','processor_architecture','os','pathext','comspec'];

function mapError(stderr){
  const lines=String(stderr||'').split(/\r?\n/).filter(line=>/^ERROR:/i.test(line.trim()));
  for(const line of lines.reverse())for(const [pattern,message] of ERROR_RULES)if(pattern.test(line))return new Error(message);
  return new Error(MESSAGES.failed);
}
// Only what Windows programs need to start, plus private temporary and cache
// folders. Proxy settings, PATH entries and other variables stay out.
// DENO_DISABLE_NODE_SHIM stops Deno from adding a second name (a hard link
// called node.exe in its cache) to the checked deno.exe.
function childEnv(base,paths){
  const env={};
  for(const [key,value] of Object.entries(base||{}))if(ENV_KEEP.includes(key.toLowerCase())&&typeof value==='string')env[key]=value;
  for(const key of Object.keys(env))if(['temp','tmp'].includes(key.toLowerCase()))delete env[key];
  const root=env.SystemRoot||env.SYSTEMROOT||env.windir||env.WINDIR||'C:\\Windows';
  Object.assign(env,{PATH:[path.win32.join(root,'System32'),root].join(';'),TEMP:paths.temp,TMP:paths.temp,
    PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',NO_COLOR:'1',DENO_DIR:path.join(paths.cache,'deno'),DENO_NO_UPDATE_CHECK:'1',DENO_NO_PROMPT:'1',DENO_DISABLE_NODE_SHIM:'1'});
  return env;
}
function baseArgs(paths){
  return ['--ignore-config','--no-plugin-dirs','--no-remote-components','--no-js-runtimes','--js-runtimes',`deno:${paths.deno}`,
    '--ffmpeg-location',paths.dir,'--cache-dir',path.join(paths.cache,'yt-dlp'),'--no-cookies','--no-cookies-from-browser',
    '--no-playlist','--no-mtime','--encoding','utf-8','--color','never','--socket-timeout','30','--retries','5','--fragment-retries','5'];
}
function probeArgs(paths,videoId,quality){return [...baseArgs(paths),'-J',...QUALITIES[quality].args,'--',canonicalUrl(videoId)];}
// Parts of HLS streams download four at a time. yt-dlp applies a speed limit to
// each part on its own, so with a limit the parts download one at a time and
// the limit holds for the whole download.
const PARALLEL_PARTS='4';
function downloadArgs(paths,videoId,quality,rateLimit=0){
  return [...baseArgs(paths),'--newline','--progress',
    '--progress-template',`download:${PROGRESS} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(info.format_id)s`,
    '--progress-template',`postprocess:${POST} %(progress.postprocessor)s`,
    '-o','media.%(ext)s',...(rateLimit>0?['--limit-rate',String(Math.max(1024,Math.floor(rateLimit)))]:['--concurrent-fragments',PARALLEL_PARTS]),
    ...QUALITIES[quality].args,'--',canonicalUrl(videoId)];
}
// Stops yt-dlp together with the FFmpeg and Deno processes it started.
function killTree(child,{platform=process.platform,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
  return new Promise(resolve=>{
    if(!child||child.exitCode!==null||child.signalCode!==null)return resolve();
    if(platform==='win32'&&child.pid){
      execFile(path.win32.join(systemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:15000},()=>{try{child.kill();}catch{}resolve();});
    }else{try{child.kill('SIGKILL');}catch{}resolve();}
  });
}
function abortError(){const error=new Error('The operation was aborted.');error.name='AbortError';return error;}
// Runs one program to the end. stdout is kept (up to a limit) only when asked;
// every output line, from either stream, goes to onLine.
function runTool(file,args,{cwd,env,signal,timeoutMs=0,quietMs=QUIET_LIMIT_MS,keepStdout=0,onLine=()=>{},spawnImpl=spawn,kill=killTree}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(signal.reason||abortError());
    let child;
    try{child=spawnImpl(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(error){return reject(error);}
    let settled=false,stopped=null,stdoutBytes=0,stderrTail='',quietTimer=null,totalTimer=null;
    const stdout=[];
    const finish=(error,value)=>{
      if(settled)return;settled=true;
      clearTimeout(quietTimer);clearTimeout(totalTimer);signal?.removeEventListener('abort',onAbort);
      if(error)reject(error);else resolve(value);
    };
    // If the process somehow outlives the stop request, give up waiting for it.
    const stop=reason=>{if(stopped)return;stopped=reason;Promise.resolve(kill(child)).catch(()=>{});setTimeout(()=>finish(reason),20000).unref?.();};
    const onAbort=()=>stop(signal.reason||abortError());
    const quiet=()=>{clearTimeout(quietTimer);if(quietMs>0)quietTimer=setTimeout(()=>stop(new Error(MESSAGES.stalled)),quietMs);};
    signal?.addEventListener('abort',onAbort,{once:true});
    if(timeoutMs>0)totalTimer=setTimeout(()=>stop(new Error(MESSAGES.stalled)),timeoutMs);
    quiet();
    const reader=keep=>{
      const decoder=new StringDecoder('utf8');let pending='';
      return chunk=>{
        quiet();
        if(keep){stdoutBytes+=chunk.length;if(stdoutBytes>keepStdout){stop(new Error(MESSAGES.failed));return;}stdout.push(chunk);}
        else stderrTail=(stderrTail+chunk.toString('utf8')).slice(-65536);
        pending+=decoder.write(chunk);
        const lines=pending.split(/\r?\n|\r/);pending=lines.pop();
        if(pending.length>65536)pending=pending.slice(-65536);
        for(const line of lines)if(line)try{onLine(line);}catch{}
      };
    };
    child.stdout?.on('data',reader(keepStdout>0));
    child.stderr?.on('data',reader(false));
    child.once('error',error=>finish(stopped||error));
    child.once('close',code=>{
      if(stopped)return finish(stopped);
      finish(null,{code,stdout:keepStdout>0?Buffer.concat(stdout).toString('utf8'):'',stderr:stderrTail});
    });
  });
}
const size=value=>Number.isSafeInteger(value)&&value>0?value:Number.isFinite(value)&&value>0&&value<Number.MAX_SAFE_INTEGER?Math.round(value):0;
// The parts of yt-dlp's video description Ravenshelf keeps.
function videoDetails(info,videoId,quality){
  if(!info||typeof info!=='object'||Array.isArray(info)||info.id!==videoId||(info._type&&info._type!=='video'))throw new Error(MESSAGES.failed);
  if(info.is_live===true||['is_live','is_upcoming','post_live'].includes(info.live_status))throw new Error(MESSAGES.live);
  const choice=QUALITIES[quality];
  const formats=(Array.isArray(info.requested_formats)&&info.requested_formats.length?info.requested_formats:[info]).slice(0,4)
    .map(format=>({id:String(format?.format_id||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40),size:size(format?.filesize)||size(format?.filesize_approx),audio:format?.vcodec==='none'}));
  const ext=choice.audio?choice.ext:['mp4','mkv','webm'].includes(info.ext)?info.ext:'mp4';
  return {title:cleanTitle(info.title)||`YouTube video ${videoId}`,ext,formats,total:formats.reduce((sum,format)=>sum+format.size,0),duration:size(info.duration)};
}
async function probe({paths,videoId,quality,signal,spawnImpl,kill,env=process.env}){
  const result=await runTool(paths.ytDlp,probeArgs(paths,videoId,quality),{cwd:paths.temp,env:childEnv(env,paths),signal,timeoutMs:PROBE_TIMEOUT_MS,keepStdout:MAX_PROBE_OUTPUT,spawnImpl,kill});
  if(result.code!==0)throw mapError(result.stderr);
  let info;try{info=JSON.parse(result.stdout);}catch{throw new Error(MESSAGES.failed);}
  return videoDetails(info,videoId,quality);
}
// Adds up progress across the separate video and audio parts.
function progressTracker(formats=[]){
  const planned=new Map(formats.filter(format=>format.id).map(format=>[format.id,format])),seen=new Map();
  return update=>{
    seen.set(update.format||'-',{downloaded:update.downloaded,total:update.total||planned.get(update.format)?.size||0});
    let received=0,total=0;
    for(const item of seen.values()){received+=item.downloaded;total+=Math.max(item.total,item.downloaded);}
    for(const [id,format] of planned)if(!seen.has(id))total+=format.size;
    return {received,total};
  };
}
function parseProgress(line){
  const match=PROGRESS_LINE.exec(line);if(!match)return null;
  const number=value=>/^\d+(?:\.\d+)?$/.test(value)?Math.floor(Number(value)):0;
  return {downloaded:number(match[1]),total:number(match[2])||number(match[3]),format:match[4]==='NA'?'':match[4].replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40)};
}
function stageNote(name,quality){
  if(name==='Merger')return NOTES.merge;
  if(name==='ExtractAudio')return quality==='audio-mp3'?NOTES.mp3:NOTES.audioFile;
  if(name==='Metadata'||name==='EmbedThumbnail')return NOTES.metadata;
  return NOTES.finishing;
}
async function finalFile(workspace,quality,expectedExt){
  const choice=QUALITIES[quality],allowed=choice.audio?[choice.ext]:['mp4','mkv','webm'];
  const entries=await fs.promises.readdir(workspace,{withFileTypes:true});
  const finals=entries.filter(entry=>entry.isFile()&&FINAL_FILE.test(entry.name)&&allowed.includes(FINAL_FILE.exec(entry.name)[1]));
  const chosen=finals.length===1?finals[0]:finals.find(entry=>entry.name===`media.${expectedExt}`);
  if(!chosen)throw new Error(MESSAGES.finish);
  return {file:path.join(workspace,chosen.name),ext:FINAL_FILE.exec(chosen.name)[1]};
}
async function fetchMedia({paths,videoId,quality,workspace,rateLimit,signal,formats,expectedExt,onProgress=()=>{},onNote=()=>{},spawnImpl,kill,env=process.env}){
  const track=progressTracker(formats),audioIds=new Set(formats.filter(format=>format.audio).map(format=>format.id));
  let note='';
  const say=value=>{if(value&&value!==note){note=value;onNote(value);}};
  const onLine=line=>{
    const progress=parseProgress(line);
    if(progress){
      say(QUALITIES[quality].audio||audioIds.has(progress.format)?NOTES.audio:NOTES.video);
      const {received,total}=track(progress);onProgress(received,total);return;
    }
    const post=POST_LINE.exec(line)||STAGE_LINE.exec(line);
    if(post)say(stageNote(post[1].startsWith('Fixup')?'Fixup':post[1],quality));
  };
  const result=await runTool(paths.ytDlp,downloadArgs(paths,videoId,quality,rateLimit),{cwd:workspace,env:childEnv(env,paths),signal,onLine,spawnImpl,kill});
  if(result.code!==0)throw mapError(result.stderr);
  signal?.throwIfAborted();
  return finalFile(workspace,quality,expectedExt);
}
// Removes what yt-dlp left in a download's working folder: only media.* files,
// then the folder if it is empty. Anything else is left where it is.
async function removeMediaWorkspace(workspace){
  let entries;try{entries=await fs.promises.readdir(workspace,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries)if(entry.isFile()&&WORKSPACE_FILE.test(entry.name))await fs.promises.unlink(path.join(workspace,entry.name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.promises.rmdir(workspace).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
// The download queue's view of YouTube jobs: check the helper programs, read
// the video's details once, then download into the job's working folder.
const RUN_TEMP=/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createMediaRunner({tools,spawnImpl=spawn,kill=killTree,env=process.env}={}){
  let active=0;const runs=new Set();
  async function download(d,{signal,workspace,rateLimit=0,onDetails=()=>{},onProgress=()=>{},onNote=()=>{}}={}){
    const media=d?.media||{};
    if(!VIDEO_ID.test(String(media.videoId||''))||!Object.hasOwn(QUALITIES,String(media.quality)))throw new Error(MESSAGES.failed);
    const verified=await tools.verified();
    signal?.throwIfAborted();
    // Each job gets its own temporary folder (yt-dlp unpacks itself there),
    // removed when the job ends however it ends.
    const name=`run-${crypto.randomUUID()}`,temp=path.join(verified.temp,name);
    runs.add(name);active++;
    const paths={...verified,temp};
    try{
      await fs.promises.mkdir(temp,{recursive:true});
      let details=media.title&&Array.isArray(media.formats)?{title:media.title,ext:media.ext,formats:media.formats}:null;
      if(!details){
        onNote(NOTES.details);
        details=await probe({paths,videoId:media.videoId,quality:media.quality,signal,spawnImpl,kill,env});
        signal?.throwIfAborted();
        onDetails(details);
      }
      onNote(NOTES.starting);
      return await fetchMedia({paths,videoId:media.videoId,quality:media.quality,workspace,rateLimit,signal,formats:details.formats||[],expectedExt:details.ext,onProgress,onNote,spawnImpl,kill,env});
    }finally{
      active--;
      await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});
      runs.delete(name);
    }
  }
  // Removes temporary folders that earlier jobs could not remove (for example
  // after Ravenshelf was closed abruptly). Folders of running jobs are kept:
  // a job registers its folder before creating it.
  async function cleanStale(){
    const root=tools.temp;if(typeof root!=='string')return 0;
    let entries;try{entries=await fs.promises.readdir(root,{withFileTypes:true});}catch{return 0;}
    let removed=0;
    for(const entry of entries){
      if(!entry.isDirectory()||!RUN_TEMP.test(entry.name)||runs.has(entry.name))continue;
      try{await fs.promises.rm(path.join(root,entry.name),{recursive:true,force:true,maxRetries:2});removed++;}catch{}
    }
    return removed;
  }
  return {download,cleanStale,get active(){return active;}};
}
module.exports={MESSAGES,NOTES,createMediaRunner,runTool,killTree,mapError,childEnv,baseArgs,probeArgs,downloadArgs,videoDetails,parseProgress,progressTracker,removeMediaWorkspace,finalFile,PROGRESS,POST};
