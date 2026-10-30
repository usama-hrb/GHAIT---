import { date, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/**
 * SPEC §13 `setting key, value, effective_from?`. One row per value and start date; the value
 * in effect on a day is the row with the latest effective_from on or before it (null = since
 * always). A key with no row has its default (@fabric/contracts SETTINGS).
 */
export const setting = pgTable(
  'setting',
  {
    ...baseColumns('setting'),
    key: text().notNull(),
    value: jsonb().notNull(),
    effectiveFrom: date({ mode: 'string' }),
  },
  (table) => [
    unique('setting_key_effective_from_key').on(table.key, table.effectiveFrom).nullsNotDistinct(),
  ],
);
