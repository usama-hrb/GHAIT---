import { randomUUID } from 'node:crypto';
import { type AccessTokenResponse, accessTokenResponseSchema } from '@fabric/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp } from '../../src/common/index.js';
import { type AppConfig, parseConfig } from '../../src/config/index.js';
import {
  ControlDatabase,
  controlSchema,
  prepareControlDatabase,
  withDatabase,
} from '../../src/database/index.js';
import { AuthService } from '../../src/modules/auth/index.js';
import { ShopsService } from '../../src/modules/shops/index.js';
import { TEST_SETUP_CODE_SECRET, type TestApp } from './app.js';

/**
 * What a shop's database holds when the test starts. `migrated`: a copy of the migrated template.
 * `empty`: a new database with nothing in it, which still needs its migrations. `broken`: empty too,
 * but with a table called `audit_log` of the wrong shape, so the first migration fails. `missing`:
 * the shop is in the control database but its database was never made.
 */
export type ShopDatabase = 'migrated' | 'empty' | 'broken' | 'missing';

export interface ShopSpec {
  slug: string;
  database?: ShopDatabase;
  /** The address its requests come to. */
  host: string;
  state?: controlSchema.ShopState;
  /** The owner's password (the account is `owner`); none: the shop has no owner. */
  ownerPassword?: string;
}

export interface TestShop {
  id: string;
  slug: string;
  host: string;
  databaseName: string;
  /** Direct SQL on the shop's database. */
  sql: pg.Pool;
}

export interface MultiShopApp {
  app: NestExpressApplication;
  config: AppConfig;
  control: ControlDatabase;
  controlSql: pg.Pool;
  controlDatabaseName: string;
  adminUrl: string;
  shops: Record<string, TestShop>;
  shopsService: ShopsService;
  /** supertest against the app. */
  http: () => ReturnType<typeof request>;
  /** A request to an address: `at('shop-a.test').post('/auth/login')…`. */
  at: (host: string) => {
    get: (path: string) => request.Test;
    post: (path: string) => request.Test;
  };
  /**
   * `http()` of one shop: every request it makes comes to that address, so what is written for one
   * server (`stockKit`, which only needs `http`) works on a shop of this one.
   */
  shop: (host: string) => Pick<TestApp, 'http'>;
  login: (host: string, password: string) => Promise<AccessTokenResponse>;
  close: () => Promise<void>;
}

async function createShopDatabase(adminUrl: string, kind: ShopDatabase): Promise<string> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  if (kind === 'missing') return name;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      kind === 'migrated'
        ? `CREATE DATABASE ${name} TEMPLATE ${inject('templateDatabase')}`
        : `CREATE DATABASE ${name}`,
    );
  } finally {
    await admin.end();
  }
  if (kind === 'broken') {
    const shop = new pg.Client({ connectionString: withDatabase(adminUrl, name) });
    await shop.connect();
    try {
      await shop.query('CREATE TABLE audit_log (note text)');
    } finally {
      await shop.end();
    }
  }
  return name;
}

/**
 * The real app in multi-shop mode (ADR 0029): a control database of its own and a database for each
 * shop (a copy of the migrated template), each shop with an address. Pools are kept small, so many
 * test files can run at once on the one test server.
 */
export async function createMultiShopApp(
  specs: ShopSpec[],
  options: { env?: Record<string, string> } = {},
): Promise<MultiShopApp> {
  const adminUrl = inject('postgresAdminUrl');
  const controlDatabaseName = `control_${randomUUID().replaceAll('-', '')}`;
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: adminUrl,
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
    MULTI_SHOP: 'true',
    CONTROL_DATABASE_NAME: controlDatabaseName,
    SHOP_POOL_MAX: '2',
    SETUP_CODE_SECRET: TEST_SETUP_CODE_SECRET,
    ...options.env,
  });
  await prepareControlDatabase(config);
  const controlSql = new pg.Pool({
    connectionString: withDatabase(adminUrl, controlDatabaseName),
    max: 2,
  });

  const shops: Record<string, TestShop> = {};
  for (const spec of specs) {
    const databaseName = await createShopDatabase(adminUrl, spec.database ?? 'migrated');
    const state = spec.state ?? 'active';
    const { rows } = await controlSql.query<{ id: string }>(
      `INSERT INTO shop (slug, db_name, state, suspended_at, closed_at)
       VALUES ($1, $2, $3::shop_state,
               CASE WHEN $3 = 'suspended' THEN now() END,
               CASE WHEN $3 = 'closed' THEN now() END)
       RETURNING id`,
      [spec.slug, databaseName, state],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('the shop was not made');
    await controlSql.query('INSERT INTO shop_host (host, shop_id) VALUES ($1, $2)', [
      spec.host,
      id,
    ]);
    shops[spec.slug] = {
      id,
      slug: spec.slug,
      host: spec.host,
      databaseName,
      sql: new pg.Pool({ connectionString: withDatabase(adminUrl, databaseName), max: 1 }),
    };
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureHttp(app);
  await app.init();

  const shopsService = app.get(ShopsService);
  for (const spec of specs) {
    if (spec.ownerPassword === undefined) continue;
    if (spec.database && spec.database !== 'migrated') {
      throw new Error(`The shop "${spec.slug}" has no schema yet, so it cannot have an owner`);
    }
    const password = spec.ownerPassword;
    await shopsService.runAsShop(spec.slug, () =>
      app.get(AuthService).setOwner({ username: 'owner', password, displayName: spec.slug }),
    );
  }

  const http = () => request(app.getHttpServer());
  const at = (host: string) => ({
    get: (path: string) => http().get(path).set('Host', host),
    post: (path: string) => http().post(path).set('Host', host),
  });
  // A new agent for each request, so no cookie is kept from one to the next.
  const shop = (host: string): Pick<TestApp, 'http'> => ({
    http: () => request.agent(app.getHttpServer()).set('Host', host),
  });
  return {
    app,
    config,
    control: app.get(ControlDatabase),
    controlSql,
    controlDatabaseName,
    adminUrl,
    shops,
    shopsService,
    http,
    at,
    shop,
    login: async (host, password) => {
      const response = await at(host)
        .post('/auth/login')
        .send({ username: 'owner', password })
        .expect(200);
      return accessTokenResponseSchema.parse(response.body);
    },
    close: async () => {
      await app.close();
      await controlSql.end();
      await Promise.all(Object.values(shops).map((shop) => shop.sql.end()));
    },
  };
}

/** Changes a shop's state in the control database, as the operator's tool will. */
export async function setShopState(
  t: Pick<MultiShopApp, 'control'>,
  slug: string,
  state: controlSchema.ShopState,
): Promise<void> {
  const now = new Date();
  await t.control.db
    .update(controlSchema.shop)
    .set({
      state,
      suspendedAt: state === 'suspended' ? now : null,
      closedAt: state === 'closed' ? now : null,
    })
    .where(eq(controlSchema.shop.slug, slug));
}
