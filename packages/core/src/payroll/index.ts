import { monthBounds, monthOf, nextMonth } from '../expenses/index.js';
import { assertInteger } from '../numeric/index.js';

/**
 * The expense category a salary payment is booked under (the "أجرة عامل" category of SPEC §5).
 * A salary is an ordinary expense counted in the period of its paid date (S6): payroll has no
 * second cost, cash or settlement calculation (docs/accounting-assumptions.md PY1).
 */
export const SALARY_EXPENSE_CATEGORY = 'wages';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Throws unless `value` is a YYYY-MM month. */
export function assertMonth(value: string, name: string): void {
  if (!MONTH.test(value)) throw new RangeError(`${name} must be a YYYY-MM month, got "${value}"`);
}

/**
 * What an employee earns a month, from the first day of a month on. A rate stays until a later
 * one replaces it; there is no proration (PY2), and an amount of 0 stops the salary (leave, pause).
 */
export interface SalaryRate {
  /** YYYY-MM-01: a rate always starts with a month. */
  effectiveFrom: string;
  amountCents: number;
}

/** A salary payment: an expense booked for the month the salary is for (not the day it was paid). */
export interface SalaryPayment {
  /** YYYY-MM: the month it pays. */
  month: string;
  amountCents: number;
}

export type SalaryStatus =
  /** Nothing is due and nothing was paid. */
  | 'none'
  | 'unpaid'
  | 'partial'
  /** Paid in full, or more than was due. */
  | 'paid';

export interface SalaryMonth {
  month: string;
  dueCents: number;
  paidCents: number;
  /** Still to pay, never negative. */
  remainingCents: number;
  /** Paid beyond what was due, never negative. */
  overpaidCents: number;
  status: SalaryStatus;
}

function assertRates(rates: readonly SalaryRate[]): void {
  const seen = new Set<string>();
  for (const { effectiveFrom, amountCents } of rates) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(effectiveFrom)) {
      throw new RangeError(`a salary rate starts on the first of a month, got "${effectiveFrom}"`);
    }
    assertInteger(amountCents, 'salary amountCents', 0);
    if (seen.has(effectiveFrom)) {
      throw new RangeError(`two salary rates start on ${effectiveFrom}`);
    }
    seen.add(effectiveFrom);
  }
}

/** The rate in force for a month: the latest one that starts on or before its first day. */
export function salaryRateFor(rates: readonly SalaryRate[], month: string): SalaryRate | undefined {
  assertMonth(month, 'month');
  assertRates(rates);
  const { start } = monthBounds(month);
  let found: SalaryRate | undefined;
  for (const rate of rates) {
    if (rate.effectiveFrom <= start && (!found || rate.effectiveFrom > found.effectiveFrom)) {
      found = rate;
    }
  }
  return found;
}

/**
 * What is due for a month (PY2): the rate in force on its first day, in full, and nothing after
 * the month the employment ended in (`endDate`, YYYY-MM-DD).
 */
export function salaryDue(
  rates: readonly SalaryRate[],
  month: string,
  endDate: string | null = null,
): number {
  if (endDate !== null && month > monthOf(endDate)) return 0;
  return salaryRateFor(rates, month)?.amountCents ?? 0;
}

/** What was paid for a month, whenever it was paid. */
export function salaryPaid(payments: readonly SalaryPayment[], month: string): number {
  assertMonth(month, 'month');
  let total = 0;
  for (const payment of payments) {
    assertMonth(payment.month, 'payment month');
    assertInteger(payment.amountCents, 'payment amountCents', 1);
    if (payment.month === month) total += payment.amountCents;
  }
  return total;
}

/** A month's salary: due, paid, what remains, and where it stands. */
export function salaryMonthOf(
  rates: readonly SalaryRate[],
  payments: readonly SalaryPayment[],
  month: string,
  endDate: string | null = null,
): SalaryMonth {
  const dueCents = salaryDue(rates, month, endDate);
  const paidCents = salaryPaid(payments, month);
  const remainingCents = Math.max(0, dueCents - paidCents);
  const overpaidCents = Math.max(0, paidCents - dueCents);
  const status: SalaryStatus =
    paidCents === 0
      ? dueCents === 0
        ? 'none'
        : 'unpaid'
      : remainingCents > 0
        ? 'partial'
        : 'paid';
  return { month, dueCents, paidCents, remainingCents, overpaidCents, status };
}

/**
 * Every month from the first one with a rate or a payment through `throughMonth` (and any later
 * month that was paid), oldest first: the salary history and what is still owed. A raise that
 * starts after `throughMonth` adds no month of its own: nothing is owed for a month that has not
 * begun, so it shows as a row only once it is the month asked for or has been paid.
 */
export function salaryLedgerOf(
  rates: readonly SalaryRate[],
  payments: readonly SalaryPayment[],
  throughMonth: string,
  endDate: string | null = null,
): SalaryMonth[] {
  assertMonth(throughMonth, 'throughMonth');
  assertRates(rates);
  const months = [
    ...rates.map((rate) => monthOf(rate.effectiveFrom)),
    ...payments.map((p) => p.month),
  ];
  const first = months.reduce<string | undefined>(
    (min, month) => (min === undefined || month < min ? month : min),
    undefined,
  );
  if (first === undefined) return [];
  const last = payments.reduce((max, { month }) => (month > max ? month : max), throughMonth);
  const ledger: SalaryMonth[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) {
    ledger.push(salaryMonthOf(rates, payments, month, endDate));
  }
  return ledger;
}

/** What is still owed for the months through `throughMonth`: the unpaid part of each. */
export function salaryOutstanding(ledger: readonly SalaryMonth[], throughMonth: string): number {
  return ledger
    .filter(({ month }) => month <= throughMonth)
    .reduce((sum, { remainingCents }) => sum + remainingCents, 0);
}
