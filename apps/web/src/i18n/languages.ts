/**
 * The languages the app is shown in (SPEC §0.4): English, the default, and Arabic. The language
 * is a choice of the device, kept in its localStorage; it is not synced.
 */
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export type Direction = 'ltr' | 'rtl';

export const LANGUAGE_INFO = {
  // Dates in English read day-month-year, as in Morocco's other Latin-script writing.
  en: { dir: 'ltr', locale: 'en-GB', name: 'English' },
  // The shop's calendar is Morocco's: Gregorian, Western digits (formatDate sets both).
  ar: { dir: 'rtl', locale: 'ar-MA', name: 'العربية' },
} as const satisfies Record<Language, { dir: Direction; locale: string; name: string }>;

/** Where the device keeps its choice (the inline script in the root layout reads it too). */
export const LANGUAGE_STORAGE_KEY = 'fabric.language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
