import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { supplier } from './catalog.js';
import { baseColumns } from './columns.js';
import { paymentMethod } from './payments.js';
import { purchase } from './purchasing.js';

/**
 * SPEC §13 `supplier_payment`: money paid to a supplier for what a purchase left owing
 * (BUILD_PROMPTS 5.3, SP3). Created, or voided with a reason; never edited.
 */
export const supplierPayment = pgTable(
  'supplier_payment',
  {
    ...baseColumns('supplier_payment'),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    purchaseId: uuid().references(() => purchase.id),
    amountCents: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    method: paymentMethod().notNull(),
    note: text(),
  },
  (table) => [
    index('supplier_payment_supplier_idx').on(table.supplierId),
    check('supplier_payment_amount_positive', sql`${table.amountCents} > 0`),
  ],
);
