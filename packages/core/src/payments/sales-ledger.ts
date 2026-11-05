import { assertInteger } from '../numeric/index.js';

/** Where an invoice stands on its payments, by amounts only. */
export type PaymentState = 'paid' | 'partial' | 'unpaid';

/**
 * Nothing left to pay is `paid` (an invoice worth nothing after returns too); something paid and
 * something left is `partial`; nothing paid and something left is `unpaid`. `paidCents` and
 * `dueCents` are the invoice's own figures (what is applied to it, and its worth now less that).
 */
export function paymentState(input: { paidCents: number; dueCents: number }): PaymentState {
  assertInteger(input.paidCents, 'paidCents', 0);
  assertInteger(input.dueCents, 'dueCents', 0);
  if (input.dueCents === 0) return 'paid';
  return input.paidCents > 0 ? 'partial' : 'unpaid';
}

/** One invoice as the sales history adds it up: figures the account already derived. */
export interface LedgerSale {
  /** The invoice's worth now: its total less what returns took off (RT1–RT3). */
  netTotalCents: number;
  /** What is applied to it: at most its worth now (RT3). */
  paidCents: number;
  /** Its worth now less what is applied to it; never negative. */
  dueCents: number;
  voided: boolean;
  /** Written off as a bad debt: still owed on paper, no longer expected (S5). */
  writtenOff: boolean;
}

export interface SalesLedger {
  /** Invoices counted: voided ones are not. */
  count: number;
  voidedCount: number;
  /** Σ what the counted invoices are worth now. */
  totalCents: number;
  /** Σ applied to the counted invoices (payments made later on them included). */
  paidCents: number;
  /** Σ still to collect: what is due on invoices not written off. */
  outstandingCents: number;
  /** Σ due on written-off invoices. */
  writtenOffCents: number;
}

/**
 * The sales of a period, added up from each invoice's own figures, so a payment is counted once,
 * on the one invoice it was applied to. A voided invoice is out of every sum. For the counted
 * invoices `totalCents = paidCents + outstandingCents + writtenOffCents`, and `outstandingCents`
 * is what `customerAccount` calls collectible, restricted to these invoices.
 */
export function salesLedger(sales: readonly LedgerSale[]): SalesLedger {
  const ledger: SalesLedger = {
    count: 0,
    voidedCount: 0,
    totalCents: 0,
    paidCents: 0,
    outstandingCents: 0,
    writtenOffCents: 0,
  };
  for (const sale of sales) {
    if (sale.voided) {
      ledger.voidedCount += 1;
      continue;
    }
    assertInteger(sale.netTotalCents, 'netTotalCents', 0);
    assertInteger(sale.paidCents, 'paidCents', 0);
    assertInteger(sale.dueCents, 'dueCents', 0);
    if (sale.paidCents + sale.dueCents !== sale.netTotalCents) {
      throw new RangeError('an invoice is worth what is paid on it plus what is still due');
    }
    ledger.count += 1;
    ledger.totalCents += sale.netTotalCents;
    ledger.paidCents += sale.paidCents;
    if (sale.writtenOff) ledger.writtenOffCents += sale.dueCents;
    else ledger.outstandingCents += sale.dueCents;
  }
  return ledger;
}
