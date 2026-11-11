// Ravenshelf extension background: a service worker in Chrome, Edge and Brave,
// an event page in Firefox. It hands downloads to the Ravenshelf app on this PC,
// keeps the browser's own blocking rules in step with Ravenshelf's protection
// lists, stops the pop-ups and redirects that file-host pages start, sends the
// YouTube videos you choose (player button or right-click) to Ravenshelf, and
// labels files you download on Nexus Mods with their game and mod.
// It talks only to Ravenshelf on this PC, through the native connector.
'use strict';
if (typeof importScripts === 'function' && !globalThis.RavenshelfPolicy) importScripts('policy.js');
const P = globalThis.RavenshelfPolicy;
const api = typeof browser !== 'undefined' ? browser : chrome;
const isFirefox = typeof api.runtime.getBrowserInfo === 'function';
const BROWSER = isFirefox ? 'firefox' : 'chromium';
const VERSION = api.runtime.getManifest().version;
const menus = api.contextMenus || api.menus;
const dnr = api.declarativeNetRequest;
const DEFAULTS = Object.freeze({ capture: true, protection: true, guard: true, youtube: true, nexus: true, pausedUntil: 0, listVersion: '', listTotal: 0, listSyncedAt: 0, listFirstRule: 0, status: 'unknown', appVersion: '' });
const PAUSE_MS = 10 * 60 * 1000;
const SYNC_MINUTES = 60;
const POPUP_WATCH_MS = 15000;
const BLANK_POPUP_MS = 3000;
const RESTORE_GAP_MS = 15000;
const HANDLED_MS = 5000;
const BACK_MS = 8000;
const STATUS_FROM_ERROR = Object.freeze({ 'not-running': 'app-closed', 'not-installed': 'not-set-up', 'not-allowed': 'wrong-extension' });
const CATEGORY_TEXT = Object.freeze({ malware: 'sites that spread malware', phishing: 'phishing sites', threats: 'malware, scam and phishing sites', popups: 'malicious pop-up ad networks' });

