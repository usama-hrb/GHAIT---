import { afterEach, describe, expect, it, vi } from 'vitest';
import { ar } from './ar';
import { en } from './en';
import {
  adoptStoredLanguage,
  currentDirection,
  currentLocale,
  DEFAULT_LANGUAGE,
  getLanguage,
  LANGUAGE_INFO,
  LANGUAGE_STORAGE_KEY,
  messages,
  setLanguage,
  storedLanguage,
  subscribeLanguage,
} from './index';

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the languages', () => {
  it('default to English, left to right; Arabic is right to left', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(LANGUAGE_INFO.en.dir).toBe('ltr');
    expect(LANGUAGE_INFO.ar.dir).toBe('rtl');
  });

  it('give the direction and locale of the language shown', () => {
    setLanguage('en', { persist: false });
    expect([currentDirection(), currentLocale()]).toEqual(['ltr', 'en-GB']);
    setLanguage('ar', { persist: false });
    expect([currentDirection(), currentLocale()]).toEqual(['rtl', 'ar-MA']);
  });
});

describe('messages (follows the language shown)', () => {
  it('reads from the catalog of the language shown', () => {
    setLanguage('en', { persist: false });
    expect(messages.nav.home).toBe(en.nav.home);
    expect(messages.nav.home).toBe('Home');
    setLanguage('ar', { persist: false });
    expect(messages.nav.home).toBe(ar.nav.home);
  });

  it('keeps an alias taken once (`const t = messages.nav`) in step with the language', () => {
    const t = messages.nav;
    setLanguage('en', { persist: false });
    expect(t.home).toBe('Home');
    setLanguage('ar', { persist: false });
    expect(t.home).toBe(ar.nav.home);
  });

  it('calls the functions of the language shown', () => {
    setLanguage('en', { persist: false });
    expect(messages.shell.pendingOps(2)).toBe('2 pending changes');
    setLanguage('ar', { persist: false });
    expect(messages.shell.pendingOps(2)).toBe('عمليتان معلّقتان');
  });

  it('can be listed, tested with `in` and spread like the catalog it stands for', () => {
    setLanguage('en', { persist: false });
    expect(Object.keys(messages.nav)).toEqual(Object.keys(en.nav));
    expect('home' in messages.nav).toBe(true);
    expect('nothing' in messages.nav).toBe(false);
    expect({ ...messages.nav }).toEqual(en.nav);
    expect(Object.keys(messages.pos.issues)).toEqual(Object.keys(en.pos.issues));
  });

  it('has nothing under a key the catalog does not have', () => {
    expect(Reflect.get(messages, 'nothing')).toBeUndefined();
  });
});

describe('the language store', () => {
  it('tells its listeners once per change, and not for the language already shown', () => {
    setLanguage('ar', { persist: false });
    const listener = vi.fn();
    const stop = subscribeLanguage(listener);
    setLanguage('ar', { persist: false });
    expect(listener).not.toHaveBeenCalled();
    setLanguage('en', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLanguage()).toBe('en');
    stop();
    setLanguage('ar', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the choice on the device, unless told not to', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    setLanguage('ar');
    expect(storage.items.get(LANGUAGE_STORAGE_KEY)).toBe('ar');
    setLanguage('en', { persist: false });
    expect(storage.items.get(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });

  it('adopts what the device chose, and keeps the language shown with no choice', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [LANGUAGE_STORAGE_KEY]: 'ar' }));
    setLanguage('en', { persist: false });
    adoptStoredLanguage();
    expect(getLanguage()).toBe('ar');

    vi.stubGlobal('localStorage', fakeStorage());
    setLanguage('en', { persist: false });
    adoptStoredLanguage();
    expect(getLanguage()).toBe('en');
  });

  it('ignores a stored value that is not a language', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [LANGUAGE_STORAGE_KEY]: 'fr' }));
    expect(storedLanguage()).toBeNull();
  });

  it('works with storage that throws (private windows)', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', blocked);
    expect(storedLanguage()).toBeNull();
    expect(() => {
      setLanguage('ar');
    }).not.toThrow();
    expect(getLanguage()).toBe('ar');
  });

  it('puts the language and its direction on the page', () => {
    const attributes = new Set(['data-lang-pending']);
    const root = {
      lang: '',
      dir: '',
      removeAttribute: (name: string) => attributes.delete(name),
    };
    vi.stubGlobal('document', { documentElement: root });
    setLanguage('ar', { persist: false });
    expect(root).toMatchObject({ lang: 'ar', dir: 'rtl' });
    expect(attributes.has('data-lang-pending')).toBe(false);
    setLanguage('en', { persist: false });
    expect(root).toMatchObject({ lang: 'en', dir: 'ltr' });
  });
});
