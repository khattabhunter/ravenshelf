'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {NotificationAlerts}=require('../src/notifications.cjs');
test('old completed history is silent; new completions wait for scan and hide filenames',()=>{
  const shown=[];const alerts=new NotificationAlerts({show:n=>shown.push(n)});
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'downloading',name:'C:/private/name'}]);assert.equal(shown.length,0);
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'completed',scan:{status:'scanning'}}]);assert.equal(shown.length,0);
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'completed',scan:{status:'clean'}}]);assert.equal(shown.length,1);assert.doesNotMatch(JSON.stringify(shown),/private/);
});
test('disabled notifications stay silent and update-ready alerts deduplicate',()=>{const shown=[];let enabled=false;const alerts=new NotificationAlerts({show:n=>shown.push(n),enabled:()=>enabled});alerts.update('0.5.0');assert.equal(shown.length,0);enabled=true;alerts.update('0.5.0');alerts.update('0.5.0');assert.equal(shown.length,1);});
test('unfinished or uncertain antivirus results need attention, even when the download is complete',()=>{
  for(const status of ['threat','review','error','missing','unavailable']){
    const shown=[],alerts=new NotificationAlerts({show:value=>shown.push(value)});
    alerts.observe([{id:'file',status:'completed',scan:{status:'scanning'}}]);
    alerts.observe([{id:'file',status:'completed',scan:{status}}]);
    assert.equal(shown.length,1);assert.match(shown[0].body,/needs your attention/);assert.doesNotMatch(shown[0].body,/finished/);
  }
});
