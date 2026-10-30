import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  directionSafeSign,
  groupThousands,
  normalizeDigits,
  parseScaledDecimal,
} from './decimal.js';

describe('normalizeDigits', () => {
  it('maps Arabic-Indic and Persian digits to ASCII', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeDigits('٢٠٫٥ د')).toBe('20٫5 د');
  });
});

describe('parseScaledDecimal', () => {
  it.each([
    ['20.5', 2, 2050],
    ['20.50', 2, 2050],
    ['20', 2, 2000],
    ['0.01', 2, 1],
    ['.5', 2, 50],
    ['5.', 2, 500],
    ['007', 2, 700],
    ['2.500', 2, 250],
    ['  2.75  ', 2, 275],
    ['+3', 2, 300],
    ['-0', 2, 0],
    ['٢٠٫٥', 2, 2050],
    ['۲,۷۵', 2, 275],
    ['20,5', 2, 2050],
    ['‏20.5‎', 2, 2050],
    ['410', 0, 410],
  ])('%j at scale %i → %i', (text, scale, expected) => {
    expect(parseScaledDecimal(text, scale)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['.', 'invalid'],
    ['abc', 'invalid'],
    ['1.2.3', 'invalid'],
    ['1,234.5', 'invalid'],
    ['1 234', 'invalid'],
    ['1e3', 'invalid'],
    ['--1', 'invalid'],
    ['NaN', 'invalid'],
    ['Infinity', 'invalid'],
    ['2.555', 'too_precise'],
    ['-5', 'negative'],
    ['90071992547409.92', 'too_large'],
  ])('%j → %s', (text, error) => {
    expect(parseScaledDecimal(text, 2)).toEqual({ ok: false, error });
  });

  it('accepts negatives only when allowed', () => {
    expect(parseScaledDecimal('-2.5', 2, { allowNegative: true })).toEqual({
      ok: true,
      value: -250,
    });
  });

  it('accepts the largest safe value', () => {
    expect(parseScaledDecimal('90071992547409.91', 2)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it('round-trips any safe non-negative integer written with 2 decimals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const text = `${String(Math.floor(n / 100))}.${String(n % 100).padStart(2, '0')}`;
        expect(parseScaledDecimal(text, 2)).toEqual({ ok: true, value: n });
      }),
    );
  });
});

describe('groupThousands', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['30000', '30,000'],
    ['1234567', '1,234,567'],
  ])('%s → %s', (digits, expected) => {
    expect(groupThousands(digits)).toBe(expected);
  });
});

describe('directionSafeSign', () => {
  it('prefixes an LRM to negative numbers only', () => {
    expect(directionSafeSign('-410')).toBe('‎-410');
    expect(directionSafeSign('410')).toBe('410');
    expect(directionSafeSign('0')).toBe('0');
  });
});
