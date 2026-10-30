import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/database/index.js';
import { withDatabase } from './database-url.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Superuser URL of the test server (its default database). */
    postgresAdminUrl: string;
    /** Migrated database that each test file copies (CREATE DATABASE … TEMPLATE). */
    templateDatabase: string;
  }
}

const TEMPLATE = 'fabric_template';

/** One Postgres for the whole run, same image as production; migrated once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:16.15-alpine').start();
  const adminUrl = container.getConnectionUri();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE}`);
  await admin.end();
  await runMigrations(withDatabase(adminUrl, TEMPLATE));

  project.provide('postgresAdminUrl', adminUrl);
  project.provide('templateDatabase', TEMPLATE);
  return async () => {
    await container.stop();
  };
}
