import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  type Language,
} from './languages';

/**
 * The language the app is shown in right now. It starts as the default on the server and in the
 * first client render, so a hydrated page matches the markup the server sent; the device's choice
 * is applied right after (adoptStoredLanguage, from the LanguageProvider).
 */
let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What this device chose, or null (storage can be missing or blocked: private windows, tests). */
export function storedLanguage(): Language | null {
  try {
    // Without storage (server, some tests) the access throws and there is no choice.
    const value = globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** The page's own `lang` and `dir` follow the language (the inline script sets them early too). */
function applyToDocument(language: Language): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = language;
  root.dir = LANGUAGE_INFO[language].dir;
  root.removeAttribute('data-lang-pending');
}

/** Shows the app in `language`, and keeps the choice on this device unless `persist` is false. */
export function setLanguage(language: Language, { persist = true } = {}): void {
  if (persist) {
    try {
      globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Not kept for the next visit; this one still changes.
    }
  }
  applyToDocument(language);
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener();
}

/** Applies what the device chose; with no choice yet the default stays. */
export function adoptStoredLanguage(): void {
  setLanguage(storedLanguage() ?? current, { persist: false });
}
