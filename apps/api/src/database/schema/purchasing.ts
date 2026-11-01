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
import { PURCHASE_METHODS, ROLL_STATUSES, STOCK_MOVE_TYPES } from '@fabric/contracts';
import { supplier, variant } from './catalog.js';
import { baseColumns } from './columns.js';

export const purchaseMethod = pgEnum('purchase_method', PURCHASE_METHODS);
export const rollStatus = pgEnum('roll_status', ROLL_STATUSES);
export const stockMoveType = pgEnum('stock_move_type', STOCK_MOVE_TYPES);

/** SPEC §13 `purchase`; created with its rolls and moves in one op (BUILD_PROMPTS 3.2). */
export const purchase = pgTable(
  'purchase',
  {
    ...baseColumns('purchase'),
    date: date({ mode: 'string' }).notNull(),
    supplierId: uuid().references(() => supplier.id),
    method: purchaseMethod().notNull(),
    pricePerMeterCents: bigint('price_per_m_cents', { mode: 'number' }),
    weightG: integer(),
    estCmPerKg: integer(),
    totalCostCents: bigint({ mode: 'number' }).notNull(),
    paidCents: bigint({ mode: 'number' }).notNull(),
    notes: text(),
  },
  (table) => [
    index('purchase_date_idx').on(table.date),
    // Paid in full, or part paid with the rest owed to the supplier (SP1).
    check(
      'purchase_paid_valid',
      sql`${table.paidCents} >= 0 AND ${table.paidCents} <= ${table.totalCostCents}`,
    ),
  ],
);

/** SPEC §13 `roll`: the stock unit. Remaining length is derived from its stock moves. */
export const roll = pgTable(
  'roll',
  {
    ...baseColumns('roll'),
    shortCode: text().notNull().unique(),
    variantId: uuid()
      .notNull()
      .references(() => variant.id),
    purchaseId: uuid()
      .notNull()
      .references(() => purchase.id),
    lengthCmInitial: integer().notNull(),
    costTotalCents: bigint({ mode: 'number' }).notNull(),
    lengthEstimated: boolean().notNull(),
    status: rollStatus().notNull(),
  },
  (table) => [
    index('roll_variant_idx').on(table.variantId),
    index('roll_purchase_idx').on(table.purchaseId),
    check('roll_values_valid', sql`${table.lengthCmInitial} > 0 AND ${table.costTotalCents} >= 0`),
  ],
);

/** SPEC §13 `stock_move`: append-only; corrections are new moves. */
export const stockMove = pgTable(
  'stock_move',
  {
    ...baseColumns('stock_move'),
    rollId: uuid()
      .notNull()
      .references(() => roll.id),
    type: stockMoveType().notNull(),
    deltaCm: integer().notNull(),
    refId: uuid(),
    date: date({ mode: 'string' }).notNull(),
    note: text(),
  },
  (table) => [index('stock_move_roll_idx').on(table.rollId)],
);
