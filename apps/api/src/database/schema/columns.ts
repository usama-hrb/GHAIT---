import { sql } from 'drizzle-orm';
import { bigint, pgSequence, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * One sequence shared by every table, so `GET /sync/pull?since=<server_seq>` is a single cursor
 * (ADR 0002). Insert and update both take a new value (trigger `set_server_seq`). Sequence values
 * are handed out before commit, so the sync pull (BUILD_PROMPTS 3.1) must not move its cursor past
 * a value whose transaction may still be open.
 */
export const serverSeq = pgSequence('server_seq');

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * Columns every table has (CLAUDE.md "Data rules"). `id` may come from the client; `updated_at`
 * is written by whoever changed the row (the device's clock, for last-write-wins in sync). There
 * is no hard delete: cancelling sets `voided_at`, and the reason goes to audit_log. Every table
 * also gets the row guards (`install_row_guards`, migration 0001).
 */
export const baseColumns = (table: string) => ({
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz().notNull().defaultNow(),
  deviceId: text().notNull(),
  voidedAt: timestamptz(),
  serverSeq: bigint({ mode: 'number' })
    .notNull()
    .unique(`${table}_server_seq_key`)
    .default(sql`nextval('server_seq')`),
});
