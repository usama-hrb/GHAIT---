import { assertInteger } from '../numeric/index.js';
import { allocatePayment } from '../payments/index.js';
import type { PeriodResult } from './compute.js';
import { assertIsoDate } from './split-rule.js';

/** A live (not voided) sale as the settlement sees it (SPEC §8.1, §8.2). */
export interface PeriodSale {
  /** YYYY-MM-DD: a below-cost invoice loses its negative part in this date's period (P3). */
  date: string;
  totalCents: number;
  /** Σ its line costs (frozen once a settlement has counted it, P9). */
  capitalCents: number;
  /** What was applied to it, in the order its parts are derived (P10). */
  allocations: readonly { date: string; amountCents: number }[];
  /** The date it was written off as a bad debt (S5), or null. */
  writtenOffOn: string | null;
}

/** The records one settlement gathers its amounts from, live ones only. */
export interface PeriodRecords {
  sales: readonly PeriodSale[];
  /** Damage and waste (loss moves that were not reversed), at their cost (T12). */
  losses: readonly { date: string; costCents: number }[];
  /** Each counts in the period of its paid date; an unpaid one (null) in none (S6). */
  expenses: readonly { paidDate: string | null; amountCents: number }[];
  /** cash_adjustment differences, counted − expected (I2). */
  cashAdjustments: readonly { date: string; diffCents: number }[];
}

/**
 * A settlement period: from the day after `after` (the previous settlement's end; null for the
 * first, which takes everything before it) through `end`, inclusive.
 */
export interface PeriodBounds {
  after: string | null;
  end: string;
}

/** A YYYY-MM-DD date falls inside the period. */
export function inPeriod(date: string, bounds: PeriodBounds): boolean {
  return (bounds.after === null || date > bounds.after) && date <= bounds.end;
}

function assertBounds(bounds: PeriodBounds): void {
  assertIsoDate(bounds.end, 'end');
  if (bounds.after === null) return;
  assertIsoDate(bounds.after, 'after');
  if (bounds.after >= bounds.end) {
    throw new RangeError(`period ends (${bounds.end}) on or before ${bounds.after}`);
  }
}

/**
 * What the settlement of one period gathers (SPEC §8.1, BUILD_PROMPTS 4.3):
 * - recognised profit: the profit part of each payment applied in the period, the parts derived
 *   capital first in the order the payments were applied (§8.2, T8);
 * - a written-off invoice (S5) loses its unrecovered capital in the write-off's period: its
 *   collectible capital less what payments dated up to the write-off recovered. Capital that
 *   later payments recover is a gain of their period; their profit part is profit as usual;
 * - losses: damage at cost, and the negative part of below-cost invoices sold in it (P2, P3);
 * - expenses paid in it (S6), cash over and short of the counts in it (I2).
 * Splitting time into more periods moves amounts between them, never changes their total.
 */
export function periodResultOf(
  records: PeriodRecords,
  bounds: PeriodBounds,
  carriedDeficitInCents: number,
): PeriodResult {
  assertBounds(bounds);
  assertInteger(carriedDeficitInCents, 'carriedDeficitInCents', 0);
  let recognizedProfitCents = 0;
  let recoveredBadDebtCents = 0;
  let badDebtCents = 0;
  let belowCostCents = 0;
  for (const sale of records.sales) {
    assertIsoDate(sale.date, 'sale date');
    if (inPeriod(sale.date, bounds)) {
      belowCostCents += Math.max(0, sale.capitalCents - sale.totalCents);
    }
    const writtenOffOn = sale.writtenOffOn;
    let recoveredByWriteOff = 0;
    const paidBefore: number[] = [];
    for (const allocation of sale.allocations) {
      assertIsoDate(allocation.date, 'allocation date');
      const part = allocatePayment(sale, paidBefore, allocation.amountCents);
      paidBefore.push(allocation.amountCents);
      const afterWriteOff = writtenOffOn !== null && allocation.date > writtenOffOn;
      if (!afterWriteOff) recoveredByWriteOff += part.capitalRecoveredCents;
      if (!inPeriod(allocation.date, bounds)) continue;
      recognizedProfitCents += part.profitRecognizedCents;
      if (afterWriteOff) recoveredBadDebtCents += part.capitalRecoveredCents;
    }
    if (writtenOffOn !== null) {
      assertIsoDate(writtenOffOn, 'write-off date');
      if (inPeriod(writtenOffOn, bounds)) {
        badDebtCents += Math.min(sale.capitalCents, sale.totalCents) - recoveredByWriteOff;
      }
    }
  }

  let damageCents = 0;
  for (const loss of records.losses) {
    assertIsoDate(loss.date, 'loss date');
    assertInteger(loss.costCents, 'loss costCents', 0);
    if (inPeriod(loss.date, bounds)) damageCents += loss.costCents;
  }
  let expensesCents = 0;
  for (const expense of records.expenses) {
    assertInteger(expense.amountCents, 'expense amountCents', 0);
    if (expense.paidDate === null) continue;
    assertIsoDate(expense.paidDate, 'expense paidDate');
    if (inPeriod(expense.paidDate, bounds)) expensesCents += expense.amountCents;
  }
  let cashOverShortCents = 0;
  for (const count of records.cashAdjustments) {
    assertIsoDate(count.date, 'cash count date');
    assertInteger(count.diffCents, 'cash count diffCents');
    if (inPeriod(count.date, bounds)) cashOverShortCents += count.diffCents;
  }

  return {
    recognizedProfitCents,
    recoveredBadDebtCents,
    losses: { damageCents, badDebtCents, belowCostCents },
    expensesCents,
    cashOverShortCents,
    carriedDeficitInCents,
  };
}
