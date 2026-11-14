import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from '../schema/columns.js';

/**
 * The control database (ADR 0029): the few facts the server needs to find and run its shops. It
 * lives in a database of its own, next to the shops' databases, and holds no shop data: no money,
 * customer or product. These tables are not synced, so they have no `server_seq` or `device_id`;
 * they follow the rest of the data rules otherwise. Nothing is deleted (a shop is closed, an
 * address is released), and what identifies a row never changes. Both are enforced by the guards
 * of migration 0001, `install_control_guards`; test/control-database.e2e-spec.ts fails for a
 * table without them.
 */

/**
 * What a slug and an address may look like: the same patterns as the CHECK constraints below, so a
 * command refuses a bad one with a message instead of a constraint error. A few names are also
 * refused as a slug: `all` (`make migrate SHOP=all` means every shop) and the names that an
 * address or a page of this server may use.
 */
export const SHOP_SLUG_PATTERN = /^[a-z][a-z0-9_]{2,30}$/;
export const SHOP_HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
export const RESERVED_SHOP_SLUGS = ['all', 'www', 'api', 'app', 'admin', 'control'] as const;

export const SHOP_STATES = ['provisioning', 'active', 'suspended', 'closed'] as const;
export type ShopState = (typeof SHOP_STATES)[number];

/**
 * provisioning: being made, not served yet. active: served. suspended: refused with 403, data
 * kept. closed: over for good; its address stops answering and its database stays on the server.
 */
export const shopState = pgEnum('shop_state', SHOP_STATES);

export const shop = pgTable(
  'shop',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The short name the operator types (`SHOP=<slug>`). Never changes. */
    slug: text().notNull().unique('shop_slug_key'),
    /** The shop's PostgreSQL database on this server. Never changes. */
    dbName: text().notNull().unique('shop_db_name_key'),
    state: shopState().notNull().default('provisioning'),
    /** The operator's own note about the shop. Never shown to the shop. */
    label: text().notNull().default(''),
    suspendedAt: timestamptz(),
    suspendedReason: text(),
    closedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    /** Set by the database on every update. */
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    // `CREATE DATABASE` takes no parameters, so these names are never built from anything else.
    // The same patterns are DATABASE_NAME_PATTERN (config/env.ts) and the shop-slug rule of ADR 0029.
    check('shop_slug_valid', sql`${table.slug} ~ '^[a-z][a-z0-9_]{2,30}$'`),
    check('shop_db_name_valid', sql`${table.dbName} ~ '^[a-z][a-z0-9_]{2,62}$'`),
    check(
      'shop_suspension_dated',
      sql`${table.state} <> 'suspended' OR ${table.suspendedAt} IS NOT NULL`,
    ),
    check('shop_closure_dated', sql`${table.state} <> 'closed' OR ${table.closedAt} IS NOT NULL`),
  ],
);

/**
 * One address of a shop; a shop may have several (a bare IP, a host name, a custom domain). An
 * address belongs to one shop for as long as it is in use, and it is released, never moved.
 */
export const shopHost = pgTable(
  'shop_host',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** What `req.hostname` gives: a DNS name or an IPv4 address, lower case, no port, no final dot. */
    host: text().notNull(),
    shopId: uuid()
      .notNull()
      .references(() => shop.id),
    createdAt: timestamptz().notNull().defaultNow(),
    /** Set when the address stops answering for this shop; the row stays. */
    releasedAt: timestamptz(),
  },
  (table) => [
    // Among the addresses in use, a host name belongs to one shop.
    uniqueIndex('shop_host_live_host')
      .on(table.host)
      .where(sql`${table.releasedAt} IS NULL`),
    check('shop_host_valid', sql`${table.host} ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'`),
  ],
);

/**
 * A one-time code that lets the first owner of a new shop sign up (ADR 0029). Only a hash of it is
 * kept: the code itself is shown once, on the operator's terminal.
 */
export const shopSetupCode = pgTable(
  'shop_setup_code',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shop.id),
    /** An HMAC of the code made with a secret of the server, never the code. */
    codeHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    /** Set when the operator made a newer code for the shop: this one stops working; the row stays. */
    revokedAt: timestamptz(),
    failedTries: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [check('shop_setup_code_tries_valid', sql`${table.failedTries} >= 0`)],
);

/** What the operator did, one row each. Append-only. */
export const shopEvent = pgTable('shop_event', {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamptz().notNull().defaultNow(),
  /** The shop it is about; null for an event about the server as a whole. */
  shopId: uuid().references(() => shop.id),
  /** Who did it: the operator's login on the server, or 'api'. */
  actor: text().notNull(),
  /** What was done, e.g. 'shop.suspended'. */
  action: text().notNull(),
  /** Facts about it (the reason, the address). Never a secret, a code or a password. */
  detail: jsonb().notNull().default({}),
});
