import {
  buildPurchaseAggregate,
  buildSaleAggregate,
  buildSaleVoid,
  HEADERS,
  INVENTORY_ISSUES,
  type NewPurchase,
  type NewSaleInput,
  newSaleSchema,
  type Roll,
  rollCode,
  rollDetailSchema,
  type RollHistory,
  SALE_ISSUES,
  type SaleAggregate,
  type SaleDetail,
  saleDetailSchema,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

/** Omit over each member of a union (plain Omit keeps only the keys they share). */
type PurchaseBody = NewPurchase extends infer P
  ? P extends NewPurchase
    ? Omit<P, 'date' | 'supplierId' | 'notes'>
    : never
  : never;

const DAY = '2026-10-30';

describe('sales (BUILD_PROMPTS 3.4)', () => {
  let t: TestApp;
  let session: Session;
  const variantId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  let counter = 0;
  // Each record a little later than the previous one: history order is creation order.
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    const fabricId = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1700 })
      .expect(200);
    await as(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
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

  const push = async (...ops: SyncOp[]): Promise<SyncOpResult[]> => {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };

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

  async function buy(input: PurchaseBody): Promise<Roll> {
    const aggregate = buildPurchaseAggregate(
      { ...input, date: '2026-10-01', supplierId: null, notes: null },
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('A', ++counter)],
      },
      { deviceId: 'desk', now: tick() },
    );
    const [result] = await push(op('purchase', aggregate.purchase.id, aggregate));
    expect(result?.status).toBe('applied');
    const [roll] = aggregate.rolls;
    if (!roll) throw new Error('no roll');
    return roll;
  }

  /** T1's roll: 50 m that cost 800 dh (16 dh/m). */
  const rosa = () =>
    buy({ method: 'meter', pricePerMeterCents: 1600, rolls: [{ variantId, lengthCm: 5000 }] });

  async function history(rollId: string): Promise<RollHistory> {
    const detail = rollDetailSchema.parse(
      (await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body,
    );
    return { roll: detail.roll, moves: detail.moves };
  }

  const remaining = async (rollId: string) =>
    rollDetailSchema.parse((await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body).ledger
      .remainingCm;

  /** Builds the sale on the server's current view of its rolls, as a device would on its own. */
  async function saleOf(input: NewSaleInput): Promise<SaleAggregate> {
    const parsed = newSaleSchema.parse(input);
    const histories = new Map(
      await Promise.all(
        [...new Set(parsed.lines.map((line) => line.rollId))].map(
          async (id) => [id, await history(id)] as const,
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

  const line = (rollId: string, soldCm: number, perMeterCents: number) => ({
    rollId,
    soldCm,
    price: { perMeterCents },
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
  });

  it('T5: 1 m at 18 dh on a 16 dh/m roll: capital 1600, profit 200, paid in cash', async () => {
    const roll = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      lines: [line(roll.id, 100, 1800)],
      paidCents: 1800,
    });
    expect(result?.status).toBe('applied');
    expect((await detail(aggregate.sale.id)).figures).toMatchObject({
      lines: [{ costCents: 1600, profitCents: 200, provisional: false }],
      totalCents: 1800,
      capitalCents: 1600,
      profitCents: 200,
      paidCents: 1800,
      dueCents: 0,
    });
    expect(await remaining(roll.id)).toBe(4900);
  });

  it('T11: a sale under cost is refused unless confirmed; confirmed, it is stored with its loss', async () => {
    const roll = await rosa();
    const confirmed = await saleOf({
      date: DAY,
      lines: [line(roll.id, 100, 1400)],
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

  it('a sale across two rolls takes each one’s share; a tampered total is refused', async () => {
    const short = await buy({ method: 'piece', variantId, lengthCm: 300, totalCostCents: 4800 });
    const long = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      lines: [line(short.id, 300, 1800), line(long.id, 200, 1800)],
      paidCents: 9000,
    });
    expect(result?.status).toBe('applied');
    expect([await remaining(short.id), await remaining(long.id)]).toEqual([0, 4800]);
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
    const roll = await rosa();
    const { aggregate, result } = await sell({
      date: DAY,
      customerId,
      lines: [line(roll.id, 250, 2000)],
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
      lines: [line(roll.id, 100, 2000)],
      paidCents: 0,
    });
    const [refused] = await push(op('sale', stranger.sale.id, stranger));
    expect(refused).toMatchObject({ status: 'rejected', error: { code: 'conflict' } });
  });

  it('voiding a sale puts the cloth back, refunds the payment, and is audited; only once', async () => {
    const roll = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(roll.id, 400, 1800)],
      paidCents: 7200,
    });
    expect(await remaining(roll.id)).toBe(4600);
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
    expect(await remaining(roll.id)).toBe(5000);
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
    const roll = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(roll.id, 100, 1800)],
      paidCents: 1800,
    });
    const response = await as(t.http().post(`/sales/${aggregate.sale.id}/void`))
      .send({ reason: 'خطأ' })
      .expect(200);
    expect(saleDetailSchema.parse(response.body).saleVoid).toMatchObject({ reason: 'خطأ' });
    expect(await remaining(roll.id)).toBe(5000);
    await as(t.http().post(`/sales/${crypto.randomUUID()}/void`))
      .send({ reason: 'x' })
      .expect(404);
  });

  it('lines, payments and reversals only arrive inside their sale or void; devices pull them all', async () => {
    const roll = await rosa();
    const { aggregate } = await sell({
      date: DAY,
      lines: [line(roll.id, 100, 1800)],
      paidCents: 1800,
    });
    const [firstLine] = aggregate.lines;
    const [firstMove] = aggregate.moves;
    if (!firstLine || !firstMove || !aggregate.payment) throw new Error('expected records');
    const reversal = {
      ...firstMove,
      id: crypto.randomUUID(),
      type: 'reversal' as const,
      deltaCm: 100,
      refId: firstMove.id,
      note: 'x',
    };
    const results = await push(
      op('sale_line', firstLine.id, firstLine),
      op('payment', aggregate.payment.id, aggregate.payment),
      op('stock_move', reversal.id, reversal),
    );
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results[2]?.error?.issues?.[0]?.message).toBe(INVENTORY_ISSUES.notPushable);

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
    ]) {
      expect(entities).toContain(entity);
    }
    const list = await as(t.http().get('/sales')).expect(200);
    expect((list.body as unknown[]).length).toBeGreaterThan(5);
    await as(t.http().get(`/customers/${customerId}`)).expect(200);
    await as(t.http().get('/customers')).expect(200);
  });
});
