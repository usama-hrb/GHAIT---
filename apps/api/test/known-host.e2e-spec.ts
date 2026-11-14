import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app.js';
import { createMultiShopApp, type MultiShopApp, type ShopSpec } from './support/multi-shop-app.js';

/**
 * Caddy's `ask` address (ADR 0029, Step 7): it says which names may get an HTTPS certificate. Caddy
 * calls it on the Docker network with the host `api:4000` and no `X-Forwarded-For`; every request
 * that came through Caddy has that header.
 */

const SHOPS: ShopSpec[] = [
  { slug: 'shop_a', host: 'a.shops.test' },
  { slug: 'shop_off', host: 'off.shops.test', state: 'suspended' },
  { slug: 'shop_new', host: 'new.shops.test', state: 'provisioning' },
  { slug: 'shop_gone', host: 'gone.shops.test', state: 'closed' },
  // The live shop, adopted at its bare IP address: it has the certificate of Caddy's own authority.
  { slug: 'shop_ip', host: '203.0.113.7' },
  { slug: 'shop_late', host: 'late.shops.test' },
];

/** The body of a refusal without the id of the request, which is different each time. */
const shapeOf = (response: { body: { error: Record<string, unknown> } }) => ({
  ...response.body.error,
  requestId: undefined,
});

