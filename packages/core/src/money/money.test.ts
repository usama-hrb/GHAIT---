import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CM_PER_METER, fromMeters } from '../length/index.js';
import { mulDivRoundHalfUp } from '../numeric/index.js';
import {
  formatMoney,
  formatMoneyAmount,
  fromDirham,
  fromRial,
  isCents,
  parseMoneyInput,
  toDirham,
  toRial,
} from './index.js';

describe('unit conversion (SPEC §0.2)', () => {
  it('20.5 dirham = 410 rial = 2050 cents', () => {
    expect(fromDirham(20.5)).toBe(2050);
    expect(fromDirham('20.5')).toBe(2050);
    expect(fromRial(410)).toBe(2050);
    expect(toDirham(2050)).toBe(20.5);
    expect(toRial(2050)).toBe(410);
  });

  it('1 dirham = 20 rial = 100 cents', () => {
    expect(fromDirham(1)).toBe(100);
    expect(fromRial(20)).toBe(100);
    expect(fromRial(1)).toBe(5);
  });

  it('never silently absorbs floating-point drift', () => {
    expect(fromDirham(0.3)).toBe(30);
    expect(fromDirham('0.30')).toBe(30);
    // 0.1 + 0.2 === 0.30000000000000004: not a whole number of cents, so it is rejected.
    expect(() => fromDirham(0.1 + 0.2)).toThrow(/too_precise/);
  });

  it('computed cost per metre 43.478… dirham displays as 43.48 / 869.6', () => {
    // SPEC T2: round(10000 * 100 / 230) = 4348 cents per metre.
    expect(formatMoneyAmount(4348, 'dirham')).toBe('43.48');
    expect(formatMoneyAmount(4348, 'rial')).toBe('869.6');
  });

  it('throws on amounts that are not whole cents', () => {
    expect(() => fromDirham(20.555)).toThrow(RangeError);
    expect(() => fromRial(410.5)).toThrow(/not_exact/);
    expect(() => fromDirham(Number.NaN)).toThrow(RangeError);
    expect(() => fromDirham(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => fromDirham(1e21)).toThrow(RangeError);
  });

  it('accepts negative amounts in fromDirham/fromRial', () => {
    expect(fromDirham(-1.5)).toBe(-150);
    expect(fromRial('-3')).toBe(-15);
  });

  it('toDirham/toRial reject non-integer cents', () => {
    expect(() => toDirham(1.5)).toThrow(RangeError);
    expect(() => toRial(Number.NaN)).toThrow(RangeError);
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['410', 'rial', 2050],
    ['٤١٠', 'rial', 2050],
    ['869.6', 'rial', 4348],
    ['0.2', 'rial', 1],
    ['20.5', 'dirham', 2050],
    ['٢٠٫٥', 'dirham', 2050],
    ['20,50', 'dirham', 2050],
    ['0', 'dirham', 0],
  ] as const)('%j in %s → %i cents', (text, unit, cents) => {
    expect(parseMoneyInput(text, unit)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ['410.5', 'rial', 'not_exact'], // half a rial = 2.5 cents
    ['410.1', 'rial', 'not_exact'],
    ['410.25', 'rial', 'too_precise'],
    ['20.555', 'dirham', 'too_precise'],
    ['-5', 'dirham', 'negative'],
    ['', 'rial', 'empty'],
    ['abc', 'dirham', 'invalid'],
    ['99999999999999999', 'dirham', 'too_large'],
  ] as const)('%j in %s → %s', (text, unit, error) => {
    expect(parseMoneyInput(text, unit)).toEqual({ ok: false, error });
  });

  it('allows negatives on request', () => {
    expect(parseMoneyInput('-20', 'rial', { allowNegative: true })).toEqual({
      ok: true,
      value: -100,
    });
  });
});

describe('formatMoneyAmount', () => {
  it.each([
    [2050, 'dirham', '20.50'],
    [2050, 'rial', '410'],
    [10000, 'dirham', '100'],
    [5, 'dirham', '0.05'],
    [1, 'rial', '0.2'],
    [0, 'rial', '0'],
    [3_000_000, 'dirham', '30,000'],
    [123_456_789, 'dirham', '1,234,567.89'],
    [-2050, 'dirham', '-20.50'],
    [-4348, 'rial', '-869.6'],
    [Number.MAX_SAFE_INTEGER, 'dirham', '90,071,992,547,409.91'],
  ] as const)('%i cents in %s → %s', (cents, unit, text) => {
    expect(formatMoneyAmount(cents, unit)).toBe(text);
  });

  it('rejects non-integer cents', () => {
    expect(() => formatMoneyAmount(1.5, 'rial')).toThrow(RangeError);
  });

  it('can omit thousands separators (input fields)', () => {
    expect(formatMoneyAmount(123_456_789, 'dirham', { grouping: false })).toBe('1234567.89');
    expect(formatMoneyAmount(-6_000_000, 'rial', { grouping: false })).toBe('-1200000');
  });
});

describe('formatMoney (plain text with unit)', () => {
  const NBSP = ' ';
  const LRM = '‎';

  it.each([
    [2050, 'rial', `410${NBSP}ريال`],
    [2050, 'dirham', `20.50${NBSP}د`],
    [10_000, 'dirham', `100${NBSP}د`],
    [4348, 'rial', `869.6${NBSP}ريال`],
    [4348, 'dirham', `43.48${NBSP}د`],
    [3_000_000, 'dirham', `30,000${NBSP}د`], // SPEC T14 writes "30,000 د"
    [0, 'rial', `0${NBSP}ريال`],
    [-2050, 'rial', `${LRM}-410${NBSP}ريال`],
    [-480, 'dirham', `${LRM}-4.80${NBSP}د`], // SPEC T12 loss
    [Number.MAX_SAFE_INTEGER, 'rial', `1,801,439,850,948,198.2${NBSP}ريال`],
  ] as const)('%i cents in %s → %j', (cents, unit, text) => {
    expect(formatMoney(cents, unit)).toBe(text);
    expect(formatMoney(cents, unit, 'ar')).toBe(text);
    // English labels: "rial" and "dh" in place of "ريال" and "د".
    expect(formatMoney(cents, unit, 'en')).toBe(
      text.replace('\u00A0ريال', '\u00A0rial').replace('\u00A0د', '\u00A0dh'),
    );
  });

  it('passes format options through', () => {
    expect(formatMoney(123_456_789, 'dirham', 'ar', { grouping: false })).toBe(
      `1234567.89${NBSP}د`,
    );
  });

  it('rejects non-integer cents', () => {
    expect(() => formatMoney(0.5, 'dirham')).toThrow(RangeError);
  });

  it('shows both units for the SPEC §0.2 example "410 ريال (20.5 د)"', () => {
    const cents = fromDirham('20.5');
    expect(`${formatMoney(cents, 'rial')} (${formatMoney(cents, 'dirham')})`).toBe(
      `410${NBSP}ريال (20.50${NBSP}د)`,
    );
  });
});

describe('cost per metre 43.478… (SPEC T2)', () => {
  it('100 dh for a 2.3 m piece = 4348 cents per metre, half up', () => {
    const costPerMeter = mulDivRoundHalfUp(fromDirham(100), CM_PER_METER, fromMeters(2.3));
    expect(costPerMeter).toBe(4348); // 4347.826… → 4348
    expect(formatMoneyAmount(costPerMeter, 'dirham')).toBe('43.48');
    expect(formatMoneyAmount(costPerMeter, 'rial')).toBe('869.6');
  });

  it('a 100 cm line of that piece costs round(10000 × 100 / 230) = 4348', () => {
    expect(mulDivRoundHalfUp(10_000, 100, 230)).toBe(4348);
  });
});

describe('format → parse round trip', () => {
  const cents = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

  it.each(['rial', 'dirham'] as const)('is lossless in %s for every cent amount', (unit) => {
    fc.assert(
      fc.property(cents, (value) => {
        const text = formatMoneyAmount(value, unit, { grouping: false });
        expect(parseMoneyInput(text, unit, { allowNegative: true })).toEqual({ ok: true, value });
      }),
    );
  });

  it('isCents accepts only safe integers', () => {
    expect(isCents(2050)).toBe(true);
    expect(isCents(20.5)).toBe(false);
    expect(isCents(2 ** 53)).toBe(false);
  });
});
