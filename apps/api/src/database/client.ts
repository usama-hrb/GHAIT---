import { Logger } from '@nestjs/common';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** The pool's database or an open transaction: what repositories run their queries on. */
export type Executor = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** camelCase in TypeScript, snake_case in Postgres (drizzle.config.ts uses the same casing). */
export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

/**
 * How long a pool of multi-shop mode waits for a connection before it fails (ADR 0029): one shop's
 * database that does not answer must not hold requests for ever. pg-pool counts the wait for a
 * free connection in the same limit, so it is generous. The single pool of a one-shop server sets
 * none and waits as it always has.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

export interface PoolOptions {
  /** Most connections open at once. Default 10. */
  readonly max?: number;
  /** Fail after this long without a connection (see CONNECT_TIMEOUT_MS). Default: wait for ever. */
  readonly connectTimeoutMs?: number;
  /**
   * Every session is read-only: the server refuses a write, so a command that only looks at a
   * database cannot change it, even by a mistake added later.
   */
  readonly readOnly?: boolean;
}

const logger = new Logger('Database');

export function createPool(databaseUrl: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    ...(options.connectTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMillis: options.connectTimeoutMs }),
    ...(options.readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
  });
  // An error on an idle connection (the database restarted, the network dropped) is emitted on the
  // pool, and Node throws an error event nobody listens to: the whole process stops. The pool has
  // already dropped that connection, so it is enough to say so; the next query opens a new one.
  pool.on('error', (error) => {
    logger.error(`An idle database connection failed and was dropped: ${error.message}`);
  });
  return pool;
}
