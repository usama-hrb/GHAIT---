import { assertInteger } from '../numeric/index.js';
import type { SaleAmounts } from './split.js';

interface Voidable {
  /** Voided records (voided_at set) no longer count (SPEC §11). */
  voided?: boolean;
}

/**
 * What a customer owes: Σ invoice totals − Σ payments, ignoring voided records (SPEC §4.1, §13).
 * Positive = the customer owes the shop; negative = the shop holds a credit for the customer.
 */
export function customerBalance(
  sales: readonly ({ totalCents: number } & Voidable)[],
  payments: readonly ({ amountCents: number } & Voidable)[],
): number {
  let balance = 0;
  for (const sale of sales) {
    assertInteger(sale.totalCents, 'totalCents', 0);
    if (!sale.voided) balance += sale.totalCents;
  }
  for (const payment of payments) {
    assertInteger(payment.amountCents, 'amountCents', 1);
    if (!payment.voided) balance -= payment.amountCents;
  }
  return balance;
}

/** Still due on one invoice (negative if it was overpaid). */
export function amountDueCents(totalCents: number, paymentsCents: readonly number[]): number {
  assertInteger(totalCents, 'totalCents', 0);
  let due = totalCents;
  for (const amount of paymentsCents) {
    assertInteger(amount, 'payment', 1);
    due -= amount;
  }
  return due;
}

/**
 * Capital still to recover on one invoice: min(capital, total) − what its payments recovered,
 * capital first (SPEC §8.2). It sits in the integrity check while the invoice is open (§9), and
 * it is the loss when the invoice is written off as a bad debt: its profit part was never
 * recognised, so writing it off loses nothing more (docs/accounting-assumptions.md S5).
 */
export function unrecoveredCapitalCents(
  sale: SaleAmounts,
  paymentsCents: readonly number[],
): number {
  assertInteger(sale.capitalCents, 'capitalCents', 0);
  const paid = sale.totalCents - amountDueCents(sale.totalCents, paymentsCents);
  const collectible = Math.min(sale.capitalCents, sale.totalCents);
  return collectible - Math.min(paid, collectible);
}
