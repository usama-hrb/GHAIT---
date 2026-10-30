import { pgTable, text } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/** SPEC §13 `customer`; the balance is derived from sales and payments (SPEC §4.1). */
export const customer = pgTable('customer', {
  ...baseColumns('customer'),
  name: text().notNull(),
  phone: text(),
  notes: text(),
});
