import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatWeight, formatWeightKg, parseWeightInput } from './index.js';

describe('parseWeightInput', () => {
  it.each([
    ['20', 20_000],
    ['20.5', 20_500],
    ['٢٠٫٥', 20_500],
    ['0.125', 125],
    ['1,5', 1500],
  ])('%s kg → %i g', (text, grams) => {
    expect(parseWeightInput(text)).toEqual({ ok: true, value: grams });
  });

  it.each([
    ['', 'empty'],
    ['abc', 'invalid'],
    ['-1', 'negative'],
    ['1.0005', 'too_precise'],
  ])('rejects %j (%s)', (text, error) => {
    expect(parseWeightInput(text)).toEqual({ ok: false, error });
  });
});

describe('formatWeight', () => {
  it.each([
    [20_000, '20'],
    [20_500, '20.5'],
    [125, '0.125'],
    [1_234_500, '1,234.5'],
  ])('%i g → %s', (grams, text) => {
    expect(formatWeightKg(grams)).toBe(text);
  });

  it('adds the unit with a no-break space, and can drop grouping', () => {
    expect(formatWeight(20_500)).toBe('20.5 كغ');
    expect(formatWeightKg(1_234_500, { grouping: false })).toBe('1234.5');
  });

  it('rejects negative and fractional grams', () => {
    expect(() => formatWeightKg(-1)).toThrow(RangeError);
    expect(() => formatWeightKg(1.5)).toThrow(RangeError);
  });

  it('property: format then parse gives the grams back', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000_000 }), (grams) => {
        expect(parseWeightInput(formatWeightKg(grams, { grouping: false }))).toEqual({
          ok: true,
          value: grams,
        });
      }),
    );
  });
});
