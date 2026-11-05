import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, shopToday } from './dates';

describe('dates', () => {
  it('counts whole days between two dates, across months', () => {
    expect(daysBetween('2026-10-01', '2026-10-30')).toBe(29);
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-30', '2026-10-30')).toBe(0);
  });

  it('today is the shop’s date', () => {
    expect(shopToday(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-16');
  });

  it('moves a date by whole days across month, year and leap-day edges', () => {
    expect(addDays('2026-10-30', 0)).toBe('2026-10-30');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -29)).toBe('2026-01-31');
  });
});
