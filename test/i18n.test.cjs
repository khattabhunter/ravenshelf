'use strict';
// The Arabic language: every text of the window has an Arabic version, the
// Arabic message file is well formed, and the translator fills in values,
// numbers and plurals the same way everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I18N = require('../src/renderer/i18n.js');
const main = require('../src/i18n.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const AR = JSON.parse(read('src/locales/ar.json'));
const APP = read('src/renderer/app.js');
const HTML = read('src/renderer/index.html');
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

// Every English text the window translates: t('…'), later('…'), tn(n, '…', '…')
// in app.js, and the data-i18n texts and data-i18n-attr attributes of the page.
function windowTexts() {
  const LIT = "'((?:[^'\\\\]|\\\\.)*)'";
  // The text of a quoted literal, its escapes read in one pass.
  const unquote = s => s.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (m, hex, ch) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: '\n', t: '\t', r: '\r' })[ch] || ch);
  const keys = new Set(), plurals = new Map();
  for (const m of APP.matchAll(new RegExp('\\b(?:t|later)\\(\\s*' + LIT, 'g'))) keys.add(unquote(m[1]));
  const calls = [...APP.matchAll(new RegExp('\\btn\\(([^,]+?),\\s*' + LIT + ',\\s*' + LIT, 'g'))];
  for (const m of calls) plurals.set(unquote(m[3]), unquote(m[2]));
  const decode = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
  for (const m of HTML.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g)) keys.add(decode(m[2]).replace(/\s+/g, ' ').trim());
  for (const m of HTML.matchAll(/<[^>]*data-i18n-attr="([^"]*)"[^>]*>/g)) {
    for (const name of m[1].split(/\s+/)) {
      const value = new RegExp('\\s' + name + '="([^"]*)"').exec(m[0]);
      assert.ok(value, `data-i18n-attr names ${name}, which the element has`);
      keys.add(decode(value[1]));
    }
  }
  return { keys, plurals, tnCalls: (APP.match(/\btn\(/g) || []).length, tnParsed: calls.length };
}

test('every text of the window has an Arabic version', () => {
  const { keys, plurals, tnCalls, tnParsed } = windowTexts();
  assert.equal(tnParsed, tnCalls, 'every tn() call has two literal English forms');
  assert.ok(keys.size > 600, 'the collector finds the window texts');
  assert.ok(!keys.has(''), 'no data-i18n element is empty');
  const missing = [...keys].filter(key => !plurals.has(key) && typeof AR[key] !== 'string');
  assert.deepEqual(missing, []);
  for (const [other] of plurals) assert.equal(typeof AR[other], 'object', `plural "${other}" has its six Arabic forms`);
});

test('the Arabic message file is well formed', () => {
  const NAMES = new Set(['1080p', '480p', '720p', 'DirectX {version}', 'Epic Games', 'Firefox', 'GOG', 'HaGeZi Pop-Up Ads',
    'HaGeZi Threat Intelligence Feeds (mini)', 'Ravenshelf', 'SSD', 'Steam', 'Windows', 'YouTube', '{width} × {height}']);
  const check = (key, value, form) => {
    assert.equal(typeof value, 'string', key);
    assert.equal(value, value.trim(), `${key}: no space at either end`);
    assert.doesNotMatch(value, /[<>]/, `${key}: no markup`);
    // Direction marks are added by the code where needed, never stored.
    assert.doesNotMatch(value, /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/, `${key}: no invisible characters`);
    const want = placeholders(key), got = placeholders(value);
    if (['zero', 'one', 'two'].includes(form)) assert.deepEqual(got.filter(n => n !== 'n'), want.filter(n => n !== 'n'), key);
    else assert.deepEqual(got, want, `${key}: the same {values}`);
    // A text of only {values} and signs, such as quotation marks, has no words to translate.
    if (!NAMES.has(key) && /[A-Za-z]/.test(key.replace(/\{\w+\}/g, ''))) assert.match(value, /[\u0600-\u06ff]/, `${key}: is Arabic`);
  };
  const keys = Object.keys(AR);
  assert.deepEqual(keys, [...keys].sort(), 'kept in sorted order');
  for (const [key, value] of Object.entries(AR)) {
    if (typeof value === 'string') { check(key, value); continue; }
    assert.deepEqual(Object.keys(value), FORMS, `${key}: the six Arabic plural forms`);
    for (const form of FORMS) check(key, value[form], form);
  }
  assert.equal(JSON.stringify(I18N.cleanMessages(AR)), JSON.stringify(AR), 'the translator keeps every entry');
  assert.deepEqual(Object.keys(I18N.cleanMessages({ a: 1, b: ['x'], c: { one: 'x' }, d: 'ok', e: { other: 'y', bad: 2 } })), ['d', 'e']);
});

