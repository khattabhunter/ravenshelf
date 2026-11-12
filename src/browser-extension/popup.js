'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const P = globalThis.RavenshelfPolicy;
const T = globalThis.RavenshelfText;
const $ = id => document.getElementById(id);
// English until the language is read, then the app's language.
let tr = T.create('en');
const STATUS = Object.freeze({
  connected: { tone: 'ok', title: 'Connected to Ravenshelf', text: state => tr.t('Ravenshelf {version} checks each download and asks before saving it.', { version: state.appVersion }) },
  'app-closed': { tone: 'warn', title: 'Ravenshelf is closed', text: () => tr.t('Downloads stay in your browser until you open Ravenshelf. Site blocking keeps working.') },
  'not-set-up': { tone: 'warn', title: 'Not connected yet', text: () => tr.t('In Ravenshelf, open Settings › Browser extension and turn on “Connect the browser extension”.') },
  'wrong-extension': { tone: 'bad', title: 'This copy is not connected', text: () => tr.t('Load the extension folder that Ravenshelf created, from Settings › Browser extension.') },
  unavailable: { tone: 'warn', title: 'Ravenshelf did not respond', text: () => tr.t('Try again in a moment.') },
  unknown: { tone: 'muted', title: 'Checking…', text: () => '' }
});
const SWITCHES = Object.freeze(['capture', 'protection', 'guard', 'youtube', 'nexus']);
let activeTab = null;
let current = null;

async function send(message) {
  try {
    const reply = await api.runtime.sendMessage(message);
    return reply && typeof reply === 'object' ? reply : { ok: false };
  } catch (error) { return { ok: false }; }
}
function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (!time || minutes < 0) return '';
  if (minutes < 1) return tr.t('just now');
  if (minutes < 60) return tr.tn(minutes, '{n} min ago', '{n} min ago');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return tr.tn(hours, '{n} h ago', '{n} h ago');
  return tr.tn(Math.round(hours / 24), '{n} days ago', '{n} days ago');
}
function showMessage(text, tone) {
  const box = $('message');
  box.textContent = text ? tr.t(text) : '';
  box.className = `message ${tone || ''}`.trim();
  box.hidden = !text;
}
function render(state) {
  if (!state) return;
  current = state;
  $('version').textContent = tr.t('Extension {version}', { version: state.version });
  const status = STATUS[state.status] || STATUS.unknown;
  $('status').className = `status ${status.tone}-tone`;
  $('statusTitle').textContent = tr.t(status.title);
  $('statusText').textContent = status.text(state);
  // A switch that the running extension does not know is not shown: it could
  // not act on it. That is an older copy, still running because the extension
  // has not been reloaded since Ravenshelf was updated.
  for (const key of SWITCHES) { $(key).checked = state[key] !== false; $(key).closest('label').hidden = !(key in state); }
  $('listInfo').textContent = state.listTotal > 0
    ? (state.listSyncedAt ? tr.t('{count} dangerous sites on the list · updated {ago}.', { count: tr.count(state.listTotal), ago: ago(state.listSyncedAt) }) : tr.t('{count} dangerous sites on the list.', { count: tr.count(state.listTotal) }))
    : tr.t('The lists arrive from Ravenshelf once it is connected.');
  const paused = state.pausedUntil > Date.now();
  $('pauseInfo').hidden = !paused;
  if (paused) $('pauseInfo').textContent = tr.t('Protection is paused until {time}.', { time: tr.time(new Date(state.pausedUntil)) });
  $('pause').textContent = tr.t(paused ? 'Resume protection now' : 'Pause protection for 10 minutes');
  $('sendRow').hidden = !(activeTab && !activeTab.incognito && P.canSendPage(activeTab.url || ''));
}
async function act(message) {
  const reply = await send(message);
  if (reply.ok) render(reply.state);
  else showMessage('That did not work. Close this window and try again.', 'bad');
}
for (const key of SWITCHES) $(key).addEventListener('change', event => { act({ cmd: 'set', key, value: event.target.checked }); });
$('pause').addEventListener('click', () => { act({ cmd: current && current.pausedUntil > Date.now() ? 'resume' : 'pause' }); });
$('sendPage').addEventListener('click', async () => {
  if (!activeTab) return;
  const button = $('sendPage');
  button.disabled = true;
  showMessage('Sending to Ravenshelf…');
  const result = await send({ cmd: 'sendPage', url: activeTab.url, incognito: activeTab.incognito === true });
  button.disabled = false;
  const reply = result.reply || {};
  if (!result.ok || !reply.ok) showMessage(reply.error === 'not-running' ? 'Open Ravenshelf, then try again.' : 'Ravenshelf could not take this page. Check that it is open and connected.', 'bad');
  else if (reply.action === 'take') showMessage('Sent. Review it in Ravenshelf; nothing downloads until you choose.', 'ok');
  else if (reply.action === 'block') showMessage(reply.reason || 'Ravenshelf blocked this page.', 'bad');
  else showMessage('Ravenshelf left this one to your browser.');
});
api.storage.onChanged.addListener((changes, area) => {
  // The app's language changed while this window is open: show it again in that language.
  if (area === 'local' && (changes.appLanguage || changes.appDigits)) { location.reload(); return; }
  if (area === 'local' && ['status', 'appVersion', 'listTotal', 'listSyncedAt', 'pausedUntil', ...SWITCHES].some(key => key in changes)) send({ cmd: 'state' }).then(reply => { if (reply.ok) render(reply.state); });
});
(async () => {
  try {
    const saved = await api.storage.local.get(['appLanguage', 'appDigits']) || {};
    tr = T.create(T.pick(saved.appLanguage, api.i18n && api.i18n.getUILanguage ? api.i18n.getUILanguage() : ''), saved.appDigits);
  } catch (error) { tr = T.create('en'); }
  tr.apply(document);
  try { [activeTab] = await api.tabs.query({ active: true, currentWindow: true }); } catch (error) { activeTab = null; }
  const quick = await send({ cmd: 'state' });
  if (quick.ok) render({ ...quick.state, status: 'unknown' });
  const full = await send({ cmd: 'status' });
  if (full.ok) render(full.state);
  else if (quick.ok) render(quick.state);
})();
