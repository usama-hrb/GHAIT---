import { shopDate } from '@fabric/contracts';
import type { AccountInvoice, CustomerAccount } from '@fabric/core';
import type { CustomerAccountView, CustomerSummary, Local } from '@/local-db';

/**
 * What the customer screens show, made from the figures `@fabric/core` already derived
 * (`customerAccount`): names for those figures, and the records joined and ordered for display.
 * Nothing here adds up money that the account does not already carry.
 */

// ---------------------------------------------------------------------------------------------
// The account as a whole

export type AccountStatus = 'owing' | 'credit' | 'settled';

/**
 * What the shop expects from the customer: they owe (something can still be collected), the shop
 * holds money for them, or the account is settled. A written-off debt is no longer expected, so it
 * does not make an account "owing" (the "who owes" list always read it that way, S5).
 */
export function accountStatusOf(account: CustomerAccount): AccountStatus {
  if (account.collectibleCents > 0) return 'owing';
  if (account.creditCents > 0) return 'credit';
  return 'settled';
}

// ---------------------------------------------------------------------------------------------
// The directory

export type DirectoryFilter = 'all' | 'owing' | 'settled';
export type DirectorySort = 'name' | 'largest' | 'oldest';

const isOwing = (summary: CustomerSummary) => summary.account.collectibleCents > 0;

export function filterCustomers(
  customers: readonly CustomerSummary[],
  filter: DirectoryFilter,
): CustomerSummary[] {
  if (filter === 'all') return [...customers];
  return customers.filter((summary) => isOwing(summary) === (filter === 'owing'));
}

/** How many customers each filter would show (the numbers on its tabs). */
export function filterCounts(
  customers: readonly CustomerSummary[],
): Record<DirectoryFilter, number> {
  const owing = customers.filter(isOwing).length;
  return { all: customers.length, owing, settled: customers.length - owing };
}

/** The headline of the directory: how many customers, how many owe, and what they owe in all. */
export function directoryStats(customers: readonly CustomerSummary[]): {
  customers: number;
  owing: number;
  owedCents: number;
} {
  let owedCents = 0;
  let owing = 0;
  for (const summary of customers) {
    if (!isOwing(summary)) continue;
    owing += 1;
    owedCents += summary.account.collectibleCents;
  }
  return { customers: customers.length, owing, owedCents };
}

/**
 * By name (the order the repository gives), by what is owed, or by the age of the debt. Whoever
 * owes nothing comes after those who do, in name order, in the two debt orders.
 */
