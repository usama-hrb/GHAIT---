import { assertInteger } from './assert.js';

/**
 * Splits a non-negative integer total by integer weights, exactly: the parts always add up to
 * the total. Each part starts at floor(total × weight / Σ weights); the units left over go
 * - all to the part at `remainderTo` when given (SPEC §8.1: the shop gets the division cents),
 *   splitByWeights(10000, [1, 1, 1], 2) = [3333, 3333, 3334] (T7);
 * - otherwise one each to the largest fractional remainders, ties to the earlier weight
 *   (largest remainder), splitByWeights(3333, [5000, 5000]) = [1667, 1666].
 * Products are computed with BigInt, so large weights are safe.
 */
export function splitByWeights(
  total: number,
  weights: readonly number[],
  remainderTo?: number,
): number[] {
  assertInteger(total, 'total', 0);
  if (weights.length === 0) throw new RangeError('splitByWeights: no weights');
  let weightSum = 0n;
  for (const [index, weight] of weights.entries()) {
    assertInteger(weight, `weights[${String(index)}]`, 0);
    weightSum += BigInt(weight);
  }
  if (weightSum === 0n) throw new RangeError('splitByWeights: weights must not all be 0');
  if (
    remainderTo !== undefined &&
    (!Number.isInteger(remainderTo) || remainderTo < 0 || remainderTo >= weights.length)
  ) {
    throw new RangeError(
      `splitByWeights: remainderTo ${String(remainderTo)} is not a weight index`,
    );
  }

  const exact = weights.map((weight) => {
    const product = BigInt(total) * BigInt(weight);
    return { part: Number(product / weightSum), rest: product % weightSum };
  });
  const leftover = total - exact.reduce((sum, { part }) => sum + part, 0);

  if (remainderTo !== undefined) {
    return exact.map(({ part }, index) => (index === remainderTo ? part + leftover : part));
  }
  // Fewer units are left over than there are weights, so each gets at most one.
  const byRest = exact
    .map(({ rest }, index) => ({ rest, index }))
    .sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  const extra = new Set(byRest.slice(0, leftover).map(({ index }) => index));
  return exact.map(({ part }, index) => (extra.has(index) ? part + 1 : part));
}
