import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { categoryName } from './category-name';

describe('categoryName', () => {
  it('names a shipped category in the language shown', () => {
    setLanguage('en', { persist: false });
    expect(categoryName({ key: 'rent', label: 'كراء' })).toBe('Rent');
    setLanguage('ar', { persist: false });
    expect(categoryName({ key: 'rent', label: 'كراء' })).toBe('كراء');
  });

  it('keeps the name the owner gave to a renamed or added category', () => {
    setLanguage('en', { persist: false });
    expect(categoryName({ key: 'rent', label: 'Shop rent' })).toBe('Shop rent');
    expect(categoryName({ key: 'insurance', label: 'تأمين' })).toBe('تأمين');
  });
});
