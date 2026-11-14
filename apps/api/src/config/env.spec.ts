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
      multiShop: null,
      auth: {
        accessSecret: JWT_ACCESS_SECRET,
        accessTtlSeconds: 900,
        refreshTtlDays: 30,
        cookiePath: '/api/auth',
        loginRateLimit: 5,
        refreshRateLimit: 30,
        registerRateLimit: 5,
        ownerSignupEnabled: true,
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

  it('lets the operator close the first-owner sign-up and set its rate limit', () => {
    expect(
      parseConfig({ ...base, OWNER_SIGNUP_ENABLED: 'false', AUTH_REGISTER_RATE_LIMIT: '2' }).auth,
    ).toMatchObject({ ownerSignupEnabled: false, registerRateLimit: 2 });
  });

  it('keeps the server single-shop unless MULTI_SHOP is on, and ignores the control name then', () => {
    expect(parseConfig({ ...base, MULTI_SHOP: 'false' }).multiShop).toBeNull();
    expect(parseConfig({ ...base, CONTROL_DATABASE_NAME: 'fabric_shop' }).multiShop).toBeNull();
  });

  it('names the control database when MULTI_SHOP is on', () => {
    expect(parseConfig({ ...base, MULTI_SHOP: 'true' }).multiShop).toEqual({
      controlDatabaseName: 'fabric_control',
      shopPoolMax: 5,
    });
    expect(
      parseConfig({ ...base, MULTI_SHOP: 'true', CONTROL_DATABASE_NAME: 'control_two' }).multiShop,
    ).toEqual({ controlDatabaseName: 'control_two', shopPoolMax: 5 });
  });

  describe('SETUP_CODE_SECRET (ADR 0029, setup codes)', () => {
    const SECRET = 'a-setup-code-secret-of-thirty-two-chars!';

    it('is unset by default, and an empty value (compose passes one) counts as unset', () => {
      expect(
        parseConfig({ ...base, MULTI_SHOP: 'true' }).multiShop?.setupCodeSecret,
      ).toBeUndefined();
      expect(
        parseConfig({ ...base, MULTI_SHOP: 'true', SETUP_CODE_SECRET: '' }).multiShop
          ?.setupCodeSecret,
      ).toBeUndefined();
    });

    it('is read when MULTI_SHOP is on', () => {
      expect(
        parseConfig({ ...base, MULTI_SHOP: 'true', SETUP_CODE_SECRET: SECRET }).multiShop
          ?.setupCodeSecret,
      ).toBe(SECRET);
    });

    it('must be at least 32 characters, so a weak key is refused at start', () => {
      expect(() =>
        parseConfig({ ...base, MULTI_SHOP: 'true', SETUP_CODE_SECRET: 'too-short' }),
      ).toThrow(InvalidConfigError);
      expect(() =>
        parseConfig({ ...base, MULTI_SHOP: 'true', SETUP_CODE_SECRET: 'x'.repeat(31) }),
      ).toThrow(InvalidConfigError);
      expect(
        parseConfig({ ...base, MULTI_SHOP: 'true', SETUP_CODE_SECRET: 'x'.repeat(32) }).multiShop
          ?.setupCodeSecret,
      ).toHaveLength(32);
    });

    it('is ignored while MULTI_SHOP is off, as the rest of the multi-shop settings are', () => {
      expect(parseConfig({ ...base, SETUP_CODE_SECRET: 'short' }).multiShop).toBeNull();
    });
  });

  it('sets the size of each shop pool with SHOP_POOL_MAX', () => {
    expect(
      parseConfig({ ...base, MULTI_SHOP: 'true', SHOP_POOL_MAX: '2' }).multiShop?.shopPoolMax,
    ).toBe(2);
  });

  it.each([
    ['non-boolean MULTI_SHOP', { MULTI_SHOP: 'maybe' }],
    ['upper-case CONTROL_DATABASE_NAME', { CONTROL_DATABASE_NAME: 'Fabric_Control' }],
    ['CONTROL_DATABASE_NAME with a quote', { CONTROL_DATABASE_NAME: 'control"; DROP DATABASE x' }],
    ['too short CONTROL_DATABASE_NAME', { CONTROL_DATABASE_NAME: 'ab' }],
    ['CONTROL_DATABASE_NAME over 63 characters', { CONTROL_DATABASE_NAME: `c${'x'.repeat(63)}` }],
    ['CONTROL_DATABASE_NAME that is the shop database', { CONTROL_DATABASE_NAME: 'fabric_shop' }],
    ['SHOP_POOL_MAX of zero', { SHOP_POOL_MAX: '0' }],
    ['SHOP_POOL_MAX above 20', { SHOP_POOL_MAX: '21' }],
    ['non-numeric SHOP_POOL_MAX', { SHOP_POOL_MAX: 'many' }],
  ])('rejects %s', (_label, extra) => {
    expect(() => parseConfig({ ...base, MULTI_SHOP: 'true', ...extra })).toThrow(
      InvalidConfigError,
    );
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
    ['non-boolean OWNER_SIGNUP_ENABLED', { ...base, OWNER_SIGNUP_ENABLED: 'sometimes' }],
    ['zero AUTH_REGISTER_RATE_LIMIT', { ...base, AUTH_REGISTER_RATE_LIMIT: '0' }],
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
