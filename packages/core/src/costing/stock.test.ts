import { describe, expect, it } from 'vitest';
import { costBasisLength, isConsumption, remainingLength } from './stock.js';

describe('remainingLength', () => {
  it('T3: 230 cm minus 100, 100, 30 → 0', () => {
    const moves = [
      { type: 'sale', deltaCm: -100 },
      { type: 'sale', deltaCm: -100 },
      { type: 'sale', deltaCm: -30 },
    ] as const;
    expect(remainingLength(230, moves)).toBe(0);
  });

  it('T4: does not count the purchase move twice; applies the −400 correction', () => {
    const moves = [
      { type: 'purchase', deltaCm: 8000 },
      { type: 'length_correction', deltaCm: -400 },
    ] as const;
    expect(remainingLength(8000, moves)).toBe(7600);
  });

  it('T12: a 30 cm loss leaves 4970 of 5000', () => {
    expect(remainingLength(5000, [{ type: 'loss', deltaCm: -30 }])).toBe(4970);
  });

  it('counts returns and stocktake adjustments both ways', () => {
    const moves = [
      { type: 'sale', deltaCm: -1000 },
      { type: 'return', deltaCm: 200 },
      { type: 'adjustment', deltaCm: -50 },
      { type: 'adjustment', deltaCm: 20 },
    ] as const;
    expect(remainingLength(5000, moves)).toBe(4170);
  });

  it('goes negative when two offline devices sold the same length (flag, never block)', () => {
    expect(
      remainingLength(100, [
        { type: 'sale', deltaCm: -100 },
        { type: 'sale', deltaCm: -100 },
      ]),
    ).toBe(-100);
  });

  it.each([
    [{ type: 'sale', deltaCm: 100 }, 'sale must have a negative deltaCm'],
    [{ type: 'loss', deltaCm: 0 }, 'loss must have a negative deltaCm'],
    [{ type: 'return', deltaCm: -5 }, 'return must have a positive deltaCm'],
    [{ type: 'sale', deltaCm: -2.5 }, 'must be a safe integer'],
  ] as const)('rejects %j', (move, message) => {
    expect(() => remainingLength(5000, [move])).toThrow(message);
  });

  it('rejects a non-positive initial length', () => {
    expect(() => remainingLength(0, [])).toThrow(RangeError);
  });
});

describe('costBasisLength', () => {
  it('is the initial length plus corrections only', () => {
    const moves = [
      { type: 'sale', deltaCm: -1000 },
      { type: 'length_correction', deltaCm: -400 },
      { type: 'adjustment', deltaCm: -30 },
      { type: 'length_correction', deltaCm: 150 },
    ] as const;
    expect(costBasisLength(8000, moves)).toBe(7750);
  });

  it('rejects a correction to 0 cm or less', () => {
    expect(() => costBasisLength(100, [{ type: 'length_correction', deltaCm: -100 }])).toThrow(
      '>= 1 cm',
    );
  });
});

describe('isConsumption', () => {
  it.each([
    ['sale', true],
    ['loss', true],
    ['purchase', false],
    ['length_correction', false],
    ['adjustment', false],
    ['return', false],
  ] as const)('%s → %s', (type, expected) => {
    expect(isConsumption(type)).toBe(expected);
  });
});