test('every fixed error message of the main process has an Arabic version', () => {
  const source = read('src/public-errors.cjs');
  const { publicErrorMessage } = require('../src/public-errors.cjs');
  const fixed = new Set();
  for (const m of source.matchAll(/'((?:[^'\\]|\\.)*\.)'/g)) if (/^[A-Z]/.test(m[1]) && / /.test(m[1])) fixed.add(m[1]);
  assert.ok(fixed.size > 40);
  for (const message of fixed) {
    const shown = publicErrorMessage(new Error(message), 'nothing');
    if (shown === message) assert.equal(typeof AR[message], 'string', message);
  }
  for (const name of ['setLanguage', 'getHardware', 'download']) assert.equal(typeof AR[publicErrorMessage({}, name)], 'string', name);
  assert.equal(publicErrorMessage(new Error('Choose a language from the list.'), 'setLanguage'), 'Choose a language from the list.');
});

test('English text is used as it is', () => {
  const en = I18N.createTranslator(undefined);
  assert.equal(en.language, 'en'); assert.equal(en.direction, 'ltr'); assert.equal(en.arabic, false);
  assert.equal(en.t('Downloads'), 'Downloads');
  assert.equal(en.t('{size} MB', { size: 12 }), '12 MB');
  assert.equal(en.t('Saved to {name}', { name: 'Kingdom Come' }), 'Saved to Kingdom Come');
  assert.equal(en.tn(1, '{n} link', '{n} links'), '1 link');
  assert.equal(en.tn(0, '{n} link', '{n} links'), '0 links');
  assert.equal(en.tn(2, '{n} link', '{n} links'), '2 links');
  // An English bundle ignores any Arabic messages it is given.
  assert.equal(I18N.createTranslator({ language: 'en', messages: { Downloads: 'x' } }).t('Downloads'), 'Downloads');
  // Arabic digits are an Arabic choice only: English keeps 0-9 whatever is saved.
  assert.equal(I18N.createTranslator({ language: 'en', digits: 'arab' }).t('{size} MB', { size: 12 }), '12 MB');
});

test('Arabic text, numbers and plurals', () => {
  const ar = I18N.createTranslator({ language: 'ar', digits: 'latn', messages: AR });
  assert.equal(ar.direction, 'rtl'); assert.equal(ar.locale, 'ar-IQ-u-nu-latn');
  assert.equal(ar.t('Downloads'), AR.Downloads);
  assert.equal(ar.t('A text with no Arabic version'), 'A text with no Arabic version');
  assert.equal(ar.t('{size} MB', { size: 12 }), AR['{size} MB'].replace('{size}', '12'));
  // Names are kept as one unit so they cannot reorder the sentence around them.
  const named = ar.t('Removed {name}', { name: 'Game (2024)' });
  if (AR['Removed {name}']) assert.ok(named.includes('\u2068Game (2024)\u2069'));
  const forms = AR['{n} links'];
  const expect = { 0: 'zero', 1: 'one', 2: 'two', 3: 'few', 10: 'few', 11: 'many', 99: 'many', 100: 'other', 102: 'other', 103: 'few', 111: 'many', 1000: 'other' };
  for (const [count, form] of Object.entries(expect)) assert.equal(ar.tn(Number(count), '{n} link', '{n} links'), forms[form].replace('{n}', count), `${count} → ${form}`);

  const arab = I18N.createTranslator({ language: 'ar', digits: 'arab', messages: AR });
  assert.equal(arab.digits('12.5'), '\u0661\u0662\u066b\u0665');
  assert.equal(arab.t('{size} MB', { size: 12 }), AR['{size} MB'].replace('{size}', '\u0661\u0662'));
  assert.equal(arab.t('{size} MB', { size: '7' }), AR['{size} MB'].replace('{size}', '\u0667'));
  // Digits that belong to a name stay as written: SHA-256, 1080p, M4A, x64, H.264, GPL-3.0.
  const names = I18N.createTranslator({ language: 'ar', digits: 'arab', messages: { X: '\u0646\u0635 SHA-256 1080p M4A x64 H.264 GPL-3.0 \u06485 \u06482.5 (10)' } });
  assert.equal(names.t('X'), '\u0646\u0635 SHA-256 1080p M4A x64 H.264 GPL-3.0 \u0648\u0665 \u0648\u0662\u066b\u0665 (\u0661\u0660)');
  // English text that has no Arabic version keeps its digits.
  assert.equal(arab.t('Checking with SHA-256 in 5 steps'), 'Checking with SHA-256 in 5 steps');
  assert.equal(arab.t('Auto-checks every 5 minutes while Ravenshelf is open'), AR['Auto-checks every 5 minutes while Ravenshelf is open'].replace('5', '\u0665'));
  assert.equal(I18N.createTranslator({ language: 'ar', digits: 'nope', messages: AR }).digitStyle, 'latn');
});

