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
        // A number, or a number already written as text ("12.5"), takes the
        // chosen digits. Any other value is kept in its own direction.
        if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) return digits(String(value));
        return arabic ? ISOLATE_START + String(value) + ISOLATE_END : String(value);
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
      t, tn, digits, applyTo,
      has: text => own(messages, text)
    });
  }

  return Object.freeze({ LANGUAGES, SETTINGS, DIGITS, PLURAL_FORMS, resolveLanguage, cleanMessages, createTranslator });
});
