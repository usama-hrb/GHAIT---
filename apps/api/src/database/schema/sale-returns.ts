import type { ReturnLine } from '@fabric/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { payment } from './payments.js';
import { sale } from './sales.js';

/**
 * SPEC §13 `sale_return`: goods a customer gave back from one sale (BUILD_PROMPTS 5.3, RT1).
 * Append-only: a return is final; the length it restores is its `return` stock moves, the cash
 * handed back is its `refund` payment.
 */
export const saleReturn = pgTable(
  'sale_return',
  {
    ...baseColumns('sale_return'),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    date: date({ mode: 'string' }).notNull(),
    reason: text().notNull(),
    /** Each line given back, with the stock move that restores it (returnLineSchema). */
    lines: jsonb().$type<ReturnLine[]>().notNull(),
    creditCents: bigint({ mode: 'number' }).notNull(),
    refundId: uuid().references(() => payment.id),
  },
  (table) => [
    index('sale_return_sale_idx').on(table.saleId),
    check('sale_return_credit_valid', sql`${table.creditCents} >= 0`),
  ],
);