async function settings() { return { ...DEFAULTS, ...(await api.storage.local.get(Object.keys(DEFAULTS))) }; }
// Runs a browser call whose failure should not stop the caller, including
// calls that throw before returning a promise.
function quiet(work) { try { return Promise.resolve(work()).catch(() => undefined); } catch (error) { return Promise.resolve(undefined); } }
function isWeb(url) { return /^https?:\/\//i.test(String(url || '')); }

// ---- talking to the app ----
function withTimeout(promise, ms) {
  let timer;
  const expiry = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
async function ask(message, ms = 8000) {
  try {
    const reply = await withTimeout(api.runtime.sendNativeMessage(P.HOST_NAME, { v: 1, ...message }), ms);
    return reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : { ok: false, error: 'invalid' };
  } catch (error) {
    return { ok: false, error: error && error.message === 'timeout' ? 'timeout' : P.nativeError(error) };
  }
}
async function hello() {
  const reply = await ask({ type: 'hello', extensionVersion: VERSION, browser: BROWSER }, 5000);
  const status = reply.ok ? 'connected' : STATUS_FROM_ERROR[reply.error] || 'unavailable';
  await api.storage.local.set({ status, appVersion: reply.ok && typeof reply.version === 'string' ? reply.version.slice(0, 20) : '' });
  return reply;
}

// ---- notifications (rate limited, so a hostile page cannot flood them) ----
const lastShown = new Map();
let shownTimes = [];
function notify(key, title, message, cooldown = 4000) {
  const now = Date.now();
  if (now - (lastShown.get(key) || 0) < cooldown) return;
  shownTimes = shownTimes.filter(time => now - time < 60000);
  if (shownTimes.length >= 6) return;
  lastShown.set(key, now); shownTimes.push(now);
  if (lastShown.size > 200) lastShown.delete(lastShown.keys().next().value);
  quiet(() => api.notifications.create(`ravenshelf-${now}-${shownTimes.length}`, { type: 'basic', iconUrl: api.runtime.getURL('icons/icon-128.png'), title, message: String(message || '').slice(0, 300) }));
}
function notifyUnavailable(error) {
  const text = {
    'not-running': 'Open Ravenshelf, then try again.',
    'not-installed': 'In Ravenshelf, open Settings › Browser extension and turn on “Connect the browser extension”.',
    'not-allowed': 'Load the extension folder that Ravenshelf created, from Settings › Browser extension.',
    busy: 'Ravenshelf is busy. Try again in a moment.'
  }[error] || 'Ravenshelf did not respond. Try again.';
  notify('unavailable', 'Ravenshelf is not available', text);
}
function report(reply, url) {
  if (!reply.ok) { notifyUnavailable(reply.error); return; }
  if (reply.action === 'block') notify('blocked-link', 'Ravenshelf blocked this link', reply.reason || 'It failed Ravenshelf’s safety checks.');
  else if (reply.action === 'browser') notify('left-link', 'Ravenshelf did not take this link', /^http:/i.test(url) ? 'It is not encrypted (HTTP), so Ravenshelf will not download it. Open it in your browser only if you trust the site.' : 'Open it in your browser instead.');
}

// ---- downloads ----
async function removeDownload(id) {
  let state = '';
  try { const [found] = await api.downloads.search({ id }); state = found ? found.state : ''; } catch (error) {}
  if (state === 'complete') await quiet(() => api.downloads.removeFile(id));
  else await quiet(() => api.downloads.cancel(id));
  await quiet(() => api.downloads.erase({ id }));
}
// 'stop' when Ravenshelf took or blocked the download; 'continue' leaves it to
// the browser (Ravenshelf closed, no answer, or it said the browser keeps it).
async function decide(item, plan) {
  if (plan.kind === 'block') {
    await removeDownload(item.id);
    notify(`blocked-download-${item.id}`, 'Ravenshelf blocked a download', plan.reason);
    return 'stop';
  }
  let reply = await ask(plan.message, 6000);
  if (!reply.ok && reply.error === 'invalid' && plan.message.mod) {
    // An older Ravenshelf does not know about mods, and any Ravenshelf refuses a
    // label it does not accept: the download is then sent without its label, so
    // a problem with the label never costs the check of the download.
    const { mod, ...plain } = plan.message;
    reply = await ask(plain, 6000);
  }
  if (reply.ok && (reply.action === 'take' || reply.action === 'block')) {
    await removeDownload(item.id);
    if (reply.action === 'block') notify(`blocked-download-${item.id}`, 'Ravenshelf blocked a download', reply.reason || 'It failed Ravenshelf’s safety checks.');
    return 'stop';
  }
  return 'continue';
}
// The browser's download, the switches, and what open Nexus Mods pages said.
async function planFor(item) {
  const [current] = await Promise.all([settings(), restore()]);
  const now = Date.now();
  return P.downloadPlan(item, current, { pages: modNotes(now), now });
}
if (api.downloads.onDeterminingFilename) {
  // Chrome holds the download here, before a file name is chosen.
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    let released = false;
    const release = () => { if (!released) { released = true; try { suggest(); } catch (error) {} } };
    planFor(item)
      .then(plan => plan.kind === 'ignore' ? 'continue' : decide(item, plan))
      .then(result => { if (result === 'continue') release(); }, release);
    return true;
  });
} else {
  // Firefox has no file-name hook: pause the new download while Ravenshelf decides.
  api.downloads.onCreated.addListener(item => {
    planFor(item).then(async plan => {
      if (plan.kind === 'ignore') return;
      await quiet(() => api.downloads.pause(item.id));
      if (await decide(item, plan) === 'continue') await quiet(() => api.downloads.resume(item.id));
    }).catch(() => {});
  });
}

