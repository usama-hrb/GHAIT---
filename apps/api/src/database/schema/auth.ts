import { ROLES } from '@fabric/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './columns.js';
import { partner } from './partners.js';

/** SPEC §11: all three roles exist in the schema; only the owner is let in for now. */
export const userRole = pgEnum('user_role', ROLES);

export const appUser = pgTable(
  'app_user',
  {
    ...baseColumns('app_user'),
    /** Lower-case (usernameSchema): a short name, or the email address an owner signed up with. */
    username: text().notNull().unique(),
    displayName: text().notNull(),
    /** argon2id, PHC string. Never leaves the API. */
    passwordHash: text().notNull(),
    passwordChangedAt: timestamptz().notNull().defaultNow(),
    role: userRole().notNull(),
    /**
     * The partner a partner account belongs to (ADR 0024); null for every other role. A login
     * is not a business record: this only says whose login it is. Nothing here changes what the
     * partner owns, is owed or may do with the shop's money.
     */
    partnerId: uuid().references(() => partner.id),
    /**
     * When the account was switched off (ADR 0024); null while it is on. A switched-off account
     * cannot sign in and its tokens stop working at once. Reversible, unlike `voided_at`, and
     * nothing it is linked to is touched.
     */
    deactivatedAt: timestamptz(),
    /** The password is one the owner generated: the account chooses its own at its first sign-in. */
    mustChangePassword: boolean().notNull().default(false),
  },
  (table) => [
    // One shop, one owner (ADR 0023): the database refuses a second one, so two sign-ups that
    // race each other cannot both succeed.
    uniqueIndex('app_user_single_owner')
      .on(table.role)
      .where(sql`${table.role} = 'owner' AND ${table.voidedAt} IS NULL`),
    // At most one active account per partner (ADR 0024). Two requests creating one at the same
    // time cannot both succeed; this index is the guarantee, the checks before the insert only
    // give the better message.
    uniqueIndex('app_user_one_active_partner_account')
      .on(table.partnerId)
      .where(
        sql`${table.partnerId} IS NOT NULL AND ${table.deactivatedAt} IS NULL AND ${table.voidedAt} IS NULL`,
      ),
    // Only a partner account links to a partner, and an active one always does.
    check(
      'app_user_partner_link_role',
      sql`${table.role} = 'partner' OR ${table.partnerId} IS NULL`,
    ),
    check(
      'app_user_active_partner_linked',
      sql`${table.role} <> 'partner' OR ${table.partnerId} IS NOT NULL OR ${table.deactivatedAt} IS NOT NULL OR ${table.voidedAt} IS NOT NULL`,
    ),
  ],
);

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
