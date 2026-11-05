import {
  ACCESS_ISSUES,
  type BatchHistory,
  buildSaleAggregate,
  buildSaleVoid,
  HEADERS,
  type NewSaleInput,
  newSaleSchema,
  SALE_ISSUES,
  type SaleAggregate,
  type SaleDetail,
  saleDetailSchema,
  STOCK_ISSUES,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, OWNER, type Session, type TestApp } from './support/app.js';
import { stockKit } from './support/stock.js';

const DAY = '2026-10-30';

describe('sales on batches (BUILD_PROMPTS 3.4, ADR 0012)', () => {
  let t: TestApp;
  let session: Session;
  let kit: ReturnType<typeof stockKit>;
  let productId = '';
  const customerId = crypto.randomUUID();
  // Each record a little later than the previous one: history order is creation order.
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    kit = stockKit(t, () => session, push);
    productId = await kit.product();
    await as(t.http().put(`/customers/${customerId}`))
      .send({ name: 'فاطمة', phone: '0612345678' })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  async function push(...ops: SyncOp[]): Promise<SyncOpResult[]> {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  }

  const op = (
    entity: SyncOp['entity'],
    entityId: string,
    payload: unknown,
    kind: SyncOp['kind'] = 'append',
  ): SyncOp => ({
    opId: crypto.randomUUID(),
    entity,
    entityId,
    kind,
    payload,
    deviceId: 'desk',
    clientTs: new Date(clock).toISOString(),
    baseServerSeq: null,
  });

  /** T1's batch: 50 m that cost 800 dh (16 dh/m), of the shared product (20 dh, minimum 17). */
  const rosa = () => kit.buy({ productId, quantity: 5000, totalCostCents: 80_000 });

  /** Builds the sale on the server's current view of its batches, as a device would on its own. */
  async function saleOf(input: NewSaleInput): Promise<SaleAggregate> {
    const parsed = newSaleSchema.parse(input);
    const histories = new Map<string, BatchHistory>(
      await Promise.all(
        [...new Set(parsed.lines.map((line) => line.batchId))].map(
          async (id) => [id, await kit.history(id)] as const,
        ),
      ),
    );
    const built = buildSaleAggregate(
      parsed,
      histories,
      {
        saleId: crypto.randomUUID(),
        lineIds: parsed.lines.map(() => crypto.randomUUID()),
        moveIds: parsed.lines.map(() => crypto.randomUUID()),
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.aggregate;
  }

  const sell = async (input: NewSaleInput) => {
    const aggregate = await saleOf(input);
    const [result] = await push(op('sale', aggregate.sale.id, aggregate));
    return { aggregate, result };
  };

  const detail = async (saleId: string): Promise<SaleDetail> =>
    saleDetailSchema.parse((await as(t.http().get(`/sales/${saleId}`)).expect(200)).body);

  const line = (
    batchId: string,
    soldCm: number,
    perMeterCents: number,
    extra: Record<string, unknown> = {},
  ) => ({
    batchId,
    unit: 'meter' as const,
    quantity: soldCm,
    price: { perUnitCents: perMeterCents },
    refPriceCents: 2000,
    minPriceCents: 1700,
    ...extra,
  });

  it('T5: 1 m at 18 dh on a 16 dh/m batch: capital 1600, profit 200, paid in cash', async () => {
    const batch = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      lines: [line(batch.id, 100, 1800)],
      paidCents: 1800,
    });
    expect(result?.status).toBe('applied');
    const found = await detail(aggregate.sale.id);
    expect(found.figures).toMatchObject({
      lines: [{ costCents: 1600, profitCents: 200, provisional: false }],
      totalCents: 1800,
      capitalCents: 1600,
      profitCents: 200,
      paidCents: 1800,
      dueCents: 0,
    });
    expect(found.lines[0]).toMatchObject({
      batchId: batch.id,
      unit: 'meter',
      quantity: 100,
      actualPriceCents: 1800,
      minOverrideBy: null,
    });
    expect(await kit.remaining(batch.id)).toBe(4900);
  });

  it('T11: a sale under cost is refused unless confirmed; confirmed, it is stored with its loss', async () => {
    const batch = await rosa();
    const confirmed = await saleOf({
      date: DAY,
      lines: [line(batch.id, 100, 1400, { minOverrideBy: OWNER.username })],
      paidCents: 1400,
      confirmedBelowCost: true,
    });
    const unconfirmed = { ...confirmed, sale: { ...confirmed.sale, confirmedBelowCost: false } };
    const [refused] = await push(op('sale', confirmed.sale.id, unconfirmed));
    expect(refused).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.belowCostUnconfirmed);

    // The REST create runs the same checks and answers with the figures.
    const response = await as(t.http().post('/sales')).send(confirmed).expect(201);
    expect(saleDetailSchema.parse(response.body).figures).toMatchObject({
      capitalCents: 1600,
      profitCents: -200,
    });
  });

  it('a sale across two batches takes each one’s share; a tampered total is refused', async () => {
    const short = await kit.buy({ productId, quantity: 300, totalCostCents: 4800 });
    const long = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      lines: [line(short.id, 300, 1800), line(long.id, 200, 1800)],
      paidCents: 9000,
    });
    expect(result?.status).toBe('applied');
    expect([await kit.remaining(short.id), await kit.remaining(long.id)]).toEqual([0, 4800]);
    expect((await detail(aggregate.sale.id)).figures).toMatchObject({
      lines: [{ costCents: 4800 }, { costCents: 3200 }],
      capitalCents: 8000,
      profitCents: 1000,
    });

    const other = await saleOf({ date: DAY, lines: [line(long.id, 100, 1800)], paidCents: 1800 });
    const [tampered] = await push(
      op('sale', other.sale.id, { ...other, sale: { ...other.sale, totalCents: 1000 } }),
    );
    expect(tampered?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.notCore);
  });

  it('a credit sale owes the rest; an unknown customer is refused', async () => {
    const batch = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      customerId,
      lines: [line(batch.id, 250, 2000)],
      paidCents: 1000,
      dueDate: '2026-11-30',
    });
    expect(result?.status).toBe('applied');
    expect((await detail(aggregate.sale.id)).figures).toMatchObject({
      totalCents: 5000,
      paidCents: 1000,
      dueCents: 4000,
    });

    const stranger = await saleOf({
      date: DAY,
      customerId: crypto.randomUUID(),
      lines: [line(batch.id, 100, 2000)],
      paidCents: 0,
    });
    const [refused] = await push(op('sale', stranger.sale.id, stranger));
    expect(refused).toMatchObject({ status: 'rejected', error: { code: 'conflict' } });
  });

  it('voiding a sale puts the cloth back, refunds the payment, and is audited; only once', async () => {
    const batch = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(batch.id, 400, 1800)],
      paidCents: 7200,
    });
    expect(await kit.remaining(batch.id)).toBe(4600);
    const records = {
      sale: aggregate.sale,
      moves: aggregate.moves,
      allocations: aggregate.allocation ? [aggregate.allocation] : [],
      returns: [],
    };
    const voided = buildSaleVoid(
      { reason: 'أرجع الزبون القماش', date: DAY },
      records,
      {
        voidId: crypto.randomUUID(),
        reversalIds: [crypto.randomUUID()],
        refundId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    const [applied] = await push(op('sale_void', voided.saleVoid.id, voided));
    expect(applied?.status).toBe('applied');
    expect(await kit.remaining(batch.id)).toBe(5000);
    const after = await detail(aggregate.sale.id);
    expect(after.sale.voidedAt).not.toBeNull();
    expect(after.saleVoid).toMatchObject({
      reason: 'أرجع الزبون القماش',
      refundId: voided.refund?.id,
    });
    expect(after.figures).toMatchObject({ capitalCents: null, dueCents: 0, paidCents: 7200 });
    const { rows } = await t.sql.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log WHERE entity = 'sale' AND entity_id = $1`,
      [aggregate.sale.id],
    );
    expect(rows).toContainEqual({ action: 'void', reason: 'أرجع الزبون القماش' });

    const again = buildSaleVoid(
      { reason: 'مرة أخرى', date: DAY },
      records,
      {
        voidId: crypto.randomUUID(),
        reversalIds: [crypto.randomUUID()],
        refundId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    const [refused] = await push(op('sale_void', again.saleVoid.id, again));
    expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.alreadyVoided);
    await as(t.http().post(`/sales/${aggregate.sale.id}/void`))
      .send({ reason: 'x' })
      .expect(400);
  });

  it('REST void builds the reversal and the refund itself', async () => {
    const batch = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(batch.id, 100, 1800)],
      paidCents: 1800,
    });
    const response = await as(t.http().post(`/sales/${aggregate.sale.id}/void`))
      .send({ reason: 'خطأ' })
      .expect(200);
    expect(saleDetailSchema.parse(response.body).saleVoid).toMatchObject({ reason: 'خطأ' });
    expect(await kit.remaining(batch.id)).toBe(5000);
    await as(t.http().post(`/sales/${crypto.randomUUID()}/void`))
      .send({ reason: 'x' })
      .expect(404);
  });

  describe('the minimum selling price', () => {
    /** 16.50 a meter: under the minimum (17) but over the cost (16). */
    const underMinimum = (batchId: string, extra: Record<string, unknown> = {}) => ({
      date: DAY,
      lines: [line(batchId, 100, 1650, extra)],
      paidCents: 1650,
    });

    it('refuses a line under the product’s minimum, whatever minimum the device stored', async () => {
      const batch = await rosa();
      // A device with no minimum on the line (stale or tampered) builds a sale that looks fine...
      const stale = await saleOf(underMinimum(batch.id, { minPriceCents: 0 }));
      expect(stale.lines[0]).toMatchObject({ minPriceCents: 0, minOverrideBy: null });
      // ...the server judges it against the product, and refuses it.
      const [refused] = await push(op('sale', stale.sale.id, stale));
      expect(refused).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
      expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.belowMinimum);
      await as(t.http().post('/sales')).send(stale).expect(400);
      expect(await kit.remaining(batch.id)).toBe(5000);
    });

    it('lets the owner override it, and keeps who did and the price it went at', async () => {
      const batch = await rosa();
      const overridden = await saleOf(underMinimum(batch.id, { minOverrideBy: OWNER.username }));
      const [applied] = await push(op('sale', overridden.sale.id, overridden));
      expect(applied?.status).toBe('applied');

      const found = await detail(overridden.sale.id);
      expect(found.lines[0]).toMatchObject({
        minOverrideBy: OWNER.username,
        actualPriceCents: 1650,
        lineTotalCents: 1650,
        minPriceCents: 1700,
      });
      // Above the cost: the under-cost confirmation is not involved.
      expect(found.sale.confirmedBelowCost).toBe(false);
      expect(found.figures).toMatchObject({ profitCents: 50 });

      const { rows } = await t.sql.query<{
        action: string;
        reason: string;
        after: Record<string, unknown>;
      }>(
        `SELECT action, reason, after FROM audit_log WHERE entity = 'sale_line' AND entity_id = $1`,
        [overridden.lines[0]?.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'create',
        reason: 'sold under the minimum price',
        after: {
          saleId: overridden.sale.id,
          minOverrideBy: OWNER.username,
          appliedPriceCents: 1650,
          minPriceCents: 1700,
        },
      });
    });

    it('does not take another name for the owner’s: the override is the signed-in owner’s own', async () => {
      const batch = await rosa();
      const named = await saleOf(underMinimum(batch.id, { minOverrideBy: 'someone-else' }));
      const [refused] = await push(op('sale', named.sale.id, named));
      expect(refused).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
      expect(refused?.error?.issues?.[0]?.message).toBe(ACCESS_ISSUES.overrideNotByOwner);
    });

    it('keeps the under-cost confirmation separate from the override', async () => {
      const batch = await rosa();
      // 14 dh: under the minimum and under the 16 dh cost. Each needs its own decision.
      const both = await saleOf({
        date: DAY,
        lines: [line(batch.id, 100, 1400, { minOverrideBy: OWNER.username })],
        paidCents: 1400,
        confirmedBelowCost: true,
      });
      const withoutOverride = {
        ...both,
        lines: both.lines.map((l) => ({ ...l, minOverrideBy: null })),
      };
      const [noOverride] = await push(op('sale', both.sale.id, withoutOverride));
      expect(noOverride?.error?.issues?.map((i) => i.message)).toContain(SALE_ISSUES.belowMinimum);
      const withoutConfirmation = { ...both, sale: { ...both.sale, confirmedBelowCost: false } };
      const [noConfirmation] = await push(op('sale', both.sale.id, withoutConfirmation));
      expect(noConfirmation?.error?.issues?.map((i) => i.message)).toEqual([
        SALE_ISSUES.belowCostUnconfirmed,
      ]);
      const [applied] = await push(op('sale', both.sale.id, both));
      expect(applied?.status).toBe('applied');
    });
  });

  describe('selling by the piece', () => {
    let pieces = '';
    let batchId = '';

    beforeAll(async () => {
      pieces = await kit.product({
        name: 'وشاح',
        purchaseUnits: ['piece'],
        sellingUnits: ['piece'],
        pricePerMeterCents: null,
        minPricePerMeterCents: null,
        pricePerPieceCents: 1000,
        minPricePerPieceCents: 700,
      });
    });

    const pieceLine = (quantity: number, perPieceCents: number, extra = {}) => ({
      batchId,
      unit: 'piece' as const,
      quantity,
      price: { perUnitCents: perPieceCents },
      refPriceCents: 1000,
      minPriceCents: 700,
      ...extra,
    });

    it('counts, costs and returns pieces; the per-piece minimum holds', async () => {
      batchId = (
        await kit.buy({ productId: pieces, unit: 'piece', quantity: 10, totalCostCents: 5000 })
      ).id;
      const { aggregate, result } = await sell({
        date: DAY,
        lines: [pieceLine(3, 800)],
        paidCents: 2400,
      });
      expect(result?.status).toBe('applied');
      expect((await detail(aggregate.sale.id)).figures).toMatchObject({
        lines: [{ costCents: 1500, profitCents: 900 }],
        capitalCents: 1500,
      });
      expect(await kit.remaining(batchId, 'piece')).toBe(7);

      // A piece under its minimum (6 dh < 7 dh) is refused like a length is.
      const cheap = await saleOf({
        date: DAY,
        lines: [pieceLine(1, 600, { minPriceCents: 0 })],
        paidCents: 600,
      });
      const [refused] = await push(op('sale', cheap.sale.id, cheap));
      expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.belowMinimum);

      // One piece comes back through REST: the piece goes back on the shelf.
      await as(t.http().post(`/sales/${aggregate.sale.id}/return`))
        .send({
          date: DAY,
          reason: 'عيب',
          lines: [{ lineId: aggregate.lines[0]?.id, quantity: 1 }],
          refundCents: 800,
        })
        .expect(200);
      expect(await kit.remaining(batchId, 'piece')).toBe(8);
      expect((await detail(aggregate.sale.id)).figures).toMatchObject({
        returnedCents: 800,
        netTotalCents: 1600,
        lines: [{ costCents: 1000, returnedQuantity: 1 }],
      });
    });

    it('does not sell meters of a stock counted in pieces', async () => {
      const mixed = await kit.buy({
        productId: pieces,
        unit: 'piece',
        quantity: 4,
        totalCostCents: 2000,
      });
      const wrong = await saleOf({ date: DAY, lines: [pieceLine(1, 900)], paidCents: 900 });
      const asMeters = {
        ...wrong,
        lines: wrong.lines.map((l) => ({ ...l, batchId: mixed.id, unit: 'meter' as const })),
        moves: wrong.moves.map((m) => ({ ...m, batchId: mixed.id, unit: 'meter' as const })),
      };
      const [refused] = await push(op('sale', wrong.sale.id, asMeters));
      expect(refused).toMatchObject({ status: 'rejected' });
      expect(refused?.error?.issues?.[0]?.message).toBe(SALE_ISSUES.unitNotAvailable);
    });
  });

  it('lines, payments and reversals only arrive inside their sale or void; devices pull them all', async () => {
    const batch = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(batch.id, 100, 1800)],
      paidCents: 1800,
    });
    const [firstLine] = aggregate.lines;
    const [firstMove] = aggregate.moves;
    if (!firstLine || !firstMove || !aggregate.payment) throw new Error('expected records');
    const reversal = {
      ...firstMove,
      id: crypto.randomUUID(),
      type: 'reversal' as const,
      delta: 100,
      refId: firstMove.id,
      note: 'x',
    };
    const results = await push(
      op('sale_line', firstLine.id, firstLine),
      op('payment', aggregate.payment.id, aggregate.payment),
      op('product_stock_move', reversal.id, reversal),
      // The rolls the stock was kept on before batches are history: nothing writes them now.
      op('stock_move', reversal.id, reversal),
    );
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect(results[2]?.error?.issues?.[0]?.message).toBe(STOCK_ISSUES.notPushable);

    const pulled = syncPullResponseSchema.parse(
      (await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200)).body,
    );
    const entities = new Set(pulled.changes.map((change) => change.entity));
    for (const entity of [
      'customer',
      'sale',
      'sale_line',
      'payment',
      'payment_allocation',
      'sale_void',
      'product_batch',
      'product_stock_move',
    ]) {
      expect(entities).toContain(entity);
    }
    const list = await as(t.http().get('/sales')).expect(200);
    expect((list.body as unknown[]).length).toBeGreaterThan(5);
    await as(t.http().get(`/customers/${customerId}`)).expect(200);
    await as(t.http().get('/customers')).expect(200);
  });
});
