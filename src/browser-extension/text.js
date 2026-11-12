// Ravenshelf extension texts, in English and Arabic. The English text written
// in the code is the key; its Arabic version is looked up by it. The language
// is the one the Ravenshelf app uses, which the app tells the extension each
// time they talk; until then, the browser's own language decides. Shared by
// the background script, the toolbar popup, the warning page, the YouTube
// button and Ravenshelf's own tests. No browser calls here.
(function (root) {
  'use strict';
  const LANGUAGES = Object.freeze(['en', 'ar']);
  const DIGITS = Object.freeze(['latn', 'arab']);
  // A value put into Arabic text is kept in its own direction, so a site
  // address is not jumbled by the Arabic around it.
  const ISOLATE_START = String.fromCharCode(0x2068), ISOLATE_END = String.fromCharCode(0x2069);
  const ARABIC_DIGITS = Array.from({ length: 10 }, (_, digit) => String.fromCharCode(0x0660 + digit));
  const ARABIC_DECIMAL = String.fromCharCode(0x066b);
  const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  // Every Arabic text starts with an Arabic word: a notification or a menu
  // takes its direction from its first letter.
  const AR = Object.freeze({
    // Notifications and the right-click menu
    'Open Ravenshelf, then try again.': 'افتح Ravenshelf، ثم حاول مرة أخرى.',
    'In Ravenshelf, open Settings › Browser extension and turn on “Connect the browser extension”.': 'في Ravenshelf، افتح «الإعدادات» › «إضافة المتصفح» وشغّل «ربط إضافة المتصفح».',
    'Load the extension folder that Ravenshelf created, from Settings › Browser extension.': 'حمّل مجلد الإضافة الذي أنشأه Ravenshelf، من «الإعدادات» › «إضافة المتصفح».',
    'Ravenshelf is busy. Try again in a moment.': 'برنامج Ravenshelf مشغول. حاول بعد لحظة.',
    'Ravenshelf did not respond. Try again.': 'لم يستجب Ravenshelf. حاول مرة أخرى.',
    'Ravenshelf is not available': 'برنامج Ravenshelf غير متاح',
    'Ravenshelf blocked this link': 'حظر Ravenshelf هذا الرابط',
    'It failed Ravenshelf’s safety checks.': 'لم يجتز فحوص الأمان في Ravenshelf.',
    'Ravenshelf did not take this link': 'لم يتولَّ Ravenshelf هذا الرابط',
    'It is not encrypted (HTTP), so Ravenshelf will not download it. Open it in your browser only if you trust the site.': 'هذا الرابط غير مشفّر (HTTP)، لذا لن ينزّله Ravenshelf. افتحه في متصفحك فقط إن كنت تثق بالموقع.',
    'Open it in your browser instead.': 'افتحه في متصفحك بدلًا من ذلك.',
    'Ravenshelf blocked a download': 'حظر Ravenshelf تنزيلًا',
    'Ravenshelf stopped {name} that a web page created for download. Programs made this way are a common malware trick.': 'أوقف Ravenshelf الملف {name} الذي أنشأته صفحة ويب للتنزيل. البرامج المصنوعة بهذه الطريقة حيلة شائعة للبرمجيات الضارة.',
    'Ravenshelf stopped a program that a web page created for download. Programs made this way are a common malware trick.': 'أوقف Ravenshelf برنامجًا أنشأته صفحة ويب للتنزيل. البرامج المصنوعة بهذه الطريقة حيلة شائعة للبرمجيات الضارة.',
    'Download with Ravenshelf': 'التنزيل باستخدام Ravenshelf',
    'Download this file with Ravenshelf': 'تنزيل هذا الملف باستخدام Ravenshelf',
    'Download this video with Ravenshelf': 'تنزيل هذا الفيديو باستخدام Ravenshelf',
    'Private window': 'نافذة خاصة',
    'Ravenshelf does not take downloads from private windows.': 'لا يستلم Ravenshelf التنزيلات من النوافذ الخاصة.',
    'Ravenshelf closed a pop-up': 'أغلق Ravenshelf نافذة منبثقة',
    '{source} tried to open {target}. File hosts use pop-ups for ads and fake downloads.': 'حاول الموقع {source} فتح {target}. تستخدم مواقع استضافة الملفات النوافذ المنبثقة للإعلانات والتنزيلات المزيّفة.',
    '{source} tried to open another page. File hosts use pop-ups for ads and fake downloads.': 'حاول الموقع {source} فتح صفحة أخرى. تستخدم مواقع استضافة الملفات النوافذ المنبثقة للإعلانات والتنزيلات المزيّفة.',
    'Ravenshelf stopped a redirect': 'أوقف Ravenshelf إعادة توجيه',
    '{source} tried to send you to {target} instead of your download.': 'حاول الموقع {source} نقلك إلى {target} بدلًا من تنزيلك.',
    'A file-host page tried to send you to {target} instead of your download.': 'حاولت صفحة موقع استضافة نقلك إلى {target} بدلًا من تنزيلك.',
    'Ravenshelf blocked a dangerous site': 'حظر Ravenshelf موقعًا خطرًا',
    '{host} is on a list of sites that spread malware.': 'الموقع {host} مدرج في قائمة مواقع تنشر البرمجيات الضارة.',
    '{host} is on a list of phishing sites.': 'الموقع {host} مدرج في قائمة مواقع التصيّد الاحتيالي.',
    '{host} is on a list of malware, scam and phishing sites.': 'الموقع {host} مدرج في قائمة مواقع البرمجيات الضارة والاحتيال والتصيّد.',
    '{host} is on a list of malicious pop-up ad networks.': 'الموقع {host} مدرج في قائمة شبكات الإعلانات المنبثقة الضارة.',
    // Answers about a YouTube video
    'Downloading in Ravenshelf': 'يُنزَّل في Ravenshelf',
    'Added to Ravenshelf. It is downloading now.': 'أُضيف إلى Ravenshelf، وهو يُنزَّل الآن.',
    'Already in Ravenshelf': 'موجود بالفعل في Ravenshelf',
    'This video is already in your Ravenshelf downloads.': 'هذا الفيديو موجود بالفعل في تنزيلات Ravenshelf.',
    'Set up YouTube downloads': 'إعداد تنزيلات YouTube',
    'Finish the one-time setup in Ravenshelf. This video starts after that.': 'أكمل الإعداد لمرة واحدة في Ravenshelf. يبدأ هذا الفيديو بعد ذلك.',
    'Ravenshelf is busy': 'برنامج Ravenshelf مشغول',
    'Ravenshelf cannot take more YouTube videos right now. Try again after some finish.': 'لا يستطيع Ravenshelf استلام مزيد من فيديوهات YouTube الآن. حاول مرة أخرى بعد اكتمال بعضها.',
    'Ravenshelf is closed': 'برنامج Ravenshelf مغلق',
    'Not connected yet': 'غير متصل بعد',
    'This copy is not connected': 'هذه النسخة غير متصلة',
    'Try again in a moment.': 'حاول بعد لحظة.',
    'Not a YouTube video': 'ليس فيديو YouTube',
    'Ravenshelf can download single YouTube videos only.': 'يستطيع Ravenshelf تنزيل فيديوهات YouTube المفردة فقط.',
    'Ravenshelf did not respond': 'لم يستجب Ravenshelf',
    'Try again in a moment. Check that Ravenshelf is open and connected.': 'حاول بعد لحظة. تحقّق من أن Ravenshelf مفتوح ومتصل.',
    // The YouTube button
    'Video': 'فيديو',
    'Audio only': 'صوت فقط',
    'Best quality': 'أفضل جودة',
    'Up to 4K': 'حتى 4K',
    'Full HD': 'دقة Full HD',
    'HD': 'دقة HD',
    'Smaller file': 'ملف أصغر',
    'Original audio': 'الصوت الأصلي',
    'Plays everywhere': 'يعمل في كل مكان',
    'Saved to Ravenshelf › YouTube': 'يُحفظ في Ravenshelf › YouTube',
    'Sending to Ravenshelf…': 'جارٍ الإرسال إلى Ravenshelf…',
    'Reload this page to use the Ravenshelf button again.': 'أعد تحميل هذه الصفحة لاستخدام زر Ravenshelf مرة أخرى.',
    // The toolbar popup
    'Connected to Ravenshelf': 'متصل بـ Ravenshelf',
    'Ravenshelf {version} checks each download and asks before saving it.': 'يفحص Ravenshelf {version} كل تنزيل ويسأل قبل حفظه.',
    'Downloads stay in your browser until you open Ravenshelf. Site blocking keeps working.': 'تبقى التنزيلات في متصفحك حتى تفتح Ravenshelf. يستمر حظر المواقع في العمل.',
    'Checking…': 'جارٍ الفحص…',
    'just now': 'الآن',
    'Extension {version}': 'الإضافة {version}',
    '{count} dangerous sites on the list · updated {ago}.': 'المواقع الخطرة في القائمة: {count} · حُدّثت {ago}.',
    '{count} dangerous sites on the list.': 'المواقع الخطرة في القائمة: {count}.',
    'The lists arrive from Ravenshelf once it is connected.': 'تصل القوائم من Ravenshelf بمجرد اتصاله.',
    'Protection is paused until {time}.': 'الحماية متوقفة مؤقتًا حتى {time}.',
    'Resume protection now': 'استئناف الحماية الآن',
    'Pause protection for 10 minutes': 'إيقاف الحماية مؤقتًا لمدة 10 دقائق',
    'That did not work. Close this window and try again.': 'لم ينجح ذلك. أغلق هذه النافذة وحاول مرة أخرى.',
    'Ravenshelf could not take this page. Check that it is open and connected.': 'تعذّر على Ravenshelf استلام هذه الصفحة. تحقّق من أنه مفتوح ومتصل.',
    'Sent. Review it in Ravenshelf; nothing downloads until you choose.': 'أُرسلت. راجعها في Ravenshelf؛ لن يُنزَّل شيء حتى تختار.',
    'Ravenshelf blocked this page.': 'حظر Ravenshelf هذه الصفحة.',
    'Ravenshelf left this one to your browser.': 'ترك Ravenshelf هذا الرابط لمتصفحك.',
    'Send downloads to Ravenshelf': 'إرسال التنزيلات إلى Ravenshelf',
    'Ravenshelf checks each file and asks before saving it.': 'يفحص Ravenshelf كل ملف ويسأل قبل حفظه.',
    'Block dangerous sites': 'حظر المواقع الخطرة',
    'Malware, phishing and scam lists from Ravenshelf.': 'قوائم البرمجيات الضارة والتصيّد والاحتيال من Ravenshelf.',
    'Stop file-host pop-ups and redirects': 'إيقاف النوافذ المنبثقة وإعادة التوجيه في مواقع الاستضافة',
    'FuckingFast and FileKeeper pages can open only their own files.': 'صفحات FuckingFast وFileKeeper لا تفتح إلا ملفاتها.',
    'YouTube download button': 'زر التنزيل في YouTube',
    'Adds a Ravenshelf button to YouTube’s player. Right-click a video for the same.': 'يضيف زر Ravenshelf إلى مشغّل YouTube. انقر بزر الفأرة الأيمن على فيديو للخيار نفسه.',
    'Sort Nexus Mods files by game': 'ترتيب ملفات Nexus Mods حسب اللعبة',
    'Reads which game, mod and files a Nexus Mods page is about, so that a file you download there is saved in a Mods folder for its game.': 'يقرأ اللعبة والمود والملفات التي تتناولها صفحة Nexus Mods، ليُحفظ الملف الذي تنزّله منها في مجلد Mods الخاص بلعبته.',
    'Private windows are never captured. This extension talks only to Ravenshelf on this PC.': 'لا تلتقط الإضافة أي شيء من النوافذ الخاصة أبدًا. تتواصل هذه الإضافة مع Ravenshelf على هذا الحاسوب فقط.',
    // The warning page
    'Blocked by Ravenshelf': 'صفحة حظرها Ravenshelf',
    'Ravenshelf blocked this page': 'حظر Ravenshelf هذه الصفحة',
    'Ravenshelf stopped this page to keep you safe.': 'أوقف Ravenshelf هذه الصفحة حفاظًا على سلامتك.',
    'Go back': 'رجوع',
    'Close tab': 'إغلاق علامة التبويب',
    'You can turn this protection off from the Ravenshelf button in your browser’s toolbar.': 'يمكنك إيقاف هذه الحماية من زر Ravenshelf في شريط أدوات متصفحك.',
    '{source} tried to send you to another site instead of your download.': 'حاول الموقع {source} نقلك إلى موقع آخر بدلًا من تنزيلك.',
    'A file-host page tried to send you to another site instead of your download.': 'حاولت صفحة موقع استضافة نقلك إلى موقع آخر بدلًا من تنزيلك.',
    'File hosts use redirects like this for ads and fake download pages. If you meant to visit this site, type its address yourself.': 'تستخدم مواقع استضافة الملفات إعادة التوجيه هذه للإعلانات وصفحات التنزيل المزيّفة. إن كنت تقصد زيارة هذا الموقع، فاكتب عنوانه بنفسك.',
    'Dangerous site blocked': 'حُظر موقع خطر',
    'This site is on a list of sites that spread malware.': 'هذا الموقع مدرج في قائمة مواقع تنشر البرمجيات الضارة.',
    'List: URLhaus, through malware-filter.': 'القائمة: URLhaus، عبر malware-filter.',
    'Phishing site blocked': 'حُظر موقع تصيّد',
    'This site is on a list of phishing sites, which try to steal passwords and payment details.': 'هذا الموقع مدرج في قائمة مواقع التصيّد الاحتيالي، التي تحاول سرقة كلمات المرور وبيانات الدفع.',
    'List: malware-filter phishing list.': 'القائمة: قائمة التصيّد من malware-filter.',
    'This site is on a list of malware, scam and phishing sites.': 'هذا الموقع مدرج في قائمة مواقع البرمجيات الضارة والاحتيال والتصيّد.',
    'List: HaGeZi Threat Intelligence Feeds.': 'القائمة: HaGeZi Threat Intelligence Feeds.',
    'Pop-up ad network blocked': 'حُظرت شبكة إعلانات منبثقة',
    'This site belongs to a pop-up ad network known for malicious ads and fake downloads.': 'ينتمي هذا الموقع إلى شبكة إعلانات منبثقة معروفة بالإعلانات الضارة والتنزيلات المزيّفة.',
    'List: HaGeZi Pop-Up Ads.': 'القائمة: HaGeZi Pop-Up Ads.',
    'Back to {host}': 'العودة إلى {host}',
    'That page is no longer available': 'لم تعد تلك الصفحة متاحة'
  });
  // Texts with a count: Arabic has six forms, kept under the English other form.
  const AR_PLURAL = Object.freeze({
    // The same words as the app's.
    '{n} min ago': Object.freeze({ zero: 'الآن', one: 'قبل دقيقة', two: 'قبل دقيقتين', few: 'قبل {n} دقائق', many: 'قبل {n} دقيقة', other: 'قبل {n} دقيقة' }),
    '{n} h ago': Object.freeze({ zero: 'الآن', one: 'قبل ساعة', two: 'قبل ساعتين', few: 'قبل {n} ساعات', many: 'قبل {n} ساعة', other: 'قبل {n} ساعة' }),
    '{n} days ago': Object.freeze({ zero: 'اليوم', one: 'قبل يوم', two: 'قبل يومين', few: 'قبل {n} أيام', many: 'قبل {n} يومًا', other: 'قبل {n} يوم' })
  });

  // The language to use: the app's, when the app has said; otherwise the
  // browser's own language.
  function pick(appLanguage, browserLanguage) {
    if (LANGUAGES.includes(appLanguage)) return appLanguage;
    const value = String(browserLanguage || '').toLowerCase();
    return value === 'ar' || value.startsWith('ar-') || value.startsWith('ar_') ? 'ar' : 'en';
  }
  function create(language, digits) {
    const arabic = language === 'ar';
    const digitStyle = arabic && digits === 'arab' ? 'arab' : 'latn';
    const rules = arabic ? new Intl.PluralRules('ar') : null;
    function number(value) {
      const text = String(value);
      if (digitStyle !== 'arab') return text;
      return text.replace(/(\d)\.(?=\d)/g, '$1' + ARABIC_DECIMAL).replace(/\d/g, digit => ARABIC_DIGITS[digit]);
    }
    function fill(text, params) {
      if (!params) return text;
      return text.replace(PLACEHOLDER, (match, name) => {
        if (!own(params, name)) return match;
        const value = params[name];
        if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) return number(value);
        return arabic ? ISOLATE_START + String(value) + ISOLATE_END : String(value);
      });
    }
    // Digits written in the Arabic text itself follow the chosen digits,
    // except those that belong to a name ("4K", "HTTP").
    function textDigits(text) {
      return digitStyle === 'arab' ? text.replace(/(?<![A-Za-z][-.]?|\d|\d\.)\d+(?:\.\d+)?(?!\d|\.\d|-?[A-Za-z])/g, number) : text;
    }
    function t(text, params) {
      const found = arabic && own(AR, text) ? textDigits(AR[text]) : String(text);
      return fill(found, params);
    }
    function tn(count, one, other, params) {
      const values = Object.assign({}, params, { n: count });
      if (arabic && own(AR_PLURAL, other)) return fill(textDigits(AR_PLURAL[other][rules.select(count)]), values);
      return fill(count === 1 ? one : other, values);
    }
    // A time of day and a count in this language, with the chosen digits.
    function time(date) {
      const options = { hour: '2-digit', minute: '2-digit' };
      return arabic ? date.toLocaleTimeString('ar-u-nu-' + digitStyle, options) : date.toLocaleTimeString([], options);
    }
    function count(value) {
      return arabic ? new Intl.NumberFormat('ar-u-nu-' + digitStyle).format(value) : Number(value).toLocaleString('en');
    }
    // For the extension's own pages only (never a website): the page's
    // language and direction, and its marked texts and attributes.
    function apply(document) {
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
    return Object.freeze({ language: arabic ? 'ar' : 'en', arabic, dir: arabic ? 'rtl' : 'ltr', t, tn, time, count, apply });
  }

  const text = { LANGUAGES, DIGITS, AR, AR_PLURAL, pick, create };
  if (typeof module === 'object' && module.exports) module.exports = text;
  else root.RavenshelfText = Object.freeze(text);
})(typeof globalThis !== 'undefined' ? globalThis : this);
