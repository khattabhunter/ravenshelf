'use strict';
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const MAX_RESULTS=2000;
function createIntegrityVerifier({onChange=()=>{}}={}){
  let worker=null,generation=0;
  let state={phase:'idle',completed:0,total:0,bytesChecked:0,results:[],error:''};
  const snapshot=()=>structuredClone(state);
  const emit=()=>{try{onChange(snapshot());}catch{}};
  function start({manifestPath,rootPath}={}){
    if(worker)throw new Error('A checksum verification is already running.');
    if(typeof manifestPath!=='string'||typeof rootPath!=='string'||manifestPath.length>2048||rootPath.length>2048)throw new Error('Choose a checksum manifest and its file folder.');
    const run=++generation;state={phase:'running',completed:0,total:0,bytesChecked:0,results:[],error:''};
    let active;
    try{active=new Worker(path.join(__dirname,'integrity-worker.cjs'),{workerData:{manifestPath,rootPath},resourceLimits:{maxOldGenerationSizeMb:128}});worker=active;}
    catch{state.phase='error';state.error='Checksum verification could not start.';emit();return snapshot();}
    active.on('message',message=>{
      if(run!==generation)return;
      if(message.type==='progress'||message.type==='complete'){
        if(!Number.isInteger(message.total)||message.total<0||message.total>MAX_RESULTS||!Number.isInteger(message.completed)||message.completed<state.completed||message.completed>message.total||!Array.isArray(message.results)||state.results.length+message.results.length>MAX_RESULTS){state.phase='error';state.error='Checksum verification returned an invalid result.';worker=null;void active.terminate();emit();return;}
        state.total=message.total;state.completed=message.completed;state.bytesChecked=Number.isSafeInteger(message.bytesChecked)&&message.bytesChecked>=0?message.bytesChecked:state.bytesChecked;state.results.push(...message.results);
        if(message.type==='complete'){state.phase='completed';worker=null;}
      }else if(message.type==='cancelled'){state.phase='cancelled';worker=null;}
      else if(message.type==='error'){state.phase='error';state.error=typeof message.error==='string'?message.error.slice(0,300):'Checksum verification failed.';worker=null;}
      emit();
    });
    active.on('error',()=>{if(run!==generation)return;worker=null;state.phase='error';state.error='Checksum verification could not finish.';emit();});
    active.on('exit',()=>{if(run!==generation)return;if(worker===active)worker=null;if(state.phase==='running'){state.phase='error';state.error='Checksum verification stopped unexpectedly.';emit();}});
    emit();return snapshot();
  }
  function cancel(){
    if(!worker)return snapshot();
    const active=worker;worker=null;generation++;state.phase='cancelled';state.error='';
    try{active.postMessage({type:'cancel'});}catch{}void active.terminate().catch(()=>{});emit();return snapshot();
  }
  return {start,cancel,snapshot};
}
module.exports={createIntegrityVerifier};