// ---- right-click menu ----
async function createMenus() {
  if (!menus) return;
  await quiet(() => menus.removeAll());
  const done = () => { void api.runtime.lastError; };
  menus.create({ id: 'ravenshelf-link', title: 'Download with Ravenshelf', contexts: ['link'], targetUrlPatterns: ['https://*/*', 'http://*/*'] }, done);
  menus.create({ id: 'ravenshelf-page', title: 'Download this file with Ravenshelf', contexts: ['page'], documentUrlPatterns: P.SEND_PAGE_PATTERNS.slice() }, done);
  // On YouTube the video area opens YouTube's own menu first; right-click again for this one.
  menus.create({ id: 'ravenshelf-youtube', title: 'Download this video with Ravenshelf', contexts: ['page', 'video'], documentUrlPatterns: P.YOUTUBE_PAGE_PATTERNS.slice() }, done);
}
async function sendToApp(kind, url, pageUrl, incognito) {
  if (incognito) { notify('private', 'Private window', 'Ravenshelf does not take downloads from private windows.'); return { ok: false, error: 'private' }; }
  if (!isWeb(url) || url.length > 8192 || (kind === 'page' && !P.canSendPage(url))) return { ok: false, error: 'invalid' };
  const message = { type: 'send', kind, url };
  if (kind === 'link' && isWeb(pageUrl) && pageUrl.length <= 8192) message.pageUrl = pageUrl;
  const reply = await ask(message, 8000);
  report(reply, url);
  return reply;
}
// A YouTube video: only its canonical address and the quality choice are sent.
async function sendMedia(url, quality, incognito, announce) {
  let reply;
  if (incognito) reply = { ok: false, error: 'private' };
  else {
    const address = P.youtubeUrl(P.youtubeVideoId(url));
    reply = address && P.MEDIA_QUALITIES.includes(quality) ? await ask({ type: 'media', url: address, quality }, 8000) : { ok: false, error: 'invalid' };
  }
  // The player button shows its own message; right-click choices get a notification.
  if (announce) { const text = P.mediaReplyText(reply); notify('youtube', text.title, text.text, 3000); }
  return reply;
}
if (menus) menus.onClicked.addListener((info, tab) => {
  const incognito = Boolean(tab && tab.incognito);
  if (info.menuItemId === 'ravenshelf-youtube') { sendMedia(info.pageUrl, 'default', incognito, true).catch(() => {}); return; }
  const link = info.menuItemId === 'ravenshelf-link';
  if (!link && info.menuItemId !== 'ravenshelf-page') return;
  // A link to a YouTube video is downloaded as a video, not as a web page.
  if (link && P.youtubeVideoId(info.linkUrl)) { sendMedia(info.linkUrl, 'default', incognito, true).catch(() => {}); return; }
  sendToApp(link ? 'link' : 'page', link ? info.linkUrl : info.pageUrl, info.pageUrl, incognito).catch(() => {});
});

