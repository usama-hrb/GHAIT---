import { sql } from 'drizzle-orm';
import { bigint, date, jsonb, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/**
 * SPEC §13 `zakat_report`: the base on a hawl, item by item, and the settings it used
 * (BUILD_PROMPTS 5.1). Saved once; what is paid comes from its draws (Z7).
 */
export const zakatReport = pgTable(
  'zakat_report',
  {
    ...baseColumns('zakat_report'),
    hawlDate: date({ mode: 'string' }).notNull(),
    /** { pricePerGramCents, date }: the metal price the nisab was computed with. */
    metalPrice: jsonb().notNull(),
    nisabCents: bigint({ mode: 'number' }).notNull(),
    baseCents: bigint({ mode: 'number' }).notNull(),
    zakatDueCents: bigint({ mode: 'number' }).notNull(),
    /** The zakat settings it was computed with (zakatSettingsSchema). */
    settings: jsonb().notNull(),
    /** Every item of the base (zakatBreakdownSchema). */
    breakdown: jsonb().notNull(),
  },
  (table) => [
    uniqueIndex('zakat_report_live_hawl_key')
      .on(table.hawlDate)
      .where(sql`${table.voidedAt} IS NULL`),
  ],
);
