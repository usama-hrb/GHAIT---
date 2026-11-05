import { shopDate } from '@fabric/contracts';
import type { SupplierAccount, SupplierPurchaseDue, SupplierStatementLine } from '@fabric/core';
import type { SupplierAccountView, SupplierSummary } from '@/local-db';

/**
 * What the supplier screens show, made from the figures `@fabric/core` already derived
 * (`supplierAccount`, `supplierStatement`): names for those figures, and the records joined and
 * ordered for display. Nothing here adds up money that the account does not already carry.
 */

// ---------------------------------------------------------------------------------------------
// The account as a whole

export type SupplierStatus = 'owing' | 'advance' | 'settled';

/** What the shop owes the supplier now, whether it paid beyond that (an advance), or neither. */
export function supplierStatusOf(
  account: Pick<SupplierAccount, 'owedCents' | 'advanceCents'>,
): SupplierStatus {
  if (account.owedCents > 0) return 'owing';
  if (account.advanceCents > 0) return 'advance';
  return 'settled';
}

// ---------------------------------------------------------------------------------------------
// The directory

export type DirectoryFilter = 'all' | 'owing' | 'settled';
export type DirectorySort = 'name' | 'largest' | 'oldest';

const isOwing = (summary: SupplierSummary) => summary.account.owedCents > 0;

export function filterSuppliers(
  suppliers: readonly SupplierSummary[],
  filter: DirectoryFilter,
): SupplierSummary[] {
  if (filter === 'all') return [...suppliers];
  return suppliers.filter((summary) => isOwing(summary) === (filter === 'owing'));
}

/** How many suppliers each filter would show (the numbers on its tabs). */
export function filterCounts(
  suppliers: readonly SupplierSummary[],
): Record<DirectoryFilter, number> {
  const owing = suppliers.filter(isOwing).length;
  return { all: suppliers.length, owing, settled: suppliers.length - owing };
}

/** The headline of the directory: how many suppliers, how many are owed, and what is owed in all. */
export function directoryStats(suppliers: readonly SupplierSummary[]): {
  suppliers: number;
  owing: number;
  owedCents: number;
} {
  let owedCents = 0;
  let owing = 0;
  for (const summary of suppliers) {
    if (!isOwing(summary)) continue;
    owing += 1;
    owedCents += summary.account.owedCents;
  }
  return { suppliers: suppliers.length, owing, owedCents };
}

/**
 * By name (the order the repository gives), by what is owed, or by the age of the debt. Whoever is
 * owed nothing comes after those who are, in name order, in the two debt orders.
 */
