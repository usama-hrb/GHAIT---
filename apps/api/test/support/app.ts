import { randomUUID } from 'node:crypto';
import { accessTokenResponseSchema, REFRESH_COOKIE } from '@fabric/contracts';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp } from '../../src/common/index.js';
import { type AppConfig, parseConfig } from '../../src/config/index.js';
import { adoptShop, bindShop, issueShopCode, type ShopRef } from '../../src/database/index.js';
import { AccountsService } from '../../src/modules/accounts/index.js';
import { AuthService } from '../../src/modules/auth/index.js';
import { withDatabase } from './database-url.js';

export const OWNER = {
  username: 'owner',
  password: 'correct horse battery staple',
  displayName: 'صاحب المحل',
} as const;

export interface Session {
  accessToken: string;
  /** `fabric_refresh=<token>`, ready for a Cookie header. */
  refreshCookie: string;
}

/**
 * `TEST_SHOPS=adopted` runs every spec that uses `createTestApp` on a multi-shop server (ADR 0029,
 * Step 4): the test database is adopted as the one shop of a control database, and requests find it
 * by the address supertest uses. The specs are the same files; this is the proof that adopting the
 * live shop changes nothing a shop can see. `pnpm test:e2e:adopted` sets it.
 */
const ADOPTED_BY_DEFAULT = process.env.TEST_SHOPS === 'adopted';

/** The shop and the address of an adopted test app: `127.0.0.1` is what supertest connects to. */
const ADOPTED_SLUG = 'shop_one';
const ADOPTED_HOST = '127.0.0.1';
/** Hashes the setup codes of a multi-shop test server (at least 32 characters). */
export const TEST_SETUP_CODE_SECRET = 'integration-test-setup-code-secret-0123456789';

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  /** The adopted shop (multi-shop mode), or null: a one-shop server. */
  shop: ShopRef | null;
  /** supertest against the app. */
  http: () => ReturnType<typeof request>;
  /** Direct SQL on this test file's database. */
  sql: pg.Pool;
  login: () => Promise<Session>;
  close: () => Promise<void>;
}

/**
 * A partner (a business record) with a login, the way `make partner-user` makes one (ADR 0024):
 * the partner row is inserted directly, then the login goes through the same service the command
 * uses. Returns the partner's id.
 */
export async function addPartnerLogin(
  t: Pick<TestApp, 'app' | 'sql'>,
  input: { username: string; password: string; displayName?: string; partnerName?: string },
): Promise<string> {
  const id = randomUUID();
  const name = input.partnerName ?? `Partner ${input.username}`;
  await t.sql.query(
    `INSERT INTO partner (id, name, ownership_bp, is_owner, device_id) VALUES ($1, $2, 1000, false, 'test')`,
    [id, name],
  );
  await t.app.get(AccountsService).setPartnerLogin({
    partner: id,
    username: input.username,
    password: input.password,
    displayName: input.displayName,
  });
  return id;
}

/** `fabric_refresh=<token>` from a response's Set-Cookie, or undefined. */
export function refreshCookieOf(response: request.Response): string | undefined {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header)
    ? header.filter((c): c is string => typeof c === 'string')
    : [];
  const cookie = cookies.find(
    (c) => c.startsWith(`${REFRESH_COOKIE}=`) && !c.startsWith(`${REFRESH_COOKIE}=;`),
  );
  return cookie?.split(';')[0];
}

/**
 * `app.get(Service)` for a test that calls a service itself, as `make owner` does: on a multi-shop
 * server a service works for the shop its work is bound to, so each call runs bound to `shop`. A
 * synchronous method stays synchronous (`bindShop` returns what the work returns). Only the test's
 * own calls are bound: services call each other directly, so a shop is entered once.
 */
function boundTo(app: NestExpressApplication, shop: ShopRef): NestExpressApplication {
  const bound = (instance: unknown): unknown => {
    if (typeof instance !== 'object' || instance === null) return instance;
    return new Proxy(instance, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown =>
          bindShop(shop, () => Reflect.apply(value, target, args) as unknown);
      },
    });
  };
  return new Proxy(app, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'get') {
        return (...args: unknown[]): unknown => bound(Reflect.apply(value, target, args));
      }
      return (...args: unknown[]): unknown => Reflect.apply(value, target, args);
    },
  });
}

