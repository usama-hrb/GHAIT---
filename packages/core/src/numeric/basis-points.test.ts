import { describe, expect, it } from 'vitest';
import { applyBasisPoints, isBasisPoints } from './basis-points.js';

describe('basis points', () => {
  it.each([0, 1, 3333, 5000, 10_000])('%i is valid', (bp) => {
    expect(isBasisPoints(bp)).toBe(true);
  });

  it.each([-1, 10_001, 33.3, Number.NaN])('%d is not', (bp) => {
    expect(isBasisPoints(bp)).toBe(false);
  });

  it.each([
    [80000, 250, 2000], // 2.5%
    [10000, 5000, 5000], // 50%
    [10000, 3333, 3333],
    [1, 5000, 1], // 0.5 rounds up
    [3, 3333, 1],
  ])('%i × %i bp → %i', (amount, bp, expected) => {
    expect(applyBasisPoints(amount, bp)).toBe(expected);
  });

  it('rejects invalid basis points', () => {
    expect(() => applyBasisPoints(100, 10_001)).toThrow(RangeError);
  });
});