test('the language setting', () => {
  assert.equal(I18N.resolveLanguage('system', ['ar-IQ', 'en-US']), 'ar');
  assert.equal(I18N.resolveLanguage('system', ['en-US', 'ar-IQ']), 'en');
  assert.equal(I18N.resolveLanguage('system', []), 'en');
  assert.equal(I18N.resolveLanguage(undefined, ['ar']), 'ar');
  assert.equal(I18N.resolveLanguage('en', ['ar-IQ']), 'en');
  assert.equal(I18N.resolveLanguage('ar', ['en-US']), 'ar');
  assert.deepEqual(main.languageChoice({ language: 'ar' }), { language: 'ar' });
  assert.deepEqual(main.languageChoice({ digits: 'arab' }), { digits: 'arab' });
  assert.deepEqual(main.languageChoice({ language: 'system', digits: 'latn' }), { language: 'system', digits: 'latn' });
  assert.throws(() => main.languageChoice({ language: 'fr' }), /Choose a language from the list\./);
  assert.throws(() => main.languageChoice({ digits: 'roman' }), /Choose how numbers are written from the list\./);
  for (const bad of [null, 'ar', [], {}, { language: 'ar', extra: 1 }]) assert.throws(() => main.languageChoice(bad), /Invalid app request\.|Choose/);
});

test('the window receives its language before the page script runs', () => {
  const script = main.windowScript({ language: 'ar', digits: 'arab' }, ['en-US']);
  const context = vm.createContext({});
  vm.runInContext(script, context);
  const bundle = context.RAVENSHELF_LOCALE;
  assert.equal(bundle.language, 'ar'); assert.equal(bundle.digits, 'arab');
  assert.equal(bundle.messages.Downloads, AR.Downloads);
  const english = vm.createContext({}); vm.runInContext(main.windowScript({ language: 'system' }, ['en-GB']), english);
  assert.equal(english.RAVENSHELF_LOCALE.language, 'en');
  assert.deepEqual(Object.keys(english.RAVENSHELF_LOCALE.messages || {}), [], 'English sends no Arabic messages');
  // The page head loads the language, then the translator; the page script comes last.
  const order = ['locale.js', 'i18n.js', 'app.js'].map(name => HTML.indexOf(`<script src="${name}"></script>`));
  assert.ok(order.every(index => index > 0) && order[0] < order[1] && order[1] < HTML.indexOf('</head>') && HTML.indexOf('<body') < order[2], 'script order');
  // In the window, the translator gives the page its language and direction at once.
  const html = {}; const page = vm.createContext({ document: { documentElement: html }, RAVENSHELF_LOCALE: bundle });
  vm.runInContext(read('src/renderer/i18n.js'), page);
  assert.deepEqual({ ...html }, { lang: 'ar', dir: 'rtl' });
});

