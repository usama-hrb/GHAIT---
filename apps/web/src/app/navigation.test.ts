import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { mayOpen, navigationFor, shopNavigation } from './navigation';

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

  it('has no Partners item: the partners are a section of Settings (ADR 0017)', () => {
    for (const role of ['owner', 'partner', 'cashier'] as const) {
      expect(navigationFor(role).map((item) => item.href)).not.toContain('/partners');
    }
    expect(shopNavigation().map((item) => item.href)).toContain('/settings');
  });

  it('keeps the partners out of a cashier’s Settings, and the rest of Settings in', () => {
    expect(mayOpen('cashier', '/settings')).toBe(true);
    expect(mayOpen('cashier', '/settings/regional')).toBe(true);
    expect(mayOpen('cashier', '/settings/sync')).toBe(true);
    expect(mayOpen('cashier', '/settings/data')).toBe(true);
    expect(mayOpen('cashier', '/settings/partners')).toBe(false);
    expect(mayOpen('cashier', '/settings/partners/view')).toBe(false);
    // The employees (and their pay) are a tab and a page of the same section: not theirs either.
    expect(mayOpen('cashier', '/settings/partners/employee')).toBe(false);
    // The old address is not theirs either.
    expect(mayOpen('cashier', '/partners')).toBe(false);
    for (const role of ['owner', 'partner'] as const) {
      expect(mayOpen(role, '/settings/partners')).toBe(true);
      expect(mayOpen(role, '/settings/partners/view')).toBe(true);
      expect(mayOpen(role, '/settings/partners/employee')).toBe(true);
    }
  });
});
