import { assertInteger } from '../numeric/index.js';

interface Voidable {
  /** Voided records (voided_at set) no longer count (SPEC §11). */
  voided?: boolean;
}

/**
 * A partner's undrawn profit: Σ their settlement shares − Σ their partner_draw (SPEC §8.1, §13).
 * Positive = the shop owes it to them ("له"); negative = they drew more than their shares ("عليه").
 */
export function partnerBalance(
  shares: readonly ({ amountCents: number } & Voidable)[],
  draws: readonly ({ amountCents: number } & Voidable)[],
): number {
  let balance = 0;
  for (const share of shares) {
    assertInteger(share.amountCents, 'share amountCents', 0);
    if (!share.voided) balance += share.amountCents;
  }
  for (const draw of draws) {
    assertInteger(draw.amountCents, 'draw amountCents', 1);
    if (!draw.voided) balance -= draw.amountCents;
  }
  return balance;
}

export type CapitalMoveType = 'contribution' | 'retained_profit' | 'withdrawal';

/**
 * A partner's capital: Σ capital_move (SPEC §8.4, §13). Contributions and retained profit are
 * positive, withdrawals negative.
 */
export function partnerCapital(
  moves: readonly ({ type: CapitalMoveType; amountCents: number } & Voidable)[],
): number {
  let capital = 0;
  for (const move of moves) {
    assertInteger(move.amountCents, `${move.type} amountCents`);
    if (move.type === 'withdrawal' ? move.amountCents >= 0 : move.amountCents <= 0) {
      throw new RangeError(
        `${move.type} must be ${move.type === 'withdrawal' ? 'negative' : 'positive'}, got ${String(move.amountCents)}`,
      );
    }
    if (!move.voided) capital += move.amountCents;
  }
  return capital;
}
