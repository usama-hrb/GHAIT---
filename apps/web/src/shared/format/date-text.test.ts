import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { formatDate } from './date-text';

// Midday UTC: the same calendar day in Morocco whichever offset it has.
const DAY = '2026-10-31T12:00:00Z';

describe('formatDate', () => {
  it('writes English dates day first, Gregorian, with Western digits', () => {
    expect(formatDate(DAY, 'long', 'en')).toBe('31 October 2026');
    expect(formatDate(DAY, 'medium', 'en')).toBe('31 Oct 2026');
    expect(formatDate(DAY, 'short', 'en')).toBe('31/10/2026');
    expect(formatDate(DAY, 'month', 'en')).toBe('October 2026');
  });

  it('writes Arabic dates with Morocco month names and Western digits', () => {
    expect(formatDate(DAY, 'long', 'ar')).toBe('31 أكتوبر 2026');
    expect(formatDate('2026-11-30T12:00:00Z', 'long', 'ar')).toBe('30 نونبر 2026');
  });

  it('shows the time on a date-and-time', () => {
    expect(formatDate(DAY, 'dateTime', 'en')).toMatch(/^31 Oct 2026, \d{2}:\d{2}$/);
  });

  it('writes the Hijri date only for the hijri format (the zakat hawl)', () => {
    expect(formatDate(DAY, 'hijri', 'ar')).toBe('20 جمادى الأولى 1448 هـ');
    expect(formatDate(DAY, 'hijri', 'en')).toBe('20 Jumada I 1448 AH');
  });

  it('reads a plain YYYY-MM-DD as that day in the shop’s zone', () => {
    expect(formatDate('2026-10-30', 'long', 'en')).toBe('30 October 2026');
  });

  it('follows the language shown when none is given', () => {
    setLanguage('en', { persist: false });
    expect(formatDate(DAY, 'long')).toBe('31 October 2026');
    setLanguage('ar', { persist: false });
    expect(formatDate(DAY, 'long')).toBe('31 أكتوبر 2026');
  });
});
