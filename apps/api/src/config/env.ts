import { z } from 'zod';

/**
 * A database name the API creates or opens by name: lower case, so it is safe inside a quoted
 * identifier (`CREATE DATABASE` takes no parameters). The control database's own CHECK constraint
 * on `shop.db_name` says the same in SQL (ADR 0029).
 */
export const DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_]{2,62}$/;

/** The database a postgres:// URL points at. */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

// Every variable the API reads. Documented in .env.example; compose files set them in Docker.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
    /** Apply pending migrations before listening (single API instance). */
    MIGRATE_ON_START: z.stringbool().default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** HS256 key for access tokens: `openssl rand -base64 48`. */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Browser path of the auth routes: Caddy serves the API under /api. */
    AUTH_COOKIE_PATH: z.string().startsWith('/').default('/api/auth'),
    /** Login attempts per client IP per minute (brute-force guard). */
    AUTH_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
    /** Token refreshes per client IP per minute: one per page load, so above login's limit. */
    AUTH_REFRESH_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
    /** Registrations per client IP per minute: each one hashes a password, so it is kept low. */
    AUTH_REGISTER_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
    /**
     * Whether the sign-up page may create the first owner (ADR 0023). It only ever works on a
     * server with no owner; turn it off on a server that should be set up with `make owner`.
     */
    OWNER_SIGNUP_ENABLED: z.stringbool().default(true),
    /**
     * Several shops on one server, one database for each (ADR 0029). Off, the server is what it
     * was before: one shop, the database in DATABASE_URL, no control database.
     */
    MULTI_SHOP: z.stringbool().default(false),
    /**
     * The control database that lists the shops and their addresses (ADR 0029). It is made on the
     * server DATABASE_URL points at, with the same login. Read only when MULTI_SHOP is on.
     */
    CONTROL_DATABASE_NAME: z
      .string()
      .regex(DATABASE_NAME_PATTERN, 'must be a lower-case database name: a-z, 0-9 and _')
      .default('fabric_control'),
    /**
     * Most connections one shop's pool holds open (ADR 0029). A pool is made when its shop is first
     * used and an idle pool holds none. Shops times this, plus the control pool, a migration and a
     * backup, must stay under Postgres' `max_connections` (100 by default).
     */
    SHOP_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    /**
     * The secret that setup codes are hashed with (ADR 0029). Only a hash of a code is kept, so
     * without it no code can be made or checked; a leaked database alone cannot give a code. The
     * commands that make a code (`make shop-new`, `make shop-code`) need it. Read only when
     * MULTI_SHOP is on. With MULTI_SHOP on the server does not start without it, because the
     * sign-up of a shop checks the code with it (Step 6); the commands that make a code refuse
     * too. Optional here so that `make shop-adopt` and a one-shop server need none.
     */
    SETUP_CODE_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.JWT_ACCESS_SECRET.includes('change-me'), {
    path: ['JWT_ACCESS_SECRET'],
    message: 'still the example value; generate a real secret',
  })
  .refine(
    (env) =>
      !env.MULTI_SHOP || env.SETUP_CODE_SECRET === undefined || env.SETUP_CODE_SECRET.length >= 32,
    { path: ['SETUP_CODE_SECRET'], message: 'must be at least 32 characters' },
  )
  .refine(
    (env) => !env.MULTI_SHOP || databaseNameOf(env.DATABASE_URL) !== env.CONTROL_DATABASE_NAME,
    {
      path: ['CONTROL_DATABASE_NAME'],
      message: 'must not be the database in DATABASE_URL: the control database is separate',
    },
  );

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly migrateOnStart: boolean;
  readonly logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  /** Several shops on one server (ADR 0029); null is the single-shop server of today. */
  readonly multiShop: {
    readonly controlDatabaseName: string;
    /** Most connections of each shop's pool. */
    readonly shopPoolMax: number;
    /** Hashes setup codes; undefined until the operator sets SETUP_CODE_SECRET. */
    readonly setupCodeSecret: string | undefined;
  } | null;
  readonly auth: {
    readonly accessSecret: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlDays: number;
    readonly cookiePath: string;
    readonly loginRateLimit: number;
    readonly refreshRateLimit: number;
    readonly registerRateLimit: number;
    readonly ownerSignupEnabled: boolean;
    /** Secure cookies everywhere but local development and tests (plain http). */
    readonly cookieSecure: boolean;
  };
}

export class InvalidConfigError extends Error {
  override readonly name = 'InvalidConfigError';
}

/** Validates the environment once at startup. Messages name the variable, never its value. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new InvalidConfigError(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    migrateOnStart: data.MIGRATE_ON_START,
    logLevel: data.LOG_LEVEL,
    multiShop: data.MULTI_SHOP
      ? {
          controlDatabaseName: data.CONTROL_DATABASE_NAME,
          shopPoolMax: data.SHOP_POOL_MAX,
          setupCodeSecret: data.SETUP_CODE_SECRET,
        }
      : null,
    auth: {
      accessSecret: data.JWT_ACCESS_SECRET,
      accessTtlSeconds: data.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: data.REFRESH_TOKEN_TTL_DAYS,
      cookiePath: data.AUTH_COOKIE_PATH,
      loginRateLimit: data.AUTH_LOGIN_RATE_LIMIT,
      refreshRateLimit: data.AUTH_REFRESH_RATE_LIMIT,
      registerRateLimit: data.AUTH_REGISTER_RATE_LIMIT,
      ownerSignupEnabled: data.OWNER_SIGNUP_ENABLED,
      cookieSecure: data.NODE_ENV === 'production',
    },
  };
}
