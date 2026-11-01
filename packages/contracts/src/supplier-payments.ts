import { type SupplierAccount, supplierAccount, supplierStatement } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema, storedSupplierSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import { PAYMENT_METHODS } from './customers.js';
import type { ValidationIssue } from './errors.js';
import { checkUnchanged } from './partners.js';
import type { Purchase } from './purchasing.js';

/**
 * SPEC §13 `supplier_payment`: money paid to a supplier for what a purchase left owing (SP1–SP3).
 * Created, or voided with a reason; never edited (like a draw). `purchaseId` is the purchase it
 * pays first; none: the oldest purchases first.
 */
export const supplierPaymentSchema = recordBaseSchema.extend({
  supplierId: idSchema,
  purchaseId: idSchema.nullable(),
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  method: z.enum(PAYMENT_METHODS),
  note: optionalTextSchema(500),
});
export type SupplierPayment = z.output<typeof supplierPaymentSchema>;

/** What the owner enters to pay a supplier. */
export const newSupplierPaymentSchema = z.object({
  supplierId: idSchema,
  purchaseId: idSchema.nullable().default(null),
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  note: optionalTextSchema(500).default(null),
});
export type NewSupplierPayment = z.output<typeof newSupplierPaymentSchema>;
export type NewSupplierPaymentInput = z.input<typeof newSupplierPaymentSchema>;

export const SUPPLIER_PAYMENT_ISSUES = {
  unknownPurchase: 'supplier_payment_unknown_purchase',
  aboveOwed: 'supplier_payment_above_owed',
  fixed: 'supplier_payment_fixed',
} as const;

const issue = (path: string, message: string): ValidationIssue[] => [
  { path: [path], message, code: 'custom' },
];

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/** One supplier's purchases and payments: what their account is derived from. */
export interface SupplierRecords {
  purchases: readonly Purchase[];
  payments: readonly SupplierPayment[];
}

const accountInput = (supplierId: string, records: SupplierRecords) => ({
  purchases: live(records.purchases)
    .filter((purchase) => purchase.supplierId === supplierId)
    .map((purchase) => ({
      purchaseId: purchase.id,
      date: purchase.date,
      totalCents: purchase.totalCostCents,
      paidCents: purchase.paidCents,
    })),
  payments: live(records.payments)
    .filter((payment) => payment.supplierId === supplierId)
    .map((payment) => ({
      paymentId: payment.id,
      date: payment.date,
      amountCents: payment.amountCents,
      purchaseId: payment.purchaseId,
    })),
});

/** What the shop owes one supplier (@fabric/core supplierAccount), voided records left out. */
export function supplierAccountOf(supplierId: string, records: SupplierRecords): SupplierAccount {
  return supplierAccount(accountInput(supplierId, records));
}

/** The supplier's statement: purchases and payments with the running balance. */
export function supplierStatementOf(supplierId: string, records: SupplierRecords) {
  return supplierStatement(accountInput(supplierId, records));
}

/**
 * Re-checks a supplier payment (the server's own check, and the device's before saving): it pays a
 * purchase of that supplier, and no more than the supplier is owed (SP3) — an advance would be an
 * asset nobody asked for, and a typing slip shows up as a refusal.
 */
export function checkSupplierPayment(
  payment: Pick<SupplierPayment, 'id' | 'supplierId' | 'purchaseId' | 'amountCents'>,
  records: SupplierRecords,
): ValidationIssue[] {
  if (payment.purchaseId !== null) {
    const purchase = records.purchases.find((candidate) => candidate.id === payment.purchaseId);
    if (!purchase || purchase.supplierId !== payment.supplierId || purchase.voidedAt !== null) {
      return issue('purchaseId', SUPPLIER_PAYMENT_ISSUES.unknownPurchase);
    }
  }
  const others = {
    purchases: records.purchases,
    payments: records.payments.filter((candidate) => candidate.id !== payment.id),
  };
  const owed = supplierAccountOf(payment.supplierId, others).owedCents;
  return payment.amountCents > owed ? issue('amountCents', SUPPLIER_PAYMENT_ISSUES.aboveOwed) : [];
}

/** A supplier payment is only created or voided, never edited. */
export function checkSupplierPaymentUnchanged(
  current: SupplierPayment,
  next: SupplierPayment,
): ValidationIssue[] {
  return checkUnchanged(
    current,
    next,
    ['supplierId', 'purchaseId', 'amountCents', 'date', 'method', 'note'],
    SUPPLIER_PAYMENT_ISSUES.fixed,
  );
}

const withServerSeq = { serverSeq: z.int().positive() };
export const storedSupplierPaymentSchema = supplierPaymentSchema.extend(withServerSeq);
export type StoredSupplierPayment = z.output<typeof storedSupplierPaymentSchema>;

const accountSchema = z.object({
  balanceCents: z.int(),
  owedCents: z.int(),
  advanceCents: z.int(),
  purchases: z.array(
    z.object({
      purchaseId: idSchema,
      date: isoDateSchema,
      totalCents: z.int(),
      paidCents: z.int(),
      settledCents: z.int(),
      dueCents: z.int(),
    }),
  ),
  oldestDueDate: isoDateSchema.nullable(),
});

/** GET /supplier-payables: who the shop owes, the largest debt first. */
export const supplierPayableSchema = z.object({
  supplier: storedSupplierSchema,
  account: accountSchema,
});
export type SupplierPayable = z.output<typeof supplierPayableSchema>;

/** GET /suppliers/:id/statement. */
export const supplierStatementDetailSchema = z.object({
  supplier: storedSupplierSchema,
  account: accountSchema,
  statement: z.array(
    z.object({
      date: isoDateSchema,
      kind: z.enum(['purchase', 'paid_at_purchase', 'payment']),
      refId: idSchema,
      deltaCents: z.int(),
      balanceCents: z.int(),
    }),
  ),
  payments: z.array(storedSupplierPaymentSchema),
});
export type SupplierStatementDetail = z.output<typeof supplierStatementDetailSchema>;
