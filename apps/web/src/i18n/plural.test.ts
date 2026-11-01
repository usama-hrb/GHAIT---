import { describe, expect, it } from 'vitest';
import { plural, setLanguage, messages } from './index';

describe('Arabic plural forms', () => {
  it.each([
    [0, 'لا عمليات معلّقة'],
    [1, 'عملية معلّقة واحدة'],
    [2, 'عمليتان معلّقتان'],
    [3, '3 عمليات معلّقة'],
    [10, '10 عمليات معلّقة'],
    [11, '11 عملية معلّقة'],
    [100, '100 عملية معلّقة'],
  ])('%i → %s', (count, text) => {
    expect(messages.shell.pendingOps(count)).toBe(text);
  });
});

describe('English plural forms', () => {
  it.each([
    [0, 'No pending changes'],
    [1, '1 pending change'],
    [2, '2 pending changes'],
    [21, '21 pending changes'],
  ])('%i → %s', (count, text) => {
    setLanguage('en', { persist: false });
    expect(messages.shell.pendingOps(count)).toBe(text);
  });
});

describe('plural', () => {
  const forms = { zero: 'none', one: 'one', two: 'two', few: 'few', many: 'many', other: 'other' };

  it('picks the form of the language it is asked for', () => {
    expect(plural(2, forms, 'en')).toBe('other');
    expect(plural(2, forms, 'ar')).toBe('two');
    expect(plural(5, forms, 'ar')).toBe('few');
    expect(plural(15, forms, 'ar')).toBe('many');
  });

  it('uses `zero` for a count of 0 in any language, when given', () => {
    expect(plural(0, forms, 'en')).toBe('none');
    expect(plural(0, { one: 'one', other: 'other' }, 'en')).toBe('other');
  });

  it('falls back to `other` for a form the text does not have', () => {
    expect(plural(2, { one: 'one', other: 'many of them' }, 'ar')).toBe('many of them');
  });

  it('follows the language shown when none is given', () => {
    setLanguage('ar', { persist: false });
    expect(plural(2, forms)).toBe('two');
    setLanguage('en', { persist: false });
    expect(plural(2, forms)).toBe('other');
  });
});
