import { describe, expect, it } from 'vitest';
import { daysBetween, shopToday } from './dates';

describe('dates', () => {
  it('counts whole days between two dates, across months', () => {
    expect(daysBetween('2026-10-01', '2026-10-30')).toBe(29);
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-30', '2026-10-30')).toBe(0);
  });

  it('today is the shop’s date', () => {
    expect(shopToday(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-16');
  });
});
