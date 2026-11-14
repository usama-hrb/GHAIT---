import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { AppConfig } from '../../config/index.js';
import { withDatabase } from '../database-url.js';
import * as controlSchema from './schema.js';

export type ControlDb = NodePgDatabase<typeof controlSchema>;

/** The control database's URL: the shops' server and login, the control database's name. */
export function controlDatabaseUrl(config: AppConfig): string {
  if (!config.multiShop) throw new Error('The control database exists only when MULTI_SHOP is on');
  return withDatabase(config.databaseUrl, config.multiShop.controlDatabaseName);
}

/** camelCase in TypeScript, snake_case in Postgres, as for the shops' databases. */
export function createControlDb(pool: pg.Pool): ControlDb {
  return drizzle({ client: pool, schema: controlSchema, casing: 'snake_case' });
}
