import traditional from './zh-TW.json';
import japanese from './ja.json';
import korean from './ko.json';
import spanish from './es.json';
import french from './fr.json';
import german from './de.json';

/** Bundled offline dictionaries. No translation service is called at runtime. */
export const LOCALES: Record<string, Record<string, string>> = {
  'zh-TW': traditional, ja: japanese, ko: korean, es: spanish, fr: french, de: german
};
