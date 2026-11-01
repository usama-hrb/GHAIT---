import { assertInteger } from '../numeric/index.js';

export interface AccountSale {
  saleId: string;
  /** YYYY-MM-DD. */
  date: string;
  dueDate: string | null;
  totalCents: number;
  /** What the invoice was lowered by since: the credits of its returns (RT1–RT3). */
  returnedCents?: number;
  voided: boolean;
  /** Written off as a bad debt (SPEC §4.1, S5): still owed, no longer expected. */
  writtenOff: boolean;
}

export interface AccountPayment {
  paymentId: string;
  /** A refund gives money back to the customer. */
  kind: 'payment' | 'refund';
  amountCents: number;
}

export interface AccountAllocation {
  paymentId: string;
  saleId: string;
  amountCents: number;
}

export interface AccountInvoice {
  saleId: string;
  date: string;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
  /** total − paid, the total being the invoice's worth after returns; never negative (RT3). */
  dueCents: number;
  writtenOff: boolean;
  /** Its due date has passed and something is still due. */
  overdue: boolean;
}

/**
 * Allocations once returns are taken off (RT3): an invoice never holds more than it is worth now
 * (`worthBySale`: its total less its returns' credits), so what a return leaves paid beyond that
 * goes back to being the customer's money, and can be refunded or applied elsewhere. The latest
 * allocations give way first. Allocations to a sale not in the map are left as they are. `allocations`
 * must be in the order they were applied.
 */
export function effectiveAllocations<A extends { saleId: string; amountCents: number }>(
  allocations: readonly A[],
  worthBySale: ReadonlyMap<string, number>,
): A[] {
  const used = new Map<string, number>();
  return allocations.map((allocation) => {
    const worth = worthBySale.get(allocation.saleId);
    if (worth === undefined) return allocation;
    const before = used.get(allocation.saleId) ?? 0;
    const kept = Math.max(0, Math.min(allocation.amountCents, worth - before));
    used.set(allocation.saleId, before + kept);
    return kept === allocation.amountCents ? allocation : { ...allocation, amountCents: kept };
  });
}

export interface CustomerAccount {
  /**
   * Σ sales (after returns) − Σ payments + Σ refunds, voided sales left out (SPEC §13). Positive:
   * the customer owes the shop; negative: the shop holds money for them. Equals Σ due − credit.
   */
  balanceCents: number;
  /** What can still be collected: what is due on invoices not written off. */
  collectibleCents: number;
  /** What is due on written-off invoices. */
  writtenOffCents: number;
  /** Paid in but neither applied to a sale nor refunded: held for the customer (P6). */
  creditCents: number;
  /** Due on invoices not written off whose due date has passed. */
  overdueCents: number;
  /** Invoices with something due, oldest first (written-off ones included, flagged). */
  openInvoices: AccountInvoice[];
  /** Date of the oldest invoice still to collect: the age of the debt. */
  oldestOpenDate: string | null;
}

/**
 * A customer's account (SPEC §4.1, §13): every figure from their sales, payments and how the
 * payments were applied. Allocations to a voided sale no longer count: that money is credit
 * (refunded when the sale was voided, P13). `today` is the shop's date, for what is overdue.
 */
export function customerAccount(input: {
  sales: readonly AccountSale[];
  payments: readonly AccountPayment[];
  allocations: readonly AccountAllocation[];
  today: string;
}): CustomerAccount {
  const sales = new Map(input.sales.map((sale) => [sale.saleId, sale]));
  const payments = new Map(input.payments.map((payment) => [payment.paymentId, payment]));
  const appliedBySale = new Map<string, number>();
  const appliedByPayment = new Map<string, number>();
  const worth = new Map<string, number>();
  for (const sale of input.sales) {
    assertInteger(sale.totalCents, 'totalCents', 0);
    assertInteger(sale.returnedCents ?? 0, 'returnedCents', 0);
    worth.set(sale.saleId, sale.totalCents - (sale.returnedCents ?? 0));
  }
  for (const allocation of effectiveAllocations(input.allocations, worth)) {
    if (allocation.amountCents === 0) continue;
    assertInteger(allocation.amountCents, 'allocation amountCents', 1);
    const payment = payments.get(allocation.paymentId);
    if (payment?.kind !== 'payment') {
      throw new RangeError(`allocation of ${allocation.paymentId}: not a payment of this customer`);
    }
    const spent = (appliedByPayment.get(allocation.paymentId) ?? 0) + allocation.amountCents;
    if (spent > payment.amountCents) {
      throw new RangeError(`payment ${allocation.paymentId} is applied beyond its amount`);
    }
    appliedByPayment.set(allocation.paymentId, spent);
    const sale = sales.get(allocation.saleId);
    if (sale && !sale.voided) {
      appliedBySale.set(
        sale.saleId,
        (appliedBySale.get(sale.saleId) ?? 0) + allocation.amountCents,
      );
    }
  }

  let balanceCents = 0;
  let creditCents = 0;
  for (const payment of input.payments) {
    assertInteger(payment.amountCents, 'payment amountCents', 1);
    if (payment.kind === 'payment') {
      balanceCents -= payment.amountCents;
      creditCents += payment.amountCents;
    } else {
      balanceCents += payment.amountCents;
      creditCents -= payment.amountCents;
    }
  }

  const invoices: AccountInvoice[] = [];
  for (const sale of input.sales) {
    if (sale.voided) continue;
    const paidCents = appliedBySale.get(sale.saleId) ?? 0;
    const totalCents = sale.totalCents - (sale.returnedCents ?? 0);
    balanceCents += totalCents;
    creditCents -= paidCents;
    const dueCents = totalCents - paidCents;
    invoices.push({
      saleId: sale.saleId,
      date: sale.date,
      dueDate: sale.dueDate,
      totalCents,
      paidCents,
      dueCents,
      writtenOff: sale.writtenOff,
      overdue: dueCents > 0 && sale.dueDate !== null && sale.dueDate < input.today,
    });
  }

  const open = invoices
    .filter((invoice) => invoice.dueCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.saleId.localeCompare(b.saleId));
  const collectible = open.filter((invoice) => !invoice.writtenOff);
  const sum = (list: readonly AccountInvoice[]) =>
    list.reduce((total, invoice) => total + invoice.dueCents, 0);
  return {
    balanceCents,
    collectibleCents: sum(collectible),
    writtenOffCents: sum(open.filter((invoice) => invoice.writtenOff)),
    creditCents,
    overdueCents: sum(collectible.filter((invoice) => invoice.overdue)),
    openInvoices: open,
    oldestOpenDate: collectible[0]?.date ?? null,
  };
}
