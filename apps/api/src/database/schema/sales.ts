import { PRODUCT_SELLING_UNITS } from '@fabric/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { customer } from './customers.js';
import { roll } from './purchasing.js';
import { productBatch } from './stock.js';

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

/** What a sale line counts and is priced in: meters (cm) or pieces. */
export const saleUnit = pgEnum('sale_unit', PRODUCT_SELLING_UNITS);

/**
 * SPEC §13 `sale_line`: append-only. Its cost is derived from the batch's moves (P9). Lines sold
 * before ADR 0012 were priced on rolls: their `roll_id`, `sold_cm` and per-meter price columns
 * stay as they were written (history); `batch_id` (the roll's id), `quantity` and the prices
 * below hold the same facts for every line, old or new.
 */
export const saleLine = pgTable(
  'sale_line',
  {
    ...baseColumns('sale_line'),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    batchId: uuid()
      .notNull()
      .references(() => productBatch.id),
    unit: saleUnit().notNull(),
    quantity: integer().notNull(),
    refPriceCents: bigint({ mode: 'number' }).notNull(),
    minPriceCents: bigint({ mode: 'number' }).notNull(),
    actualPriceCents: bigint({ mode: 'number' }).notNull(),
    wholePiece: boolean().notNull(),
    lineTotalCents: bigint({ mode: 'number' }).notNull(),
    /** The owner who confirmed selling this line under the minimum price (ADR 0012). */
    minOverrideBy: text(),
    /** Legacy (before ADR 0012): the roll, the length and the per-meter prices as first written. */
    rollId: uuid().references(() => roll.id),
    soldCm: integer(),
    refPricePerMeterCents: bigint('ref_price_per_m_cents', { mode: 'number' }),
    minPricePerMeterCents: bigint('min_price_per_m_cents', { mode: 'number' }),
    actualPricePerMeterCents: bigint('actual_price_per_m_cents', { mode: 'number' }),
  },
  (table) => [
    index('sale_line_sale_idx').on(table.saleId),
    index('sale_line_batch_idx').on(table.batchId),
    check('sale_line_values_valid', sql`${table.quantity} > 0 AND ${table.lineTotalCents} >= 0`),
    check(
      'sale_line_override_named',
      sql`${table.minOverrideBy} IS NULL OR length(btrim(${table.minOverrideBy})) > 0`,
    ),
  ],
);