/** A request agent whose sign-up requests carry `code` unless they bring a code of their own. */
function signingUpWith(
  agent: ReturnType<typeof request>,
  code: string,
): ReturnType<typeof request> {
  const post = agent.post.bind(agent);
  agent.post = (url: string) => {
    const test = post(url);
    if (url !== '/auth/register') return test;
    const send = test.send.bind(test);
    test.send = (body?: string | object) =>
      send(
        typeof body === 'object' && !Array.isArray(body) && !('setupCode' in body)
          ? { setupCode: code, ...body }
          : body,
      );
    return test;
  };
  return agent;
}

async function createDatabaseFromTemplate(adminUrl: string): Promise<string> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
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
 * A full app (same modules, filters, guards and HTTP setup as main.ts) on a fresh, migrated
 * database, with the owner account created (unless `owner: false`).
 */
export async function createTestApp(
  options: {
    /** Extra modules, controllers and providers (e.g. a test-only controller). */
    imports?: (Type | DynamicModule)[];
    controllers?: Type[];
    providers?: Provider[];
    env?: Record<string, string>;
    /** Whether the owner account exists from the start (default); false: a server not yet set up. */
    owner?: boolean;
    /** `adopted`: a multi-shop server with this database adopted as its shop. Default: see ADOPTED_BY_DEFAULT. */
    shops?: 'one' | 'adopted';
  } = {},
): Promise<TestApp> {
  const adopted = (options.shops ?? (ADOPTED_BY_DEFAULT ? 'adopted' : 'one')) === 'adopted';
  const databaseUrl = await createDatabaseFromTemplate(inject('postgresAdminUrl'));
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
    ...(adopted
      ? {
          MULTI_SHOP: 'true',
          CONTROL_DATABASE_NAME: `control_${randomUUID().replaceAll('-', '')}`,
          // The pool a one-shop server has, so a spec holds the connections it always did.
          SHOP_POOL_MAX: '10',
          SETUP_CODE_SECRET: TEST_SETUP_CODE_SECRET,
        }
      : {}),
    ...options.env,
  });
  // The rollout's order: the live database exists, it is adopted, then the server starts with the flag on.
  const adoption = adopted
    ? await adoptShop(config, { slug: ADOPTED_SLUG, host: ADOPTED_HOST, actor: 'test' })
    : null;
  const shop: ShopRef | null = adoption
    ? { id: adoption.id, slug: adoption.slug, databaseName: adoption.dbName }
    : null;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(options.imports ?? [])],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureHttp(nest);
  await nest.init();
  const app = shop ? boundTo(nest, shop) : nest;
  if (options.owner !== false) await app.get(AuthService).setOwner(OWNER);

  const sql = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  // A multi-shop server lets a shop with no owner be signed up only with its setup code (Step 6).
  // The specs are the same files as for the one-shop server, so the harness plays the operator: it
  // makes the code (`make shop-code`), and its requests add it to a sign-up, as the form does.
  const setupCode =
    adoption && options.owner === false
      ? (await issueShopCode(config, { slug: adoption.slug, actor: 'test' })).code
      : null;
  const http = () => {
    const agent = request(app.getHttpServer());
    return setupCode === null ? agent : signingUpWith(agent, setupCode);
  };
  return {
    app,
    config,
    shop,
    http,
    sql,
    login: async () => {
      const response = await http()
        .post('/auth/login')
        .send({ username: OWNER.username, password: OWNER.password })
        .expect(200);
      const refreshCookie = refreshCookieOf(response);
      if (!refreshCookie) throw new Error('login set no refresh cookie');
      return {
        accessToken: accessTokenResponseSchema.parse(response.body).accessToken,
        refreshCookie,
      };
    },
    close: async () => {
      await nest.close();
      await sql.end();
    },
  };
}
