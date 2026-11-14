import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { accessTokenResponseSchema, registrationStatusSchema } from '@fabric/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { type AppConfig, parseConfig } from '../src/config/index.js';
import {
  adoptShop,
  AdoptionRefused,
  databaseExists,
  ensureDatabase,
  MIGRATIONS_FOLDER,
  migrateShops,
  withDatabase,
} from '../src/database/index.js';
import { loadConfig } from '../src/load-config.js';
import { adoptCommand } from '../src/shop-adopt-command.js';
import { createTestApp, OWNER, type TestApp } from './support/app.js';

/**
 * `make shop-adopt` (ADR 0029, Step 4): the live shop becomes the first shop of a multi-shop
 * server. The live shop here is a real one-shop test app (an owner, a session, audit entries); the
 * claim to prove is that adopting only reads its database.
 */

const adminUrl = inject('postgresAdminUrl');
const COUNT = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql')).length;

const unique = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;

/** The configuration `make shop-adopt` runs with: the live shop's database, multi-shop on. */
function configFor(databaseUrl: string, controlDatabaseName: string): AppConfig {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
    MULTI_SHOP: 'true',
    CONTROL_DATABASE_NAME: controlDatabaseName,
  });
}

/** Another live shop's database: a migrated copy of the template. */
async function anotherLiveDatabase(): Promise<string> {
  const name = unique('test');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${inject('templateDatabase')}`);
  } finally {
    await admin.end();
  }
  return withDatabase(adminUrl, name);
}

/**
 * Everything in a shop's database that a write could change: every row of every table, the
 * sequences (`server_seq`), and the shape of the schema. Two equal fingerprints mean nothing was
 * written, not even a row that was changed and changed back.
 */
async function fingerprint(sql: pg.Pool): Promise<Record<string, unknown>> {
  const tables = await sql.query<{ schemaname: string; tablename: string }>(
    `SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname IN ('public', 'drizzle') ORDER BY 1, 2`,
  );
  const rows: Record<string, unknown> = {};
  for (const { schemaname, tablename } of tables.rows) {
    const { rows: found } = await sql.query<{ n: string; hash: string }>(
      `SELECT count(*) AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
         FROM "${schemaname}"."${tablename}" t`,
    );
    rows[`${schemaname}.${tablename}`] = found[0];
  }
  const q = async (text: string): Promise<unknown[]> =>
    (await sql.query<Record<string, unknown>>(text)).rows;
  return {
    rows,
    sequences: await q(
      'SELECT schemaname, sequencename, last_value FROM pg_sequences ORDER BY 1, 2',
    ),
    columns: await q(`
      SELECT table_schema, table_name, column_name, data_type, column_default
        FROM information_schema.columns WHERE table_schema IN ('public', 'drizzle')
       ORDER BY 1, 2, ordinal_position`),
    triggers: await q(`
      SELECT tgrelid::regclass::text AS table_name, tgname FROM pg_trigger
       WHERE NOT tgisinternal ORDER BY 1, 2`),
    tables: tables.rows.length,
  };
}

async function controlRows(controlName: string): Promise<{
  shops: Record<string, unknown>[];
  hosts: Record<string, unknown>[];
  events: Record<string, unknown>[];
}> {
  const sql = new pg.Pool({ connectionString: withDatabase(adminUrl, controlName), max: 1 });
  try {
    const q = async (text: string): Promise<Record<string, unknown>[]> =>
      (await sql.query<Record<string, unknown>>(text)).rows;
    return {
      shops: await q('SELECT slug, db_name, state FROM shop ORDER BY slug'),
      hosts: await q(
        `SELECT s.slug, h.host, h.released_at FROM shop_host h JOIN shop s ON s.id = h.shop_id ORDER BY 1, 2`,
      ),
      events: await q('SELECT actor, action, detail FROM shop_event ORDER BY created_at, id'),
    };
  } finally {
    await sql.end();
  }
}

describe('shop adoption', () => {
  let live: TestApp;
  let liveSql: pg.Pool;

  beforeAll(async () => {
    // The shop that is live today: a one-shop server with its owner, serving requests.
    live = await createTestApp({ shops: 'one' });
    await live.login();
    liveSql = live.sql;
  });

  afterAll(async () => {
    await live.close();
  });

  it('adopts the live shop, and only reads its database', async () => {
    const control = unique('control');
    const config = configFor(live.config.databaseUrl, control);
    expect(await databaseExists(adminUrl, control)).toBe(false);
    const before = await fingerprint(liveSql);

    const adoption = await adoptShop(config, {
      slug: 'main_shop',
      host: 'shop.example.test',
      actor: 'usama',
    });

    expect(adoption).toMatchObject({
      outcome: 'adopted',
      slug: 'main_shop',
      host: 'shop.example.test',
      state: 'active',
      migrationsApplied: COUNT,
    });
    // The database the live server uses is the shop's database: not copied, not renamed.
    expect(adoption.dbName).toBe(new URL(live.config.databaseUrl).pathname.slice(1));
    expect(await databaseExists(adminUrl, control)).toBe(true);
    expect(await controlRows(control)).toEqual({
      shops: [{ slug: 'main_shop', db_name: adoption.dbName, state: 'active' }],
      hosts: [{ slug: 'main_shop', host: 'shop.example.test', released_at: null }],
      events: [
        {
          actor: 'usama',
          action: 'shop.adopted',
          detail: { host: 'shop.example.test', dbName: adoption.dbName, migrationsApplied: COUNT },
        },
      ],
    });

    expect(await fingerprint(liveSql)).toEqual(before);
    // The adopted shop's audit log is not where the operator's action goes.
    const { rows } = await liveSql.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE entity = 'shop'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
    // The live server did not notice: it still answers, on any address.
    await live.login();
  });

  it('leaves the shop untouched through the first multi-shop start-up too: migrating it is a no-op', async () => {
    const control = unique('control');
    const config = configFor(live.config.databaseUrl, control);
    await adoptShop(config, { slug: 'main_shop', host: 'shop.example.test', actor: 'usama' });
    const before = await fingerprint(liveSql);

    const migrated = await migrateShops(config);

    expect(migrated).toMatchObject([{ slug: 'main_shop', outcome: 'migrated' }]);
    expect(await fingerprint(liveSql)).toEqual(before);
  });

  it('is safe to run again: the same shop and address write nothing', async () => {
    const control = unique('control');
    const config = configFor(live.config.databaseUrl, control);
    const request = { slug: 'main_shop', host: 'shop.example.test', actor: 'usama' };
    const first = await adoptShop(config, request);
    const again = await adoptShop(config, { ...request, actor: 'someone else' });

    expect(again).toMatchObject({ outcome: 'already', id: first.id, state: 'active' });
    const rows = await controlRows(control);
    expect(rows.shops).toHaveLength(1);
    expect(rows.hosts).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({ actor: 'usama' });
  });

  it('two adoptions that start together make one shop', async () => {
    const control = unique('control');
    const config = configFor(live.config.databaseUrl, control);
    const request = { slug: 'main_shop', host: 'shop.example.test', actor: 'usama' };
    const [one, two] = await Promise.all([adoptShop(config, request), adoptShop(config, request)]);

    expect([one.outcome, two.outcome].sort()).toEqual(['adopted', 'already']);
    expect(one.id).toBe(two.id);
    const rows = await controlRows(control);
    expect([rows.shops.length, rows.hosts.length, rows.events.length]).toEqual([1, 1, 1]);
  });

  it('writes the address as devices send it: lower case, no spaces', async () => {
    const control = unique('control');
    await adoptShop(configFor(live.config.databaseUrl, control), {
      slug: 'main_shop',
      host: '  Shop.Example.TEST ',
      actor: 'usama',
    });
    expect((await controlRows(control)).hosts).toMatchObject([{ host: 'shop.example.test' }]);
  });

  describe('what it refuses, and then writes nothing', () => {
    it.each([
      ['a reserved name', { slug: 'all', host: 'a.example.test' }, /reserved/],
      [
        'a name that is too short',
        { slug: 'ab', host: 'a.example.test' },
        /not a usable shop name/,
      ],
      ['a name with capitals', { slug: 'Main', host: 'a.example.test' }, /not a usable shop name/],
      [
        'a name that starts with a digit',
        { slug: '1shop', host: 'a.example.test' },
        /not a usable shop name/,
      ],
      [
        'an address with a scheme',
        { slug: 'main_shop', host: 'https://a.example.test' },
        /not an address/,
      ],
      [
        'an address with a port',
        { slug: 'main_shop', host: 'a.example.test:3000' },
        /not an address/,
      ],
      ['an address with a path', { slug: 'main_shop', host: 'a.example.test/x' }, /not an address/],
      ['an address with a space', { slug: 'main_shop', host: 'a example' }, /not an address/],
      ['an empty address', { slug: 'main_shop', host: ' ' }, /not a usable address/],
      [
        'an address with an underscore',
        { slug: 'main_shop', host: 'a_b.example.test' },
        /not a usable address/,
      ],
    ])('%s', async (_name, request, message) => {
      const control = unique('control');
      await expect(
        adoptShop(configFor(live.config.databaseUrl, control), { ...request, actor: 'usama' }),
      ).rejects.toThrow(message);
      await expect(
        adoptShop(configFor(live.config.databaseUrl, control), { ...request, actor: 'usama' }),
      ).rejects.toBeInstanceOf(AdoptionRefused);
      // The control database is not even made for a mistake in the command.
      expect(await databaseExists(adminUrl, control)).toBe(false);
    });

    it('a database that is not a Fabric shop: no control database is made', async () => {
      const empty = unique('empty');
      await ensureDatabase(adminUrl, empty);
      const control = unique('control');
      await expect(
        adoptShop(configFor(withDatabase(adminUrl, empty), control), {
          slug: 'main_shop',
          host: 'a.example.test',
          actor: 'usama',
        }),
      ).rejects.toThrow(/has no Fabric schema/);
      expect(await databaseExists(adminUrl, control)).toBe(false);
    });

    it('a database that does not exist', async () => {
      const control = unique('control');
      await expect(
        adoptShop(configFor(withDatabase(adminUrl, unique('nothing')), control), {
          slug: 'main_shop',
          host: 'a.example.test',
          actor: 'usama',
        }),
      ).rejects.toThrow(/could not be read/);
      expect(await databaseExists(adminUrl, control)).toBe(false);
    });

    it('an empty actor, and a configuration with MULTI_SHOP off', async () => {
      const control = unique('control');
      await expect(
        adoptShop(configFor(live.config.databaseUrl, control), {
          slug: 'main_shop',
          host: 'a.example.test',
          actor: ' ',
        }),
      ).rejects.toThrow(/actor is empty/);
      const oneShop = parseConfig({
        NODE_ENV: 'test',
        DATABASE_URL: live.config.databaseUrl,
        JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
      });
      await expect(
        adoptShop(oneShop, { slug: 'main_shop', host: 'a.example.test', actor: 'usama' }),
      ).rejects.toThrow(/needs a configuration with MULTI_SHOP on/);
    });

    it('conflicts with a shop already in the control database', async () => {
      const control = unique('control');
      const config = configFor(live.config.databaseUrl, control);
      await adoptShop(config, { slug: 'main_shop', host: 'a.example.test', actor: 'usama' });
      const otherUrl = await anotherLiveDatabase();
      const other = configFor(otherUrl, control);

      // The database is already a shop; it cannot be two.
      await expect(
        adoptShop(config, { slug: 'second_shop', host: 'b.example.test', actor: 'usama' }),
      ).rejects.toThrow(/already the shop "main_shop"/);
      // The name belongs to the first shop's database.
      await expect(
        adoptShop(other, { slug: 'main_shop', host: 'b.example.test', actor: 'usama' }),
      ).rejects.toThrow(/already belongs to another shop/);
      // The address is the first shop's.
      await expect(
        adoptShop(other, { slug: 'second_shop', host: 'a.example.test', actor: 'usama' }),
      ).rejects.toThrow(/address "a.example.test" already belongs to the shop "main_shop"/);
      // The same shop, a new address: that is not adopting.
      await expect(
        adoptShop(config, { slug: 'main_shop', host: 'b.example.test', actor: 'usama' }),
      ).rejects.toThrow(/not one of its addresses/);

      const rows = await controlRows(control);
      expect([rows.shops.length, rows.hosts.length, rows.events.length]).toEqual([1, 1, 1]);

      // A second shop with a name and an address of its own is the multi-shop server growing.
      await adoptShop(other, { slug: 'second_shop', host: 'b.example.test', actor: 'usama' });
      expect((await controlRows(control)).shops.map((shop) => shop.slug)).toEqual([
        'main_shop',
        'second_shop',
      ]);
    });
  });

  describe('make shop-adopt', () => {
    const out = () => {
      const lines = { log: [] as string[], error: [] as string[] };
      return {
        lines,
        output: {
          log: (line: string) => lines.log.push(line),
          error: (line: string) => lines.error.push(line),
        },
      };
    };

    it('adopts, and says so in words; run again it says it is done', async () => {
      const config = configFor(live.config.databaseUrl, unique('control'));
      const first = out();
      expect(
        await adoptCommand(
          config,
          { slug: 'main_shop', host: 'a.example.test', actor: 'usama' },
          first.output,
        ),
      ).toBe(0);
      expect(first.lines.log.join('\n')).toMatch(
        /Adopted the database "test_\w+" as shop "main_shop" \(active\), address a\.example\.test/,
      );
      expect(first.lines.log.join('\n')).toMatch(/set MULTI_SHOP=true and restart/);

      const second = out();
      expect(
        await adoptCommand(config, { slug: 'main_shop', host: 'a.example.test' }, second.output),
      ).toBe(0);
      expect(second.lines.log.join('\n')).toMatch(
        /adopted already \(active, address a\.example\.test\)/,
      );
    });

    it('prints the usage when a name or an address is missing, and the reason when it is refused', async () => {
      const config = configFor(live.config.databaseUrl, unique('control'));
      const usage = out();
      expect(await adoptCommand(config, { slug: 'main_shop' }, usage.output)).toBe(2);
      expect(usage.lines.error.join('\n')).toMatch(/usage: make shop-adopt SLUG=<name> HOST=/);

      const refused = out();
      expect(
        await adoptCommand(config, { slug: 'all', host: 'a.example.test' }, refused.output),
      ).toBe(1);
      expect(refused.lines.error).toEqual(['"all" is reserved: pick another name for the shop.']);
    });

    it('turns MULTI_SHOP on for itself: the live server still has it off while it adopts', () => {
      vi.stubEnv('DATABASE_URL', live.config.databaseUrl);
      vi.stubEnv('JWT_ACCESS_SECRET', 'integration-test-secret-0123456789abcdef');
      vi.stubEnv('MULTI_SHOP', 'false');
      try {
        expect(loadConfig().multiShop).toBeNull();
        expect(loadConfig({ MULTI_SHOP: 'true' }).multiShop).not.toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe('an adopted shop, served by a multi-shop server', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ shops: 'adopted' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers at its address with the owner it already had, and nowhere else', async () => {
    const response = await t
      .http()
      .post('/auth/login')
      .send({ username: OWNER.username, password: OWNER.password })
      .expect(200);
    const { accessToken } = accessTokenResponseSchema.parse(response.body);
    expect(t.shop).not.toBeNull();
    expect(t.app.get(JwtService).decode<Record<string, unknown>>(accessToken)).toMatchObject({
      shop: t.shop?.id,
    });
    await t.http().get('/auth/me').auth(accessToken, { type: 'bearer' }).expect(200);

    // Another address is no shop of this server.
    await t
      .http()
      .post('/auth/login')
      .set('Host', 'nobody.example.test')
      .send({ username: OWNER.username, password: OWNER.password })
      .expect(404);
  });
});

describe('the sign-up of an adopted shop (the tests skipped in the adopted run, proved here in its shape)', () => {
  const PASSWORD = 'correct horse battery staple';
  const request = {
    fullName: 'Amina Alaoui',
    email: 'amina@example.ma',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    shopName: 'Dar Al Qomash',
    shopLogo: null,
    sellingUnits: { piece: false, kg: true, meter: true },
    currency: 'dirham',
  };

  it('says it is closed once the shop has its owner, with the shop id, and refuses a sign-up', async () => {
    const t = await createTestApp({ shops: 'adopted' });
    try {
      const status = await t.http().get('/auth/registration').expect(200);
      expect(registrationStatusSchema.parse(status.body)).toEqual({
        open: false,
        shopId: t.shop?.id,
      });
      await t.http().post('/auth/register').send(request).expect(403);
    } finally {
      await t.close();
    }
  });

  it('says it is open while the adopted shop has no owner, with the shop id and that it needs a setup code', async () => {
    const t = await createTestApp({ shops: 'adopted', owner: false });
    try {
      const status = await t.http().get('/auth/registration').expect(200);
      // Step 6 (ADR 0029): a shop of a multi-shop server is signed up with a code.
      expect(registrationStatusSchema.parse(status.body)).toEqual({
        open: true,
        shopId: t.shop?.id,
        setupCodeRequired: true,
      });
    } finally {
      await t.close();
    }
  });

  it('limits sign-up attempts by AUTH_REGISTER_RATE_LIMIT, on a counter of its own', async () => {
    const t = await createTestApp({ shops: 'adopted', env: { AUTH_REGISTER_RATE_LIMIT: '2' } });
    try {
      await t.http().post('/auth/register').send(request).expect(403);
      await t.http().post('/auth/register').send(request).expect(403);
      await t.http().post('/auth/register').send(request).expect(429);
      // Signing in has its own allowance.
      await t.login();
    } finally {
      await t.close();
    }
  });
});
