import { ROLES } from '@fabric/contracts';
import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './columns.js';

/** SPEC §11: all three roles exist in the schema; only the owner is let in for now. */
export const userRole = pgEnum('user_role', ROLES);

export const appUser = pgTable('app_user', {
  ...baseColumns('app_user'),
  /** Lower-case (usernameSchema). */
  username: text().notNull().unique(),
  displayName: text().notNull(),
  /** argon2id, PHC string. Never leaves the API. */
  passwordHash: text().notNull(),
  passwordChangedAt: timestamptz().notNull().defaultNow(),
  role: userRole().notNull(),
});

/**
 * One refresh token. Using it rotates it: the row is marked `rotated_at` and a new row in the
 * same family takes over. Presenting a rotated or revoked token revokes the whole family
 * (refresh-token reuse detection).
 */
export const authSession = pgTable(
  'auth_session',
  {
    ...baseColumns('auth_session'),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    familyId: uuid().notNull(),
    /** sha256 of the token; the token itself is only ever in the client's cookie. */
    tokenHash: text().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    rotatedAt: timestamptz(),
    revokedAt: timestamptz(),
  },
  (table) => [index('auth_session_family_idx').on(table.familyId)],
);
