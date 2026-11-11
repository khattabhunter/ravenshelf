// Ravenshelf on Nexus Mods: notes which game, mod and file the page you have
// open is about, so a file you download from it can be saved in that game's
// Mods folder in Ravenshelf. It only reads the page: it adds nothing to it,
// presses nothing on it, and never contacts the network. What it reads goes to
// the Ravenshelf extension, which passes it to the Ravenshelf app on this PC
// only together with a download that you start yourself.
(function () {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const P = globalThis.RavenshelfPolicy;
  if (!P || window.top !== window || location.hostname !== P.NEXUS_HOST) return;
  // Private windows are never noted, so nothing is read in one.
  if (api.extension && api.extension.inIncognitoContext) return;
  const WAIT_MS = 300;
  const LOOK_MS = 2000;
  // Your own click or key press sends unchanged details again at most this often, to keep them fresh.
  const REFRESH_MS = 20000;
  // A report the extension did not take is tried again after this long.
  const RETRY_MS = 10000;
  let enabled = true;
  let timer = null;
  let looking = null;
  // What the extension last took, and when.
  let sent = '';
  let sentAt = 0;
  let refusedAt = 0;
  let waiting = false;

  function attribute(node, name) {
    const value = node && typeof node.getAttribute === 'function' ? node.getAttribute(name) : '';
    return typeof value === 'string' ? value.slice(0, 600) : '';
  }
  function meta(name) { return attribute(document.querySelector(`meta[property="${name}"]`), 'content'); }
  // What the page shows about its game, its mod and the files on offer.
  function read() {
    const section = document.querySelector('#section[data-game-id]');
    const boxes = Array.from(document.querySelectorAll('mod-file-download')).slice(0, P.NEXUS_MAX_FILES);
    const site = meta('og:site_name');
    return {
      gameId: attribute(section, 'data-game-id') || attribute(boxes[0], 'game-id'),
      gameName: attribute(boxes[0], 'game-name') || (site.includes('::') ? site.slice(site.lastIndexOf('::') + 2).trim() : ''),
      // Which mod the page itself says it is about, to compare with its address.
      modId: attribute(section, 'data-mod-id'),
      canonical: meta('og:url'),
      modName: meta('og:title'),
      files: boxes.map(box => ({ fileId: attribute(box, 'file-id'), fileName: attribute(box, 'filename'), fileUri: attribute(box, 'file-uri') }))
    };
  }
  // After the extension is reloaded this page's copy can no longer reach it;
  // reloading the page reconnects.
  function connected() { try { return Boolean(api.runtime && api.runtime.id); } catch (error) { return false; } }
  function stop() {
    enabled = false;
    if (looking !== null) clearInterval(looking);
    looking = null;
  }
  function report() {
    timer = null;
    // A page the browser loads ahead of time is not reported until it is shown.
    if (!enabled || waiting || document.prerendering) return;
    if (!connected()) { stop(); return; }
    const address = P.nexusAddress(location.href);
    const details = address ? read() : null;
    const page = address ? P.nexusPage(details, address) : null;
    const summary = page ? JSON.stringify(page) : 'none';
    if (summary === sent || Date.now() - refusedAt < RETRY_MS) return;
    // Only the part of the address that names the mod and the file is passed
    // on. On a page that is not a mod's page, the extension is told to forget
    // what this tab showed before.
    const message = page
      ? { cmd: 'nexus', url: `https://${P.NEXUS_HOST}/${address.game}/mods/${address.modId}${address.fileId ? `?file_id=${address.fileId}` : ''}`, page: details }
      : { cmd: 'nexus', page: null };
    // The details count as sent only once the extension says it took them.
    const settle = reply => {
      waiting = false;
      if (reply && reply.ok === true) { sent = summary; sentAt = Date.now(); refusedAt = 0; }
      else refusedAt = Date.now();
    };
    waiting = true;
    try { Promise.resolve(api.runtime.sendMessage(message)).then(settle, () => settle(null)); } catch (error) { settle(null); }
  }
  function schedule() { if (enabled && timer === null) timer = setTimeout(report, WAIT_MS); }
  // Something you did (the site's download button, for example): send the
  // details again if they have not been sent for a while. Clicks and key
  // presses that a page makes up itself are ignored.
  function refresh(event) {
    if (!event.isTrusted || Date.now() - sentAt < REFRESH_MS) return;
    sent = '';
    schedule();
  }

  // Nexus Mods changes pages without reloading them, and fills in the file box
  // after the page appears, so the page is read again every two seconds while
  // you are looking at it. Nothing is sent unless what it shows has changed.
  looking = setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, LOOK_MS);
  document.addEventListener('visibilitychange', event => { if (event.isTrusted && document.visibilityState === 'visible') schedule(); });
  // A page the browser shows again from its back-and-forward store, or one it
  // loaded ahead of time and now shows, is reported afresh.
  window.addEventListener('pageshow', event => { if (event.isTrusted && event.persisted) { sent = ''; refusedAt = 0; schedule(); } });
  document.addEventListener('prerenderingchange', event => { if (event.isTrusted) { refusedAt = 0; schedule(); } });
  document.addEventListener('pointerdown', refresh, { capture: true, passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') refresh(event); }, { capture: true, passive: true });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.nexus) return;
    enabled = changes.nexus.newValue !== false;
    sent = ''; refusedAt = 0;
    if (enabled) schedule();
  });
  Promise.resolve(api.storage.local.get({ nexus: true }))
    .then(saved => { enabled = !saved || saved.nexus !== false; }, () => {})
    .then(schedule);
})();
