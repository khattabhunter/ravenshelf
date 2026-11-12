'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const api = window.atlas;
// The window's language, English or Arabic, with the texts of that language
// (see i18n.js). The main process serves both with the page.
const i18n = globalThis.RavenshelfI18n.createTranslator(globalThis.RAVENSHELF_LOCALE);
const { t, tn } = i18n;
// Marks an English text that is translated later, where it is shown.
const later = text => text;
// Text that always reads left to right, such as 1920 × 1080. In Arabic it is
// kept as one left-to-right unit, and each number is held in place, so the
// right-to-left page cannot swap its parts (Arabic digits would swap even
// inside a left-to-right unit).
const ltr = text => i18n.arabic ? '\u2066' + String(text).replace(/[0-9\u0660-\u0669][0-9\u0660-\u0669.\u066b]*/g, '\u200e$&\u200e') + '\u2069' : String(text);
const icons = {
  discover: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  library: '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m17 5 4 15"/>',
  settings: '<path d="m10 3-.6 2.3-2 .9-2-.8-2 3.4 1.6 1.6-.1 2.3L3 14.3l2 3.4 2.2-.6 2 .9.8 2h4l.7-2.3 2-.9 2.1.8 2-3.4-1.6-1.6.1-2.3L21 8.7l-2-3.4-2.2.6-2-.9L14 3z"/><circle cx="12" cy="11.5" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 4 4 4-7 4 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 .2 8M20 3v5h-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H4m6-6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="m10 14 4-4m-6 3-2 2a3.5 3.5 0 0 0 5 5l3-3m-4-10 3-3a3.5 3.5 0 0 1 5 5l-2 2"/>',
  heart: '<path d="M20.7 4.8a5 5 0 0 0-7.1 0L12 6.4l-1.6-1.6a5 5 0 1 0-7.1 7.1L12 21l8.7-9.1a5 5 0 0 0 0-7.1z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  file: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 12h8M8 16h6"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v5m0 3v.1"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  computer: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5M7 7h10"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1zm0 0v15"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  gpu: '<rect x="2" y="6" width="20" height="11" rx="2"/><circle cx="8" cy="11.5" r="2.6"/><circle cx="16" cy="11.5" r="2.6"/><path d="M6 17v3m4-3v3"/>',
  memory: '<rect x="2" y="7" width="20" height="9" rx="1.5"/><path d="M6 10v3m4-3v3m4-3v3m4-3v3M4 16v3m16-3v3M9 16v2m6-2v2"/>',
  drive: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18M7 17h.1M11 17h3"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
};

