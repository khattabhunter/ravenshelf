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

  function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (error) { return ''; } }
  function onHosts(host, roots) { return Boolean(host) && roots.some(rootHost => host === rootHost || host.endsWith('.' + rootHost)); }
  function protectedRoot(host) { return PROTECTED_HOSTS.find(rootHost => host === rootHost || host.endsWith('.' + rootHost)) || null; }
  function baseName(value) {
    const name = String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
    return name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240);
  }
  function extensionOf(name) { const match = /\.([a-z0-9-]{1,24})$/i.exec(String(name || '').trim().replace(/[. ]+$/, '')); return match ? match[1].toLowerCase() : ''; }
  function schemeOf(url) { try { return new URL(url).protocol; } catch (error) { return ''; } }

  // What to do with a download the browser is starting, before asking the app.
  function downloadPlan(item, settings) {
    if (!settings || settings.capture === false || !item || typeof item !== 'object') return { kind: 'ignore' };
    if (item.byExtensionId) return { kind: 'ignore' };
    if (item.incognito) return { kind: 'ignore' };
    const url = typeof item.url === 'string' ? item.url : '';
    const finalUrl = typeof item.finalUrl === 'string' && item.finalUrl !== url ? item.finalUrl : '';
    const scheme = schemeOf(finalUrl || url);
    const filename = baseName(item.filename);
    if (scheme === 'blob:' || scheme === 'data:') {
      // A web page built this file itself, so Ravenshelf cannot fetch it again.
      if (LOCAL_DANGEROUS.has(extensionOf(filename))) return { kind: 'block', reason: `Ravenshelf stopped ${filename || 'a program'} that a web page created for download. Programs made this way are a common malware trick.` };
      return { kind: 'ignore' };
    }
    if (!['http:', 'https:'].includes(schemeOf(url)) || url.length > MAX_URL || (finalUrl && (finalUrl.length > MAX_URL || !['http:', 'https:'].includes(scheme)))) return { kind: 'ignore' };
    const size = Number.isSafeInteger(item.totalBytes) && item.totalBytes > 0 ? item.totalBytes : Number.isSafeInteger(item.fileSize) && item.fileSize > 0 ? item.fileSize : undefined;
    const referrer = typeof item.referrer === 'string' && ['http:', 'https:'].includes(schemeOf(item.referrer)) && item.referrer.length <= MAX_URL ? item.referrer : undefined;
    const message = { type: 'capture', url, incognito: false };
    if (finalUrl) message.finalUrl = finalUrl;
    if (referrer) message.referrer = referrer;
    if (filename && filename.length <= 1024) message.filename = filename;
    if (typeof item.mime === 'string' && item.mime && item.mime.length <= 200 && !/[\x00-\x1f\x7f]/.test(item.mime)) message.mime = item.mime;
    if (size) message.totalBytes = size;
    return { kind: 'ask', message };
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
  const policy = { HOST_NAME, PROTECTED_HOSTS, SEND_PAGE_HOSTS, SEND_PAGE_PATTERNS, THREAT_RESOURCE_TYPES, RULE_IDS, THREAT_RULE_IDS, CATEGORIES, YOUTUBE_PAGE_PATTERNS, PLAYER_CHOICES, MEDIA_QUALITIES, hostOf, onHosts, protectedRoot, baseName, extensionOf, downloadPlan, threatRule, guardRule, allowAllRule, ruleCategory, toggleRules, popupVerdict, canSendPage, nativeError, youtubeVideoId, youtubeUrl, mediaReplyText };
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.RavenshelfPolicy = Object.freeze(policy);
})(typeof globalThis !== 'undefined' ? globalThis : this);
