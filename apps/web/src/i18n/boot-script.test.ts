import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { languageBootScript } from './boot-script';

/** Runs the script the root layout inlines, against a stand-in page and storage. */
function boot(stored: string | null, { blocked = false } = {}) {
  const attributes = new Map<string, string>();
  const root = {
    lang: 'en',
    dir: 'ltr',
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  const localStorage = {
    getItem: (): string | null => {
      if (blocked) throw new Error('storage blocked');
      return stored;
    },
  };
  vm.runInNewContext(languageBootScript, { localStorage, document: { documentElement: root } });
  return { lang: root.lang, dir: root.dir, pending: attributes.has('data-lang-pending') };
}

describe('the language boot script (runs in <head> before the first paint)', () => {
  it('puts a stored Arabic on the page, right to left, and marks it pending', () => {
    expect(boot('ar')).toEqual({ lang: 'ar', dir: 'rtl', pending: true });
  });

  it('puts a stored English on the page without marking it pending', () => {
    expect(boot('en')).toEqual({ lang: 'en', dir: 'ltr', pending: false });
  });

  it('leaves the page alone with no choice, or an unknown one', () => {
    for (const stored of [null, 'fr', '', 'constructor']) {
      expect(boot(stored), String(stored)).toEqual({ lang: 'en', dir: 'ltr', pending: false });
    }
  });

  it('leaves the page alone when storage throws (private windows)', () => {
    expect(boot('ar', { blocked: true })).toEqual({ lang: 'en', dir: 'ltr', pending: false });
  });
});
