import { z } from 'zod';

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
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.JWT_ACCESS_SECRET.includes('change-me'), {
    path: ['JWT_ACCESS_SECRET'],
    message: 'still the example value; generate a real secret',
  });

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly migrateOnStart: boolean;
  readonly logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  readonly auth: {
    readonly accessSecret: string;
    readonly accessTtlSeconds: number;
    readonly refreshTtlDays: number;
    readonly cookiePath: string;
    readonly loginRateLimit: number;
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
    auth: {
      accessSecret: data.JWT_ACCESS_SECRET,
      accessTtlSeconds: data.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: data.REFRESH_TOKEN_TTL_DAYS,
      cookiePath: data.AUTH_COOKIE_PATH,
      loginRateLimit: data.AUTH_LOGIN_RATE_LIMIT,
      cookieSecure: data.NODE_ENV === 'production',
    },
  };
}