test('applyTo translates the marked texts and attributes only in Arabic', () => {
  const element = (text, attrs = {}) => ({ textContent: text, attrs: { ...attrs }, getAttribute(name) { return this.attrs[name] ?? null; }, setAttribute(name, value) { this.attrs[name] = value; } });
  const heading = element('  Downloads\n '), input = element('', { 'data-i18n-attr': 'placeholder aria-label', placeholder: 'Search', 'aria-label': 'Search' });
  const doc = html => ({ documentElement: html, querySelectorAll: selector => selector === '[data-i18n]' ? [heading] : [input] });
  const en = {}; I18N.createTranslator(undefined).applyTo(doc(en));
  assert.deepEqual(en, { lang: 'en', dir: 'ltr' }); assert.equal(heading.textContent, '  Downloads\n ');
  const ar = {}; I18N.createTranslator({ language: 'ar', messages: AR }).applyTo(doc(ar));
  assert.deepEqual(ar, { lang: 'ar', dir: 'rtl' });
  assert.equal(heading.textContent, AR.Downloads);
  assert.equal(input.attrs.placeholder, AR.Search); assert.equal(input.attrs['aria-label'], AR.Search);
});

test('the main process reads the Arabic file once and falls back to English if it cannot', () => {
  const first = main.translator({ language: 'ar' }, []);
  assert.equal(first.t('Downloads'), AR.Downloads);
  assert.equal(main.translator({ language: 'en' }, ['ar']).t('Downloads'), 'Downloads');
  assert.equal(main.translator({}, ['ar-SA']).language, 'ar');
});

test('texts the main process fills in with values have Arabic versions, and match what it writes', () => {
  for (const template of I18N.TEMPLATES) assert.equal(typeof AR[template], 'string', template);
  for (const [one, other] of I18N.PLURAL_TEMPLATES) {
    assert.equal(typeof AR[other], 'object', other);
    assert.deepEqual(placeholders(one), placeholders(other));
  }
  // Each pattern's fixed words are written somewhere in the main process, so a
  // changed English text cannot silently stop matching.
  const source = fs.readdirSync(path.join(__dirname, '../src')).filter(name => name.endsWith('.cjs')).map(name => read('src/' + name)).join('\n');
  const BUILT = new Set(['Mods \u203a ']);
  // (Texts with a count are checked through what the main process writes, below.)
  for (const template of I18N.TEMPLATES) {
    for (const piece of template.split(/\{\w+\}/).map(part => part.trim()).filter(part => part.length >= 12 && !BUILT.has(part))) {
      const words = piece.split(/\s+/).slice(0, 4).join(' ');
      assert.ok(source.includes(words), `"${words}" (from "${template}") is written by the main process`);
    }
  }
});

