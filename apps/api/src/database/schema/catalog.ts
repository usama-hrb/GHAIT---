import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/** SPEC §13 `supplier`. Synced, mutable (last write wins). */
export const supplier = pgTable('supplier', {
  ...baseColumns('supplier'),
  name: text().notNull(),
  phone: text(),
  notes: text(),
});

/** SPEC §13 `fabric` (the model: روزا). Money in integer cents (bigint). */
export const fabric = pgTable(
  'fabric',
  {
    ...baseColumns('fabric'),
    name: text().notNull(),
    type: text(),
    defaultSupplierId: uuid().references(() => supplier.id),
    refPricePerMeterCents: bigint('ref_price_per_m_cents', { mode: 'number' }).notNull(),
    minPricePerMeterCents: bigint('min_price_per_m_cents', { mode: 'number' }).notNull(),
    estCmPerKg: integer(),
    sellableAsPiece: boolean().notNull().default(false),
    piecePriceCents: bigint({ mode: 'number' }),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text(),
  },
  (table) => [
    // The same rules as @fabric/contracts fabricSchema, as a last line of defence.
    check(
      'fabric_prices_valid',
      sql`${table.minPricePerMeterCents} >= 0 AND ${table.minPricePerMeterCents} <= ${table.refPricePerMeterCents}`,
    ),
    check(
      'fabric_piece_price_valid',
      sql`NOT ${table.sellableAsPiece} OR ${table.piecePriceCents} >= 0`,
    ),
  ],
);

/** SPEC §13 `variant` (the colour: روزا أحمر). */
export const variant = pgTable(
  'variant',
  {
    ...baseColumns('variant'),
    fabricId: uuid()
      .notNull()
      .references(() => fabric.id),
    colorName: text().notNull(),
    lowStockThresholdCm: integer().notNull(),
  },
  (table) => [
    index('variant_fabric_idx').on(table.fabricId),
    check('variant_threshold_valid', sql`${table.lowStockThresholdCm} >= 0`),
  ],
);
