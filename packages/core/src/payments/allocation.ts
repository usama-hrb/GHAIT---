import { assertInteger } from '../numeric/index.js';
import type { SaleAmounts } from './split.js';

export interface PaymentAllocation {
  /** Part of the payment that pays this invoice (≤ what was still due). */
  appliedCents: number;
  /** Capital recovered by this payment. */
  capitalRecoveredCents: number;
  /** Profit this payment makes recognisable: it counts in the period of the payment (§8.2). */
  profitRecognizedCents: number;
  /** Beyond what the invoice still owed: a customer credit, not revenue. */
  overpaymentCents: number;
}

function sumPayments(payments: readonly number[]): number {
  let total = 0;
  for (const amount of payments) {
    assertInteger(amount, 'payment', 1);
    total += amount;
  }
  return total;
}

/**
 * Allocates one payment of an invoice, capital first and then profit (SPEC §8.2, T8):
 * recognised profit = max(0, paid − capital) capped at the profit part, and what earlier
 * payments already recognised is never counted again.
 * For a below-cost invoice there is no profit to recognise and payments recover at most the
 * total (the rest of the capital is the sale's loss, see splitSaleCapitalProfit).
 * `paymentsSoFarCents` are this invoice's earlier payments, oldest first.
 */
export function allocatePayment(
  sale: SaleAmounts,
  paymentsSoFarCents: readonly number[],
  newPaymentCents: number,
): PaymentAllocation {
  assertInteger(sale.totalCents, 'totalCents', 0);
  assertInteger(sale.capitalCents, 'capitalCents', 0);
  assertInteger(newPaymentCents, 'newPaymentCents', 1);

  const collectibleCapital = Math.min(sale.capitalCents, sale.totalCents);
  const before = sumPayments(paymentsSoFarCents);
  const after = before + newPaymentCents;

  const appliedCents = Math.min(after, sale.totalCents) - Math.min(before, sale.totalCents);
  const capitalRecoveredCents =
    Math.min(after, collectibleCapital) - Math.min(before, collectibleCapital);
  return {
    appliedCents,
    capitalRecoveredCents,
    profitRecognizedCents: appliedCents - capitalRecoveredCents,
    overpaymentCents: newPaymentCents - appliedCents,
  };
}

export interface OpenInvoice extends SaleAmounts {
  saleId: string;
  /** Sale date as ISO 8601 (same format for every invoice): oldest is paid first. */
  date: string;
  /** This invoice's payments so far, oldest first. */
  paymentsCents: readonly number[];
}

export interface GeneralPaymentResult {
  /** One entry per invoice the payment reaches, oldest first. */
  allocations: (PaymentAllocation & { saleId: string })[];
  /** Left after every invoice is paid: a customer credit. */
  unappliedCents: number;
}

/**
 * A payment not tied to one invoice is spread over the customer's unpaid invoices, oldest
 * first (SPEC §4.1); each part is then allocated capital-first on its invoice.
 * Ties on the date are broken by saleId so every device gets the same result.
 */
export function allocateGeneralPayment(
  invoices: readonly OpenInvoice[],
  amountCents: number,
): GeneralPaymentResult {
  assertInteger(amountCents, 'amountCents', 1);
  const oldestFirst = [...invoices].sort(
    (a, b) => a.date.localeCompare(b.date) || a.saleId.localeCompare(b.saleId),
  );

  let left = amountCents;
  const allocations: GeneralPaymentResult['allocations'] = [];
  for (const invoice of oldestFirst) {
    if (left === 0) break;
    const due = invoice.totalCents - sumPayments(invoice.paymentsCents);
    if (due <= 0) continue;
    const part = Math.min(left, due);
    allocations.push({
      saleId: invoice.saleId,
      ...allocatePayment(invoice, invoice.paymentsCents, part),
    });
    left -= part;
  }
  return { allocations, unappliedCents: left };
}
