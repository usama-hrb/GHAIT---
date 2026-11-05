import { describe, expect, it } from 'vitest';
import { mayOpenSection, sectionOfPath, settingsSections } from './sections';

describe('the settings sections', () => {
  it('are five for the owner and the partner, in one order', () => {
    const keys = (role: 'owner' | 'partner') => settingsSections(role).map((entry) => entry.key);
    expect(keys('owner')).toEqual(['profile', 'regional', 'partners', 'sync', 'data']);
    expect(keys('partner')).toEqual(keys('owner'));
  });

  it('leave the partners out for a cashier, who sees the rest', () => {
    expect(settingsSections('cashier').map((entry) => entry.key)).toEqual([
      'profile',
      'regional',
      'sync',
      'data',
    ]);
    expect(mayOpenSection('cashier', 'partners')).toBe(false);
    expect(mayOpenSection(undefined, 'partners')).toBe(false);
  });

  it('each have a title and a description', () => {
    for (const section of settingsSections('owner')) {
      expect(section.title).not.toBe('');
      expect(section.description).not.toBe('');
    }
  });
});

describe('which section a path is in', () => {
  it('knows each section’s own page', () => {
    expect(sectionOfPath('/settings')).toEqual({ key: 'profile', inner: false });
    expect(sectionOfPath('/settings/regional')).toEqual({ key: 'regional', inner: false });
    expect(sectionOfPath('/settings/partners')).toEqual({ key: 'partners', inner: false });
    expect(sectionOfPath('/settings/sync')).toEqual({ key: 'sync', inner: false });
    expect(sectionOfPath('/settings/data')).toEqual({ key: 'data', inner: false });
  });

  it('puts a partner’s account and an employee’s page inside the partners section, and ignores a trailing slash', () => {
    expect(sectionOfPath('/settings/partners/view')).toEqual({ key: 'partners', inner: true });
    expect(sectionOfPath('/settings/partners/employee')).toEqual({ key: 'partners', inner: true });
    expect(sectionOfPath('/settings/partners/')).toEqual({ key: 'partners', inner: false });
  });

  it('does not take a lookalike for a section', () => {
    expect(sectionOfPath('/settings/partnersx')).toEqual({ key: 'profile', inner: false });
  });
});
