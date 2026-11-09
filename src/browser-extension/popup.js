'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const P = globalThis.RavenshelfPolicy;
const $ = id => document.getElementById(id);
const STATUS = Object.freeze({
  connected: { tone: 'ok', title: 'Connected to Ravenshelf', text: state => `Ravenshelf ${state.appVersion} checks each download and asks before saving it.` },
  'app-closed': { tone: 'warn', title: 'Ravenshelf is closed', text: () => 'Downloads stay in your browser until you open Ravenshelf. Site blocking keeps working.' },
  'not-set-up': { tone: 'warn', title: 'Not connected yet', text: () => 'In Ravenshelf, open Settings › Browser extension and turn on “Connect the browser extension”.' },
  'wrong-extension': { tone: 'bad', title: 'This copy is not connected', text: () => 'Load the extension folder that Ravenshelf created, from Settings › Browser extension.' },
  unavailable: { tone: 'warn', title: 'Ravenshelf did not respond', text: () => 'Try again in a moment.' },
  unknown: { tone: 'muted', title: 'Checking…', text: () => '' }
});
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
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
function showMessage(text, tone) {
  const box = $('message');
  box.textContent = text || '';
  box.className = `message ${tone || ''}`.trim();
  box.hidden = !text;
}
function render(state) {
  if (!state) return;
  current = state;
  $('version').textContent = `Extension ${state.version}`;
  const status = STATUS[state.status] || STATUS.unknown;
  $('status').className = `status ${status.tone}-tone`;
  $('statusTitle').textContent = status.title;
  $('statusText').textContent = status.text(state);
  for (const key of ['capture', 'protection', 'guard', 'youtube']) $(key).checked = state[key] !== false;
  $('listInfo').textContent = state.listTotal > 0
    ? `${Number(state.listTotal).toLocaleString('en')} dangerous sites on the list${state.listSyncedAt ? ` · updated ${ago(state.listSyncedAt)}` : ''}.`
    : 'The lists arrive from Ravenshelf once it is connected.';
  const paused = state.pausedUntil > Date.now();
  $('pauseInfo').hidden = !paused;
  if (paused) $('pauseInfo').textContent = `Protection is paused until ${new Date(state.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  $('pause').textContent = paused ? 'Resume protection now' : 'Pause protection for 10 minutes';
  $('sendRow').hidden = !(activeTab && !activeTab.incognito && P.canSendPage(activeTab.url || ''));
}
async function act(message) {
  const reply = await send(message);
  if (reply.ok) render(reply.state);
  else showMessage('That did not work. Close this window and try again.', 'bad');
}
for (const key of ['capture', 'protection', 'guard', 'youtube']) $(key).addEventListener('change', event => { act({ cmd: 'set', key, value: event.target.checked }); });
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
  if (area === 'local' && ['status', 'appVersion', 'listTotal', 'listSyncedAt', 'capture', 'protection', 'guard', 'youtube', 'pausedUntil'].some(key => key in changes)) send({ cmd: 'state' }).then(reply => { if (reply.ok) render(reply.state); });
});
(async () => {
  try { [activeTab] = await api.tabs.query({ active: true, currentWindow: true }); } catch (error) { activeTab = null; }
  const quick = await send({ cmd: 'state' });
  if (quick.ok) render({ ...quick.state, status: 'unknown' });
  const full = await send({ cmd: 'status' });
  if (full.ok) render(full.state);
  else if (quick.ok) render(quick.state);
})();
