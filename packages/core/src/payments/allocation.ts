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

/**
 * A customer's payment (SPEC §4.1, P6): aimed at one invoice, it pays that invoice first and the
 * rest goes to the customer's other unpaid invoices, oldest first; without a target it goes to
 * them all, oldest first. What is left after every invoice is paid is the customer's credit.
 * `invoices` are the ones the payment may reach (a written-off invoice only as the target).
 */
export function allocateCustomerPayment(
  invoices: readonly OpenInvoice[],
  amountCents: number,
  targetSaleId: string | null = null,
): GeneralPaymentResult {
  assertInteger(amountCents, 'amountCents', 1);
  if (targetSaleId === null) return allocateGeneralPayment(invoices, amountCents);
  const target = invoices.find((invoice) => invoice.saleId === targetSaleId);
  if (!target) throw new RangeError(`no invoice ${targetSaleId} to pay`);
  const due = target.totalCents - sumPayments(target.paymentsCents);
  const part = Math.min(amountCents, Math.max(due, 0));
  const allocations: GeneralPaymentResult['allocations'] =
    part > 0
      ? [{ saleId: target.saleId, ...allocatePayment(target, target.paymentsCents, part) }]
      : [];
  const rest = amountCents - part;
  if (rest === 0) return { allocations, unappliedCents: 0 };
  const others = allocateGeneralPayment(
    invoices.filter((invoice) => invoice.saleId !== targetSaleId),
    rest,
  );
  return {
    allocations: [...allocations, ...others.allocations],
    unappliedCents: others.unappliedCents,
  };
}

export interface CreditSource {
  paymentId: string;
  /** The payment's date (ISO 8601): the oldest credit is used first. */
  date: string;
  /** What the payment has left once its allocations are taken off. */
  unappliedCents: number;
}

/**
 * Applies a customer's credit (paid in, not yet applied: P6) to their unpaid invoices: the oldest
 * credit first, each spread oldest invoice first (the general-payment rule). Returns what each
 * payment now pays on each invoice.
 */
export function applyCredit(
  credits: readonly CreditSource[],
  invoices: readonly OpenInvoice[],
): { paymentId: string; saleId: string; amountCents: number }[] {
  let current = invoices.map((invoice) => ({
    ...invoice,
    paymentsCents: [...invoice.paymentsCents],
  }));
  const applied: { paymentId: string; saleId: string; amountCents: number }[] = [];
  const oldestFirst = [...credits].sort(
    (a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId),
  );
  for (const credit of oldestFirst) {
    assertInteger(credit.unappliedCents, `credit of ${credit.paymentId}`, 0);
    if (credit.unappliedCents === 0) continue;
    const { allocations } = allocateGeneralPayment(current, credit.unappliedCents);
    for (const allocation of allocations) {
      applied.push({
        paymentId: credit.paymentId,
        saleId: allocation.saleId,
        amountCents: allocation.appliedCents,
      });
    }
    current = current.map((invoice) => {
      const added = allocations.find((allocation) => allocation.saleId === invoice.saleId);
      return added
        ? { ...invoice, paymentsCents: [...invoice.paymentsCents, added.appliedCents] }
        : invoice;
    });
  }
  return applied;
}

/**
 * What each of an invoice's payments recovered and recognised, in the order they were applied
 * (SPEC §8.2, T8): the parts are derived from the invoice's current capital (P10).
 */
export function paymentParts(
  sale: SaleAmounts,
  amountsCents: readonly number[],
): PaymentAllocation[] {
  return amountsCents.map((amount, index) =>
    allocatePayment(sale, amountsCents.slice(0, index), amount),
  );
}
