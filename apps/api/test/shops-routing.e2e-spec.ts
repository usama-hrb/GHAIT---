import { hkdfSync } from 'node:crypto';
import { SHOP_ISSUES } from '@fabric/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TransactionHost } from '../src/database/index.js';
import { LOOKUP_TTL_MS, RETRY_AFTER_FAILURE_MS } from '../src/modules/shops/shop-lookup.js';
import { refreshCookieOf, createTestApp, OWNER, type TestApp } from './support/app.js';
import {
  createMultiShopApp,
  type MultiShopApp,
  setShopState,
  type ShopSpec,
} from './support/multi-shop-app.js';

/** The tests of the tenant router (ADR 0029, Step 2): the address of a request chooses the shop. */

const PASSWORD_A = 'the first shops password is long';
const PASSWORD_B = 'the second shops password is long';
const SECRET = 'integration-test-secret-0123456789abcdef';

const SHOPS: ShopSpec[] = [
  { slug: 'shop_a', host: 'a.shops.test', ownerPassword: PASSWORD_A },
  { slug: 'shop_b', host: 'b.shops.test', ownerPassword: PASSWORD_B },
  { slug: 'shop_off', host: 'off.shops.test', state: 'suspended' },
  { slug: 'shop_new', host: 'new.shops.test', state: 'provisioning' },
  { slug: 'shop_gone', host: 'gone.shops.test', state: 'closed' },
];

const A = 'a.shops.test';
const B = 'b.shops.test';

/** The key a shop's tokens are signed with: the server's secret and the shop's id (HKDF). */
function shopKey(shopId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', SECRET, Buffer.alloc(0), `fabric-shop/access-token/${shopId}`, 32),
  );
}

const later = (ms: number): void => {
  vi.setSystemTime(Date.now() + ms);
};

