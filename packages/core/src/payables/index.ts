import { assertInteger } from '../numeric/index.js';

/**
 * Supplier payables (SPEC §9, §10, BUILD_PROMPTS 5.3, docs/accounting-assumptions.md SP1–SP4): a
 * purchase may be paid in part when it is made (`paid_cents` < `total_cost_cents`); the rest is a
 * debt to the supplier, paid down later by supplier payments. What the shop owes a supplier is
 * Σ purchases − Σ paid at purchase − Σ payments, derived, never stored.
 */

export interface SupplierPurchase {
  purchaseId: string;
  /** YYYY-MM-DD. */
  date: string;
  totalCents: number;
  /** Paid when the purchase was made. */
  paidCents: number;
}

export interface SupplierPayment {
  paymentId: string;
  /** YYYY-MM-DD. */
  date: string;
  amountCents: number;
  /** The purchase it pays first; null: the oldest purchases first. */
  purchaseId: string | null;
}

export interface SupplierPurchaseDue extends SupplierPurchase {
  /** Paid at purchase plus what the payments cover (oldest purchases first, SP2). */
  settledCents: number;
  dueCents: number;
}

export interface SupplierAccount {
  /**
   * Σ purchases − Σ paid at purchase − Σ payments: what the shop owes. Negative when payments
   * went beyond it: an advance the supplier holds for the shop.
   */
  balanceCents: number;
  /** max(0, balance): a debt the shop owes now (zakat counts these, SPEC §10). */
  owedCents: number;
  /** max(0, −balance): paid beyond what was owed. */
  advanceCents: number;
  /** Every purchase, oldest first, with what is still due on it. */
  purchases: SupplierPurchaseDue[];
  /** The date of the oldest purchase still unpaid: the age of the debt. */
  oldestDueDate: string | null;
}

const byDateThenId =
  <T extends { date: string }>(key: (item: T) => string) =>
  (a: T, b: T) =>
    a.date.localeCompare(b.date) || key(a).localeCompare(key(b));

/**
 * A supplier's account from their purchases and payments (SP1, SP2). A payment names a purchase to
 * pay first (what it does not need passes on) or none; payments without a target, and the rest of
 * the others, pay the oldest purchases first. The balance does not depend on this order; only the
 * per-purchase dues do.
 */
export function supplierAccount(input: {
  purchases: readonly SupplierPurchase[];
  payments: readonly SupplierPayment[];
}): SupplierAccount {
  const purchases = [...input.purchases].sort(byDateThenId((purchase) => purchase.purchaseId));
  const known = new Set(purchases.map((purchase) => purchase.purchaseId));
  const settled = new Map<string, number>();
  let owedTotal = 0;
  for (const purchase of purchases) {
    assertInteger(purchase.totalCents, 'totalCents', 0);
    assertInteger(purchase.paidCents, 'paidCents', 0);
    if (purchase.paidCents > purchase.totalCents) {
      throw new RangeError(`purchase ${purchase.purchaseId} is paid beyond its total`);
    }
    settled.set(purchase.purchaseId, purchase.paidCents);
    owedTotal += purchase.totalCents - purchase.paidCents;
  }

  let pool = 0;
  const payments = [...input.payments].sort(byDateThenId((payment) => payment.paymentId));
  for (const payment of payments) {
    assertInteger(payment.amountCents, 'payment amountCents', 1);
    owedTotal -= payment.amountCents;
    const target =
      payment.purchaseId !== null && known.has(payment.purchaseId) ? payment.purchaseId : null;
    if (target === null) {
      pool += payment.amountCents;
      continue;
    }
    const purchase = purchases.find((candidate) => candidate.purchaseId === target);
    const room = (purchase?.totalCents ?? 0) - (settled.get(target) ?? 0);
    const applied = Math.min(room, payment.amountCents);
    settled.set(target, (settled.get(target) ?? 0) + applied);
    pool += payment.amountCents - applied;
  }
  for (const purchase of purchases) {
    if (pool === 0) break;
    const room = purchase.totalCents - (settled.get(purchase.purchaseId) ?? 0);
    const applied = Math.min(room, pool);
    settled.set(purchase.purchaseId, (settled.get(purchase.purchaseId) ?? 0) + applied);
    pool -= applied;
  }

  const due = purchases.map((purchase): SupplierPurchaseDue => {
    const settledCents = settled.get(purchase.purchaseId) ?? 0;
    return { ...purchase, settledCents, dueCents: purchase.totalCents - settledCents };
  });
  return {
    balanceCents: owedTotal,
    owedCents: Math.max(0, owedTotal),
    advanceCents: Math.max(0, -owedTotal),
    purchases: due,
    oldestDueDate: due.find((purchase) => purchase.dueCents > 0)?.date ?? null,
  };
}

/** One line of a supplier statement: what happened, and the balance after it. */
export interface SupplierStatementLine {
  date: string;
  kind: 'purchase' | 'paid_at_purchase' | 'payment';
  /** The purchase or payment it comes from. */
  refId: string;
  /** What the line adds to what the shop owes: a purchase +, a payment −. */
  deltaCents: number;
  balanceCents: number;
}

/**
 * A supplier's statement (BUILD_PROMPTS 5.3): every purchase and payment oldest first, with the
 * running balance. A purchase is a line at its total; what was paid with it is the line after.
 */
export function supplierStatement(input: {
  purchases: readonly SupplierPurchase[];
  payments: readonly SupplierPayment[];
}): SupplierStatementLine[] {
  const rows: Omit<SupplierStatementLine, 'balanceCents'>[] = [];
  for (const purchase of input.purchases) {
    rows.push({
      date: purchase.date,
      kind: 'purchase',
      refId: purchase.purchaseId,
      deltaCents: purchase.totalCents,
    });
    if (purchase.paidCents > 0) {
      rows.push({
        date: purchase.date,
        kind: 'paid_at_purchase',
        refId: purchase.purchaseId,
        deltaCents: -purchase.paidCents,
      });
    }
  }
  for (const payment of input.payments) {
    rows.push({
      date: payment.date,
      kind: 'payment',
      refId: payment.paymentId,
      deltaCents: -payment.amountCents,
    });
  }
  const order = { purchase: 0, paid_at_purchase: 1, payment: 2 } as const;
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      order[a.kind] - order[b.kind] ||
      a.refId.localeCompare(b.refId),
  );
  let balanceCents = 0;
  return rows.map((row) => {
    balanceCents += row.deltaCents;
    return { ...row, balanceCents };
  });
}