test('texts from the main process are shown in Arabic, and unchanged in English', () => {
  const linkSafety = require('../src/link-safety.cjs');
  const { analyzeArchiveSet } = require('../src/archive-set-validation.cjs');
  const { publicErrorMessage } = require('../src/public-errors.cjs');
  const ar = I18N.createTranslator({ language: 'ar', messages: AR }), en = I18N.createTranslator(undefined);
  const arabic = /[\u0600-\u06ff]/;
  const messages = [
    ...linkSafety.nameReasons('holiday.jpg.exe'), ...linkSafety.nameReasons('setup.exe'), ...linkSafety.nameReasons('run.bat'),
    ...linkSafety.nameReasons('disk.iso'), ...linkSafety.nameReasons('notes.txt       .exe'),
    ...linkSafety.contentReasons('song.mp3', 'windows-program'), ...linkSafety.contentReasons('pack.zip', 'windows-program'),
    ...linkSafety.assessDownload({ filename: 'a.zip', chain: [{ host: 'a.test' }, { host: 'b.test', listed: { label: 'phishing sites' } }, { host: 'c.test' }] }).reasons,
    ...linkSafety.assessDownload({ filename: 'a.zip', virusTotal: [{ status: 'ok', kind: 'file', malicious: 3 }, { status: 'ok', kind: 'domain', subject: 'b.test', malicious: 1 }] }).reasons
  ].map(item => item.message);
  const archive = analyzeArchiveSet(['https://h.test/Game.part1.rar', 'https://h.test/Game.part3.rar', 'https://h.test/odd-name.bin']);
  messages.push(...archive.errors, ...archive.warnings);
  messages.push(publicErrorMessage(new Error('Host returned HTTP 503. Check the source link or retry.'), 'download'));
  assert.ok(messages.length >= 12);
  for (const message of messages) {
    assert.equal(en.localText(message), message, 'English is unchanged');
    assert.match(ar.localText(message), arabic, `"${message}" is shown in Arabic`);
  }
  // A name before ": " is kept as it is, and the known text after it is translated.
  assert.equal(ar.localText('Game.part1.rar: Duplicate archive part numbers were found. Choose one copy of each part.'),
    '\u2068Game.part1.rar\u2069: ' + AR['Duplicate archive part numbers were found. Choose one copy of each part.']);
  // Values that are texts of the app are translated; names are kept.
  assert.equal(ar.localText('evil.test is on Ravenshelf\u2019s list of phishing sites.'),
    AR['{host} is on Ravenshelf\u2019s list of {list}.'].replace('{host}', '\u2068evil.test\u2069').replace('{list}', '\u2068' + AR['phishing sites'] + '\u2069'));
  // A site name cannot swallow a file name put before it.
  assert.equal(ar.localText('a.rar: evil.test is on Ravenshelf\u2019s list of phishing sites.'),
    '\u2068a.rar\u2069: ' + AR['{host} is on Ravenshelf\u2019s list of {list}.'].replace('{host}', '\u2068evil.test\u2069').replace('{list}', '\u2068' + AR['phishing sites'] + '\u2069'));
  // The chain of sites runs right to left, with arrows to match.
  const chain = ar.localText('The link passed through 2 other sites: a.test → b.test → c.test.');
  assert.ok(chain.includes('\u2068a.test\u2069 \u2190 \u2068b.test\u2069 \u2190 \u2068c.test\u2069'), chain);
  assert.equal(ar.localText('The link passed through 1 other site: a.test → b.test.'), AR['The link passed through {n} other sites: {chain}.'].one.replace('{chain}', '\u2068\u200f\u2068a.test\u2069 \u2190 \u2068b.test\u2069\u2069'));
  // Several known sentences, as in a catalogue notice.
  const notice = 'Monthly source popularity, not a review score. Explicitly adult-tagged entries are hidden in this showcase; source positions are preserved. 2 adult-tagged entries are hidden on this page.';
  assert.equal(ar.localText(notice), AR['Monthly source popularity, not a review score. Explicitly adult-tagged entries are hidden in this showcase; source positions are preserved.'] + ' ' + AR['{n} adult-tagged entries are hidden on this page.'].two);
  // Lines: known lines are translated, a source page's own notes are kept.
  assert.equal(ar.localText('Source-reported installation notes (not independently verified):\nUnpack part 1 first.'),
    AR['Source-reported installation notes (not independently verified):'] + '\nUnpack part 1 first.');
  // Unknown text is shown as it came, in both languages.
  for (const text of ['Something only the source says.', 'a: b', '', 'x\ny']) { assert.equal(ar.localText(text), text); assert.equal(en.localText(text), text); }
  assert.equal(ar.localText(undefined), undefined); assert.equal(ar.localText(42), 42);
});

test('the main process translates its own fixed texts', () => {
  const source = read('src/main.cjs');
  const keys = [...source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1]);
  assert.ok(keys.length >= 20, 'menu labels and window titles');
  for (const key of keys) assert.equal(typeof AR[key], 'string', key);
  for (const text of ['Choose download folder', 'Choose an installed game or game library folder', 'Export download links', 'Ravenshelf links', 'Link list',
    'Could not queue file', 'Ravenshelf could not start', 'Choose an SFV, MD5 or SHA-256 checksum file', 'Checksum manifests', 'Choose the extracted game folder to verify',
    'Review a download in Ravenshelf', 'Ravenshelf blocked a download', 'Check this download before opening it', 'Ravenshelf update available', 'Ravenshelf update ready',
    'A download has finished.', 'Downloads have finished.', 'Set up YouTube downloads', 'It failed Ravenshelf\u2019s safety checks.', 'a downloaded file'])
    assert.equal(typeof AR[text], 'string', text);
  // Notifications, dialogs and the error box go through the translation.
  assert.match(source, /Notification:LocalNotification/);
  assert.doesNotMatch(source.replace(/const localDialog=\{[\s\S]*?\n\};/, ''), /\bdialog\.show/);
});
