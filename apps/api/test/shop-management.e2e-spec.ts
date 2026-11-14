import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { SHOP_ISSUES } from '@fabric/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { type AppConfig, parseConfig } from '../src/config/index.js';
import {
  addShopHost,
  closeShop,
  databaseExists,
  ensureDatabase,
  formatSetupCode,
  hashSetupCode,
  issueShopCode,
  listShops,
  MIGRATIONS_FOLDER,
  normalizeSetupCode,
  prepareControlDatabase,
  provisionShop,
  resumeShop,
  ShopRefused,
  suspendShop,
  withDatabase,
} from '../src/database/index.js';
import { AuthService } from '../src/modules/auth/index.js';
import { LOOKUP_TTL_MS } from '../src/modules/shops/shop-lookup.js';
import { shopCommand } from '../src/shop-commands.js';
import { refreshCookieOf } from './support/app.js';
import { createMultiShopApp, type MultiShopApp } from './support/multi-shop-app.js';

/**
 * The operator's shop commands (ADR 0029, Step 5): `make shop-new`, `shop-list`, `shop-suspend`,
 * `shop-resume`, `shop-code`, `shop-host` and `shop-close`. They run against a real PostgreSQL, the
 * control database and shop databases as they are in production; the ones that must be seen from
 * outside (suspension, closing) are proved through the real application.
 */

const adminUrl = inject('postgresAdminUrl');
const MIGRATIONS = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql')).length;
const SECRET = 'a-setup-code-secret-of-thirty-two-chars!';
const PASSWORD = 'the owners password is long enough';
const DAY = 24 * 60 * 60 * 1000;
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

const unique = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
/** A shop name that cannot clash with another test's: `s` and 14 hex digits. */
const slugOf = (): string => `s${randomUUID().replaceAll('-', '').slice(0, 14)}`;

/** The configuration the commands run with: the test server, multi-shop on, a control database of its own. */
function newConfig(extra: Record<string, string> = {}): AppConfig {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: adminUrl,
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
    MULTI_SHOP: 'true',
    CONTROL_DATABASE_NAME: unique('control'),
    SETUP_CODE_SECRET: SECRET,
    ...extra,
  });
}

const pools: pg.Pool[] = [];

function poolOn(databaseName: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: withDatabase(adminUrl, databaseName), max: 2 });
  pools.push(pool);
  return pool;
}

/** A connection to the control database of `config`, made after the commands made it. */
async function controlOf(config: AppConfig): Promise<pg.Pool> {
  await prepareControlDatabase(config);
  return poolOn(config.multiShop?.controlDatabaseName ?? '');
}

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
});

const TABLES = ['shop', 'shop_host', 'shop_setup_code', 'shop_event'] as const;

/** The id of every row of every control table. Rows are never deleted, so the sets only grow. */
async function ids(sql: pg.Pool): Promise<Record<string, Set<string>>> {
  const found: Record<string, Set<string>> = {};
  for (const table of TABLES) {
    const key = table === 'shop_host' ? 'host' : 'id';
    const { rows } = await sql.query<{ key: string }>(`SELECT ${key}::text AS key FROM ${table}`);
    found[table] = new Set(rows.map((row) => row.key));
  }
  return found;
}

async function counts(sql: pg.Pool): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const [table, keys] of Object.entries(await ids(sql))) found[table] = keys.size;
  return found;
}

async function insertShop(
  sql: pg.Pool,
  slug: string,
  dbName: string,
  state: 'provisioning' | 'active' | 'suspended' | 'closed',
): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO shop (slug, db_name, state, suspended_at, closed_at)
     VALUES ($1, $2, $3::shop_state,
             CASE WHEN $3 = 'suspended' THEN now() END,
             CASE WHEN $3 = 'closed' THEN now() END)
     RETURNING id`,
    [slug, dbName, state],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('the shop was not made');
  return id;
}

async function actionsOf(sql: pg.Pool, shopId: string): Promise<string[]> {
  const { rows } = await sql.query<{ action: string }>(
    'SELECT action FROM shop_event WHERE shop_id = $1',
    [shopId],
  );
  return rows.map((row) => row.action).sort();
}

async function shopRow(sql: pg.Pool, slug: string) {
  const { rows } = await sql.query<{
    id: string;
    state: string;
    db_name: string;
    label: string;
    suspended_at: Date | null;
    suspended_reason: string | null;
    closed_at: Date | null;
  }>('SELECT * FROM shop WHERE slug = $1', [slug]);
  const row = rows[0];
  if (!row) throw new Error(`no shop ${slug}`);
  return row;
}

async function waitingCodes(sql: pg.Pool, shopId: string): Promise<{ code_hash: string }[]> {
  const { rows } = await sql.query<{ code_hash: string }>(
    `SELECT code_hash FROM shop_setup_code
      WHERE shop_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [shopId],
  );
  return rows;
}

