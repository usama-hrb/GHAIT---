import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { navigationFor, shopNavigation } from './navigation';

describe('the shop navigation', () => {
  it('is labelled in the language shown when it is built', () => {
    setLanguage('en', { persist: false });
    expect(shopNavigation().find((item) => item.href === '/pos')?.label).toBe('Sell');
    setLanguage('ar', { persist: false });
    expect(shopNavigation().find((item) => item.href === '/pos')?.label).toBe('بيع');
  });

  it('keeps a cashier to the pages that sell', () => {
    setLanguage('en', { persist: false });
    expect(navigationFor('cashier').map((item) => item.href)).toEqual([
      '/home',
      '/pos',
      '/inventory',
      '/customers',
      '/settings',
    ]);
  });
});
