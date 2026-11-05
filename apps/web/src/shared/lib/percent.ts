import { divRoundHalfUp } from '@fabric/core';

/**
 * `part` of `whole` in thousandths (333 = 33.3%), rounded half up. For showing a weight as a
 * percentage only: no amount is ever computed from it (the split rule's weights are).
 */
export function permilleOf(part: number, whole: number): number {
  return whole > 0 ? divRoundHalfUp(part * 1000, whole) : 0;
}

/** Thousandths as text, Western digits: 333 → "33.3%", 500 → "50%", 1000 → "100%". */
export function formatPermille(permille: number): string {
  const whole = Math.trunc(permille / 10);
  const tenth = permille % 10;
  return `${String(whole)}${tenth === 0 ? '' : `.${String(tenth)}`}%`;
}
