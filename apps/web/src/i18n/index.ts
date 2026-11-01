// i18n: the app's languages (English by default, Arabic), the texts, and the language shown now.
import { LANGUAGE_INFO } from './languages';
import { getLanguage } from './store';

export { languageBootScript } from './boot-script';
export {
  DEFAULT_LANGUAGE,
  type Direction,
  isLanguage,
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  type Language,
} from './languages';
export { messages } from './live';
export { plural, type PluralForms } from './plural';
export {
  adoptStoredLanguage,
  getLanguage,
  setLanguage,
  storedLanguage,
  subscribeLanguage,
} from './store';
export type { Messages } from './types';

/** The direction of the language shown now (it changes with the language). */
export function currentDirection() {
  return LANGUAGE_INFO[getLanguage()].dir;
}

/** The locale tag of the language shown now, for Intl. */
export function currentLocale() {
  return LANGUAGE_INFO[getLanguage()].locale;
}
