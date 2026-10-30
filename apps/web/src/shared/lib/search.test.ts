import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeForSearch } from './search';

describe('normalizeForSearch', () => {
  it('ignores diacritics, tatweel and letter variants', () => {
    expect(normalizeForSearch('أَحْمَـــر')).toBe('احمر');
    expect(normalizeForSearch('إبرة')).toBe('ابره');
    expect(normalizeForSearch('مستشفى')).toBe('مستشفي');
    expect(normalizeForSearch('  Crêpe  KOREA ')).toBe('crêpe korea');
    expect(normalizeForSearch('رول ١٢٣')).toBe('رول 123');
  });
});

describe('matchesSearch', () => {
  it('needs every word somewhere in the fields', () => {
    expect(matchesSearch('روزا احمر', ['روزا', 'أحمر'])).toBe(true);
    expect(matchesSearch('روزا ازرق', ['روزا', 'أحمر'])).toBe(false);
    expect(matchesSearch('', ['anything'])).toBe(true);
    expect(matchesSearch('كريب', [null, undefined, 'كريب كوريا'])).toBe(true);
  });
});
