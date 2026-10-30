import { z } from 'zod';
import { phoneSchema, recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';

const customerFields = z.object({
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  notes: optionalTextSchema(1000).default(null),
});

/** SPEC §13 `customer`; the balance is derived from sales and payments (SPEC §4.1). */
export const customerInputSchema = customerFields;
export type CustomerInput = z.input<typeof customerInputSchema>;
export const customerSchema = recordBaseSchema.extend(customerFields.shape);
export type Customer = z.output<typeof customerSchema>;
export const storedCustomerSchema = customerSchema.extend({ serverSeq: z.int().positive() });
export type StoredCustomer = z.output<typeof storedCustomerSchema>;

/**
 * - payment: money received from a customer (or a walk-in buyer), applied to sales;
 * - refund: money given back (a voided sale's payments, a credit paid out). docs/accounting-assumptions.md P13.
 */
export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export const PAYMENT_METHODS = ['cash', 'bank', 'other'] as const;

/** SPEC §13 `payment`: append-only. */
export const paymentSchema = recordBaseSchema.extend({
  customerId: idSchema.nullable(),
  kind: z.enum(PAYMENT_KINDS),
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  method: z.enum(PAYMENT_METHODS),
  note: optionalTextSchema(500),
});
export type Payment = z.output<typeof paymentSchema>;

/**
 * SPEC §13 `payment_allocation`: the part of a payment applied to one sale, append-only. Its
 * capital and profit parts are derived (allocatePayment) until the period is locked (P10).
 */
export const paymentAllocationSchema = recordBaseSchema.extend({
  paymentId: idSchema,
  saleId: idSchema,
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
});
export type PaymentAllocation = z.output<typeof paymentAllocationSchema>;

/** A bad debt (SPEC §4.1, S5): the invoice is still owed but no longer expected. Append-only. */
export const writeOffSchema = recordBaseSchema.extend({
  saleId: idSchema,
  date: isoDateSchema,
  reason: z.string().trim().min(1).max(500),
});
export type WriteOff = z.output<typeof writeOffSchema>;
