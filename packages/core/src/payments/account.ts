import { assertInteger } from '../numeric/index.js';

export interface AccountSale {
  saleId: string;
  /** YYYY-MM-DD. */
  date: string;
  dueDate: string | null;
  totalCents: number;
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
  /** total − paid; negative when more was applied than the total. */
  dueCents: number;
  writtenOff: boolean;
  /** Its due date has passed and something is still due. */
  overdue: boolean;
}

export interface CustomerAccount {
  /**
   * Σ sales − Σ payments + Σ refunds, voided sales left out (SPEC §13). Positive: the customer
   * owes the shop; negative: the shop holds money for them. Equals Σ due − credit.
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
  for (const allocation of input.allocations) {
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
    assertInteger(sale.totalCents, 'totalCents', 0);
    if (sale.voided) continue;
    const paidCents = appliedBySale.get(sale.saleId) ?? 0;
    balanceCents += sale.totalCents;
    creditCents -= paidCents;
    const dueCents = sale.totalCents - paidCents;
    invoices.push({
      saleId: sale.saleId,
      date: sale.date,
      dueDate: sale.dueDate,
      totalCents: sale.totalCents,
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
