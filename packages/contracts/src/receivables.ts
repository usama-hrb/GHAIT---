import {
  allocateCustomerPayment,
  applyCredit,
  type CustomerAccount,
  customerAccount,
  effectiveAllocations,
  type OpenInvoice,
} from '@fabric/core';
import { z } from 'zod';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import {
  PAYMENT_METHODS,
  type Payment,
  type WriteOff,
  type PaymentAllocation,
  paymentAllocationSchema,
  paymentSchema,
  storedCustomerSchema,
  writeOffSchema,
} from './customers.js';
import type { ValidationIssue } from './errors.js';
import { syncOrder } from './order.js';
import { returnedCreditCents, type SaleReturn } from './returns.js';
import type { Sale } from './sales.js';

/** One payment op: the payment (or refund) and how it is applied, in one transaction. */
export const paymentAggregateSchema = z.object({
  payment: paymentSchema,
  allocations: z.array(paymentAllocationSchema).max(200),
});
export type PaymentAggregate = z.output<typeof paymentAggregateSchema>;

/** A customer's credit applied to their unpaid invoices: allocations of earlier payments (P6). */
export const creditApplicationSchema = z.object({
  allocations: z.array(paymentAllocationSchema).min(1).max(200),
});
export type CreditApplication = z.output<typeof creditApplicationSchema>;

/** What the user enters to record a customer's payment (BUILD_PROMPTS 3.5). */
export const newPaymentSchema = z.object({
  customerId: idSchema,
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  /** The invoice it pays first; null: the oldest unpaid invoices first (SPEC §4.1). */
  targetSaleId: idSchema.nullable().default(null),
  note: optionalTextSchema(500).default(null),
});
export type NewPayment = z.output<typeof newPaymentSchema>;
export type NewPaymentInput = z.input<typeof newPaymentSchema>;

/** Money given back to a customer out of their credit (P6). */
export const newRefundSchema = newPaymentSchema.omit({ targetSaleId: true });
export type NewRefund = z.output<typeof newRefundSchema>;
export type NewRefundInput = z.input<typeof newRefundSchema>;

export const RECEIVABLE_ISSUES = {
  needsCustomer: 'payment_needs_customer',
  refundApplied: 'refund_cannot_pay_sales',
  allocationMismatch: 'allocation_does_not_match_payment',
  unknownSale: 'allocation_unknown_sale',
  otherCustomer: 'allocation_other_customer',
  overApplied: 'payment_applied_beyond_amount',
  unknownTarget: 'payment_unknown_invoice',
  aboveCredit: 'refund_above_credit',
  noCredit: 'no_credit_to_apply',
  writeOffNoDebt: 'write_off_nothing_due',
} as const;

/** Everything about one customer that their account is derived from. */
export interface CustomerRecords {
  /** Their sales, voided ones included. */
  sales: readonly Sale[];
  /** Their payments and refunds (with server_seq where known: the order credit is used in). */
  payments: readonly (Payment & { serverSeq?: number | null })[];
  /** How their payments were applied. */
  allocations: readonly (PaymentAllocation & { serverSeq?: number | null })[];
  writeOffs: readonly WriteOff[];
  /** The goods they gave back (RT1), voided returns included. */
  returns: readonly SaleReturn[];
}

/** What each sale is worth now: its total less the credits of its live returns (RT3). */
export function worthBySaleOf(
  sales: readonly Sale[],
  returns: readonly SaleReturn[],
): Map<string, number> {
  return new Map(
    sales.map((sale) => [
      sale.id,
      sale.totalCents - returnedCreditCents(returns.filter((given) => given.saleId === sale.id)),
    ]),
  );
}

/**
 * The allocations in the order they were applied, each capped at what its invoice is worth after
 * returns: the rest is the customer's money again (@fabric/core effectiveAllocations, RT3).
 */
export function effectiveAllocationsOf<
  A extends PaymentAllocation & { serverSeq?: number | null },
