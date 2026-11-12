'use strict';
// The app's language in the main process: which language the settings ask
// for, the Arabic texts, and the bundle the window is served with. The
// translating itself is shared with the window (renderer/i18n.js).
const fs=require('node:fs'),path=require('node:path');
const core=require('./renderer/i18n.js');

const ARABIC_FILE=path.join(__dirname,'locales','ar.json');
let arabic=null;
// The Arabic texts, read once. A file that cannot be read gives English.
function arabicMessages(){
  if(arabic===null){
    try{arabic=core.cleanMessages(JSON.parse(fs.readFileSync(ARABIC_FILE,'utf8')));}
    catch{arabic=Object.create(null);}
  }
  return arabic;
}
const languageSetting=value=>core.SETTINGS.includes(value)?value:'system';
const digitSetting=value=>core.DIGITS.includes(value)?value:'latn';
// What the window and the main process use, for the saved settings and the
// languages Windows lists for this user.
function bundle(settings,preferred){
  const language=core.resolveLanguage(languageSetting(settings?.language),preferred);
  return {language,digits:digitSetting(settings?.digits),messages:language==='ar'?arabicMessages():{}};
}
function translator(settings,preferred){return core.createTranslator(bundle(settings,preferred));}
// The script the window loads before its own: the language and its texts.
// It is plain data written as JSON, never text from outside the app.
function windowScript(settings,preferred){return `globalThis.RAVENSHELF_LOCALE=${JSON.stringify(bundle(settings,preferred))};\n`;}
// A language choice from the window, checked: only the listed values.
function languageChoice(options){
  const changes={};
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='language'&&key!=='digits'))throw new Error('Invalid app request.');
  if(options.language!==undefined){if(!core.SETTINGS.includes(options.language))throw new Error('Choose a language from the list.');changes.language=options.language;}
  if(options.digits!==undefined){if(!core.DIGITS.includes(options.digits))throw new Error('Choose how numbers are written from the list.');changes.digits=options.digits;}
  if(!Object.keys(changes).length)throw new Error('Invalid app request.');
  return changes;
}
module.exports={bundle,translator,windowScript,languageChoice,languageSetting,digitSetting,ARABIC_FILE};
