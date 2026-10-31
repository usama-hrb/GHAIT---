import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/** SPEC §13 `partner`: the owner and the partner (SPEC §6). */
export const partner = pgTable(
  'partner',
  {
    ...baseColumns('partner'),
    name: text().notNull(),
    ownershipBp: integer().notNull(),
    isOwner: boolean().notNull(),
  },
  (table) => [check('partner_ownership_valid', sql`${table.ownershipBp} BETWEEN 0 AND 10000`)],
);

/** SPEC §13 `partner_draw`: created or voided, never edited (PA3). */
export const partnerDraw = pgTable(
  'partner_draw',
  {
    ...baseColumns('partner_draw'),
    partnerId: uuid()
      .notNull()
      .references(() => partner.id),
    amountCents: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    reason: text().notNull(),
  },
  (table) => [
    index('partner_draw_partner_idx').on(table.partnerId),
    check('partner_draw_amount_positive', sql`${table.amountCents} > 0`),
  ],
);
