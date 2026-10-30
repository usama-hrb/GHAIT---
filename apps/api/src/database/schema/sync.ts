import { bigint, index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { appUser } from './auth.js';
import { baseColumns } from './columns.js';

/** What happened to a pushed op; `duplicate` is never stored (it is this row, found again). */
export const syncOpStatus = pgEnum('sync_op_status', ['applied', 'conflict', 'rejected']);

/**
 * Every op a device pushed, keyed by its opId (= id): pushing it again returns this result
 * instead of applying it twice. Append-only.
 */
export const syncOp = pgTable('sync_op', {
  ...baseColumns('sync_op'),
  entity: text().notNull(),
  entityId: uuid().notNull(),
  kind: text().notNull(),
  status: syncOpStatus().notNull(),
  /** server_seq of the record's version after this op (applied/conflict). */
  resultServerSeq: bigint({ mode: 'number' }),
  error: jsonb(),
  actorId: uuid().references(() => appUser.id),
});

/**
 * The losing side of every last-write-wins conflict (ADR 0002), for the read-only conflict
 * screen (BUILD_PROMPTS 3.6). Append-only.
 */
export const syncConflict = pgTable(
  'sync_conflict',
  {
    ...baseColumns('sync_conflict'),
    opId: uuid().notNull(),
    entity: text().notNull(),
    entityId: uuid().notNull(),
    /** `incoming`: the pushed change won and replaced the server's; `server`: it lost. */
    winner: text().notNull(),
    loser: jsonb().notNull(),
    winnerRecord: jsonb().notNull(),
  },
  (table) => [index('sync_conflict_entity_idx').on(table.entity, table.entityId)],
);

/**
 * The server's data set (ADR 0002, BUILD_PROMPTS 3.6): the newest row's id is the epoch every
 * pull reports. A restore (backup or export) adds a row, so devices know to pull from 0 again.
 * Append-only.
 */
export const serverInstance = pgTable('server_instance', {
  ...baseColumns('server_instance'),
});
