import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { AppConfig } from '../../config/index.js';
import { ensureDatabase } from '../create-database.js';
import { withMigrationLock } from '../migrate.js';
import { controlDatabaseUrl, createControlDb } from './connection.js';

/** apps/api/drizzle-control, from src/database/control (tests) and from dist/database/control (built). */
export const CONTROL_MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../drizzle-control', import.meta.url),
);

/**
 * Applies pending control migrations and closes its connections. The database must exist. Like a
 * shop's, it is migrated by one migrator at a time: the API starting, `make migrate` and
 * `make shop-adopt` may all prepare the control database together.
 */
export async function runControlMigrations(controlUrl: string): Promise<void> {
  await withMigrationLock(controlUrl, (pool) =>
    migrate(createControlDb(pool), { migrationsFolder: CONTROL_MIGRATIONS_FOLDER }),
  );
}

/**
 * Makes the control database on the shops' server if it is missing, then migrates it (ADR 0029).
 * Does nothing with MULTI_SHOP off. It runs before the shops' own migrations.
 */
export async function prepareControlDatabase(config: AppConfig): Promise<void> {
  if (!config.multiShop) return;
  await ensureDatabase(config.databaseUrl, config.multiShop.controlDatabaseName);
  await runControlMigrations(controlDatabaseUrl(config));
}
