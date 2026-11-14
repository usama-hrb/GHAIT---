import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  createDatabase,
  databaseExists,
  ensureDatabase,
  isMigrated,
  MIGRATION_LOCK,
  MIGRATIONS_FOLDER,
  migrateShops,
  runMigrations,
  withDatabase,
} from '../src/database/index.js';
import { LOOKUP_TTL_MS } from '../src/modules/shops/shop-lookup.js';
import { migrateCommand, type Output } from '../src/migrate-command.js';
import { parseConfig } from '../src/config/index.js';
import { createMultiShopApp, type MultiShopApp } from './support/multi-shop-app.js';

/** The migrations of every shop (ADR 0029, Step 3): one migrator at a time, one shop's failure alone. */

const COUNT = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql')).length;
const adminUrl = inject('postgresAdminUrl');

async function newDatabase(): Promise<{ url: string; sql: pg.Pool }> {
  const name = `lock_${randomUUID().replaceAll('-', '')}`;
  await ensureDatabase(adminUrl, name);
  const url = withDatabase(adminUrl, name);
  return { url, sql: new pg.Pool({ connectionString: url, max: 2 }) };
}

async function appliedCount(sql: pg.Pool): Promise<number> {
  const { rows } = await sql.query<{ n: string }>(
    'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
  );
  return Number(rows[0]?.n);
}

const sleep = (ms: number): Promise<'waiting'> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve('waiting');
    }, ms);
  });

/** The direct SQL connection of a shop of the test app. */
function sqlOf(t: MultiShopApp, slug: string): pg.Pool {
  const shop = t.shops[slug];
  if (!shop) throw new Error(`no shop ${slug}`);
  return shop.sql;
}

describe('runMigrations', () => {
  it('migrates a new database from nothing, and says so when asked', async () => {
    const { url, sql } = await newDatabase();
    try {
      const pool = new pg.Pool({ connectionString: url, max: 1 });
      expect(await isMigrated(createDatabase(pool))).toBe(false);
      await runMigrations(url);
      expect(await appliedCount(sql)).toBe(COUNT);
      expect(await isMigrated(createDatabase(pool))).toBe(true);
      await runMigrations(url);
      expect(await appliedCount(sql)).toBe(COUNT);
      await pool.end();
    } finally {
      await sql.end();
    }
  });

  it('lets one migrator work at a time: three that start together all end well, each migration once', async () => {
    const { url, sql } = await newDatabase();
    try {
      const waited = vi.fn();
      await Promise.all([1, 2, 3].map(() => runMigrations(url, { onWait: waited })));
      expect(waited).toHaveBeenCalled();
      expect(await appliedCount(sql)).toBe(COUNT);
    } finally {
      await sql.end();
    }
  });

  it('makes a second migrator wait for the lock, then find nothing to do', async () => {
    const { url, sql } = await newDatabase();
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      const onWait = vi.fn();
      const second = runMigrations(url, { onWait });
      await vi.waitFor(() => {
        expect(onWait).toHaveBeenCalledTimes(1);
      });
      // It has asked for the lock and is still waiting: nothing was migrated.
      expect(await Promise.race([second, sleep(400)])).toBe('waiting');
      const before = await sql.query('SELECT to_regclass($1) AS found', [
        'drizzle.__drizzle_migrations',
      ]);
      expect(before.rows[0]).toEqual({ found: null });

      await holder.end(); // closing the connection frees the lock
      await second;
      expect(await appliedCount(sql)).toBe(COUNT);
    } finally {
      await sql.end();
    }
  });

  it('does not use the write lock of the shop, so writes and migrations do not wait for each other', () => {
    expect(MIGRATION_LOCK).not.toBe(0x66_61_62_72);
  });

  it('frees the lock when a migration fails, and changes nothing', async () => {
    const { url, sql } = await newDatabase();
    try {
      await sql.query('CREATE TABLE audit_log (note text)');
      await expect(runMigrations(url)).rejects.toThrow();
      const tables = await sql.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      expect(tables.rows).toEqual([{ table_name: 'audit_log' }]);
      const taken = await sql.query<{ got: boolean }>('SELECT pg_try_advisory_lock($1) AS got', [
        MIGRATION_LOCK,
      ]);
      expect(taken.rows[0]?.got).toBe(true);
    } finally {
      await sql.end();
    }
  });

  it('isMigrated: behind when the newest migration is missing, current when the database is ahead', async () => {
    const { url, sql } = await newDatabase();
    try {
      await runMigrations(url);
      const db = createDatabase(sql);
      await sql.query(
        'DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)',
      );
      expect(await isMigrated(db)).toBe(false);
      await sql.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        ['from-a-newer-release', Date.now() + 86_400_000],
      );
      expect(await isMigrated(db)).toBe(true);
    } finally {
      await sql.end();
    }
  });
});