describe('one server, many shops: the address chooses the shop', () => {
  let t: MultiShopApp;
  let jwt: JwtService;

  beforeAll(async () => {
    t = await createMultiShopApp(SHOPS, { env: { AUTH_LOGIN_RATE_LIMIT: '1000' } });
    jwt = t.app.get(JwtService);
    // An address that was in use and is not any more.
    await t.controlSql.query(`INSERT INTO shop_host (host, shop_id, released_at)
      SELECT 'released.shops.test', id, now() FROM shop WHERE slug = 'shop_a'`);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('sign in', () => {
    it('works in each shop, with that shop’s own account, and says which shop answered', async () => {
      const a = await t.login(A, PASSWORD_A);
      const b = await t.login(B, PASSWORD_B);
      expect(a.shopId).toBe(t.shops['shop_a']?.id);
      expect(b.shopId).toBe(t.shops['shop_b']?.id);
      expect(a.user.username).toBe('owner');
      expect(b.user.username).toBe('owner');
      expect(a.shopId).not.toBe(b.shopId);
    });

    it('sets the refresh cookie for the address alone (no Domain), so two shops’ cookies never mix', async () => {
      const response = await t
        .at(A)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD_A })
        .expect(200);
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('fabric_refresh='),
      );
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).not.toMatch(/Domain=/i);
    });

    it('does not let one shop’s password open the other shop', async () => {
      const wrong = await t
        .at(B)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD_A });
      expect(wrong.status).toBe(401);
      expect(wrong.body).toMatchObject({ error: { code: 'invalid_credentials' } });
      await t
        .at(A)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD_B })
        .expect(401);
    });

    it('keeps each shop’s accounts in its own database', async () => {
      for (const slug of ['shop_a', 'shop_b']) {
        const sql = t.shops[slug]?.sql;
        if (!sql) throw new Error(`no shop ${slug}`);
        const { rows } = await sql.query<{ count: string }>('SELECT count(*) FROM app_user');
        expect(rows[0]?.count).toBe('1');
      }
    });

    it('says the shop in the sign-up status too', async () => {
      const response = await t.at(A).get('/auth/registration').expect(200);
      expect(response.body).toEqual({ open: false, shopId: t.shops['shop_a']?.id });
    });
  });

  describe('a token belongs to one shop', () => {
    it('shop A’s token is refused at shop B’s address, and the other way round', async () => {
      const a = await t.login(A, PASSWORD_A);
      const b = await t.login(B, PASSWORD_B);
      await t.at(A).get('/auth/me').set('authorization', `Bearer ${a.accessToken}`).expect(200);
      await t.at(B).get('/auth/me').set('authorization', `Bearer ${b.accessToken}`).expect(200);
      const crossed = await t.at(B).get('/auth/me').set('authorization', `Bearer ${a.accessToken}`);
      expect(crossed.status).toBe(401);
      expect(crossed.body).toMatchObject({ error: { code: 'unauthorized' } });
      await t.at(A).get('/auth/me').set('authorization', `Bearer ${b.accessToken}`).expect(401);
    });

    it('is signed with a key of its shop: a token that names shop B but is signed for shop A fails the signature', async () => {
      const a = await t.login(A, PASSWORD_A);
      const claims = jwt.decode<{ sub: string; sid: string }>(a.accessToken);
      const idB = t.shops['shop_b']?.id ?? '';
      const forged = await jwt.signAsync(
        { role: 'owner', sid: claims.sid, shop: idB },
        {
          subject: claims.sub,
          secret: shopKey(t.shops['shop_a']?.id ?? ''),
          expiresIn: 600,
          issuer: 'fabric-shop',
          audience: 'fabric-shop-api',
          algorithm: 'HS256',
        },
      );
      const response = await t.at(B).get('/auth/me').set('authorization', `Bearer ${forged}`);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: { message: 'Invalid or expired access token' },
      });
    });

    it('is also compared with the shop of the request: the right key with another shop’s id is refused for that reason', async () => {
      const b = await t.login(B, PASSWORD_B);
      const claims = jwt.decode<{ sub: string; sid: string }>(b.accessToken);
      const sign = (shop: string) =>
        jwt.signAsync(
          { role: 'owner', sid: claims.sid, shop },
          {
            subject: claims.sub,
            secret: shopKey(t.shops['shop_b']?.id ?? ''),
            expiresIn: 600,
            issuer: 'fabric-shop',
            audience: 'fabric-shop-api',
            algorithm: 'HS256',
          },
        );
      const honest = await sign(t.shops['shop_b']?.id ?? '');
      await t.at(B).get('/auth/me').set('authorization', `Bearer ${honest}`).expect(200);
      const lying = await t
        .at(B)
        .get('/auth/me')
        .set('authorization', `Bearer ${await sign(t.shops['shop_a']?.id ?? '')}`);
      expect(lying.status).toBe(401);
      expect(lying.body).toMatchObject({
        error: { message: 'This access token is not for this shop' },
      });
    });

    it('refuses a token made before the shop claim existed once, and the refresh cookie makes a good one', async () => {
      const first = await t
        .at(A)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD_A });
      const cookie = refreshCookieOf(first) ?? '';
      const claims = jwt.decode<{ sub: string; sid: string }>(
        (first.body as { accessToken: string }).accessToken,
      );
      const old = await jwt.signAsync(
        { role: 'owner', sid: claims.sid },
        {
          subject: claims.sub,
          secret: SECRET,
          expiresIn: 600,
          issuer: 'fabric-shop',
          audience: 'fabric-shop-api',
          algorithm: 'HS256',
        },
      );
      await t.at(A).get('/auth/me').set('authorization', `Bearer ${old}`).expect(401);

      const refreshed = await t.at(A).post('/auth/refresh').set('cookie', cookie).expect(200);
      const body = refreshed.body as { accessToken: string; shopId: string };
      expect(body.shopId).toBe(t.shops['shop_a']?.id);
      await t.at(A).get('/auth/me').set('authorization', `Bearer ${body.accessToken}`).expect(200);
    });

    it('does not let a refresh cookie of one shop make a token at another', async () => {
      const first = await t
        .at(A)
        .post('/auth/login')
        .send({ username: 'owner', password: PASSWORD_A });
      const cookie = refreshCookieOf(first) ?? '';
      await t.at(B).post('/auth/refresh').set('cookie', cookie).expect(401);
    });
  });

  describe('an address that does not lead to a served shop', () => {
    it('unknown: 404 with a fixed body', async () => {
      const response = await t.at('nobody.shops.test').get('/auth/registration');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'not_found',
          message: 'No shop is served at this address',
          requestId: expect.any(String) as unknown,
        },
      });
    });

    it('closed and released addresses answer exactly as an unknown one does', async () => {
      for (const host of ['gone.shops.test', 'released.shops.test']) {
        const response = await t.at(host).get('/auth/registration');
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
          error: { code: 'not_found', message: 'No shop is served at this address' },
        });
      }
    });

    it('a name that cannot be an address is unknown too, with no read of the control database', async () => {
      await t.at('UPPER_CASE_AND_BAD!').get('/auth/registration').expect(404);
    });

    it('suspended: 403, with the reason in the issue code', async () => {
      const response = await t.at('off.shops.test').post('/auth/login').send({
        username: 'owner',
        password: PASSWORD_A,
      });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          code: 'forbidden',
          issues: [{ code: SHOP_ISSUES.suspended }],
        },
      });
    });

    it('being made: 503 service_unavailable', async () => {
      const response = await t.at('new.shops.test').get('/auth/registration');
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ error: { code: 'service_unavailable' } });
    });

    it('/health is outside the rule: it answers at any address, with no shop', async () => {
      for (const host of ['nobody.shops.test', 'off.shops.test', 'new.shops.test', '127.0.0.1']) {
        await t.at(host).get('/health').expect(200, { status: 'ok' });
      }
      await t.at('nobody.shops.test').get('/health/').expect(200);
    });

    // The OpenAPI page is set up before the host step and shows no shop's data. It is as public as
    // it is on a one-shop server.
    it('the API docs show no shop and are outside the rule', async () => {
      await t.at('nobody.shops.test').get('/docs/json').expect(200);
    });
  });

  describe('where the address is read from', () => {
    // What the Next proxy of dev and e2e sends: the Host the browser used, with its port, as
    // X-Forwarded-Host (checked in next/dist/server/lib/router-utils/proxy-request.js).
    it('from the proxy’s X-Forwarded-Host when the proxy is a trusted one (loopback)', async () => {
      const response = await t
        .http()
        .get('/auth/registration')
        .set('Host', '127.0.0.1:4000')
        .set('X-Forwarded-Host', `${B}:3000`)
        .expect(200);
      expect(response.body).toMatchObject({ shopId: t.shops['shop_b']?.id });
    });

    it('with the port and the case of the Host header ignored', async () => {
      const response = await t.at('A.Shops.Test:3000').get('/auth/registration').expect(200);
      expect(response.body).toMatchObject({ shopId: t.shops['shop_a']?.id });
    });

    it('a header of the client cannot choose a shop', async () => {
      const response = await t
        .at(A)
        .get('/auth/registration')
        .set('x-shop', 'shop_b')
        .set('x-shop-id', t.shops['shop_b']?.id ?? '')
        .expect(200);
      expect(response.body).toMatchObject({ shopId: t.shops['shop_a']?.id });
    });
  });

  describe('the binding of work to a shop', () => {
    it('refuses to enter a second shop inside the work of the first', async () => {
      await expect(
        t.shopsService.runAsShop('shop_a', () =>
          t.shopsService.runAsShop('shop_b', () => Promise.resolve('never')),
        ),
      ).rejects.toThrow(/inside the work of shop "shop_a"/);
    });

    it('gives a transaction no database outside a shop', () => {
      const host = t.app.get(TransactionHost);
      expect(() => host.db).toThrow(/No shop is bound/);
      expect(() => host.run(() => Promise.resolve())).toThrow(/No shop is bound/);
    });

    it('works for a shop that is being made or is switched off, not for a closed or unknown one', async () => {
      await expect(t.shopsService.runAsShop('shop_new', () => Promise.resolve('ok'))).resolves.toBe(
        'ok',
      );
      await expect(t.shopsService.runAsShop('shop_off', () => Promise.resolve('ok'))).resolves.toBe(
        'ok',
      );
      await expect(
        t.shopsService.runAsShop('shop_gone', () => Promise.resolve('ok')),
      ).rejects.toThrow(/no open shop/i);
      await expect(
        t.shopsService.runAsShop('shop_nope', () => Promise.resolve('ok')),
      ).rejects.toThrow(/no open shop/i);
    });
  });

  describe('a change of state', () => {
    it('shows once the answer is 30 seconds old', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        await t.at('x.shops.test').get('/auth/registration').expect(404);
        await t.controlSql.query(`INSERT INTO shop_host (host, shop_id)
          SELECT 'x.shops.test', id FROM shop WHERE slug = 'shop_b'`);
        // Still the old answer.
        await t.at('x.shops.test').get('/auth/registration').expect(404);
        later(LOOKUP_TTL_MS + 1);
        await t.at('x.shops.test').get('/auth/registration').expect(200);

        await setShopState(t, 'shop_b', 'suspended');
        await t.at('x.shops.test').get('/auth/registration').expect(200);
        later(LOOKUP_TTL_MS + 1);
        await t.at('x.shops.test').get('/auth/registration').expect(403);
        await setShopState(t, 'shop_b', 'active');
        later(LOOKUP_TTL_MS + 1);
        await t.at('x.shops.test').get('/auth/registration').expect(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('the control database is down', () => {
  let t: MultiShopApp;
  let admin: pg.Pool;

  const setConnections = async (allowed: boolean): Promise<void> => {
    await admin.query(
      `ALTER DATABASE ${t.controlDatabaseName} ALLOW_CONNECTIONS ${allowed ? 'true' : 'false'}`,
    );
    if (!allowed) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [t.controlDatabaseName],
      );
    }
  };

  beforeAll(async () => {
    t = await createMultiShopApp(
      [
        { slug: 'shop_a', host: A, ownerPassword: PASSWORD_A },
        { slug: 'shop_b', host: B, ownerPassword: PASSWORD_B },
      ],
      { env: { AUTH_LOGIN_RATE_LIMIT: '1000' } },
    );
    // The test's own connections to it are cut too: not a failure of the test.
    t.controlSql.on('error', () => undefined);
    admin = new pg.Pool({ connectionString: t.adminUrl, max: 1 });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await setConnections(true);
    await admin.end();
    await t.close();
  });

  it('serves an address it knew, and fails closed for one it never saw; then recovers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Shop A is known; shop B has not been asked for yet.
    await t.at(A).get('/auth/registration').expect(200);
    later(LOOKUP_TTL_MS + 1);
    await setConnections(false);

    // The answer for A is old and cannot be renewed: the last one is used.
    const a = await t.at(A).post('/auth/login').send({ username: 'owner', password: PASSWORD_A });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ shopId: t.shops['shop_a']?.id });

    // B was never asked for: no guess, 503.
    const b = await t.at(B).get('/auth/registration');
    expect(b.status).toBe(503);
    expect(b.body).toMatchObject({ error: { code: 'service_unavailable' } });

    // Liveness does not depend on it.
    await t.at(B).get('/health').expect(200);

    await setConnections(true);
    later(RETRY_AFTER_FAILURE_MS + 1);
    const recovered = await t.at(B).get('/auth/registration');
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ shopId: t.shops['shop_b']?.id });
  });
});

