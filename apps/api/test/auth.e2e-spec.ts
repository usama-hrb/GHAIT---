import {
  accessTokenResponseSchema,
  authUserSchema,
  errorResponseSchema,
  HEADERS,
  REFRESH_COOKIE,
} from '@fabric/contracts';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { createTestApp, OWNER, refreshCookieOf, type TestApp } from './support/app.js';

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

// Each group gets its own app: the login rate limit (5 a minute) would trip a shared one.
describe('login', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('protects every route by default: 401 without a token', async () => {
    const response = await t.http().get('/settings').expect(401);
    expect(errorCode(response.body)).toBe('unauthorized');
    await t.http().get('/settings').set('authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('logs the owner in: access token in the body, refresh token in an httpOnly cookie', async () => {
    const response = await t
      .http()
      .post('/auth/login')
      .set(HEADERS.deviceId, 'desk-1')
      .send({ username: ' Owner ', password: OWNER.password })
      .expect(200);
    const body = accessTokenResponseSchema.parse(response.body);
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { username: 'owner', displayName: OWNER.displayName, role: 'owner' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/);

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE}=`),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const me = await t
      .http()
      .get('/auth/me')
      .auth(body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(authUserSchema.parse(me.body).username).toBe('owner');

    const { rows } = await t.sql.query<{ device_id: string }>(
      `SELECT device_id FROM auth_session ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.device_id).toBe('desk-1');
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrong = await t
      .http()
      .post('/auth/login')
      .send({ username: OWNER.username, password: 'wrong password here' })
      .expect(401);
    const unknown = await t
      .http()
      .post('/auth/login')
      .send({ username: 'nobody', password: 'wrong password here' })
      .expect(401);
    expect(errorResponseSchema.parse(wrong.body).error).toMatchObject({
      code: 'invalid_credentials',
      message: 'Invalid username or password',
    });
    expect(errorResponseSchema.parse(unknown.body).error.message).toBe(
      errorResponseSchema.parse(wrong.body).error.message,
    );
  });

  it('validates the login body with the contract', async () => {
    const response = await t.http().post('/auth/login').send({ username: 'a b' }).expect(400);
    const { error } = errorResponseSchema.parse(response.body);
    expect(error.code).toBe('validation_failed');
    expect(error.issues?.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
  });

  it('audits the login, with the owner as actor', async () => {
    const { rows } = await t.sql.query<{ action: string; actor_id: string; entity: string }>(
      `SELECT action, actor_id, entity FROM audit_log WHERE action = 'login'`,
    );
    const { rows: owners } = await t.sql.query<{ id: string }>(
      `SELECT id FROM app_user WHERE username = 'owner'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ entity: 'app_user', actor_id: owners[0]?.id });
  });
});

describe('refresh tokens', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('rotates the refresh token, and a reused one signs out the whole family', async () => {
    const session = await t.login();

    const first = await t
      .http()
      .post('/auth/refresh')
      .set('cookie', session.refreshCookie)
      .expect(200);
    accessTokenResponseSchema.parse(first.body);
    const rotated = refreshCookieOf(first);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(session.refreshCookie);

    // The old token again, a minute later: reuse. Both it and its successor are now revoked.
    await t.sql.query(
      `UPDATE auth_session SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`,
    );
    const reuse = await t
      .http()
      .post('/auth/refresh')
      .set('cookie', session.refreshCookie)
      .expect(401);
    expect(errorResponseSchema.parse(reuse.body).error.message).toMatch(/already used/);
    await t
      .http()
      .post('/auth/refresh')
      .set('cookie', rotated ?? '')
      .expect(401);

    const { rows } = await t.sql.query<{ reason: string }>(
      `SELECT reason FROM audit_log WHERE entity = 'auth_session' AND action = 'logout'`,
    );
    expect(rows.map((row) => row.reason)).toContain(
      'refresh token used twice: signed out everywhere',
    );
  });

  it('a client that missed its new cookie (aborted refresh) can retry within 30 s', async () => {
    const session = await t.login();
    const first = await t
      .http()
      .post('/auth/refresh')
      .set('cookie', session.refreshCookie)
      .expect(200);
    const missed = refreshCookieOf(first);

    // The response never reached the browser: it retries with the old cookie at once.
    const retry = await t
      .http()
      .post('/auth/refresh')
      .set('cookie', session.refreshCookie)
      .expect(200);
    const current = refreshCookieOf(retry);
    expect(current).not.toBe(missed);
    // The new cookie works.
    const next = await t
      .http()
      .post('/auth/refresh')
      .set('cookie', current ?? '')
      .expect(200);
    // The successor it never received is dead, and presenting it is reuse: signed out everywhere.
    await t
      .http()
      .post('/auth/refresh')
      .set('cookie', missed ?? '')
      .expect(401);
    await t
      .http()
      .post('/auth/refresh')
      .set('cookie', refreshCookieOf(next) ?? '')
      .expect(401);
  });

  it('refuses a refresh without a cookie or with an unknown token', async () => {
    await t.http().post('/auth/refresh').expect(401);
    await t.http().post('/auth/refresh').set('cookie', `${REFRESH_COOKIE}=forged`).expect(401);
  });

  it('logs out: the refresh token stops working; logging out twice is harmless', async () => {
    const session = await t.login();
    await t.http().post('/auth/logout').set('cookie', session.refreshCookie).expect(204);
    await t.http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
    await t.http().post('/auth/logout').set('cookie', session.refreshCookie).expect(204);
    await t.http().post('/auth/logout').expect(204);
  });
});

describe('roles and the owner account', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('lets the owner do everything, a partner only read, and no one else in (BUILD_PROMPTS 4.2)', async () => {
    const jwt = t.app.get(JwtService);
    const tokenFor = (role: string) =>
      jwt.signAsync(
        { role, sid: crypto.randomUUID() },
        {
          subject: crypto.randomUUID(),
          secret: t.config.auth.accessSecret,
          issuer: 'fabric-shop',
          audience: 'fabric-shop-api',
          expiresIn: 60,
        },
      );
    const partner = await tokenFor('partner');
    await t.http().get('/settings').auth(partner, { type: 'bearer' }).expect(200);
    const refused = await t
      .http()
      .put(`/fabrics/${crypto.randomUUID()}`)
      .auth(partner, { type: 'bearer' })
      .send({ name: 'x', refPricePerMeterCents: 1, minPricePerMeterCents: 1 })
      .expect(403);
    expect(errorCode(refused.body)).toBe('forbidden');
    await t
      .http()
      .post('/sync/push')
      .auth(partner, { type: 'bearer' })
      .send({ ops: [] })
      .expect(403);
    await t
      .http()
      .get('/settings')
      .auth(await tokenFor('cashier'), { type: 'bearer' })
      .expect(403);

    const forged = await jwt.signAsync(
      { role: 'owner', sid: crypto.randomUUID() },
      {
        subject: crypto.randomUUID(),
        secret: 'another-secret-that-is-long-enough-00',
        expiresIn: 60,
      },
    );
    await t.http().get('/settings').auth(forged, { type: 'bearer' }).expect(401);
  });

  it('a partner account (create-partner-user) signs in and reads; its writes are refused', async () => {
    const auth = t.app.get(AuthService);
    await expect(
      auth.setPartnerUser({
        username: 'shareek',
        password: 'a-long-partner-password',
        displayName: 'الشريك',
      }),
    ).resolves.toBe('created');
    await expect(
      auth.setPartnerUser({ username: OWNER.username, password: 'another-long-password' }),
    ).rejects.toThrow(/owner's account/);
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'shareek', password: 'a-long-partner-password' })
      .expect(200);
    const { accessToken, user } = accessTokenResponseSchema.parse(login.body);
    expect(user.role).toBe('partner');
    await t.http().get('/fabrics').auth(accessToken, { type: 'bearer' }).expect(200);
    await t.http().get('/sync/pull?since=0').auth(accessToken, { type: 'bearer' }).expect(200);
    // Registering its device changes no shop data: allowed, so its sync works.
    await t
      .http()
      .post('/devices/register')
      .auth(accessToken, { type: 'bearer' })
      .set(HEADERS.deviceId, 'partner-phone')
      .expect(200);
    await t
      .http()
      .put(`/partners/${crypto.randomUUID()}`)
      .auth(accessToken, { type: 'bearer' })
      .send({ name: 'x', ownershipBp: 5000, isOwner: false })
      .expect(403);
  });

  it('create-owner: resets the password and signs the owner out everywhere', async () => {
    const auth = t.app.get(AuthService);
    const session = await t.login();
    await expect(
      auth.setOwner({ username: 'owner', password: 'a brand new long password' }),
    ).resolves.toBe('password_reset');
    await t.http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
    await t
      .http()
      .post('/auth/login')
      .send({ username: 'owner', password: 'a brand new long password' })
      .expect(200);
    await expect(
      auth.setOwner({ username: 'someone-else', password: 'a brand new long password' }),
    ).rejects.toThrow(/An owner already exists \(owner\)/);
    await expect(auth.setOwner({ username: 'owner', password: 'too short' })).rejects.toThrow();
  });
});

describe('login rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('allows 5 login attempts a minute per client', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await t
        .http()
        .post('/auth/login')
        .send({ username: 'owner', password: 'wrong guess' })
        .expect(401);
    }
    const blocked = await t
      .http()
      .post('/auth/login')
      .send({ username: OWNER.username, password: OWNER.password })
      .expect(429);
    expect(errorCode(blocked.body)).toBe('too_many_requests');
  });
});

describe('refresh rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { AUTH_REFRESH_RATE_LIMIT: '2' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('limits refreshes by AUTH_REFRESH_RATE_LIMIT, on a counter of their own', async () => {
    let cookie = (await t.login()).refreshCookie;
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await t.http().post('/auth/refresh').set('cookie', cookie).expect(200);
      cookie = refreshCookieOf(response) ?? '';
    }
    const blocked = await t.http().post('/auth/refresh').set('cookie', cookie).expect(429);
    expect(errorCode(blocked.body)).toBe('too_many_requests');
    // Logins still count against their own limit only.
    await t.login();
  });
});
