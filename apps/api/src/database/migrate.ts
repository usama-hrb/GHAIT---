import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDatabase, createPool, type Executor } from './client.js';

/** apps/api/drizzle, from src/database (tests) and from dist/database (built). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Key of the lock a migrator holds on a database while it migrates it (ASCII "migr"). It is not the
 * write lock (`fabr`, see TransactionHost): that one is taken for a moment by every write, and a
 * migration must not wait behind the writes of a shop nor make them wait for its lock.
 */
export const MIGRATION_LOCK = 0x6d_69_67_72;

export interface MigrationOptions {
  /** Called when another migrator holds the lock, before this one waits for it. */
  readonly onWait?: () => void;
}

/**
 * Takes the lock, waiting for as long as another migrator holds it. The lock belongs to the
 * connection, so it is freed when the connection closes, even if the process dies.
 */
async function takeLock(
  connection: pg.PoolClient,
  onWait: (() => void) | undefined,
): Promise<void> {
  const tried = await connection.query<{ got: boolean }>('SELECT pg_try_advisory_lock($1) AS got', [
    MIGRATION_LOCK,
  ]);
  if (tried.rows[0]?.got) return;
  onWait?.();
  await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
}

/**
 * Runs `work` while this process holds the migration lock of the database, and closes its
 * connections. One migrator at a time works on a database: Drizzle reads which migrations are
 * applied before it opens its transaction, so two migrators that start together would both run the
 * same ones (for example `make migrate` while the API starts, or two `make shop-adopt`). The second
 * waits, then finds nothing to do. The control database is migrated under the same lock.
 */
export async function withMigrationLock(
  databaseUrl: string,
  work: (pool: pg.Pool) => Promise<void>,
  options: MigrationOptions = {},
): Promise<void> {
  const pool = createPool(databaseUrl, { max: 2 });
  try {
    const lock = await pool.connect();
    try {
      await takeLock(lock, options.onWait);
      await work(pool);
    } finally {
      // Closing the connection frees the lock, even when an unlock could not run.
      lock.release(true);
    }
  } finally {
    await pool.end();
  }
}

/** Applies a shop's pending migrations (drizzle-kit SQL files, committed) under the lock. */
export async function runMigrations(
  databaseUrl: string,
  options: MigrationOptions = {},
): Promise<void> {
  await withMigrationLock(
    databaseUrl,
    (pool) => migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
    options,
  );
}

let newest: number | undefined;

/** When the newest migration of this code was made: what Drizzle stores as `created_at` once it is applied. */
function newestMigration(): number {
  newest ??= Math.max(
    ...readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).map(
      (migration) => migration.folderMillis,
    ),
  );
  return newest;
}

/**
 * Whether the database has every migration of this code. Drizzle decides what is pending by the
 * newest one it applied, and this reads the same fact. A database that is ahead of the code (the
 * code went back one release, ADR 0029 section 7) is current: its schema has what the code needs.
 */
export async function isMigrated(db: Executor): Promise<boolean> {
  const table = await db.execute<{ present: boolean }>(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  if (!table.rows[0]?.present) return false;
  const applied = await db.execute<{ newest: string | null }>(
    sql`SELECT max(created_at) AS newest FROM drizzle.__drizzle_migrations`,
  );
  return Number(applied.rows[0]?.newest ?? 0) >= newestMigration();
}