// ---- blocking rules ----
async function applyToggles() { await dnr.updateDynamicRules(P.toggleRules(await settings(), Date.now())); }
async function replaceThreatRules(rules) {
  try { await dnr.updateDynamicRules({ removeRuleIds: P.THREAT_RULE_IDS.slice(), addRules: rules }); return rules.length; } catch (error) {}
  // One rule the browser refuses must not cost every other list.
  await dnr.updateDynamicRules({ removeRuleIds: P.THREAT_RULE_IDS.slice() });
  let added = 0;
  for (const rule of rules) {
    try { await dnr.updateDynamicRules({ addRules: [rule] }); added++; } catch (error) {}
  }
  return added;
}
async function downloadRules() {
  const manifest = await ask({ type: 'threats' }, 10000);
  if (!manifest.ok || !manifest.manifest || !Array.isArray(manifest.manifest.rules)) return;
  const rules = [];
  for (const meta of manifest.manifest.rules.slice(0, 999)) {
    const part = await ask({ type: 'threatRule', id: meta.id }, 20000);
    if (!part.ok || !part.rule || part.rule.id !== meta.id) return; // try again next time; keep the current rules
    const rule = P.threatRule(part.rule);
    if (rule) rules.push(rule);
  }
  const added = await replaceThreatRules(rules);
  await api.storage.local.set({
    listVersion: added === rules.length ? String(manifest.manifest.version || '') : '',
    listTotal: Number(manifest.manifest.total) || 0, listSyncedAt: Date.now(), listFirstRule: rules.length ? rules[0].id : 0
  });
}
async function rulesMissing(current) {
  if (!current.listFirstRule) return false;
  try {
    const found = await dnr.getDynamicRules({ ruleIds: [current.listFirstRule] });
    return !found.some(rule => rule.id === current.listFirstRule);
  } catch (error) { return false; }
}
let syncing = null;
function syncProtection(force, known) {
  if (!syncing) syncing = (async () => {
    const current = await settings();
    const reply = known || await hello();
    const version = reply.ok && reply.protection && typeof reply.protection.version === 'string' ? reply.protection.version : '';
    if (version && (force || version !== current.listVersion || await rulesMissing(current))) await downloadRules();
    // Ravenshelf is still fetching its lists (first start): look again shortly.
    if (reply.ok && reply.protection && reply.protection.total === 0) api.alarms.create('ravenshelf-sync-soon', { delayInMinutes: 2 });
    await applyToggles();
  })().finally(() => { syncing = null; });
  return syncing;
}

