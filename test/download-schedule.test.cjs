'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeSchedule,scheduleActive,scheduleSnapshot}=require('../src/download-schedule.cjs');
const local=(day,hour=0,minute=0)=>new Date(2026,10,day,hour,minute);
test('local weekday schedule includes its start and excludes its end',()=>{
  const schedule=normalizeSchedule({enabled:true,start:'09:00',end:'17:00',days:[1]});
  assert.equal(scheduleActive(schedule,local(9,8,59)),false);
  assert.equal(scheduleActive(schedule,local(9,9)),true);
  assert.equal(scheduleActive(schedule,local(9,17)),false);
  assert.equal(scheduleActive(schedule,local(10,12)),false);
  assert.equal(scheduleSnapshot(schedule,local(9,12)).nextChangeAt,local(9,17).toISOString());
});
test('overnight window belongs to the weekday on which it starts',()=>{
  const schedule=normalizeSchedule({enabled:true,start:'22:00',end:'06:00',days:[1]});
  assert.equal(scheduleActive(schedule,local(9,23)),true);
  assert.equal(scheduleActive(schedule,local(10,5,59)),true);
  assert.equal(scheduleActive(schedule,local(9,5)),false);
  assert.equal(scheduleActive(schedule,local(10,6)),false);
  assert.equal(scheduleSnapshot(schedule,local(9,23)).nextChangeAt,local(10,6).toISOString());
});
test('equal start and end means the full selected day; disabled means unrestricted',()=>{
  const schedule=normalizeSchedule({enabled:true,start:'00:00',end:'00:00',days:[1]});
  assert.equal(scheduleActive(schedule,local(9,23,59)),true);
  assert.equal(scheduleSnapshot(schedule,local(9,12)).nextChangeAt,local(10).toISOString());
  assert.equal(scheduleActive(normalizeSchedule(),local(10,3)),true);
  assert.equal(scheduleSnapshot({...schedule,days:[]},local(9)).nextChangeAt,null);
});
test('schedule rejects malformed clocks and weekdays without changing its input',()=>{
  for(const value of [{enabled:true,start:'24:00',end:'00:00',days:[1]},{enabled:true,start:'00:00',end:'04:00',days:[7]}])assert.throws(()=>normalizeSchedule(value),/valid local/);
  assert.deepEqual(normalizeSchedule({enabled:true,start:'09:00',end:'17:00',days:[2,1,2]}).days,[1,2]);
});
