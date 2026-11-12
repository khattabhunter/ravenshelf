'use strict';
// The Mods section: mod files downloaded on Nexus Mods, grouped by game, with
// the mod's page opened in the user's own browser from the saved label only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ api = {}, locale } = {}) {
  const nodes = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.events = new Map(); this._text = ''; this.className = ''; this.hidden = false; this.value = ''; this.type = ''; }
    set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
    append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; this._text = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); } removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, listener) { const listeners = this.events.get(name) || []; listeners.push(listener); this.events.set(name, listeners); }
    async emit(name, event = {}) { for (const listener of this.events.get(name) || []) await listener(event); }
    querySelector(selector) { return get(selector); } querySelectorAll() { return []; } scrollIntoView() {}
  }
  function get(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
  const document = { querySelector: get, querySelectorAll: () => [], createElement: tag => new Element(tag), addEventListener() {}, documentElement: { style: { setProperty() {} } } };
  const context = vm.createContext({ window: { atlas: api, scrollTo() {} }, document, URL, console, setTimeout, clearTimeout, RAVENSHELF_LOCALE: locale });
  vm.runInContext(read('src/renderer/i18n.js'), context);
  vm.runInContext(read('src/renderer/app.js').replace(/start\(\);\s*$/, ''), context);
  const run = code => vm.runInContext(code, context);
  run('toast=()=>{};');
  const all = root => [root, ...root.children.flatMap(all)];
  return { get, run, all, context };
}
const mod = (game, gameName, modId, modName, fileName) => ({ site: 'nexusmods', game, gameId: 1, modId, fileId: 2, gameName, modName, fileName });
const DOWNLOADS = [
  { id: 'b', name: 'Better Bags.zip', status: 'downloading', total: 0, createdAt: '2026-11-02T10:00:00Z', mod: mod('stardewvalley', 'Stardew Valley', 777, 'Better Bags', 'Better Bags.zip') },
  { id: 'a', name: 'SkyUI_5_2.7z', status: 'completed', total: 3 * 1024 * 1024, createdAt: '2026-11-01T10:00:00Z', mod: mod('skyrimspecialedition', 'Skyrim Special Edition', 12604, 'SkyUI', 'SkyUI main file') },
  { id: 'c', name: 'Patch.7z', status: 'error', total: 0, createdAt: '2026-11-03T10:00:00Z', mod: mod('skyrimspecialedition', 'Skyrim Special Edition', 31337, 'Unofficial Patch', 'Patch.7z') },
  { id: 'd', name: 'game.part1.rar', status: 'completed', total: 10, gameTitle: 'Some Game' },
  { id: 'e', name: 'clip.mp4', status: 'completed', kind: 'media', total: 10 },
  { id: 'f', name: 'other.zip', status: 'completed', total: 10, mod: { site: 'elsewhere', game: 'x', modId: 1, modName: 'Other Site Mod' } }
];

test('mods are listed by game, newest first, with their file and status; other downloads are not', async () => {
  const opened = [], actions = [];
  const f = fixture({ api: { openModPage: async value => { opened.push(value); }, downloadAction: async value => { actions.push(value); }, openModsFolder: async () => {} } });
  f.context.__downloads = DOWNLOADS;
  f.run('state.downloads = __downloads; renderMods()');
  const games = f.get('#mods-list').children;
  assert.deepEqual(games.map(game => game.children[0].children[0].textContent), ['Skyrim Special Edition', 'Stardew Valley']);
  assert.deepEqual(games.map(game => game.children[0].children[1].textContent), ['2 files', '1 file']);
  const skyrim = games[0].children[1].children;
  assert.deepEqual(skyrim.map(card => card.children[0].textContent), ['Unofficial Patch', 'SkyUI'], 'newest first');
  assert.equal(skyrim[1].children[1].textContent, 'SkyUI main file \u00b7 SkyUI_5_2.7z');
  assert.equal(skyrim[1].children[2].textContent, 'Completed \u00b7 3.0 MB');
  assert.equal(skyrim[0].children[2].textContent, 'Needs attention');
  assert.equal(skyrim[0].children[2].className, 'mod-status error');
  assert.equal(f.get('#mods-summary').textContent, '3 mod files');
  assert.equal(f.get('#mods-empty').hidden, true);
  // Mod page opens by download id only; the window never builds the address.
  const [pageButton, fileButton] = skyrim[1].children[3].children;
  assert.equal(pageButton.textContent, 'Mod page'); await pageButton.emit('click'); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ id: 'a' }]);
  assert.equal(fileButton.textContent, 'Show file'); await fileButton.emit('click'); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [{ id: 'a', action: 'openFolder' }]);
  // A file still downloading points to the Downloads page instead.
  const stardew = games[1].children[1].children[0];
  assert.equal(stardew.children[3].children[1].textContent, 'See in Downloads');
  assert.equal(stardew.children[1].textContent, 'Better Bags.zip', 'the same name is shown once');
  assert.doesNotMatch(JSON.stringify(f.all(f.get('#mods-list')).map(node => node.textContent)), /game\.part1|clip\.mp4|Other Site Mod/, 'only files labelled as Nexus Mods files');
});

