import { randomUUID } from 'node:crypto';
import {
  type BatchHistory,
  buildSaleAggregate,
  buildSaleVoid,
  HEADERS,
  newSaleSchema,
  type SaleAggregate,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMultiShopApp, type MultiShopApp } from './support/multi-shop-app.js';
import { stockKit } from './support/stock.js';

/**
 * Two shops on one server (ADR 0029, Step 9): what one shop writes, the other never sees. The
 * records are written through the API, as a device writes them; the other shop is then asked for
 * them in every way the API has: the sync pull, every GET route in the OpenAPI document, a write
 * that names them. The shops' own databases are looked at directly at the end, since the API's
 * answers could only be wrong where the database is wrong.
 */

const PASSWORD = { A: 'the first shops password is long', B: 'the second shops password is long' };
const HOST = { A: 'a.cross.test', B: 'b.cross.test' };
const DAY = '2026-10-30';
const NOW = '2026-10-30T10:00:00.000Z';

type Label = 'A' | 'B';
type Request = ReturnType<ReturnType<MultiShopApp['http']>['get']>;

/** What a shop wrote: the id of each record by its table, and texts that only its records carry. */
interface Written {
  rows: { table: string; id: string }[];
  texts: string[];
  customerId: string;
  productId: string;
  batchId: string;
  sale: SaleAggregate;
}

interface Side {
  label: Label;
  host: string;
  accessToken: string;
  written: Written;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  put: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  push: (...ops: SyncOp[]) => Promise<SyncOpResult[]>;
  pullAll: () => Promise<{ entity: string; record: unknown }[]>;
}

