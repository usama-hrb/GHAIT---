import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/**
 * SPEC §13 `cash_adjustment`: a count of the shop's money against the records (BUILD_PROMPTS
 * 4.4). Created or voided, never edited; its difference is cash over/short of its period (I2).
 */
export const cashAdjustment = pgTable(
  'cash_adjustment',
  {
    ...baseColumns('cash_adjustment'),
    date: date({ mode: 'string' }).notNull(),
    expectedCents: bigint({ mode: 'number' }).notNull(),
    countedCents: bigint({ mode: 'number' }).notNull(),
    diffCents: bigint({ mode: 'number' }).notNull(),
    note: text(),
  },
  (table) => [
    index('cash_adjustment_date_idx').on(table.date),
    check('cash_adjustment_counted_not_negative', sql`${table.countedCents} >= 0`),
    check(
      'cash_adjustment_diff_valid',
      sql`${table.diffCents} = ${table.countedCents} - ${table.expectedCents}`,
    ),
  ],
);
