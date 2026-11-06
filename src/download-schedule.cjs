'use strict';
const DEFAULT_SCHEDULE=Object.freeze({enabled:false,start:'00:00',end:'00:00',days:Object.freeze([0,1,2,3,4,5,6])});
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
function normalizeSchedule(value=DEFAULT_SCHEDULE){
  if(!value||typeof value!=='object'||typeof value.enabled!=='boolean'||typeof value.start!=='string'||typeof value.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end)||!Array.isArray(value.days)||value.days.length>7||value.days.some(day=>!Number.isInteger(day)||day<0||day>6))throw new Error('Choose valid local download hours and weekdays.');
  return {enabled:value.enabled,start:value.start,end:value.end,days:[...new Set(value.days)].sort((a,b)=>a-b)};
}
function scheduleActive(schedule,date){
  if(!schedule.enabled)return true;
  const day=date.getDay(),minute=date.getHours()*60+date.getMinutes(),start=minutes(schedule.start),end=minutes(schedule.end);
  if(start===end)return schedule.days.includes(day);
  if(start<end)return schedule.days.includes(day)&&minute>=start&&minute<end;
  return (minute>=start&&schedule.days.includes(day))||(minute<end&&schedule.days.includes((day+6)%7));
}
function scheduleSnapshot(schedule,date=new Date()){
  const active=scheduleActive(schedule,date);
  if(!schedule.enabled)return {enabled:false,active:true,nextChangeAt:null};
  const candidates=[];
  for(let day=0;day<=8;day++)for(const time of ['00:00',schedule.start,schedule.end]){
    const candidate=new Date(date.getFullYear(),date.getMonth(),date.getDate()+day,Math.floor(minutes(time)/60),minutes(time)%60);
    if(candidate>date&&scheduleActive(schedule,new Date(candidate.getTime()-1))!==scheduleActive(schedule,candidate))candidates.push(candidate);
  }
  candidates.sort((a,b)=>a-b);
  return {enabled:true,active,nextChangeAt:candidates[0]?.toISOString()||null};
}
module.exports={DEFAULT_SCHEDULE,normalizeSchedule,scheduleActive,scheduleSnapshot};
