import { assertInteger } from '../numeric/index.js';
import { allocatePayment, type SaleAmounts } from '../payments/index.js';
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
  /**
   * Goods customers gave back (RT1–RT4), in the order they were recorded among the payments:
   * `after` payments of `allocations` came first. `creditCents` lowers the invoice, `costCents` is
   * the cost that went back on the roll.
   */
  returns?: readonly PeriodReturn[];
}

export interface PeriodReturn {
  date: string;
  creditCents: number;
  costCents: number;
  /** How many of the sale's allocations were recorded before this return. */
  after: number;
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

/** The capital payments can recover: min(capital, total) (SPEC §8.2). */
const collectibleCapital = (sale: SaleAmounts) => Math.min(sale.capitalCents, sale.totalCents);

/** The profit `paidCents` recognises on an invoice, capital first (allocatePayment, summed). */
const recognizedProfit = (sale: SaleAmounts, paidCents: number) =>
  Math.min(paidCents, sale.totalCents) - Math.min(paidCents, collectibleCapital(sale));

/** The loss of a below-cost invoice (P3). */
const belowCostOf = (sale: SaleAmounts) => Math.max(0, sale.capitalCents - sale.totalCents);

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
 * - returns (RT4): a return changes the invoice's total and capital, so what its payments
 *   recognise and its below-cost loss change; the difference is booked on the day of the return;
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
  let returnsEffectCents = 0;
  let recoveredBadDebtCents = 0;
  let badDebtCents = 0;
  let belowCostCents = 0;
  for (const sale of records.sales) {
    assertIsoDate(sale.date, 'sale date');
    if (inPeriod(sale.date, bounds)) {
      belowCostCents += Math.max(0, sale.capitalCents - sale.totalCents);
    }
    const writtenOffOn = sale.writtenOffOn;
    const returns = sale.returns ?? [];
    // The invoice as it stands at each step: returns lower its total and its capital (RT4).
    let current: SaleAmounts = { totalCents: sale.totalCents, capitalCents: sale.capitalCents };
    let paidCents = 0;
    let paidByWriteOffCents = 0;
    let recoveredByWriteOff = 0;
    const paidBefore: number[] = [];
    let nextReturn = 0;
    const applyReturns = (applied: number) => {
      for (; nextReturn < returns.length; nextReturn++) {
        const given = returns[nextReturn];
        if (!given || given.after > applied) break;
        assertIsoDate(given.date, 'return date');
        assertInteger(given.creditCents, 'return creditCents', 0);
        assertInteger(given.costCents, 'return costCents', 0);
        const before = current;
        current = {
          totalCents: before.totalCents - given.creditCents,
          capitalCents: before.capitalCents - given.costCents,
        };
        assertInteger(current.totalCents, 'total after a return', 0);
        assertInteger(current.capitalCents, 'capital after a return', 0);
        // What the payments made so far recognise changes with the invoice, and the below-cost
        // loss with it: the difference belongs to the day of the return, never to a settled day.
        if (inPeriod(given.date, bounds)) {
          returnsEffectCents +=
            recognizedProfit(current, paidCents) -
            recognizedProfit(before, paidCents) -
            (belowCostOf(current) - belowCostOf(before));
        }
      }
    };
    applyReturns(0);
    sale.allocations.forEach((allocation, index) => {
      assertIsoDate(allocation.date, 'allocation date');
      const part = allocatePayment(current, paidBefore, allocation.amountCents);
      paidBefore.push(allocation.amountCents);
      paidCents += allocation.amountCents;
      const afterWriteOff = writtenOffOn !== null && allocation.date > writtenOffOn;
      if (!afterWriteOff) {
        recoveredByWriteOff += part.capitalRecoveredCents;
        paidByWriteOffCents += allocation.amountCents;
      }
      if (inPeriod(allocation.date, bounds)) {
        recognizedProfitCents += part.profitRecognizedCents;
        if (afterWriteOff) recoveredBadDebtCents += part.capitalRecoveredCents;
      }
      applyReturns(index + 1);
    });
    applyReturns(Number.POSITIVE_INFINITY);
    if (writtenOffOn !== null) {
      assertIsoDate(writtenOffOn, 'write-off date');
      if (inPeriod(writtenOffOn, bounds)) {
        // A return before the write-off changed what the earlier payments recovered.
        const recovered =
          returns.length > 0
            ? Math.min(paidByWriteOffCents, collectibleCapital(current))
            : recoveredByWriteOff;
        badDebtCents += collectibleCapital(current) - recovered;
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
    returnsEffectCents,
    recoveredBadDebtCents,
    losses: { damageCents, badDebtCents, belowCostCents },
    expensesCents,
    cashOverShortCents,
    carriedDeficitInCents,
  };
}
