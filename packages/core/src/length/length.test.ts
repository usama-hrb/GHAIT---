import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatLength,
  formatLengthMeters,
  fromMeters,
  parseLengthInput,
  toMeters,
} from './index.js';

describe('length', () => {
  it('2.75 m = 275 cm, 50 m = 5000 cm (SPEC §0.2, T1)', () => {
    expect(fromMeters(2.75)).toBe(275);
    expect(fromMeters('50')).toBe(5000);
    expect(toMeters(275)).toBe(2.75);
  });

  it('accepts 1 cm precision, rejects finer', () => {
    expect(fromMeters(2.55)).toBe(255);
    expect(() => fromMeters(2.555)).toThrow(/too_precise/);
    expect(() => fromMeters(Number.NaN)).toThrow(RangeError);
  });

  it.each([
    ['2.75', 275],
    ['٢٫٧٥', 275],
    ['0.5', 50],
    ['2,5', 250],
    ['230', 23_000],
  ])('parses %j → %i cm', (text, cm) => {
    expect(parseLengthInput(text)).toEqual({ ok: true, value: cm });
  });

  it.each([
    ['', 'empty'],
    ['-1', 'negative'],
    ['1.234', 'too_precise'],
    ['m', 'invalid'],
  ])('rejects %j (%s)', (text, error) => {
    expect(parseLengthInput(text)).toEqual({ ok: false, error });
  });

  it('allows negative corrections on request', () => {
    expect(parseLengthInput('-4', { allowNegative: true })).toEqual({ ok: true, value: -400 });
  });

  it.each([
    [275, '2.75'],
    [250, '2.5'],
    [5000, '50'],
    [1, '0.01'],
    [0, '0'],
    [123_456, '1,234.56'],
    [-400, '-4'],
  ])('formats %i cm → %s', (cm, text) => {
    expect(formatLengthMeters(cm)).toBe(text);
  });

  it('can omit thousands separators (input fields)', () => {
    expect(formatLengthMeters(123_456, { grouping: false })).toBe('1234.56');
  });

  it('rejects non-integer cm', () => {
    expect(() => formatLengthMeters(2.5)).toThrow(RangeError);
    expect(() => toMeters(Number.NaN)).toThrow(RangeError);
  });

  it.each([
    [275, '2.75 م'],
    [5000, '50 م'],
    [23_000, '230 م'],
    [255, '2.55 م'],
    [123_456, '1,234.56 م'],
    [-400, '‎-4 م'], // SPEC T4 length_correction −400
  ])('formatLength(%i) → %j', (cm, text) => {
    expect(formatLength(cm)).toBe(text);
    expect(formatLength(cm, 'ar')).toBe(text);
    // The same digits with the English unit.
    expect(formatLength(cm, 'en')).toBe(text.replace('\u00A0م', '\u00A0m'));
  });

  it('formatLength passes options and rejects non-integer cm', () => {
    expect(formatLength(123_456, 'ar', { grouping: false })).toBe('1234.56 م');
    expect(() => formatLength(0.5)).toThrow(RangeError);
  });

  it('round-trips every cm value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (cm) => {
        const text = formatLengthMeters(cm, { grouping: false });
        expect(parseLengthInput(text, { allowNegative: true })).toEqual({ ok: true, value: cm });
      }),
    );
  });
});
