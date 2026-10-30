import { describe, expect, it } from 'vitest';
import { deviceCodeOf } from './device-code.js';

describe('deviceCodeOf', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
  ])('%i → %s', (n, code) => {
    expect(deviceCodeOf(n)).toBe(code);
  });

  it('rejects numbers below 1', () => {
    expect(() => deviceCodeOf(0)).toThrow(RangeError);
  });
});
