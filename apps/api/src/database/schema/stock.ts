import { BATCH_STATUSES, PRODUCT_STOCK_MOVE_TYPES } from '@fabric/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { product, productConversionSource, productUnit } from './catalog.js';
import { baseColumns } from './columns.js';
import { purchase } from './purchasing.js';

export const batchStatus = pgEnum('batch_status', BATCH_STATUSES);
export const productStockMoveType = pgEnum('product_stock_move_type', PRODUCT_STOCK_MOVE_TYPES);

/**
 * The shop's stock (ADR 0012): what one purchase of one product brought in, in the unit it was
 * bought in. Created with its purchase; afterwards only the remnant mark changes. What is left,
 * what it cost and what waits for a measurement are derived from its moves, never stored.
 */
export const productBatch = pgTable(
  'product_batch',
  {
    ...baseColumns('product_batch'),
    code: text().notNull().unique(),
    productId: uuid()
      .notNull()
      .references(() => product.id),
    purchaseId: uuid()
      .notNull()
      .references(() => purchase.id),
    purchaseDate: date({ mode: 'string' }).notNull(),
    unit: productUnit().notNull(),
    receivedQuantity: bigint({ mode: 'number' }).notNull(),
    costTotalCents: bigint({ mode: 'number' }).notNull(),
    conversionWeightG: integer(),
    conversionLengthCm: integer(),
    conversionSource: productConversionSource(),
    status: batchStatus().notNull(),
  },
  (table) => [
    index('product_batch_product_idx').on(table.productId),
    index('product_batch_purchase_idx').on(table.purchaseId),
    check(
      'product_batch_values_valid',
      sql`${table.receivedQuantity} > 0 AND ${table.costTotalCents} >= 0`,
    ),
    check(
      'product_batch_conversion_valid',
      sql`(${table.conversionWeightG} IS NULL AND ${table.conversionLengthCm} IS NULL AND ${table.conversionSource} IS NULL)
        OR (${table.conversionWeightG} > 0 AND ${table.conversionLengthCm} > 0 AND ${table.conversionSource} IS NOT NULL)`,
    ),
    check(
      'product_batch_piece_valid',
      sql`${table.unit} <> 'piece' OR ${table.conversionWeightG} IS NULL`,
    ),
  ],
);

/** SPEC §13 `stock_move`, per batch: append-only; a correction is a new move. */
export const productStockMove = pgTable(
  'product_stock_move',
  {
    ...baseColumns('product_stock_move'),
    batchId: uuid()
      .notNull()
      .references(() => productBatch.id),
    type: productStockMoveType().notNull(),
    unit: productUnit().notNull(),
    /** Signed cm, g or pieces by `unit`; a measurement carries the batch's whole length (cm). */
    delta: bigint({ mode: 'number' }).notNull(),
    refId: uuid(),
    date: date({ mode: 'string' }).notNull(),
    note: text(),
    actor: text(),
  },
  (table) => [
    index('product_stock_move_batch_idx').on(table.batchId),
    index('product_stock_move_ref_idx').on(table.refId),
  ],
);
