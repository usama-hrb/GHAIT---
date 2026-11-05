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

/**
 * Where (part of) a payment went: to a purchase it settled, or, with `purchaseId` null, nowhere
 * yet: paid beyond everything owed, an advance the supplier holds for the shop.
 */
export interface SupplierAllocation {
  paymentId: string;
  purchaseId: string | null;
  amountCents: number;
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
  /** Σ of the purchases' totals: what the shop bought from the supplier. */
  purchasesCents: number;
  /** Σ paid at purchase + Σ payments: what the shop has paid the supplier. */
  paidCents: number;
  /** Every purchase, oldest first, with what is still due on it. */
  purchases: SupplierPurchaseDue[];
  /**
   * Where each payment went (SP2): the part that went to the purchase it names, then the rest on
   * the oldest purchases, and an entry with no purchase for what paid beyond them all. Oldest
   * payment first; the parts of one payment add up to its amount.
   */
  allocations: SupplierAllocation[];
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
  let purchasesCents = 0;
  let paidCents = 0;
  for (const purchase of purchases) {
    assertInteger(purchase.totalCents, 'totalCents', 0);
    assertInteger(purchase.paidCents, 'paidCents', 0);
    if (purchase.paidCents > purchase.totalCents) {
      throw new RangeError(`purchase ${purchase.purchaseId} is paid beyond its total`);
    }
    settled.set(purchase.purchaseId, purchase.paidCents);
    owedTotal += purchase.totalCents - purchase.paidCents;
    purchasesCents += purchase.totalCents;
    paidCents += purchase.paidCents;
  }

  // What the payments did not give to the purchase they named, oldest payment first.
  const pool: { paymentId: string; remainingCents: number }[] = [];
  const allocations: SupplierAllocation[] = [];
  const payments = [...input.payments].sort(byDateThenId((payment) => payment.paymentId));
  for (const payment of payments) {
    assertInteger(payment.amountCents, 'payment amountCents', 1);
    owedTotal -= payment.amountCents;
    paidCents += payment.amountCents;
    const target =
      payment.purchaseId !== null && known.has(payment.purchaseId) ? payment.purchaseId : null;
    if (target === null) {
      pool.push({ paymentId: payment.paymentId, remainingCents: payment.amountCents });
      continue;
    }
    const purchase = purchases.find((candidate) => candidate.purchaseId === target);
    const room = (purchase?.totalCents ?? 0) - (settled.get(target) ?? 0);
    const applied = Math.min(room, payment.amountCents);
    settled.set(target, (settled.get(target) ?? 0) + applied);
    if (applied > 0) {
      allocations.push({ paymentId: payment.paymentId, purchaseId: target, amountCents: applied });
    }
    if (payment.amountCents > applied) {
      pool.push({ paymentId: payment.paymentId, remainingCents: payment.amountCents - applied });
    }
  }
  for (const purchase of purchases) {
    for (const part of pool) {
      const room = purchase.totalCents - (settled.get(purchase.purchaseId) ?? 0);
      if (room === 0) break;
      const applied = Math.min(room, part.remainingCents);
      if (applied === 0) continue;
      settled.set(purchase.purchaseId, (settled.get(purchase.purchaseId) ?? 0) + applied);
      part.remainingCents -= applied;
      allocations.push({
        paymentId: part.paymentId,
        purchaseId: purchase.purchaseId,
        amountCents: applied,
      });
    }
  }
  for (const part of pool) {
    if (part.remainingCents > 0) {
      allocations.push({
        paymentId: part.paymentId,
        purchaseId: null,
        amountCents: part.remainingCents,
      });
    }
  }

  const due = purchases.map((purchase): SupplierPurchaseDue => {
    const settledCents = settled.get(purchase.purchaseId) ?? 0;
    return { ...purchase, settledCents, dueCents: purchase.totalCents - settledCents };
  });
  return {
    balanceCents: owedTotal,
    owedCents: Math.max(0, owedTotal),
    advanceCents: Math.max(0, -owedTotal),
    purchasesCents,
    paidCents,
    purchases: due,
    allocations,
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
 * running balance. A purchase is a line at its total; what was paid with it is the line right
 * after. Records of one day stay in the order given (purchases, then payments), so a statement of
 * records given in the order they were recorded reads in that order (SP6); the last balance never
 * depends on it.
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
  const order = { purchase: 0, paid_at_purchase: 0, payment: 1 } as const;
  // Within a day: each purchase followed by what was paid with it, then the payments. Records of
  // one group keep the order they were given in (the sort is stable), which callers give as
  // recorded (SP6), so a purchase's line after it is its own, not the day's other purchases'.
  rows.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  let balanceCents = 0;
  return rows.map((row) => {
    balanceCents += row.deltaCents;
    return { ...row, balanceCents };
  });
}
