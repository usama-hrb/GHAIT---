import { describe, expect, it } from 'vitest';
import { greetingAt, greetingOf } from './greeting';

describe('the greeting of the day', () => {
  it('is morning until noon, afternoon until 6 pm, evening after, and night counts as evening', () => {
    expect([0, 5, 11].map(greetingOf)).toEqual(['morning', 'morning', 'morning']);
    expect([12, 15, 17].map(greetingOf)).toEqual(['afternoon', 'afternoon', 'afternoon']);
    expect([18, 21, 23].map(greetingOf)).toEqual(['evening', 'evening', 'evening']);
  });

  it('reads the clock of the shop for a moment in time (an hour either side of UTC changes nothing here)', () => {
    expect(greetingAt(new Date('2026-11-03T08:00:00Z'))).toBe('morning');
    expect(greetingAt(new Date('2026-11-03T14:00:00Z'))).toBe('afternoon');
    expect(greetingAt(new Date('2026-11-03T20:00:00Z'))).toBe('evening');
  });
});
