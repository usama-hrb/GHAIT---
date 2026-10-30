import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { PAYMENT_KINDS, PAYMENT_METHODS } from '@fabric/contracts';
import { baseColumns } from './columns.js';
import { customer } from './customers.js';
import { sale } from './sales.js';

export const paymentKind = pgEnum('payment_kind', PAYMENT_KINDS);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);

/** SPEC §13 `payment`: append-only. A refund gives money back (docs/accounting-assumptions.md P13). */
export const payment = pgTable(
  'payment',
  {
    ...baseColumns('payment'),
    customerId: uuid().references(() => customer.id),
    kind: paymentKind().notNull(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    method: paymentMethod().notNull(),
    note: text(),
  },
  (table) => [
    index('payment_customer_idx').on(table.customerId),
    check('payment_amount_positive', sql`${table.amountCents} > 0`),
  ],
);

/** SPEC §13 `payment_allocation`: append-only; capital and profit parts are derived (P10). */
export const paymentAllocation = pgTable(
  'payment_allocation',
  {
    ...baseColumns('payment_allocation'),
    paymentId: uuid()
      .notNull()
      .references(() => payment.id),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    amountCents: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
  },
  (table) => [
    index('payment_allocation_payment_idx').on(table.paymentId),
    index('payment_allocation_sale_idx').on(table.saleId),
    check('payment_allocation_amount_positive', sql`${table.amountCents} > 0`),
  ],
);
