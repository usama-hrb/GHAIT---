import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, mulDivRoundHalfUp } from './rounding.js';

describe('divRoundHalfUp', () => {
  it.each([
    [10000 * 100, 230, 4348], // SPEC T2: 4347.83 → 4348
    [80000 * 30, 5000, 480], // SPEC T12: exact
    [5, 2, 3], // tie rounds up
    [4, 2, 2],
    [7, 3, 2], // 2.33 → 2
    [8, 3, 3], // 2.67 → 3
    [0, 7, 0],
  ])('%i / %i → %i', (n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected);
  });

  it('handles products above MAX_SAFE_INTEGER via bigint', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 3n;
    expect(divRoundHalfUp(huge, 3)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [-1, 2, 'numerator must be >= 0'],
    [1, 0, 'denominator must be > 0'],
    [1, -2, 'denominator must be > 0'],
    [1.5, 2, 'numerator must be a safe integer'],
  ])('rejects %d / %d', (n, d, message) => {
    expect(() => divRoundHalfUp(n, d)).toThrow(message);
  });

  it('rejects results that do not fit a safe integer', () => {
    expect(() => divRoundHalfUp(BigInt(Number.MAX_SAFE_INTEGER) * 2n, 1)).toThrow(RangeError);
  });

  it('is never more than half a unit away from the exact quotient', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (n, d) => {
          const q = divRoundHalfUp(n, d);
          // |q - n/d| <= 1/2  ⇔  |2qd - 2n| <= d, with ties (== d) only rounding up.
          const diff = 2 * q * d - 2 * n;
          expect(diff).toBeGreaterThan(-d);
          expect(diff).toBeLessThanOrEqual(d);
        },
      ),
    );
  });
});

describe('mulDivRoundHalfUp', () => {
  it.each([
    [10_000, 100, 230, 4348], // SPEC T2
    [80_000, 30, 5000, 480], // SPEC T12
    [80_000, 5000, 5000, 80_000],
    [1, 1, 2, 1], // 0.5 rounds up
    [0, 999, 7, 0],
  ])('%i × %i / %i → %i', (a, b, d, expected) => {
    expect(mulDivRoundHalfUp(a, b, d)).toBe(expected);
  });

  it('computes the product exactly even beyond 2^53', () => {
    expect(mulDivRoundHalfUp(Number.MAX_SAFE_INTEGER, 1000, 1000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [1.5, 2, 3, 'a must be a safe integer'],
    [2, Number.NaN, 3, 'b must be a safe integer'],
    [-1, 2, 3, 'numerator must be >= 0'],
    [1, 2, 0, 'denominator must be > 0'],
  ])('rejects %d × %d / %d', (a, b, d, message) => {
    expect(() => mulDivRoundHalfUp(a, b, d)).toThrow(message);
  });

  it('agrees with divRoundHalfUp on the product', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (a, b, d) => {
          expect(mulDivRoundHalfUp(a, b, d)).toBe(divRoundHalfUp(BigInt(a) * BigInt(b), d));
        },
      ),
    );
  });
});