/** Everything the migrations made in a shop's database, in a form that two databases can be compared in. */
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
    indexes: await q(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`,
    ),
    triggers: await q(`
      SELECT tgrelid::regclass::text AS table_name, tgname FROM pg_trigger
       WHERE NOT tgisinternal ORDER BY 1, 2`),
    applied: await q('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, hash'),
  };
}

const withoutBytes = (text: string): string => text.replaceAll(/\s+/g, ' ');

describe('make shop-new', () => {
  const config = newConfig();
  let sql: pg.Pool;

  beforeAll(async () => {
    sql = await controlOf(config);
  });

  it('makes the shop: the row, the database, every migration, the address, the code, the state', async () => {
    const slug = slugOf();
    const host = `${slug}.shops.test`;
    const now = new Date('2026-11-13T10:00:00.000Z');

    const made = await provisionShop(
      config,
      { slug, host: ` ${host.toUpperCase()} `, label: '  The first one ', actor: 'usama' },
      now,
    );

    expect(made).toMatchObject({
      slug,
      dbName: `shop_${slug}`,
      host,
      resumed: false,
      steps: ['row', 'database', 'address', 'activated'],
      migrationsApplied: MIGRATIONS,
    });
    expect(made.setupCode.code).toMatch(CODE_SHAPE);
    expect(made.setupCode.expiresAt).toEqual(new Date(now.getTime() + 7 * DAY));

    const row = await shopRow(sql, slug);
    expect(row).toMatchObject({
      id: made.id,
      state: 'active',
      db_name: `shop_${slug}`,
      label: 'The first one',
      suspended_at: null,
      closed_at: null,
    });
    const hosts = await sql.query('SELECT host, released_at FROM shop_host WHERE shop_id = $1', [
      made.id,
    ]);
    expect(hosts.rows).toEqual([{ host, released_at: null }]);

    // The code is kept as an HMAC of itself, once, and nowhere else.
    const codes = await sql.query<{
      code_hash: string;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      'SELECT code_hash, expires_at, used_at, revoked_at FROM shop_setup_code WHERE shop_id = $1',
      [made.id],
    );
    expect(codes.rows).toHaveLength(1);
    expect(codes.rows[0]).toEqual({
      code_hash: hashSetupCode(SECRET, made.id, made.setupCode.code),
      expires_at: made.setupCode.expiresAt,
      used_at: null,
      revoked_at: null,
    });
    const everything = await sql.query<{ text: string }>(
      TABLES.map((table) => `SELECT t::text AS text FROM ${table} t`).join(' UNION ALL '),
    );
    const dump = everything.rows.map((r) => r.text).join('\n');
    expect(dump).not.toContain(made.setupCode.code);
    expect(dump).not.toContain(formatSetupCode(made.setupCode.code));

    expect(await actionsOf(sql, made.id)).toEqual([
      'shop.activated',
      'shop.created',
      'shop.host_added',
      'shop.setup_code_made',
    ]);
    const events = await sql.query<{ actor: string }>(
      'SELECT actor FROM shop_event WHERE shop_id = $1',
      [made.id],
    );
    expect(new Set(events.rows.map((event) => event.actor))).toEqual(new Set(['usama']));

    // The database is the shop's own, migrated, with no owner yet and a code waiting.
    const listed = (await listShops(config, now)).find((shop) => shop.slug === slug);
    expect(listed).toMatchObject({
      state: 'active',
      hosts: [host],
      schema: 'current',
      hasOwner: false,
      codeExpiresAt: made.setupCode.expiresAt,
      label: 'The first one',
    });
  });

  it('makes a shop with no address, which can get one later', async () => {
    const slug = slugOf();
    const made = await provisionShop(config, { slug, actor: 'usama' });
    expect(made.host).toBeNull();
    expect(made.steps).toEqual(['row', 'database', 'activated']);
    const hosts = await sql.query('SELECT 1 FROM shop_host WHERE shop_id = $1', [made.id]);
    expect(hosts.rowCount).toBe(0);
    await expect(
      addShopHost(config, { slug, host: `${slug}.shops.test`, actor: 'usama' }),
    ).resolves.toMatchObject({ outcome: 'added' });
  });

  describe('refuses, and writes and makes nothing', () => {
    /** The command is refused, and the control database and the server are as they were. */
    async function refused(
      request: Parameters<typeof provisionShop>[1],
      message: RegExp,
    ): Promise<void> {
      const before = await ids(sql);
      const databaseBefore = await databaseExists(adminUrl, `shop_${request.slug}`);
      const error: unknown = await provisionShop(config, request).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ShopRefused);
      expect((error as Error).message).toMatch(message);
      expect(await ids(sql)).toEqual(before);
      expect(await databaseExists(adminUrl, `shop_${request.slug}`)).toBe(databaseBefore);
    }

    it.each(['active', 'suspended', 'closed'] as const)(
      'a name that a %s shop has already',
      async (state) => {
        const slug = slugOf();
        await insertShop(sql, slug, `shop_${slug}`, state);
        await refused({ slug, actor: 'usama' }, new RegExp(`exists already \\(${state}\\)`));
      },
    );

    it('a name that a finished run of the same command made', async () => {
      const slug = slugOf();
      const request = { slug, host: `${slug}.shops.test`, actor: 'usama' };
      await provisionShop(config, request);
      await refused(request, /exists already \(active\)/);
    });

    it('a shop that was adopted: its name is its name, whatever its database is called', async () => {
      const slug = slugOf();
      await insertShop(sql, slug, unique('live'), 'active');
      await refused({ slug, actor: 'usama' }, /exists already \(active\)/);
    });

    it('a name whose database belongs to another shop', async () => {
      const taken = slugOf();
      const other = slugOf();
      // `other` was adopted with the database that `taken` would get.
      await insertShop(sql, other, `shop_${taken}`, 'active');
      await refused({ slug: taken, actor: 'usama' }, new RegExp(`already the shop "${other}"`));
    });

    it('an address that another shop uses', async () => {
      const first = slugOf();
      const host = `${first}.shops.test`;
      await provisionShop(config, { slug: first, host, actor: 'usama' });
      await refused(
        { slug: slugOf(), host, actor: 'usama' },
        new RegExp(`belongs to the shop "${first}"`),
      );
    });

    it('a database that exists and that no shop owns: it is not taken over', async () => {
      const slug = slugOf();
      await ensureDatabase(adminUrl, `shop_${slug}`);
      await refused({ slug, actor: 'usama' }, /no shop owns it/);
      // Untouched: no migration ran in it.
      const found = await poolOn(`shop_${slug}`).query(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('public', 'drizzle')`,
      );
      expect(found.rows[0]).toEqual({ n: 0 });
    });

    it.each([
      ['too short', 'ab'],
      ['too long', `a${'b'.repeat(31)}`],
      ['a digit first', '1shop'],
      ['upper case', 'Shop_one'],
      ['a hyphen', 'my-shop'],
      ['a space', 'my shop'],
      ['an injection', 'abc"; DROP DATABASE fabric; --'],
      ['reserved: all', 'all'],
      ['reserved: www', 'www'],
      ['reserved: api', 'api'],
      ['reserved: app', 'app'],
      ['reserved: admin', 'admin'],
      ['reserved: control', 'control'],
    ])('a bad name: %s', async (_label, slug) => {
      await refused({ slug, actor: 'usama' }, /reserved|not a usable shop name/);
    });

    it.each([
      ['a scheme', 'https://shop.example.com'],
      ['a port', 'shop.example.com:443'],
      ['an underscore', 'shop_one.example.com'],
    ])('a bad address: %s', async (_label, host) => {
      await refused(
        { slug: slugOf(), host, actor: 'usama' },
        /not an address|not a usable address/,
      );
    });

    it('no actor, and a label that is a document', async () => {
      await refused({ slug: slugOf(), actor: '  ' }, /actor is empty/);
      await refused({ slug: slugOf(), label: 'x'.repeat(201), actor: 'usama' }, /label is longer/);
    });
  });

  it('is refused before anything is made when the secret for setup codes is missing', async () => {
    const control = unique('control');
    const withoutSecret = parseConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: adminUrl,
      JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
      MULTI_SHOP: 'true',
      CONTROL_DATABASE_NAME: control,
    });
    const slug = slugOf();
    await expect(provisionShop(withoutSecret, { slug, actor: 'usama' })).rejects.toThrow(
      /SETUP_CODE_SECRET is not set/,
    );
    // Not even the control database was made, let alone a row or a shop database.
    expect(await databaseExists(adminUrl, control)).toBe(false);
    expect(await databaseExists(adminUrl, `shop_${slug}`)).toBe(false);
  });
});

