import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseConfig } from './env.js';

const DATABASE_URL = 'postgres://fabric:s3cret-pass@localhost:5432/fabric_shop';
const JWT_ACCESS_SECRET = 'a-test-secret-that-is-long-enough-1234';
const base = { DATABASE_URL, JWT_ACCESS_SECRET };

describe('parseConfig', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(parseConfig(base)).toEqual({
      nodeEnv: 'development',
      port: 4000,
      databaseUrl: DATABASE_URL,
      migrateOnStart: false,
      logLevel: 'info',
      auth: {
        accessSecret: JWT_ACCESS_SECRET,
        accessTtlSeconds: 900,
        refreshTtlDays: 30,
        cookiePath: '/api/auth',
        loginRateLimit: 5,
        refreshRateLimit: 30,
        cookieSecure: false,
      },
    });
  });

  it('reads NODE_ENV, coerces numbers and booleans', () => {
    const config = parseConfig({
      ...base,
      NODE_ENV: 'production',
      PORT: '8080',
      MIGRATE_ON_START: 'true',
      ACCESS_TOKEN_TTL_SECONDS: '600',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      migrateOnStart: true,
      auth: { accessTtlSeconds: 600, cookieSecure: true },
    });
  });

  it('accepts the postgresql:// scheme', () => {
    expect(parseConfig({ ...base, DATABASE_URL: 'postgresql://u:p@db/x' }).databaseUrl).toBe(
      'postgresql://u:p@db/x',
    );
  });

  it.each([
    ['missing DATABASE_URL', { JWT_ACCESS_SECRET }],
    ['missing JWT_ACCESS_SECRET', { DATABASE_URL }],
    ['short JWT_ACCESS_SECRET', { DATABASE_URL, JWT_ACCESS_SECRET: 'short' }],
    ['non-postgres DATABASE_URL', { ...base, DATABASE_URL: 'mysql://u:p@db/x' }],
    ['empty PORT', { ...base, PORT: '' }],
    ['non-numeric PORT', { ...base, PORT: 'abc' }],
    ['PORT out of range', { ...base, PORT: '70000' }],
    ['unknown NODE_ENV', { ...base, NODE_ENV: 'staging' }],
    ['non-boolean MIGRATE_ON_START', { ...base, MIGRATE_ON_START: 'maybe' }],
    ['access token TTL over an hour', { ...base, ACCESS_TOKEN_TTL_SECONDS: '7200' }],
    ['relative AUTH_COOKIE_PATH', { ...base, AUTH_COOKIE_PATH: 'api/auth' }],
    [
      'the example secret in production',
      { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-only-change-me-0123456789abcdef' },
    ],
  ])('rejects %s', (_label, env) => {
    expect(() => parseConfig(env)).toThrow(InvalidConfigError);
  });

  it('names the invalid variable without echoing secrets', () => {
    const run = () =>
      parseConfig({ ...base, DATABASE_URL: 'mysql://user:s3cret-pass@db/x', PORT: 'abc' });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).toThrow(/PORT/);
    expect(run).not.toThrow(/s3cret-pass/);
    expect(() => parseConfig({ DATABASE_URL, JWT_ACCESS_SECRET: 'short-secret' })).not.toThrow(
      /short-secret/,
    );
  });
});
