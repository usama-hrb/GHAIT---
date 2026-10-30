import { mulDivRoundHalfUp } from './rounding.js';

/** 10000 basis points = 100%. 5000 = 50%, 3333 ≈ 33.33%. */
export const BASIS_POINTS_PER_WHOLE = 10_000;

export function isBasisPoints(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= BASIS_POINTS_PER_WHOLE;
}

/** amount × bp / 10000, rounded half up. applyBasisPoints(80000, 250) = 2000 (2.5%). */
export function applyBasisPoints(amount: number, bp: number): number {
  if (!isBasisPoints(bp)) throw new RangeError(`not a basis-point value: ${String(bp)}`);
  return mulDivRoundHalfUp(amount, bp, BASIS_POINTS_PER_WHOLE);
}