describe('make shop-new, stopped half way, run again', () => {
  const config = newConfig();
  let sql: pg.Pool;

  beforeAll(async () => {
    sql = await controlOf(config);
  });

  /** What a run that died after its first step leaves: the row, its first event, nothing else. */
  async function stoppedAfterTheRow(
    slug: string,
    { label = '', actor = 'usama' }: { label?: string; actor?: string } = {},
  ): Promise<string> {
    const id = await insertShop(sql, slug, `shop_${slug}`, 'provisioning');
    // The first run wrote the label it was given into the row, as the command does.
    await sql.query('UPDATE shop SET label = $2 WHERE id = $1', [id, label]);
    await sql.query(
      `INSERT INTO shop_event (shop_id, actor, action, detail) VALUES ($1, $2, 'shop.created', '{}')`,
      [id, actor],
    );
    return id;
  }

  it('after a migration that failed: the shop stays being made, and the same command ends as a clean run does', async () => {
    const slug = slugOf();
    const host = `${slug}.shops.test`;
    const request = { slug, host, label: 'Half', actor: 'usama' };

    // The row and the database were made by a run that went on to fail: an obstacle in the
    // database makes the first migration fail.
    const id = await stoppedAfterTheRow(slug, { label: 'Half' });
    await ensureDatabase(adminUrl, `shop_${slug}`);
    const shopSql = poolOn(`shop_${slug}`);
    await shopSql.query('CREATE TABLE audit_log (note text)');

    const error: unknown = await provisionShop(config, request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShopRefused);
    expect((error as Error).message).toMatch(/migration of the new shop .* failed/);
    expect((error as Error).message).toMatch(/run the same command again/);

    // Being made: no state change, no address, no code, nothing that serves it.
    expect(await shopRow(sql, slug)).toMatchObject({ id, state: 'provisioning' });
    expect((await sql.query('SELECT 1 FROM shop_host WHERE shop_id = $1', [id])).rowCount).toBe(0);
    expect(
      (await sql.query('SELECT 1 FROM shop_setup_code WHERE shop_id = $1', [id])).rowCount,
    ).toBe(0);
    expect(await actionsOf(sql, id)).toEqual(['shop.created']);
    // shop-list says so: the shop is not current.
    const listed = (await listShops(config)).find((shop) => shop.slug === slug);
    expect(listed).toMatchObject({ state: 'provisioning', schema: 'behind', hasOwner: null });

    // The same command again after the cause is gone: it goes on, and does not start over.
    await shopSql.query('DROP TABLE audit_log');
    const again = await provisionShop(config, request);
    expect(again).toMatchObject({
      id,
      resumed: true,
      steps: ['address', 'activated'],
      migrationsApplied: MIGRATIONS,
    });

    // And a clean run of the same arguments gives the same result.
    const cleanSlug = slugOf();
    const clean = await provisionShop(config, {
      slug: cleanSlug,
      host: `${cleanSlug}.shops.test`,
      label: 'Half',
      actor: 'usama',
    });
    const after = await shopRow(sql, slug);
    const cleanRow = await shopRow(sql, cleanSlug);
    expect(after).toMatchObject({
      state: 'active',
      label: 'Half',
      suspended_at: null,
      closed_at: null,
    });
    expect({ state: after.state, label: after.label }).toEqual({
      state: cleanRow.state,
      label: cleanRow.label,
    });
    expect(await actionsOf(sql, id)).toEqual(await actionsOf(sql, clean.id));
    expect(await describeSchema(shopSql)).toEqual(
      await describeSchema(poolOn(`shop_${cleanSlug}`)),
    );
    expect(await waitingCodes(sql, id)).toHaveLength(1);
    expect(again.migrationsApplied).toBe(clean.migrationsApplied);
    expect((await listShops(config)).find((shop) => shop.slug === slug)).toMatchObject({
      state: 'active',
      hosts: [host],
      schema: 'current',
      hasOwner: false,
    });
  });

  it('after the row only: it makes the database and goes on', async () => {
    const slug = slugOf();
    const id = await stoppedAfterTheRow(slug);
    expect(await databaseExists(adminUrl, `shop_${slug}`)).toBe(false);

    const made = await provisionShop(config, { slug, host: `${slug}.shops.test`, actor: 'usama' });
    expect(made).toMatchObject({
      id,
      resumed: true,
      steps: ['database', 'address', 'activated'],
      migrationsApplied: MIGRATIONS,
    });
    expect(await shopRow(sql, slug)).toMatchObject({ state: 'active' });
  });

  it('after the database but before its migrations: it migrates and goes on', async () => {
    const slug = slugOf();
    const id = await stoppedAfterTheRow(slug);
    await ensureDatabase(adminUrl, `shop_${slug}`);

    const made = await provisionShop(config, { slug, host: `${slug}.shops.test`, actor: 'usama' });
    expect(made).toMatchObject({ id, resumed: true, steps: ['address', 'activated'] });
    expect((await listShops(config)).find((shop) => shop.slug === slug)).toMatchObject({
      schema: 'current',
    });
  });

  it('after the address was added but before the state changed: it makes the code and activates', async () => {
    const slug = slugOf();
    const host = `${slug}.shops.test`;
    const id = await stoppedAfterTheRow(slug);
    await ensureDatabase(adminUrl, `shop_${slug}`);
    await sql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [host, id]);

    const made = await provisionShop(config, { slug, host, actor: 'usama' });
    expect(made.steps).toEqual(['activated']);
    // The address is not added twice.
    expect((await sql.query('SELECT 1 FROM shop_host WHERE shop_id = $1', [id])).rowCount).toBe(1);
  });

  it('a second run of a finished shop is refused: it makes no second code', async () => {
    const slug = slugOf();
    const request = { slug, host: `${slug}.shops.test`, actor: 'usama' };
    const first = await provisionShop(config, request);
    await expect(provisionShop(config, request)).rejects.toThrow(/exists already \(active\)/);
    expect(await waitingCodes(sql, first.id)).toHaveLength(1);
  });

  it('two runs at the same time: one finishes the shop and shows the one code, the other is refused', async () => {
    const slug = slugOf();
    const request = { slug, host: `${slug}.shops.test`, actor: 'usama' };
    const results = await Promise.allSettled([
      provisionShop(config, request),
      provisionShop(config, request),
    ]);
    const done = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(done).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ShopRefused);

    const row = await shopRow(sql, slug);
    expect(row.state).toBe('active');
    expect(await waitingCodes(sql, row.id)).toHaveLength(1);
    const events = await actionsOf(sql, row.id);
    expect(events.filter((action) => action === 'shop.activated')).toHaveLength(1);
    expect(events.filter((action) => action === 'shop.setup_code_made')).toHaveLength(1);
    expect((await sql.query('SELECT 1 FROM shop_host WHERE shop_id = $1', [row.id])).rowCount).toBe(
      1,
    );
  });
});