test('search narrows the mods, and an empty list explains how mods get here', () => {
  const f = fixture();
  f.context.__downloads = DOWNLOADS;
  f.get('#mods-search').value = 'stardew';
  f.run('state.downloads = __downloads; renderMods()');
  assert.deepEqual(f.get('#mods-list').children.map(game => game.children[0].children[0].textContent), ['Stardew Valley']);
  assert.equal(f.get('#mods-summary').textContent, '1 of 3 mod files');
  f.get('#mods-search').value = 'patch.7z';
  f.run('renderMods()');
  assert.equal(f.get('#mods-list').children.length, 1);
  f.get('#mods-search').value = 'nothing like this';
  f.run('renderMods()');
  assert.equal(f.get('#mods-list').children.length, 0);
  assert.equal(f.get('#mods-empty').hidden, false);
  assert.match(f.get('#mods-empty').textContent, /No matching mods/);
  f.get('#mods-search').value = '';
  f.context.__none = [DOWNLOADS[3]];
  f.run('state.downloads = __none; renderMods()');
  assert.match(f.get('#mods-empty').textContent, /No mods yet.*Nexus Mods switch/);
  assert.equal(f.get('#mods-summary').textContent, '');
});

test('the Mods page in Arabic', () => {
  const AR = JSON.parse(read('src/locales/ar.json'));
  const f = fixture({ locale: { language: 'ar', digits: 'latn', messages: AR } });
  f.context.__downloads = DOWNLOADS;
  f.run('state.downloads = __downloads; renderMods()');
  const games = f.get('#mods-list').children;
  // Names from Nexus Mods keep their own direction inside the Arabic page.
  assert.equal(games[0].children[0].children[0].textContent, '\u2068Skyrim Special Edition\u2069');
  assert.equal(games[0].children[0].children[1].textContent, AR['{n} files'].two);
  assert.equal(f.get('#mods-summary').textContent, AR['{n} mod files'].few.replace('{n}', '3'));
});

test('the main process opens a mod page only from the saved, checked label', () => {
  const main = read('src/main.cjs');
  const handler = /handle\('openModPage',options=>\{([\s\S]*?)\n  \}\);/.exec(main);
  assert.ok(handler, 'openModPage is handled');
  assert.match(handler[1], /manager\.downloads\.find\(x=>x\.id===options\?\.id\)/);
  assert.match(handler[1], /modContext\(d\?\.mod\)/);
  assert.match(handler[1], /shell\.openExternal\(`https:\/\/www\.nexusmods\.com\/\$\{mod\.game\}\/mods\/\$\{mod\.modId\}`\)/);
  // What modContext lets through can only form that one kind of address.
  const { modContext } = require('../src/mods.cjs');
  for (const bad of [{ site: 'nexusmods', game: '../evil', modId: 1 }, { site: 'nexusmods', game: 'a', modId: 0 }, { site: 'nexusmods', game: 'a/b', modId: 1 }, { site: 'other', game: 'a', modId: 1 }, { site: 'nexusmods', game: 'A', modId: 1 }])
    assert.throws(() => modContext(bad));
  const preload = read('src/preload.cjs');
  for (const name of ['openModPage', 'openModsFolder']) assert.match(preload, new RegExp(`'${name}'`));
});
