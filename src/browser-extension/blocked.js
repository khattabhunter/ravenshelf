'use strict';
// Only the extension opens this page (it is not reachable from websites), and
// everything shown comes from its address as plain text.
const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const clean = (value, max) => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
const reason = clean(params.get('reason'), 20);
const host = clean(params.get('host'), 253);
const from = clean(params.get('from'), 253);
const blockedUrl = clean(params.get('url'), 8192);
const committed = params.get('committed') === '1';
const TEXT = {
  redirect: ['Ravenshelf stopped a redirect', from ? '{source} tried to send you to another site instead of your download.' : 'A file-host page tried to send you to another site instead of your download.', 'File hosts use redirects like this for ads and fake download pages. If you meant to visit this site, type its address yourself.'],
  malware: ['Dangerous site blocked', 'This site is on a list of sites that spread malware.', 'List: URLhaus, through malware-filter.'],
  phishing: ['Phishing site blocked', 'This site is on a list of phishing sites, which try to steal passwords and payment details.', 'List: malware-filter phishing list.'],
  threats: ['Dangerous site blocked', 'This site is on a list of malware, scam and phishing sites.', 'List: HaGeZi Threat Intelligence Feeds.'],
  popups: ['Pop-up ad network blocked', 'This site belongs to a pop-up ad network known for malicious ads and fake downloads.', 'List: HaGeZi Pop-Up Ads.']
};
// The page is shown in the app's language once it is read; English before.
function language() {
  try {
    return Promise.resolve(api.storage.local.get(['appLanguage', 'appDigits']))
      .then(saved => RavenshelfText.create(RavenshelfText.pick(saved && saved.appLanguage, api.i18n && api.i18n.getUILanguage ? api.i18n.getUILanguage() : ''), saved && saved.appDigits), () => RavenshelfText.create('en'));
  } catch (error) { return Promise.resolve(RavenshelfText.create('en')); }
}
const [title, lead, detail] = TEXT[reason] || ['Ravenshelf blocked this page', 'Ravenshelf stopped this page to keep you safe.', ''];
let tr = RavenshelfText.create('en');
function show() {
  document.title = `${tr.t(title)} · Ravenshelf`;
  $('title').textContent = tr.t(title);
  $('lead').textContent = tr.t(lead, { source: from });
  $('detail').textContent = tr.t(detail);
  if (!$('return').hidden && !$('return').disabled) $('return').textContent = tr.t('Back to {host}', { host: from });
}
$('host').textContent = host;
$('host').hidden = !host;
$('detail').hidden = !detail;

function send(message) { try { return Promise.resolve(api.runtime.sendMessage(message)).catch(() => null); } catch (error) { return Promise.resolve(null); } }
// Back to the file-host page the redirect started from. The extension keeps
// that address; this page only asks for it to be opened again.
if (reason === 'redirect' && params.get('back') === '1' && from) {
  const button = $('return');
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const reply = await send({ cmd: 'return' });
    if (!reply || !reply.ok) button.textContent = tr.t('That page is no longer available');
  });
}
// The blocked address leaves an entry right behind this page (an error entry
// if it never loaded, the page itself if it loaded and was then stopped), so
// there is somewhere to go back to only with at least one entry before that.
if (history.length > 2) {
  const button = $('back');
  button.hidden = false;
  button.addEventListener('click', async () => {
    if (committed) { history.go(-2); return; }
    const reply = await send({ cmd: 'back', url: blockedUrl });
    if (!reply || !reply.ok) history.back();
  });
}
$('close').addEventListener('click', async () => {
  const reply = await send({ cmd: 'closeTab' });
  if (!reply || !reply.ok) window.close();
});
show();
language().then(local => { tr = local; tr.apply(document); show(); });