export function sortCustomers(
  customers: readonly CustomerSummary[],
  sort: DirectorySort,
): CustomerSummary[] {
  if (sort === 'name') return [...customers];
  const rank = new Map(customers.map((summary, index) => [summary.customer.id, index]));
  const position = (summary: CustomerSummary) => rank.get(summary.customer.id) ?? 0;
  return [...customers].sort((a, b) => {
    const owes = Number(isOwing(b)) - Number(isOwing(a));
    if (owes !== 0) return owes;
    if (!isOwing(a)) return position(a) - position(b);
    const byAmount = b.account.collectibleCents - a.account.collectibleCents;
    const byAge = (a.account.oldestOpenDate ?? '').localeCompare(b.account.oldestOpenDate ?? '');
    return (
      (sort === 'largest' ? byAmount || byAge : byAge || byAmount) || position(a) - position(b)
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Invoices

export type InvoiceStatus = 'paid' | 'unpaid' | 'partlyPaid' | 'overdue' | 'writtenOff' | 'voided';

/**
 * Where an invoice stands: nothing left to pay is paid (even a written-off one that was paid
 * later); else a bad debt, overdue, partly paid or not paid at all. A voided invoice is out of the
 * account.
 */
export function invoiceStatusOf(
  invoice: AccountInvoice | undefined,
  voided: boolean,
): InvoiceStatus {
  if (voided) return 'voided';
  if (!invoice || invoice.dueCents <= 0) return 'paid';
  if (invoice.writtenOff) return 'writtenOff';
  if (invoice.overdue) return 'overdue';
  return invoice.paidCents > 0 ? 'partlyPaid' : 'unpaid';
}

export interface InvoiceRow {
  sale: Local<CustomerAccountView['sales'][number]>;
  /** The account's figures for it; none for a voided invoice. */
  invoice: AccountInvoice | undefined;
  status: InvoiceStatus;
}

/** Every invoice of the customer, newest first (voided ones included, as such). */
export function invoiceRowsOf(view: CustomerAccountView): InvoiceRow[] {
  const invoices = new Map(view.account.invoices.map((invoice) => [invoice.saleId, invoice]));
  return view.sales.map((sale) => {
    const invoice = invoices.get(sale.id);
    return { sale, invoice, status: invoiceStatusOf(invoice, sale.voidedAt !== null) };
  });
}

/** Whether a row belongs to the "unpaid" view of the invoices: something is still to collect. */
export const isUnpaid = (row: InvoiceRow): boolean =>
  row.status === 'unpaid' || row.status === 'partlyPaid' || row.status === 'overdue';

// ---------------------------------------------------------------------------------------------
// Payments

export interface PaymentRow {
  payment: CustomerAccountView['payments'][number];
  /** The invoices a payment was applied to, with the part of it each took (refunds: none). */
  applied: { saleId: string; date: string; amountCents: number }[];
}

export function paymentRowsOf(view: CustomerAccountView): PaymentRow[] {
  const dateOf = new Map(view.sales.map((sale) => [sale.id, sale.date]));
  return view.payments.map((payment) => ({
    payment,
    applied: view.allocations
      .filter((allocation) => allocation.paymentId === payment.id)
      .map((allocation) => ({
        saleId: allocation.saleId,
        date: dateOf.get(allocation.saleId) ?? allocation.date,
        amountCents: allocation.amountCents,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

// ---------------------------------------------------------------------------------------------
// Activity

export type ActivityEvent =
  | { kind: 'purchase'; id: string; date: string; at: string; saleId: string; amountCents: number }
  | {
      kind: 'payment' | 'refund';
      id: string;
      date: string;
      at: string;
      amountCents: number;
      method: 'cash' | 'bank' | 'other';
      note: string | null;
    }
  | { kind: 'return'; id: string; date: string; at: string; saleId: string; amountCents: number }
  | { kind: 'voided'; id: string; date: string; at: string; saleId: string }
  | { kind: 'writeOff'; id: string; date: string; at: string; saleId: string; reason: string };

const dayOf = (timestamp: string): string => {
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? timestamp.slice(0, 10) : shopDate(at);
};

/**
 * What happened on the account, newest first: the sales, the payments and refunds, the goods given
 * back, the sales voided and the debts written off. Ordered by the day each is dated, then by when
 * it was recorded.
 */
export function activityOf(view: CustomerAccountView): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const sale of view.sales) {
    if (sale.voidedAt === null) {
      events.push({
        kind: 'purchase',
        id: `sale-${sale.id}`,
        date: sale.date,
        at: sale.createdAt,
        saleId: sale.id,
        amountCents: sale.totalCents,
      });
    } else {
      // A voided sale was a purchase until the day it was voided; both stay in the history.
      events.push(
        {
          kind: 'purchase',
          id: `sale-${sale.id}`,
          date: sale.date,
          at: sale.createdAt,
          saleId: sale.id,
          amountCents: sale.totalCents,
        },
        {
          kind: 'voided',
          id: `void-${sale.id}`,
          date: dayOf(sale.voidedAt),
          at: sale.voidedAt,
          saleId: sale.id,
        },
      );
    }
  }
  for (const payment of view.payments) {
    events.push({
      kind: payment.kind,
      id: `payment-${payment.id}`,
      date: payment.date,
      at: payment.createdAt,
      amountCents: payment.amountCents,
      method: payment.method,
      note: payment.note,
    });
  }
  for (const given of view.returns) {
    if (given.voidedAt !== null) continue;
    events.push({
      kind: 'return',
      id: `return-${given.id}`,
      date: given.date,
      at: given.createdAt,
      saleId: given.saleId,
      amountCents: given.creditCents,
    });
  }
  for (const writeOff of view.writeOffs) {
    events.push({
      kind: 'writeOff',
      id: `writeoff-${writeOff.id}`,
      date: writeOff.date,
      at: writeOff.createdAt,
      saleId: writeOff.saleId,
      reason: writeOff.reason,
    });
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
}
