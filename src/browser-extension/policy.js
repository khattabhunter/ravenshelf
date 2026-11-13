// Ravenshelf extension decisions. Pure functions with no browser calls, shared
// by the background script and Ravenshelf's own tests.
(function (root) {
  'use strict';
  const HOST_NAME = 'io.github.khattabhunter.ravenshelf';
  // Pop-ups and redirects started by these pages to any other site are stopped.
  const PROTECTED_HOSTS = Object.freeze(['fuckingfast.co', 'fuckingfast.net', 'filekeeper.net']);
  // Pages Ravenshelf can resolve itself, without the page's scripts or ads.
  const SEND_PAGE_HOSTS = Object.freeze(['fuckingfast.co', 'fuckingfast.net', 'filekeeper.net', 'datanodes.to', 'datanodes.in', 'datanodes.com']);
  const SEND_PAGE_PATTERNS = Object.freeze(SEND_PAGE_HOSTS.flatMap(host => [`https://${host}/*`, `https://*.${host}/*`]));
  const THREAT_RESOURCE_TYPES = Object.freeze(['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'object', 'media', 'image', 'stylesheet', 'font', 'ping', 'other']);
  const RULE_IDS = Object.freeze({ guard: 1000, allowAll: 1001 });
  const THREAT_RULE_IDS = Object.freeze(Array.from({ length: 999 }, (_, index) => index + 1));
  const CATEGORIES = Object.freeze([
    { id: 'malware', from: 1, to: 99 }, { id: 'phishing', from: 100, to: 199 },
    { id: 'threats', from: 200, to: 499 }, { id: 'popups', from: 500, to: 699 }
  ]);
  const LOCAL_DANGEROUS = new Set(['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'com', 'scr', 'pif', 'cpl', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'url', 'scf', 'reg', 'inf', 'msc', 'iso', 'img', 'vhd', 'vhdx']);
  const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
  const MAX_URL = 8192;
  // YouTube videos go to Ravenshelf by video ID only, in the canonical form.
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = Object.freeze(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
  // Right-click "Download this video" appears on these pages.
  const YOUTUBE_PAGE_PATTERNS = Object.freeze(['https://www.youtube.com/watch*', 'https://www.youtube.com/shorts/*', 'https://m.youtube.com/watch*', 'https://m.youtube.com/shorts/*']);
  // Choices in the player button's menu; "default" (right-click) uses the app's setting.
  const PLAYER_CHOICES = Object.freeze([
    Object.freeze({ id: 'best', label: 'Best quality', hint: 'Up to 4K', group: 'video' }),
    Object.freeze({ id: '1080', label: '1080p', hint: 'Full HD', group: 'video' }),
    Object.freeze({ id: '720', label: '720p', hint: 'HD', group: 'video' }),
    Object.freeze({ id: '480', label: '480p', hint: 'Smaller file', group: 'video' }),
    Object.freeze({ id: 'audio-m4a', label: 'M4A', hint: 'Original audio', group: 'audio' }),
    Object.freeze({ id: 'audio-mp3', label: 'MP3', hint: 'Plays everywhere', group: 'audio' })
  ]);
  const MEDIA_QUALITIES = Object.freeze(['default', ...PLAYER_CHOICES.map(choice => choice.id)]);
  // Nexus Mods: the site's pages, and the servers its files come from.
  const NEXUS_HOST = 'www.nexusmods.com';
  const NEXUS_FILE_ROOTS = Object.freeze(['nexus-cdn.com']);
  // How long what a Nexus Mods page showed can label a download started there.
  const NEXUS_PAGE_MS = 30 * 60 * 1000;
  const NEXUS_MAX_ID = 2147483647;
  const NEXUS_MAX_FILES = 20;

  function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (error) { return ''; } }
  function onHosts(host, roots) { return Boolean(host) && roots.some(rootHost => host === rootHost || host.endsWith('.' + rootHost)); }
  function protectedRoot(host) { return PROTECTED_HOSTS.find(rootHost => host === rootHost || host.endsWith('.' + rootHost)) || null; }
  function baseName(value) {
    const name = String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
    return name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240);
  }
  function extensionOf(name) { const match = /\.([a-z0-9-]{1,24})$/i.exec(String(name || '').trim().replace(/[. ]+$/, '')); return match ? match[1].toLowerCase() : ''; }
  function schemeOf(url) { try { return new URL(url).protocol; } catch (error) { return ''; } }
  // Page context is never a download URL: send only its public origin to the
  // app, without page paths, query tokens, fragments or credentials.
  function contextOrigin(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_URL || /[\x00-\x20\x7f]/.test(value)) return undefined;
    let url; try { url = new URL(value); } catch (error) { return undefined; }
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || host.endsWith('.') ||
      host.includes(':') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|localdomain|internal|lan)$/.test(host) || host === 'home.arpa' || host.endsWith('.home.arpa')) return undefined;
    return url.origin + '/';
  }
  function publicDownloadAddress(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_URL || /[\x00-\x1f\x7f]/.test(value)) return false;
    // URL parsing encodes ordinary spaces in names. Keep the same credential,
    // scheme and local-address exclusions as page context without rejecting a
    // legitimate filename containing spaces.
    try { return Boolean(contextOrigin(new URL(value).href)); } catch (error) { return false; }
  }

  // What to do with a download the browser is starting, before asking the app.
  // `context` holds what open Nexus Mods pages reported ({ pages, now }), so a
  // mod file can be labelled with its game and mod.
  function downloadPlan(item, settings, context) {
    if (!settings || settings.capture === false || !item || typeof item !== 'object') return { kind: 'ignore' };
    if (item.byExtensionId) return { kind: 'ignore' };
    if (item.incognito) return { kind: 'ignore' };
    const url = typeof item.url === 'string' ? item.url : '';
    const finalUrl = typeof item.finalUrl === 'string' && item.finalUrl !== url ? item.finalUrl : '';
    const scheme = schemeOf(finalUrl || url);
    const filename = baseName(item.filename);
    if (scheme === 'blob:' || scheme === 'data:') {
      // A web page built this file itself, so Ravenshelf cannot fetch it again.
      // The reason is English; template and params let it be shown in the app's language.
      if (LOCAL_DANGEROUS.has(extensionOf(filename))) return filename
        ? { kind: 'block', reason: `Ravenshelf stopped ${filename} that a web page created for download. Programs made this way are a common malware trick.`, template: 'Ravenshelf stopped {name} that a web page created for download. Programs made this way are a common malware trick.', params: { name: filename } }
        : { kind: 'block', reason: 'Ravenshelf stopped a program that a web page created for download. Programs made this way are a common malware trick.', template: 'Ravenshelf stopped a program that a web page created for download. Programs made this way are a common malware trick.' };
      return { kind: 'ignore' };
    }
    if (!['http:', 'https:'].includes(schemeOf(url)) || url.length > MAX_URL || (finalUrl && (finalUrl.length > MAX_URL || !['http:', 'https:'].includes(scheme)))) return { kind: 'ignore' };
    // Private/local addresses and URL credentials never leave the browser.
    // The app still validates DNS and every redirect before fetching a file.
    if (!publicDownloadAddress(url) || finalUrl && !publicDownloadAddress(finalUrl)) return { kind: 'ignore' };
    const size = Number.isSafeInteger(item.totalBytes) && item.totalBytes > 0 ? item.totalBytes : Number.isSafeInteger(item.fileSize) && item.fileSize > 0 ? item.fileSize : undefined;
    const referrer = typeof item.referrer === 'string' && ['http:', 'https:'].includes(schemeOf(item.referrer)) && item.referrer.length <= MAX_URL ? item.referrer : undefined;
    const message = { type: 'capture', url, incognito: false };
    if (finalUrl) message.finalUrl = finalUrl;
    const contextReferrer = contextOrigin(referrer);
    if (contextReferrer) message.referrer = contextReferrer;
    if (filename && filename.length <= 1024) message.filename = filename;
    if (typeof item.mime === 'string' && item.mime && item.mime.length <= 200 && !/[\x00-\x1f\x7f]/.test(item.mime)) message.mime = item.mime;
    if (size) message.totalBytes = size;
    if (settings.nexus !== false && context && Array.isArray(context.pages)) {
      // The label is an extra: whatever goes wrong with it, the download is still sent to be checked.
      let mod = null;
      try { mod = nexusMatch({ url, finalUrl, referrer, filename }, context.pages, Number(context.now) || 0); } catch (error) { mod = null; }
      if (mod) message.mod = mod;
    }
    return { kind: 'ask', message };
  }

  // ---- Nexus Mods ----
  // A positive whole number such as a mod or file number, or undefined.
  function nexusId(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number >= 1 && number <= NEXUS_MAX_ID ? number : undefined;
  }
  // Text a page showed, made safe to pass on: control characters, invisible,
  // blank and text-direction characters, private-use and unassigned characters
  // and broken character pairs removed, spaces collapsed, length limited
  // without cutting a character in half. Accents and other marks that sit on
  // the letter before them are kept, but no more than three in a row, and none
  // at the very start, where one would sit on whatever stands in front of the
  // name. Empty gives undefined. The app refuses what is removed here
  // (src/mods.cjs).
  function nexusText(value, max) {
    if (typeof value !== 'string') return undefined;
    const text = value.slice(0, 4000)
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\ufffc\ufffd]/gu, ' ')
      .replace(/(\p{M}{3})\p{M}+/gu, '$1')
      .replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\ud800-\udbff]$/, '').trim()
      .replace(/^[\p{M} ]+/u, '');
    return text || undefined;
  }
  // The game and mod a Nexus Mods address is about: /{game}/mods/{number},
  // with the file number when the address names one.
  function nexusAddress(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_URL) return null;
    let url;
    try { url = new URL(value); } catch (error) { return null; }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== NEXUS_HOST || url.username || url.password || url.port) return null;
    const match = /^\/(?:games\/)?([a-z0-9][a-z0-9_-]{0,63})\/mods\/(\d{1,10})\/?$/i.exec(url.pathname);
    const modId = match ? nexusId(match[2]) : undefined;
    if (!modId) return null;
    const address = { game: match[1].toLowerCase(), modId };
    const fileId = nexusId(url.searchParams.get('file_id'));
    if (fileId) address.fileId = fileId;
    return address;
  }
  // File names are compared without case or punctuation.
  function nexusKey(name) {
    return baseName(name).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 300);
  }
  // The same, without the " (1)" or "(1)" a browser adds to a second copy of a
  // file. Tried only when the name as it stands matches nothing.
  function nexusLooseKey(name) {
    return nexusKey(baseName(name).normalize('NFKC').replace(/ ?\(\d{1,3}\)(?=(?:\.[a-z0-9]{1,8}){0,2}$)/i, ''));
  }
  // What a Nexus Mods page said about itself, cleaned. Which game and mod the
  // page is about comes from its address, not from anything on the page. The
  // names and files it shows are left out while the page itself says it is a
  // different mod's page: the site can change its address a moment before it
  // changes what it shows.
  function nexusPage(details, address) {
    if (!address || !address.game || !address.modId || !details || typeof details !== 'object') return null;
    const page = { game: address.game, modId: address.modId, files: [] };
    const shown = nexusId(details.modId), canonical = nexusAddress(details.canonical);
    if ((shown && shown !== address.modId) || (canonical && (canonical.modId !== address.modId || canonical.game !== address.game))) return page;
    const gameId = nexusId(details.gameId);
    if (gameId) page.gameId = gameId;
    const gameName = nexusText(details.gameName, 100);
    if (gameName) page.gameName = gameName;
    const modName = nexusText(details.modName, 200);
    if (modName) page.modName = modName;
    for (const item of Array.isArray(details.files) ? details.files.slice(0, NEXUS_MAX_FILES) : []) {
      if (!item || typeof item !== 'object') continue;
      const fileId = nexusId(item.fileId), key = nexusKey(nexusText(item.fileUri, 300) || '');
      if (!fileId || !key) continue;
      const file = { fileId, key };
      const fileName = nexusText(item.fileName, 200);
      if (fileName) file.fileName = fileName;
      page.files.push(file);
    }
    return page;
  }
  function nexusMod(page, file) {
    const mod = { site: 'nexusmods', game: page.game, modId: page.modId };
    if (page.gameId) mod.gameId = page.gameId;
    if (file && file.fileId) mod.fileId = file.fileId;
    if (page.gameName) mod.gameName = page.gameName;
    if (page.modName) mod.modName = page.modName;
    if (file && file.fileName) mod.fileName = file.fileName;
    return mod;
  }
  // Whether a download can be a Nexus Mods file at all. It is fetched from one
  // of the site's file servers, and the address the browser first asked for is
  // Nexus Mods' too: a file server, or the site itself. A download that began
  // somewhere else and only ended up on a file server is not the site's own.
  // The app checks the same (src/mods.cjs).
  function nexusFile(item) {
    if (!item || typeof item !== 'object') return false;
    const target = typeof item.finalUrl === 'string' && item.finalUrl ? item.finalUrl : item.url;
    if (schemeOf(target) !== 'https:' || !onHosts(hostOf(target), NEXUS_FILE_ROOTS)) return false;
    return schemeOf(item.url) === 'https:' && (onHosts(hostOf(item.url), NEXUS_FILE_ROOTS) || hostOf(item.url) === NEXUS_HOST);
  }
  // Which mod a browser download belongs to, or null. Only a file that comes
  // from Nexus Mods' own file servers can be labelled: a page on the site can
  // link to files kept anywhere, and a download that began on another site is
  // not the site's own either. Then the evidence is, in this order: the
  // file's name is one a Nexus Mods page showed in the last half hour; the
  // download was started from a mod's own address; or the file's address
  // carries the game and mod numbers of such a page. Evidence that points at
  // more than one mod gives no label.
  function nexusMatch(item, pages, now) {
    if (!nexusFile(item) || !Array.isArray(pages)) return null;
    const target = typeof item.finalUrl === 'string' && item.finalUrl ? item.finalUrl : item.url;
    const recent = pages.filter(page => page && typeof page === 'object' && page.game && page.modId && Array.isArray(page.files) && Number.isFinite(page.at) && now - page.at >= 0 && now - page.at < NEXUS_PAGE_MS).sort((a, b) => b.at - a.at);
    const sameMod = (a, b) => a.game === b.game && a.modId === b.modId;
    // Older files sit at /{game number}/{mod number}/{file name} on the file servers.
    let numbers = null;
    try {
      const path = /^\/(\d{1,10})\/(\d{1,10})\/[^/]+$/.exec(new URL(target).pathname);
      const gameId = path ? nexusId(path[1]) : undefined, modId = path ? nexusId(path[2]) : undefined;
      if (gameId && modId) numbers = { gameId, modId };
    } catch (error) { numbers = null; }
    // A page whose numbers differ from the ones in the file's address is about another mod.
    const agrees = page => !numbers || (page.modId === numbers.modId && (!page.gameId || page.gameId === numbers.gameId));
    // The page that started the download names the mod, when the browser passes its full address on.
    const address = nexusAddress(typeof item.referrer === 'string' ? item.referrer : '');
    if (address && numbers && address.modId !== numbers.modId) return null;
    const fileIn = (page, key) => key ? page.files.find(candidate => candidate && candidate.key === key) : undefined;
    for (const key of [nexusKey(item.filename), nexusLooseKey(item.filename)]) {
      const listed = recent.filter(page => agrees(page) && fileIn(page, key));
      if (!listed.length) continue;
      const chosen = address ? listed.filter(page => sameMod(page, address)) : listed;
      // The same file name on pages of different mods says nothing about which one this is.
      if (!chosen.length || !chosen.every(page => sameMod(page, chosen[0]))) return null;
      return nexusMod(chosen[0], fileIn(chosen[0], key));
    }
    if (address) {
      const same = recent.filter(page => sameMod(page, address));
      // A note of that very page whose game number is not the one in the file's
      // address: the file belongs to another game's mod of the same number.
      if (!same.every(agrees)) return null;
      const file = address.fileId && same.length ? same[0].files.find(candidate => candidate && candidate.fileId === address.fileId) : null;
      return nexusMod(same[0] || address, file || address);
    }
    if (numbers) {
      // The numbers name the mod. They do not say which of its files this is.
      const page = recent.find(candidate => candidate.gameId === numbers.gameId && candidate.modId === numbers.modId);
      if (page) return nexusMod(page, null);
    }
    return null;
  }

  function threatRule(rule) {
    if (!rule || !Number.isSafeInteger(rule.id) || rule.id < 1 || rule.id > 999 || !Array.isArray(rule.domains)) return null;
    const domains = rule.domains.filter(domain => typeof domain === 'string' && DOMAIN.test(domain));
    if (!domains.length) return null;
    return { id: rule.id, priority: 1, action: { type: 'block' }, condition: { requestDomains: domains, resourceTypes: THREAT_RESOURCE_TYPES.slice() } };
  }
  // Blocks only page-started navigations from protected hosts to other sites.
  // Addresses you type or open from bookmarks have no initiator, so they pass.
  function guardRule() {
    return { id: RULE_IDS.guard, priority: 3, action: { type: 'block' }, condition: { initiatorDomains: PROTECTED_HOSTS.slice(), excludedRequestDomains: PROTECTED_HOSTS.slice(), resourceTypes: ['main_frame'] } };
  }
  // While protection lists are off or paused this outranks the list rules
  // (priority 1) but not the redirect guard (priority 3).
  function allowAllRule() {
    return { id: RULE_IDS.allowAll, priority: 2, action: { type: 'allow' }, condition: { resourceTypes: THREAT_RESOURCE_TYPES.slice() } };
  }
  function ruleCategory(id) { const match = CATEGORIES.find(category => id >= category.from && id <= category.to); return match ? match.id : null; }
  function toggleRules(settings, now) {
    const paused = Number(settings && settings.pausedUntil) > now;
    const addRules = [];
    if (settings.guard !== false && !paused) addRules.push(guardRule());
    if (settings.protection === false || paused) addRules.push(allowAllRule());
    return { removeRuleIds: [RULE_IDS.guard, RULE_IDS.allowAll], addRules };
  }
  // A new tab opened by a protected page: close it if it goes to another site.
  function popupVerdict(sourceHost, targetUrl) {
    if (!protectedRoot(sourceHost)) return 'allow';
    if (!targetUrl || targetUrl === 'about:blank') return 'watch';
    const scheme = schemeOf(targetUrl);
    if (!['http:', 'https:'].includes(scheme)) return scheme === 'about:' ? 'watch' : 'close';
    return onHosts(hostOf(targetUrl), PROTECTED_HOSTS) ? 'allow' : 'close';
  }
  function canSendPage(url) { return schemeOf(url) === 'https:' && onHosts(hostOf(url), SEND_PAGE_HOSTS); }
  function youtubeVideoId(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_URL) return null;
    let url;
    try { url = new URL(value); } catch (error) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') { const match = /^\/([^/]+)\/?$/.exec(url.pathname); id = match ? match[1] : null; }
    else if (YOUTUBE_HOSTS.includes(host)) {
      if (url.pathname === '/watch' || url.pathname === '/watch/') id = url.searchParams.get('v');
      else { const match = /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname); id = match ? match[1] : null; }
    }
    return typeof id === 'string' && VIDEO_ID.test(id) ? id : null;
  }
  function youtubeUrl(id) { return VIDEO_ID.test(String(id)) ? 'https://www.youtube.com/watch?v=' + id : null; }
  // What to tell the user about Ravenshelf's answer to a YouTube video.
  function mediaReplyText(reply) {
    if (reply && reply.ok) {
      if (reply.action === 'queued') return { tone: 'ok', title: 'Downloading in Ravenshelf', text: 'Added to Ravenshelf. It is downloading now.' };
      if (reply.action === 'duplicate') return { tone: 'ok', title: 'Already in Ravenshelf', text: 'This video is already in your Ravenshelf downloads.' };
      if (reply.action === 'setup') return { tone: 'warn', title: 'Set up YouTube downloads', text: 'Finish the one-time setup in Ravenshelf. This video starts after that.' };
      if (reply.action === 'busy') return { tone: 'warn', title: 'Ravenshelf is busy', text: 'Ravenshelf cannot take more YouTube videos right now. Try again after some finish.' };
    }
    const error = reply && reply.error;
    if (error === 'not-running') return { tone: 'error', title: 'Ravenshelf is closed', text: 'Open Ravenshelf, then try again.' };
    if (error === 'not-installed') return { tone: 'error', title: 'Not connected yet', text: 'In Ravenshelf, open Settings › Browser extension and turn on “Connect the browser extension”.' };
    if (error === 'not-allowed') return { tone: 'error', title: 'This copy is not connected', text: 'Load the extension folder that Ravenshelf created, from Settings › Browser extension.' };
    if (error === 'private') return { tone: 'error', title: 'Private window', text: 'Ravenshelf does not take downloads from private windows.' };
    if (error === 'busy') return { tone: 'warn', title: 'Ravenshelf is busy', text: 'Try again in a moment.' };
    if (error === 'invalid') return { tone: 'error', title: 'Not a YouTube video', text: 'Ravenshelf can download single YouTube videos only.' };
    return { tone: 'error', title: 'Ravenshelf did not respond', text: 'Try again in a moment. Check that Ravenshelf is open and connected.' };
  }
  function nativeError(error) {
    const text = String(error && error.message || error || '');
    if (/not found|No such native application|not registered/i.test(text)) return 'not-installed';
    if (/forbidden/i.test(text)) return 'not-allowed';
    return 'unavailable';
  }
  const policy = { HOST_NAME, PROTECTED_HOSTS, SEND_PAGE_HOSTS, SEND_PAGE_PATTERNS, THREAT_RESOURCE_TYPES, RULE_IDS, THREAT_RULE_IDS, CATEGORIES, YOUTUBE_PAGE_PATTERNS, PLAYER_CHOICES, MEDIA_QUALITIES, hostOf, onHosts, protectedRoot, baseName, extensionOf, contextOrigin, publicDownloadAddress, downloadPlan, threatRule, guardRule, allowAllRule, ruleCategory, toggleRules, popupVerdict, canSendPage, nativeError, youtubeVideoId, youtubeUrl, mediaReplyText, NEXUS_HOST, NEXUS_FILE_ROOTS, NEXUS_PAGE_MS, NEXUS_MAX_FILES, nexusId, nexusText, nexusAddress, nexusKey, nexusLooseKey, nexusPage, nexusFile, nexusMatch };
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.RavenshelfPolicy = Object.freeze(policy);
})(typeof globalThis !== 'undefined' ? globalThis : this);
