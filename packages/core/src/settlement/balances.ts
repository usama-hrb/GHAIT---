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

/** One partner's account (SPEC §6, §8.4, BUILD_PROMPTS 4.2): every figure from their records. */
export interface PartnerAccount {
  /** Σ capital_move: contributions + retained profit − withdrawals. */
  capitalCents: number;
  contributionsCents: number;
  retainedProfitCents: number;
  /** Capital taken back, as a positive amount. */
  withdrawalsCents: number;
  /** Their shares of settled profit (settlements, BUILD_PROMPTS 4.3). */
  sharesCents: number;
  drawsCents: number;
  /** Shares − draws: positive, the shop owes it to them; negative, they drew ahead ("عليه"). */
  undrawnCents: number;
}

export function partnerAccount(input: {
  capitalMoves: readonly ({ type: CapitalMoveType; amountCents: number } & Voidable)[];
  shares: readonly ({ amountCents: number } & Voidable)[];
  draws: readonly ({ amountCents: number } & Voidable)[];
}): PartnerAccount {
  const live = <T extends Voidable>(records: readonly T[]) =>
    records.filter((record) => !record.voided);
  const total = (type: CapitalMoveType) =>
    live(input.capitalMoves)
      .filter((move) => move.type === type)
      .reduce((sum, move) => sum + move.amountCents, 0);
  const sharesCents = partnerBalance(input.shares, []);
  const drawsCents = 0 - partnerBalance([], input.draws);
  return {
    capitalCents: partnerCapital(input.capitalMoves),
    contributionsCents: total('contribution'),
    retainedProfitCents: total('retained_profit'),
    withdrawalsCents: 0 - total('withdrawal'),
    sharesCents,
    drawsCents,
    undrawnCents: sharesCents - drawsCents,
  };
}

/** What needs an explicit confirmation before it is recorded (BUILD_PROMPTS 4.2). */
export type PartnerWarning = 'capital_below_zero' | 'draw_beyond_share';

/** Taking `amountCents` of capital back would leave the partner's capital below zero. */
export function withdrawalWarnings(account: PartnerAccount, amountCents: number): PartnerWarning[] {
  assertInteger(amountCents, 'amountCents', 1);
  return account.capitalCents - amountCents < 0 ? ['capital_below_zero'] : [];
}

/** Drawing `amountCents` would take more than the partner's undrawn share (they would owe it). */
export function drawWarnings(account: PartnerAccount, amountCents: number): PartnerWarning[] {
  assertInteger(amountCents, 'amountCents', 1);
  return account.undrawnCents - amountCents < 0 ? ['draw_beyond_share'] : [];
}
