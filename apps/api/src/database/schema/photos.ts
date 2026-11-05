import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { product, variant } from './catalog.js';
import { baseColumns } from './columns.js';

/**
 * A colour's picture (ADR 0009): a small JPEG, base64, created once and voided when the colour
 * gets another. Synced, mutable only for its void.
 */
export const photo = pgTable(
  'photo',
  {
    ...baseColumns('photo'),
    // The colour a picture was made for (history). New pictures belong to a product (ADR 0012).
    variantId: uuid().references(() => variant.id),
    productId: uuid().references(() => product.id),
    contentType: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    byteLength: integer().notNull(),
    data: text().notNull(),
  },
  (table) => [
    index('photo_variant_idx').on(table.variantId),
    index('photo_product_idx').on(table.productId),
    // The same rules as @fabric/contracts photoSchema, as a last line of defence.
    check('photo_jpeg', sql`${table.contentType} = 'image/jpeg'`),
    check(
      'photo_size_valid',
      sql`${table.width} > 0 AND ${table.height} > 0 AND ${table.byteLength} > 0 AND ${table.byteLength} <= 250000`,
    ),
  ],
);
