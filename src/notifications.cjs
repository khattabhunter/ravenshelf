'use strict';
class NotificationAlerts{
  constructor({show=()=>{},enabled=()=>true,now=Date.now}={}){this.show=show;this.enabled=enabled;this.now=now;this.previous=null;this.lastShown=-Infinity;this.updateVersion='';this.availableVersion='';}
  observe(downloads){
    const next=new Map(downloads.map(d=>[d.id,{status:d.status,scan:d.scan?.status}]));
    if(!this.previous){this.previous=next;return;}
    let completed=0,failed=0,threat=0;
    for(const [id,d]of next){const old=this.previous.get(id);if(!old)continue;
      if(d.status==='completed'&&!['queued','scanning'].includes(d.scan)&&(old.status!=='completed'||['queued','scanning'].includes(old.scan)))completed++;
      if(d.status==='error'&&old.status!=='error')failed++;
      if(['threat','review','error','missing','unavailable'].includes(d.scan)&&old.scan!==d.scan)threat++;
    }
    this.previous=next;
    if(!this.enabled()||(!completed&&!failed&&!threat))return;
    if(!threat&&this.now()-this.lastShown<3000)return;
    this.lastShown=this.now();
    try{this.show({title:'Ravenshelf',body:threat?'A download scan needs your attention.':failed?'A download needs your attention.':completed===1?'A download has finished.':'Downloads have finished.'});}catch{}
  }
  // Announced once per version. Nothing is downloaded until the user chooses
  // Download and install in Settings.
  available(version){if(!this.enabled()||this.availableVersion===version)return;this.availableVersion=version;try{this.show({title:'Ravenshelf update available',body:`Version ${version} is available. Open Settings to review and install it.`});}catch{}}
  update(version){if(!this.enabled()||this.updateVersion===version)return;this.updateVersion=version;try{this.show({title:'Ravenshelf update ready',body:'The verified update installs when Ravenshelf fully exits, or you choose Restart now in Settings.'});}catch{}}
}
module.exports={NotificationAlerts};