describe('the sign-in limit counts for each shop', () => {
  let t: MultiShopApp;

  beforeAll(async () => {
    t = await createMultiShopApp(
      [
        { slug: 'shop_a', host: A, ownerPassword: PASSWORD_A },
        { slug: 'shop_b', host: B, ownerPassword: PASSWORD_B },
      ],
      { env: { AUTH_LOGIN_RATE_LIMIT: '3' } },
    );
  });
  afterAll(async () => {
    await t.close();
  });

  it('one shop’s wrong guesses do not use up the other shop’s allowance (same client address)', async () => {
    const guess = (host: string, password: string) =>
      t.at(host).post('/auth/login').send({ username: 'owner', password });
    for (let i = 0; i < 3; i++) await guess(A, 'wrong password, long enough').expect(401);
    await guess(A, PASSWORD_A).expect(429);
    await guess(B, PASSWORD_B).expect(200);
  });
});

describe('one shop (MULTI_SHOP off): the server is what it always was', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves whatever address a request comes to, with no shop id and no shop claim', async () => {
    const response = await t
      .http()
      .post('/auth/login')
      .set('Host', 'anything.example.test')
      .send({ username: OWNER.username, password: OWNER.password })
      .expect(200);
    const body = response.body as { accessToken: string };
    expect(response.body).not.toHaveProperty('shopId');
    expect(
      t.app.get(JwtService).decode<Record<string, unknown>>(body.accessToken),
    ).not.toHaveProperty('shop');
    await t
      .http()
      .get('/auth/me')
      .set('Host', 'anything.example.test')
      .set('authorization', `Bearer ${body.accessToken}`)
      .expect(200);
  });

  it('answers the sign-up status as before', async () => {
    const response = await t.http().get('/auth/registration').expect(200);
    expect(response.body).toEqual({ open: false });
  });
});