// ---- pop-ups and redirects from file hosts ----
// Per tab: the host of the page on show, and its address when it is a file
// host (to return there after a redirect). Kept in session storage, which the
// browser holds in memory only and clears when it closes.
const tabInfo = new Map();
const watched = new Map();
const starts = new Map();
const handled = new Map();
const restoredAt = new Map();
const goingBack = new Map();
// The file-host page to return to from Ravenshelf's warning page, per tab.
const returnTo = new Map();
// What each open Nexus Mods tab last said about its game, mod and file.
const modPages = new Map();
const MAX_MOD_PAGES = 50;
// The notes that are still fresh. Older ones are dropped for good, so they
// cannot come back into use if the PC's clock is set back.
function modNotes(now) {
  let dropped = false;
  for (const [tab, page] of modPages) {
    if (page && Number.isFinite(page.at) && now - page.at >= 0 && now - page.at < P.NEXUS_PAGE_MS) continue;
    modPages.delete(tab); dropped = true;
  }
  if (dropped) persist();
  return Array.from(modPages.values());
}
const closing = new Set();
let restored = null;
function restore() {
  if (!restored) restored = (async () => {
    try {
      const saved = await api.storage.session.get(['tabInfo', 'watched', 'returnTo', 'modPages']);
      for (const [tab, info] of Object.entries(saved.tabInfo || {})) if (!tabInfo.has(Number(tab))) tabInfo.set(Number(tab), info);
      for (const [tab, watch] of Object.entries(saved.watched || {})) if (!watched.has(Number(tab))) watched.set(Number(tab), watch);
      for (const [tab, url] of Object.entries(saved.returnTo || {})) if (!returnTo.has(Number(tab))) returnTo.set(Number(tab), url);
      for (const [tab, page] of Object.entries(saved.modPages || {})) if (!modPages.has(Number(tab))) modPages.set(Number(tab), page);
    } catch (error) {}
  })();
  return restored;
}
let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    while (tabInfo.size > 300) tabInfo.delete(tabInfo.keys().next().value);
    // Over the limit, the oldest notes go first, whichever tab they belong to.
    const noted = tab => { const page = modPages.get(tab); return page && Number.isFinite(page.at) ? page.at : -Infinity; };
    while (modPages.size > MAX_MOD_PAGES) {
      let oldest;
      for (const tab of modPages.keys()) if (oldest === undefined || noted(tab) < noted(oldest)) oldest = tab;
      modPages.delete(oldest);
    }
    quiet(() => api.storage.session.set({ tabInfo: Object.fromEntries(tabInfo), watched: Object.fromEntries(watched), returnTo: Object.fromEntries(returnTo), modPages: Object.fromEntries(modPages) }));
  }, 100);
}
async function guardActive() { const current = await settings(); return current.guard !== false && !(current.pausedUntil > Date.now()); }
// One response per blocked address in a tab, however many events report it.
function claim(tabId, url) {
  const now = Date.now(), last = handled.get(tabId);
  if (last && last.url === url && now - last.at < HANDLED_MS) return false;
  handled.set(tabId, { url, at: now });
  return true;
}
async function closePopup(tabId, sourceHost, targetHost) {
  closing.add(tabId); watched.delete(tabId); persist();
  await quiet(() => api.tabs.remove(tabId));
  notify(`popup-${sourceHost}`, 'Ravenshelf closed a pop-up', `${sourceHost} tried to open ${targetHost || 'another page'}. File hosts use pop-ups for ads and fake downloads.`, 60000);
}
async function showBlocked(tabId, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, String(value).slice(0, 8192));
  await quiet(() => api.tabs.update(tabId, { url: api.runtime.getURL('blocked.html') + '#' + query.toString() }));
}
// A file-host page tried to send the tab elsewhere. Put the download page back;
// if it keeps redirecting, explain on Ravenshelf's own page instead.
async function stopRedirect(tabId, targetUrl, from, committed) {
  if (!claim(tabId, targetUrl)) return;
  const targetHost = P.hostOf(targetUrl);
  notify(`redirect-${targetHost}`, 'Ravenshelf stopped a redirect', `${from.host || 'A file-host page'} tried to send you to ${targetHost} instead of your download.`, 30000);
  const now = Date.now();
  if (from.url && P.protectedRoot(P.hostOf(from.url)) && now - (restoredAt.get(tabId) || 0) > RESTORE_GAP_MS) {
    restoredAt.set(tabId, now);
    await quiet(() => api.tabs.update(tabId, { url: from.url }));
    return;
  }
  const canReturn = Boolean(from.url && P.protectedRoot(P.hostOf(from.url)));
  if (canReturn) { returnTo.set(tabId, from.url); persist(); }
  await showBlocked(tabId, { reason: 'redirect', host: targetHost, from: from.host || '', back: canReturn ? '1' : '', url: targetUrl, committed: committed ? '1' : '' });
}
async function recentMatches(details) {
  try {
    const result = await dnr.getMatchedRules({ tabId: details.tabId, minTimeStamp: details.timeStamp - 3000 });
    return (result.rulesMatchedInfo || []).filter(info => info.rule && info.rule.rulesetId === dnr.DYNAMIC_RULESET_ID).sort((a, b) => b.timeStamp - a.timeStamp).map(info => info.rule.ruleId);
  } catch (error) { return null; }
}
// Why a page load failed, if one of Ravenshelf's rules stopped it.
async function blockReason(details, sourceHost) {
  const host = P.hostOf(details.url);
  let ours = null;
  if (!isFirefox) {
    if (!/ERR_BLOCKED_BY_CLIENT/.test(String(details.error))) return null;
    ours = await recentMatches(details);
    if (ours && ours.includes(P.RULE_IDS.guard)) return 'redirect';
  } else if (!/2147500036|NS_ERROR_ABORT|BLOCKED_BY/i.test(String(details.error))) {
    return null;
  }
  const reply = await ask({ type: 'lookup', host }, 5000);
  if (reply.ok && reply.listed && CATEGORY_TEXT[reply.listed.category]) return reply.listed.category;
  // Without a record of which rule matched, work it out the way the rules do.
  if ((isFirefox || ours === null) && P.protectedRoot(sourceHost) && !P.onHosts(host, P.PROTECTED_HOSTS) && await guardActive()) return 'redirect';
  if (!reply.ok && ours) return ours.map(P.ruleCategory).find(Boolean) || null;
  return null;
}
api.webNavigation.onCreatedNavigationTarget.addListener(details => {
  restore().then(async () => {
    if (!await guardActive()) return;
    const source = tabInfo.get(details.sourceTabId);
    const sourceHost = source ? source.host : '';
    const verdict = P.popupVerdict(sourceHost, details.url);
    if (verdict === 'close') await closePopup(details.tabId, sourceHost, P.hostOf(details.url));
    else if (verdict === 'watch') {
      watched.set(details.tabId, { sourceHost, until: Date.now() + POPUP_WATCH_MS });
      persist();
      // A blank pop-up that a page fills in itself never navigates anywhere;
      // if it has not gone to the host's own pages by now, close it.
      setTimeout(() => {
        const watch = watched.get(details.tabId);
        if (watch && watch.sourceHost === sourceHost && !closing.has(details.tabId)) closePopup(details.tabId, sourceHost, '').catch(() => {});
      }, BLANK_POPUP_MS);
    }
  }).catch(() => {});
});
api.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  if (isWeb(details.url) && P.protectedRoot(P.hostOf(details.url))) starts.set(details.tabId, details.url);
  else starts.delete(details.tabId);
  restore().then(async () => {
    const watch = watched.get(details.tabId);
    if (!watch) return;
    if (watch.until < Date.now()) { watched.delete(details.tabId); persist(); return; }
    const verdict = P.popupVerdict(watch.sourceHost, details.url);
    if (verdict === 'close' && await guardActive()) await closePopup(details.tabId, watch.sourceHost, P.hostOf(details.url));
    // Heading to the host's own pages or files (a download never loads as a page).
    else if (verdict === 'allow') { watched.delete(details.tabId); persist(); }
  }).catch(() => {});
});
api.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  restore().then(async () => {
    const tabId = details.tabId;
    // A tab that has left Nexus Mods has no mod page to remember.
    if (modPages.has(tabId) && P.hostOf(details.url) !== P.NEXUS_HOST) { modPages.delete(tabId); persist(); }
    if (closing.has(tabId)) return;
    const back = goingBack.get(tabId);
    if (back && back.until > Date.now() && back.url === details.url) { await quiet(() => api.tabs.goBack(tabId)); return; }
    if (back) goingBack.delete(tabId);
    const watch = watched.get(tabId);
    if (watch) {
      if (watch.until > Date.now() && P.popupVerdict(watch.sourceHost, details.url) === 'close' && await guardActive()) { await closePopup(tabId, watch.sourceHost, P.hostOf(details.url)); return; }
      if (!/^about:/i.test(details.url)) { watched.delete(tabId); persist(); }
    }
    const start = starts.get(tabId);
    starts.delete(tabId);
    if (!isWeb(details.url)) {
      if (!/^about:/i.test(details.url)) { tabInfo.set(tabId, { host: '', url: '' }); persist(); }
      return;
    }
    const host = P.hostOf(details.url);
    const previous = tabInfo.get(tabId) || { host: '', url: '' };
    const qualifiers = Array.isArray(details.transitionQualifiers) ? details.transitionQualifiers : [];
    if (!P.onHosts(host, P.PROTECTED_HOSTS) && await guardActive()) {
      // The redirect rule stops navigations a file-host page starts itself. These
      // got past it: one started by something inside the page (such as an ad
      // frame), or a server redirect from a file-host address.
      const fromPage = Boolean(P.protectedRoot(previous.host)) && details.transitionType === 'link' && !qualifiers.includes('forward_back') && !qualifiers.includes('from_address_bar');
      const fromStart = Boolean(start) && qualifiers.includes('server_redirect');
      if (fromPage || fromStart) { await stopRedirect(tabId, details.url, fromPage ? previous : { host: P.hostOf(start), url: '' }, true); return; }
    }
    // A page actually loaded, so a later block in this tab is a new event.
    handled.delete(tabId);
    if (returnTo.delete(tabId)) persist();
    tabInfo.set(tabId, { host, url: P.protectedRoot(host) ? details.url : '' });
    persist();
  }).catch(() => {});
});
api.webNavigation.onErrorOccurred.addListener(details => {
  if (details.frameId !== 0 || details.tabId < 0 || !isWeb(details.url)) return;
  restore().then(async () => {
    const tabId = details.tabId;
    if (closing.has(tabId)) return;
    const back = goingBack.get(tabId);
    if (back && back.until > Date.now() && back.url === details.url) { await quiet(() => api.tabs.goBack(tabId)); return; }
    const watch = watched.get(tabId);
    const previous = tabInfo.get(tabId) || { host: '', url: '' };
    const reason = await blockReason(details, watch ? watch.sourceHost : previous.host);
    if (!reason) return;
    if (reason === 'redirect') {
      if (watch) await closePopup(tabId, watch.sourceHost, P.hostOf(details.url));
      else await stopRedirect(tabId, details.url, previous, false);
      return;
    }
    if (!claim(tabId, details.url)) return;
    const host = P.hostOf(details.url);
    notify(`blocked-${host}`, 'Ravenshelf blocked a dangerous site', `${host} is on a list of ${CATEGORY_TEXT[reason]}.`, 30000);
    await showBlocked(tabId, { reason, host, url: details.url });
  }).catch(() => {});
});
api.tabs.onRemoved.addListener(tabId => {
  restore().then(() => {
    closing.delete(tabId); starts.delete(tabId); handled.delete(tabId); restoredAt.delete(tabId); goingBack.delete(tabId);
    if (tabInfo.delete(tabId) | watched.delete(tabId) | returnTo.delete(tabId) | modPages.delete(tabId)) persist();
  }).catch(() => {});
});

