import { AUDIT_ACTIONS } from '@fabric/contracts';
import { index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { appUser } from './auth.js';
import { baseColumns, timestamptz } from './columns.js';

export const auditAction = pgEnum('audit_action', AUDIT_ACTIONS);

/** Append-only (trigger `reject_update`): who, when, entity, id, action, before, after, reason. */
export const auditLog = pgTable(
  'audit_log',
  {
    ...baseColumns('audit_log'),
    at: timestamptz().notNull().defaultNow(),
    /** null for changes made by a CLI or the system. */
    actorId: uuid().references(() => appUser.id),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: auditAction().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    requestId: text(),
  },
  (table) => [index('audit_log_entity_idx').on(table.entity, table.entityId)],
);
