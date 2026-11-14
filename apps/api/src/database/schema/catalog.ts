import { PRODUCT_SELLING_UNITS, PRODUCT_UNITS, type ProductSellingUnit } from '@fabric/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

export const productUnit = pgEnum('product_unit', PRODUCT_UNITS);
export const productConversionSource = pgEnum('product_conversion_source', [
  'estimated',
  'measured',
]);

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

/** Product identity is independent from legacy fabric and variant records. */
export const product = pgTable(
  'product',
  {
    ...baseColumns('product'),
    name: text().notNull(),
    sku: text(),
    description: text(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    purchaseUnits: productUnit()
      .array()
      .notNull()
      .default(sql`'{}'::product_unit[]`),
    // The CHECK below keeps weight out of it; the column is the shared enum.
    sellingUnits: productUnit().array().$type<ProductSellingUnit[]>().notNull(),
    kgToMeterWeightG: integer(),
    kgToMeterLengthCm: integer(),
    kgToMeterSource: productConversionSource(),
    pricePerMeterCents: bigint('price_per_m_cents', { mode: 'number' }),
    minPricePerMeterCents: bigint('min_price_per_m_cents', { mode: 'number' }),
    pricePerPieceCents: bigint('price_per_piece_cents', { mode: 'number' }),
    minPricePerPieceCents: bigint('min_price_per_piece_cents', { mode: 'number' }),
    lowStockThreshold: integer(),
    // The suppliers the shop buys it from. No foreign key: an array has none, and a supplier is
    // only ever cancelled, never removed, so an id here always keeps its row.
    supplierIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    active: boolean().notNull().default(true),
  },
  (table) => [
    index('product_name_idx').on(table.name),
    check('product_name_valid', sql`length(trim(${table.name})) > 0`),
    check('product_units_valid', sql`cardinality(${table.sellingUnits}) > 0`),
    check(
      'product_selling_units_valid',
      sql`${table.sellingUnits} <@ ARRAY[${sql.raw(PRODUCT_SELLING_UNITS.map((unit) => `'${unit}'`).join(', '))}]::product_unit[]`,
    ),
    check(
      'product_conversion_valid',
      sql`(${table.kgToMeterWeightG} IS NULL AND ${table.kgToMeterLengthCm} IS NULL AND ${table.kgToMeterSource} IS NULL)
        OR (${table.kgToMeterWeightG} > 0 AND ${table.kgToMeterLengthCm} > 0 AND ${table.kgToMeterSource} IS NOT NULL)`,
    ),
  ],
);
