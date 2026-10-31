import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './columns.js';
import { partner } from './partners.js';
import { stockMove } from './purchasing.js';

/** The split rule's relative weights (S1). */
const weights = () => ({
  ownerWeight: integer().notNull(),
  partnerWeight: integer().notNull(),
  shopWeight: integer().notNull(),
});

/** SPEC §13 `profit_split_rule`: changed only while in the future (SPEC §8.3, BUILD_PROMPTS 4.3). */
export const profitSplitRule = pgTable(
  'profit_split_rule',
  {
    ...baseColumns('profit_split_rule'),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    ...weights(),
  },
  (table) => [
    uniqueIndex('profit_split_rule_live_date_key')
      .on(table.effectiveFrom)
      .where(sql`${table.voidedAt} IS NULL`),
    check(
      'profit_split_rule_weights_valid',
      sql`${table.ownerWeight} >= 0 AND ${table.partnerWeight} >= 0 AND ${table.shopWeight} >= 0 AND ${table.ownerWeight} + ${table.partnerWeight} + ${table.shopWeight} > 0`,
    ),
  ],
);

const cents = () => bigint({ mode: 'number' }).notNull();

/**
 * SPEC §13 `settlement`: one per period, written when the owner approves it. It locks the period;
 * unlocking voids it (the reason is in audit_log) with everything it created.
 */
export const settlement = pgTable(
  'settlement',
  {
    ...baseColumns('settlement'),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    recognizedProfitCents: cents(),
    recoveredBadDebtCents: cents(),
    damageCents: cents(),
    badDebtCents: cents(),
    belowCostCents: cents(),
    expensesCents: cents(),
    cashOverShortCents: cents(),
    carriedDeficitInCents: cents(),
    netProfitCents: cents(),
    ownerShareCents: cents(),
    partnerShareCents: cents(),
    shopShareCents: cents(),
    carryDeficitOutCents: cents(),
    /** The rule's weights it was settled with (S3). */
    ...weights(),
    lockedAt: timestamptz().notNull(),
  },
  (table) => [
    // Two live settlements never share a period end (the API also keeps periods contiguous).
    uniqueIndex('settlement_live_period_end_key')
      .on(table.periodEnd)
      .where(sql`${table.voidedAt} IS NULL`),
    check('settlement_period_valid', sql`${table.periodEnd} >= ${table.periodStart}`),
  ],
);

/** A partner's share of a settlement: their balance entry (SPEC §8.1). */
export const settlementShare = pgTable(
  'settlement_share',
  {
    ...baseColumns('settlement_share'),
    settlementId: uuid()
      .notNull()
      .references(() => settlement.id),
    partnerId: uuid()
      .notNull()
      .references(() => partner.id),
    amountCents: cents(),
  },
  (table) => [
    index('settlement_share_settlement_idx').on(table.settlementId),
    index('settlement_share_partner_idx').on(table.partnerId),
    check('settlement_share_amount_positive', sql`${table.amountCents} > 0`),
  ],
);

/** The cost a settlement froze for a sale or loss move it counted (P9). */
export const lockedCost = pgTable(
  'locked_cost',
  {
    ...baseColumns('locked_cost'),
    settlementId: uuid()
      .notNull()
      .references(() => settlement.id),
    stockMoveId: uuid()
      .notNull()
      .references(() => stockMove.id),
    costCents: cents(),
  },
  (table) => [
    index('locked_cost_settlement_idx').on(table.settlementId),
    uniqueIndex('locked_cost_live_move_key')
      .on(table.stockMoveId)
      .where(sql`${table.voidedAt} IS NULL`),
    check('locked_cost_not_negative', sql`${table.costCents} >= 0`),
  ],
);
