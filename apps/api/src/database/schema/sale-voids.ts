import { date, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { payment } from './payments.js';
import { sale } from './sales.js';

/** A sale's cancellation (P13): append-only, one per sale. */
export const saleVoid = pgTable('sale_void', {
  ...baseColumns('sale_void'),
  saleId: uuid()
    .notNull()
    .unique()
    .references(() => sale.id),
  date: date({ mode: 'string' }).notNull(),
  reason: text().notNull(),
  refundId: uuid().references(() => payment.id),
});