>(records: {
  sales: readonly Sale[];
  returns: readonly SaleReturn[];
  allocations: readonly A[];
}): A[] {
  return effectiveAllocations(
    [...records.allocations].sort(syncOrder),
    worthBySaleOf(records.sales, records.returns),
  );
}

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

/** The customer's account (@fabric/core customerAccount) from their records. */
export function customerAccountOf(records: CustomerRecords, today: string): CustomerAccount {
  const writtenOff = new Set(records.writeOffs.map((writeOff) => writeOff.saleId));
  return customerAccount({
    sales: records.sales.map((sale) => ({
      saleId: sale.id,
      date: sale.date,
      dueDate: sale.dueDate,
      totalCents: sale.totalCents,
      returnedCents: returnedCreditCents(
        records.returns.filter((given) => given.saleId === sale.id),
      ),
      voided: sale.voidedAt !== null,
      writtenOff: writtenOff.has(sale.id),
    })),
    payments: records.payments.map((payment) => ({
      paymentId: payment.id,
      kind: payment.kind,
      amountCents: payment.amountCents,
    })),
    allocations: [...records.allocations].sort(syncOrder),
    today,
  });
}

/**
 * The customer's invoices a payment can reach, with what each has received. Amounts applied do
 * not depend on an invoice's capital, so it is left at 0 (the parts are derived later, P10).
 */
function invoicesOf(records: CustomerRecords, include: (sale: Sale) => boolean): OpenInvoice[] {
  const worth = worthBySaleOf(records.sales, records.returns);
  const allocations = effectiveAllocationsOf(records);
  return records.sales
    .filter((sale) => sale.voidedAt === null && include(sale))
    .map((sale) => ({
      saleId: sale.id,
      date: sale.date,
      totalCents: worth.get(sale.id) ?? sale.totalCents,
      capitalCents: 0,
      paymentsCents: allocations
        .filter((allocation) => allocation.saleId === sale.id)
        .map((allocation) => allocation.amountCents)
        .filter((amount) => amount > 0),
    }));
}

type Meta = { deviceId: string; now: string };

/**
 * A customer's payment and how it is applied (SPEC §4.1, P6): to the chosen invoice first, then
 * the oldest unpaid ones; general payments skip written-off invoices. What is left is credit.
 */
