import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { customer } from './customers.js';
import { roll } from './purchasing.js';

/** SPEC §13 `sale`: created with its lines, moves and payment in one op (BUILD_PROMPTS 3.4). */
export const sale = pgTable(
  'sale',
  {
    ...baseColumns('sale'),
    date: date({ mode: 'string' }).notNull(),
    customerId: uuid().references(() => customer.id),
    totalCents: bigint({ mode: 'number' }).notNull(),
    discountCents: bigint({ mode: 'number' }).notNull(),
    dueDate: date({ mode: 'string' }),
    confirmedBelowCost: boolean().notNull(),
    note: text(),
  },
  (table) => [
    index('sale_date_idx').on(table.date),
    index('sale_customer_idx').on(table.customerId),
    check('sale_amounts_valid', sql`${table.totalCents} >= 0 AND ${table.discountCents} >= 0`),
  ],
);

/** SPEC §13 `sale_line`: append-only. Its cost is derived from the roll's moves (P9). */
export const saleLine = pgTable(
  'sale_line',
  {
    ...baseColumns('sale_line'),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    rollId: uuid()
      .notNull()
      .references(() => roll.id),
    soldCm: integer().notNull(),
    refPricePerMeterCents: bigint('ref_price_per_m_cents', { mode: 'number' }).notNull(),
    minPricePerMeterCents: bigint('min_price_per_m_cents', { mode: 'number' }).notNull(),
    actualPricePerMeterCents: bigint('actual_price_per_m_cents', { mode: 'number' }).notNull(),
    wholePiece: boolean().notNull(),
    lineTotalCents: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    index('sale_line_sale_idx').on(table.saleId),
    index('sale_line_roll_idx').on(table.rollId),
    check('sale_line_values_valid', sql`${table.soldCm} > 0 AND ${table.lineTotalCents} >= 0`),
  ],
);
