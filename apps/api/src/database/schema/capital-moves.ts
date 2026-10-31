import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { CAPITAL_MOVE_TYPES } from '@fabric/contracts';
import { baseColumns } from './columns.js';
import { partner } from './partners.js';
import { settlement } from './settlements.js';

export const capitalMoveType = pgEnum('capital_move_type', CAPITAL_MOVE_TYPES);

/**
 * SPEC §13 `capital_move`: created or voided, never edited (PA3). Retained profit comes only from
 * a settlement, and goes only with it.
 */
export const capitalMove = pgTable(
  'capital_move',
  {
    ...baseColumns('capital_move'),
    partnerId: uuid()
      .notNull()
      .references(() => partner.id),
    type: capitalMoveType().notNull(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    note: text(),
    settlementId: uuid().references(() => settlement.id),
  },
  (table) => [
    index('capital_move_partner_idx').on(table.partnerId),
    index('capital_move_settlement_idx').on(table.settlementId),
    check(
      'capital_move_sign_valid',
      sql`(${table.type} = 'withdrawal' AND ${table.amountCents} < 0) OR (${table.type} <> 'withdrawal' AND ${table.amountCents} > 0)`,
    ),
    check(
      'capital_move_retained_from_settlement',
      sql`(${table.type} = 'retained_profit') = (${table.settlementId} IS NOT NULL)`,
    ),
  ],
);