describe('suspend, resume, close and the cache time, through the real application', () => {
  let t: MultiShopApp;
  let config: AppConfig;
  let sql: pg.Pool;

  /** A shop made by the command, with an owner, whose address has been asked for (so it is cached). */
  async function liveShop(): Promise<{ slug: string; host: string; id: string }> {
    const slug = slugOf();
    const host = `${slug}.shops.test`;
    const made = await provisionShop(config, { slug, host, actor: 'usama' });
    await t.shopsService.runAsShop(slug, () =>
      t.app.get(AuthService).setOwner({ username: 'owner', password: PASSWORD, displayName: slug }),
    );
    return { slug, host, id: made.id };
  }

  const later = (ms: number): void => {
    vi.setSystemTime(Date.now() + ms);
  };

  beforeAll(async () => {
    t = await createMultiShopApp([], {
      env: { SETUP_CODE_SECRET: SECRET, AUTH_LOGIN_RATE_LIMIT: '1000' },
    });
    config = t.config;
    sql = t.controlSql;
  });
  afterAll(async () => {
    vi.useRealTimers();
    await t.close();
  });

  it('a suspended shop answers 403 on every route but /health once the cached answer is 30 seconds old; resume brings it back the same way', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { slug, host } = await liveShop();
      const login = await t
        .at(host)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD });
      expect(login.status).toBe(200);
      const accessToken = (login.body as { accessToken: string }).accessToken;
      let cookie = refreshCookieOf(login) ?? '';
      expect(cookie).not.toBe('');
      const bearer = `Bearer ${accessToken}`;

      const routes = async (): Promise<Record<string, number>> => {
        const refresh = await t.at(host).post('/auth/refresh').set('cookie', cookie);
        // A refresh token is used once: the answer carries the next one.
        cookie = refreshCookieOf(refresh) ?? cookie;
        return {
          registration: (await t.at(host).get('/auth/registration')).status,
          login: (
            await t.at(host).post('/auth/login').send({ username: 'owner', password: PASSWORD })
          ).status,
          refresh: refresh.status,
          pull: (await t.at(host).get('/sync/pull?since=0&limit=10').set('authorization', bearer))
            .status,
          health: (await t.at(host).get('/health')).status,
        };
      };
      expect(await routes()).toEqual({
        registration: 200,
        login: 200,
        refresh: 200,
        pull: 200,
        health: 200,
      });

      const stoppedAt = Date.now();
      const suspended = await suspendShop(
        config,
        { slug, reason: 'unpaid', actor: 'usama' },
        new Date(),
      );
      expect(suspended).toEqual({ outcome: 'changed', slug, state: 'suspended' });

      // The answer in the cache is not 30 seconds old yet: the shop is still served.
      later(LOOKUP_TTL_MS - 1000);
      expect((await routes()).registration).toBe(200);

      // Once it is, every route but /health is refused with the suspension as the reason.
      later(1000 + 1);
      expect(Date.now() - stoppedAt).toBeGreaterThan(LOOKUP_TTL_MS);
      expect(await routes()).toEqual({
        registration: 403,
        login: 403,
        refresh: 403,
        pull: 403,
        health: 200,
      });
      const refused = await t
        .at(host)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD });
      expect(refused.body).toMatchObject({
        error: { code: 'forbidden', issues: [{ code: SHOP_ISSUES.suspended }] },
      });

      // Resume: the same, the other way. Not at once, within the cache time.
      expect(await resumeShop(config, { slug, actor: 'usama' })).toEqual({
        outcome: 'changed',
        slug,
        state: 'active',
      });
      expect((await routes()).registration).toBe(403);
      later(LOOKUP_TTL_MS + 1);
      expect(await routes()).toEqual({
        registration: 200,
        login: 200,
        refresh: 200,
        pull: 200,
        health: 200,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('suspending and resuming write an event with the reason, set and clear the shop’s own fields, and do not touch its data', async () => {
    const { slug, id } = await liveShop();
    // The shop was made after the app started: ask its database directly.
    const shopSql = new pg.Pool({
      connectionString: withDatabase(adminUrl, `shop_${slug}`),
      max: 1,
    });
    try {
      const before = (await shopSql.query('SELECT 1 FROM app_user')).rowCount;
      expect(before).toBe(1);

      const now = new Date('2026-11-13T12:00:00.000Z');
      await suspendShop(config, { slug, reason: ' unpaid in November ', actor: 'usama' }, now);
      expect(await shopRow(sql, slug)).toMatchObject({
        state: 'suspended',
        suspended_at: now,
        suspended_reason: 'unpaid in November',
      });
      await resumeShop(config, { slug, actor: 'usama' });
      expect(await shopRow(sql, slug)).toMatchObject({
        state: 'active',
        suspended_at: null,
        suspended_reason: null,
      });

      const events = await sql.query<{ action: string; detail: Record<string, unknown> }>(
        `SELECT action, detail FROM shop_event
          WHERE shop_id = $1 AND action IN ('shop.suspended', 'shop.resumed')
          ORDER BY created_at`,
        [id],
      );
      const byAction = Object.fromEntries(events.rows.map((event) => [event.action, event.detail]));
      expect(byAction['shop.suspended']).toEqual({ reason: 'unpaid in November' });
      expect(byAction['shop.resumed']).toEqual({
        suspendedAt: now.toISOString(),
        suspendedReason: 'unpaid in November',
      });
      expect((await shopSql.query('SELECT 1 FROM app_user')).rowCount).toBe(before);
    } finally {
      await shopSql.end();
    }
  });

  it('asks for a reason, and repeating a state writes nothing', async () => {
    const { slug } = await liveShop();
    await expect(suspendShop(config, { slug, reason: undefined, actor: 'usama' })).rejects.toThrow(
      /needs a reason/,
    );
    await expect(suspendShop(config, { slug, reason: '   ', actor: 'usama' })).rejects.toThrow(
      /needs a reason/,
    );
    await expect(
      suspendShop(config, { slug, reason: 'x'.repeat(501), actor: 'usama' }),
    ).rejects.toThrow(/longer than 500/);

    await expect(resumeShop(config, { slug, actor: 'usama' })).resolves.toMatchObject({
      outcome: 'already',
    });
    await suspendShop(config, { slug, reason: 'once', actor: 'usama' });
    const before = await counts(sql);
    await expect(
      suspendShop(config, { slug, reason: 'twice', actor: 'usama' }),
    ).resolves.toMatchObject({ outcome: 'already', state: 'suspended' });
    expect(await counts(sql)).toEqual(before);
    expect(await shopRow(sql, slug)).toMatchObject({ suspended_reason: 'once' });
  });

  it('does not suspend a shop that is not served, and knows no unknown shop', async () => {
    const half = slugOf();
    await insertShop(sql, half, `shop_${half}`, 'provisioning');
    await expect(suspendShop(config, { slug: half, reason: 'x', actor: 'usama' })).rejects.toThrow(
      /being made/,
    );
    await expect(resumeShop(config, { slug: half, actor: 'usama' })).rejects.toThrow(/being made/);
    await expect(
      suspendShop(config, { slug: slugOf(), reason: 'x', actor: 'usama' }),
    ).rejects.toThrow(/There is no shop/);
    await expect(resumeShop(config, { slug: 'Nope', actor: 'usama' })).rejects.toThrow(
      /not a usable shop name/,
    );
  });

  it('close is final: the address stops answering, and the database and every row stay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { slug, host, id } = await liveShop();
      await t.at(host).get('/auth/registration').expect(200);
      const shopSql = new pg.Pool({
        connectionString: withDatabase(adminUrl, `shop_${slug}`),
        max: 1,
      });
      try {
        const rowsBefore = (await shopSql.query('SELECT 1 FROM app_user')).rowCount;
        const idsBefore = await ids(sql);

        // It asks to be confirmed, with the name, and a reason.
        await expect(
          closeShop(config, { slug, reason: 'left us', confirm: undefined, actor: 'usama' }),
        ).rejects.toThrow(new RegExp(`CONFIRM=${slug}`));
        await expect(
          closeShop(config, { slug, reason: 'left us', confirm: 'another', actor: 'usama' }),
        ).rejects.toThrow(/Type its name again/);
        await expect(
          closeShop(config, { slug, reason: '', confirm: slug, actor: 'usama' }),
        ).rejects.toThrow(/needs a reason/);
        expect(await shopRow(sql, slug)).toMatchObject({ state: 'active' });

        const closedAt = new Date();
        await expect(
          closeShop(config, { slug, reason: 'left us', confirm: slug, actor: 'usama' }, closedAt),
        ).resolves.toEqual({ outcome: 'changed', slug, state: 'closed' });
        expect(await shopRow(sql, slug)).toMatchObject({ state: 'closed', closed_at: closedAt });

        // Within the cache time the address answers as before; after it, as an unknown one.
        later(LOOKUP_TTL_MS + 1);
        const gone = await t.at(host).get('/auth/registration');
        expect(gone.status).toBe(404);
        expect(gone.body).toMatchObject({
          error: { code: 'not_found', message: 'No shop is served at this address' },
        });
        await t.at(host).get('/health').expect(200);

        // Nothing was deleted or dropped: the database, its rows, the address (not released), the history.
        expect(await databaseExists(adminUrl, `shop_${slug}`)).toBe(true);
        expect((await shopSql.query('SELECT 1 FROM app_user')).rowCount).toBe(rowsBefore);
        const hosts = await sql.query('SELECT released_at FROM shop_host WHERE shop_id = $1', [id]);
        expect(hosts.rows).toEqual([{ released_at: null }]);
        const idsAfter = await ids(sql);
        for (const table of TABLES) {
          for (const key of idsBefore[table] ?? []) expect(idsAfter[table]?.has(key)).toBe(true);
        }
        const closing = await sql.query<{ detail: unknown }>(
          `SELECT detail FROM shop_event WHERE shop_id = $1 AND action = 'shop.closed'`,
          [id],
        );
        expect(closing.rows).toEqual([{ detail: { reason: 'left us', from: 'active' } }]);

        // Final: nothing moves it, and the command says so.
        const before = await counts(sql);
        await expect(
          closeShop(config, { slug, reason: 'again', confirm: slug, actor: 'usama' }),
        ).resolves.toMatchObject({ outcome: 'already' });
        await expect(resumeShop(config, { slug, actor: 'usama' })).rejects.toThrow(
          /closed for good/,
        );
        await expect(suspendShop(config, { slug, reason: 'x', actor: 'usama' })).rejects.toThrow(
          /closed for good/,
        );
        await expect(
          addShopHost(config, { slug, host: `other-${host}`, actor: 'usama' }),
        ).rejects.toThrow(/closed for good/);
        await expect(issueShopCode(config, { slug, actor: 'usama' })).rejects.toThrow(
          /closed for good/,
        );
        await expect(provisionShop(config, { slug, actor: 'usama' })).rejects.toThrow(
          /exists already \(closed\)/,
        );
        expect(await counts(sql)).toEqual(before);
      } finally {
        await shopSql.end();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('closing a shop that was never finished is allowed, and says what it was', async () => {
    const slug = slugOf();
    const id = await insertShop(sql, slug, `shop_${slug}`, 'provisioning');
    await closeShop(config, { slug, reason: 'wrong name', confirm: slug, actor: 'usama' });
    expect(await shopRow(sql, slug)).toMatchObject({ state: 'closed' });
    const closing = await sql.query<{ detail: unknown }>(
      `SELECT detail FROM shop_event WHERE shop_id = $1 AND action = 'shop.closed'`,
      [id],
    );
    expect(closing.rows).toEqual([{ detail: { reason: 'wrong name', from: 'provisioning' } }]);
  });

  it('shop-host adds an address that serves within the cache time, refuses another shop’s, and repeats harmlessly', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { slug, host } = await liveShop();
      const second = `second-${host}`;
      await t.at(second).get('/auth/registration').expect(404);

      await expect(
        addShopHost(config, { slug, host: second.toUpperCase(), actor: 'usama' }),
      ).resolves.toEqual({
        outcome: 'added',
        slug,
        host: second,
      });
      later(LOOKUP_TTL_MS + 1);
      await t.at(second).get('/auth/registration').expect(200);

      const other = await liveShop();
      const before = await counts(sql);
      await expect(
        addShopHost(config, { slug, host: second, actor: 'usama' }),
      ).resolves.toMatchObject({
        outcome: 'already',
      });
      expect(await counts(sql)).toEqual(before);

      await expect(
        addShopHost(config, { slug: other.slug, host: second, actor: 'usama' }),
      ).rejects.toThrow(new RegExp(`belongs to the shop "${slug}"`));
      await expect(
        addShopHost(config, { slug, host: 'https://nope.test', actor: 'usama' }),
      ).rejects.toThrow(/not an address/);
      expect(await counts(sql)).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('make shop-code', () => {
  let t: MultiShopApp;
  let config: AppConfig;
  let sql: pg.Pool;

  beforeAll(async () => {
    t = await createMultiShopApp([], { env: { SETUP_CODE_SECRET: SECRET } });
    config = t.config;
    sql = t.controlSql;
  });
  afterAll(async () => {
    await t.close();
  });

  const fresh = async (now?: Date): Promise<{ slug: string; id: string; code: string }> => {
    const slug = slugOf();
    const made = await provisionShop(
      config,
      { slug, host: `${slug}.shops.test`, actor: 'usama' },
      now,
    );
    return { slug, id: made.id, code: made.setupCode.code };
  };

  it('makes a new code and stops the one that was waiting: only one works at a time', async () => {
    const { slug, id, code: first } = await fresh();
    const issued = await issueShopCode(config, { slug, actor: 'usama' });

    expect(issued.slug).toBe(slug);
    expect(issued.code).toMatch(CODE_SHAPE);
    expect(issued.code).not.toBe(first);
    expect(issued.replaced).toBe(1);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);

    // Both rows are still there; the old one is marked as stopped, and only the new one waits.
    const rows = await sql.query<{ code_hash: string; revoked_at: Date | null }>(
      'SELECT code_hash, revoked_at FROM shop_setup_code WHERE shop_id = $1',
      [id],
    );
    expect(rows.rows).toHaveLength(2);
    const old = rows.rows.find((row) => row.code_hash === hashSetupCode(SECRET, id, first));
    expect(old?.revoked_at).not.toBeNull();
    const waiting = await waitingCodes(sql, id);
    expect(waiting).toEqual([{ code_hash: hashSetupCode(SECRET, id, issued.code) }]);

    // What the operator reads from the screen and the owner types back is the code that was kept.
    const typed = normalizeSetupCode(formatSetupCode(issued.code).toLowerCase());
    expect(typed && hashSetupCode(SECRET, id, typed)).toBe(waiting[0]?.code_hash);

    // The event says how many were stopped. It never holds a code.
    const events = await sql.query<{ detail: { replaced: number } }>(
      `SELECT detail FROM shop_event WHERE shop_id = $1 AND action = 'shop.setup_code_made' ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    expect(events.rows[0]?.detail.replaced).toBe(1);
    const dump = (
      await sql.query<{ text: string }>('SELECT t::text AS text FROM shop_event t')
    ).rows
      .map((row) => row.text)
      .join('\n');
    expect(dump).not.toContain(issued.code);
    expect(dump).not.toContain(first);
  });

  it('does not count a code that ran out as one it stopped', async () => {
    // Made eight days ago: it ran out a day ago.
    const { slug, id } = await fresh(new Date(Date.now() - 8 * DAY));
    expect(await waitingCodes(sql, id)).toHaveLength(0);
    const issued = await issueShopCode(config, { slug, actor: 'usama' });
    expect(issued.replaced).toBe(0);
    const rows = await sql.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM shop_setup_code WHERE shop_id = $1',
      [id],
    );
    expect(rows.rows.filter((row) => row.revoked_at !== null)).toHaveLength(0);
    expect(await waitingCodes(sql, id)).toHaveLength(1);
  });

  it('is refused while the shop has a live owner, and writes nothing', async () => {
    const { slug } = await fresh();
    await t.shopsService.runAsShop(slug, () =>
      t.app.get(AuthService).setOwner({ username: 'owner', password: PASSWORD, displayName: slug }),
    );
    const before = await ids(sql);
    await expect(issueShopCode(config, { slug, actor: 'usama' })).rejects.toThrow(
      /has an owner already/,
    );
    expect(await ids(sql)).toEqual(before);
    expect((await listShops(config)).find((shop) => shop.slug === slug)).toMatchObject({
      hasOwner: true,
    });
  });

  it('is refused for a shop that is being made, a closed one and an unknown one', async () => {
    const half = slugOf();
    await insertShop(sql, half, `shop_${half}`, 'provisioning');
    const gone = slugOf();
    await insertShop(sql, gone, `shop_${gone}`, 'closed');
    const before = await ids(sql);
    await expect(issueShopCode(config, { slug: half, actor: 'usama' })).rejects.toThrow(
      /being made/,
    );
    await expect(issueShopCode(config, { slug: gone, actor: 'usama' })).rejects.toThrow(
      /closed for good/,
    );
    await expect(issueShopCode(config, { slug: slugOf(), actor: 'usama' })).rejects.toThrow(
      /There is no shop/,
    );
    expect(await ids(sql)).toEqual(before);
  });

  it('works for a suspended shop, which can be given its owner while it is not served', async () => {
    const { slug } = await fresh();
    await suspendShop(config, { slug, reason: 'pending', actor: 'usama' });
    await expect(issueShopCode(config, { slug, actor: 'usama' })).resolves.toMatchObject({
      replaced: 1,
    });
  });

  it('is refused before anything is read or written when there is no secret', async () => {
    const { slug } = await fresh();
    const noSecret = parseConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: adminUrl,
      JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
      MULTI_SHOP: 'true',
      CONTROL_DATABASE_NAME: t.controlDatabaseName,
    });
    const before = await ids(sql);
    await expect(issueShopCode(noSecret, { slug, actor: 'usama' })).rejects.toThrow(
      /SETUP_CODE_SECRET/,
    );
    expect(await ids(sql)).toEqual(before);
  });

  it('a code made with another secret is not the code that was kept', async () => {
    const { slug, id } = await fresh();
    const issued = await issueShopCode(config, { slug, actor: 'usama' });
    const waiting = await waitingCodes(sql, id);
    expect(hashSetupCode(`${SECRET}!`, id, issued.code)).not.toBe(waiting[0]?.code_hash);
    expect(hashSetupCode(SECRET, randomUUID(), issued.code)).not.toBe(waiting[0]?.code_hash);
  });
});

describe('make shop-list', () => {
  const config = newConfig();
  let sql: pg.Pool;

  beforeAll(async () => {
    sql = await controlOf(config);
  });

  it('shows each shop’s state, addresses, schema, owner and code, flags a shop whose migration failed, and writes nothing', async () => {
    const live = slugOf();
    await provisionShop(config, {
      slug: live,
      host: `${live}.shops.test`,
      label: 'Live',
      actor: 'usama',
    });
    const off = slugOf();
    await provisionShop(config, { slug: off, host: `${off}.shops.test`, actor: 'usama' });
    await suspendShop(config, { slug: off, reason: 'unpaid', actor: 'usama' });
    const gone = slugOf();
    await provisionShop(config, { slug: gone, actor: 'usama' });
    await closeShop(config, { slug: gone, reason: 'left', confirm: gone, actor: 'usama' });
    // A migration that failed: its database has a table that the first migration cannot make.
    const failed = slugOf();
    await insertShop(sql, failed, `shop_${failed}`, 'provisioning');
    await ensureDatabase(adminUrl, `shop_${failed}`);
    await poolOn(`shop_${failed}`).query('CREATE TABLE audit_log (note text)');
    await expect(provisionShop(config, { slug: failed, actor: 'usama' })).rejects.toThrow(
      ShopRefused,
    );
    // A shop whose database is not there at all.
    const lost = slugOf();
    await insertShop(sql, lost, `shop_${lost}`, 'active');

    const before = { counts: await counts(sql), ids: await ids(sql) };
    const listing = await listShops(config);
    expect(await ids(sql)).toEqual(before.ids);
    const bySlug = Object.fromEntries(listing.map((shop) => [shop.slug, shop]));

    expect(bySlug[live]).toMatchObject({
      state: 'active',
      hosts: [`${live}.shops.test`],
      schema: 'current',
      hasOwner: false,
      label: 'Live',
    });
    expect(bySlug[live]?.codeExpiresAt).toBeInstanceOf(Date);
    expect(bySlug[off]).toMatchObject({
      state: 'suspended',
      suspendedReason: 'unpaid',
      schema: 'current',
    });
    expect(bySlug[gone]).toMatchObject({ state: 'closed', schema: null, hasOwner: null });
    expect(bySlug[failed]).toMatchObject({
      state: 'provisioning',
      schema: 'behind',
      hasOwner: null,
    });
    expect(bySlug[lost]).toMatchObject({ state: 'active', schema: 'no database' });

    // Oldest first.
    const order = listing.map((shop) => shop.slug);
    expect(order.indexOf(live)).toBeLessThan(order.indexOf(off));
    expect(order.indexOf(off)).toBeLessThan(order.indexOf(gone));
  });

  it('does not show a code that was used, stopped or has run out', async () => {
    const slug = slugOf();
    const made = await provisionShop(config, { slug, actor: 'usama' });
    const shop = () => listShops(config).then((all) => all.find((one) => one.slug === slug));
    expect((await shop())?.codeExpiresAt).toEqual(made.setupCode.expiresAt);

    await sql.query('UPDATE shop_setup_code SET used_at = now() WHERE shop_id = $1', [made.id]);
    expect((await shop())?.codeExpiresAt).toBeNull();
    await sql.query(
      'UPDATE shop_setup_code SET used_at = NULL, revoked_at = now() WHERE shop_id = $1',
      [made.id],
    );
    expect((await shop())?.codeExpiresAt).toBeNull();
  });

  it('does not show a code that ran out', async () => {
    // Made eight days ago: it ran out a day ago.
    const slug = slugOf();
    await provisionShop(config, { slug, actor: 'usama' }, new Date(Date.now() - 8 * DAY));
    const listed = (await listShops(config)).find((one) => one.slug === slug);
    expect(listed).toMatchObject({ state: 'active', codeExpiresAt: null });
  });
});

describe('nothing is deleted', () => {
  const config = newConfig();
  let sql: pg.Pool;

  beforeAll(async () => {
    sql = await controlOf(config);
  });

  it('no command removes a row of the control database or drops a database; the database refuses it too', async () => {
    const idsAtStart = await ids(sql);
    const slugs = [slugOf(), slugOf()];
    for (const slug of slugs) {
      await provisionShop(config, { slug, host: `${slug}.shops.test`, actor: 'usama' });
    }
    const [first, second] = slugs as [string, string];
    await addShopHost(config, { slug: first, host: `more-${first}.shops.test`, actor: 'usama' });
    await issueShopCode(config, { slug: first, actor: 'usama' });
    await suspendShop(config, { slug: first, reason: 'x', actor: 'usama' });
    await resumeShop(config, { slug: first, actor: 'usama' });
    await suspendShop(config, { slug: second, reason: 'x', actor: 'usama' });
    await closeShop(config, { slug: second, reason: 'x', confirm: second, actor: 'usama' });
    await listShops(config);

    const idsNow = await ids(sql);
    for (const table of TABLES) {
      for (const key of idsAtStart[table] ?? []) expect(idsNow[table]?.has(key)).toBe(true);
    }
    // They grew: the two shops are there, and so is every row the commands made.
    expect((await counts(sql))['shop']).toBe((idsAtStart['shop']?.size ?? 0) + 2);
    expect((await counts(sql))['shop_setup_code']).toBe(
      (idsAtStart['shop_setup_code']?.size ?? 0) + 3,
    );
    for (const slug of slugs) expect(await databaseExists(adminUrl, `shop_${slug}`)).toBe(true);

    // And the guards still say no, to the operator's own SQL as well.
    for (const table of TABLES) {
      await expect(sql.query(`DELETE FROM ${table}`)).rejects.toThrow(/never deleted|append-only/);
      await expect(sql.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow();
    }
    // The events say it all, in the order they were done, every one by the operator.
    const events = await sql.query<{ action: string; actor: string }>(
      `SELECT DISTINCT action, actor FROM shop_event`,
    );
    expect(new Set(events.rows.map((event) => event.action))).toEqual(
      new Set([
        'shop.created',
        'shop.host_added',
        'shop.setup_code_made',
        'shop.activated',
        'shop.suspended',
        'shop.resumed',
        'shop.closed',
      ]),
    );
    expect(new Set(events.rows.map((event) => event.actor))).toEqual(new Set(['usama']));
  });
});

describe('the command layer', () => {
  const config = newConfig();

  function capture(): {
    log: string[];
    error: string[];
    out: { log(l: string): void; error(l: string): void };
  } {
    const log: string[] = [];
    const error: string[] = [];
    return {
      log,
      error,
      out: {
        log: (line) => void log.push(line),
        error: (line) => void error.push(line),
      },
    };
  }

  const run = async (
    command: string | undefined,
    args: Parameters<typeof shopCommand>[2],
    usingConfig: AppConfig = config,
  ) => {
    const c = capture();
    const code = await shopCommand(usingConfig, command, { actor: 'usama', ...args }, c.out);
    return { code, log: c.log.join('\n'), error: c.error.join('\n') };
  };

  it('says how it is used, and exits 2, when the command is missing or unknown', async () => {
    for (const command of [undefined, 'frobnicate', 'drop']) {
      const result = await run(command, {});
      expect(result.code).toBe(2);
      expect(result.error).toContain('usage: make shop-new');
      expect(result.log).toBe('');
    }
  });

  it.each([
    ['new', {}, /missing SLUG/],
    ['suspend', { slug: 'abc' }, /missing REASON/],
    ['resume', {}, /missing SLUG/],
    ['code', {}, /missing SLUG/],
    ['host', { slug: 'abc' }, /missing HOST/],
    ['close', {}, /missing SLUG/],
  ])('exits 2 and names what is missing for %s', async (command, args, message) => {
    const result = await run(command, args);
    expect(result.code).toBe(2);
    expect(result.error).toMatch(message);
  });

  it('makes a shop and shows its setup code once, then refuses to make it again', async () => {
    const slug = slugOf();
    const made = await run('new', { slug, host: `${slug}.shops.test`, label: 'Command' });
    expect(made.code).toBe(0);
    expect(made.log).toContain(`Made the shop "${slug}" (active)`);
    expect(made.log).toContain(`${MIGRATIONS} migrations applied`);
    const shown = /([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})/.exec(
      made.log,
    )?.[1];
    expect(shown).toBeDefined();
    expect(made.log).toContain('shown once');
    expect(made.log).toContain('make shop-code');

    // What was shown is the code that was kept.
    const sql = await controlOf(config);
    const row = await shopRow(sql, slug);
    const typed = normalizeSetupCode(shown ?? '');
    expect(typed && hashSetupCode(SECRET, row.id, typed)).toBe(
      (await waitingCodes(sql, row.id))[0]?.code_hash,
    );

    const again = await run('new', { slug, host: `${slug}.shops.test` });
    expect(again.code).toBe(1);
    expect(again.error).toMatch(/exists already \(active\)/);
    expect(again.log).not.toMatch(
      /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/,
    );
  });

  it('goes on with a shop that was stopped half way, and says so', async () => {
    const slug = slugOf();
    const sql = await controlOf(config);
    await insertShop(sql, slug, `shop_${slug}`, 'provisioning');
    const result = await run('new', { slug });
    expect(result.code).toBe(0);
    expect(result.log).toContain(`Went on with the shop "${slug}" (active)`);
    expect(result.log).toContain('none yet');
  });

  it('suspends, resumes, adds an address, makes a code and closes, each with its own words and exit 0', async () => {
    const slug = slugOf();
    await run('new', { slug, host: `${slug}.shops.test` });

    const suspended = await run('suspend', { slug, reason: 'unpaid' });
    expect(suspended.code).toBe(0);
    expect(suspended.log).toMatch(
      /Suspended the shop .* 403 within 30 seconds; its tablets keep selling offline/,
    );
    expect((await run('suspend', { slug, reason: 'unpaid' })).log).toContain('suspended already');

    const resumed = await run('resume', { slug });
    expect(resumed.code).toBe(0);
    expect(resumed.log).toMatch(/Resumed the shop/);
    expect((await run('resume', { slug })).log).toContain('served already');

    const host = await run('host', { slug, host: `www-${slug}.shops.test` });
    expect(host.code).toBe(0);
    expect(host.log).toContain('now answers at');
    expect((await run('host', { slug, host: `www-${slug}.shops.test` })).log).toContain('already');

    const code = await run('code', { slug });
    expect(code.code).toBe(0);
    expect(code.log).toMatch(/New setup code for .*: [0-9A-HJKMNP-TV-Z]{4}-/);
    expect(code.log).toContain('The code that was waiting no longer works.');

    const noConfirm = await run('close', { slug, reason: 'left' });
    expect(noConfirm.code).toBe(1);
    expect(noConfirm.error).toContain(`CONFIRM=${slug}`);
    const closed = await run('close', { slug, reason: 'left', confirm: slug });
    expect(closed.code).toBe(0);
    expect(closed.log).toContain('nothing was dropped');
    expect((await run('close', { slug, reason: 'left', confirm: slug })).log).toContain(
      'closed already',
    );
  });

  it('lists the shops as a table, and points at a shop that is not current', async () => {
    const own = newConfig();
    const sql = await controlOf(own);
    const empty = await run('list', {}, own);
    expect(empty).toMatchObject({ code: 0 });
    expect(empty.log).toContain('No shops yet');

    const live = slugOf();
    await run('new', { slug: live, host: `${live}.shops.test`, label: 'Main shop' }, own);
    const half = slugOf();
    await insertShop(sql, half, `shop_${half}`, 'provisioning');
    await ensureDatabase(adminUrl, `shop_${half}`);

    const listed = await run('list', {}, own);
    expect(listed.code).toBe(0);
    const lines = listed.log.split('\n');
    expect(withoutBytes(lines[0] ?? '')).toBe('SLUG STATE ADDRESSES SCHEMA OWNER CODE NOTE');
    const liveLine = lines.find((line) => line.startsWith(live)) ?? '';
    expect(withoutBytes(liveLine)).toMatch(
      new RegExp(
        `^${live} active ${live}\\.shops\\.test current no until \\d{4}-\\d{2}-\\d{2} Main shop$`,
      ),
    );
    expect(withoutBytes(lines.find((line) => line.startsWith(half)) ?? '')).toBe(
      `${half} provisioning - behind - - `.trimEnd(),
    );
    expect(listed.log).toContain(`${half}: not current or not reachable, so it answers 503`);
    // The columns line up: the state starts at the same place in the header and in every row.
    expect(liveLine.indexOf('active')).toBe((lines[0] ?? '').indexOf('STATE'));
  });

  it('shows the reason of a suspended shop in the list', async () => {
    const own = newConfig();
    const slug = slugOf();
    await run('new', { slug, host: `${slug}.shops.test` }, own);
    await run('suspend', { slug, reason: 'unpaid in November' }, own);
    expect((await run('list', {}, own)).log).toContain('suspended: unpaid in November');
  });

  it('exits 1 with the reason in words for a refusal, and for a failure it did not expect', async () => {
    const refused = await run('suspend', { slug: slugOf(), reason: 'x' });
    expect(refused.code).toBe(1);
    expect(refused.error).toMatch(/There is no shop/);
    expect(refused.error).not.toMatch(/ShopRefused|at .*\.ts/);

    const down = newConfig({ DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' });
    const failed = await run('list', {}, down);
    expect(failed.code).toBe(1);
    expect(failed.error).toMatch(/^The command failed: /);
  });
});
