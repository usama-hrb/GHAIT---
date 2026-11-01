import { DEFAULT_LANGUAGE, LANGUAGE_INFO, LANGUAGE_STORAGE_KEY, LANGUAGES } from './languages';

const directions = Object.fromEntries(LANGUAGES.map((code) => [code, LANGUAGE_INFO[code].dir]));

/**
 * Runs in <head> before the first paint (app/layout.tsx). The server always sends the default
 * language; this puts the device's own choice on <html> (lang, dir) at once, and marks a
 * non-default one as pending until the LanguageProvider has switched the texts, so the page is
 * never shown in the wrong language or direction (globals.css hides a pending page).
 */
export const languageBootScript = `(function(){try{var l=localStorage.getItem(${JSON.stringify(
  LANGUAGE_STORAGE_KEY,
)});var m=${JSON.stringify(
  directions,
)};if(Object.prototype.hasOwnProperty.call(m,l)){var r=document.documentElement;r.lang=l;r.dir=m[l];if(l!==${JSON.stringify(
  DEFAULT_LANGUAGE,
)})r.setAttribute('data-lang-pending','')}}catch(e){}})();`;
