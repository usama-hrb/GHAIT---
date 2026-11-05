import {
  type SupplierAccount,
  type SupplierAllocation,
  supplierAccount,
  supplierStatement,
} from '@fabric/core';
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

/** In the order they were recorded (by when, then by id), so same-day records read as they happened (SP6). */
const recorded = <T extends { id: string; createdAt: string }>(records: readonly T[]): T[] =>
  [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

const accountInput = (supplierId: string, records: SupplierRecords) => ({
  purchases: recorded(live(records.purchases))
    .filter((purchase) => purchase.supplierId === supplierId)
    .map((purchase) => ({
      purchaseId: purchase.id,
      date: purchase.date,
      totalCents: purchase.totalCostCents,
      paidCents: purchase.paidCents,
    })),
  payments: recorded(live(records.payments))
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

/** What a payment would do, before it is saved. */
export interface SupplierPaymentPreview {
  /** What the save would refuse it for (checkSupplierPayment); empty when it can be saved. */
  issues: ValidationIssue[];
  /** Where the payment would go (SP2): the purchases it settles, the oldest first after its own. */
  allocations: SupplierAllocation[];
  /** What the shop would owe the supplier after it. */
  owedAfterCents: number;
}

/**
 * The payment as the account will read it once saved: the same check and the same account
 * (@fabric/core supplierAccount) as the save, so the form shows where the money goes and what is
 * left without working anything out itself.
 */
export function previewSupplierPayment(
  payment: Pick<SupplierPayment, 'id' | 'supplierId' | 'purchaseId' | 'amountCents' | 'date'>,
  records: SupplierRecords,
): SupplierPaymentPreview {
  const issues = checkSupplierPayment(payment, records);
  const others = accountInput(payment.supplierId, {
    purchases: records.purchases,
    payments: records.payments.filter((candidate) => candidate.id !== payment.id),
  });
  const after = supplierAccount({
    purchases: others.purchases,
    payments: [
      ...others.payments,
      {
        paymentId: payment.id,
        date: payment.date,
        amountCents: payment.amountCents,
        purchaseId: payment.purchaseId,
      },
    ],
  });
  return {
    issues,
    allocations: after.allocations.filter((part) => part.paymentId === payment.id),
    owedAfterCents: after.owedCents,
  };
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
  purchasesCents: z.int(),
  paidCents: z.int(),
  allocations: z.array(
    z.object({ paymentId: idSchema, purchaseId: idSchema.nullable(), amountCents: z.int() }),
  ),
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
