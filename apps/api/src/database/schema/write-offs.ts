import { date, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { sale } from './sales.js';

/** A bad debt (SPEC §4.1, S5): append-only, one per sale. */
export const writeOff = pgTable('write_off', {
  ...baseColumns('write_off'),
  saleId: uuid()
    .notNull()
    .unique()
    .references(() => sale.id),
  date: date({ mode: 'string' }).notNull(),
  reason: text().notNull(),
});
