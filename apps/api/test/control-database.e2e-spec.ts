import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type AppConfig, ConfigModule, parseConfig } from '../src/config/index.js';
import {
  CONTROL_MIGRATIONS_FOLDER,
  ControlDatabase,
  ControlDatabaseModule,
  controlSchema,
  ensureDatabase,
  prepareControlDatabase,
  withDatabase,
} from '../src/database/index.js';

const JWT_ACCESS_SECRET = 'integration-test-secret-0123456789abcdef';
const TABLES = ['shop', 'shop_event', 'shop_host', 'shop_setup_code'];

function newName(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function configFor(adminUrl: string, extra: Record<string, string>): AppConfig {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: adminUrl,
    JWT_ACCESS_SECRET,
    ...extra,
  });
}

async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return rowCount === 1;
  } finally {
    await pool.end();
  }
}

/** Everything the migrations made, in a form that two runs can be compared in. */
async function describeSchema(sql: pg.Pool): Promise<Record<string, unknown[]>> {
  const q = async (text: string): Promise<unknown[]> =>
    (await sql.query<Record<string, unknown>>(text)).rows;
  return {
    columns: await q(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`),
    constraints: await q(`
      SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    indexes: await q(`
      SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' ORDER BY 1, 2`),
    triggers: await q(`
      SELECT tgrelid::regclass::text AS table_name, tgname, pg_get_triggerdef(oid) AS def
        FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`),
    functions: await q(`
      SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1`),
    applied: await q('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id'),
  };
}

describe('control database (ADR 0029)', () => {
  const adminUrl = inject('postgresAdminUrl');
  const name = newName('control');
  const config = configFor(adminUrl, { MULTI_SHOP: 'true', CONTROL_DATABASE_NAME: name });
  let sql: pg.Pool;
  let afterFirstRun: Record<string, unknown[]>;

  beforeAll(async () => {
    expect(await databaseExists(adminUrl, name)).toBe(false);
    await prepareControlDatabase(config);
    sql = new pg.Pool({ connectionString: withDatabase(adminUrl, name), max: 2 });
    afterFirstRun = await describeSchema(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A shop row to hang other rows on. */
  async function addShop(slug = newName('s').slice(0, 20), dbName = `shop_${slug}`) {
    const { rows } = await sql.query<{ id: string }>(
      'INSERT INTO shop (slug, db_name) VALUES ($1, $2) RETURNING id',
      [slug, dbName],
    );
    return { id: rows[0]?.id ?? '', slug, dbName };
  }

  describe('making it', () => {
    it('makes the database from nothing, and only the four control tables in it', async () => {
      expect(await databaseExists(adminUrl, name)).toBe(true);
      const { rows } = await sql.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );
      expect(rows.map((row) => row.table_name)).toEqual(TABLES);
    });

    it('is not a shop database: no server_seq, no shop tables', async () => {
      const { rows } = await sql.query(`SELECT 1 FROM pg_class WHERE relname = 'server_seq'`);
      expect(rows).toHaveLength(0);
      const columns = await sql.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name IN ('server_seq', 'device_id', 'voided_at')`,
      );
      expect(columns.rows).toHaveLength(0);
    });

    it('migrates a second time with the same result', async () => {
      await prepareControlDatabase(config);
      expect(await describeSchema(sql)).toEqual(afterFirstRun);
      const journal = JSON.parse(
        readFileSync(join(CONTROL_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };
      expect(afterFirstRun.applied).toHaveLength(journal.entries.length);
    });

    it('makes a missing database and leaves an existing one alone', async () => {
      const other = newName('control');
      expect(await ensureDatabase(adminUrl, other)).toBe(true);
      expect(await ensureDatabase(adminUrl, other)).toBe(false);
      expect(await databaseExists(adminUrl, other)).toBe(true);
    });

    it('processes that start together all end with the database, none fails, one makes it', async () => {
      // Several rounds: the losers of a race fail in two different ways, depending on timing.
      for (let round = 0; round < 3; round++) {
        const other = newName('control');
        const results = await Promise.all(
          Array.from({ length: 4 }, () => ensureDatabase(adminUrl, other)),
        );
        expect(results.filter(Boolean), `round ${round}`).toHaveLength(1);
        expect(await databaseExists(adminUrl, other)).toBe(true);
      }
    });

    it('prepares the control database for processes that start together: none fails, each migration once', async () => {
      // The API starting, `make migrate` and `make shop-adopt` may all prepare it at the same moment.
      for (let round = 0; round < 3; round++) {
        const other = newName('control');
        const together = configFor(adminUrl, { MULTI_SHOP: 'true', CONTROL_DATABASE_NAME: other });
        await Promise.all(Array.from({ length: 4 }, () => prepareControlDatabase(together)));
        const pool = new pg.Pool({ connectionString: withDatabase(adminUrl, other), max: 1 });
        try {
          const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM drizzle.__drizzle_migrations',
          );
          expect(Number(rows[0]?.n), `round ${round}`).toBe(
            (
              JSON.parse(
                readFileSync(join(CONTROL_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
              ) as { entries: unknown[] }
            ).entries.length,
          );
        } finally {
          await pool.end();
        }
      }
    });

    it('refuses a name that is not a plain lower-case name before it reaches SQL', async () => {
      await expect(ensureDatabase(adminUrl, 'x"; DROP DATABASE test; --')).rejects.toThrow(
        /Not a usable database name/,
      );
    });

    it('does nothing with MULTI_SHOP off: the control database is not made', async () => {
      await prepareControlDatabase(configFor(adminUrl, {}));
      expect(await databaseExists(adminUrl, 'fabric_control')).toBe(false);
    });
  });

  describe('the guards (migration 0001)', () => {
    it('installs them on every control table', async () => {
      const expected: Record<string, string[]> = {
        shop: [
          'control_guard_keep_columns',
          'control_guard_no_delete',
          'control_guard_no_truncate',
          'control_guard_shop_update',
        ],
        shop_event: [
          'control_guard_append_only',
          'control_guard_no_delete',
          'control_guard_no_truncate',
        ],
        shop_host: [
          'control_guard_keep_columns',
          'control_guard_no_delete',
          'control_guard_no_truncate',
        ],
        shop_setup_code: [
          'control_guard_keep_columns',
          'control_guard_no_delete',
          'control_guard_no_truncate',
        ],
      };
      expect(Object.keys(expected)).toEqual(TABLES);
      for (const table of TABLES) {
        const { rows } = await sql.query<{ tgname: string }>(
          `SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
          [table],
        );
        expect(
          rows.map((row) => row.tgname),
          table,
        ).toEqual(expected[table]);
      }
    });

    it('has the delete guards on every table there is, so a new table without them fails here', async () => {
      const { rows } = await sql.query<{ table_name: string; guards: string[] }>(`
        SELECT c.relname AS table_name,
               COALESCE(array_agg(t.tgname::text) FILTER (WHERE t.tgname IS NOT NULL), '{}') AS guards
          FROM pg_class c
          LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND NOT t.tgisinternal
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         GROUP BY c.relname ORDER BY c.relname`);
      expect(rows.length).toBeGreaterThan(0);
      const missing = rows.flatMap((row) =>
        ['control_guard_no_delete', 'control_guard_no_truncate']
          .filter((guard) => !row.guards.includes(guard))
          .map((guard) => `${row.table_name} lacks ${guard}`),
      );
      expect(missing).toEqual([]);
    });

    it('never deletes: DELETE and TRUNCATE are refused on every table', async () => {
      for (const table of TABLES) {
        await expect(sql.query(`DELETE FROM ${table}`), table).rejects.toThrow(
          `${table} is never deleted`,
        );
        await expect(sql.query(`TRUNCATE ${table} CASCADE`), table).rejects.toThrow(
          /is never deleted/,
        );
      }
    });

    it('keeps shop_event append-only', async () => {
      await sql.query(`INSERT INTO shop_event (actor, action) VALUES ('test', 'probe')`);
      await expect(sql.query(`UPDATE shop_event SET action = 'edited'`)).rejects.toThrow(
        'shop_event is append-only',
      );
    });

    it('never changes what identifies a shop; label and state can change', async () => {
      const shop = await addShop();
      const changes: [string, string, unknown][] = [
        ['id', '$2::uuid', randomUUID()],
        ['slug', '$2', 'another_slug'],
        ['db_name', '$2', 'shop_another'],
        ['created_at', '$2::timestamptz', '2020-01-01T00:00:00Z'],
      ];
      for (const [column, value, to] of changes) {
        await expect(
          sql.query(`UPDATE shop SET ${column} = ${value} WHERE id = $1`, [shop.id, to]),
          column,
        ).rejects.toThrow(`shop.${column} never changes`);
      }
      await sql.query(`UPDATE shop SET label = 'for Ahmed', state = 'active' WHERE id = $1`, [
        shop.id,
      ]);
      const { rows } = await sql.query<{ label: string; state: string }>(
        'SELECT label, state FROM shop WHERE id = $1',
        [shop.id],
      );
      expect(rows[0]).toEqual({ label: 'for Ahmed', state: 'active' });
    });

    it('never changes what identifies an address, but an address can be released', async () => {
      const shop = await addShop();
      const other = await addShop();
      const { rows } = await sql.query<{ id: string }>(
        'INSERT INTO shop_host (host, shop_id) VALUES ($1, $2) RETURNING id',
        [`${shop.slug}.example.com`.replaceAll('_', '-'), shop.id],
      );
      const id = rows[0]?.id;
      const changes: [string, string, unknown][] = [
        ['id', '$2::uuid', randomUUID()],
        ['host', '$2', 'moved.example.com'],
        ['shop_id', '$2::uuid', other.id],
        ['created_at', '$2::timestamptz', '2020-01-01T00:00:00Z'],
      ];
      for (const [column, value, to] of changes) {
        await expect(
          sql.query(`UPDATE shop_host SET ${column} = ${value} WHERE id = $1`, [id, to]),
          column,
        ).rejects.toThrow(`shop_host.${column} never changes`);
      }
      await sql.query('UPDATE shop_host SET released_at = now() WHERE id = $1', [id]);
    });

    it('never changes a setup code, but it can be used and its failed tries counted', async () => {
      const shop = await addShop();
      const { rows } = await sql.query<{ id: string }>(
        `INSERT INTO shop_setup_code (shop_id, code_hash, expires_at)
         VALUES ($1, 'hash', now() + interval '7 days') RETURNING id`,
        [shop.id],
      );
      const id = rows[0]?.id;
      const other = await addShop();
      const changes: [string, string, unknown][] = [
        ['id', '$2::uuid', randomUUID()],
        ['shop_id', '$2::uuid', other.id],
        ['code_hash', '$2', 'another hash'],
        ['expires_at', '$2::timestamptz', '2099-01-01T00:00:00Z'],
        ['created_at', '$2::timestamptz', '2020-01-01T00:00:00Z'],
      ];
      for (const [column, value, to] of changes) {
        await expect(
          sql.query(`UPDATE shop_setup_code SET ${column} = ${value} WHERE id = $1`, [id, to]),
          column,
        ).rejects.toThrow(`shop_setup_code.${column} never changes`);
      }
      await sql.query('UPDATE shop_setup_code SET failed_tries = failed_tries + 1 WHERE id = $1', [
        id,
      ]);
      await sql.query('UPDATE shop_setup_code SET used_at = now() WHERE id = $1', [id]);
    });

    it('lets a shop go active, suspended and active again, and a closed shop stays closed', async () => {
      const shop = await addShop();
      await sql.query(`UPDATE shop SET state = 'active' WHERE id = $1`, [shop.id]);
      await sql.query(
        `UPDATE shop SET state = 'suspended', suspended_at = now(), suspended_reason = 'unpaid'
          WHERE id = $1`,
        [shop.id],
      );
      await sql.query(`UPDATE shop SET state = 'active' WHERE id = $1`, [shop.id]);
      await sql.query(`UPDATE shop SET state = 'closed', closed_at = now() WHERE id = $1`, [
        shop.id,
      ]);
      for (const state of ['active', 'suspended', 'provisioning']) {
        await expect(
          sql.query(`UPDATE shop SET state = $2, suspended_at = now() WHERE id = $1`, [
            shop.id,
            state,
          ]),
          state,
        ).rejects.toThrow('a closed shop stays closed');
      }
    });

    it('sets updated_at on every update, whatever the caller writes', async () => {
      const shop = await addShop();
      const read = async () =>
        (
          await sql.query<{ updated_at: Date }>('SELECT updated_at FROM shop WHERE id = $1', [
            shop.id,
          ])
        ).rows[0]?.updated_at.getTime() ?? 0;
      const before = await read();
      await sql.query(
        `UPDATE shop SET label = 'x', updated_at = '2000-01-01T00:00:00Z' WHERE id = $1`,
        [shop.id],
      );
      expect(await read()).toBeGreaterThan(before);
    });
  });

  describe('what the tables refuse', () => {
    it.each([
      ['a slug with an upper-case letter', 'Alpha', 'shop_alpha', 'shop_slug_valid'],
      ['a slug that is too short', 'ab', 'shop_ab', 'shop_slug_valid'],
      ['a slug with a dash', 'alpha-two', 'shop_alpha_two', 'shop_slug_valid'],
      ['a slug that starts with a digit', '1alpha', 'shop_1alpha', 'shop_slug_valid'],
      ['a slug over 31 characters', `a${'b'.repeat(31)}`, 'shop_long', 'shop_slug_valid'],
      ['a database name with a quote', 'alphaone', 'shop"x', 'shop_db_name_valid'],
      ['a database name with upper case', 'alphatwo', 'Shop_two', 'shop_db_name_valid'],
    ])('%s', async (_label, slug, dbName, constraint) => {
      await expect(
        sql.query('INSERT INTO shop (slug, db_name) VALUES ($1, $2)', [slug, dbName]),
      ).rejects.toThrow(constraint);
    });

    it('a duplicate slug or a duplicate database', async () => {
      const shop = await addShop();
      await expect(
        sql.query('INSERT INTO shop (slug, db_name) VALUES ($1, $2)', [shop.slug, 'shop_other']),
      ).rejects.toThrow('shop_slug_key');
      await expect(
        sql.query('INSERT INTO shop (slug, db_name) VALUES ($1, $2)', ['otherslug', shop.dbName]),
      ).rejects.toThrow('shop_db_name_key');
    });

    it('a suspended or closed shop with no time', async () => {
      const shop = await addShop();
      await expect(
        sql.query(`UPDATE shop SET state = 'suspended' WHERE id = $1`, [shop.id]),
      ).rejects.toThrow('shop_suspension_dated');
      await expect(
        sql.query(`UPDATE shop SET state = 'closed' WHERE id = $1`, [shop.id]),
      ).rejects.toThrow('shop_closure_dated');
    });

    it.each([
      ['an upper-case host', 'Shop.Example.com'],
      ['a host with a port', 'shop.example.com:3310'],
      ['a host with a final dot', 'shop.example.com.'],
      ['a host with a space', 'shop example.com'],
      ['a host with a path', 'shop.example.com/api'],
      ['an empty host', ''],
      ['a host over 253 characters', `${'a'.repeat(250)}.com`],
    ])('%s as an address', async (_label, host) => {
      const shop = await addShop();
      await expect(
        sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, shop.id]),
      ).rejects.toThrow('shop_host_valid');
    });

    it.each([['shop.example.com'], ['203.0.113.7'], ['localhost'], ['shop2.localhost']])(
      'takes %s as an address',
      async (host) => {
        const shop = await addShop();
        await sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [
          `${randomUUID().slice(0, 8)}.${host}`,
          shop.id,
        ]);
        // The host itself, with nothing before it, once: it is unique among live addresses.
        const alone = await addShop();
        await sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, alone.id]);
        await sql.query('UPDATE shop_host SET released_at = now() WHERE host = $1', [host]);
      },
    );

    it('an address that another shop has in use, until it is released', async () => {
      const first = await addShop();
      const second = await addShop();
      const host = `${first.slug.slice(0, 10)}.example.com`.replaceAll('_', '-');
      await sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, first.id]);
      await expect(
        sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, second.id]),
      ).rejects.toThrow('shop_host_live_host');
      await sql.query('UPDATE shop_host SET released_at = now() WHERE host = $1', [host]);
      await sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, first.id]);
      const { rows } = await sql.query('SELECT 1 FROM shop_host WHERE host = $1', [host]);
      // The released row stays: nothing is deleted.
      expect(rows).toHaveLength(2);
    });

    it('an address, a code or an event for a shop that does not exist', async () => {
      const missing = randomUUID();
      await expect(
        sql.query(`INSERT INTO shop_host (host, shop_id) VALUES ('nobody.example.com', $1)`, [
          missing,
        ]),
      ).rejects.toThrow('shop_host_shop_id_shop_id_fk');
      await expect(
        sql.query(
          `INSERT INTO shop_setup_code (shop_id, code_hash, expires_at)
           VALUES ($1, 'hash', now())`,
          [missing],
        ),
      ).rejects.toThrow('shop_setup_code_shop_id_shop_id_fk');
      await expect(
        sql.query(`INSERT INTO shop_event (shop_id, actor, action) VALUES ($1, 'test', 'probe')`, [
          missing,
        ]),
      ).rejects.toThrow('shop_event_shop_id_shop_id_fk');
    });

    it('a negative count of failed tries', async () => {
      const shop = await addShop();
      await expect(
        sql.query(
          `INSERT INTO shop_setup_code (shop_id, code_hash, expires_at, failed_tries)
           VALUES ($1, 'hash', now(), -1)`,
          [shop.id],
        ),
      ).rejects.toThrow('shop_setup_code_tries_valid');
    });

    it('takes an event about the server as a whole, with no shop', async () => {
      await sql.query(
        `INSERT INTO shop_event (actor, action, detail) VALUES ('test', 'control.migrated', '{"v":1}')`,
      );
    });
  });

  describe('ControlDatabase', () => {
    it('is a small pool of its own on the control database, and closes with the app', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot(config), ControlDatabaseModule],
      }).compile();
      const control = moduleRef.get(ControlDatabase);
      const slug = newName('orm').slice(0, 20);
      const [made] = await control.db
        .insert(controlSchema.shop)
        .values({ slug, dbName: `shop_${slug}` })
        .returning();
      expect(made).toMatchObject({ slug, state: 'provisioning', label: '', closedAt: null });
      expect(made?.createdAt).toBeInstanceOf(Date);
      const read = await control.db.select().from(controlSchema.shop);
      expect(read.map((row) => row.slug)).toContain(slug);

      await moduleRef.close();
      // Drizzle wraps what the driver says; the driver says its pool has ended.
      await expect(control.db.select().from(controlSchema.shop)).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/pool/i) as unknown },
      });
    });

    it('is not made on a one-shop server', () => {
      expect(() => new ControlDatabase(configFor(adminUrl, {}))).toThrow(/only when MULTI_SHOP/);
    });
  });
});
