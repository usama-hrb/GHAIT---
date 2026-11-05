import {
  accessTokenResponseSchema,
  ACCESS_ISSUES,
  type BatchHistory,
  type ProductBatch,
  buildSaleAggregate,
  errorResponseSchema,
  HEADERS,
  newSaleSchema,
  saleDetailSchema,
  SALE_ISSUES,
  type SyncEntity,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';
import { stockKit } from './support/stock.js';

describe('roles: a cashier sells and never sees a cost or a profit (BUILD_PROMPTS 5.3, RL1–RL5)', () => {
  let t: TestApp;
  let owner: Session;
  let cashierToken = '';
  let kit: ReturnType<typeof stockKit>;
  /** 50 m at 16 dh/m of a product that may go down to 10 dh/m: under cost is possible. */
  let roll: ProductBatch;
  /** 50 m of a product with a 17 dh/m minimum. */
  let guarded: ProductBatch;
  const customerId = crypto.randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login();
    kit = stockKit(
      t,
      () => owner,
      async (...ops) => pushAs(asOwner, 'desk', ...ops),
    );
    await asOwner(t.http().put(`/customers/${customerId}`))
      .send({ name: 'فاطمة' })
      .expect(200);
    roll = await kit.buy({
      productId: await kit.product({ minPricePerMeterCents: 1000 }),
      date: '2026-10-01',
      quantity: 5000,
      totalCostCents: 80_000,
    });
    guarded = await kit.buy({
      productId: await kit.product({ name: 'محمي' }),
      date: '2026-10-01',
      quantity: 5000,
      totalCostCents: 80_000,
    });
    await asOwner(t.http().put(`/expenses/${crypto.randomUUID()}`))
      .send({ date: '2026-10-02', category: 'rent', amountCents: 5000, paidDate: '2026-10-02' })
      .expect(200);
    // A colleague's pay is the owner's business: it must never reach the till (PY5).
    const employeeId = crypto.randomUUID();
    await asOwner(t.http().put(`/employees/${employeeId}`))
      .send({ name: 'يوسف', startDate: '2026-01-01' })
      .expect(200);
    await asOwner(t.http().put(`/employee-salaries/${crypto.randomUUID()}`))
      .send({ employeeId, effectiveFrom: '2026-01-01', amountCents: 300_000 })
      .expect(200);

    await t.app.get(AuthService).setCashierUser({
      username: 'amina',
      password: 'a-long-cashier-password',
      displayName: 'أمينة',
    });
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'amina', password: 'a-long-cashier-password' })
      .expect(200);
    const parsed = accessTokenResponseSchema.parse(login.body);
    expect(parsed.user.role).toBe('cashier');
    cashierToken = parsed.accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  function asOwner(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(owner.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }
  function asCashier(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(cashierToken, { type: 'bearer' }).set(HEADERS.deviceId, 'till');
  }

  const pushAs = async (
    as: typeof asCashier,
    deviceId: string,
    ...ops: Omit<SyncOp, 'opId' | 'deviceId' | 'clientTs'>[]
  ): Promise<SyncOpResult[]> => {
    const response = await as(t.http().post('/sync/push'))
      .send({
        ops: ops.map((op) => ({
          ...op,
          opId: crypto.randomUUID(),
          deviceId,
          clientTs: new Date().toISOString(),
        })),
      })
      .expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };

  const pullAs = async (as: typeof asCashier, since = 0, limit = 500) =>
    syncPullResponseSchema.parse(
      (
        await as(t.http().get(`/sync/pull?since=${String(since)}&limit=${String(limit)}`)).expect(
          200,
        )
      ).body,
    );

  it('reaches only the sync hub and its own sign-in: every route that carries money is refused', async () => {
    await asCashier(t.http().get('/auth/me')).expect(200);
    await asCashier(t.http().post('/devices/register')).expect(200);
    const refused: [string, string][] = [
      ['get', '/fabrics'],
      ['get', `/batches/${roll.id}`],
      ['get', '/purchases'],
      ['get', '/sales'],
      ['get', '/customers'],
      ['get', '/expenses'],
      ['get', '/partners'],
      ['get', '/employees'],
      ['get', '/integrity'],
      ['get', '/settlements'],
      ['get', '/zakat/reports'],
      ['get', '/audit'],
      ['get', '/settings'],
      ['get', '/supplier-payables'],
      ['post', '/sales'],
      ['post', '/purchases'],
    ];
    for (const [method, path] of refused) {
      const call = method === 'get' ? t.http().get(path) : t.http().post(path).send({});
      const response = await asCashier(call);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('forbidden');
    }
    // An unauthenticated call is still a 401, not a 403.
    await t.http().get('/fabrics').expect(401);
  });

  it('a pull carries no cost: the batch’s cost is zero, and nothing about buying or the partners', async () => {
    const forCashier = await pullAs(asCashier);
    const entities = new Set<SyncEntity>(forCashier.changes.map((change) => change.entity));
    for (const hidden of [
      'purchase',
      'supplier',
      'expense',
      'partner',
      'employee',
      'employee_salary',
      'settlement',
      'capital_move',
      'zakat_report',
      // The rolls the stock was kept on before batches are history the till is not sent.
      'fabric',
      'variant',
      'roll',
      'stock_move',
    ] as const) {
      expect(entities.has(hidden), hidden).toBe(false);
    }
    expect(entities).toEqual(
      new Set(
        ['product', 'product_batch', 'product_stock_move', 'customer', 'setting'].filter((e) =>
          entities.has(e as SyncEntity),
        ),
      ),
    );
    const batches = forCashier.changes.filter((change) => change.entity === 'product_batch');
    expect(batches).toHaveLength(2);
    expect(
      batches.find((change) => (change.record as { id: string }).id === roll.id)?.record,
    ).toMatchObject({ id: roll.id, costTotalCents: 0, receivedQuantity: 5000 });
    const everything = JSON.stringify(forCashier.changes);
    expect(everything).not.toContain('"totalCostCents"');
    expect(everything).not.toContain('80000');

    // The owner's device gets all of it.
    const forOwner = await pullAs(asOwner);
    expect(
      forOwner.changes.find(
        (change) =>
          change.entity === 'product_batch' && (change.record as { id: string }).id === roll.id,
      )?.record,
    ).toMatchObject({ costTotalCents: 80_000 });
    expect(forOwner.changes.some((change) => change.entity === 'purchase')).toBe(true);
    expect(forOwner.changes.some((change) => change.entity === 'expense')).toBe(true);
  });

  it('a pull in small pages gets past the rows it may not see', async () => {
    let since = 0;
    const seen = new Set<SyncEntity>();
    for (let pages = 0; pages < 50; pages += 1) {
      const page = await pullAs(asCashier, since, 1);
      for (const change of page.changes) seen.add(change.entity);
      since = page.nextSince;
      if (!page.hasMore) break;
      expect(pages).toBeLessThan(49);
    }
    expect(seen.has('product_batch')).toBe(true);
    expect(seen.has('purchase')).toBe(false);
  });

  it('only the till’s own settings are sent', async () => {
    await asOwner(t.http().put('/settings/shop_name')).send({ value: 'غيث' }).expect(200);
    await asOwner(t.http().put('/settings/zakat_reminder_days')).send({ value: 10 }).expect(200);
    const keys = (await pullAs(asCashier)).changes
      .filter((change) => change.entity === 'setting')
      .map((change) => (change.record as { key: string }).key);
    expect(keys).toContain('shop_name');
    expect(keys).not.toContain('zakat_reminder_days');
  });

  it('the shop’s logo is sent to the till, and only the owner can change it', async () => {
    const logo = {
      contentType: 'image/jpeg',
      width: 120,
      height: 120,
      byteLength: 6,
      data: '/9j/AAAA',
    };
    await asOwner(t.http().put('/settings/shop_logo')).send({ value: logo }).expect(200);
    const change = (await pullAs(asCashier)).changes.find(
      (candidate) =>
        candidate.entity === 'setting' && (candidate.record as { key: string }).key === 'shop_logo',
    );
    expect((change?.record as { value: unknown } | undefined)?.value).toEqual(logo);
    expect(
      (await asCashier(t.http().put('/settings/shop_logo')).send({ value: null })).status,
    ).toBe(403);
  });

  /**
   * The cashier's device builds the sale from what it was sent: the batch without its cost.
   * `minPriceCents` is what the till has on the line (the product's, unless it is lying).
   */
  async function saleBody(
    perMeterCents: number,
    options: {
      confirmedBelowCost?: boolean;
      batch?: ProductBatch;
      minPriceCents?: number;
      minOverrideBy?: string | null;
    } = {},
  ) {
    const target = options.batch ?? roll;
    const stock = await kit.history(target.id);
    const history: BatchHistory = {
      batch: { ...stock.batch, costTotalCents: 0 },
      moves: stock.moves,
    };
    const built = buildSaleAggregate(
      newSaleSchema.parse({
        date: '2026-10-30',
        customerId: null,
        lines: [
          {
            batchId: target.id,
            unit: 'meter',
            quantity: 100,
            price: { perUnitCents: perMeterCents },
            refPriceCents: 2000,
            minPriceCents: options.minPriceCents ?? (options.batch ? 1700 : 1000),
            minOverrideBy: options.minOverrideBy ?? null,
          },
        ],
        paidCents: perMeterCents,
        confirmedBelowCost: options.confirmedBelowCost ?? false,
      }),
      new Map([[target.id, history]]),
      {
        saleId: crypto.randomUUID(),
        lineIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'till', now: new Date().toISOString() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.aggregate;
  }

  const saleOp = (aggregate: Awaited<ReturnType<typeof saleBody>>) => ({
    entity: 'sale' as const,
    entityId: aggregate.sale.id,
    kind: 'append' as const,
    payload: aggregate,
    baseServerSeq: null,
  });

  it('a cashier’s sale is accepted, priced again on the server with the real costs', async () => {
    const aggregate = await saleBody(1800);
    const [result] = await pushAs(asCashier, 'till', saleOp(aggregate));
    expect(result?.status).toBe('applied');
    // The owner sees what the sale earned; the cashier is never sent it.
    const figures = saleDetailSchema.parse(
      (await asOwner(t.http().get(`/sales/${aggregate.sale.id}`)).expect(200)).body,
    ).figures;
    expect(figures).toMatchObject({ capitalCents: 1600, profitCents: 200 });
  });

  it('a sale under cost is refused for a cashier: the cost is not theirs to weigh (RL3)', async () => {
    // Priced at 14 dh/m against a 16 dh/m cost. The till saw cost 0, so it saw no loss.
    const unconfirmed = await saleBody(1400);
    const [refused] = await pushAs(asCashier, 'till', {
      entity: 'sale',
      entityId: unconfirmed.sale.id,
      kind: 'append',
      payload: unconfirmed,
      baseServerSeq: null,
    });
    expect(refused).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.belowCostUnconfirmed);

    // Confirming it is the owner's decision.
    const confirmed = await saleBody(1400, { confirmedBelowCost: true });
    const [forbidden] = await pushAs(asCashier, 'till', {
      entity: 'sale',
      entityId: confirmed.sale.id,
      kind: 'append',
      payload: confirmed,
      baseServerSeq: null,
    });
    expect(forbidden).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
    expect(forbidden?.error?.issues?.[0]?.message).toBe(ACCESS_ISSUES.belowCostByCashier);
  });

  it('everything else a cashier pushes is refused: purchases, batches, expenses, voids, refunds', async () => {
    const now = new Date().toISOString();
    const base = { createdAt: now, updatedAt: now, deviceId: 'till', voidedAt: null };
    const attempts: Omit<SyncOp, 'opId' | 'deviceId' | 'clientTs'>[] = [
      {
        entity: 'product_batch',
        entityId: roll.id,
        kind: 'upsert',
        payload: { ...roll, costTotalCents: 0, deviceId: 'till' },
        baseServerSeq: 1,
      },
      {
        entity: 'expense',
        entityId: crypto.randomUUID(),
        kind: 'upsert',
        payload: { ...base, id: crypto.randomUUID() },
        baseServerSeq: null,
      },
      {
        entity: 'customer',
        entityId: customerId,
        kind: 'void',
        payload: { reason: 'x' },
        baseServerSeq: 1,
      },
      {
        entity: 'payment',
        entityId: crypto.randomUUID(),
        kind: 'append',
        payload: {
          payment: {
            ...base,
            id: crypto.randomUUID(),
            customerId,
            kind: 'refund',
            amountCents: 100,
            date: '2026-10-30',
            method: 'cash',
            note: null,
          },
          allocations: [],
        },
        baseServerSeq: null,
      },
    ];
    const results = await pushAs(asCashier, 'till', ...attempts);
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ['rejected', 'forbidden'],
      ['rejected', 'forbidden'],
      ['rejected', 'forbidden'],
      ['rejected', 'forbidden'],
    ]);
    // The batch still costs what it did.
    expect((await kit.detail(roll.id)).batch.costTotalCents).toBe(80_000);
  });

  it('a cashier never sells under the minimum price: the till refuses it, and so does the server (ADR 0012)', async () => {
    // The till has the product's minimum on the line and will not build a sale under it.
    await expect(saleBody(1650, { batch: guarded })).rejects.toThrow(SALE_ISSUES.belowMinimum);

    // A till that drops the minimum from the line (stale, or not honest) is judged by the server
    // against the product: 16.50 under 17 is refused.
    const hidden = await saleBody(1650, { batch: guarded, minPriceCents: 0 });
    const [refused] = await pushAs(asCashier, 'till', saleOp(hidden));
    expect(refused).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.belowMinimum);

    // An override is the owner's: a cashier's sale cannot carry one, whatever name it gives.
    const overridden = await saleBody(1650, { batch: guarded, minOverrideBy: 'owner' });
    const [forbidden] = await pushAs(asCashier, 'till', saleOp(overridden));
    expect(forbidden).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
    expect(forbidden?.error?.issues?.[0]?.message).toBe(ACCESS_ISSUES.belowMinimumByCashier);
    expect(await kit.remaining(guarded.id)).toBe(5000);

    // The same price goes through for the owner, who confirms it.
    const [applied] = await pushAs(asOwner, 'till', saleOp(overridden));
    expect(applied?.status).toBe('applied');
    expect(await kit.remaining(guarded.id)).toBe(4900);
  });

  it('a cashier may add a customer', async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const [result] = await pushAs(asCashier, 'till', {
      entity: 'customer',
      entityId: id,
      kind: 'upsert',
      payload: {
        id,
        createdAt: now,
        updatedAt: now,
        deviceId: 'till',
        voidedAt: null,
        name: 'زبونة جديدة',
        phone: null,
        notes: null,
      },
      baseServerSeq: null,
    });
    expect(result?.status).toBe('applied');
  });
});
