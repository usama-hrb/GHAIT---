import {
  auditActorsSchema,
  auditListResponseSchema,
  buildPurchaseAggregate,
  buildSaleAggregate,
  buildStockMove,
  CASH_COUNT_ISSUES,
  errorResponseSchema,
  HEADERS,
  integrityReportSchema,
  newPurchaseSchema,
  newSaleSchema,
  newStockMoveSchema,
  rollCode,
  rollDetailSchema,
  settlementPreviewSchema,
  shopDate,
  storedCashAdjustmentSchema,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, OWNER, type Session, type TestApp } from './support/app.js';

const dh = (amount: number) => amount * 100;

describe('the integrity check, cash counts and the audit log (BUILD_PROMPTS 4.4)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  let clock = Date.UTC(2026, 7, 1, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();
  let rollId = '';
  let expenseId = '';

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
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

  function op(
    entity: SyncOp['entity'],
    entityId: string,
    payload: unknown,
    kind: SyncOp['kind'] = 'append',
  ): SyncOp {
    return {
      opId: crypto.randomUUID(),
      entity,
      entityId,
      kind,
      payload,
      deviceId: 'desk',
      clientTs: new Date(clock).toISOString(),
      baseServerSeq: null,
    };
  }

  const report = async () =>
    integrityReportSchema.parse((await as(t.http().get('/integrity')).expect(200)).body);

  /** A sale of 10 m at 20 dh on the roll; `paidCents` at the counter. */
  async function sell(date: string, paidCents: number, customerId: string | null) {
    const detail = rollDetailSchema.parse(
      (await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body,
    );
    const built = buildSaleAggregate(
      newSaleSchema.parse({
        date,
        customerId,
        lines: [
          {
            rollId,
            soldCm: 1000,
            price: { perMeterCents: 2000 },
            refPricePerMeterCents: 2000,
            minPricePerMeterCents: 1000,
          },
        ],
        paidCents,
      }),
      new Map([[rollId, { roll: detail.roll, moves: detail.moves }]]),
      {
        saleId: crypto.randomUUID(),
        lineIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const [result] = await push(op('sale', built.aggregate.sale.id, built.aggregate));
    expect(result?.status).toBe('applied');
    return built.aggregate.sale.id;
  }

  it('T13 end to end: every event through the API, then the settlement; it balances to the cent', async () => {
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 5000, isOwner: false })
      .expect(200);
    for (const partnerId of [owner, partner]) {
      await as(t.http().put(`/capital-moves/${crypto.randomUUID()}`))
        .send({ partnerId, kind: 'contribution', amountCents: dh(1000), date: '2026-08-01' })
        .expect(200);
    }
    const fabricId = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1000 })
      .expect(200);
    await as(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    // T12's roll: 50 m at 16 dh, paid.
    const purchase = buildPurchaseAggregate(
      newPurchaseSchema.parse({
        method: 'meter',
        date: '2026-08-02',
        pricePerMeterCents: 1600,
        rolls: [{ variantId, lengthCm: 5000 }],
      }),
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('A', 1)],
      },
      { deviceId: 'desk', now: tick() },
    );
    await push(op('purchase', purchase.purchase.id, purchase));
    rollId = purchase.rolls[0]?.id ?? '';

    await sell('2026-08-05', dh(200), null); // cash
    const customer = crypto.randomUUID();
    await as(t.http().put(`/customers/${customer}`))
      .send({ name: 'فاطمة' })
      .expect(200);
    const credit = await sell('2026-08-06', 0, customer);
    await as(t.http().post(`/customers/${customer}/payments`))
      .send({ amountCents: dh(100), date: '2026-08-10', targetSaleId: credit })
      .expect(201);
    expenseId = crypto.randomUUID();
    await as(t.http().put(`/expenses/${expenseId}`))
      .send({ date: '2026-08-12', category: 'rent', amountCents: dh(10), paidDate: '2026-08-12' })
      .expect(200);
    const detail = rollDetailSchema.parse(
      (await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body,
    );
    const loss = buildStockMove(
      newStockMoveSchema.parse({
        type: 'loss',
        rollId,
        date: '2026-08-15',
        lengthCm: 30,
        reason: 'تلف',
      }),
      detail.ledger,
      { id: crypto.randomUUID(), deviceId: 'desk', now: tick() },
    );
    if (!loss.ok) throw new Error('a loss');
    await push(op('stock_move', loss.move.id, loss.move));
    await as(t.http().put(`/partner-draws/${crypto.randomUUID()}`))
      .send({ partnerId: owner, amountCents: dh(20), date: '2026-08-20', reason: 'مصروف شخصي' })
      .expect(200);

    expect(await report()).toMatchObject({ ok: true, diffCents: 0, lockedThrough: null });
    const { breakdown } = settlementPreviewSchema.parse(
      (await as(t.http().get('/settlements/preview?end=2026-08-31')).expect(200)).body,
    );
    await as(t.http().post('/settlements'))
      .send({ periodEnd: '2026-08-31', expected: breakdown })
      .expect(201);

    const settled = await report();
    expect(settled).toMatchObject({
      ok: true,
      holdingsCents: 200_520,
      claimsCents: 200_520,
      lockedThrough: '2026-08-31',
    });
    expect(settled.breakdown).toEqual([
      { side: 'holdings', key: 'cash', cents: 147_000 },
      { side: 'holdings', key: 'stock_at_cost', cents: 47_520 },
      { side: 'holdings', key: 'unrecovered_capital', cents: 6000 },
      { side: 'claims', key: 'capital', cents: 200_840 },
      { side: 'claims', key: 'partner_balances', cents: -320 },
      { side: 'claims', key: 'unsettled_net_profit', cents: 0 },
      { side: 'claims', key: 'customer_credits', cents: 0 },
      { side: 'claims', key: 'supplier_payables', cents: 0 },
    ]);
  });

  it('a record changed behind the API, inside the settled month, shows as a difference', async () => {
    // What the API would refuse (the month is locked), written straight into the database.
    await t.sql.query('UPDATE expense SET amount_cents = amount_cents + 500 WHERE id = $1', [
      expenseId,
    ]);
    expect(await report()).toMatchObject({ ok: false, diffCents: -500 });
    await t.sql.query('UPDATE expense SET amount_cents = amount_cents - 500 WHERE id = $1', [
      expenseId,
    ]);
    expect((await report()).ok).toBe(true);
  });

  it('a cash count moves the books to the money counted; a difference needs a reason; voided, it goes', async () => {
    const day = shopDate(new Date());
    const before = await report();
    const cash = before.breakdown.find((line) => line.key === 'cash')?.cents ?? 0;
    const noReason = await as(t.http().put(`/cash-counts/${crypto.randomUUID()}`))
      .send({ date: day, countedCents: cash + 300 })
      .expect(400);
    expect(errorResponseSchema.parse(noReason.body).error.issues).toEqual([
      expect.objectContaining({ message: CASH_COUNT_ISSUES.reasonRequired }),
    ]);
    const locked = await as(t.http().put(`/cash-counts/${crypto.randomUUID()}`))
      .send({ date: '2026-08-20', countedCents: cash, note: null })
      .expect(409);
    expect(errorResponseSchema.parse(locked.body).error.code).toBe('period_locked');

    const id = crypto.randomUUID();
    const count = storedCashAdjustmentSchema.parse(
      (
        await as(t.http().put(`/cash-counts/${id}`))
          .send({ date: day, countedCents: cash + 300, note: 'ورقة في الدرج' })
          .expect(200)
      ).body,
    );
    expect(count).toMatchObject({ expectedCents: cash, countedCents: cash + 300, diffCents: 300 });
    const after = await report();
    expect(after.ok).toBe(true);
    expect(after.breakdown.find((line) => line.key === 'cash')?.cents).toBe(cash + 300);
    expect(after.breakdown.find((line) => line.key === 'unsettled_net_profit')?.cents).toBe(300);

    // Never edited: a device that changes the amount is refused.
    const { serverSeq, ...record } = count;
    const [edited] = await push({
      ...op(
        'cash_adjustment',
        id,
        { ...record, countedCents: cash + 1, diffCents: 301, updatedAt: new Date().toISOString() },
        'upsert',
      ),
      baseServerSeq: serverSeq,
    });
    expect(edited).toMatchObject({ status: 'rejected' });

    await as(t.http().post(`/cash-counts/${id}/void`))
      .send({ reason: 'عددت مرتين' })
      .expect(200);
    expect((await report()).breakdown.find((line) => line.key === 'cash')?.cents).toBe(cash);
  });

  it('the audit log: filtered by entity, account and day; each entry names who; a void says why', async () => {
    const actors = auditActorsSchema.parse(
      (await as(t.http().get('/audit/actors')).expect(200)).body,
    );
    const me = actors.find((actor) => actor.role === 'owner');
    expect(me).toMatchObject({ displayName: OWNER.displayName });

    const counts = auditListResponseSchema.parse(
      (await as(t.http().get('/audit?entity=cash_adjustment')).expect(200)).body,
    );
    expect(counts.items.map((entry) => entry.action)).toEqual(['void', 'create']);
    expect(counts.items[0]).toMatchObject({ reason: 'عددت مرتين', actorName: OWNER.displayName });

    const today = shopDate(new Date());
    const mine = auditListResponseSchema.parse(
      (
        await as(
          t.http().get(`/audit?actorId=${me?.id ?? ''}&from=${today}&to=${today}&limit=200`),
        ).expect(200)
      ).body,
    );
    expect(mine.items.length).toBeGreaterThan(5);
    expect(mine.items.every((entry) => entry.actorId === me?.id)).toBe(true);
    const longAgo = auditListResponseSchema.parse(
      (await as(t.http().get('/audit?from=2020-01-01&to=2020-01-31')).expect(200)).body,
    );
    expect(longAgo.items).toEqual([]);
  });
});