export function sortSuppliers(
  suppliers: readonly SupplierSummary[],
  sort: DirectorySort,
): SupplierSummary[] {
  if (sort === 'name') return [...suppliers];
  const rank = new Map(suppliers.map((summary, index) => [summary.supplier.id, index]));
  const position = (summary: SupplierSummary) => rank.get(summary.supplier.id) ?? 0;
  return [...suppliers].sort((a, b) => {
    const owed = Number(isOwing(b)) - Number(isOwing(a));
    if (owed !== 0) return owed;
    if (!isOwing(a)) return position(a) - position(b);
    const byAmount = b.account.owedCents - a.account.owedCents;
    const byAge = (a.account.oldestDueDate ?? '').localeCompare(b.account.oldestDueDate ?? '');
    return (
      (sort === 'largest' ? byAmount || byAge : byAge || byAmount) || position(a) - position(b)
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Purchases

export type PurchaseStatus = 'paid' | 'partlyPaid' | 'unpaid';

/** Where a purchase stands: nothing left to pay is paid; some paid, at purchase or since, is partly paid. */
export function purchaseStatusOf(
  due: Pick<SupplierPurchaseDue, 'dueCents' | 'settledCents'> | undefined,
): PurchaseStatus {
  if (!due || due.dueCents <= 0) return 'paid';
  return due.settledCents > 0 ? 'partlyPaid' : 'unpaid';
}

export interface PurchaseRow {
  record: SupplierAccountView['purchases'][number];
  /** The account's figures for it: what is settled and what is due. */
  due: SupplierPurchaseDue | undefined;
  status: PurchaseStatus;
}

/** Every purchase of the supplier, newest first, with what the account says of each. */
export function purchaseRowsOf(view: SupplierAccountView): PurchaseRow[] {
  const dues = new Map(view.account.purchases.map((due) => [due.purchaseId, due]));
  return view.purchases.map((record) => {
    const due = dues.get(record.purchase.id);
    return { record, due, status: purchaseStatusOf(due) };
  });
}

/** Whether a row belongs to the "unpaid" view of the purchases: something is still owed on it. */
export const isUnpaid = (row: PurchaseRow): boolean => row.status !== 'paid';

/** What the payment dialog needs of a purchase to offer it: when, of what, and what is still due. */
export interface PayablePurchase {
  purchaseId: string;
  date: string;
  dueCents: number;
  productNames: readonly string[];
}

/** The purchases with something still due, oldest first (the order the account settles them). */
export function payablePurchasesOf(view: SupplierAccountView): PayablePurchase[] {
  const names = new Map(view.purchases.map((record) => [record.purchase.id, record.productNames]));
  return view.account.purchases
    .filter((due) => due.dueCents > 0)
    .map((due) => ({
      purchaseId: due.purchaseId,
      date: due.date,
      dueCents: due.dueCents,
      productNames: names.get(due.purchaseId) ?? [],
    }));
}

// ---------------------------------------------------------------------------------------------
// Payments

export interface PaymentRow {
  payment: SupplierAccountView['payments'][number];
  /**
   * Where the payment went (SP2): the purchases it settled, each with the part it took, and, with
   * no purchase, what went beyond all of them. A voided payment went nowhere.
   */
  applied: { purchaseId: string | null; date: string | null; amountCents: number }[];
}

export function paymentRowsOf(view: SupplierAccountView): PaymentRow[] {
  const dateOf = new Map(view.account.purchases.map((due) => [due.purchaseId, due.date]));
  return view.payments.map((payment) => ({
    payment,
    applied: view.account.allocations
      .filter((part) => part.paymentId === payment.id)
      .map((part) => ({
        purchaseId: part.purchaseId,
        date: part.purchaseId === null ? null : (dateOf.get(part.purchaseId) ?? null),
        amountCents: part.amountCents,
      }))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999')),
  }));
}

// ---------------------------------------------------------------------------------------------
// Activity

export type ActivityEvent =
  | {
      kind: 'purchase';
      id: string;
      date: string;
      at: string;
      purchaseId: string;
      amountCents: number;
      paidAtPurchaseCents: number;
      productNames: readonly string[];
      /** What the shop owed the supplier after it (the statement's running balance). */
      balanceCents: number | null;
    }
  | {
      kind: 'payment';
      id: string;
      date: string;
      at: string;
      paymentId: string;
      amountCents: number;
      method: 'cash' | 'bank' | 'other';
      note: string | null;
      balanceCents: number | null;
    }
  | {
      kind: 'paymentVoided';
      id: string;
      date: string;
      at: string;
      amountCents: number;
    }
  | { kind: 'added'; id: string; date: string; at: string };

const dayOf = (timestamp: string): string => {
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? timestamp.slice(0, 10) : shopDate(at);
};

/**
 * What happened on the account, newest first: the purchases, the payments, the payments voided
 * and the day the supplier was added. A purchase and a payment carry the balance the statement
 * has after them. Ordered by the day each is dated, then by when it was recorded.
 */
export function activityOf(view: SupplierAccountView): ActivityEvent[] {
  // The balance after a record is that of its last statement line (a purchase's payment at the
  // till comes right after the purchase).
  const balanceAfter = new Map<string, number>();
  // Where each record's last line sits in the statement: records of one day are listed in the
  // statement's order, so the balance after each reads on from the one below it.
  const position = new Map<string, number>();
  view.statement.forEach((line, index) => {
    balanceAfter.set(line.refId, line.balanceCents);
    position.set(line.refId, index);
  });
  const events: ActivityEvent[] = [];
  for (const { purchase, productNames } of view.purchases) {
    events.push({
      kind: 'purchase',
      id: `purchase-${purchase.id}`,
      date: purchase.date,
      at: purchase.createdAt,
      purchaseId: purchase.id,
      amountCents: purchase.totalCostCents,
      paidAtPurchaseCents: purchase.paidCents,
      productNames,
      balanceCents: balanceAfter.get(purchase.id) ?? null,
    });
  }
  for (const payment of view.payments) {
    events.push({
      kind: 'payment',
      id: `payment-${payment.id}`,
      date: payment.date,
      at: payment.createdAt,
      paymentId: payment.id,
      amountCents: payment.amountCents,
      method: payment.method,
      note: payment.note,
      balanceCents: payment.voidedAt === null ? (balanceAfter.get(payment.id) ?? null) : null,
    });
    if (payment.voidedAt !== null) {
      events.push({
        kind: 'paymentVoided',
        id: `void-${payment.id}`,
        date: dayOf(payment.voidedAt),
        at: payment.voidedAt,
        amountCents: payment.amountCents,
      });
    }
  }
  events.push({
    kind: 'added',
    id: `added-${view.supplier.id}`,
    date: dayOf(view.supplier.createdAt),
    at: view.supplier.createdAt,
  });
  // Within a day, newest first: a void on top, then the statement's own lines from its last to
  // its first, then a voided payment (it has no line) and the day the supplier was added.
  const rank = (event: ActivityEvent): number => {
    switch (event.kind) {
      case 'paymentVoided':
        return Number.MAX_SAFE_INTEGER;
      case 'purchase':
        return position.get(event.purchaseId) ?? -1;
      case 'payment':
        return position.get(event.paymentId) ?? -1;
      case 'added':
        return -2;
    }
  };
  return events.sort(
    (a, b) => b.date.localeCompare(a.date) || rank(b) - rank(a) || b.at.localeCompare(a.at),
  );
}

// ---------------------------------------------------------------------------------------------
// The statement

export interface StatementWindow {
  /** What the shop owed before the first line shown (0 when the lines start the account). */
  openingCents: number;
  /** The latest lines, oldest first. */
  lines: SupplierStatementLine[];
  /** What the shop owes after the last line: the account's balance. */
  closingCents: number;
}

/**
 * The latest `count` lines of the statement with the balance before them and after them. Both
 * balances are the statement's own running balances (SP1), so the lines lead from one to the
 * other and the closing one is the account's.
 */
export function statementWindow(
  statement: readonly SupplierStatementLine[],
  count: number,
): StatementWindow {
  const start = Math.max(0, statement.length - count);
  return {
    openingCents: statement[start - 1]?.balanceCents ?? 0,
    lines: statement.slice(start),
    closingCents: statement.at(-1)?.balanceCents ?? 0,
  };
}
