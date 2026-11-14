import pg from 'pg';
import { DATABASE_NAME_PATTERN } from '../config/index.js';
import { createPool } from './client.js';

/** `"name"`, for SQL that cannot take a parameter. Refuses anything but a plain lower-case name. */
export function quoteDatabaseName(name: string): string {
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(`Not a usable database name: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * PostgreSQL tells a session that lost a race to make the same database in one of two ways.
 * "database already exists" (42P04) is the usual one. When both sessions are inside CREATE DATABASE
 * at the same moment, the loser gets a unique violation on the catalog index of database names
 * (23505) instead. The server raises it only after the other session has committed, so the database
 * exists in both cases.
 */
const DUPLICATE_DATABASE = '42P04';
const UNIQUE_VIOLATION = '23505';
const DATABASE_NAME_INDEX = 'pg_database_datname_index';

function lostTheRace(error: unknown): boolean {
  if (!(error instanceof pg.DatabaseError)) return false;
  return (
    error.code === DUPLICATE_DATABASE ||
    (error.code === UNIQUE_VIOLATION && error.constraint === DATABASE_NAME_INDEX)
  );
}

async function existsIn(pool: pg.Pool, name: string): Promise<boolean> {
  const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return found.rowCount === 1;
}

/** Whether the server `adminUrl` points at has a database called `name`. */
export async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const pool = createPool(adminUrl, { max: 1 });
  try {
    return await existsIn(pool, name);
  } finally {
    await pool.end();
  }
}

/**
 * Makes the database `name` on the server `adminUrl` points at, unless it is there already. The
 * login must be allowed to create databases. Returns whether it made one: two processes that start
 * together both ask, and the one that loses the race gets false, not an error.
 */
export async function ensureDatabase(adminUrl: string, name: string): Promise<boolean> {
  const identifier = quoteDatabaseName(name);
  const pool = createPool(adminUrl, { max: 1 });
  try {
    if (await existsIn(pool, name)) return false;
    try {
      await pool.query(`CREATE DATABASE ${identifier}`);
      return true;
    } catch (error) {
      if (lostTheRace(error)) return false;
      throw error;
    }
  } finally {
    await pool.end();
  }
}
