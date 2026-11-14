import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { DataService } from '../src/modules/data/index.js';
import { inShop, UsageError } from '../src/shop-scope.js';
import { createMultiShopApp, type MultiShopApp, type TestShop } from './support/multi-shop-app.js';

/**
 * `SHOP=<slug>` on `make owner`, `cashier-user`, `partner-user`, `export` and `import` (ADR 0029,
 * Step 8). The commands call the same services as before, inside `inShop`; the claim to prove is
 * that the work lands in the shop that was named and in no other.
 */

const A_PASSWORD = 'shop-a-password-0123456789';
const B_PASSWORD = 'shop-b-password-0123456789';

describe('commands that name a shop', () => {
  let multi: MultiShopApp;
  const shopOf = (slug: string): TestShop => {
    const found = multi.shops[slug];
    if (!found) throw new Error(`the test has no shop ${slug}`);
    return found;
  };
  const a = () => shopOf('shop_a');
  const b = () => shopOf('shop_b');
  const c = () => shopOf('shop_c');

  beforeAll(async () => {
    multi = await createMultiShopApp([
      { slug: 'shop_a', host: 'a.scope.test', ownerPassword: A_PASSWORD },
      { slug: 'shop_b', host: 'b.scope.test', ownerPassword: B_PASSWORD },
      { slug: 'shop_c', host: 'c.scope.test' },
      { slug: 'shop_gone', host: 'gone.scope.test', state: 'closed' },
    ]);
  }, 60_000);
  afterAll(async () => {
    await multi.close();
  });

  const usernames = async (shop: ReturnType<typeof a>): Promise<string[]> =>
    (
      await shop.sql.query<{ username: string }>('SELECT username FROM app_user ORDER BY 1')
    ).rows.map((row) => row.username);

  it('makes a cashier in the named shop only', async () => {
    const outcome = await inShop(multi.app, multi.config, 'shop_a', () =>
      multi.app
        .get(AuthService)
        .setCashierUser({ username: 'till', password: 'cashier-password-0123456789' }),
    );
    expect(outcome).toBe('created');
    expect(await usernames(a())).toEqual(['owner', 'till']);
    expect(await usernames(b())).toEqual(['owner']);
    expect(await usernames(c())).toEqual([]);
  });

  it('changes the password of the owner of the named shop, and signs only that shop out', async () => {
    const tokenA = (await multi.login('a.scope.test', A_PASSWORD)).accessToken;
    const tokenB = (await multi.login('b.scope.test', B_PASSWORD)).accessToken;
    const me = (host: string, token: string) =>
      multi.at(host).get('/auth/me').set('Authorization', `Bearer ${token}`);
    await me('a.scope.test', tokenA).expect(200);

    const outcome = await inShop(multi.app, multi.config, 'shop_a', () =>
      multi.app.get(AuthService).setOwner({
        username: 'owner',
        password: 'a-new-password-0123456789',
      }),
    );
    expect(outcome).toBe('password_reset');

    await me('a.scope.test', tokenA).expect(401);
    await me('b.scope.test', tokenB).expect(200);
    await multi
      .at('a.scope.test')
      .post('/auth/login')
      .send({ username: 'owner', password: A_PASSWORD })
      .expect(401);
    await multi
      .at('a.scope.test')
      .post('/auth/login')
      .send({ username: 'owner', password: 'a-new-password-0123456789' })
      .expect(200);
    // The other shop's owner is untouched: the old password still opens it.
    await multi.login('b.scope.test', B_PASSWORD);
  });

  it('refuses a command that names no shop, an unknown shop and a closed one', async () => {
    const work = () =>
      multi.app.get(AuthService).setCashierUser({
        username: 'nobody',
        password: 'cashier-password-0123456789',
      });
    await expect(inShop(multi.app, multi.config, undefined, work)).rejects.toBeInstanceOf(
      UsageError,
    );
    await expect(inShop(multi.app, multi.config, 'no_such_shop', work)).rejects.toThrow(
      'There is no open shop "no_such_shop"',
    );
    await expect(inShop(multi.app, multi.config, 'shop_gone', work)).rejects.toThrow(
      'There is no open shop "shop_gone"',
    );
    expect(await usernames(a())).not.toContain('nobody');
    expect(await usernames(b())).not.toContain('nobody');
  });

  it('exports the named shop only, and imports into the named shop only', async () => {
    await a().sql.query(
      `INSERT INTO customer (name, device_id) VALUES ('Fatima of shop A', 'scope-test')`,
    );
    await b().sql.query(
      `INSERT INTO customer (name, device_id) VALUES ('Karim of shop B', 'scope-test')`,
    );
    const names = (file: { records: { customer: { name: string }[] } }) =>
      file.records.customer.map((customer) => customer.name);

    const exportA = await inShop(multi.app, multi.config, 'shop_a', () =>
      multi.app.get(DataService).exportAll(),
    );
    const exportB = await inShop(multi.app, multi.config, 'shop_b', () =>
      multi.app.get(DataService).exportAll(),
    );
    expect(names(exportA)).toEqual(['Fatima of shop A']);
    expect(names(exportB)).toEqual(['Karim of shop B']);

    // A shop that has data refuses an import, and nothing changes in it.
    await expect(
      inShop(multi.app, multi.config, 'shop_b', () =>
        multi.app.get(DataService).importAll(exportA),
      ),
    ).rejects.toThrow('already has shop data');
    const rowsOfB = await b().sql.query('SELECT name FROM customer');
    expect(rowsOfB.rows).toEqual([{ name: 'Karim of shop B' }]);

    // An empty shop takes it; the two shops it was not meant for do not change.
    const counts = await inShop(multi.app, multi.config, 'shop_c', () =>
      multi.app.get(DataService).importAll(exportA),
    );
    expect(counts['customer']).toBe(1);
    expect((await c().sql.query('SELECT name FROM customer')).rows).toEqual([
      { name: 'Fatima of shop A' },
    ]);
    expect((await a().sql.query('SELECT name FROM customer')).rows).toEqual([
      { name: 'Fatima of shop A' },
    ]);
    expect((await b().sql.query('SELECT name FROM customer')).rows).toEqual([
      { name: 'Karim of shop B' },
    ]);
  });
});
