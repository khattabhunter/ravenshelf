'use strict';
// Ravenshelf's page script on fitgirl-repacks.site, in the top frame only.
// When you click a magnet link there, the link goes to Ravenshelf, which shows
// the torrent's files and waits for you to choose before anything downloads.
// Nothing else on the page is read or changed. When Ravenshelf's torrent
// downloads are off or it cannot be reached, the link opens as it would
// without the extension (in another torrent app, for example).
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const MAGNET = /^magnet:\?/i;
  let busy = false;
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const href = link ? String(link.getAttribute('href') || '').trim() : '';
    if (!MAGNET.test(href) || href.length > 8192) return;
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    busy = true;
    const openHere = () => { try { location.assign(href); } catch (error) { /* The browser decides. */ } };
    Promise.resolve(api.runtime.sendMessage({ cmd: 'magnet', magnet: href }))
      .then(reply => { if (!reply || reply.ok !== true || !['review', 'setup'].includes(reply.action)) openHere(); })
      .catch(openHere)
      .finally(() => { busy = false; });
  }, true);
})();
