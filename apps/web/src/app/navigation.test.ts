import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { navSections } from '@/shared/brand/nav-groups';
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
    expect(mayOpen('cashier', '/settings/selling')).toBe(true);
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

  it('keeps the accounts, the audit log and the integrity report to the owner (ADR 0024)', () => {
    for (const path of ['/settings/accounts', '/audit', '/integrity']) {
      expect(mayOpen('owner', path)).toBe(true);
      expect(mayOpen('partner', path)).toBe(false);
      expect(mayOpen('cashier', path)).toBe(false);
    }
    expect(mayOpen('partner', '/settings/accounts/anything')).toBe(false);
    // A partner keeps the rest, and a lookalike is not mistaken for a closed page.
    expect(mayOpen('partner', '/settlements')).toBe(true);
    expect(mayOpen('partner', '/settings/partners')).toBe(true);
    expect(mayOpen('partner', '/audit-trail')).toBe(true);
  });

  it('opens every zakat page to the owner and the partner, who only reads, and none to a cashier', () => {
    const pages = ['/zakat', '/zakat/review', '/zakat/settings', '/zakat/view'];
    for (const path of pages) {
      expect(mayOpen('owner', path)).toBe(true);
      expect(mayOpen('partner', path)).toBe(true);
      expect(mayOpen('cashier', path)).toBe(false);
    }
  });

  it('shows a partner neither the audit log nor the integrity report', () => {
    const hrefs = navigationFor('partner').map((item) => item.href);
    expect(hrefs).not.toContain('/audit');
    expect(hrefs).not.toContain('/integrity');
    expect(hrefs).toContain('/settlements');
    expect(navigationFor('owner').map((item) => item.href)).toContain('/audit');
  });
});

/** The sections as the sidebar draws them: heading, then each page with the pages under it. */
const sectionsOf = (role: 'owner' | 'partner' | 'cashier') =>
  navSections(navigationFor(role)).map((section) => ({
    heading: section.label,
    pages: section.nodes.map((node) => [node.item.href, node.children.map((c) => c.href)] as const),
  }));

describe('the navigation in five groups (ADR 0027)', () => {
  it('puts the owner’s pages under Main, Operations, Finance, Reports and Administration', () => {
    setLanguage('en', { persist: false });
    expect(sectionsOf('owner')).toEqual([
      {
        heading: 'Main',
        pages: [
          ['/home', []],
          ['/pos', []],
          ['/inventory', []],
          ['/customers', []],
        ],
      },
      {
        heading: 'Operations',
        pages: [
          ['/payables', []],
          ['/expenses', []],
        ],
      },
      {
        heading: 'Finance',
        pages: [
          ['/settlements', []],
          ['/zakat', []],
        ],
      },
      // The Reports item says what its group is, so the group has no heading of its own.
      { heading: undefined, pages: [['/reports', ['/integrity']]] },
      {
        heading: 'Administration',
        pages: [
          ['/audit', []],
          ['/settings', []],
        ],
      },
    ]);
  });

  it('nests Financial Integrity under Reports and has no entry of its own for it', () => {
    setLanguage('en', { persist: false });
    const items = navigationFor('owner');
    const integrity = items.find((item) => item.href === '/integrity');
    expect(integrity).toMatchObject({ label: 'Financial Integrity', parent: '/reports' });
    expect(items.filter((item) => item.href === '/integrity')).toHaveLength(1);
    expect(items.find((item) => item.href === '/reports')?.parent).toBeUndefined();
    // The address is the one that was bookmarked: only where it sits in the menu moved.
    expect(mayOpen('owner', '/integrity')).toBe(true);
  });

  it('gives a partner Reports without the page under it, and a cashier neither', () => {
    setLanguage('en', { persist: false });
    expect(sectionsOf('partner')).toEqual([
      {
        heading: 'Main',
        pages: [
          ['/home', []],
          ['/pos', []],
          ['/inventory', []],
          ['/customers', []],
        ],
      },
      {
        heading: 'Operations',
        pages: [
          ['/payables', []],
          ['/expenses', []],
        ],
      },
      {
        heading: 'Finance',
        pages: [
          ['/settlements', []],
          ['/zakat', []],
        ],
      },
      { heading: undefined, pages: [['/reports', []]] },
      { heading: 'Administration', pages: [['/settings', []]] },
    ]);
    expect(sectionsOf('cashier')).toEqual([
      {
        heading: 'Main',
        pages: [
          ['/home', []],
          ['/pos', []],
          ['/inventory', []],
          ['/customers', []],
        ],
      },
      { heading: 'Administration', pages: [['/settings', []]] },
    ]);
  });

  it('keeps the four pages of the phone’s tab bar, whoever is signed in', () => {
    for (const role of ['owner', 'partner', 'cashier'] as const) {
      expect(
        navigationFor(role)
          .filter((item) => item.tab)
          .map((item) => item.href),
      ).toEqual(['/home', '/pos', '/inventory', '/customers']);
    }
  });

  it('names the groups and the page in the language shown', () => {
    setLanguage('ar', { persist: false });
    expect(sectionsOf('owner').map((section) => section.heading)).toEqual([
      'الرئيسي',
      'العمليات',
      'المالية',
      undefined,
      'الإدارة',
    ]);
    expect(navigationFor('owner').find((item) => item.href === '/integrity')?.label).toBe(
      'التطابق المالي',
    );
    setLanguage('en', { persist: false });
  });

  it('lists every address once: no page is in the menu twice', () => {
    for (const role of ['owner', 'partner', 'cashier'] as const) {
      const hrefs = navigationFor(role).map((item) => item.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      // Everything a role may open and the menu offers is reachable in the sections.
      const drawn = navSections(navigationFor(role)).flatMap((section) =>
        section.nodes.flatMap((node) => [node.item.href, ...node.children.map((c) => c.href)]),
      );
      expect([...drawn].sort()).toEqual([...hrefs].sort());
    }
  });
});
