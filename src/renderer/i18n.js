'use strict';
// Ravenshelf's two languages, English and Arabic. The English text written in
// the code is the key: Arabic is looked up by it in the Arabic message file,
// and English is used as it is. Shared by the window, the main process and the
// tests, so every part of the app translates and fills in values the same way.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RavenshelfI18n = api;
    // In the window this file loads in the page head, after locale.js, so the
    // page has its language and direction before it is first drawn.
    const html = root.document && root.document.documentElement;
    if (html) { const early = api.createTranslator(root.RAVENSHELF_LOCALE); html.lang = early.language; html.dir = early.direction; }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGUAGES = Object.freeze(['en', 'ar']);
  const SETTINGS = Object.freeze(['system', 'en', 'ar']);
  const DIGITS = Object.freeze(['latn', 'arab']);
  const PLURAL_FORMS = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);
  const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
  // A value put into Arabic text is kept in its own direction, so a file name
  // or an address written left to right is not jumbled by the text around it.
  const ISOLATE_START = '\u2068', ISOLATE_END = '\u2069';
  const ARABIC_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  // Texts the main process writes with values in them, in English. They reach
  // the window and the notifications already filled in, so they are found by
  // these patterns, and the values found are put into the Arabic version of
  // the same text. {status}, {count}, {n} and {version} are numbers and {ext}
  // a file ending; {message}, {reason}, {list}, {subject} and {tool} are texts
  // of the app and are translated too; {chain} is a list of sites. Any other
  // value (a file, folder, host or game name) is kept as it is.
  const TEMPLATES = Object.freeze([
    'Host returned HTTP {status}. Check the source link or retry.',
    'The host returned HTTP {status}; open it in your browser.',
    'FuckingFast returned HTTP {status}. Open the protected host to complete its verification.',
    'The source returned HTTP {status}. Please try again or choose another source.',
    'The site returned HTTP {status}.',
    'Ravenshelf {version} is available. Nothing is downloaded until you choose Download and install.',
    'Version {version} is available. Open Settings to review and install it.',
    '{count} earlier or internal archive part(s) are missing from this selection.',
    '{count} file name(s) are unresolved or unsupported and were not checked.',
    '{host} is on Ravenshelf\u2019s list of {list}.',
    '{name} was sent from your browser. Nothing downloads until you choose.',
    // A file named in these is a file name, never a text of the app: the two
    // fixed subjects have patterns of their own, before the general ones.
    '{count} security vendors on VirusTotal flagged this file.',
    '{count} security vendors on VirusTotal flagged a downloaded file.',
    '1 security vendor on VirusTotal flagged this file; one detection is often a false alarm.',
    '{count} security vendors on VirusTotal flagged {subject}.',
    '1 security vendor on VirusTotal flagged {subject}; one detection is often a false alarm.',
    'Only the first {count} other archives are listed; their total includes all archives counted in this check.',
    'Steam manifest: {path}',
    'Epic installation manifest: {path}',
    'Windows uninstall registration: {path}',
    'GOG installation registration: {path}',
    'Executable version resource: {path}',
    'Executable found in selected/known game folder: {path}',
    'Executable search was bounded in {path}. Add its specific game folder if a version is missing.',
    'A Steam manifest could not be read: {file}',
    'An Epic manifest could not be read: {file}',
    '{count} stale game registrations pointed to missing folders and were not counted as installed.',
    'The name looks like a .{shown} file, but it is really a .{ext} program.',
    'The name hides its .{ext} ending behind a run of spaces.',
    '.{ext} files are programs that can change your PC. Run it only if you trust where it came from.',
    '.{ext} files run commands as soon as they are opened. Open it only if you are sure it is safe.',
    '.{ext} disk images can hide programs and skip some Windows warnings. Open it only if you expected one.',
    'This file contains a Windows program even though its name ends in .{ext}.',
    'This .{ext} file is really a self-extracting program. Open it only if you expected that.',
    'Downloading {tool} {version}\u2026',
    'Downloading {tool}\u2026',
    'Checking and unpacking {tool}\u2026',
    'Source notes: {notes}',
    // Steam's own wording for a game with few reviews.
    '{count} user reviews',
    'Could not expand paste: {message}'
  ]);
  // The same for texts with a count: the English one and other forms. The
  // Arabic forms are kept under the English other form.
  const PLURAL_TEMPLATES = Object.freeze([
    Object.freeze(['{n} adult-tagged entry is hidden on this page.', '{n} adult-tagged entries are hidden on this page.']),
    Object.freeze(['Full details are temporarily unavailable for {n} entry.', 'Full details are temporarily unavailable for {n} entries.']),
    Object.freeze(['The link passed through {n} other site: {chain}.', 'The link passed through {n} other sites: {chain}.'])
  ]);
  const VALUE = { host: '[^\\s:/]+', status: '[1-5]\\d{2}', count: '\\d+', n: '\\d+', version: '\\d[0-9A-Za-z.+-]*', ext: '[A-Za-z0-9]{1,8}', shown: '[A-Za-z0-9]{1,8}' };
  const TRANSLATED = new Set(['message', 'reason', 'list', 'tool']);
  // Longer texts (pages, notes) are shown as they came: matching them is not
  // worth the time.
  const MAX_MATCHED = 4000;
  // Direction controls inside a value could end its isolation early.
  const DIRECTION_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;
  function compile(template) {
    const names = [];
    const source = template.split(/(\{[A-Za-z][A-Za-z0-9]*\})/).map((part, index) => {
      if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(part.slice(1, -1));
      return '(' + (VALUE[part.slice(1, -1)] || '[\\s\\S]+?') + ')';
    }).join('');
    return { pattern: new RegExp('^' + source + '$'), names };
  }
  const SINGLE_PATTERNS = TEMPLATES.map(template => Object.assign(compile(template), { key: template }));
  const PLURAL_PATTERNS = [];
  for (const [one, other] of PLURAL_TEMPLATES) for (const form of [one, other]) PLURAL_PATTERNS.push(Object.assign(compile(form), { one, other }));

  // The language a setting asks for. "system" follows the first language
  // Windows lists for this user.
  function resolveLanguage(setting, preferred) {
    if (setting === 'en' || setting === 'ar') return setting;
    const first = Array.isArray(preferred) && typeof preferred[0] === 'string' ? preferred[0].toLowerCase() : '';
    return first === 'ar' || first.startsWith('ar-') ? 'ar' : 'en';
  }

  // Only plain text, or a set of plural forms with an "other" form, is used
  // from a message file. Anything else in it is ignored, so a damaged file
  // gives English, never an error.
  function cleanMessages(messages) {
    const clean = Object.create(null);
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) return clean;
    for (const key of Object.keys(messages)) {
      const value = messages[key];
      if (typeof value === 'string') clean[key] = value;
      else if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.other === 'string') {
        const forms = Object.create(null);
        for (const form of PLURAL_FORMS) if (typeof value[form] === 'string') forms[form] = value[form];
        clean[key] = forms;
      }
    }
    return clean;
  }

  function createTranslator(bundle) {
    const language = LANGUAGES.includes(bundle && bundle.language) ? bundle.language : 'en';
    const arabic = language === 'ar';
    const digitStyle = arabic && bundle.digits === 'arab' ? 'arab' : 'latn';
    const messages = arabic ? cleanMessages(bundle.messages) : Object.create(null);
    const rules = new Intl.PluralRules(arabic ? 'ar' : 'en');

    // Digits in text the app wrote itself: Western digits stay as they are;
    // with Arabic-Indic digits, each digit is swapped and the decimal point
    // between two digits becomes the Arabic decimal separator.
    function digits(text) {
      const value = String(text);
      if (digitStyle !== 'arab') return value;
      return value.replace(/(\d)\.(?=\d)/g, '$1\u066b').replace(/\d/g, digit => ARABIC_DIGITS[digit]);
    }
    function fill(text, params) {
      if (!params) return text;
      return text.replace(PLACEHOLDER, (match, name) => {
        if (!own(params, name)) return match;
        const value = params[name];
        // Text already laid out for Arabic here (a chain of sites) is used as it is.
        if (value && typeof value === 'object' && typeof value.laidOut === 'string') return value.laidOut;
        // A number, or a number already written as text ("12.5"), takes the
        // chosen digits. Any other value is kept in its own direction.
        // A version is a name, not an amount: "1.5" stays 1.5.
        if (name !== 'version' && (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)))) return digits(String(value));
        return arabic ? ISOLATE_START + String(value).replace(DIRECTION_CONTROLS, '') + ISOLATE_END : String(value);
      });
    }
    // Digits written in an Arabic text itself follow the chosen digits too,
    // except digits that belong to a name or code ("SHA-256", "1080p", "M4A",
    // "H.264").
    function textDigits(text) {
      return digitStyle === 'arab' ? text.replace(/(?<![A-Za-z][-.]?|\d|\d\.)\d+(?:\.\d+)?(?!\d|\.\d|-?[A-Za-z])/g, digits) : text;
    }
    // Translates a text written in English in the code.
    function t(text, params) {
      const found = arabic && own(messages, text) ? messages[text] : null;
      return fill(typeof found === 'string' ? textDigits(found) : text, params);
    }
    // A text the main process wrote, in English, possibly with values in it:
    // a fixed text, one of the patterns above, a name followed by ": " and a
    // known text, several known sentences, or several lines (each line that is
    // known is translated; the others, such as notes from a source page, are
    // kept). Anything else is shown as it came. English is never changed.
    function localText(text) {
      if (!arabic || typeof text !== 'string') return text;
      const whole = known(text, 0);
      if (whole !== null) return whole;
      if (text.includes('\n')) return text.split('\n').map(line => { const local = known(line, 0); return local === null ? line : local; }).join('\n');
      const sentences = text.split(/(?<=[.!?\u2026])\s+(?=[A-Z0-9])/);
      if (sentences.length > 1 && sentences.length <= 12) {
        const parts = knownSentences(sentences, 0, new Map());
        if (parts) return parts.join(' ');
      }
      return text;
    }
    // Known texts that together make up the sentences, longest first: a
    // known text may itself be several sentences.
    function knownSentences(sentences, from, tried) {
      if (from === sentences.length) return [];
      if (tried.has(from)) return tried.get(from);
      let found = null;
      for (let to = sentences.length; to > from && !found; to--) {
        const local = known(sentences.slice(from, to).join(' '), 0);
        const rest = local === null ? null : knownSentences(sentences, to, tried);
        if (rest) found = [local, ...rest];
      }
      tried.set(from, found);
      return found;
    }
    function known(text, depth) {
      if (own(messages, text) && typeof messages[text] === 'string') return t(text);
      if (text.length > MAX_MATCHED) return null;
      for (const item of SINGLE_PATTERNS) {
        const match = item.pattern.exec(text);
        if (match) return t(item.key, values(item, match, depth));
      }
      for (const item of PLURAL_PATTERNS) {
        const match = item.pattern.exec(text);
        if (match) { const found = values(item, match, depth); return tn(Number(found.n), item.one, item.other, found); }
      }
      // A file, archive or game name, then ": " and a known text. Names the
      // app puts there hold no ": ", so only the first and the last are tried.
      if (depth < 2) {
        for (const at of new Set([text.indexOf(': '), text.lastIndexOf(': ')])) {
          if (at <= 0) continue;
          const rest = known(text.slice(at + 2), depth + 1);
          if (rest !== null) return ISOLATE_START + text.slice(0, at).replace(DIRECTION_CONTROLS, '') + ISOLATE_END + ': ' + rest;
        }
      }
      return null;
    }
    function values(item, match, depth) {
      const found = {};
      item.names.forEach((name, index) => {
        const value = match[index + 1];
        if (name === 'chain') found.chain = { laidOut: ISOLATE_START + '\u200f' + value.split(' \u2192 ').map(host => ISOLATE_START + host.replace(DIRECTION_CONTROLS, '') + ISOLATE_END).join(' \u2190 ') + ISOLATE_END };
        else if (TRANSLATED.has(name)) { const local = depth < 2 ? known(value, depth + 1) : null; found[name] = local === null ? value : local; }
        else found[name] = value;
      });
      return found;
    }
    // Translates a text that depends on a count. English has two forms; Arabic
    // has six, kept under the English "other" form. The count is {n}.
    function tn(count, one, other, params) {
      const values = Object.assign({}, params, { n: count });
      if (arabic && own(messages, other) && typeof messages[other] === 'object') {
        const forms = messages[other];
        const form = rules.select(count);
        return fill(textDigits(typeof forms[form] === 'string' ? forms[form] : forms.other), values);
      }
      return fill(count === 1 ? one : other, values);
    }
    // Translates the texts of the window's own markup: every element marked
    // data-i18n, and the attributes named in data-i18n-attr. English needs
    // nothing done; the language and direction of the page are always set.
    function applyTo(document) {
      const html = document.documentElement;
      if (html) { html.lang = language; html.dir = arabic ? 'rtl' : 'ltr'; }
      if (!arabic) return;
      for (const element of document.querySelectorAll('[data-i18n]')) {
        const english = element.textContent.replace(/\s+/g, ' ').trim();
        if (english) element.textContent = t(english);
      }
      for (const element of document.querySelectorAll('[data-i18n-attr]')) {
        for (const name of element.getAttribute('data-i18n-attr').split(/\s+/).filter(Boolean)) {
          const english = element.getAttribute(name);
          if (english) element.setAttribute(name, t(english));
        }
      }
    }
    return Object.freeze({
      language, arabic, direction: arabic ? 'rtl' : 'ltr', digitStyle,
      // For the number and date formats of the platform.
      locale: arabic ? 'ar-IQ-u-nu-' + digitStyle : 'en-US',
      t, tn, digits, applyTo, localText,
      has: text => own(messages, text)
    });
  }

  return Object.freeze({ LANGUAGES, SETTINGS, DIGITS, PLURAL_FORMS, TEMPLATES, PLURAL_TEMPLATES, resolveLanguage, cleanMessages, createTranslator });
});
