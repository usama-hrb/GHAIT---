import { Logger } from '@nestjs/common';
import { asc, ne } from 'drizzle-orm';
import type { AppConfig } from '../config/index.js';
import { createPool } from './client.js';
import { controlDatabaseUrl, createControlDb } from './control/connection.js';
import * as controlSchema from './control/schema.js';
import { databaseExists } from './create-database.js';
import { withDatabase } from './database-url.js';
import { runMigrations } from './migrate.js';

const logger = new Logger('Migrations');

export interface ShopMigration {
  readonly slug: string;
  /** `skipped`: a shop being made whose database is not there yet, so there is nothing to migrate. */
  readonly outcome: 'migrated' | 'skipped' | 'failed';
  readonly milliseconds: number;
  /** Why it failed or was skipped. */
  readonly reason?: string;
}

interface OpenShop {
  readonly slug: string;
  readonly dbName: string;
  readonly state: controlSchema.ShopState;
}

/** The shops to migrate: every one that is not closed, in the order they were made. */
async function openShops(config: AppConfig, only: string | undefined): Promise<OpenShop[]> {
  const pool = createPool(controlDatabaseUrl(config), { max: 1 });
  try {
    const shops = await createControlDb(pool)
      .select({
        slug: controlSchema.shop.slug,
        dbName: controlSchema.shop.dbName,
        state: controlSchema.shop.state,
      })
      .from(controlSchema.shop)
      .where(ne(controlSchema.shop.state, 'closed'))
      .orderBy(asc(controlSchema.shop.createdAt), asc(controlSchema.shop.slug));
    if (only === undefined) return shops;
    const found = shops.filter((shop) => shop.slug === only);
    if (found.length === 0) throw new Error(`There is no open shop "${only}"`);
    return found;
  } finally {
    await pool.end();
  }
}

/** What went wrong, in one line: the database's own message, not the whole statement Drizzle puts in its error. */
export function reasonOf(error: unknown): string {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function migrateShop(config: AppConfig, shop: OpenShop): Promise<ShopMigration> {
  const started = performance.now();
  const done = (outcome: ShopMigration['outcome'], reason?: string): ShopMigration => ({
    slug: shop.slug,
    outcome,
    milliseconds: Math.round(performance.now() - started),
    ...(reason === undefined ? {} : { reason }),
  });
  try {
    // A shop that is being made may not have its database yet: `shop-new` makes it, then migrates it.
    if (shop.state === 'provisioning' && !(await databaseExists(config.databaseUrl, shop.dbName))) {
      logger.log(`Shop "${shop.slug}" is being made and has no database yet: nothing to migrate`);
      return done('skipped', 'no database yet');
    }
    await runMigrations(withDatabase(config.databaseUrl, shop.dbName), {
      onWait: () => {
        logger.log(`Shop "${shop.slug}": another migration is running; waiting for it`);
      },
    });
    const result = done('migrated');
    logger.log(`Shop "${shop.slug}": migrated in ${result.milliseconds} ms`);
    return result;
  } catch (error) {
    const reason = reasonOf(error);
    logger.error(
      `Shop "${shop.slug}": the migration FAILED and changed nothing (${reason}). ` +
        'The shop answers 503 until this is fixed and it is migrated again.',
    );
    return done('failed', reason);
  }
}

/**
 * Migrates the shops' databases, one after the other (ADR 0029 section 7). One shop's failure is
 * logged and returned, never thrown: the others still migrate and the server still starts. The
 * failed shop is not served, because the lookup checks that a shop has every migration (ShopSchema).
 * Drizzle applies a shop's migrations in one transaction, so a failure leaves its schema as it was.
 * The control database is migrated before this (`prepareControlDatabase`). `only` names one shop;
 * it throws if that shop is not open. Needs MULTI_SHOP.
 */
export async function migrateShops(config: AppConfig, only?: string): Promise<ShopMigration[]> {
  const results: ShopMigration[] = [];
  for (const shop of await openShops(config, only)) {
    results.push(await migrateShop(config, shop));
  }
  return results;
}