describe('the ask address of the on-demand certificates', () => {
  let t: MultiShopApp;

  /** What Caddy does: the host `api:4000`, no forwarding headers. */
  const ask = (domain: string) =>
    t.http().get('/internal/known-host').set('Host', 'api:4000').query({ domain });

  beforeAll(async () => {
    t = await createMultiShopApp(SHOPS);
    // An address that was in use and is not any more.
    await t.controlSql.query(`INSERT INTO shop_host (host, shop_id, released_at)
      SELECT 'released.shops.test', id, now() FROM shop WHERE slug = 'shop_a'`);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('a name that may get a certificate', () => {
    it('answers 200 for the address of a shop', async () => {
      const response = await ask('a.shops.test').expect(200);
      // Nothing in the answer says anything about the shop.
      expect(response.text).toBe('');
    });

    it('answers 200 for a shop that is switched off and for one that is being made', async () => {
      await ask('off.shops.test').expect(200);
      await ask('new.shops.test').expect(200);
    });

    it('does not mind the case of the name', async () => {
      await ask('A.Shops.TEST').expect(200);
    });

    it('does not need the host of a shop: the request comes to the name api', async () => {
      // The tenant router answers 404 to this host for every other route; this one is outside it.
      await ask('a.shops.test').expect(200);
    });

    it('needs no sign-in', async () => {
      await ask('a.shops.test').expect(200);
    });
  });

  describe('a name that may not', () => {
    it.each([
      ['a name nobody owns', 'nobody.shops.test'],
      ['the address of a closed shop', 'gone.shops.test'],
      ['an address that was released', 'released.shops.test'],
      ['an address with a port', 'a.shops.test:443'],
      ['a name with a bad character', 'a_b.shops.test'],
      ['a name with a space', 'a.shops .test'],
      ['a name that starts with a dot', '.a.shops.test'],
      ['the name of the server itself', 'api'],
      ['an empty name after a dot', 'a.shops.test.'],
    ])('answers 404 for %s', async (_what, domain) => {
      await ask(domain).expect(404);
    });

    it('answers 404 for an IP address, even the address of a shop', async () => {
      // The shop is there: its address is the one Caddy serves with its own certificate.
      const { rows } = await t.controlSql.query<{ n: string }>(
        `SELECT count(*) AS n FROM shop_host WHERE host = '203.0.113.7' AND released_at IS NULL`,
      );
      expect(rows[0]?.n).toBe('1');
      await ask('203.0.113.7').expect(404);
      await ask('127.0.0.1').expect(404);
      await ask('[::1]').expect(404);
      await ask('::1').expect(404);
      await ask('fd00::1').expect(404);
      await ask('::ffff:203.0.113.7').expect(404);
    });

    it('says the same for every refusal, so it does not say which names are shops', async () => {
      const closed = await ask('gone.shops.test').expect(404);
      const unknown = await ask('nobody.shops.test').expect(404);
      const ip = await ask('203.0.113.7').expect(404);
      expect(shapeOf(closed)).toEqual(shapeOf(unknown));
      expect(shapeOf(ip)).toEqual(shapeOf(unknown));
    });

    it('answers 400 for a request with no name, an empty one or one that is too long', async () => {
      await t.http().get('/internal/known-host').set('Host', 'api:4000').expect(400);
      await ask('').expect(400);
      await ask('a'.repeat(254)).expect(400);
    });
  });

  describe('a request that came through the proxy', () => {
    it('is refused, even for the name of a shop', async () => {
      await ask('a.shops.test').set('X-Forwarded-For', '198.51.100.9').expect(404);
    });

    it('is refused when the header is empty or lists several addresses', async () => {
      await ask('a.shops.test').set('X-Forwarded-For', '').expect(404);
      await ask('a.shops.test').set('X-Forwarded-For', '198.51.100.9, 10.0.0.2').expect(404);
    });

    it('is refused whatever the case of the header name', async () => {
      await ask('a.shops.test').set('x-forwarded-for', '198.51.100.9').expect(404);
      await ask('a.shops.test').set('X-FORWARDED-FOR', '198.51.100.9').expect(404);
    });

    it('is refused when it came to the public path with the shop’s own host', async () => {
      // What a visitor of https://a.shops.test/api/internal/known-host would reach if Caddy let
      // it through: the proxy has added the header, so the route still says no.
      await t
        .at('a.shops.test')
        .get('/internal/known-host?domain=a.shops.test')
        .set('X-Forwarded-For', '198.51.100.9')
        .set('X-Forwarded-Host', 'a.shops.test')
        .expect(404);
    });

    it('does not tell a refusal from an unknown name', async () => {
      const proxied = await ask('a.shops.test').set('X-Forwarded-For', '198.51.100.9').expect(404);
      const unknown = await ask('nobody.shops.test').expect(404);
      expect(shapeOf(proxied)).toEqual(shapeOf(unknown));
    });
  });

  describe('a shop made a moment ago', () => {
    it('gets its certificate at once: nothing about a name is kept', async () => {
      await ask('fresh.shops.test').expect(404);
      await t.controlSql.query(`INSERT INTO shop_host (host, shop_id)
        SELECT 'fresh.shops.test', id FROM shop WHERE slug = 'shop_a'`);
      await ask('fresh.shops.test').expect(200);
    });

    it('loses it at once when its shop is closed', async () => {
      await ask('late.shops.test').expect(200);
      await t.controlSql.query(
        `UPDATE shop SET state = 'closed', closed_at = now() WHERE slug = 'shop_late'`,
      );
      await ask('late.shops.test').expect(404);
    });
  });

  it('only answers GET', async () => {
    await t
      .http()
      .post('/internal/known-host?domain=a.shops.test')
      .set('Host', 'api:4000')
      .expect(404);
  });

  it('does not write anything to the control database', async () => {
    const count = async (): Promise<string | undefined> =>
      (await t.controlSql.query<{ n: string }>('SELECT count(*) AS n FROM shop_event')).rows[0]?.n;
    const before = await count();
    await ask('a.shops.test').expect(200);
    await ask('nobody.shops.test').expect(404);
    expect(await count()).toBe(before);
  });
});

describe('the ask address on a one-shop server', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ shops: 'one', owner: false });
  });
  afterAll(async () => {
    await t.close();
  });

  it('is not there: no name gets a certificate', async () => {
    await t.http().get('/internal/known-host').query({ domain: 'a.shops.test' }).expect(404);
  });
});