describe('the migrations of every shop', () => {
  let t: MultiShopApp;

  beforeAll(async () => {
    t = await createMultiShopApp([
      { slug: 'm_first', host: 'first.m.test', database: 'empty' },
      { slug: 'm_broken', host: 'broken.m.test', database: 'broken' },
      { slug: 'm_ready', host: 'ready.m.test', database: 'migrated' },
      { slug: 'm_off', host: 'off.m.test', database: 'empty', state: 'suspended' },
      { slug: 'm_making', host: 'making.m.test', database: 'empty', state: 'provisioning' },
      { slug: 'm_nodb', host: 'nodb.m.test', database: 'missing', state: 'provisioning' },
      { slug: 'm_closed', host: 'closed.m.test', database: 'empty', state: 'closed' },
    ]);
  });
  afterAll(async () => {
    await t.close();
  });

  const shopSql = (slug: string): pg.Pool => sqlOf(t, slug);

  it('a shop that was never migrated is not served, and /health does not depend on it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const response = await t.at('first.m.test').get('/auth/registration');
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ error: { code: 'service_unavailable' } });
      await t.at('first.m.test').get('/health').expect(200);
      // A shop with every migration is served.
      await t.at('ready.m.test').get('/auth/registration').expect(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('migrates each shop that is not closed, in the order they were made, and one failure stops no other', async () => {
    const results = await migrateShops(t.config);
    expect(results.map((r) => [r.slug, r.outcome])).toEqual([
      ['m_first', 'migrated'],
      ['m_broken', 'failed'],
      ['m_ready', 'migrated'],
      ['m_off', 'migrated'],
      ['m_making', 'migrated'],
      ['m_nodb', 'skipped'],
    ]);
    for (const slug of ['m_first', 'm_ready', 'm_off', 'm_making']) {
      expect(await appliedCount(shopSql(slug))).toBe(COUNT);
    }
  });

  it('a failed shop is left as it was, with the database’s own reason', async () => {
    const [failed] = (await migrateShops(t.config, 'm_broken')).filter(
      (r) => r.outcome === 'failed',
    );
    expect(failed?.reason).toMatch(/audit_log.*already exists/);
    expect(failed?.reason).not.toMatch(/CREATE TABLE/);
    const tables = await shopSql('m_broken').query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows).toEqual([{ table_name: 'audit_log' }]);
  });

  it('a closed shop is not touched, and a shop being made gets no database from a migration', async () => {
    const tables = await shopSql('m_closed').query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows).toEqual([]);
    const nodb = t.shops['m_nodb'];
    expect(await databaseExists(t.adminUrl, nodb?.databaseName ?? '')).toBe(false);
  });

  it('names one shop, and refuses a shop that does not exist or is closed', async () => {
    expect(await migrateShops(t.config, 'm_ready')).toMatchObject([
      { slug: 'm_ready', outcome: 'migrated' },
    ]);
    await expect(migrateShops(t.config, 'm_nobody')).rejects.toThrow(
      'There is no open shop "m_nobody"',
    );
    await expect(migrateShops(t.config, 'm_closed')).rejects.toThrow(
      'There is no open shop "m_closed"',
    );
  });

  it('the healthy shops serve and the failed one answers 503, until it is fixed and migrated again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 10 * LOOKUP_TTL_MS);
      await t.at('first.m.test').get('/auth/registration').expect(200);
      await t.at('ready.m.test').get('/auth/registration').expect(200);
      await t.at('off.m.test').get('/auth/registration').expect(403);
      const broken = await t.at('broken.m.test').get('/auth/registration');
      expect(broken.status).toBe(503);
      expect(broken.body).toMatchObject({ error: { code: 'service_unavailable' } });
      await t.at('broken.m.test').get('/health').expect(200);

      // The operator removes the cause and migrates the shop again: no restart.
      await shopSql('m_broken').query('DROP TABLE audit_log');
      expect(await migrateShops(t.config, 'm_broken')).toMatchObject([{ outcome: 'migrated' }]);
      // The answer is kept for 30 seconds, so the shop comes back at the next look.
      await t.at('broken.m.test').get('/auth/registration').expect(503);
      vi.setSystemTime(Date.now() + LOOKUP_TTL_MS);
      await t.at('broken.m.test').get('/auth/registration').expect(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('make migrate', () => {
  const lines = (): { out: Output; log: string[]; error: string[] } => {
    const log: string[] = [];
    const error: string[] = [];
    return { out: { log: (l) => log.push(l), error: (l) => error.push(l) }, log, error };
  };
  const env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
  };

  it('a one-shop server migrates its database as before, and refuses SHOP', async () => {
    const { url, sql } = await newDatabase();
    try {
      const config = parseConfig({ ...env, DATABASE_URL: url });
      const refused = lines();
      expect(await migrateCommand(config, 'shop_a', refused.out)).toBe(2);
      expect(refused.error[0]).toMatch(/only for MULTI_SHOP=true/);
      expect(await appliedCount(sql).catch(() => 0)).toBe(0);

      const done = lines();
      expect(await migrateCommand(config, undefined, done.out)).toBe(0);
      expect(done.log).toEqual(['Migrations applied.']);
      expect(await appliedCount(sql)).toBe(COUNT);
    } finally {
      await sql.end();
    }
  });

  describe('with several shops', () => {
    let t: MultiShopApp;
    beforeAll(async () => {
      t = await createMultiShopApp([
        { slug: 'c_fine', host: 'fine.c.test', database: 'empty' },
        { slug: 'c_bad', host: 'bad.c.test', database: 'broken' },
        { slug: 'c_other', host: 'other.c.test', database: 'empty' },
      ]);
    });
    afterAll(async () => {
      await t.close();
    });

    it('wants a shop to be named: a slug or all', async () => {
      const o = lines();
      expect(await migrateCommand(t.config, undefined, o.out)).toBe(2);
      expect(o.error[0]).toMatch(/SHOP=<slug>\|all/);
    });

    it('migrates the one shop named, and only that one', async () => {
      const o = lines();
      expect(await migrateCommand(t.config, 'c_fine', o.out)).toBe(0);
      expect(o.log).toEqual(['Migrations applied for 1 shops.']);
      expect(await appliedCount(sqlOf(t, 'c_fine'))).toBe(COUNT);
      const other = await sqlOf(t, 'c_other').query('SELECT to_regclass($1) AS found', [
        'drizzle.__drizzle_migrations',
      ]);
      expect(other.rows[0]).toEqual({ found: null });
    });

    it('with all, tries every shop and exits with 1 if one failed, naming it', async () => {
      const o = lines();
      expect(await migrateCommand(t.config, 'all', o.out)).toBe(1);
      expect(o.error[0]).toMatch(/1 of 3 shops failed: c_bad/);
      // The shop after the failed one was migrated all the same.
      expect(await appliedCount(sqlOf(t, 'c_other'))).toBe(COUNT);
    });

    it('says so for a shop that does not exist, and exits with 1', async () => {
      const o = lines();
      expect(await migrateCommand(t.config, 'c_nobody', o.out)).toBe(1);
      expect(o.error).toEqual(['There is no open shop "c_nobody"']);
    });
  });
});
