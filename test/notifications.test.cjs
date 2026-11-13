'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {NotificationAlerts}=require('../src/notifications.cjs');
test('old completed history is silent; new completions wait for scan and hide filenames',()=>{
  const shown=[];const alerts=new NotificationAlerts({show:n=>shown.push(n)});
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'downloading',name:'C:/private/name'}]);assert.equal(shown.length,0);
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'completed',scan:{status:'scanning'}}]);assert.equal(shown.length,0);
  alerts.observe([{id:'old',status:'completed'},{id:'new',status:'completed',scan:{status:'clean'}}]);assert.equal(shown.length,1);assert.doesNotMatch(JSON.stringify(shown),/private/);
});
test('disabled notifications stay silent and update-ready alerts deduplicate',()=>{const shown=[];let enabled=false;const alerts=new NotificationAlerts({show:n=>shown.push(n),enabled:()=>enabled});alerts.update('0.5.0');assert.equal(shown.length,0);enabled=true;alerts.update('0.5.0');alerts.update('0.5.0');assert.equal(shown.length,1);});
test('update-available alerts appear once per version, name only the version and respect the setting',()=>{
  const shown=[];let enabled=false;const alerts=new NotificationAlerts({show:n=>shown.push(n),enabled:()=>enabled});
  alerts.available('0.5.0');assert.equal(shown.length,0);enabled=true;alerts.available('0.5.0');alerts.available('0.5.0');alerts.available('0.5.1');
  assert.deepEqual(shown.map(n=>n.title),['Ravenshelf update available','Ravenshelf update available']);assert.equal(shown[0].body,'Version 0.5.0 is available. Open Settings to review and install it.');
  alerts.update('0.5.1');assert.equal(shown.at(-1).title,'Ravenshelf update ready');assert.match(shown.at(-1).body,/installs when Ravenshelf fully exits, or you choose Restart now/);
  const failing=new NotificationAlerts({show:()=>{throw new Error('Notification service unavailable');}});assert.doesNotThrow(()=>failing.available('0.5.2'));
});
test('unfinished or uncertain antivirus results need attention, even when the download is complete',()=>{
  for(const status of ['threat','review','error','missing','unavailable']){
    const shown=[],alerts=new NotificationAlerts({show:value=>shown.push(value)});
    alerts.observe([{id:'file',status:'completed',scan:{status:'scanning'}}]);
    alerts.observe([{id:'file',status:'completed',scan:{status}}]);
    assert.equal(shown.length,1);assert.match(shown[0].body,/needs your attention/);assert.doesNotMatch(shown[0].body,/finished/);
  }
});
