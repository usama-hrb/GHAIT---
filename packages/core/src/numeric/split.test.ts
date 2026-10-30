import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitByWeights } from './split.js';

describe('splitByWeights', () => {
  it.each([
    [30_000, [1, 1, 1], 2, [10_000, 10_000, 10_000]], // SPEC T6
    [10_000, [1, 1, 1], 2, [3333, 3333, 3334]], // SPEC T7: the remainder goes to the shop
    [20_000, [1, 1, 1], 2, [6666, 6666, 6668]],
    [1, [1, 1, 1], 2, [0, 0, 1]],
    [30_000, [3333, 3333, 3334], 2, [9999, 9999, 10_002]], // basis points are not thirds
    [10_000, [4000, 4000, 2000], 2, [4000, 4000, 2000]],
    [100, [1, 1, 1], 0, [34, 33, 33]],
    [0, [1, 1, 1], 2, [0, 0, 0]],
  ])('%i by %j, remainder to %i → %j', (total, weights, remainderTo, expected) => {
    expect(splitByWeights(total, weights, remainderTo)).toEqual(expected);
  });

  it.each([
    [10_000, [5000, 5000], [5000, 5000]], // SPEC T10
    [3333, [5000, 5000], [1667, 1666]], // tie: the earlier weight
    [10_001, [6000, 4000], [6001, 4000]], // 6000.6 / 4000.4
    [10_001, [3000, 7000], [3000, 7001]], // 3000.3 / 7000.7
    [100, [1, 1, 1], [34, 33, 33]],
    [2, [1, 1, 1], [1, 1, 0]],
    [7, [0, 1], [0, 7]],
  ])('%i by %j, largest remainder → %j', (total, weights, expected) => {
    expect(splitByWeights(total, weights)).toEqual(expected);
  });

  it('handles products above MAX_SAFE_INTEGER via bigint', () => {
    expect(splitByWeights(Number.MAX_SAFE_INTEGER, [1_000_000, 1_000_000])).toEqual([
      4_503_599_627_370_496, 4_503_599_627_370_495,
    ]);
  });

  it.each([
    [-1, [1], undefined, 'total must be >= 0'],
    [1.5, [1], undefined, 'total must be a safe integer'],
    [1, [], undefined, 'no weights'],
    [1, [1, -1], undefined, 'weights[1] must be >= 0'],
    [1, [0, 0], undefined, 'weights must not all be 0'],
    [1, [1, 1], 2, 'remainderTo 2 is not a weight index'],
    [1, [1, 1], -1, 'remainderTo -1 is not a weight index'],
    [1, [1, 1], 0.5, 'remainderTo 0.5 is not a weight index'],
  ])('rejects %i by %j (remainder to %s)', (total, weights, remainderTo, message) => {
    expect(() => splitByWeights(total, weights, remainderTo)).toThrow(message);
  });

  const inputs = fc.record({
    total: fc.integer({ min: 0, max: 1_000_000_000 }),
    weights: fc
      .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 5 })
      .filter((weights) => weights.some((weight) => weight > 0)),
  });

  it('property: the parts add up to the total exactly', () => {
    fc.assert(
      fc.property(inputs, ({ total, weights }) => {
        const sum = (parts: number[]) => parts.reduce((a, b) => a + b, 0);
        expect(sum(splitByWeights(total, weights))).toBe(total);
        expect(sum(splitByWeights(total, weights, weights.length - 1))).toBe(total);
      }),
    );
  });

  it('property: largest remainder keeps every part within one unit of its exact share', () => {
    fc.assert(
      fc.property(inputs, ({ total, weights }) => {
        const weightSum = weights.reduce((a, b) => a + b, 0);
        splitByWeights(total, weights).forEach((part, index) => {
          const exact = (total * (weights[index] ?? 0)) / weightSum;
          expect(part).toBeGreaterThanOrEqual(Math.floor(exact));
          expect(part).toBeLessThanOrEqual(Math.ceil(exact));
        });
      }),
    );
  });

  it('property: with remainderTo, the other parts are rounded down and that part takes the rest', () => {
    fc.assert(
      fc.property(inputs, ({ total, weights }) => {
        const last = weights.length - 1;
        const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
        const parts = splitByWeights(total, weights, last);
        parts.forEach((part, index) => {
          const floor = Number((BigInt(total) * BigInt(weights[index] ?? 0)) / weightSum);
          if (index === last) expect(part).toBeGreaterThanOrEqual(floor);
          else expect(part).toBe(floor);
        });
      }),
    );
  });
});