// ---- toolbar popup and warning page ----
async function popupState() {
  const current = await settings();
  return {
    version: VERSION, browser: BROWSER, status: current.status, appVersion: current.appVersion,
    capture: current.capture, protection: current.protection, guard: current.guard, youtube: current.youtube, nexus: current.nexus,
    pausedUntil: current.pausedUntil > Date.now() ? current.pausedUntil : 0, listTotal: current.listTotal, listSyncedAt: current.listSyncedAt
  };
}
function trustedSender(sender) { return Boolean(sender) && sender.id === api.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(api.runtime.getURL('')); }
async function handleMessage(message, sender) {
  const command = message && message.cmd;
  if (command === 'state') return { ok: true, state: await popupState() };
  if (command === 'status') {
    const reply = await hello();
    quiet(() => syncProtection(false, reply));
    return { ok: true, state: await popupState() };
  }
  if (command === 'set') {
    if (!['capture', 'protection', 'guard', 'youtube', 'nexus'].includes(message.key) || typeof message.value !== 'boolean') return { ok: false };
    await api.storage.local.set({ [message.key]: message.value });
    // Switching Nexus Mods labels off also forgets what its pages said.
    if (message.key === 'nexus' && !message.value) { await restore(); modPages.clear(); persist(); }
    await applyToggles();
    return { ok: true, state: await popupState() };
  }
  if (command === 'pause') {
    const until = Date.now() + PAUSE_MS;
    await api.storage.local.set({ pausedUntil: until });
    api.alarms.create('ravenshelf-resume', { when: until + 500 });
    await applyToggles();
    return { ok: true, state: await popupState() };
  }
  if (command === 'resume') {
    await api.storage.local.set({ pausedUntil: 0 });
    await quiet(() => api.alarms.clear('ravenshelf-resume'));
    await applyToggles();
    return { ok: true, state: await popupState() };
  }
  if (command === 'sendPage') return { ok: true, reply: await sendToApp('page', message.url, undefined, message.incognito === true) };
  const tabId = sender.tab && sender.tab.id >= 0 ? sender.tab.id : -1;
  if (command === 'back' && tabId >= 0) {
    if (isWeb(message.url)) goingBack.set(tabId, { url: message.url, until: Date.now() + BACK_MS });
    await quiet(() => api.tabs.goBack(tabId));
    return { ok: true };
  }
  if (command === 'closeTab' && tabId >= 0) { await quiet(() => api.tabs.remove(tabId)); return { ok: true }; }
  // Back to the file-host page the extension recorded for this tab; the warning
  // page cannot choose the address.
  if (command === 'return' && tabId >= 0) {
    await restore();
    const url = returnTo.get(tabId);
    if (!url || !/^https:\/\//i.test(url) || !P.protectedRoot(P.hostOf(url))) return { ok: false };
    returnTo.delete(tabId); persist();
    await quiet(() => api.tabs.update(tabId, { url }));
    return { ok: true };
  }
  return { ok: false };
}
// The player button on YouTube: Ravenshelf's own content script in the top
// frame of a www.youtube.com page, in a normal window, asking for one video.
function youtubeSender(sender) {
  return Boolean(sender) && sender.id === api.runtime.id && Boolean(sender.tab) && sender.frameId === 0 &&
    typeof sender.url === 'string' && /^https:\/\/www\.youtube\.com\//.test(sender.url);
}
async function handleYouTube(message, sender) {
  if (!message || message.cmd !== 'youtube' || !P.PLAYER_CHOICES.some(choice => choice.id === message.quality)) return { ok: false, error: 'invalid' };
  const url = P.youtubeVideoId(message.url) ? message.url : sender.url;
  return sendMedia(url, message.quality, Boolean(sender.tab.incognito), false);
}
// Ravenshelf's own page script in the top frame of a www.nexusmods.com page.
function nexusSender(sender) {
  return Boolean(sender) && sender.id === api.runtime.id && Boolean(sender.tab) && sender.frameId === 0 &&
    typeof sender.url === 'string' && /^https:\/\/www\.nexusmods\.com\//.test(sender.url);
}
// Remembers what a tab's Nexus Mods page said about its mod. Nothing leaves the
// browser here: the note is used only if you then start a download from Nexus
// Mods, and private windows are never noted.
async function handleNexus(message, sender) {
  if (!message || message.cmd !== 'nexus' || sender.tab.incognito || !Number.isInteger(sender.tab.id) || sender.tab.id < 0) return { ok: false };
  const [current] = await Promise.all([settings(), restore()]);
  if (current.nexus === false) return { ok: false };
  // The page is no longer a mod's page: forget what this tab said before.
  if (message.page === null) { if (modPages.delete(sender.tab.id)) persist(); return { ok: true }; }
  const page = P.nexusPage(message.page, P.nexusAddress(message.url) || P.nexusAddress(sender.url));
  if (!page) return { ok: false };
  modPages.delete(sender.tab.id);
  modPages.set(sender.tab.id, { ...page, at: Date.now() });
  persist();
  return { ok: true };
}
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (youtubeSender(sender) && !trustedSender(sender)) {
    handleYouTube(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (nexusSender(sender) && !trustedSender(sender)) {
    handleNexus(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (!trustedSender(sender)) return false;
  handleMessage(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});

// ---- lifecycle ----
async function setup() {
  await createMenus();
  api.alarms.create('ravenshelf-sync', { periodInMinutes: SYNC_MINUTES, delayInMinutes: 1 });
  if (typeof dnr.setExtensionActionOptions === 'function') await quiet(() => dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true }));
  await quiet(() => applyToggles());
  await quiet(() => syncProtection(false));
}
api.runtime.onInstalled.addListener(() => { setup().catch(() => {}); });
if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => { setup().catch(() => {}); });
api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'ravenshelf-sync' || alarm.name === 'ravenshelf-sync-soon') quiet(() => syncProtection(false));
  if (alarm.name === 'ravenshelf-resume') quiet(() => applyToggles());
});
