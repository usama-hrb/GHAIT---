import type { CashFlows } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, isoDateSchema, optionalTextSchema } from './common.js';
import type { Payment } from './customers.js';
import type { ValidationIssue } from './errors.js';
import type { Expense } from './expenses.js';
import type { CapitalMove, PartnerDraw } from './partners.js';
import type { Purchase } from './purchasing.js';

const cashCountFields = z.object({
  date: isoDateSchema,
  /** The shop's money according to the records when it was counted (cashBalanceCents). */
  expectedCents: z.int(),
  /** What was counted: the till, plus the shop's bank account if it has one (I5). */
  countedCents: amountCentsSchema,
  /** counted − expected: over (positive) or short (negative), cash over/short of its period (I2). */
  diffCents: z.int(),
  /** Why the count differs; required when it does. */
  note: optionalTextSchema(500),
});

/**
 * SPEC §9, §13 `cash_adjustment`: a physical count of the shop's money (BUILD_PROMPTS 4.4).
 * Created, or voided with a reason; never edited (a wrong count is voided or counted again).
 */
export const cashAdjustmentSchema = recordBaseSchema.extend(cashCountFields.shape);
export type CashAdjustment = z.output<typeof cashAdjustmentSchema>;
export const storedCashAdjustmentSchema = cashAdjustmentSchema.extend({
  serverSeq: z.int().positive(),
});

/** What the owner enters: the money counted, on a date, and why it differs. */
export const newCashCountSchema = z.object({
  date: isoDateSchema,
  countedCents: amountCentsSchema,
  note: optionalTextSchema(500).default(null),
});
export type NewCashCount = z.output<typeof newCashCountSchema>;
export type NewCashCountInput = z.input<typeof newCashCountSchema>;

export const CASH_COUNT_ISSUES = {
  reasonRequired: 'cash_count_reason_required',
  mismatch: 'cash_count_difference_mismatch',
  fixed: 'cash_count_is_fixed',
} as const;

/** The fields a count records against what the records say the shop has (`expectedCents`). */
export function cashCountFieldsOf(
  input: NewCashCount,
  expectedCents: number,
): Omit<CashAdjustment, keyof z.infer<typeof recordBaseSchema>> {
  return {
    date: input.date,
    expectedCents,
    countedCents: input.countedCents,
    diffCents: input.countedCents - expectedCents,
    note: input.note,
  };
}

/** Re-checks a count: the difference adds up, and a difference says why. */
export function checkCashAdjustment(
  count: Pick<CashAdjustment, 'expectedCents' | 'countedCents' | 'diffCents' | 'note'>,
): ValidationIssue[] {
  if (count.diffCents !== count.countedCents - count.expectedCents) {
    return [{ path: ['diffCents'], message: CASH_COUNT_ISSUES.mismatch, code: 'custom' }];
  }
  if (count.diffCents !== 0 && count.note === null) {
    return [{ path: ['note'], message: CASH_COUNT_ISSUES.reasonRequired, code: 'custom' }];
  }
  return [];
}

/**
 * Every amount in and out of the shop's money, from the records (@fabric/core CashFlows,
 * SPEC §9). Voided records are left out; cash counts move it to what was counted (I2).
 */
export function cashFlowsOf(records: {
  payments: readonly Payment[];
  purchases: readonly Purchase[];
  expenses: readonly Expense[];
  capitalMoves: readonly CapitalMove[];
  draws: readonly PartnerDraw[];
  cashAdjustments?: readonly CashAdjustment[];
}): CashFlows {
  const live = <T extends { voidedAt: string | null }>(list: readonly T[]) =>
    list.filter((record) => record.voidedAt === null);
  const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);
  const payments = live(records.payments);
  const moves = live(records.capitalMoves);
  return {
    customerPaymentsCents: sum(
      payments.filter((p) => p.kind === 'payment').map((p) => p.amountCents),
    ),
    customerRefundsCents: sum(
      payments.filter((p) => p.kind === 'refund').map((p) => p.amountCents),
    ),
    contributionsCents: sum(
      moves.filter((m) => m.type === 'contribution').map((m) => m.amountCents),
    ),
    capitalWithdrawalsCents: -sum(
      moves.filter((m) => m.type === 'withdrawal').map((m) => m.amountCents),
    ),
    purchasesPaidCents: sum(live(records.purchases).map((purchase) => purchase.paidCents)),
    expensesPaidCents: sum(
      live(records.expenses)
        .filter((expense) => expense.paidDate !== null)
        .map((expense) => expense.amountCents),
    ),
    drawsCents: sum(live(records.draws).map((draw) => draw.amountCents)),
    cashAdjustmentsCents: sum(live(records.cashAdjustments ?? []).map((count) => count.diffCents)),
  };
}