const sideOf = (t: MultiShopApp, label: Label, accessToken: string) => {
  const host = HOST[label];
  const http = t.shop(host).http;
  const as = (request: Request) =>
    request.auth(accessToken, { type: 'bearer' }).set(HEADERS.deviceId, `desk-${label}`);
  const get = async (path: string) => {
    const response = await as(http().get(path));
    return { status: response.status, body: response.body as unknown };
  };
  const put = async (path: string, body: unknown) => {
    const response = await as(http().put(path)).send(body as object);
    return { status: response.status, body: response.body as unknown };
  };
  const push = async (...ops: SyncOp[]): Promise<SyncOpResult[]> => {
    const response = await as(http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };
  const pullAll = async () => {
    const found: { entity: string; record: unknown }[] = [];
    let since = 0;
    for (;;) {
      const response = await as(http().get(`/sync/pull?since=${String(since)}&limit=500`)).expect(
        200,
      );
      const page = syncPullResponseSchema.parse(response.body);
      found.push(...page.changes.map(({ entity, record }) => ({ entity, record })));
      since = page.nextSince;
      if (!page.hasMore) return found;
    }
  };
  return {
    get,
    put,
    push,
    pullAll,
    kit: stockKit(t.shop(host), () => ({ accessToken, refreshCookie: '' }), push),
  };
};

/** A customer, a supplier, a product bought on credit, a sale on credit, an expense, a shop name. */
async function writeRecords(t: MultiShopApp, label: Label, accessToken: string): Promise<Side> {
  const { get, put, push, pullAll, kit } = sideOf(t, label, accessToken);
  const customerId = randomUUID();
  const supplierId = randomUUID();
  const expenseId = randomUUID();
  const texts = [`عميل ${label}`, `مورد ${label}`, `منتج ${label}`, `محل ${label}`];

  expect(
    (await put(`/customers/${customerId}`, { name: texts[0], phone: '0612345678' })).status,
  ).toBe(200);
  expect((await put(`/suppliers/${supplierId}`, { name: texts[1] })).status).toBe(200);
  const productId = await kit.product({ name: texts[2] });
  // 50 m for 800 dh, 300 dh of it paid: the rest is owed to the supplier.
  const batch = await kit.buy({
    productId,
    supplierId,
    quantity: 5000,
    totalCostCents: 80_000,
    paidCents: 30_000,
  });
  const history: BatchHistory = await kit.history(batch.id);
  const built = buildSaleAggregate(
    newSaleSchema.parse({
      date: DAY,
      customerId,
      lines: [
        {
          batchId: batch.id,
          unit: 'meter',
          quantity: 150,
          price: { perUnitCents: 1800 },
          refPriceCents: 2000,
          minPriceCents: 1700,
        },
      ],
      // 27 dh, 10 dh paid: the customer owes the rest.
      paidCents: 1000,
    }),
    new Map([[batch.id, history]]),
    {
      saleId: randomUUID(),
      lineIds: [randomUUID()],
      moveIds: [randomUUID()],
      paymentId: randomUUID(),
      allocationId: randomUUID(),
    },
    { deviceId: `desk-${label}`, now: NOW },
  );
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  const sale = built.aggregate;
  const [sold] = await push({
    opId: randomUUID(),
    entity: 'sale',
    entityId: sale.sale.id,
    kind: 'append',
    payload: sale,
    deviceId: `desk-${label}`,
    clientTs: NOW,
    baseServerSeq: null,
  });
  expect(sold?.status).toBe('applied');
  expect(
    (
      await put(`/expenses/${expenseId}`, {
        date: '2026-10-20',
        category: 'rent',
        amountCents: label === 'A' ? 300_100 : 300_200,
        paidDate: '2026-10-20',
      })
    ).status,
  ).toBe(200);
  expect((await put('/settings/shop_name', { value: texts[3] })).status).toBe(200);

  const rows = [
    { table: 'customer', id: customerId },
    { table: 'supplier', id: supplierId },
    { table: 'product', id: productId },
    { table: 'product_batch', id: batch.id },
    { table: 'purchase', id: batch.purchaseId },
    { table: 'sale', id: sale.sale.id },
    { table: 'sale_line', id: sale.lines[0]?.id ?? '' },
    { table: 'payment', id: sale.payment?.id ?? '' },
    { table: 'expense', id: expenseId },
  ];
  return {
    label,
    host: HOST[label],
    accessToken,
    written: { rows, texts, customerId, productId, batchId: batch.id, sale },
    get,
    put,
    push,
    pullAll,
  };
}

const idsOf = (side: Side): string[] => side.written.rows.map((row) => row.id);

/** A body as text, without what differs on every request. */
const textOf = (body: unknown, ...swap: string[]): string => {
  let text = JSON.stringify(body, (key, value: unknown) =>
    key === 'requestId' ? undefined : value,
  );
  for (const id of swap) text = text.replaceAll(id, '<id>');
  return text;
};

/** The names and the shop name of a shop: what a reader would see of it. */
const showsTextOf = (text: string, side: Side): boolean =>
  side.written.texts.some((piece) => text.includes(piece));

/** Also its ids. A list has no reason to name a record that is not in the shop. */
const showsAnythingOf = (text: string, side: Side): boolean =>
  showsTextOf(text, side) || idsOf(side).some((id) => text.includes(id));

interface Operation {
  parameters?: { name: string; in: 'path' | 'query' | 'header'; required?: boolean }[];
}

/** Query parameters that a route needs to answer at all. A new one fails the sweep until it is here. */
const REQUIRED_QUERY: Record<string, string> = { month: '2026-10', end: '2026-10-31' };

interface Route {
  /** The route as the document gives it: `/customers/{id}`. */
  template: string;
  /** The name of its one path parameter, or null. */
  parameter: 'id' | 'key' | null;
  url: (value?: string) => string;
}

function getRoutes(paths: Record<string, Record<string, Operation>>): Route[] {
  const routes: Route[] = [];
  for (const [template, item] of Object.entries(paths)) {
    const operation = item['get'];
    if (!operation) continue;
    const parameters = operation.parameters ?? [];
    const named = parameters.filter((parameter) => parameter.in === 'path').map((p) => p.name);
    const [first, ...more] = named;
    if (more.length > 0 || (first !== undefined && first !== 'id' && first !== 'key')) {
      throw new Error(
        `${template}: a path parameter the sweep does not know (${named.join(', ')})`,
      );
    }
    const query = parameters
      .filter((parameter) => parameter.in === 'query' && parameter.required)
      .map((parameter) => {
        const value = REQUIRED_QUERY[parameter.name];
        if (value === undefined) {
          throw new Error(
            `${template}: add a value for the required query parameter "${parameter.name}"`,
          );
        }
        return `${parameter.name}=${encodeURIComponent(value)}`;
      })
      .join('&');
    routes.push({
      template,
      parameter: first ?? null,
      url: (value = '') =>
        `${template.replace(/\{[^}]+\}/, encodeURIComponent(value))}${query === '' ? '' : `?${query}`}`,
    });
  }
  return routes;
}

describe('two shops on one server: what one writes, the other never sees', () => {
  let t: MultiShopApp;
  let a: Side;
  let b: Side;
  let routes: Route[];
  /** The routes on which a shop was shown its own records (so that the other's silence means something). */
  const controls = new Set<string>();

  beforeAll(async () => {
    t = await createMultiShopApp(
      [
        { slug: 'shop_a', host: HOST.A, ownerPassword: PASSWORD.A },
        { slug: 'shop_b', host: HOST.B, ownerPassword: PASSWORD.B },
      ],
      { env: { AUTH_LOGIN_RATE_LIMIT: '1000' } },
    );
    a = await writeRecords(t, 'A', (await t.login(HOST.A, PASSWORD.A)).accessToken);
    b = await writeRecords(t, 'B', (await t.login(HOST.B, PASSWORD.B)).accessToken);
    const docs = await t.at(HOST.A).get('/docs/json').expect(200);
    routes = getRoutes((docs.body as { paths: Record<string, Record<string, Operation>> }).paths);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const both: [name: string, reader: () => Side, owner: () => Side][] = [
    ['B asks for what A wrote', () => b, () => a],
    ['A asks for what B wrote', () => a, () => b],
  ];

  describe('the sync pull from the start', () => {
    it('gives a shop its own records, and every one of them', async () => {
      for (const side of [a, b]) {
        const pulled = await side.pullAll();
        const text = textOf(pulled);
        for (const id of idsOf(side)) expect(text, `${side.label}: ${id}`).toContain(id);
        const customers = pulled.filter((change) => change.entity === 'customer');
        expect(customers).toHaveLength(1);
      }
    });

    it.each(both)('%s: nothing, not an id and not a name', async (_, reader, owner) => {
      const text = textOf(await reader().pullAll());
      expect(showsAnythingOf(text, owner())).toBe(false);
    });

    it('is a separate sequence for each shop: a write in A does not move the position in B', async () => {
      const next = async (side: Side): Promise<number> => {
        const response = await side.get('/sync/pull?since=0&limit=1');
        return (response.body as { nextSince: number }).nextSince;
      };
      const before = await next(b);
      await a.put(`/customers/${randomUUID()}`, { name: 'one more in A' });
      expect(await next(b)).toBe(before);
    });
  });

  describe('every GET route of the API', () => {
    it('lists the routes from the OpenAPI document, so a new route is swept without an edit', () => {
      expect(routes.length).toBeGreaterThan(30);
      expect(routes.map((route) => route.template)).toEqual(
        expect.arrayContaining(['/customers', '/customers/{id}', '/sales/{id}', '/sync/pull']),
      );
    });

    it.each(both)(
      '%s: every list shows none of it, and a record of the other is, to the asker, a record that never existed',
      async (_, reader, owner) => {
        const asker = reader();
        const writer = owner();
        for (const route of routes) {
          if (route.parameter === null) {
            // A list or a summary: what the asker is shown holds nothing of the writer.
            const shown = await asker.get(route.url());
            expect(
              showsAnythingOf(textOf(shown.body), writer),
              `${asker.label} ${route.url()}`,
            ).toBe(false);
            const own = await writer.get(route.url());
            if (own.status === 200 && showsAnythingOf(textOf(own.body), writer)) {
              controls.add(route.template);
            }
            continue;
          }
          const values = route.parameter === 'key' ? ['shop_name'] : idsOf(writer);
          for (const value of values) {
            const url = route.url(value);
            const shown = await asker.get(url);
            const where = `${asker.label} ${url}`;
            // The answer may name the id that was asked for; it may not name anything of the writer.
            expect(showsTextOf(textOf(shown.body), writer), where).toBe(false);
            if (route.parameter === 'id') {
              // The same answer as for an id that was never used anywhere.
              const never = randomUUID();
              const unknown = await asker.get(route.url(never));
              expect(shown.status, where).toBe(unknown.status);
              expect(textOf(shown.body, value), where).toBe(textOf(unknown.body, never));
            }
            const own = await writer.get(url);
            if (own.status === 200 && showsAnythingOf(textOf(own.body), writer)) {
              controls.add(route.template);
            }
          }
        }
      },
      60_000,
    );

    it('showed each shop its own records on the routes that matter (the check above is not empty)', () => {
      expect([...controls].sort()).toEqual(
        expect.arrayContaining([
          '/audit',
          '/batches/{id}',
          '/customers',
          '/customers/debts',
          '/customers/{id}',
          '/customers/{id}/account',
          '/expenses',
          '/products',
          '/products/{id}',
          '/purchases',
          '/purchases/{id}',
          '/sales',
          '/sales/{id}',
          '/settings',
          '/settings/{key}',
          '/supplier-payables',
          '/suppliers',
          '/suppliers/{id}',
          '/suppliers/{id}/statement',
        ]),
      );
    });
  });

  describe('the databases themselves', () => {
    it('hold each shop’s rows in its own database and none of the other’s', async () => {
      const databases: [Side, Side][] = [
        [a, b],
        [b, a],
      ];
      for (const [own, other] of databases) {
        const ownSql = t.shops[own.label === 'A' ? 'shop_a' : 'shop_b']?.sql;
        const otherSql = t.shops[other.label === 'A' ? 'shop_a' : 'shop_b']?.sql;
        if (!ownSql || !otherSql) throw new Error('the test made two shops');
        for (const { table, id } of own.written.rows) {
          const mine = await ownSql.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
          const theirs = await otherSql.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
          expect([table, mine.rowCount, theirs.rowCount]).toEqual([table, 1, 0]);
        }
      }
    });

    it('have one owner each, and the audit log of each names only its own records', async () => {
      for (const [slug, own, other] of [
        ['shop_a', a, b],
        ['shop_b', b, a],
      ] as const) {
        const sql = t.shops[slug]?.sql;
        if (!sql) throw new Error('the test made two shops');
        const owners = await sql.query(`SELECT 1 FROM app_user WHERE role = 'owner'`);
        expect(owners.rowCount).toBe(1);
        const audit = await sql.query<{ entity_id: string }>('SELECT entity_id FROM audit_log');
        const audited = new Set(audit.rows.map((row) => row.entity_id));
        for (const id of idsOf(other)) expect(audited.has(id), `${slug} audits ${id}`).toBe(false);
        expect(audited.has(own.written.customerId)).toBe(true);
      }
    });
  });

  describe('a write that names the other shop’s records', () => {
    it('cannot sell the other shop’s batch, and cannot void the other shop’s sale', async () => {
      // A's own sale, as A pushed it, is a sale of a batch that B has never heard of.
      const [sale] = await b.push({
        opId: randomUUID(),
        entity: 'sale',
        entityId: a.written.sale.sale.id,
        kind: 'append',
        payload: a.written.sale,
        deviceId: 'desk-B',
        clientTs: NOW,
        baseServerSeq: null,
      });
      expect(sale).toMatchObject({ status: 'rejected' });

      const voided = buildSaleVoid(
        { reason: 'from the other shop', date: DAY },
        {
          sale: a.written.sale.sale,
          moves: a.written.sale.moves,
          allocations: a.written.sale.allocation ? [a.written.sale.allocation] : [],
          returns: [],
        },
        { voidId: randomUUID(), reversalIds: [randomUUID()], refundId: randomUUID() },
        { deviceId: 'desk-B', now: NOW },
      );
      const [refused] = await b.push({
        opId: randomUUID(),
        entity: 'sale_void',
        entityId: voided.saleVoid.id,
        kind: 'append',
        payload: voided,
        deviceId: 'desk-B',
        clientTs: NOW,
        baseServerSeq: null,
      });
      expect(refused).toMatchObject({ status: 'rejected' });

      // A's sale is whole and still on sale in A.
      const kept = await a.get(`/sales/${a.written.sale.sale.id}`);
      expect(kept.status).toBe(200);
      expect(textOf(kept.body)).not.toContain('from the other shop');
      expect((kept.body as { sale: { voidedAt: string | null } }).sale.voidedAt).toBeNull();
    });

    it('an id is only an id inside one shop: the same id written in B makes B’s own record and leaves A’s', async () => {
      const { customerId } = a.written;
      const taken = await b.put(`/customers/${customerId}`, { name: 'made in B on A’s id' });
      expect(taken.status).toBe(200);
      const inB = await b.get(`/customers/${customerId}`);
      const inA = await a.get(`/customers/${customerId}`);
      expect(textOf(inB.body)).toContain('made in B on A’s id');
      expect(textOf(inA.body)).not.toContain('made in B on A’s id');
      expect(textOf(inA.body)).toContain(a.written.texts[0]);
      // Two rows with one id, one in each database.
      const names = await Promise.all(
        (['shop_a', 'shop_b'] as const).map(async (slug) => {
          const { rows } = await (t.shops[slug]?.sql.query<{ name: string }>(
            'SELECT name FROM customer WHERE id = $1',
            [customerId],
          ) ?? Promise.reject(new Error('the test made two shops')));
          return rows.map((row) => row.name);
        }),
      );
      expect(names).toEqual([[a.written.texts[0]], ['made in B on A’s id']]);
    });

    it('a token of one shop reads nothing at the other shop’s address, on any route', async () => {
      for (const route of routes.filter(
        (r) => r.parameter === null && r.template !== '/sync/pull',
      )) {
        const crossed = await t
          .at(HOST.A)
          .get(route.url())
          .set('authorization', `Bearer ${b.accessToken}`);
        // Public routes answer anyone; everything else refuses the token.
        if (crossed.status === 200) {
          expect(showsAnythingOf(textOf(crossed.body), b), route.url()).toBe(false);
        }
      }
      await t
        .at(HOST.A)
        .get('/customers')
        .set('authorization', `Bearer ${b.accessToken}`)
        .expect(401);
      await t
        .at(HOST.B)
        .get('/customers')
        .set('authorization', `Bearer ${a.accessToken}`)
        .expect(401);
    });
  });
});
