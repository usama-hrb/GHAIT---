/**
 * Integer division rounded half up: divRoundHalfUp(10000 * 100, 230) = 4348 (4347.83…),
 * divRoundHalfUp(5, 2) = 3.
 *
 * Only defined for a non-negative numerator and a positive denominator: every amount we
 * divide today (costs, lengths) is non-negative; the tie rule for negatives is decided when
 * first needed (SPEC §0.2). Uses BigInt internally, so the product in the numerator may exceed
 * Number.MAX_SAFE_INTEGER; the result must not.
 */
export function divRoundHalfUp(numerator: number | bigint, denominator: number | bigint): number {
  const n = toBigInt(numerator, 'numerator');
  const d = toBigInt(denominator, 'denominator');
  if (n < 0n) throw new RangeError('divRoundHalfUp: numerator must be >= 0');
  if (d <= 0n) throw new RangeError('divRoundHalfUp: denominator must be > 0');
  const result = (2n * n + d) / (2n * d);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('divRoundHalfUp: result exceeds Number.MAX_SAFE_INTEGER');
  }
  return Number(result);
}

/**
 * a × b / d rounded half up, with the product computed exactly (BigInt):
 * mulDivRoundHalfUp(10000, 100, 230) = 4348, i.e. cost_total × sold_cm / length_cm (SPEC §2.4).
 * Same domain as divRoundHalfUp: a, b >= 0, d > 0, all safe integers.
 */
export function mulDivRoundHalfUp(a: number, b: number, d: number): number {
  return divRoundHalfUp(toBigInt(a, 'a') * toBigInt(b, 'b'), d);
}

function toBigInt(value: number | bigint, name: string): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`rounding: ${name} must be a safe integer`);
  }
  return BigInt(value);
}