const state = { downloads: [], settings: { downloadDir: '', concurrency: 2, connectionsPerFile: 4, favorites: [], collections: [] }, completionAction: {mode:'none',phase:'idle'}, catalogRefresh: null, version: '0.4.0' };
const selectedDownloads = new Set();
let removalPreview = null, removalRequest = 0, removalBusy = false, storageRequest = 0, storageTask = null;
let lightboxItems = [], lightboxIndex = 0, lightboxOpener = null;
let clipboardInbox = {items:[],enabled:false}, verificationState = {phase:'idle'};
let featureSettingsBusy = 0;
const featureFormEdits={speed:0,schedule:0},featureFormSaved={speed:0,schedule:0};
const downloadsById = new Map(), activeDownloads = new Map(), downloadCards = new Map();
let hasDownloadSnapshot = false, lastUpdateSequence = -1;
const catalog = { page: 1, search: '', section: 'newest', games: [], hasMore: false, loading: false, request: 0 };
let catalogAutoReady = false;
let catalogCheckSeen = null;
let pendingCatalogCheck = null;
let catalogBackgroundError = '';
let catalogSections = [{id:'newest',label:later('Newest'),description:later('The latest additions to the FitGirl catalogue.')},{id:'top',label:later('Top games'),description:later('Popular games from the source catalogue.')},{id:'arpg',label:later('Action RPG')},{id:'rpg',label:later('RPG')},{id:'rts',label:later('Real-time strategy')}];
let selectedCollection = 'favorites';
let collectionEditId = null;
let collectionPendingGame = null;
let collectionSaving = false;
let installed = {games:[],scannedAt:null,warnings:[],locations:[]};
let installedLoaded = false;
let installedBusy = false;
let hardware = null;
let hardwareLoaded = false;
let hardwareBusy = false;
let hardwareFailed = false;
let completionBusy = false;
let completionDialogSync = false;
let currentView = 'discover';
let downloadFilter = 'all';
let detailRequest = 0;
let importBusy = false;
let currentDetail = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function icon(name) {
  const node = el('span');
  node.setAttribute('aria-hidden', 'true');
  // Only developer-defined SVG paths enter this markup. Remote content uses textContent.
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  return node;
}
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(node => node.replaceChildren(icon(node.dataset.icon)));
}
function button(label, className, iconName, onClick) {
  const node = el('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName));
  node.append(el('span', '', label));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}
function iconButton(label, iconName, onClick) {
  const node = button('', 'icon-button', iconName, onClick);
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}
function errorText(error) {
  const value = typeof error === 'string' ? error : error?.message || later('Something went wrong. Please try again.');
  return localMessage(value.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').slice(0, 900));
}
// Messages from the main process arrive in English. They come from a fixed
// list (see public-errors.cjs); a few carry a status number.
// A text the main process wrote, in English, shown in the app's language.
function localMessage(text) { return i18n.localText(text); }
function toast(message, isError = false) {
  const node = el('div', `toast${isError ? ' error' : ''}`, message);
  node.setAttribute('role', isError ? 'alert' : 'status');
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), isError ? 8000 : 4800);
}
async function attempt(action, successMessage) {
  try { const result = await action(); if (successMessage) toast(successMessage); return result; }
  catch (error) { toast(errorText(error), true); return undefined; }
}
function formatBytes(value, fallback = t('Size unknown')) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !value) return fallback;
  if (number < 1024) return t('{size} B', { size: Math.round(number) });
  const units = [size => t('{size} KB', { size }), size => t('{size} MB', { size }), size => t('{size} GB', { size }), size => t('{size} TB', { size })];
  let size = number / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return units[index](size >= 100 ? size.toFixed(0) : size.toFixed(1));
}
function safeImageUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.href.length>16384)return '';
    return 'atlas://app/image?url='+encodeURIComponent(url.href);
  }
  catch { return ''; }
}
function gameTitle(game) { return game?.title || t('Untitled game'); }
// The same name as Ravenshelf keeps it: it names the game's download folder,
// so it is never translated.
function gameName(game) { return game?.title || 'Untitled game'; }
// Folder names that Ravenshelf gives itself. They stay English on disk, so the
// same files always go to the same folder; the window shows them translated.
const OWN_FOLDERS = new Set([later('Browser downloads'), later('Imported files'), later('Imported links'), later('Untitled game')]);
function folderTitle(name) { return OWN_FOLDERS.has(name) ? t(name) : name; }
function fileName(link) {
  if (link.filename || link.name) return link.filename || link.name;
  try { const u = new URL(link.sourceUrl || link.url); return decodeURIComponent(u.hash.slice(1) || u.pathname.split('/').filter(Boolean).pop() || u.hostname); }
  catch { return t('Download link'); }
}
function isSaved(game) { return Array.isArray(state.settings.favorites) && state.settings.favorites.some(saved => saved.url === game.url); }
function emptyState(container, heading, message, iconName, action) {
  const illustration = el('div', 'empty-icon'); illustration.append(icon(iconName || 'discover'));
  container.replaceChildren(illustration, el('h3', '', heading), el('p', '', message));
  if (action) container.append(button(action.label, 'button secondary', action.icon || 'refresh', action.run));
  container.hidden = false;
}
function busyLine(message) {
  const line = el('div', 'busy-line'); line.append(el('span', 'spinner'), el('span', '', message));
  line.setAttribute('role', 'status'); return line;
}
function showView(view) {
  if (!['discover', 'downloads', 'library', 'installed', 'hardware', 'settings'].includes(view)) return;
  currentView = view;
  $$('.view').forEach(node => { node.hidden = node.id !== `${view}-view`; });
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  $('#current-view-label').textContent = { discover: t('Discover'), downloads: t('Downloads'), library: t('My library'), installed: t('On this PC'), hardware: t('PC specs'), settings: t('Settings') }[view];
  if (view === 'library') renderLibrary();
  if (view === 'downloads') renderDownloads();
  if (view === 'downloads' && featureUIAvailable()) refreshStorage();
  if (view === 'settings') renderSettings();
  if (view === 'installed') { renderInstalled(); if (!installedLoaded) loadInstalled(); }
  if (view === 'hardware') { renderHardware(); if (!hardwareLoaded) loadHardware(false); }
  window.scrollTo(0, 0);
  if (view === 'discover') flushCatalogCheck();
}
function renderSkeletons() {
  const grid = $('#game-grid');
  grid.replaceChildren();
  for (let i = 0; i < 10; i++) {
    const card = el('div', 'skeleton-card'); card.setAttribute('aria-hidden', 'true');
    card.append(el('div', 'skeleton-cover'), el('div', 'skeleton-text'), el('div', 'skeleton-text short'));
    grid.append(card);
  }
}
function makeGameCard(game) {
  const card = el('article', 'game-card');
  const open = button('', 'game-card-button', null, () => openGame(game));
  open.dataset.gameUrl = game.url || '';
  open.setAttribute('aria-label', t('View {title}', { title: gameTitle(game) }));
  const cover = el('div', 'game-cover');
  const imageUrl = safeImageUrl(game.image);
  if (imageUrl) {
    const image = el('img'); image.src = imageUrl; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.remove(); cover.prepend(el('div', 'image-placeholder', 'R')); }, { once: true });
    cover.append(image);
  } else cover.append(el('div', 'image-placeholder', 'R'));
  cover.append(el('span', 'cover-badge', t('REPACK')));
  if (Number.isInteger(game.sourceRank) && game.sourceRank > 0) {
    const rank = el('span', 'rank-badge', t('#{rank} monthly', { rank: game.sourceRank }));
    rank.title = t('Position {rank} in FitGirl’s monthly popular list', { rank: game.sourceRank });
    cover.append(rank);
  }
  const action = el('span', 'cover-action'); action.append(icon('arrow-right')); cover.append(action);
  const information = el('div', 'game-card-info');
  information.append(el('h3', '', gameTitle(game)));
  const meta = el('div', 'game-card-meta'); meta.append(icon('download'), el('span', '', game.repackSize || t('View size & details')));
  information.append(meta); open.replaceChildren(cover, information); card.append(open);
  if (isSaved(game)) { const marker = el('span', 'saved-dot'); marker.title = t('Saved to your library'); marker.append(icon('heart')); card.append(marker); }
  return card;
}
function renderGames() {
  $('#game-grid').replaceChildren(...catalog.games.map(makeGameCard));
  if (featureUIAvailable()) renderPersonalized();
}
function renderCatalogRefresh() {
  const snapshot = state.catalogRefresh;
  const status = $('#catalog-refresh-status');
  if (!status) return;
  const date = snapshot?.lastCheckedAt ? new Date(snapshot.lastCheckedAt) : null;
  const checked = date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString(i18n.arabic ? i18n.locale : [], {hour:'2-digit',minute:'2-digit'}) : '';
  const problem = catalogBackgroundError || snapshot?.error;
  status.classList.toggle('refresh-problem', Boolean(problem));
  status.title = problem ? errorText(problem) : '';
  const message = problem ? t('Couldn’t refresh. Keeping the current games; retrying automatically.') + (checked ? ' ' + t('Last check: {time}.', { time: checked }) : '') : snapshot?.checking ? t('Checking for new uploads…') : checked ? t('Last automatic check: {time}', { time: checked }) + (pendingCatalogCheck ? ' · ' + t('Update ready when you return to the catalog') : '') : t('Automatic checks are starting…');
  if (status.textContent !== message) status.textContent = message;
}
function receiveCatalogCheck(snapshot) {
  state.catalogRefresh = snapshot;
  if (snapshot?.lastCheckedAt && snapshot.lastCheckedAt !== catalogCheckSeen && Array.isArray(snapshot.latest?.games)) {
    catalogCheckSeen = snapshot.lastCheckedAt;
    pendingCatalogCheck = snapshot;
    flushCatalogCheck();
  }
  renderCatalogRefresh();
}
function flushCatalogCheck() {
  if (!catalogAutoReady || !pendingCatalogCheck || catalog.loading || currentView !== 'discover' || $('dialog[open]')) return;
  const check = pendingCatalogCheck;
  pendingCatalogCheck = null;
  const latest = catalog.section === 'newest' && catalog.page === 1 && !catalog.search ? check.latest : null;
  loadCatalog({background:true,forceRefresh:true,result:latest});
}
function applyCatalogResult(result, {page,search,section}, background = false) {
  const selectedSection = catalogSections.find(item => item.id === section);
  const games = Array.isArray(result.games) ? result.games : [];
  const changed = JSON.stringify(games) !== JSON.stringify(catalog.games);
  const scrollX = window.scrollX, scrollY = window.scrollY;
  const focusedGame = $('#game-grid').contains(document.activeElement) ? document.activeElement?.closest('[data-game-url]')?.dataset.gameUrl : null;
  const focusedSource = $('#catalog-notice').contains(document.activeElement);
  catalog.games = games;
  catalog.hasMore = Boolean(result.hasMore);
  if (!background || changed) renderGames();
  $('#catalog-empty').hidden = true;
  const sectionLabel = result.label || selectedSection?.label;
  $('#catalog-heading').textContent=search ? t('Search in {section}', { section: sectionLabel ? localMessage(sectionLabel) : t('catalogue') }) : sectionLabel ? localMessage(sectionLabel) : t('Discover games');
  if(result.description)$('#catalog-description').textContent=localMessage(result.description);
  $('#catalog-meta').textContent = tn(games.length, '{n} game on this page', '{n} games on this page') + (search ? ' · ' + t('“{search}”', { search }) : '');
  const notice=$('#catalog-notice'); notice.replaceChildren();
  if(result.notice)notice.append(el('span','',localMessage(result.notice)));
  if(result.sourceUrl)notice.append(button(section==='top'?t('View ranking source'):t('View catalog source'),'text-button','external',()=>attempt(()=>api.openExternal(result.sourceUrl))));
  notice.hidden=!notice.childNodes.length;
  if (!games.length) emptyState($('#catalog-empty'), t('No games on this page'), result.hasMore ? t('More source pages are available. Use Next page to continue browsing this genre.') : search ? t('Try another title or a shorter search, or choose a different collection.') : t('Try another catalogue section, refresh, or import a game page directly.'), 'search', { label: t('Browse newest'), run: () => { $('#search-input').value = ''; loadCatalog({ page: 1, search: '', section:'newest' }); } });
  $('#pagination').hidden = !games.length && page === 1 && !catalog.hasMore;
  $('#page-label').textContent = t('Page {page}', { page });
  $('#previous-page').disabled = page <= 1;
  $('#next-page').disabled = !catalog.hasMore;
  if (background) {
    if (focusedGame && changed) {
      const replacement = $$('[data-game-url]', $('#game-grid')).find(node => node.dataset.gameUrl === focusedGame);
      (replacement || $('#catalog-heading')).focus({preventScroll:true});
    }
    if (focusedSource) notice.querySelector('button')?.focus({preventScroll:true});
    window.scrollTo(scrollX, scrollY);
  }
}
async function loadCatalog({ page = catalog.page, search = catalog.search, section = catalog.section, forceRefresh = false, background = false, result: suppliedResult = null } = {}) {
  const request = ++catalog.request;
  catalog.loading = true; catalog.page = page; catalog.search = search.trim(); catalog.section = section;
  $('#refresh-catalog').disabled = true;
  const selectedSection=catalogSections.find(item=>item.id===section);
  if (!background) {
  renderCatalogSections();
  $('#catalog-empty').hidden = true; $('#pagination').hidden = true;
  $('#catalog-meta').textContent = catalog.search ? t('Searching for “{search}”…', { search: catalog.search }) : t('Loading {section}…', { section: selectedSection?.label ? localMessage(selectedSection.label) : t('games') });
  $('#catalog-heading').textContent = catalog.search ? t('Search in {section}', { section: selectedSection?.label ? localMessage(selectedSection.label) : t('catalogue') }) : selectedSection?.label ? localMessage(selectedSection.label) : t('Discover games');
  $('#catalog-description').textContent=selectedSection?.description ? localMessage(selectedSection.description) : t('Browse games in this collection.');
  $('#catalog-notice').hidden=true;
  $('#clear-search').hidden = !catalog.search;
  renderSkeletons();
  }
  try {
    const result = suppliedResult || await api.listCatalog({ page, search: catalog.search, section, forceRefresh });
    if (request !== catalog.request) return;
    applyCatalogResult(result,{page,search:catalog.search,section},background);
    catalogBackgroundError = '';
  } catch (error) {
    if (request !== catalog.request) return;
    if (background) { catalogBackgroundError = errorText(error); return; }
    catalog.games = []; $('#game-grid').replaceChildren();
    $('#catalog-meta').textContent = t('Catalog unavailable');
    emptyState($('#catalog-empty'), t('We couldn’t load the catalog'), errorText(error), 'alert', { label: t('Try again'), run: () => loadCatalog() });
  } finally {
    if (request === catalog.request) { catalog.loading = false; $('#refresh-catalog').disabled = false; renderCatalogRefresh(); flushCatalogCheck(); }
  }
}
function renderLibrary() {
  const collections=getCollections();
  if(selectedCollection!=='favorites'&&!collections.some(c=>c.id===selectedCollection))selectedCollection='favorites';
  const selected=collections.find(c=>c.id===selectedCollection);
  const games = selected ? selected.games || [] : Array.isArray(state.settings.favorites) ? state.settings.favorites : [];
  $('#library-heading').textContent=selected?.name || t('My library');
  const tabs=$('#collection-tabs'); tabs.replaceChildren();
  for(const collection of [{id:'favorites',name:t('Favorites')},...collections]){
    const tab=button(collection.name,`catalog-chip${selectedCollection===collection.id?' active':''}`,collection.id==='favorites'?'heart':'folder',()=>{selectedCollection=collection.id;$('#collection-delete-confirm').hidden=true;renderLibrary();});
    tab.setAttribute('aria-pressed',String(selectedCollection===collection.id));tabs.append(tab);
  }
  $('#collection-controls').hidden=!selected;
  $('#saved-count').textContent = tn(games.length, '{n} saved', '{n} saved');
  $('#library-grid').replaceChildren(...games.map(makeGameCard));
  $('#library-empty').hidden = Boolean(games.length);
  if (!games.length) emptyState($('#library-empty'), selected ? t('A new shelf for your games') : t('Your next favorites live here'), selected ? t('Open a game and add it to this collection. Collections organize catalogue entries; they do not move your files.') : t('Open a game and choose Save to library. Your saved collection stays on this PC.'), selected?'folder':'heart', { label: t('Explore games'), icon: 'discover', run: () => showView('discover') });
}
async function toggleSaved(game, target) {
  const saved = isSaved(game);
  const favorites = [...(state.settings.favorites || [])].filter(entry => entry.url !== game.url);
  if (!saved) favorites.unshift({ id: game.id, url: game.url, title: game.title, image: game.image, repackSize: game.repackSize, originalSize: game.originalSize, date: game.date });
  if (target) target.disabled = true;
  try {
    await api.saveSettings({ favorites });
    state.settings.favorites = favorites;
    updateBadges();
    if (!catalog.loading) renderGames();
    if (currentView === 'library') renderLibrary();
    if (target) { target.replaceChildren(icon('heart'), el('span', '', saved ? t('Save to library') : t('Saved to library'))); target.setAttribute('aria-pressed', String(!saved)); }
    toast(saved ? t('Removed from your library.') : t('Saved to your library.'));
  } catch (error) { toast(errorText(error), true); }
  finally { if (target) target.disabled = false; }
}
function showDialog(dialog) { if (!dialog.open) dialog.showModal(); }
async function openGame(game) {
  const request = ++detailRequest;
  const dialog = $('#game-dialog');
  const loading = el('div', 'detail-loading'); loading.append(el('span', 'spinner'), el('p', '', t('Opening game details…')));
  $('#detail-content').replaceChildren(loading); showDialog(dialog);
  try {
    const detail = await api.getGame(game.url);
    if (request !== detailRequest || !dialog.open) return;
    currentDetail = { ...game, ...detail };
    renderGameDetails(currentDetail);
  } catch (error) {
    if (request !== detailRequest || !dialog.open) return;
    const box = el('div', 'detail-body'); const empty = el('div', 'empty-state');
    emptyState(empty, t('Couldn’t open this game'), errorText(error), 'alert', { label: t('Try again'), run: () => openGame(game) });
    box.append(empty); $('#detail-content').replaceChildren(box);
  }
}
function renderGameDetails(game) {
  const header = el('div', 'detail-top');
  const imageUrl = safeImageUrl(game.image);
  if (imageUrl) {
    const image = el('img', 'detail-cover'); image.src = imageUrl; image.alt = t('{title} cover', { title: gameTitle(game) }); image.referrerPolicy = 'no-referrer';
    const cover = button('', 'detail-cover-button', null, () => openLightbox([imageUrl,...screenshots],0,gameTitle(game),cover));
    cover.setAttribute('aria-label', t('Enlarge {title} cover', { title: gameTitle(game) })); cover.append(image);
    image.addEventListener('load', () => { if (currentDetail?.url===game.url) applyCoverAccent(image); }, {once:true});
    image.addEventListener('error', () => image.remove(), { once: true }); header.append(cover);
  }
  const information = el('div', 'detail-info');
  information.append(el('div', 'eyebrow small', t('FITGIRL REPACK')));
  const title = el('h2', '', gameTitle(game)); title.id = 'detail-title'; information.append(title);
  const sizes = el('div', 'detail-sizes');
  for (const [label, value] of [[t('Repack size'), game.repackSize], [t('Original size'), game.originalSize]]) {
    const item = el('div', 'size-item'); item.append(el('span', '', label), el('strong', '', value || t('Not listed'))); sizes.append(item);
  }
  information.append(sizes);
  const actions = el('div', 'detail-top-actions');
  const save = button(isSaved(game) ? t('Saved to library') : t('Save to library'), 'button secondary', 'heart');
  save.setAttribute('aria-pressed', String(isSaved(game))); save.addEventListener('click', () => toggleSaved(game, save));
  const source = button(t('Source page'), 'button secondary', 'external', () => attempt(() => api.openExternal(game.url)));
  actions.append(save, source); information.append(actions); header.append(information);
  information.append(makeCollectionPicker(game));
  const body = el('div', 'detail-body');
  body.append(el('h3', 'detail-section-title', t('About this game')));
  body.append(el('div', 'detail-description', game.description || t('No description was available from the source page. Open the source page for more information.')));
  const screenshots = (Array.isArray(game.screenshots) ? game.screenshots : []).map(safeImageUrl).filter(Boolean).slice(0, 10);
  if (screenshots.length) {
    const strip = el('div', 'screenshot-strip'); strip.setAttribute('aria-label', t('Game screenshots'));
    screenshots.forEach((url, index) => { const image = el('img'); image.src = url; image.alt = t('Game screenshot {number}', { number: index + 1 }); image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; const enlarge=button('','screenshot-button',null,()=>openLightbox(screenshots,index,gameTitle(game),enlarge));enlarge.setAttribute('aria-label',t('Enlarge screenshot {number}', { number: index + 1 }));image.addEventListener('error', () => enlarge.remove(), { once: true });enlarge.append(image);strip.append(enlarge); });
    body.append(strip);
  }
  const resources=el('section','game-resources'); body.append(resources); loadGameResources(game,resources);
  const metadata=el('section','game-metadata');body.append(metadata);loadGameMetadata(game,metadata);
  const panel = el('section', 'download-panel');
  const heading = el('div', 'panel-heading'); heading.append(icon('download'), el('h3', '', t('Get the complete file set')));
  panel.append(heading, el('p', 'panel-intro', t('Choose one host. Ravenshelf expands the links, checks each part, and queues the ready files together.')));
  const groups = (Array.isArray(game.groups) ? game.groups : []).filter(group => Array.isArray(group.urls) && group.urls.length);
  const results = el('div');
  if (groups.length) {
    const controls = el('div', 'host-controls');
    const select = el('select', 'host-select'); select.setAttribute('aria-label', t('Choose download host'));
    groups.forEach((group, index) => {
      const option = el('option', '', group.label || group.host || t('Source {number}', { number: index + 1 })); option.value = String(index); select.append(option);
    });
    const preferredHost = groups.findIndex(group => /filekeeper/i.test(`${group.host || ''} ${group.label || ''}`));
    if (preferredHost >= 0) select.value = String(preferredHost);
    const check = button(t('Check download links'), 'button primary', 'link');
    check.addEventListener('click', async () => {
      const group = groups[Number(select.value)];
      check.disabled = true; select.disabled = true;
      try { await inspectLinks(group.urls.join('\n'), results, gameName(game)); }
      finally { check.disabled = false; select.disabled = false; }
    });
    select.addEventListener('change', () => { results.dataset.linkCheckRequest = String((Number(results.dataset.linkCheckRequest) || 0) + 1); results.replaceChildren(); });
    controls.append(select, check); panel.append(controls, el('p', 'host-helper', t('Use one host per complete download. Different hosts usually mirror the same files.')));
  } else {
    panel.append(el('p', 'warning-note', t('No supported file-host links were found on this page. Open the source page to inspect the available links, or import a link set.')));
    panel.append(button(t('Import links'), 'button secondary', 'plus', () => { $('#game-dialog').close(); openImport(); }));
  }
  panel.append(results); body.append(panel);
  const installation = el('details', 'installation-section');
  installation.append(el('summary', '', t('Installation notes')));
  installation.append(el('div', 'installation-text', localMessage(game.installation) || t('Keep all parts of the same repack in one folder. Review the source page for its extraction, verification, language, disk-space, and installation requirements. Ravenshelf does not automatically run downloaded files.')));
  installation.append(el('p', 'host-helper', t('Link availability does not verify the contents of an installer. Ravenshelf does not run downloads or change Windows security settings.')));
  body.append(installation);
  $('#detail-content').replaceChildren(header, body);
}
async function inspectLinks(text, container, title = 'Imported links') {
  const request = (Number(container.dataset.linkCheckRequest) || 0) + 1;
  container.dataset.linkCheckRequest = String(request);
  const isCurrent = () => container.dataset.linkCheckRequest === String(request);
  container.replaceChildren(busyLine(t('Expanding the file list…')));
  try {
    const expanded = await api.expandLinks(text);
    if (!isCurrent()) return;
    const sourceLinks = (expanded.links || []).map(link => typeof link === 'string' ? link : link.url).filter(Boolean);
    if (!sourceLinks.length) throw new Error(expanded.warnings?.map(localMessage).join(' ') || t('No downloadable links were found. Paste a supported file link or a FitGirl paste URL.'));
    if ((expanded.warnings || []).some(warning => /alternative mirrors/i.test(warning))) {
      const groups = new Map();
      for (const entry of expanded.links || []) {
        const url = typeof entry === 'string' ? entry : entry.url;
        if (!url) continue;
        let label = entry.host;
        if (!label) { try { label = new URL(url).hostname; } catch { continue; } }
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(url);
      }
      if (groups.size > 1) {
        const chooser = el('div', 'links-results');
        chooser.append(el('p', 'warning-note', t('This page offers the same files on several hosts. Choose one source for your download set.')));
        const controls = el('div', 'host-controls');
        const select = el('select', 'host-select'); select.setAttribute('aria-label', t('Choose one mirror host'));
        [...groups].forEach(([host, urls], index) => { const option = el('option', '', host + ' · ' + tn(urls.length, '{n} link', '{n} links')); option.value = String(index); select.append(option); });
        const preferredHost = [...groups.keys()].findIndex(host => /filekeeper/i.test(host));
        if (preferredHost >= 0) select.value = String(preferredHost);
        const check = button(t('Check this host'), 'button primary', 'link');
        check.addEventListener('click', () => inspectLinks([...groups.values()][Number(select.value)].join('\n'), container, title));
        controls.append(select, check); chooser.append(controls); container.replaceChildren(chooser); return;
      }
    }
    container.replaceChildren(busyLine(tn(sourceLinks.length, 'Checking {n} link. This may take a moment…', 'Checking {n} links. This may take a moment…')));
    const checked = await api.checkLinks(sourceLinks);
    if (!isCurrent()) return;
    const links = Array.isArray(checked) ? checked : checked.links || [];
    if (!links.length) throw new Error(t('The check returned no results. Please try again.'));
    const preflight = await checkArchiveSelection(links.filter(link => link.status === 'ready'));
    if (!isCurrent()) return;
    renderCheckedLinks(container, links, expanded.warnings || [], title, preflight);
  } catch (error) { if (isCurrent()) container.replaceChildren(el('div', 'inline-error', errorText(error))); }
}
async function checkArchiveSelection(links) {
  if (!links.length || typeof api?.validateArchiveSet !== 'function') return null;
  try {
    const result = await api.validateArchiveSet({ sourceUrls: links.map(link => link.sourceUrl || link.url).filter(Boolean) });
    if (!Array.isArray(result?.errors) || !Array.isArray(result?.warnings)) throw new Error('Invalid archive check.');
    return { errors: result.errors.filter(value => typeof value === 'string'), warnings: result.warnings.filter(value => typeof value === 'string') };
  } catch { return { errors: [], warnings: [], unavailable: true }; }
}
function renderCheckedLinks(container, links, warnings, title, preflight = null) {
  const wrapper = el('div', 'links-results');
  const ready = links.filter(link => link.status === 'ready');
  const manual = links.filter(link => link.status === 'manual');
  const browserSteps = manual.filter(link => /browser verification|browser check|captcha|challenge|browser (?:download )?steps?|requires (?:a )?browser/i.test(link.message || ''));
  const missing = links.filter(link => link.status === 'unavailable' && /not found|deleted|HTTP (?:404|410)\b/i.test(link.message || ''));
  const unverified = links.filter(link => link.status !== 'ready' && !browserSteps.includes(link) && !missing.includes(link));
  const summary = el('div', 'links-summary');
  summary.append(el('span', 'result-chip', tn(ready.length, '{n} ready', '{n} ready')));
  if (browserSteps.length) summary.append(el('span', 'result-chip manual', tn(browserSteps.length, '{n} need a browser step', '{n} need a browser step')));
  if (missing.length) summary.append(el('span', 'result-chip unavailable', tn(missing.length, '{n} not found', '{n} not found')));
  if (unverified.length) summary.append(el('span', 'result-chip manual', tn(unverified.length, '{n} not verified', '{n} not verified')));
  const knownSize = ready.reduce((sum, link) => sum + (Number(link.size) || 0), 0);
  if (knownSize) summary.append(el('span', 'small-text', ready.some(link => !link.size) ? t('{size} + unknown sizes', { size: formatBytes(knownSize) }) : t('{size} ready to download', { size: formatBytes(knownSize) })));
  wrapper.append(summary);
  for (const warning of warnings.slice(0, 5)) wrapper.append(el('p', 'warning-note', localMessage(warning)));
  let archiveConfirmation = null;
  if (preflight?.unavailable) wrapper.append(el('p', 'inline-error', t('The archive set could not be checked. Choose Check links again before queueing these files.')));
  if (preflight?.errors?.length) {
    const issues = el('div', 'archive-check warning-note'); issues.setAttribute('role', 'alert');
    issues.append(el('strong', '', t('This file set needs attention before downloading.')));
    for (const issue of preflight.errors.slice(0, 12)) issues.append(el('p', '', localMessage(issue)));
    const confirmation = el('label', 'check-label'); archiveConfirmation = el('input'); archiveConfirmation.type = 'checkbox';
    confirmation.append(archiveConfirmation, el('span', '', t('Queue these ready files anyway. I understand the set may be incomplete or inconsistent and may not extract.')));
    issues.append(confirmation); wrapper.append(issues);
  }
  for (const warning of (preflight?.warnings || []).slice(0, 8)) wrapper.append(el('p', 'warning-note', localMessage(warning)));
  if (browserSteps.length) wrapper.append(el('p', 'warning-note', t('The host needs browser verification or another browser step for some files. Use Open protected host beside an affected file to continue. This does not mean the files were deleted.')));
  if (missing.length) wrapper.append(el('p', 'warning-note', t('The host reported some files missing or deleted. Choose another mirror or check the source page for replacement links.')));
  if (unverified.length) wrapper.append(el('p', 'warning-note', t('Some links could not be verified. Read the message beside each file, then check again or choose another mirror.')));
  const list = el('div', 'link-list');
  links.forEach(link => {
    const status = ['ready', 'manual'].includes(link.status) ? link.status : 'unavailable';
    const row = el('div', 'link-row');
    const marker = el('span', `link-status-dot ${status}`); marker.title = status === 'ready' ? t('Ready') : missing.includes(link) ? t('Not found') : browserSteps.includes(link) ? t('Needs a browser step') : t('Not verified');
    const copy = el('div', 'link-copy');
    const name = el('div', 'link-name', fileName(link)); name.title = fileName(link);
    copy.append(name, el('div', 'link-message', link.message ? localMessage(link.message) : status === 'ready' ? (link.host || t('Direct link')) + ' · ' + t('Ready') : status === 'manual' ? t('Open the protected host window to continue.') : t('This link could not be verified.')));
    row.append(marker, copy);
    if (link.size) row.append(el('span', 'link-size', formatBytes(link.size)));
    if (status === 'manual') row.append(button(t('Open protected host'), 'text-button', 'external', () => attempt(() => api.openHost({ url: link.sourceUrl || link.url, gameTitle: title }))));
    list.append(row);
  });
  wrapper.append(list);
  const originalUrls = [...new Set(links.map(link => link.sourceUrl || link.url).filter(Boolean))];
  const actions = el('div', 'result-actions');
  const copy = button(t('Copy links'), 'text-button', 'copy', () => attempt(() => api.copyText(originalUrls.join('\n')), t('Link list copied.')));
  const recheck = button(t('Check links again'), 'text-button', 'refresh');
  recheck.addEventListener('click', async () => {
    recheck.disabled = true;
    try { await inspectLinks(originalUrls.join('\n'), container, title); }
    finally { recheck.disabled = false; }
  });
  const download = button(ready.length === links.length ? tn(ready.length, 'Download all {n} file', 'Download all {n} files') : tn(ready.length, 'Download {n} ready file', 'Download {n} ready files'), 'button primary', 'download');
  const canQueue = () => ready.length > 0 && !preflight?.unavailable && (!archiveConfirmation || archiveConfirmation.checked);
  download.disabled = !canQueue();
  archiveConfirmation?.addEventListener('change', () => { download.disabled = !canQueue(); });
  download.addEventListener('click', async () => {
    if (!canQueue()) return;
    download.disabled = true;
    try {
      const payload = { links: ready, gameTitle: title };
      if (archiveConfirmation?.checked) payload.allowIncomplete = true;
      const result = await api.addDownloads(payload);
      const added = typeof result?.added === 'number' ? result.added : ready.length;
      toast(added ? tn(added, '{n} file added to your download queue.', '{n} files added to your download queue.') : t('These files are already in your queue.'));
      $('#game-dialog').close(); $('#import-dialog').close();
      try { applyState(await api.getState()); } catch { /* State subscription will update the queue. */ }
      showView('downloads');
    } catch (error) { toast(errorText(error), true); download.disabled = !canQueue(); }
  });
  actions.append(copy, recheck, download); wrapper.append(actions);
  const alternatives = el('div', 'result-actions');
  if (typeof api.exportLinks === 'function') alternatives.append(button(t('Export link list'), 'text-button', 'file', () => attempt(() => api.exportLinks({ urls: originalUrls, gameTitle: title }))));
  if (typeof api.sendToJDownloader === 'function') {
    const send = button(t('Send to JDownloader'), 'text-button', 'external');
    send.addEventListener('click', async () => {
      send.disabled = true;
      try { await api.sendToJDownloader({ urls: originalUrls, gameTitle: title }); toast(t('Link set sent to JDownloader. Check its LinkGrabber for availability.')); }
      catch (error) { toast(errorText(error), true); }
      finally { send.disabled = false; }
    });
    alternatives.append(send);
  }
  if (alternatives.children.length) wrapper.append(alternatives);
  wrapper.append(el('p', 'host-helper', t('Ready means the host returned a file link. It is not a malware scan or a guarantee that all archive parts are present.')));
  container.replaceChildren(wrapper);
}
function openImport() { showDialog($('#import-dialog')); setTimeout(() => $('#import-links').focus(), 0); }
function statusLabel(item) {
  if (item.status === 'downloading') return t('Downloading');
  if (item.status === 'completed') return t('Completed');
  if (item.status === 'error') return t('Needs attention');
  return { queued: t('Queued'), paused: t('Paused'), cancelled: t('Cancelled') }[item.status] || item.status || t('Queued');
}
function updateDownloadProgress(node, item) {
  const received = Math.max(0, Number(item.received) || 0), total = Math.max(0, Number(item.total) || 0);
  const progress = item.status === 'completed' ? 100 : total ? Math.min(100, received / total * 100) : 0;
  const progressNode = $('.download-progress', node);
  progressNode.setAttribute('aria-label', t('{name} download progress', { name: item.name || t('File') }));
  if (total || item.status === 'completed') progressNode.setAttribute('aria-valuenow', String(Math.round(progress))); else progressNode.removeAttribute('aria-valuenow');
  $('.download-progress-fill', node).style.width = `${progress}%`;
  let detail = `${formatBytes(received, t('{size} B', { size: 0 }))} / ${formatBytes(total, t('Unknown size'))}`;
  if (item.status === 'downloading') detail += ' · ' + t('{speed}/s', { speed: formatBytes(item.speed, t('{size} B', { size: 0 })) }) + (total ? ' · ' + t('{percent}%', { percent: Math.round(progress) }) : '');
  $('.download-transfer', node).textContent = detail;
  const connections = $('.download-connections', node);
  let connectionText = '';
  if (item.kind === 'media') {
    // YouTube jobs report what they are doing (details, video, audio, joining) instead of connections.
    connectionText = ['downloading', 'paused', 'error'].includes(item.status) ? localMessage(String(item.connectionNote || '')) : '';
    connections.textContent = connectionText; connections.hidden = !connectionText;
    return;
  }
  if (item.status === 'downloading') {
    const count = Math.max(0, Math.min(4, Math.floor(Number(item.activeConnections) || 0)));
    if (item.connectionMode === 'checking') connectionText = t('Checking connection support…');
    else if (count) connectionText = tn(count, '{n} active connection', '{n} active connections');
    else connectionText = item.connectionMode === 'parallel' ? t('Preparing multiple connections…') : t('Preparing download…');
  }
  // A queued download waiting to retry (busy host or dropped connection) says why it is waiting.
  const waitingToRetry = item.status === 'queued' && Number(item.retryAt) > Date.now();
  if (item.connectionNote && (['downloading', 'paused', 'error'].includes(item.status) || waitingToRetry)) connectionText += `${connectionText ? ' · ' : ''}${localMessage(item.connectionNote)}`;
  connections.textContent = connectionText;
  connections.hidden = !connectionText;
}
function updateDownloadCard(node, item) {
  node.className = `download-item ${item.status || ''}`;
  const selection=$('.download-select',node);if(selection)selection.checked=selectedDownloads.has(String(item.id));
  $('.download-name', node).textContent = item.name || item.filename || fileName(item);
  $('.download-game', node).textContent = item.kind === 'media' ? ['YouTube', MEDIA_QUALITY_LABELS[item.media?.quality] && t(MEDIA_QUALITY_LABELS[item.media.quality])].filter(Boolean).join(' · ') : modLabel(item.mod) || (item.gameTitle ? folderTitle(item.gameTitle) : t('Imported download'));
  $('.download-file-icon', node).replaceChildren(icon(item.status === 'completed' ? 'check' : item.status === 'error' ? 'alert' : item.kind === 'media' ? 'video' : 'file'));
  const status = $('.download-status', node); status.textContent = statusLabel(item); status.className = `download-status ${item.status || ''}`;
  updateDownloadProgress(node, item);
  const error = $('.download-error', node); error.textContent = item.error ? localMessage(item.error) : ''; error.hidden = !item.error;
  const scan = $('.download-scan', node), scanInfo = scanText(item);
  scan.hidden = !scanInfo; scan.className = `download-scan ${scanInfo?.tone || ''}`;
  if (scanInfo) scan.replaceChildren(icon(scanInfo.glyph), el('span', '', scanInfo.text)); else scan.replaceChildren();
  const reputation = $('.download-reputation', node); if (reputation) renderDownloadReputation(reputation, item);
  const scanBusy = ['queued', 'scanning'].includes(item.scan?.status);
  const controls = $('.download-actions', node), scanKey = item.status === 'completed' ? String(scanBusy) : '';
  if (controls.dataset.status !== item.status || (controls.dataset.scan || '') !== scanKey) {
    controls.dataset.status = item.status; controls.dataset.scan = scanKey; controls.replaceChildren();
    if (['downloading', 'queued'].includes(item.status)) controls.append(downloadActionButton(item, 'pause', t('Pause download'), 'pause'));
    if (item.status === 'paused') controls.append(downloadActionButton(item, 'resume', t('Resume download'), 'play'));
    if (['error', 'cancelled'].includes(item.status)) controls.append(downloadActionButton(item, 'retry', t('Retry download'), 'refresh'));
    if (item.status === 'completed') controls.append(downloadActionButton(item, 'openFolder', t('Show downloaded file'), 'folder'));
    if (item.status === 'completed' && !scanBusy) controls.append(downloadActionButton(item, 'scan', item.scan ? t('Scan again with Microsoft Defender') : t('Scan with Microsoft Defender'), 'shield'));
    if (['downloading', 'queued', 'paused', 'error'].includes(item.status)) controls.append(downloadActionButton(item, 'cancel', t('Cancel download'), 'close'));
    if(typeof api?.previewDownloadRemoval==='function')controls.append(iconButton(t('Remove download'),'trash',()=>openDownloadRemoval([String(item.id)])));
  }
}
function scanText(item) {
  const scan = item.scan; if (!scan || item.status !== 'completed') return null;
  if (scan.status === 'queued') return { tone: 'busy', glyph: 'clock', text: t('Waiting for the Microsoft Defender scan…') };
  if (scan.status === 'scanning') return { tone: 'busy', glyph: 'shield', text: t('Scanning with Microsoft Defender…') };
  if (scan.status === 'clean') return { tone: 'clean', glyph: 'shield', text: scan.message ? localMessage(scan.message) : t('Microsoft Defender found no threats.') };
  if (scan.status === 'threat') return { tone: 'threat', glyph: 'alert', text: scan.message ? localMessage(scan.message) : t('Microsoft Defender found a threat. Do not open this file.') };
  if (scan.status === 'review') return { tone: '', glyph: 'alert', text: scan.message ? localMessage(scan.message) : t('The scan result needs review in Windows Security → Protection history. Automatic close and shutdown are waiting.') };
  return { tone: '', glyph: 'alert', text: scan.message ? localMessage(scan.message) : t('This file was not scanned.') };
}
function downloadActionButton(item, action, label, glyph) {
  const node = iconButton(label, glyph);
  node.addEventListener('click', async () => {
    node.disabled = true;
    try { await api.downloadAction({ id: item.id, action }); applyState(await api.getState()); if (action === 'scan') toast(t('Microsoft Defender scan queued.')); }
    catch (error) { toast(errorText(error), true); }
    finally { node.disabled = false; }
  });
  return node;
}
function makeDownloadCard(item) {
  const card = el('article', 'download-item'); card.dataset.id = item.id;
  if(featureUIAvailable()){const select=el('input','download-select');select.type='checkbox';select.checked=selectedDownloads.has(String(item.id));select.setAttribute('aria-label',t('Select {name}', { name: item.name || t('download') }));select.addEventListener('change',()=>{if(select.checked)selectedDownloads.add(String(item.id));else selectedDownloads.delete(String(item.id));renderDownloadSelection();});card.append(select);}
  const file = el('div', 'download-file-icon');
  const information = el('div', 'download-information');
  const progress = el('div', 'download-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100'); progress.append(el('div', 'download-progress-fill'));
  const bottom = el('div', 'download-bottom'); bottom.append(el('span', 'download-status'), el('span', 'download-transfer'));
  information.append(el('h3', 'download-name'), el('div', 'download-game'), progress, bottom, el('p', 'download-connections'), el('p', 'download-scan'), el('p', 'download-reputation'), el('p', 'download-error'));
  card.append(file, information, el('div', 'download-actions')); updateDownloadCard(card, item); return card;
}
function renderDownloads() {
  const downloads = state.downloads || [];
  if(featureUIAvailable()){const ids=new Set(downloads.map(item=>String(item.id)));for(const id of selectedDownloads)if(!ids.has(id))selectedDownloads.delete(id);renderDownloadSelection();}
  downloadCards.clear();
  $('#stat-active').textContent = i18n.digits(downloads.filter(item => item.status === 'downloading').length);
  $('#stat-speed').textContent = t('{speed}/s', { speed: formatBytes(downloads.reduce((sum, item) => sum + (item.status === 'downloading' ? Number(item.speed) || 0 : 0), 0), t('{size} B', { size: 0 })) });
  $('#stat-completed').textContent = i18n.digits(downloads.filter(item => item.status === 'completed').length);
  const visible = downloads.filter(item => downloadFilter === 'all' || (downloadFilter === 'active' && ['downloading', 'queued', 'paused'].includes(item.status)) || (downloadFilter === 'completed' && item.status === 'completed'));
  const list = $('#download-list');
  if (!visible.length) {
    const empty = el('div', 'empty-state');
    emptyState(empty, downloadFilter === 'completed' ? t('Nothing completed yet') : downloadFilter === 'active' ? t('Your queue is clear') : t('Ready when you are'), downloadFilter === 'completed' ? t('Completed files will appear here, with a shortcut to their folder.') : t('Choose a game or import a set of links to start downloading.'), 'download', downloadFilter === 'completed' ? undefined : { label: t('Import links'), icon: 'plus', run: openImport });
    list.replaceChildren(empty); return;
  }
  const existing = new Map($$('.download-item', list).map(node => [node.dataset.id, node]));
  $$('.empty-state', list).forEach(node => node.remove());
  const visibleIds = new Set(visible.map(item => String(item.id)));
  existing.forEach((node, id) => { if (!visibleIds.has(id)) node.remove(); });
  visible.forEach((item, index) => {
    let node = existing.get(String(item.id));
    if (node) updateDownloadCard(node, item); else node = makeDownloadCard(item);
    downloadCards.set(String(item.id), node);
    if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
  });
}
function renderSettings() {
  if (document.activeElement !== $('#language')) $('#language').value = ['en', 'ar'].includes(state.settings.language) ? state.settings.language : 'system';
  if (document.activeElement !== $('#digits')) $('#digits').value = state.settings.digits === 'arab' ? 'arab' : 'latn';
  $('#digits-row').hidden = !i18n.arabic;
  $('#download-path').textContent = state.settings.downloadDir || t('Choose a download folder');
  if (document.activeElement !== $('#concurrency')) $('#concurrency').value = String(state.settings.concurrency || 2);
  if (document.activeElement !== $('#connections-per-file')) $('#connections-per-file').value = String(state.settings.connectionsPerFile || 4);
  if (document.activeElement !== $('#defender-scan')) $('#defender-scan').value = state.settings.defenderScan === false ? 'off' : 'on';
  if(featureUIAvailable())renderFeatureSettings();
  if(browserFeatureAvailable())renderBrowserSettings();
  if(mediaFeatureAvailable())renderYouTubeSettings();
}
function renderCatalogSections() {
  const container=$('#catalog-sections');container.replaceChildren();
  for(const section of catalogSections){
    const control=button(localMessage(section.label),`catalog-chip${catalog.section===section.id?' active':''}`,section.id==='top'?'heart':section.id==='newest'?'clock':null,()=>{if(catalog.section===section.id)return;$('#search-input').value='';loadCatalog({section:section.id,page:1,search:''});});
    control.setAttribute('aria-pressed',String(catalog.section===section.id));control.title=localMessage(section.description||section.label);container.append(control);
  }
}
function getCollections(){return Array.isArray(state.settings.collections)?state.settings.collections:[];}
function compactGame(game){return {id:game.id,url:game.url,title:game.title,image:game.image,repackSize:game.repackSize,originalSize:game.originalSize,date:game.date,genres:game.genres,steamAppId:game.steamAppId};}
async function saveCollections(collections){
  const result=await api.saveSettings({collections});
  if(result?.settings)applyState(result);else{state.settings.collections=collections;renderLibrary();}
}
function makeCollectionPicker(game){
  const picker=el('div','collection-picker');picker.id='detail-collection-picker';
  const collections=getCollections();
  const select=el('select','host-select');select.setAttribute('aria-label',t('Choose a custom collection'));
  for(const collection of collections){const option=el('option','',collection.games?.some(g=>g.url===game.url)?t('{collection} · added',{collection:collection.name}):collection.name);option.value=collection.id;select.append(option);}
  if(!collections.length){const option=el('option','',t('No custom collections yet'));option.value='';select.append(option);select.disabled=true;}
  const toggle=button(t('Add to collection'),'button secondary compact','plus');
  const sync=()=>{const selected=collections.find(c=>c.id===select.value);const included=selected?.games?.some(g=>g.url===game.url);toggle.replaceChildren(icon(included?'close':'plus'),el('span','',included?t('Remove from collection'):t('Add to collection')));toggle.disabled=!selected;};
  select.addEventListener('change',sync);
  toggle.addEventListener('click',async()=>{const selected=getCollections().find(c=>c.id===select.value);if(!selected)return;toggle.disabled=true;const included=selected.games?.some(g=>g.url===game.url);try{await saveCollections(getCollections().map(c=>c.id===selected.id?{...c,games:included?(c.games||[]).filter(g=>g.url!==game.url):[...(c.games||[]),compactGame(game)]}:c));toast(included?t('Removed from {collection}.',{collection:selected.name}):t('Added to {collection}.',{collection:selected.name}));picker.replaceWith(makeCollectionPicker(game));}catch(error){toast(errorText(error),true);sync();}});
  picker.append(select,toggle,button(t('New'),'text-button','folder',()=>openCollectionForm(null,game)));sync();return picker;
}
function openCollectionForm(id=null,game=null){
  collectionEditId=id;collectionPendingGame=game;
  const existing=getCollections().find(c=>c.id===id);
  $('#collection-dialog-title').textContent=existing?t('Rename collection'):t('New collection');
  $('#collection-name').value=existing?.name||'';
  $('#collection-form-note').textContent=game?t('“{title}” will be added to this collection.',{title:gameTitle(game)}):t('Keep a shelf of games to return to.');
  $('#save-collection').textContent=existing?t('Save name'):t('Create collection');
  showDialog($('#collection-dialog'));setTimeout(()=>$('#collection-name').focus(),0);
}
async function submitCollection(event){
  event.preventDefault();if(collectionSaving)return;
  const name=$('#collection-name').value.trim().slice(0,60);if(!name)return;
  if(getCollections().some(c=>c.id!==collectionEditId&&c.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast(t('A collection already has that name.'),true);return;}
  collectionSaving=true;$('#save-collection').disabled=true;
  try{
    const id=collectionEditId||crypto.randomUUID();
    const collections=collectionEditId?getCollections().map(c=>c.id===id?{...c,name}:c):[...getCollections(),{id,name,games:collectionPendingGame?[compactGame(collectionPendingGame)]:[]}];
    await saveCollections(collections);selectedCollection=id;$('#collection-dialog').close();renderLibrary();
    if(currentDetail){const picker=$('#detail-collection-picker');if(picker)picker.replaceWith(makeCollectionPicker(currentDetail));}
    toast(collectionEditId?t('Collection renamed.'):t('Collection created.'));
  }catch(error){toast(errorText(error),true);}finally{collectionSaving=false;$('#save-collection').disabled=false;}
}
async function removeCollection(){
  if(selectedCollection==='favorites')return;const id=selectedCollection;
  const control=$('#collection-delete-confirm-button');control.disabled=true;
  try{await saveCollections(getCollections().filter(c=>c.id!==id));selectedCollection='favorites';$('#collection-delete-confirm').hidden=true;renderLibrary();toast(t('Collection removed. Downloaded files were kept.'));}
  catch(error){toast(errorText(error),true);}finally{control.disabled=false;}
}
async function loadGameResources(game,container){
  container.replaceChildren(el('h3','detail-section-title',t('Gameplay & guides')));
  const actions=el('div','resource-actions');
  actions.append(button(t('Watch gameplay'),'button youtube-button','video',()=>attempt(()=>api.openGameplay({title:gameName(game)}))));
  const copy=el('p','host-helper',t('Opens YouTube gameplay results in a separate viewer. Choose the video you want to watch.'));
  container.append(actions,copy);
  try{
    const resources=await api.getGameResources(compactGame(game));
    for(const guide of resources.guides||[]){if(!guide.url)continue;actions.append(button(guide.title?localMessage(guide.title):t('Find game guides'),'button secondary compact','book',()=>attempt(()=>api.openExternal(guide.url))));}
    if(resources.steamUrl)actions.append(button(t('Steam page'),'text-button','external',()=>attempt(()=>api.openExternal(resources.steamUrl))));
    if(resources.youtubeUrl)actions.append(button(t('YouTube in browser'),'text-button','external',()=>attempt(()=>api.openExternal(resources.youtubeUrl))));
    if(Array.isArray(resources.videos)&&resources.videos.length){const videos=el('div','video-links');for(const video of resources.videos.slice(0,4)){if(video.url)videos.append(button(video.title||t('Game video'),'video-link','play',()=>attempt(()=>api.openExternal(video.url))));}container.append(videos);}
  }catch(error){container.append(el('p','host-helper',t('Guide links unavailable: {reason}',{reason:errorText(error)})));}
}
function installEvidence(value){
  if(typeof value==='string')return localMessage(value);
  if(Array.isArray(value))return value.map(installEvidence).filter(Boolean).join('\n');
  if(value&&typeof value==='object')return [value.source||value.type||value.label,value.path||value.file,value.detail||value.value].filter(x=>typeof x==='string').join(' · ');
  return '';
}
function renderInstalled(){
  $('#scan-games').disabled=installedBusy;$('#add-game-folder').disabled=installedBusy;
  const date=installed.scannedAt?new Date(installed.scannedAt):null;
  $('#installed-scanned').textContent=installedBusy?t('Checking local game records…'):date&&!Number.isNaN(date.getTime())?t('Last scanned {time}',{time:i18n.arabic?date.toLocaleString(i18n.locale):date.toLocaleString()}):t('Not scanned yet');
  const warnings=$('#installed-warnings');warnings.replaceChildren();
  for(const warning of (installed.warnings||[]).slice(0,8))warnings.append(el('p','warning-note',typeof warning==='string'?localMessage(warning):warning.message?localMessage(warning.message):t('Some game records could not be read.')));
  warnings.hidden=!warnings.childNodes.length;
  const list=$('#installed-list');
  if(installedBusy&&!installed.games?.length){list.replaceChildren(busyLine(t('Looking for installed games and version records…')));return;}
  const query=$('#installed-search').value.trim().toLocaleLowerCase();
  const games=(installed.games||[]).filter(game=>!query||`${game.title} ${game.launcher}`.toLocaleLowerCase().includes(query));
  if(!games.length){const empty=el('div','empty-state');emptyState(empty,query?t('No matching installed games'):installed.scannedAt?t('No games detected yet'):t('Find your installed games'),query?t('Try a shorter title.'):installed.scannedAt?t('Add a game folder if an installation is outside your launcher libraries. Some games do not publish a version number.'):t('Scan launcher records, or select a folder containing your games. The scan reads metadata without running anything.'),'computer',query?undefined:{label:t('Scan games'),icon:'refresh',run:()=>scanInstalled(false)});list.replaceChildren(empty);return;}
  list.replaceChildren(...games.map(game=>{
    const card=el('article','installed-card'),badge=el('div','installed-game-icon');badge.append(icon('computer'));
    const content=el('div','installed-content'),heading=el('div','installed-heading');heading.append(el('h3','',game.title||t('Unnamed installation')),el('span','launcher-badge',game.launcher?localMessage(game.launcher):t('Local folder')));content.append(heading);
    const versions=el('div','installed-versions');
    const buildLabel=String(game.launcher||'').toLocaleLowerCase()==='steam'?t('Steam build ID'):t('Launcher build ID');
    const values=[[t('Reported version'),game.version||t('Not reported')],[buildLabel,game.buildId],[t('File version'),game.fileVersion],[t('Product version'),game.productVersion]];
    for(const [label,value] of values){if(value===undefined||value===null||value==='')continue;const item=el('div','installed-version');item.append(el('span','',label),el('strong','',value));versions.append(item);}content.append(versions);
    content.append(el('p','version-source',game.versionSource?t('Version source: {source}',{source:localMessage(game.versionSource)}):t('The installed game did not provide a clear version number.')));
    if(game.versionNote)content.append(el('p','version-note',localMessage(game.versionNote)));
    const details=el('details','local-evidence');details.append(el('summary','',t('Installation details')));
    details.append(el('code','',game.installPath||t('Installation location not reported')));
    const evidence=installEvidence(game.evidence);if(evidence)details.append(el('p','',evidence));
    details.append(el('p','small-text',t('Build IDs and executable versions are not automatically comparable to a repack version. No update status is inferred.')));content.append(details);
    const actions=el('div','installed-actions');
    const open=button(t('Open folder'),'button secondary compact','folder',()=>attempt(()=>api.openInstalledFolder(game.id)));open.disabled=!game.installPath;actions.append(open);
    actions.append(button(t('Gameplay'),'text-button','video',()=>attempt(()=>api.openGameplay({title:game.title||''}))));
    actions.append(button(t('Find in catalog'),'text-button','search',()=>{showView('discover');$('#search-input').value=game.title||'';loadCatalog({section:'newest',page:1,search:game.title||''});}));
    card.append(badge,content,actions);return card;
  }));
}
async function loadInstalled(){
  if(installedBusy)return;installedBusy=true;renderInstalled();
  try{const result=await api.getInstalledGames();if(result)installed={games:[],warnings:[],locations:[],...result};installedLoaded=true;}
  catch(error){toast(errorText(error),true);}finally{installedBusy=false;renderInstalled();}
}
async function scanInstalled(addFolder){
  if(installedBusy)return;installedBusy=true;renderInstalled();
  try{const result=await(addFolder?api.addGameFolder():api.scanInstalledGames());if(result){installed={games:[],warnings:[],locations:[],...result};installedLoaded=true;toast(tn(installed.games.length,'Found {n} installed game.','Found {n} installed games.'));}}
  catch(error){toast(errorText(error),true);}finally{installedBusy=false;renderInstalled();}
}
// ---- PC specs: what is inside this PC, read only when the page is opened ----
const HARDWARE_NOTES = {
  'probe-failed': later('Windows did not answer the full hardware check, so only the basics are shown. Choose Check again to retry.'),
  'not-windows': later('The full hardware check works only on Windows. Only the basics are shown here.'),
  'basic-display': later('Windows is using its basic display driver, so the graphics adapter could not be identified. Install the graphics driver from the maker of the PC or of the graphics adapter, then check again.'),
  'basic-display-extra': later('Another graphics adapter is running on Windows’ basic display driver, so it is not listed here. Install its driver, then check again.'),
};
// Memory sizes in MB or GB. Graphics and installed memory are sold in whole
// gigabytes but reported slightly under, so a value within 4% of a whole number
// is shown as that number. `exact` keeps one decimal instead.
function formatMemory(value, exact = false) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const gib = bytes / 1024 ** 3, whole = Math.round(gib);
  if (!exact && whole >= 1 && Math.abs(gib - whole) / whole <= 0.04) return t('{size} GB', { size: whole });
  const mib = Math.max(1, Math.round(bytes / 1024 ** 2));
  // Anything that would read "1024 MB" is shown in GB.
  if (mib < 1024) return t('{size} MB', { size: mib });
  return t('{size} GB', { size: Number(gib.toFixed(1)) });
}
// The sites a download link passed through, in order. In Arabic each site is
// kept as one unit and the chain runs right to left, with arrows to match.
function redirectChain(chain) {
  const hops = chain.map(hop => hop.host + (hop.listed ? ' (' + t('on a protection list') + ')' : ''));
  return i18n.arabic ? '\u200f' + hops.map(hop => '\u2068' + hop + '\u2069').join(' ← ') : hops.join(' → ');
}
// A value that reads in its own direction, such as a processor name or a
// Windows version: in Arabic it is kept as one unit, so signs at its start or
// end (#1, @, …) stay where they belong.
function own(text) { return i18n.arabic ? '\u2068' + text + '\u2069' : text; }
function specCard(label, iconName, title, rows = [], badge = '') {
  const card = el('article', 'spec-card'), heading = el('div', 'spec-card-heading'), mark = el('div', 'spec-icon');
  const titles = el('div', 'spec-title'), caption = el('div', 'spec-label');
  mark.append(icon(iconName));
  caption.append(el('span', '', label));
  if (badge) caption.append(el('span', 'spec-badge', badge));
  titles.append(caption, el('h3', '', own(title)));
  heading.append(mark, titles);
  card.append(heading);
  const shown = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (shown.length) {
    const list = el('dl', 'spec-rows');
    for (const [name, value] of shown) list.append(el('dt', '', name), el('dd', '', own(value)));
    card.append(list);
  }
  return card;
}
function processorCard(processor) {
  if (!processor?.name) return specCard(t('Processor'), 'chip', t('Not reported'));
  const cores = processor.cores ? tn(processor.cores, '{n} core', '{n} cores') : '';
  const threads = processor.threads ? tn(processor.threads, '{n} thread', '{n} threads') : '';
  const speed = processor.megahertz ? t('{speed} GHz', { speed: Number((processor.megahertz / 1000).toFixed(2)) }) : '';
  return specCard(t('Processor'), 'chip', processor.name, [
    // Without a core count, the row is named for what it does show.
    cores ? [t('Cores'), [cores, threads].filter(Boolean).join(' · ')] : [t('Threads'), processor.threads ? i18n.digits(processor.threads) : ''],
    [t('Clock speed'), speed],
    [t('Processors'), processor.sockets > 1 ? i18n.digits(processor.sockets) : ''],
  ]);
}
function graphicsCard(adapter, several) {
  const kind = adapter.kind === 'discrete' ? t('Graphics card') : adapter.kind === 'integrated' ? t('Built-in graphics') : '';
  const own = formatMemory(adapter.dedicatedBytes), shared = formatMemory(adapter.sharedBytes);
  // Built-in graphics, and any adapter with no memory of its own, borrow the PC's memory.
  const borrows = adapter.kind === 'integrated' || (adapter.dedicatedBytes === 0 && Boolean(shared));
  const memory = borrows ? (shared ? t('Shares system memory (up to {size})', { size: shared }) : t('Shares system memory')) : own || t('Not reported by Windows');
  const directx = adapter.directx ? (adapter.featureLevel ? t('DirectX {version} (feature level {level})', { version: adapter.directx, level: adapter.featureLevel }) : t('DirectX {version}', { version: adapter.directx })) : '';
  const card = specCard(t('Graphics'), 'gpu', adapter.name || t('Graphics adapter'), [
    [t('Type'), kind],
    [t('Graphics memory'), memory],
    [t('Supports'), directx],
    [t('Driver version'), adapter.driver],
  ], several && adapter.main ? t('Main') : '');
  if (adapter.problem) card.append(el('p', 'spec-problem', t('Windows reports a problem with this device: it is switched off or its driver is not working. Check it in Device Manager.')));
  return card;
}
function memoryCard(memory) {
  const installed = formatMemory(memory?.installedBytes), usable = formatMemory(memory?.usableBytes, true);
  if (!installed && !usable) return specCard(t('Memory (RAM)'), 'memory', t('Not reported'));
  return specCard(t('Memory (RAM)'), 'memory', installed ? t('{size} installed', { size: installed }) : t('{size} usable', { size: usable }), [
    [t('Usable by Windows'), installed ? usable : ''],
    [t('Memory modules'), memory.modules ? i18n.digits(memory.modules) : ''],
  ]);
}
function driveKind(drive) {
  // Card and built-in flash storage are named for what they are, not as an "SSD".
  if (drive.bus === 'SD card') return t('SD card');
  if (drive.bus === 'MMC') return drive.removable ? t('MMC card') : t('eMMC storage');
  const type = drive.kind === 'ssd' || drive.kind === 'hdd' ? drive.kind : 'other';
  if (drive.removable && !drive.bus) return t('Removable drive');
  const bus = drive.bus === 'Storage Spaces' ? t('Storage Spaces') : drive.bus;
  const name = bus ? { ssd: () => t('{bus} SSD', { bus }), hdd: () => t('{bus} hard disk', { bus }), other: () => t('{bus} drive', { bus }) }[type]()
    : { ssd: () => t('SSD'), hdd: () => t('hard disk'), other: () => t('drive') }[type]();
  return i18n.arabic ? name : name.charAt(0).toUpperCase() + name.slice(1);
}
function storageCard(drives) {
  const card = specCard(t('Storage'), 'drive', drives.length ? tn(drives.length, '{n} drive', '{n} drives') : t('No drives reported'));
  for (const drive of drives) {
    const block = el('div', 'spec-drive'), heading = el('div', 'spec-drive-heading');
    // A drive letter is written left to right in both languages.
    const letter = el('strong', '', `${drive.letter}:`); letter.dir = 'ltr';
    heading.append(letter, el('span', '', [driveKind(drive), drive.model].filter(Boolean).join(' · ')));
    block.append(heading);
    const total = Number(drive.totalBytes) || 0;
    const free = drive.freeBytes === null || drive.freeBytes === undefined ? null : Number(drive.freeBytes);
    if (total > 0 && free !== null && Number.isFinite(free) && free >= 0 && free <= total) {
      // "Low" only when both are true, so a big drive with plenty of room is not flagged.
      const low = free / total < 0.1 && free < 50 * 1024 ** 3;
      const meter = el('div', 'spec-meter'), fill = el('span', `spec-meter-fill${low ? ' low' : ''}`);
      fill.style.width = `${((1 - free / total) * 100).toFixed(1)}%`;
      meter.setAttribute('aria-hidden', 'true');
      meter.append(fill);
      block.append(meter, el('p', '', t('{free} free of {total}', { free: formatBytes(free, t('{size} B', { size: 0 })), total: formatBytes(total) }) + (low ? ' · ' + t('low on space') : '')));
    } else block.append(el('p', '', formatBytes(total)));
    card.append(block);
  }
  return card;
}
function renderHardware() {
  $('#check-hardware').disabled = hardwareBusy;
  const date = hardware?.checkedAt ? new Date(hardware.checkedAt) : null;
  $('#hardware-status').textContent = hardwareBusy ? t('Reading this PC’s hardware…')
    : date && Number.isFinite(date.getTime()) ? t('Checked at {time} · Read on this PC only, never sent anywhere.', { time: date.toLocaleTimeString(i18n.arabic ? i18n.locale : [], {hour: '2-digit', minute: '2-digit'}) }) : '';
  const messages = (Array.isArray(hardware?.notes) ? hardware.notes : []).filter(note => typeof note === 'string' && Object.hasOwn(HARDWARE_NOTES, note)).map(note => t(HARDWARE_NOTES[note]));
  // A screen reader reads these notes out when they appear, so they are
  // written again only when they change.
  const notes = $('#hardware-notes'), shown = JSON.stringify(messages);
  if (notes.dataset.shown !== shown) {
    notes.dataset.shown = shown;
    notes.replaceChildren(...messages.map(message => el('p', 'warning-note', message)));
  }
  const grid = $('#hardware-grid');
  if (!hardware) {
    if (hardwareBusy) { grid.replaceChildren(busyLine(t('Reading the processor, graphics, memory and drives…'))); return; }
    const empty = el('div', 'empty-state');
    if (hardwareFailed) {
      emptyState(empty, t('This PC’s specs could not be read'), t('Something stopped the check before it finished. Nothing left this PC.'), 'chip', {label: t('Try again'), icon: 'refresh', run: () => loadHardware(true)});
      // Said aloud by a screen reader: nothing else on the page reports the failure.
      empty.setAttribute('role', 'alert');
    }
    // Before the first check. Opening the page starts one at once, so this is on screen for a moment at most.
    else emptyState(empty, t('See what is inside this PC'), t('Ravenshelf reads the processor, graphics, memory and drives when you open this page. Nothing leaves this PC.'), 'chip');
    grid.replaceChildren(empty);
    return;
  }
  const complete = hardware.status === 'complete';
  const adapters = (Array.isArray(hardware.graphics) ? hardware.graphics : []).filter(Boolean).sort((a, b) => Number(Boolean(b.main)) - Number(Boolean(a.main)));
  const drives = (Array.isArray(hardware.drives) ? hardware.drives : []).filter(drive => drive && drive.letter);
  const cards = [processorCard(hardware.processor)];
  if (adapters.length) cards.push(...adapters.map(adapter => graphicsCard(adapter, adapters.length > 1)));
  else {
    const missing = specCard(t('Graphics'), 'gpu', complete ? t('Not detected') : t('Not read'));
    missing.append(el('p', '', complete ? t('Windows did not report a graphics adapter with a working driver.') : t('Graphics details need the full hardware check.')));
    cards.push(missing);
  }
  cards.push(memoryCard(hardware.memory));
  if (drives.length || complete) cards.push(storageCard(drives));
  const display = hardware.display;
  if (display?.width && display?.height) cards.push(specCard(t('Display'), 'monitor', ltr(t('{width} × {height}', { width: display.width, height: display.height })), [[t('Refresh rate'), display.refreshHz ? t('{rate} Hz', { rate: display.refreshHz }) : '']]));
  const system = hardware.system || {};
  cards.push(specCard(t('System'), 'computer', system.name || 'Windows', [[t('Build'), system.build ? i18n.digits(system.build) : ''], [t('System type'), system.architecture ? localMessage(system.architecture) : system.architecture]]));
  grid.replaceChildren(...cards);
}
async function loadHardware(refresh) {
  if (hardwareBusy) return;
  // A check switches its button off and redraws the page; either takes the
  // keyboard focus away from where it was. A check started from this page
  // hands it to Check again when it is over, unless you have moved on.
  const again = $('#check-hardware'), origin = document.activeElement;
  const fromHere = origin === again || $('#hardware-grid').contains(origin);
  hardwareBusy = true; renderHardware();
  try {
    const result = await api.getHardware({refresh: Boolean(refresh)});
    if (result && typeof result === 'object') { hardware = result; hardwareLoaded = true; hardwareFailed = false; }
    else hardwareFailed = true;
  }
  catch (error) { hardwareFailed = true; toast(errorText(error), true); }
  finally {
    hardwareBusy = false; renderHardware();
    const now = document.activeElement;
    if (fromHere && currentView === 'hardware' && (!now || now === document.body || now === again)) again.focus();
  }
}
function renderCompletionAction(){
  const action=state.completionAction||{mode:'none',phase:'idle'};
  const mode=['close','shutdown'].includes(action.mode)?action.mode:'none';
  if($('#shutdown-confirm').hidden&&document.activeElement!==$('#completion-mode'))$('#completion-mode').value=mode;
  $('#completion-mode').disabled=completionBusy;
  $('#completion-status').textContent=action.message?localMessage(action.message):(mode==='none'?t('Keep Ravenshelf open. Choose an action for the current unfinished queue.'):mode==='shutdown'?t('Ravenshelf will request laptop shutdown after this queue completes. You can change this any time.'):t('Ravenshelf will close after this queue completes. You can change this any time.'));
  const dialog=$('#completion-dialog');
  if(['countdown','executing','error'].includes(action.phase)){
    $('#shutdown-confirm').hidden=true;
    $('#completion-title').textContent=action.phase==='error'?t('The action could not finish'):mode==='shutdown'?t('Ready to turn off the laptop'):t('Downloads complete');
    $('#completion-countdown').textContent=action.phase==='error'?'!':i18n.digits(Math.max(0,Math.ceil(Number(action.remainingSeconds)||0)));
    $('#completion-message').textContent=action.phase==='error'?(action.message?localMessage(action.message):t('Your files are saved. You can keep working and choose an action again later.')):action.phase==='executing'?(action.message?localMessage(action.message):t('Completing your selected action…')):mode==='shutdown'?t('Windows shutdown will be requested when this countdown ends. Save your work, or cancel to keep using the laptop.'):t('Ravenshelf will close when this countdown ends. Your downloaded files are saved.');
    $('#cancel-completion').textContent=action.phase==='error'?t('Dismiss — keep working'):t('Cancel — keep working');
    $('#cancel-completion').disabled=completionBusy||action.phase==='executing';
    if(!dialog.open)showDialog(dialog);
  }else if(dialog.open){completionDialogSync=true;dialog.close();completionDialogSync=false;}
}
async function setCompletion(mode){
  if(completionBusy)return;completionBusy=true;renderCompletionAction();
  try{const result=await api.setCompletionAction(mode);if(result?.completionAction||result?.settings)applyState(result);else if(result?.mode){state.completionAction=result;}else applyState(await api.getState());$('#shutdown-confirm').hidden=true;}
  catch(error){$('#shutdown-confirm').hidden=true;$('#completion-mode').value=state.completionAction?.mode||'none';toast(errorText(error),true);}finally{completionBusy=false;renderCompletionAction();}
}
async function cancelCompletion(){
  if(completionBusy)return;completionBusy=true;$('#cancel-completion').disabled=true;
  try{const result=await api.cancelCompletionAction();if(result?.completionAction||result?.settings)applyState(result);else if(result?.mode)state.completionAction=result;else applyState(await api.getState());$('#shutdown-confirm').hidden=true;toast(t('Completion action cancelled.'));}
  catch(error){toast(errorText(error),true);}finally{completionBusy=false;$('#cancel-completion').disabled=false;renderCompletionAction();}
}
function updateBadges() {
  const pending = (state.downloads || []).filter(item => ['queued', 'downloading', 'paused'].includes(item.status)).length;
  const active = (state.downloads || []).filter(item => item.status === 'downloading').length;
  $('#queue-badge').textContent = i18n.digits(pending); $('#queue-badge').hidden = !pending;
  const favorites = state.settings.favorites?.length || 0;
  $('#library-badge').textContent = i18n.digits(favorites); $('#library-badge').hidden = !favorites;
  $('#status-queue').textContent = active ? tn(active, '{n} file downloading', '{n} files downloading') : pending ? tn(pending, '{n} file in your queue', '{n} files in your queue') : t('No active downloads');
}
function applyState(next) {
  if (!next || typeof next !== 'object') return;
  if (next.updateSequence !== undefined) {
    if (!Number.isSafeInteger(next.updateSequence) || next.updateSequence < 0 || next.updateSequence <= lastUpdateSequence) return;
    lastUpdateSequence = next.updateSequence;
  }
  const previousFavorites = JSON.stringify(state.settings.favorites || []);
  const previousCollections=JSON.stringify(state.settings.collections||[]);
  if (Array.isArray(next.downloads)) {
    state.downloads = next.downloads;
    downloadsById.clear(); activeDownloads.clear();
    for (const item of state.downloads) {
      downloadsById.set(String(item.id), item);
      if (item.status === 'downloading') activeDownloads.set(String(item.id), item);
    }
    hasDownloadSnapshot = true;
  }
  if (next.settings) state.settings = { ...state.settings, ...next.settings };
  if (next.version) state.version = next.version;
  if (typeof next.headerStorageWarning === 'string') state.headerStorageWarning = next.headerStorageWarning;
  const credentialWarning = $('#credential-warning');
  if (credentialWarning) { credentialWarning.textContent = state.headerStorageWarning ? localMessage(state.headerStorageWarning) : ''; credentialWarning.hidden = !state.headerStorageWarning; }
  if(next.completionAction)state.completionAction=next.completionAction;
  if(next.updater)state.updater=next.updater;
  if(next.downloadSchedule)state.downloadSchedule=next.downloadSchedule;
  if(next.clipboardInbox)clipboardInbox=next.clipboardInbox;
  if(next.verification)verificationState=next.verification;
  if(next.catalogRefresh)receiveCatalogCheck(next.catalogRefresh);
  if(next.browser!==undefined)browserState=next.browser;
  if(next.media!==undefined)mediaState=next.media;
  $('#version').textContent = `v${state.version}`;
  updateBadges();
  renderCompletionAction();
  if (currentView === 'downloads') renderDownloads();
  if (currentView === 'settings') renderSettings();
  if (JSON.stringify(state.settings.favorites || []) !== previousFavorites) {
    if (!catalog.loading) renderGames();
    if (currentView === 'library') renderLibrary();
  }
  if(JSON.stringify(state.settings.collections||[])!==previousCollections&&currentView==='library')renderLibrary();
  if(featureUIAvailable()){
    renderUpdater();renderScheduleStatus();renderClipboardCount();
    if(JSON.stringify(state.settings.collections||[])!==previousCollections&&!catalog.loading)renderPersonalized();
    if($('#clipboard-dialog').open)renderClipboard();if($('#verification-dialog').open)renderVerification();
    if(state.settings.adaptiveThemeEnabled===false)setAccent();
  }
  if(browserFeatureAvailable())afterBrowserState();
  if(mediaFeatureAvailable())afterMediaState();
}
function applyProgress(next) {
  // A delta cannot create a queue, revive a completed file or overwrite a newer
  // action/getState reply. Full snapshots remain authoritative on startup/reload.
  if (!hasDownloadSnapshot || !next || !Array.isArray(next.downloads) ||
      !Number.isSafeInteger(next.updateSequence) || next.updateSequence <= lastUpdateSequence) return;
  lastUpdateSequence = next.updateSequence;
  for (const progress of next.downloads) {
    if (!progress || typeof progress.id !== 'string') continue;
    const item = downloadsById.get(progress.id);
    if (!item || item.status !== 'downloading' ||
        !['received', 'total', 'speed'].every(key => Number.isFinite(progress[key]) && progress[key] >= 0) ||
        !Number.isInteger(progress.activeConnections) || progress.activeConnections < 0 || progress.activeConnections > 4) continue;
    item.received = progress.received; item.total = progress.total;
    item.speed = progress.speed; item.activeConnections = progress.activeConnections;
    const card = currentView === 'downloads' ? downloadCards.get(progress.id) : null;
    if (card) updateDownloadProgress(card, item);
  }
  if (currentView === 'downloads') {
    const speed = [...activeDownloads.values()].reduce((sum, item) => sum + (Number(item.speed) || 0), 0);
    $('#stat-speed').textContent = t('{speed}/s', { speed: formatBytes(speed, t('{size} B', { size: 0 })) });
  }
}
function featureUIAvailable(){return $('#feature-tools')?.dataset.feature==='0.4';}
function trustedImage(value){
  try{const url=new URL(value);if(url.protocol==='atlas:'&&url.host==='app'&&url.pathname==='/image'&&url.searchParams.size===1)return safeImageUrl(url.searchParams.get('url'));return safeImageUrl(value);}catch{return '';}
}
function openLightbox(urls,index,title,opener=document.activeElement){
  const dialog=$('#image-dialog');if(!dialog)return;
  lightboxItems=urls.map(trustedImage).filter(Boolean);if(!lightboxItems.length)return;
  lightboxIndex=Math.max(0,Math.min(lightboxItems.length-1,Number(index)||0));lightboxOpener=opener;
  dialog.dataset.title=String(title||t('Game image'));renderLightbox();showDialog(dialog);$('[data-close="image-dialog"]')?.focus();
}
function renderLightbox(){
  const image=$('#lightbox-image'),dialog=$('#image-dialog'),original=lightboxItems[lightboxIndex],large=enlargedImage(original);image.onerror=()=>{if(image.src!==original)image.src=original;};image.src=large;image.alt=t('{title} · image {number} of {count}',{title:dialog.dataset.title,number:lightboxIndex+1,count:lightboxItems.length});
  $('#image-caption').textContent=image.alt;$('#previous-image').disabled=lightboxItems.length<2;$('#next-image').disabled=lightboxItems.length<2;
}
function enlargedImage(value){
  const original=trustedImage(value);if(!original)return '';
  try{const source=new URL(new URL(original).searchParams.get('url'));if(/(?:^|\.)riotpixels\.(?:net|com)$/i.test(source.hostname)){source.pathname=source.pathname.replace(/\.jpg\.240p\.jpg$/i,'.jpg');return safeImageUrl(source.href);}}catch{}
  return original;
}
function moveLightbox(step){if(lightboxItems.length){lightboxIndex=(lightboxIndex+step+lightboxItems.length)%lightboxItems.length;renderLightbox();}}
// The arrow keys move the way the pictures run: in Arabic, the next picture is to the left.
function lightboxKey(event){if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();moveLightbox((event.key==='ArrowLeft')!==i18n.arabic?-1:1);}else if(event.key==='Escape'){event.preventDefault();$('#image-dialog').close();}}
function restoreLightboxFocus(){if($('#image-dialog').open)return;const target=lightboxOpener;lightboxOpener=null;lightboxItems=[];$('#lightbox-image').removeAttribute('src');if(target?.isConnected!==false&&typeof target?.focus==='function')target.focus({preventScroll:true});else $('#catalog-heading')?.focus();}
function luminance(rgb){return rgb.map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);}
function readableAccent(rgb){
  const background=luminance([48,40,64]);let color=rgb.map(value=>Math.max(0,Math.min(255,Math.round(value))));
  if(color.some(value=>!Number.isFinite(value)))return [185,160,236];
  for(let i=0;i<20&&(luminance(color)+0.05)/(background+0.05)<4.5;i++)color=color.map(value=>Math.round(value+(255-value)*0.12));
  return color;
}
function setAccent(rgb=[185,160,236]){const color=readableAccent(rgb);document.documentElement?.style?.setProperty('--game-accent',`rgb(${color.join(', ')})`);}
function applyCoverAccent(image){
  if(state.settings.adaptiveThemeEnabled===false){setAccent();return;}
  try{
    const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return;
    context.drawImage(image,0,0,24,24);const pixels=context.getImageData(0,0,24,24).data;let r=0,g=0,b=0,weight=0;
    for(let i=0;i<pixels.length;i+=4){const high=Math.max(pixels[i],pixels[i+1],pixels[i+2]),low=Math.min(pixels[i],pixels[i+1],pixels[i+2]);if(pixels[i+3]<220||high<40||high-low<18)continue;const w=(high-low)/255;r+=pixels[i]*w;g+=pixels[i+1]*w;b+=pixels[i+2]*w;weight+=w;}
    setAccent(weight?[r/weight,g/weight,b/weight]:undefined);
  }catch{setAccent();}
}
function genreTokens(value){return (Array.isArray(value)?value:String(value||'').split(/[,;/|]/)).map(genre=>String(genre).trim().toLowerCase()).filter(Boolean);}
function personalSuggestions(games,settings,downloads){
  const saved=[...(settings.favorites||[]),...(settings.collections||[]).flatMap(collection=>collection.games||[])],profile=new Map(),seen=new Set();
  for(const game of saved){if(seen.has(game.url))continue;seen.add(game.url);for(const genre of genreTokens(game.genres))profile.set(genre,(profile.get(genre)||0)+1);}
  for(const title of new Set(downloads.filter(item=>item.status==='completed').map(item=>String(item.gameTitle||'').toLowerCase()))){const known=[...saved,...games].find(game=>gameName(game).toLowerCase()===title);for(const genre of genreTokens(known?.genres))profile.set(genre,(profile.get(genre)||0)+1);}
  return games.filter(game=>!seen.has(game.url)).map(game=>{const matches=genreTokens(game.genres).filter(genre=>profile.has(genre));return {game,matches,score:matches.reduce((sum,genre)=>sum+profile.get(genre),0)};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||gameTitle(a.game).localeCompare(gameTitle(b.game))).slice(0,4);
}
function renderPersonalized(){
  const suggestions=personalSuggestions(catalog.games,state.settings,state.downloads),grid=$('#personalized-games');
  grid.replaceChildren(...suggestions.map(({game,matches})=>{const card=makeGameCard(game);card.append(el('p','suggestion-reason',t('Matches {genres} in your collection',{genres:matches.slice(0,2).join(' / ')})));return card;}));
  $('#personalized-reason').textContent=suggestions.length?t('Based on genres in your saved and completed games. Your preferences stay on this laptop.'):t('No genre matches on this page yet. Save games you like, or browse another catalogue page.');
}
function steamReviewSummary(reviews){
  if(!reviews||!Number.isSafeInteger(reviews.total)||reviews.total<1||!Number.isSafeInteger(reviews.positive)||reviews.positive<0||reviews.positive>reviews.total)return null;
  const ratio=reviews.positive/reviews.total;return {percent:Math.round(ratio*100),stars:Math.round(ratio*50)/10,total:reviews.total,description:typeof reviews.description==='string'?reviews.description:''};
}
async function loadGameMetadata(game,container){
  container.replaceChildren(el('h3','detail-section-title',t('Requirements & player reviews')));
  if(typeof api?.getGameMetadata!=='function'){container.append(el('p','small-text',t('Requirements and Steam review data are not available for this game.')));return;}
  const request=detailRequest,loading=el('p','small-text',t('Finding verified game details…'));container.append(loading);
  try{
    const metadata=await api.getGameMetadata({title:gameName(game),steamAppId:game.steamAppId,url:game.url});
    if(request!==detailRequest||container.isConnected===false)return;loading.remove();
    let sourceUrl='';try{const url=new URL(metadata?.sourceUrl);if(url.protocol==='https:'&&url.hostname==='store.steampowered.com'&&/^\/app\/\d+/.test(url.pathname))sourceUrl=url.href;}catch{}
    const rating=steamReviewSummary(metadata?.reviews);
    if(rating&&metadata.source==='Steam'&&sourceUrl){
      const row=el('div','review-summary'),stars=el('span','review-stars');stars.setAttribute('aria-hidden','true');stars.append(el('span','','★★★★★'));const fill=el('span','review-stars-fill','★★★★★');fill.style.width=`${rating.stars/5*100}%`;stars.append(fill);
      const reviewCount=i18n.arabic?rating.total.toLocaleString(i18n.locale):rating.total.toLocaleString();
      row.append(stars,el('strong','',t('{stars} / 5',{stars:rating.stars.toFixed(1)})),el('span','',t('Steam recommendation score · {percent}% positive · {count} reviews',{percent:rating.percent,count:reviewCount})));row.setAttribute('aria-label',t('{percent}% of {count} Steam reviews recommend this game; {stars} out of 5 when expressed as stars.',{percent:rating.percent,count:reviewCount,stars:rating.stars.toFixed(1)}));container.append(row);
      if(rating.description)container.append(el('p','small-text',localMessage(rating.description)));
    }else container.append(el('p','small-text',t('Steam player reviews are unavailable for this game.')));
    const requirements=el('div','requirements-grid');let count=0;
    for(const [key,label]of [['minimum',t('Minimum')],['recommended',t('Recommended')]]){const value=metadata?.requirements?.[key];if(typeof value==='string'&&value.trim()){const card=el('section','requirement-card');card.append(el('h4','',label),el('p','',value.slice(0,16000)));requirements.append(card);count++;}}
    if(count)container.append(requirements);else container.append(el('p','small-text',t('System requirements are unavailable. Check the game’s official store page.')));
    if(sourceUrl)container.append(button(t('View Steam source'),'text-button','external',()=>attempt(()=>api.openExternal(sourceUrl))));
    if(metadata?.message||metadata?.error)container.append(el('p','small-text',localMessage(String(metadata.message||metadata.error).slice(0,400))));
  }catch{if(request===detailRequest){loading.textContent=t('Game requirements and review data could not be loaded. Try opening the game again.');}}
}
function visibleDownloads(){return state.downloads.filter(item=>downloadFilter==='all'||(downloadFilter==='active'&&['downloading','queued','paused'].includes(item.status))||(downloadFilter==='completed'&&item.status==='completed'));}
function renderDownloadSelection(){
  const visible=visibleDownloads(),count=selectedDownloads.size,selectedVisible=visible.filter(item=>selectedDownloads.has(String(item.id))).length;
  $('#selection-count').textContent=count?tn(count,'{n} selected','{n} selected'):t('None selected');$('#remove-selected-downloads').disabled=!count||typeof api?.previewDownloadRemoval!=='function';
  const select=$('#select-visible-downloads');select.checked=visible.length>0&&selectedVisible===visible.length;select.indeterminate=selectedVisible>0&&selectedVisible<visible.length;select.disabled=!visible.length;
  $('#cleanup-completed').disabled=!state.downloads.some(item=>item.status==='completed')||typeof api?.previewDownloadRemoval!=='function';
}
function renderStorageSummary(data){
  const bytes=value=>Number.isSafeInteger(value)&&value>=0?value:0,completed=bytes(data.completedBytes),partial=bytes(data.partialBytes),tracked=Math.max(completed+partial,bytes(data.trackedBytes??data.totalBytes)),untracked=bytes(data.untrackedBytes),total=Math.max(tracked+untracked,bytes(data.libraryBytes)),scan=data.scan||{};
  const incomplete=scan.status&&scan.status!=='complete',missing=Array.isArray(data.missingItems)?data.missingItems:[],other=Array.isArray(data.untrackedItems)?data.untrackedItems:[],warnings=Array.isArray(data.warnings)?data.warnings.filter(value=>typeof value==='string'):[];
  const sizes={total:formatBytes(total,t('{size} B', { size: 0 })),tracked:formatBytes(tracked,t('{size} B', { size: 0 })),completed:formatBytes(completed,t('{size} B', { size: 0 })),partial:formatBytes(partial,t('{size} B', { size: 0 })),other:formatBytes(untracked,t('{size} B', { size: 0 }))};
  $('#storage-summary').textContent=incomplete?t('At least {total} found · {tracked} managed by your queue ({completed} completed, {partial} partial) · {other} other archives. File sizes are estimates of disk use.',sizes):t('{total} found · {tracked} managed by your queue ({completed} completed, {partial} partial) · {other} other archives. File sizes are estimates of disk use.',sizes);
  $('#storage-completed-fill').style.width=`${total?completed/total*100:0}%`;$('#storage-partial-fill').style.width=`${total?partial/total*100:0}%`;$('#storage-other-fill').style.width=`${total?untracked/total*100:0}%`;
  const details=$('#storage-details');details.replaceChildren();
  if(incomplete)details.append(el('p','warning-note',scan.status==='partial'?t('The folder check is incomplete. These are only the files found so far.'):t('Other files in the configured download folder could not be fully checked. Queue-managed sizes are shown where available.')));
  for(const warning of warnings.slice(0,8))details.append(el('p','small-text',localMessage(warning)));
  if(missing.length){const section=el('details','storage-file-list');section.append(el('summary','',tn(missing.length,'{n} queue entry has missing files','{n} queue entries have missing files')));section.append(el('p','small-text',t('Expected files were not found at the saved location. Missing bytes are not included; remaining partial files may still be counted. The entries remain in your queue.')));for(const item of missing.slice(0,200))section.append(el('p','storage-file-row',`${item.name||t('Download')}${item.message?' — '+localMessage(item.message):''}`));details.append(section);}
  if(other.length){const section=el('details','storage-file-list');section.append(el('summary','',tn(other.length,'{n} other archive in your download folder','{n} other archives in your download folder')));section.append(el('p','small-text',t('These files are not in your queue. They are shown for reference and cannot be deleted through queue cleanup.')));for(const item of other.slice(0,200)){const row=el('p','storage-file-row');row.append(el('span','',item.relativePath||item.name||t('Archive')),el('span','',formatBytes(bytes(item.bytes),t('{size} B', { size: 0 }))));section.append(row);}details.append(section);}
  if(!warnings.length&&data.items?.some(item=>item.unavailable))details.append(el('p','warning-note',t('Some queue files could not be checked safely and are not included in the total.')));
  $('#storage-checked-at').textContent=t('Checked {time}',{time:i18n.arabic?new Date().toLocaleTimeString(i18n.locale):new Date().toLocaleTimeString()});
}
function refreshStorage(){
  if(storageTask)return storageTask;
  const button=$('#refresh-storage');if(typeof api?.getStorageSummary!=='function'){$('#storage-summary').textContent=t('Storage checking is unavailable in this app connection.');button.disabled=true;return Promise.resolve();}
  const request=++storageRequest;button.disabled=true;button.textContent=t('Checking…');button.setAttribute('aria-busy','true');$('#storage-summary').textContent=t('Checking your queue and download folder…');$('#storage-checked-at').textContent='';
  storageTask=(async()=>{
    await Promise.resolve();
    try{const data=await api.getStorageSummary();if(request!==storageRequest)return;if(!data||typeof data!=='object')throw new Error('Invalid storage result.');renderStorageSummary(data);}
    catch{if(request===storageRequest){$('#storage-summary').textContent=t('Storage could not be checked. Choose Check space to try again.');$('#storage-details').replaceChildren();for(const selector of ['#storage-completed-fill','#storage-partial-fill','#storage-other-fill'])$(selector).style.width='0%';}}
    finally{if(request===storageRequest){button.disabled=false;button.textContent=t('Check space');button.removeAttribute('aria-busy');}storageTask=null;}
  })();return storageTask;
}
async function openDownloadRemoval(ids,cleanup=false){
  if(removalBusy||typeof api?.previewDownloadRemoval!=='function')return;
  const unique=[...new Set(ids.map(String))];if(!unique.length){toast(t('Select a download first.'));return;}
  const request=++removalRequest;removalPreview=null;$('#removal-title').textContent=cleanup?t('Clean up completed downloads'):t('Remove downloads');
  const pauseWarning=state.downloads.some(item=>unique.includes(String(item.id))&&['queued','downloading'].includes(item.status))?t('Selected active downloads pause for this review. Cancelling leaves them paused; you can resume them in Downloads.'):'';
  $('#removal-summary').textContent=t('Checking selected files. Active downloads pause for this review.');$('#removal-items').replaceChildren();$('#removal-warnings').replaceChildren(...(pauseWarning?[el('p','',pauseWarning)]:[]));$('#removal-error').hidden=true;
  $('input[name="removal-mode"][value="list"]').checked=true;$('input[name="removal-mode"][value="files"]').checked=false;$('#removal-confirm-files').checked=false;$('#removal-confirm-label').hidden=true;$('#confirm-removal').disabled=true;
  $('#removal-dialog').dataset.ids=JSON.stringify(unique);showDialog($('#removal-dialog'));
  try{const preview=await api.previewDownloadRemoval({ids:unique});if(request!==removalRequest||!$('#removal-dialog').open)return;
    if(!preview?.token||!Array.isArray(preview.items))throw new Error(t('The removal preview could not be read.'));removalPreview={...preview,ids:unique};
    $('#removal-summary').textContent=tn(preview.items.length,'{n} entry · Estimated space to recover if you delete files: {size}. Actual disk space can differ.','{n} entries · Estimated space to recover if you delete files: {size}. Actual disk space can differ.',{size:formatBytes(preview.totalBytes,t('{size} B', { size: 0 }))});
    $('#removal-items').replaceChildren(...preview.items.map(item=>{const row=el('div','removal-item');row.append(el('span','',item.name||t('Download')),el('span','small-text',formatBytes(item.bytes,t('{size} B', { size: 0 }))));return row;}));
    const warningMessages=(preview.warnings||[]).map(String).map(localMessage);if(pauseWarning&&!warningMessages.some(warning=>/paus/i.test(warning)))warningMessages.unshift(pauseWarning);
    $('#removal-warnings').replaceChildren(...warningMessages.map(warning=>el('p','',warning)));syncRemovalChoice();
  }catch(error){if(request===removalRequest){$('#removal-error').textContent=errorText(error);$('#removal-error').hidden=false;$('#removal-summary').textContent=t('Nothing has been removed.');}}
}
function syncRemovalChoice(){const destructive=$('input[name="removal-mode"][value="files"]').checked;$('#removal-confirm-label').hidden=!destructive;const button=$('#confirm-removal');button.textContent=destructive?t('Delete files permanently'):t('Remove from list');button.className=`button ${destructive?'danger':'primary'}`;button.disabled=removalBusy||!removalPreview||(destructive&&!$('#removal-confirm-files').checked);}
async function confirmDownloadRemoval(){
  const mode=$('input[name="removal-mode"][value="files"]').checked?'files':'list';if(removalBusy||!removalPreview||(mode==='files'&&!$('#removal-confirm-files').checked))return;
  removalBusy=true;syncRemovalChoice();$('#removal-options').disabled=true;$('#removal-confirm-files').disabled=true;$('#removal-refresh').disabled=true;$$('[data-close="removal-dialog"]').forEach(node=>{node.disabled=true;});$('#removal-error').hidden=true;$('#removal-summary').textContent=mode==='files'?t('Deleting the confirmed download files…'):t('Removing the confirmed entries…');
  try{const ids=removalPreview.ids,result=await api.removeDownloads({ids,mode,token:removalPreview.token});if(!Array.isArray(result?.removedIds))throw new Error(t('The removal result could not be confirmed. Review your download list before retrying.'));for(const id of result.removedIds)selectedDownloads.delete(String(id));removalPreview=null;applyState(await api.getState());refreshStorage();
    if(result.errors?.length){const removed=new Set(result.removedIds.map(String));$('#removal-dialog').dataset.ids=JSON.stringify(ids.filter(id=>!removed.has(id)));$('#removal-summary').textContent=tn(result.removedIds.length,'{n} removed.','{n} removed.')+' '+tn(result.errors.length,'{n} could not be removed.','{n} could not be removed.');$('#removal-error').textContent=result.errors.map(error=>error.message?localMessage(String(error.message)):t('A file could not be removed.')).join('\n')+' '+t('Check the remaining files before retrying.');$('#removal-error').hidden=false;}
    else{$('#removal-dialog').close();toast(mode==='files'?t('Selected download files deleted.'):t('Entries removed. Your files were kept.'));}
  }
  catch(error){removalPreview=null;$('#removal-error').textContent=errorText(error)+' '+t('Check the files again before retrying.');$('#removal-error').hidden=false;}
  finally{removalBusy=false;$('#removal-options').disabled=false;$('#removal-confirm-files').disabled=false;$('#removal-refresh').disabled=false;$$('[data-close="removal-dialog"]').forEach(node=>{node.disabled=false;});syncRemovalChoice();renderDownloadSelection();}
}
// Release notes open only for an exact Ravenshelf release page.
const RELEASE_PAGE=/^https:\/\/github\.com\/khattabhunter\/ravenshelf\/releases\/tag\/v\d+\.\d+\.\d+$/;
function renderUpdater(){
  const update=state.updater||{},phase=update.phase||'idle';$('#update-version').textContent=`v${update.currentVersion||state.version}`;
  const messages={idle:later('Check GitHub for a newer Ravenshelf release.'),checking:later('Checking for updates…'),current:later('You have the latest checked version.'),available:later('A new version is available. Nothing is downloaded until you choose Download and install.'),verifying:later('Checking GitHub’s checksum and signed build record…'),downloading:later('Downloading and verifying the update…'),ready:later('Ready — installs when you close Ravenshelf.'),error:later('The update could not be checked or verified. You can check again.'),unavailable:later('Automatic updates are not available in this build.')};
  const status=String(update.message||messages[phase]||later('Update status unavailable.'));
  $('#update-status').textContent=update.availableVersion&&!status.includes(String(update.availableVersion))?localMessage(status)+' '+t('Version {version}.',{version:String(update.availableVersion)}):localMessage(status);
  const progress=$('#update-progress');progress.hidden=phase!=='downloading';const percent=Number(update.progress?.percent??Number(update.progress)*100);if(Number.isFinite(percent))progress.value=Math.max(0,Math.min(100,percent));else progress.removeAttribute('value');
  $('#check-app-updates').disabled=typeof api?.checkForUpdates!=='function'||['checking','verifying','downloading','unavailable'].includes(phase);
  const download=$('#download-app-update');download.hidden=phase!=='available';download.disabled=typeof api?.downloadUpdate!=='function';
  $('#app-update-notes').hidden=!['available','verifying','downloading','ready'].includes(phase)||typeof api?.openExternal!=='function'||!RELEASE_PAGE.test(String(update.releaseUrl||''));
  const install=$('#install-app-update');install.hidden=phase!=='ready';install.disabled=typeof api?.installUpdate!=='function'||state.downloads.some(item=>['downloading','queued'].includes(item.status)||['queued','scanning'].includes(item.scan?.status))||['running','verifying','starting','checking'].includes(verificationState.phase)||state.completionAction?.mode!=='none';
}
function renderScheduleStatus(){const schedule=state.downloadSchedule,enabled=state.settings.downloadSchedule?.enabled;const node=$('#download-schedule-status');if(!enabled){node.textContent='';return;}let text=schedule?.active?t('Download schedule: allowed now.'):t('Download schedule: waiting for the next allowed period.');if(schedule?.nextChangeAt){const date=new Date(schedule.nextChangeAt);if(Number.isFinite(date.getTime()))text+=' '+t('Next change: {time}.',{time:i18n.arabic?date.toLocaleString(i18n.locale):date.toLocaleString()});}node.textContent=text;}
function renderFeatureSettings(){
  if(!featureSettingsBusy){
    const focus=document.activeElement;const speed=$('#speed-limit'),unit=$('#speed-unit');if(featureFormEdits.speed===featureFormSaved.speed&&!$('#speed-limit-form').contains(focus)){const bytes=Number(state.settings.maxDownloadBytesPerSecond)||0;unit.value=bytes&&bytes<1048576?'1024':'1048576';speed.value=String(bytes/Number(unit.value));}
    const schedule=state.settings.downloadSchedule||{enabled:false,start:'00:00',end:'00:00',days:[0,1,2,3,4,5,6]};
    if(featureFormEdits.schedule===featureFormSaved.schedule&&!$('#schedule-form').contains(focus)){ $('#schedule-enabled').checked=Boolean(schedule.enabled);$('#schedule-start').value=schedule.start||'00:00';$('#schedule-end').value=schedule.end||'00:00';$$('#schedule-form .schedule-days input').forEach(input=>{input.checked=(schedule.days||[]).includes(Number(input.value));});}
    for(const [id,key,defaultValue]of [['notifications-enabled','notificationsEnabled',true],['clipboard-watch-enabled','clipboardWatchEnabled',false],['adaptive-theme-enabled','adaptiveThemeEnabled',true],['auto-update-enabled','autoUpdateEnabled',true]]){const node=$('#'+id);if(focus!==node)node.checked=typeof state.settings[key]==='boolean'?state.settings[key]:defaultValue;}
  }
  renderUpdater();renderScheduleStatus();renderClipboardCount();
}
async function saveFeatureSetting(patch,control){
  const form='maxDownloadBytesPerSecond'in patch?'speed':'downloadSchedule'in patch?'schedule':null,revision=form?featureFormEdits[form]:0;
  featureSettingsBusy++;if(control)control.disabled=true;
  try{applyState(await api.saveSettings(patch));if(form)featureFormSaved[form]=revision;if('adaptiveThemeEnabled'in patch){if(!patch.adaptiveThemeEnabled)setAccent();else{const image=$('.detail-cover');if(image?.complete)applyCoverAccent(image);}}toast(t('Preference saved.'));}
  catch(error){toast(errorText(error),true);}finally{featureSettingsBusy--;if(control){control.disabled=false;const key=Object.keys(patch)[0];if(typeof patch[key]==='boolean')control.checked=typeof state.settings[key]==='boolean'?state.settings[key]:key!=='clipboardWatchEnabled';}renderFeatureSettings();}
}
function scheduleFromForm(){
  const start=$('#schedule-start').value,end=$('#schedule-end').value,days=$$('#schedule-form .schedule-days input').filter(input=>input.checked).map(input=>Number(input.value)),enabled=$('#schedule-enabled').checked;
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end))throw new Error(t('Choose a valid start and end time.'));
  if(enabled&&!days.length)throw new Error(t('Select at least one day.'));return {enabled,start,end,days};
}
async function refreshClipboard(){if(typeof api?.getClipboardInbox!=='function')return;try{clipboardInbox=await api.getClipboardInbox();renderClipboard();}catch{$('#clipboard-items').replaceChildren(el('p','inline-error',t('Copied links could not be loaded.')));}}
function renderClipboardCount(){const count=Array.isArray(clipboardInbox.items)?clipboardInbox.items.length:0;$('#clipboard-count').textContent=count?`(${i18n.digits(count)})`:'';const button=$('#clipboard-tray-button');if(button){button.hidden=!state.settings.clipboardWatchEnabled&&!count;button.textContent=count?t('Copied links ({count})',{count}):t('Copied links');}}
function renderClipboard(){
  renderClipboardCount();const items=Array.isArray(clipboardInbox.items)?clipboardInbox.items:[],container=$('#clipboard-items');container.replaceChildren();
  if(!items.length){container.append(el('p','small-text',state.settings.clipboardWatchEnabled?t('No recognized links copied yet.'):t('Clipboard recognition is off. You can turn it on in Settings.')));return;}
  for(const item of items){const row=el('div','clipboard-item');row.append(el('p','',item.url));const actions=el('div','inline-fields');actions.append(button(t('Inspect link'),'button secondary compact','link',()=>attempt(async()=>{const result=await api.importClipboardLinks({ids:[item.id]});if(typeof result?.text!=='string'||!result.text.trim())throw new Error(t('This copied link is no longer available.'));$('#clipboard-dialog').close();openImport();$('#import-links').value=result.text;$('#import-results').replaceChildren();toast(t('Link added to the import form. Choose Check links to continue.'));await refreshClipboard();})),button(t('Dismiss'),'text-button','close',()=>attempt(async()=>{await api.dismissClipboardLinks({ids:[item.id]});await refreshClipboard();})));row.append(actions);container.append(row);}
}
// How each file of a verification turned out, as the list shows it.
const VERIFICATION_STATUS={match:later('match'),mismatch:later('mismatch'),missing:later('missing'),error:later('error')};
function renderVerification(){
  const state=verificationState||{},busy=['running','verifying','starting','checking'].includes(state.phase),done=Number(state.completed)||0,total=Number(state.total)||0;
  const results=Array.isArray(state.results)?state.results:[],counts={match:0,mismatch:0,missing:0,error:0};for(const item of results)if(Object.hasOwn(counts,item.status))counts[item.status]++;
  const issues=counts.mismatch+counts.missing+counts.error,finished=['complete','completed'].includes(state.phase),status=$('#verification-status');status.className=issues||state.error?'verification-warning':'';
  status.textContent=state.error?localMessage(state.error):(finished?(issues?t('Some files need attention.')+' ':'')+t('{matched} matched · {mismatched} mismatched · {missing} missing · {failed} could not be checked.',{matched:counts.match,mismatched:counts.mismatch,missing:counts.missing,failed:counts.error}):state.message?localMessage(state.message):(busy?(total?t('Checking files · {done} of {total}',{done,total}):t('Checking files · {done} of …',{done})):state.phase==='cancelled'?t('Verification cancelled.'):t('Choose a manifest and its file folder to begin.')));
  const progress=$('#verification-progress');if(total){progress.value=Math.min(100,done/total*100);}else if(busy)progress.removeAttribute('value');else progress.value=0;
  $('#start-verification').disabled=busy||typeof api?.verifyFiles!=='function';
  $('#cancel-verification').hidden=!busy||typeof api?.cancelVerification!=='function';
  $('#verification-results').replaceChildren(...results.map(item=>{const row=el('div','verification-item');row.append(el('span','',item.name||item.path||t('File')),el('strong',item.status==='match'?'verification-match':'',VERIFICATION_STATUS[item.status]?t(VERIFICATION_STATUS[item.status]):item.status||t('Unknown')),el('span','small-text',item.message?localMessage(item.message):''));return row;}));
}
function wireFeatureEvents(){
  $('#download-list').before($('.download-tools'));
  $('#previous-image').addEventListener('click',()=>moveLightbox(-1));$('#next-image').addEventListener('click',()=>moveLightbox(1));$('#image-dialog').addEventListener('keydown',lightboxKey);$('#image-dialog').addEventListener('close',restoreLightboxFocus);
  $('#game-dialog').addEventListener('close',()=>{if($('#game-dialog').open)return;if($('#image-dialog').open)$('#image-dialog').close();setAccent();});
  $('#select-visible-downloads').addEventListener('change',event=>{for(const item of visibleDownloads())if(event.target.checked)selectedDownloads.add(String(item.id));else selectedDownloads.delete(String(item.id));renderDownloads();});
  $('#clear-download-selection').addEventListener('click',()=>{selectedDownloads.clear();renderDownloads();});$('#remove-selected-downloads').addEventListener('click',()=>openDownloadRemoval([...selectedDownloads]));$('#cleanup-completed').addEventListener('click',()=>openDownloadRemoval(state.downloads.filter(item=>item.status==='completed').map(item=>String(item.id)),true));
  $$('input[name="removal-mode"]').forEach(input=>input.addEventListener('change',()=>{$('#removal-confirm-files').checked=false;syncRemovalChoice();}));$('#removal-confirm-files').addEventListener('change',syncRemovalChoice);$('#confirm-removal').addEventListener('click',confirmDownloadRemoval);$('#removal-refresh').addEventListener('click',()=>openDownloadRemoval(JSON.parse($('#removal-dialog').dataset.ids||'[]')));$('#removal-dialog').addEventListener('close',()=>{if($('#removal-dialog').open)return;removalRequest++;if(!removalBusy)removalPreview=null;});$('#removal-dialog').addEventListener('cancel',event=>{if(removalBusy)event.preventDefault();});
  $('#refresh-storage').addEventListener('click',refreshStorage);
  for(const [id,key]of [['speed-limit-form','speed'],['schedule-form','schedule']]){const markEdited=()=>{featureFormEdits[key]++;};$('#'+id).addEventListener('input',markEdited);$('#'+id).addEventListener('change',markEdited);}
  $('#speed-limit-form').addEventListener('submit',event=>{event.preventDefault();const value=Number($('#speed-limit').value),unit=Number($('#speed-unit').value),bytes=Math.round(value*unit);if(!Number.isFinite(value)||value<0||![1024,1048576].includes(unit)||bytes>1073741824){toast(t('Enter a speed from 0 to 1024 MB/s.'),true);return;}saveFeatureSetting({maxDownloadBytesPerSecond:bytes},$('button[type="submit"]',$('#speed-limit-form')));});
  $('#schedule-form').addEventListener('submit',event=>{event.preventDefault();try{saveFeatureSetting({downloadSchedule:scheduleFromForm()},$('button[type="submit"]',$('#schedule-form')));}catch(error){toast(errorText(error),true);}});
  for(const [id,key]of [['notifications-enabled','notificationsEnabled'],['clipboard-watch-enabled','clipboardWatchEnabled'],['adaptive-theme-enabled','adaptiveThemeEnabled'],['auto-update-enabled','autoUpdateEnabled']])$('#'+id).addEventListener('change',event=>saveFeatureSetting({[key]:event.target.checked},event.target));
  $('#check-app-updates').addEventListener('click',async()=>{const button=$('#check-app-updates');button.disabled=true;try{const update=await api.checkForUpdates();if(update?.phase)state.updater=update;else if(update?.updater)state.updater=update.updater;}catch(error){state.updater={...state.updater,phase:'error',message:errorText(error)};}finally{renderUpdater();}});
  $('#download-app-update').addEventListener('click',async()=>{const button=$('#download-app-update');button.disabled=true;try{const update=await api.downloadUpdate();if(update?.phase)state.updater=update;}catch(error){toast(errorText(error),true);}finally{renderUpdater();}});
  $('#app-update-notes').addEventListener('click',()=>{const url=String(state.updater?.releaseUrl||'');if(RELEASE_PAGE.test(url))attempt(()=>api.openExternal(url));});
  $('#install-app-update').addEventListener('click',async()=>{const button=$('#install-app-update');button.disabled=true;try{await api.installUpdate();}catch(error){toast(errorText(error),true);renderUpdater();}});
  const openClipboard=()=>{showDialog($('#clipboard-dialog'));refreshClipboard();};$('#open-clipboard').addEventListener('click',openClipboard);$('#refresh-clipboard').addEventListener('click',refreshClipboard);
  const tray=button(t('Copied links'),'text-button',null,openClipboard);tray.id='clipboard-tray-button';tray.hidden=true;$('.top-actions').prepend(tray);
  $('#open-verification').addEventListener('click',async()=>{showDialog($('#verification-dialog'));if(typeof api?.getVerificationState==='function'){try{verificationState=await api.getVerificationState();}catch{}}renderVerification();});
  $('#start-verification').addEventListener('click',async()=>{if(typeof api?.verifyFiles!=='function')return;$('#start-verification').disabled=true;try{verificationState=await api.verifyFiles()||{phase:'idle'};}catch(error){verificationState={phase:'error',error:errorText(error)};}renderVerification();});
  $('#cancel-verification').addEventListener('click',async()=>{if(typeof api?.cancelVerification!=='function')return;const control=$('#cancel-verification');control.disabled=true;try{verificationState=await api.cancelVerification();}catch(error){toast(errorText(error),true);}finally{control.disabled=false;renderVerification();}});
  renderFeatureSettings();renderDownloadSelection();
}
function wireEvents() {
  $$('[data-view]').forEach(node => node.addEventListener('click', () => showView(node.dataset.view)));
  $('.brand').addEventListener('click', event => { event.preventDefault(); showView('discover'); });
  ['#import-button', '#queue-import'].forEach(selector => $(selector).addEventListener('click', openImport));
  ['#folder-button', '#downloads-folder'].forEach(selector => $(selector).addEventListener('click', () => attempt(() => api.openDownloadsFolder())));
  $('#status-queue').addEventListener('click', () => showView('downloads'));
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); loadCatalog({ page: 1, search: $('#search-input').value }); });
  $('#search-input').addEventListener('search', () => { if (!$('#search-input').value) loadCatalog({ page: 1, search: '' }); });
  $('#clear-search').addEventListener('click', () => { $('#search-input').value = ''; loadCatalog({ page: 1, search: '' }); });
  $('#refresh-catalog').addEventListener('click', () => loadCatalog({forceRefresh:true}));
  $('#previous-page').addEventListener('click', () => { if (!catalog.loading && catalog.page > 1) { loadCatalog({ page: catalog.page - 1 }); window.scrollTo(0, 250); } });
  $('#next-page').addEventListener('click', () => { if (!catalog.loading && catalog.hasMore) { loadCatalog({ page: catalog.page + 1 }); window.scrollTo(0, 250); } });
  $$('[data-close]').forEach(node => node.addEventListener('click', () => {if(node.dataset.close==='removal-dialog'&&removalBusy)return;$(`#${node.dataset.close}`).close();}));
  $$('dialog').filter(dialog=>dialog.id!=='completion-dialog').forEach(dialog => dialog.addEventListener('click', event => { if(dialog.id==='removal-dialog'&&removalBusy)return;const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }));
  $('#game-dialog').addEventListener('close', () => { if($('#game-dialog').open)return;detailRequest++; currentDetail = null; });
  $$('dialog').forEach(dialog => dialog.addEventListener('close', () => setTimeout(flushCatalogCheck, 0)));
  $('#check-import').addEventListener('click', async () => {
    if (importBusy) return;
    const text = $('#import-links').value.trim();
    if (!text) { $('#import-links').focus(); toast(t('Paste a game page, paste URL, or file links first.'), true); return; }
    importBusy = true; $('#check-import').disabled = true;
    try { await inspectLinks(text, $('#import-results')); }
    finally { importBusy = false; $('#check-import').disabled = false; }
  });
  $$('.filter-tab').forEach(node => node.addEventListener('click', () => { downloadFilter = node.dataset.filter; $$('.filter-tab').forEach(tab => tab.classList.toggle('active', tab === node)); renderDownloads(); }));
  $('#choose-folder').addEventListener('click', async () => {
    const control = $('#choose-folder'); control.disabled = true;
    try { await api.chooseFolder(); applyState(await api.getState()); renderSettings(); }
    catch (error) { toast(errorText(error), true); }
    finally { control.disabled = false; }
  });
  $('#concurrency').addEventListener('change', async () => {
    const control = $('#concurrency'); const concurrency = Number(control.value); control.disabled = true;
    try { await api.saveSettings({ concurrency }); state.settings.concurrency = concurrency; toast(t('Download preference saved.')); }
    catch (error) { control.value = String(state.settings.concurrency); toast(errorText(error), true); }
    finally { control.disabled = false; }
  });
  $('#connections-per-file').addEventListener('change', async () => {
    const control = $('#connections-per-file'); const connectionsPerFile = Number(control.value); control.disabled = true;
    try { applyState(await api.saveSettings({ connectionsPerFile })); toast(t('Saved. Applies when a file starts or resumes.')); }
    catch (error) { control.value = String(state.settings.connectionsPerFile || 4); toast(errorText(error), true); }
    finally { control.disabled = false; }
  });
  $('#defender-scan').addEventListener('change', async () => {
    const control = $('#defender-scan'); const defenderScan = control.value === 'on'; control.disabled = true;
    try { applyState(await api.saveSettings({ defenderScan })); toast(defenderScan ? t('Finished downloads will be scanned with Microsoft Defender.') : t('Automatic scans are off. You can still scan a finished file from its card.')); }
    catch (error) { control.value = state.settings.defenderScan === false ? 'off' : 'on'; toast(errorText(error), true); }
    finally { control.disabled = false; }
  });
  $('#new-collection').addEventListener('click',()=>openCollectionForm());
  $('#rename-collection').addEventListener('click',()=>openCollectionForm(selectedCollection));
  $('#delete-collection').addEventListener('click',()=>{$('#collection-delete-confirm').hidden=false;});
  $('#collection-delete-back').addEventListener('click',()=>{$('#collection-delete-confirm').hidden=true;});
  $('#collection-delete-confirm-button').addEventListener('click',removeCollection);
  $('#collection-form').addEventListener('submit',submitCollection);
  $('#scan-games').addEventListener('click',()=>scanInstalled(false));
  $('#add-game-folder').addEventListener('click',()=>scanInstalled(true));
  $('#installed-search').addEventListener('input',renderInstalled);
  $('#check-hardware').addEventListener('click', () => loadHardware(true));
  for (const id of ['language', 'digits']) $('#' + id).addEventListener('change', () => changeLanguage({ [id]: $('#' + id).value }, $('#' + id)));
  $('#completion-mode').addEventListener('change',()=>{
    const mode=$('#completion-mode').value;
    if(mode==='shutdown'&&state.completionAction?.mode!=='shutdown'){$('#shutdown-confirm').hidden=false;return;}
    $('#shutdown-confirm').hidden=true;setCompletion(mode);
  });
  $('#shutdown-back').addEventListener('click',()=>{$('#shutdown-confirm').hidden=true;$('#completion-mode').value=state.completionAction?.mode||'none';});
  $('#shutdown-arm').addEventListener('click',()=>setCompletion('shutdown'));
  $('#cancel-completion').addEventListener('click',cancelCompletion);
  $('#completion-dialog').addEventListener('cancel',event=>{event.preventDefault();if(state.completionAction?.phase!=='executing')cancelCompletion();});
  $('#completion-dialog').addEventListener('close',()=>{if(!completionDialogSync&&state.completionAction?.phase==='countdown')cancelCompletion();});
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.code === 'KeyK')) {
      event.preventDefault(); if ($('dialog[open]')) return; showView('discover'); $('#search-input').focus(); $('#search-input').select();
    }
  });
  if(featureUIAvailable())wireFeatureEvents();
  if(browserFeatureAvailable())wireBrowserEvents();
  if(mediaFeatureAvailable())wireMediaEvents();
}
// ---- browser extension: setup, reviews of browser downloads, VirusTotal ----
let browserState = null, browserBusy = false, capturesPrimed = false, capturesShown = '';
const seenCaptures = new Set(), acknowledgedCaptures = new Set();
const BROWSER_NAMES = { chromium: later('Chrome, Edge or Brave'), firefox: later('Firefox') };
const PENDING_CAPTURES = ['checking', 'ready', 'manual'];
const VIRUSTOTAL_REPORT = /^https:\/\/www\.virustotal\.com\/gui\/(?:file|domain)\/[A-Za-z0-9._-]+$/;
function browserFeatureAvailable() { return typeof api?.setBrowserIntegration === 'function'; }
function timeAgo(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return tn(minutes, '{n} min ago', '{n} min ago');
  const hours = Math.round(minutes / 60);
  return hours < 48 ? tn(hours, '{n} h ago', '{n} h ago') : tn(Math.round(hours / 24), '{n} days ago', '{n} days ago');
}
function hostOfAddress(value) { try { return new URL(value).hostname; } catch { return ''; } }
function captureList() { return Array.isArray(browserState?.bridge?.captures) ? browserState.bridge.captures : []; }
function renderBrowserBadge() {
  const control = $('#browser-captures-button'); if (!control) return;
  const captures = captureList(), pending = captures.filter(item => PENDING_CAPTURES.includes(item.status)).length;
  control.hidden = !captures.length;
  $('#browser-captures-count').textContent = pending ? i18n.digits(pending) : '';
  $('#browser-captures-count').hidden = !pending;
  control.setAttribute('aria-label', pending ? tn(pending, 'Browser downloads: {n} waiting for you', 'Browser downloads: {n} waiting for you') : t('Browser downloads'));
}
// Called after every state update: opens the review when a new browser
// download arrives (unless another window is open) and keeps it current.
function afterBrowserState() {
  renderBrowserBadge();
  if (currentView === 'settings') renderBrowserSettings();
  const dialog = $('#browser-dialog'), captures = captureList();
  const arrived = captures.some(item => PENDING_CAPTURES.includes(item.status) && !seenCaptures.has(item.id));
  for (const item of captures) seenCaptures.add(item.id);
  if (arrived && capturesPrimed && !$$('dialog').some(other => other.open)) showDialog(dialog);
  capturesPrimed = true;
  if (dialog.open) renderBrowserCaptures();
}
// Plain wording for one VirusTotal result; null when there is nothing to say.
function virusTotalSummary(report) {
  if (!report || typeof report !== 'object') return null;
  const subject = report.subject ? String(report.subject) : report.kind === 'file' ? t('this file') : t('this site');
  const total = ['malicious', 'suspicious', 'harmless', 'undetected'].reduce((sum, key) => sum + (Number(report[key]) || 0), 0);
  const link = VIRUSTOTAL_REPORT.test(String(report.link || '')) ? String(report.link) : '';
  if (report.status === 'ok') {
    if (report.malicious >= 2) return { text: t('VirusTotal: {count} of {total} security vendors flag {subject} as malicious.', { count: report.malicious, total, subject }), tone: 'threat', link };
    if (report.malicious === 1) return { text: t('VirusTotal: 1 of {total} vendors flags {subject}. A single detection is often a false alarm.', { total, subject }), tone: '', link };
    return { text: t('VirusTotal: no vendor flags {subject} ({total} checked).', { subject, total }), tone: '', link };
  }
  if (report.status === 'not-found') return { text: t('VirusTotal has no report for {subject}.', { subject }), tone: '', link };
  if (report.status === 'skipped' && report.reason === 'limit') return { text: t('VirusTotal’s free limit was reached, so the rest was not checked. Try again later.'), tone: '', link: '' };
  return null;
}
function appendVirusTotal(node, info) {
  node.append(el('span', '', info.text));
  if (info.link) node.append(button(t('View report'), 'text-button', 'external', () => attempt(() => api.openExternal(info.link))));
}
function virusTotalLine(report, className) {
  const info = virusTotalSummary(report); if (!info) return null;
  const line = el('p', `${className} ${info.tone}`.trim()); appendVirusTotal(line, info); return line;
}
function captureStateLabel(item) {
  if (item.status === 'ready') return item.verdict?.level === 'warning' ? t('Needs your OK') : t('Ready');
  return { checking: t('Checking'), manual: t('Needs your browser'), unavailable: t('Unavailable'), blocked: t('Blocked'), queued: t('Added'), duplicate: t('Already in Downloads'), 'sent-to-browser': t('Sent to browser') }[item.status] || t('Waiting');
}
// Names that a Nexus Mods page showed are that site's words, not Ravenshelf's.
// They are shown in quotes. Every quote mark in them, and every character
// that looks like one, becomes a plain apostrophe, and several in a row become
// one. So a name cannot close the quotes and read on as if Ravenshelf were
// speaking, not even with two marks that look like one closing quote.
const QUOTE_LIKE = /[\p{Pi}\p{Pf}"'`\u00b4\u02ba\u02bb\u02bc\u02dd\u02ee\u05f3\u05f4\u201a\u201e\u2032-\u2037\u275b-\u275e\u276e\u276f\u2e42\u3003\u301d-\u301f\uff02\uff07\uff40]+/gu;
function modText(value) { return typeof value === 'string' ? value.replace(QUOTE_LIKE, "'").trim() : ''; }
function modParts(mod) {
  if (!mod || mod.site !== 'nexusmods') return null;
  const name = modText(mod.modName), game = modText(mod.gameName) || modText(mod.game);
  return { name, number: Number.isSafeInteger(mod.modId) && mod.modId > 0 ? mod.modId : 0, game };
}
// The quote marks around such a name: “ ” in English, angle quotes in Arabic.
const QUOTES = () => i18n.arabic ? ['\u00ab', '\u00bb'] : ['\u201c', '\u201d'];
// A file downloaded on Nexus Mods, in one line: “mod name” · “game”.
function modLabel(mod) {
  const parts = modParts(mod);
  if (!parts) return '';
  const [open, close] = QUOTES();
  return [parts.name ? open + parts.name + close : parts.number ? t('Mod {number}', { number: parts.number }) : '', parts.game ? open + parts.game + close : ''].filter(Boolean).join(' · ');
}
// The same for the review window, where it sits beside Ravenshelf's own words:
// each name is its own piece of text, kept apart from the sentence around it.
function modLine(item) {
  const parts = modParts(item.mod);
  if (!parts || (!parts.name && !parts.number && !parts.game)) return null;
  const line = el('p', 'capture-mod'), [open, close] = QUOTES();
  line.append(el('span', '', t('Nexus Mods file:') + ' '));
  if (parts.name) line.append(el('span', '', open), el('bdi', '', parts.name), el('span', '', close));
  else if (parts.number) line.append(el('span', '', t('mod {number}', { number: parts.number })));
  if (parts.game) line.append(el('span', '', (parts.name || parts.number) ? ' ' + t('for') + ' ' : ''), el('span', '', open), el('bdi', '', parts.game), el('span', '', close));
  line.append(el('span', '', '.'));
  // Where it will be saved is said only while that is still what will happen.
  // The folder's name comes from the app, which is what names the folder. It
  // can hold words from the page, so it stands apart as a path, and nothing of
  // Ravenshelf's own follows it.
  if (typeof item.modFolder === 'string' && item.modFolder && ['checking', 'ready', 'queued'].includes(item.status)) line.append(el('span', '', ' ' + t('Ravenshelf saves it in your download folder, in:') + ' '), el('bdi', 'capture-folder', localMessage(item.modFolder)));
  return line;
}
function captureCard(item) {
  const card = el('article', `capture-item ${item.status || ''}`);
  const head = el('div', 'capture-head'), title = el('div', 'capture-title'), host = hostOfAddress(item.address);
  title.append(el('h3', '', item.name || t('Download')));
  title.append(el('p', 'small-text', [formatBytes(item.size, ''), host, item.pageHost && item.pageHost !== host ? t('from {host}', { host: item.pageHost }) : '', BROWSER_NAMES[item.browser] ? t('in {browser}', { browser: t(BROWSER_NAMES[item.browser]) }) : ''].filter(Boolean).join(' · ')));
  const warning = item.verdict?.level === 'warning';
  head.append(title, el('span', `capture-state ${warning && item.status === 'ready' ? 'warning' : item.status || ''}`, captureStateLabel(item)));
  card.append(head);
  const mod = modLine(item);
  if (mod) card.append(mod);
  if (item.status === 'checking') { const busy = el('p', 'busy-line'); busy.append(el('span', 'spinner'), el('span', '', t('Checking the link without opening the page…'))); card.append(busy); }
  if (item.message) card.append(el('p', 'capture-message', localMessage(item.message)));
  const reasons = (item.verdict?.reasons || []).filter(reason => reason && reason.message);
  if (reasons.length) { const list = el('ul', 'capture-reasons'); for (const reason of reasons) list.append(el('li', ['blocked', 'warning'].includes(reason.level) ? reason.level : 'info', localMessage(reason.message))); card.append(list); }
  if (Array.isArray(item.chain) && item.chain.length > 1) card.append(el('p', 'small-text', t('Redirects: {hops}', { hops: redirectChain(item.chain) })));
  for (const report of item.virusTotal || []) { const line = virusTotalLine(report, 'virustotal-line'); if (line) card.append(line); }
  const decidable = ['ready', 'manual'].includes(item.status);
  if (warning && decidable) {
    const label = el('label', 'check-label'), confirm = el('input');
    confirm.type = 'checkbox'; confirm.checked = acknowledgedCaptures.has(item.id);
    confirm.addEventListener('change', () => {
      if (confirm.checked) acknowledgedCaptures.add(item.id); else acknowledgedCaptures.delete(item.id);
      $$('[data-needs-ack]', card).forEach(node => { node.disabled = !confirm.checked; });
    });
    label.append(confirm, el('span', '', t('I understand the warning and want to continue')));
    card.append(label);
  }
  const actions = el('div', 'inline-fields capture-actions');
  const act = (action, text, className, glyph, needsAck) => {
    const node = button(text, className, glyph, async () => {
      node.disabled = true;
      try {
        const result = await api.browserCaptureAction({ id: item.id, action, acknowledgeRisk: acknowledgedCaptures.has(item.id) });
        if (Array.isArray(result?.captures)) { browserState = { ...browserState, bridge: result }; capturesShown = ''; afterBrowserState(); }
        if (action === 'download') toast(result?.added === 0 ? t('This file is already in your Downloads list.') : t('Added to your downloads.'));
        if (action === 'browser') toast(t('Opened in your browser. This one downloads there without going through Ravenshelf again.'));
      } catch (error) { toast(errorText(error), true); node.disabled = false; }
    });
    if (needsAck) { node.dataset.needsAck = '1'; node.disabled = !acknowledgedCaptures.has(item.id); }
    return node;
  };
  if (item.status === 'ready') actions.append(act('download', warning ? t('Download anyway') : t('Download'), 'button primary compact', 'download', warning));
  if (decidable) actions.append(act('browser', t('Download in browser instead'), 'button secondary compact', 'external', warning));
  if (['ready', 'manual', 'unavailable'].includes(item.status)) actions.append(act('recheck', t('Check again'), 'text-button', 'refresh', false));
  actions.append(act('dismiss', t('Dismiss'), 'text-button', 'close', false));
  card.append(actions);
  return card;
}
function renderBrowserCaptures() {
  const captures = captureList(), key = JSON.stringify(captures);
  if (key === capturesShown) return;
  capturesShown = key;
  const container = $('#browser-captures');
  if (!captures.length) { const empty = el('div', 'empty-state'); emptyState(empty, t('Nothing waiting'), t('Downloads you start in your browser appear here, checked before anything is saved.'), 'shield'); container.replaceChildren(empty); return; }
  container.replaceChildren(...captures.map(captureCard));
}
function renderBrowserSettings() {
  const card = $('#browser-card'); if (!card) return;
  card.hidden = !browserFeatureAvailable() || !browserState;
  if (card.hidden) return;
  const b = browserState, enabled = b.enabled === true, toggle = $('#browser-enabled');
  if (document.activeElement !== toggle || !browserBusy) toggle.checked = enabled || b.phase === 'starting';
  toggle.disabled = !b.supported || b.phase === 'starting' || browserBusy;
  let text = '', tone = '';
  const contact = b.bridge?.contact;
  if (!b.supported) text = t('The browser extension works with Ravenshelf on Windows.');
  else if (b.phase === 'starting') text = t('Connecting…');
  else if (b.phase === 'error' && b.problem) { text = localMessage(b.problem); tone = 'error'; }
  else if (!enabled) text = t('Off. Downloads in your browser are not sent to Ravenshelf.');
  else if (contact) {
    text = t('Connected: the extension in {browser} (version {version}) was last in touch {time}.', { browser: BROWSER_NAMES[contact.browser] ? t(BROWSER_NAMES[contact.browser]) : t('your browser'), version: String(contact.extensionVersion), time: timeAgo(contact.at) });
    if (contact.extensionVersion !== b.appVersion) { text += ' ' + t('It is out of date: on your browser’s extensions page, choose Reload for Ravenshelf.'); tone = 'warn'; }
  } else text = t('On. Load the extension in your browser with the steps below.');
  if (b.phase === 'on' && b.problem) { text = `${text} ${localMessage(b.problem)}`; tone = 'warn'; }
  const status = $('#browser-status');
  status.textContent = text; status.className = `small-text browser-status ${tone}`.trim();
  $('#browser-setup').hidden = !enabled;
  for (const browser of ['chromium', 'firefox']) $(`#open-${browser}-folder`).disabled = browserBusy;
  const lists = b.threatLists || {}, sources = Array.isArray(lists.sources) ? lists.sources : [];
  const failed = sources.filter(source => source.error).length, loaded = sources.filter(source => source.count).length;
  const count = value => Number(value).toLocaleString(i18n.arabic ? i18n.locale : 'en');
  $('#threat-status').textContent = lists.updating ? t('Updating the lists…')
    : lists.total ? (lists.updatedAt ? tn(loaded, '{count} dangerous sites from {n} list, updated {time}.', '{count} dangerous sites from {n} lists, updated {time}.', { count: count(lists.total), time: timeAgo(lists.updatedAt) }) : tn(loaded, '{count} dangerous sites from {n} list.', '{count} dangerous sites from {n} lists.', { count: count(lists.total) }))
      + (failed ? ' ' + tn(failed, 'One list could not be updated; the previous copy is still used.', '{n} lists could not be updated; the previous copy is still used.') : '')
    : t('The lists download a few seconds after you connect. Site blocking starts once they arrive.');
  $('#update-threat-lists').disabled = !enabled || lists.updating || browserBusy;
  $('#threat-sources').replaceChildren(...sources.map(source => el('li', '', t('{list}: {count} entries · {source} ({license})', { list: localMessage(String(source.label || '').replace(/^./, c => c.toUpperCase())), count: count(source.count || 0), source: String(source.source), license: String(source.license) }))));
  const vt = b.virusTotal || {};
  $('#vt-status').textContent = !vt.protectedStorage ? t('Windows protected storage is unavailable on this account, so a key cannot be saved.')
    : vt.problem ? localMessage(vt.problem)
    : vt.configured ? t('Key saved and sealed with Windows protected storage. {used} of {limit} lookups used today.', { used: vt.usage?.day || 0, limit: vt.usage?.perDay || 500 })
    : t('No key saved. You can create a free key in your VirusTotal account.');
  $('#vt-clear').hidden = !vt.configured && !vt.problem;
  for (const [id, key] of [['vt-domains', 'domainChecks'], ['vt-files', 'fileChecks']]) { const node = $('#' + id); node.checked = vt[key] !== false; node.disabled = !vt.configured || browserBusy; }
}
function renderDownloadReputation(node, item) {
  const report = item.reputation?.virusTotal;
  node.replaceChildren();
  node.hidden = item.origin !== 'browser' && !report;
  if (node.hidden) return;
  if (item.origin === 'browser') node.append(el('span', 'origin-chip', item.kind === 'media' ? t('From YouTube') : modLabel(item.mod) ? t('From Nexus Mods') : t('From your browser')));
  const info = report ? virusTotalSummary({ ...report, kind: 'file', subject: t('this file') }) : null;
  if (info) appendVirusTotal(node, info);
  node.className = `download-reputation ${info?.tone || ''}`.trim();
}
async function browserTask(work, success) {
  browserBusy = true; renderBrowserSettings();
  try {
    const result = await work();
    if (result && typeof result === 'object' && 'phase' in result) { browserState = result; afterBrowserState(); }
    if (success) toast(success);
    return result;
  } catch (error) {
    toast(errorText(error), true);
    try { applyState(await api.getState()); } catch {}
    return undefined;
  } finally { browserBusy = false; renderBrowserSettings(); }
}
function wireBrowserEvents() {
  $('#browser-captures-button').addEventListener('click', () => { capturesShown = ''; showDialog($('#browser-dialog')); renderBrowserCaptures(); });
  $('#browser-enabled').addEventListener('change', event => {
    const enabled = event.target.checked;
    browserTask(() => api.setBrowserIntegration(enabled), enabled ? t('The browser extension can connect now. Load it with the steps below.') : t('The browser extension is disconnected.'));
  });
  for (const browser of ['chromium', 'firefox']) $(`#open-${browser}-folder`).addEventListener('click', () => browserTask(() => api.openBrowserExtensionFolder(browser)));
  $('#copy-chromium-page').addEventListener('click', () => attempt(() => api.copyText('chrome://extensions'), t('Copied. Paste it into your browser’s address bar.')));
  $('#copy-firefox-page').addEventListener('click', () => attempt(() => api.copyText('about:debugging#/runtime/this-firefox'), t('Copied. Paste it into Firefox’s address bar.')));
  $('#update-threat-lists').addEventListener('click', () => browserTask(() => api.updateThreatLists(), t('Protection lists checked.')));
  $('#vt-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#vt-key'), key = input.value.trim();
    if (!key) { toast(t('Paste your VirusTotal API key first.'), true); return; }
    browserTask(async () => { const result = await api.setVirusTotalKey(key); input.value = ''; return result; }, t('VirusTotal key saved.'));
  });
  $('#vt-clear').addEventListener('click', () => browserTask(() => api.clearVirusTotalKey(), t('VirusTotal key removed.')));
  for (const [id, key] of [['vt-domains', 'domainChecks'], ['vt-files', 'fileChecks']]) $('#' + id).addEventListener('change', event => browserTask(() => api.saveVirusTotalSettings({ [key]: event.target.checked }), t('Preference saved.')));
}
// ---- YouTube downloads: one-time setup, quality for right-click downloads ----
let mediaState = null, mediaBusy = false, mediaRequestsSeen = null, lastMediaPhase = null;
const MEDIA_QUALITY_LABELS = { best: later('Best quality'), 1080: later('1080p'), 720: later('720p'), 480: later('480p'), 'audio-m4a': later('Audio (M4A)'), 'audio-mp3': later('Audio (MP3)') };
function mediaFeatureAvailable() { return typeof api?.setUpYouTube === 'function'; }
function mediaTools() { return mediaState?.tools || {}; }
function mediaWaiting() { return Array.isArray(mediaState?.waiting) ? mediaState.waiting : []; }
function mediaStatus() {
  const tools = mediaTools();
  if (!mediaState?.supported) return { text: t('YouTube downloads work with Ravenshelf on Windows.'), tone: '' };
  if (tools.phase === 'installing') return { text: `${tools.message ? localMessage(tools.message) : t('Setting up…')} ${t('{percent}%', { percent: Math.round((Number(tools.progress) || 0) * 100) })}`, tone: '' };
  if (tools.phase === 'ready') return { text: t('Ready. Use the Ravenshelf button in YouTube’s player, or right-click a video.'), tone: 'ok' };
  if (['damaged', 'error'].includes(tools.phase)) return { text: tools.message ? localMessage(tools.message) : t('Setup did not finish. Try again.'), tone: 'error' };
  const text = t('Not set up yet. Setup downloads {download} once (about {disk} on disk) from the programs’ official GitHub releases and checks every file before use.', { download: formatBytes(tools.downloadBytes, t('about 180 MB')), disk: formatBytes(tools.diskBytes, t('{size} MB', { size: 330 })) });
  return { text: tools.message ? `${localMessage(tools.message)} ${text}` : text, tone: '' };
}
function toolLines(target) {
  target.replaceChildren(...(Array.isArray(mediaTools().tools) ? mediaTools().tools : []).map(tool => el('li', '', `${tool.name} ${tool.version} · ${localMessage(tool.license)} · ${tool.source}`)));
}
function renderYouTubeSettings() {
  const card = $('#youtube-card'); if (!card) return;
  card.hidden = !mediaState;
  if (card.hidden) return;
  const tools = mediaTools(), phase = tools.phase, status = mediaStatus(), waiting = mediaWaiting().length;
  $('#youtube-status').textContent = status.text;
  $('#youtube-status').className = `small-text browser-status ${status.tone}`.trim();
  const progress = $('#youtube-progress');
  progress.hidden = phase !== 'installing'; progress.value = Math.round((Number(tools.progress) || 0) * 100);
  const setup = $('#youtube-setup');
  setup.hidden = !mediaState.supported || ['installing', 'ready'].includes(phase);
  setup.textContent = phase === 'damaged' ? t('Set up again') : phase === 'error' ? t('Try setup again') : t('Set up YouTube downloads');
  setup.disabled = mediaBusy;
  $('#youtube-cancel').hidden = phase !== 'installing';
  $('#youtube-remove').hidden = !['ready', 'damaged'].includes(phase);
  $('#youtube-remove').disabled = mediaBusy;
  $('#youtube-waiting').hidden = !waiting;
  $('#youtube-waiting').textContent = tn(waiting, 'One YouTube video is waiting. It starts when setup finishes.', '{n} YouTube videos are waiting. They start when setup finishes.');
  $('#youtube-dismiss').hidden = !waiting || phase === 'installing';
  const select = $('#youtube-quality'), qualities = Array.isArray(mediaState.qualities) ? mediaState.qualities : [];
  const choices = qualities.map(choice => choice.id).join(',');
  if (select.dataset.choices !== choices) { select.replaceChildren(...qualities.map(choice => { const option = el('option', '', localMessage(choice.label)); option.value = choice.id; return option; })); select.dataset.choices = choices; }
  if (document.activeElement !== select) select.value = mediaState.quality || '1080';
  select.disabled = mediaBusy;
  toolLines($('#youtube-tools'));
}
function renderYouTubeDialog() {
  const tools = mediaTools(), phase = tools.phase, status = mediaStatus(), waiting = mediaWaiting().length;
  toolLines($('#youtube-dialog-tools'));
  $('#youtube-dialog-intro').textContent = tn(waiting, 'A YouTube video is waiting. Ravenshelf downloads YouTube videos with three free helper programs: setup gets them once ({size}) from their official GitHub releases and checks every file before use.', '{n} YouTube videos are waiting. Ravenshelf downloads YouTube videos with three free helper programs: setup gets them once ({size}) from their official GitHub releases and checks every file before use.', { size: formatBytes(tools.downloadBytes, t('about 180 MB')) });
  $('#youtube-dialog-status').textContent = phase === 'missing' && !tools.message ? '' : status.text;
  $('#youtube-dialog-status').className = `small-text browser-status ${status.tone}`.trim();
  const progress = $('#youtube-dialog-progress');
  progress.hidden = phase !== 'installing'; progress.value = Math.round((Number(tools.progress) || 0) * 100);
  const setup = $('#youtube-dialog-setup');
  setup.hidden = phase === 'installing';
  setup.textContent = ['damaged', 'error'].includes(phase) ? t('Try setup again') : t('Set up and download');
  setup.disabled = mediaBusy || !mediaState?.supported;
  $('#youtube-dialog-cancel').hidden = phase !== 'installing';
  $('#youtube-dialog-later').hidden = phase === 'installing';
}
// Called after every state update: opens the setup when a video arrives
// before setup, and reports when setup finishes.
function afterMediaState() {
  if (!mediaState) return;
  const phase = mediaTools().phase, requests = Number(mediaState.requests) || 0, dialog = $('#youtube-dialog');
  const arrived = mediaRequestsSeen !== null && requests > mediaRequestsSeen && mediaWaiting().length > 0 && phase !== 'ready';
  mediaRequestsSeen = requests;
  if (arrived && !$$('dialog').some(other => other.open && other !== dialog)) { renderYouTubeDialog(); showDialog(dialog); }
  if (lastMediaPhase === 'installing' && phase === 'ready') {
    toast(t('YouTube downloads are ready. Videos you send from YouTube start right away.'));
    if (dialog.open) dialog.close();
  }
  lastMediaPhase = phase;
  if (dialog.open) renderYouTubeDialog();
  if (currentView === 'settings') renderYouTubeSettings();
}
async function mediaTask(work, success) {
  mediaBusy = true; renderYouTubeSettings(); if ($('#youtube-dialog').open) renderYouTubeDialog();
  try {
    const result = await work();
    if (result && typeof result === 'object' && 'tools' in result) { mediaState = result; afterMediaState(); }
    if (success) toast(success);
    return result;
  } catch (error) {
    toast(errorText(error), true);
    try { applyState(await api.getState()); } catch {}
    return undefined;
  } finally { mediaBusy = false; renderYouTubeSettings(); if ($('#youtube-dialog').open) renderYouTubeDialog(); }
}
function wireMediaEvents() {
  for (const id of ['youtube-setup', 'youtube-dialog-setup']) $('#' + id).addEventListener('click', () => mediaTask(() => api.setUpYouTube()));
  for (const id of ['youtube-cancel', 'youtube-dialog-cancel']) $('#' + id).addEventListener('click', () => mediaTask(() => api.cancelYouTubeSetup()));
  $('#youtube-remove').addEventListener('click', () => mediaTask(() => api.removeYouTubeTools(), t('The YouTube helper programs were removed.')));
  $('#youtube-dismiss').addEventListener('click', () => mediaTask(() => api.dismissYouTubeRequests(), t('Waiting YouTube videos dismissed.')));
  $('#youtube-dialog-later').addEventListener('click', async () => { $('#youtube-dialog').close(); await mediaTask(() => api.dismissYouTubeRequests()); });
  $('#youtube-quality').addEventListener('change', event => mediaTask(() => api.saveYouTubeSettings({ quality: event.target.value }), t('Preference saved.')));
}
// A new language reloads the window in it, back on the Settings page.
async function changeLanguage(choice, control) {
  control.disabled = true;
  try { sessionStorage.setItem('ravenshelf.view', 'settings'); } catch {}
  try { await api.setLanguage(choice); }
  catch (error) {
    try { sessionStorage.removeItem('ravenshelf.view'); } catch {}
    toast(errorText(error), true); control.disabled = false; renderSettings();
  }
}
// The page to show after the window was loaded again for a new language.
function returningView() {
  try { const view = sessionStorage.getItem('ravenshelf.view'); sessionStorage.removeItem('ravenshelf.view'); return view; } catch { return null; }
}
async function start() {
  i18n.applyTo(document); hydrateIcons(); wireEvents();
  if (!api) {
    $('#catalog-meta').textContent = t('Desktop connection unavailable');
    emptyState($('#catalog-empty'), t('Open Ravenshelf from the desktop app'), t('The desktop app connects this library to the catalog and your download folder.'), 'alert');
    return;
  }
  if (typeof api.onState === 'function') api.onState(applyState);
  if (typeof api.onProgress === 'function') api.onProgress(applyProgress);
  try { applyState(await api.getState()); }
  catch (error) { toast(t('Couldn’t load your saved preferences: {reason}', { reason: errorText(error) }), true); }
  const returning = returningView();
  if (returning === 'settings') showView('settings');
  if(featureUIAvailable()){
    if(typeof api.getUpdateState==='function')api.getUpdateState().then(update=>{state.updater=update;renderUpdater();}).catch(()=>{});
    if(typeof api.getClipboardInbox==='function')refreshClipboard();
    if(typeof api.getVerificationState==='function')api.getVerificationState().then(value=>{verificationState=value;renderVerification();}).catch(()=>{});
  }
  try{const sections=await api.getCatalogSections();if(Array.isArray(sections)&&sections.length)catalogSections=sections;}
  catch(error){toast(t('Some catalogue sections are unavailable: {reason}',{reason:errorText(error)}),true);}
  renderCatalogSections();
  await loadCatalog({ page: 1, search: '' });
  catalogAutoReady = true;
  flushCatalogCheck();
}
start();
