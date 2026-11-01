'use client';

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import {
  adoptStoredLanguage,
  DEFAULT_LANGUAGE,
  type Direction,
  getLanguage,
  isLanguage,
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  type Language,
  setLanguage,
  subscribeLanguage,
} from '@/i18n';
import { DirectionProvider } from '@/shared/ui/direction';

export interface LanguageState {
  language: Language;
  /** Left-to-right or right-to-left: it follows the language. */
  dir: Direction;
  /** The locale tag for Intl. */
  locale: string;
  /** Changes the language and keeps the choice on this device. */
  setLanguage: (language: Language) => void;
}

const change = (language: Language) => {
  setLanguage(language);
};

/**
 * The language shown now; re-renders when it changes. The server and the first client render
 * show the default (the markup must match), then the provider applies the device's choice.
 */
export function useLanguage(): LanguageState {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE);
  const { dir, locale } = LANGUAGE_INFO[language];
  return { language, dir, locale, setLanguage: change };
}

/**
 * Applies the device's language before the first paint and follows other tabs, and gives
 * Radix (popovers, menus, sliders) the direction. Put <LanguageBoundary> around the screens.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { dir } = useLanguage();

  useLayoutEffect(() => {
    adoptStoredLanguage();
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY && isLanguage(event.newValue)) {
        setLanguage(event.newValue, { persist: false });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}

/**
 * Texts are read while a component renders (`messages.x`), so a new language needs every
 * component under here rebuilt: the key remounts them. Keep it below the providers that hold
 * state (database, session), so a language change does not reload those.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  return <Fragment key={language}>{children}</Fragment>;
}
