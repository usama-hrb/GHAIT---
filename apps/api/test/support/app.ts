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

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
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
  } = {},
): Promise<TestApp> {
  const databaseUrl = await createDatabaseFromTemplate(inject('postgresAdminUrl'));
  const config = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
    ...options.env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config), ...(options.imports ?? [])],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureHttp(app);
  await app.init();
  if (options.owner !== false) await app.get(AuthService).setOwner(OWNER);

  const sql = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const http = () => request(app.getHttpServer());
  return {
    app,
    config,
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
      await app.close();
      await sql.end();
    },
  };
}
