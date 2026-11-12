// Ravenshelf on YouTube: a download button in the video player's controls,
// with a menu of qualities. It follows the player's own sizing in normal,
// theater and full-screen views. Choosing a quality sends the video's address
// to the Ravenshelf extension, which passes only the video ID on to the
// Ravenshelf app on this PC. This script never contacts the network itself and
// acts only on clicks and keys from you, not on events a page creates.
(function () {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const P = globalThis.RavenshelfPolicy;
  const T = globalThis.RavenshelfText;
  if (!P || !T || window.top !== window || location.hostname !== 'www.youtube.com') return;
  const SVG = 'http://www.w3.org/2000/svg';
  const LABEL = 'Download with Ravenshelf';
  const MIN_PLAYER_WIDTH = 480;
  const TOAST_MS = 4500;
  let enabled = true;
  let player = null;
  let button = null;
  let menu = null;
  let tip = null;
  let toast = null;
  let toastTimer = null;
  let sending = false;
  let resizeWatch = null;
  // Ravenshelf's own parts of the player speak the app's language. Only they
  // get its language and direction; YouTube's page is left as it is.
  let tr = T.create('en');
  function speak(node) { node.lang = tr.language; node.dir = tr.dir; return node; }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function icon() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of ['M12 4v10.5', 'M7.5 10 12 14.5 16.5 10', 'M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2']) {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', 'white');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.append(path);
    }
    return svg;
  }
  // Keeps clicks and keys inside Ravenshelf's controls away from YouTube's
  // own handlers (play/pause, shortcuts, full screen on double-click).
  function contain(node, types) {
    for (const type of types) node.addEventListener(type, event => event.stopPropagation());
  }
  function keyboardFocus(node) { try { return node.matches(':focus-visible'); } catch (error) { return true; } }
  function watchPage() { return location.pathname === '/watch' && Boolean(P.youtubeVideoId(location.href)); }
  function findPlayer() { return document.querySelector('ytd-watch-flexy #movie_player') || document.querySelector('#movie_player'); }

  // ---- the button ----
  function makeButton() {
    const node = make('button', 'ytp-button ravenshelf-ytp-button');
    node.type = 'button';
    node.setAttribute('aria-label', tr.t(LABEL));
    node.setAttribute('aria-haspopup', 'menu');
    node.setAttribute('aria-expanded', 'false');
    node.append(icon());
    contain(node, ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'keyup']);
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
    node.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted) return;
      if (menu && !menu.hidden) closeMenu(true); else openMenu();
    });
    node.addEventListener('mouseenter', showTip);
    // Keyboard focus shows the label too; focus that returns after a mouse click does not.
    node.addEventListener('focus', () => { if (keyboardFocus(node)) showTip(); });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('blur', hideTip);
    return node;
  }
  function placeButton() {
    const current = findPlayer();
    if (!enabled || !watchPage() || !current) { removeAll(); return; }
    if (current !== player) { removeAll(); player = current; watchSize(); }
    const controls = player.querySelector('.ytp-right-controls');
    if (!controls) return;
    // Newer players group their right-hand buttons; place Ravenshelf next to subtitles and settings.
    const group = controls.querySelector(':scope > .ytp-right-controls-left') || controls;
    if (!button) button = makeButton();
    if (button.parentNode !== group) {
      const anchor = group.querySelector(':scope > .ytp-subtitles-button') || group.querySelector(':scope > .ytp-settings-button') || group.firstElementChild;
      group.insertBefore(button, anchor || null);
    }
    sizeCheck();
  }
  // Too narrow a player (such as the miniplayer) leaves no room; right-click still works there.
  function sizeCheck() {
    if (!button || !player) return;
    const narrow = player.getBoundingClientRect().width < MIN_PLAYER_WIDTH;
    button.classList.toggle('ravenshelf-hidden', narrow);
    if (narrow) closeMenu(false);
    else if (menu && !menu.hidden) positionMenu();
  }
  function watchSize() {
    if (resizeWatch) resizeWatch.disconnect();
    resizeWatch = null;
    if (player && typeof ResizeObserver === 'function') {
      resizeWatch = new ResizeObserver(() => { sizeCheck(); hideTip(); });
      resizeWatch.observe(player);
    }
  }
  function removeAll() {
    closeMenu(false);
    hideTip();
    for (const node of [button, menu, tip, toast]) if (node) node.remove();
    button = menu = tip = toast = null;
    if (resizeWatch) resizeWatch.disconnect();
    resizeWatch = null;
    player = null;
  }

  // ---- tooltip ----
  function showTip() {
    if (!button || !player || (menu && !menu.hidden)) return;
    if (!tip) { tip = speak(make('div', 'ravenshelf-yt-tip', tr.t(LABEL))); tip.setAttribute('role', 'tooltip'); }
    if (tip.parentNode !== player) player.append(tip);
    const area = player.getBoundingClientRect(), target = button.getBoundingClientRect();
    tip.hidden = false;
    const width = tip.offsetWidth;
    const left = Math.min(Math.max(8, target.left - area.left + target.width / 2 - width / 2), Math.max(8, area.width - width - 8));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.bottom = `${Math.round(area.bottom - target.top + 10)}px`;
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // ---- the quality menu ----
  function buildMenu() {
    const node = speak(make('div', 'ravenshelf-yt-menu'));
    node.setAttribute('role', 'menu');
    node.setAttribute('aria-label', tr.t(LABEL));
    node.hidden = true;
    const head = make('div', 'ravenshelf-yt-head');
    head.append(make('span', 'ravenshelf-yt-mark', 'R'), make('span', 'ravenshelf-yt-title', tr.t(LABEL)));
    node.append(head);
    for (const [group, title] of [['video', 'Video'], ['audio', 'Audio only']]) {
      node.append(make('div', 'ravenshelf-yt-section', tr.t(title)));
      for (const choice of P.PLAYER_CHOICES.filter(item => item.group === group)) {
        const item = make('button', 'ravenshelf-yt-item');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.dataset.quality = choice.id;
        item.append(make('span', 'ravenshelf-yt-label', tr.t(choice.label)), make('span', 'ravenshelf-yt-hint', tr.t(choice.hint)));
        item.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (!event.isTrusted) return;
          choose(choice.id);
        });
        node.append(item);
      }
    }
    node.append(make('div', 'ravenshelf-yt-foot', tr.t('Saved to Ravenshelf › YouTube')));
    contain(node, ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'keyup', 'wheel', 'contextmenu']);
    node.addEventListener('keydown', event => {
      event.stopPropagation();
      const items = [...node.querySelectorAll('.ravenshelf-yt-item')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
      else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
      else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
      else if (event.key === 'Tab') closeMenu(false);
    });
    return node;
  }
  function positionMenu() {
    if (!menu || !button || !player) return;
    const area = player.getBoundingClientRect(), target = button.getBoundingClientRect();
    const bottom = Math.max(8, area.bottom - target.top + 8);
    menu.style.maxHeight = `${Math.max(120, Math.round(area.height - bottom - 8))}px`;
    menu.style.bottom = `${Math.round(bottom)}px`;
    const width = menu.offsetWidth, right = area.right - target.right;
    if (width + right + 8 > area.width) { menu.style.right = ''; menu.style.left = '8px'; }
    else { menu.style.left = ''; menu.style.right = `${Math.round(Math.max(8, right))}px`; }
  }
  function openMenu() {
    if (!button || !player) return;
    hideTip();
    if (!menu) menu = buildMenu();
    if (menu.parentNode !== player) player.append(menu);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionMenu();
    const first = menu.querySelector('.ravenshelf-yt-item');
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu(returnFocus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus) button.focus({ preventScroll: true });
    }
  }
  document.addEventListener('pointerdown', event => {
    if (menu && !menu.hidden && event.isTrusted && !menu.contains(event.target) && !(button && button.contains(event.target))) closeMenu(false);
  }, true);

  // ---- sending a video ----
  function showToast(text, tone) {
    if (!player) return;
    if (!toast) { toast = make('div', 'ravenshelf-yt-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); }
    if (toast.parentNode !== player) player.append(toast);
    speak(toast);
    toast.textContent = tr.t(text);
    toast.className = `ravenshelf-yt-toast ${tone || ''} ravenshelf-visible`.trim();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toast) toast.classList.remove('ravenshelf-visible'); }, TOAST_MS);
  }
  async function choose(quality) {
    closeMenu(true);
    if (sending) return;
    sending = true;
    showToast('Sending to Ravenshelf…', 'busy');
    let reply;
    try { reply = await api.runtime.sendMessage({ cmd: 'youtube', quality, url: location.href }); }
    catch (error) { reply = null; }
    finally { sending = false; }
    if (!reply) { showToast('Reload this page to use the Ravenshelf button again.', 'error'); return; }
    const text = P.mediaReplyText(reply);
    showToast(text.text, text.tone);
  }

  // ---- keeping up with YouTube's page changes ----
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; try { placeButton(); } catch (error) { /* try again on the next change */ } });
  }
  document.addEventListener('yt-navigate-finish', schedule);
  document.addEventListener('yt-page-data-updated', schedule);
  document.addEventListener('fullscreenchange', () => { closeMenu(false); hideTip(); schedule(); });
  window.addEventListener('popstate', schedule);
  // YouTube rebuilds parts of the player while it plays (ads, chapters); a
  // light check every second and a half puts the button back if it goes.
  setInterval(() => { if (document.visibilityState === 'visible' && (!button || !button.isConnected || !watchPage())) schedule(); }, 1500);
  // A new language: the menu and tooltip are made again when next shown.
  function setLanguage(saved) {
    tr = T.create(T.pick(saved && saved.appLanguage, api.i18n && api.i18n.getUILanguage ? api.i18n.getUILanguage() : ''), saved && saved.appDigits);
    closeMenu(false); hideTip();
    if (menu) { menu.remove(); menu = null; }
    if (tip) { tip.remove(); tip = null; }
    if (button) button.setAttribute('aria-label', tr.t(LABEL));
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.youtube) { enabled = changes.youtube.newValue !== false; schedule(); }
    if (area === 'local' && (changes.appLanguage || changes.appDigits)) Promise.resolve(api.storage.local.get(['appLanguage', 'appDigits'])).then(setLanguage, () => {});
  });
  Promise.resolve(api.storage.local.get({ youtube: true, appLanguage: '', appDigits: '' }))
    .then(saved => { enabled = !saved || saved.youtube !== false; setLanguage(saved); }, () => {})
    .then(schedule);
})();