export function buildPayment(
  input: NewPayment,
  records: CustomerRecords,
  ids: { paymentId: string; newId: () => string },
  meta: Meta,
):
  | { ok: true; aggregate: PaymentAggregate; unappliedCents: number }
  | { ok: false; issues: ValidationIssue[] } {
  const writtenOff = new Set(records.writeOffs.map((writeOff) => writeOff.saleId));
  const invoices = invoicesOf(
    records,
    (sale) => !writtenOff.has(sale.id) || sale.id === input.targetSaleId,
  );
  if (
    input.targetSaleId !== null &&
    !invoices.some((invoice) => invoice.saleId === input.targetSaleId)
  ) {
    return { ok: false, issues: [issue(['targetSaleId'], RECEIVABLE_ISSUES.unknownTarget)] };
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const payment: Payment = {
    ...base,
    id: ids.paymentId,
    customerId: input.customerId,
    kind: 'payment',
    amountCents: input.amountCents,
    date: input.date,
    method: input.method,
    note: input.note,
  };
  const result = allocateCustomerPayment(invoices, input.amountCents, input.targetSaleId);
  return {
    ok: true,
    aggregate: {
      payment,
      allocations: result.allocations.map((allocation) => ({
        ...base,
        id: ids.newId(),
        paymentId: payment.id,
        saleId: allocation.saleId,
        amountCents: allocation.appliedCents,
        date: input.date,
      })),
    },
    unappliedCents: result.unappliedCents,
  };
}

/** Money given back out of the customer's credit (P6); never more than the credit. */
export function buildRefund(
  input: NewRefund,
  records: CustomerRecords,
  ids: { paymentId: string },
  meta: Meta & { today: string },
): { ok: true; aggregate: PaymentAggregate } | { ok: false; issues: ValidationIssue[] } {
  const { creditCents } = customerAccountOf(records, meta.today);
  if (input.amountCents > creditCents) {
    return { ok: false, issues: [issue(['amountCents'], RECEIVABLE_ISSUES.aboveCredit)] };
  }
  return {
    ok: true,
    aggregate: {
      payment: {
        createdAt: meta.now,
        updatedAt: meta.now,
        deviceId: meta.deviceId,
        voidedAt: null,
        id: ids.paymentId,
        customerId: input.customerId,
        kind: 'refund',
        amountCents: input.amountCents,
        date: input.date,
        method: input.method,
        note: input.note,
      },
      allocations: [],
    },
  };
}

/**
 * The customer's credit applied to their unpaid invoices (P6): each payment's rest, oldest first,
 * after refunds (which take from the oldest rests too), onto the oldest invoices not written off.
 */
export function buildCreditApplication(
  records: CustomerRecords,
  ids: { newId: () => string },
  meta: Meta & { date: string },
): { ok: true; application: CreditApplication } | { ok: false; issues: ValidationIssue[] } {
  const live = new Set(
    records.sales.filter((sale) => sale.voidedAt === null).map((sale) => sale.id),
  );
  const allocations = effectiveAllocationsOf(records);
  const sources = records.payments
    .filter((payment) => payment.kind === 'payment')
    .sort(syncOrder)
    .map((payment, index) => ({
      paymentId: payment.id,
      // applyCredit takes the oldest first: the history order, as a sortable key.
      date: String(index).padStart(6, '0'),
      unappliedCents:
        payment.amountCents -
        allocations
          .filter(
            (allocation) => allocation.paymentId === payment.id && live.has(allocation.saleId),
          )
          .reduce((sum, allocation) => sum + allocation.amountCents, 0),
    }));
  let refunded = records.payments
    .filter((payment) => payment.kind === 'refund')
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  for (const source of sources) {
    const taken = Math.min(refunded, Math.max(source.unappliedCents, 0));
    source.unappliedCents -= taken;
    refunded -= taken;
  }
  const writtenOff = new Set(records.writeOffs.map((writeOff) => writeOff.saleId));
  const applied = applyCredit(
    sources.filter((source) => source.unappliedCents > 0),
    invoicesOf(records, (sale) => !writtenOff.has(sale.id)),
  );
  if (applied.length === 0) return { ok: false, issues: [issue([], RECEIVABLE_ISSUES.noCredit)] };
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  return {
    ok: true,
    application: {
      allocations: applied.map((allocation) => ({
        ...base,
        id: ids.newId(),
        paymentId: allocation.paymentId,
        saleId: allocation.saleId,
        amountCents: allocation.amountCents,
        date: meta.date,
      })),
    },
  };
}

/**
 * Re-checks pushed allocations (a payment's, or a credit application) on the server: each one
 * pays a sale of the payment's customer, and no payment is applied beyond its amount. How the
 * money was spread is not recomputed: it depends on what the device knew (offline), and any
 * spread keeps the customer's balance right (ADR 0002, slice 5).
 */
export function checkAllocations(
  allocations: readonly PaymentAllocation[],
  payments: ReadonlyMap<string, Payment>,
  sales: ReadonlyMap<string, Sale>,
  appliedSoFar: ReadonlyMap<string, number>,
): ValidationIssue[] {
  const applied = new Map(appliedSoFar);
  for (const [index, allocation] of allocations.entries()) {
    const payment = payments.get(allocation.paymentId);
    if (payment?.kind !== 'payment') {
      return [issue(['allocations', index, 'paymentId'], RECEIVABLE_ISSUES.allocationMismatch)];
    }
    const sale = sales.get(allocation.saleId);
    if (!sale) return [issue(['allocations', index, 'saleId'], RECEIVABLE_ISSUES.unknownSale)];
    if (sale.customerId === null || sale.customerId !== payment.customerId) {
      return [issue(['allocations', index, 'saleId'], RECEIVABLE_ISSUES.otherCustomer)];
    }
    const total = (applied.get(payment.id) ?? 0) + allocation.amountCents;
    if (total > payment.amountCents) {
      return [issue(['allocations', index, 'amountCents'], RECEIVABLE_ISSUES.overApplied)];
    }
    applied.set(payment.id, total);
  }
  return [];
}

/** Re-checks a pushed payment: a customer's, its allocations its own (a refund pays no sale). */
export function checkPaymentAggregate(
  aggregate: PaymentAggregate,
  sales: ReadonlyMap<string, Sale>,
): ValidationIssue[] {
  const { payment, allocations } = aggregate;
  if (payment.customerId === null)
    return [issue(['payment', 'customerId'], RECEIVABLE_ISSUES.needsCustomer)];
  if (payment.kind === 'refund' && allocations.length > 0) {
    return [issue(['allocations'], RECEIVABLE_ISSUES.refundApplied)];
  }
  const index = allocations.findIndex(
    (allocation) => allocation.paymentId !== payment.id || allocation.date !== payment.date,
  );
  if (index >= 0) return [issue(['allocations', index], RECEIVABLE_ISSUES.allocationMismatch)];
  return checkAllocations(allocations, new Map([[payment.id, payment]]), sales, new Map());
}

/** Writes off what is due on a credit sale as a bad debt (SPEC §4.1, S5). */
export function buildWriteOff(
  input: { saleId: string; reason: string; date: string },
  ids: { id: string },
  meta: Meta,
): WriteOff {
  return {
    id: ids.id,
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
    saleId: input.saleId,
    date: input.date,
    reason: input.reason,
  };
}

/** Re-checks a write-off: a live sale of a customer with something still due on it. */
export function checkWriteOff(
  writeOff: WriteOff,
  sale: Sale | undefined,
  records: CustomerRecords | undefined,
): ValidationIssue[] {
  if (!sale || !records) return [issue(['saleId'], RECEIVABLE_ISSUES.unknownSale)];
  if (sale.customerId === null || sale.voidedAt !== null) {
    return [issue(['saleId'], RECEIVABLE_ISSUES.writeOffNoDebt)];
  }
  const invoice = customerAccountOf(records, writeOff.date).openInvoices.find(
    (open) => open.saleId === sale.id,
  );
  return invoice && !invoice.writtenOff
    ? []
    : [issue(['saleId'], RECEIVABLE_ISSUES.writeOffNoDebt)];
}

const accountSchema = z.object({
  balanceCents: z.int(),
  collectibleCents: z.int(),
  writtenOffCents: z.int(),
  creditCents: z.int(),
  overdueCents: z.int(),
  openInvoices: z.array(
    z.object({
      saleId: idSchema,
      date: isoDateSchema,
      dueDate: isoDateSchema.nullable(),
      totalCents: z.int(),
      paidCents: z.int(),
      dueCents: z.int(),
      writtenOff: z.boolean(),
      overdue: z.boolean(),
    }),
  ),
  oldestOpenDate: isoDateSchema.nullable(),
});

/** GET /customers/debts: who owes what, the oldest debt first. */
export const debtSummarySchema = z.object({
  customer: storedCustomerSchema,
  account: accountSchema,
});
export type DebtSummary = z.output<typeof debtSummarySchema>;

/** GET /customers/:id/account. */
export const customerAccountDetailSchema = z.object({
  customer: storedCustomerSchema,
  account: accountSchema,
  payments: z.array(paymentSchema),
  allocations: z.array(paymentAllocationSchema),
  writeOffs: z.array(writeOffSchema),
});
export type CustomerAccountDetail = z.output<typeof customerAccountDetailSchema>;
