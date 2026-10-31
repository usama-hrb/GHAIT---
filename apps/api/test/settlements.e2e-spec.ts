import {
  auditListResponseSchema,
  buildPurchaseAggregate,
  buildSaleAggregate,
  buildStockMove,
  errorResponseSchema,
  HEADERS,
  newSaleSchema,
  type NewPurchaseInput,
  newPurchaseSchema,
  newStockMoveSchema,
  rollCode,
  rollDetailSchema,
  SETTLEMENT_ISSUES,
  type SettlementDetail,
  settlementDetailSchema,
  type SettlementPreview,
  settlementPreviewSchema,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const dh = (amount: number) => amount * 100;

describe('monthly settlement and the period lock (BUILD_PROMPTS 4.3)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  let counter = 0;
  let clock = Date.UTC(2026, 7, 1, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();
  /** T6's roll: 100 m at 16 dh/m; then a long one for the other months. */
  let t6Roll: string;
  let roll: string;
  let augustSale = '';

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 5000, isOwner: false })
      .expect(200);
    const fabricId = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1000 })
      .expect(200);
    await as(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    t6Roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 10_000 }],
    });
    roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 50_000 }],
    });
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

  function op(entity: SyncOp['entity'], entityId: string, payload: unknown): SyncOp {
    return {
      opId: crypto.randomUUID(),
      entity,
      entityId,
      kind: 'append',
      payload,
      deviceId: 'desk',
      clientTs: new Date(clock).toISOString(),
      baseServerSeq: null,
    };
  }

  async function buy(input: Partial<NewPurchaseInput>): Promise<string> {
    const aggregate = buildPurchaseAggregate(
      newPurchaseSchema.parse({ date: '2026-08-01', ...input }),
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
    return aggregate.rolls[0]?.id ?? '';
  }

  const rollDetail = async (id: string) =>
    rollDetailSchema.parse((await as(t.http().get(`/rolls/${id}`)).expect(200)).body);

  /** A cash sale: `soldCm` at `perMeterCents`, paid in full; the op's result. */
  async function cashSale(rollId: string, soldCm: number, perMeterCents: number, date: string) {
    const detail = await rollDetail(rollId);
    const built = buildSaleAggregate(
      newSaleSchema.parse({
        date,
        customerId: null,
        lines: [
          {
            rollId,
            soldCm,
            price: { perMeterCents },
            refPricePerMeterCents: 2000,
            minPricePerMeterCents: 1000,
          },
        ],
        paidCents: Math.round((perMeterCents * soldCm) / 100),
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
    return { saleId: built.aggregate.sale.id, result };
  }

  const putExpense = (id: string, paidDate: string | null, amountCents: number, date = paidDate) =>
    as(t.http().put(`/expenses/${id}`)).send({ date, category: 'rent', amountCents, paidDate });

  const preview = async (end: string): Promise<SettlementPreview> =>
    settlementPreviewSchema.parse(
      (await as(t.http().get(`/settlements/preview?end=${end}`)).expect(200)).body,
    );

  async function settle(end: string): Promise<SettlementDetail> {
    const { breakdown } = await preview(end);
    return settlementDetailSchema.parse(
      (
        await as(t.http().post('/settlements'))
          .send({ periodEnd: end, expected: breakdown })
          .expect(201)
      ).body,
    );
  }

  const account = async (id: string) =>
    (
      (await as(t.http().get(`/partners/${id}/account`)).expect(200)).body as {
        account: Record<string, number>;
      }
    ).account;

  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  it('T6 + T10: 2000 dh of cash sales, capital 1600, expenses 100 → thirds; the shop’s third is capital', async () => {
    const sale = await cashSale(t6Roll, 10_000, 2000, '2026-08-05');
    expect(sale.result?.status).toBe('applied');
    augustSale = sale.saleId;
    await putExpense(crypto.randomUUID(), '2026-08-20', dh(100)).expect(200);

    expect(await preview('2026-08-31')).toMatchObject({
      periodStart: '2026-08-01',
      recognizedProfitCents: dh(400),
      expensesCents: dh(100),
      netProfitCents: 30_000,
      ownerShareCents: 10_000,
      partnerShareCents: 10_000,
      shopShareCents: 10_000,
    });
    const august = await settle('2026-08-31');
    expect(august.settlement).toMatchObject({ periodEnd: '2026-08-31', netProfitCents: 30_000 });
    expect(august.shares.map((share) => [share.partnerId, share.amountCents])).toEqual([
      [owner, 10_000],
      [partner, 10_000],
    ]);
    expect(
      august.retainedProfit.map((move) => [move.partnerId, move.type, move.amountCents, move.date]),
    ).toEqual([
      [owner, 'retained_profit', 5000, '2026-08-31'],
      [partner, 'retained_profit', 5000, '2026-08-31'],
    ]);
    expect(august.lockedCostCount).toBe(1);
    expect(await account(owner)).toMatchObject({
      retainedProfitCents: 5000,
      sharesCents: 10_000,
      undrawnCents: 10_000,
    });

    const audit = auditListResponseSchema.parse(
      (await as(t.http().get('/audit?entity=settlement')).expect(200)).body,
    );
    expect(audit.items[0]).toMatchObject({ entityId: august.settlement.id, action: 'create' });

    // Devices pull the settlement and everything it created.
    const pulled = syncPullResponseSchema.parse(
      (await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200)).body,
    );
    const entities = new Set(pulled.changes.map((change) => change.entity));
    for (const entity of ['settlement', 'settlement_share', 'locked_cost'] as const) {
      expect(entities.has(entity)).toBe(true);
    }
  });

  it('T9: a losing September carries 100 dh into October, which is settled after it', async () => {
    await cashSale(roll, 1000, 2100, '2026-09-04'); // 160 dh of cloth for 210: 50 dh profit
    await putExpense(crypto.randomUUID(), '2026-09-15', dh(150)).expect(200);
    const september = await settle('2026-09-30');
    expect(september.settlement).toMatchObject({
      periodStart: '2026-09-01',
      netProfitCents: dh(-100),
      carryDeficitOutCents: 10_000,
    });
    expect(september.shares).toEqual([]);

    await cashSale(roll, 5000, 2200, '2026-10-03'); // 800 dh of cloth for 1100: 300 dh profit
    const october = await settle('2026-10-10');
    expect(october.settlement).toMatchObject({
      periodStart: '2026-10-01',
      carriedDeficitInCents: 10_000,
      netProfitCents: dh(200),
      ownerShareCents: 6666,
      partnerShareCents: 6666,
      shopShareCents: 6668,
    });
  });

  it('T7: a net of 100 dh → 3333 + 3333 + 3334', async () => {
    await cashSale(roll, 1000, 2600, '2026-10-12'); // 160 dh of cloth for 260
    const settled = await settle('2026-10-20');
    expect(settled.settlement).toMatchObject({
      periodStart: '2026-10-11',
      ownerShareCents: 3333,
      partnerShareCents: 3333,
      shopShareCents: 3334,
    });
  });

  it('a settled period is locked: nothing dated in it is added, changed or voided', async () => {
    // A sale a device made offline on 15 September, pushed now.
    const late = await cashSale(roll, 100, 2000, '2026-09-15');
    expect(late.result).toMatchObject({ status: 'rejected', error: { code: 'period_locked' } });

    const paidInSeptember = await putExpense(crypto.randomUUID(), '2026-09-10', dh(5)).expect(409);
    expect(errorOf(paidInSeptember.body)).toMatchObject({
      code: 'period_locked',
      issues: [expect.objectContaining({ message: SETTLEMENT_ISSUES.locked })],
    });

    // An unpaid September bill is in no period: paying it today counts in the open one.
    const bill = crypto.randomUUID();
    await putExpense(bill, null, dh(30), '2026-09-05').expect(200);
    await putExpense(bill, '2026-10-25', dh(30), '2026-09-05').expect(200);
    await putExpense(bill, '2026-09-30', dh(30), '2026-09-05').expect(409);

    // The August sale can no longer be voided.
    const voided = await as(t.http().post(`/sales/${augustSale}/void`))
      .send({ reason: 'خطأ' })
      .expect(409);
    expect(errorOf(voided.body).code).toBe('period_locked');

    // Retained profit is dated in its settled period: it goes only with its settlement.
    const settlements = (await as(t.http().get('/settlements')).expect(200)).body as {
      id: string;
      periodEnd: string;
    }[];
    const august = settlementDetailSchema.parse(
      (
        await as(
          t
            .http()
            .get(`/settlements/${settlements.find((s) => s.periodEnd === '2026-08-31')?.id ?? ''}`),
        ).expect(200)
      ).body,
    );
    const [retained] = august.retainedProfit;
    await as(t.http().post(`/capital-moves/${retained?.id ?? ''}/void`))
      .send({ reason: 'خطأ' })
      .expect(409);
  });

  it('only the latest period is unlocked, with a reason; then it takes what arrived and is settled again', async () => {
    const all = (await as(t.http().get('/settlements')).expect(200)).body as {
      id: string;
      periodEnd: string;
    }[];
    const latest = all.find((s) => s.periodEnd === '2026-10-20');
    const august = all.find((s) => s.periodEnd === '2026-08-31');
    const refused = await as(t.http().post(`/settlements/${august?.id ?? ''}/unlock`))
      .send({ reason: 'تصحيح' })
      .expect(409);
    expect(errorOf(refused.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.notLatest }),
    ]);

    const unlocked = settlementDetailSchema.parse(
      (
        await as(t.http().post(`/settlements/${latest?.id ?? ''}/unlock`))
          .send({ reason: 'مبيعات الهاتف وصلت متأخرة' })
          .expect(200)
      ).body,
    );
    expect(unlocked.settlement.voidedAt).not.toBeNull();
    expect(unlocked.shares.every((share) => share.voidedAt !== null)).toBe(true);
    expect(unlocked.retainedProfit.every((move) => move.voidedAt !== null)).toBe(true);
    const audit = auditListResponseSchema.parse(
      (await as(t.http().get(`/audit?entity=settlement&entityId=${latest?.id ?? ''}`)).expect(200))
        .body,
    );
    expect(audit.items[0]).toMatchObject({ action: 'void', reason: 'مبيعات الهاتف وصلت متأخرة' });

    // The phone's sale of 15 October now goes in.
    expect((await cashSale(roll, 1000, 2600, '2026-10-15')).result?.status).toBe('applied');
    const stale = (await preview('2026-10-20')).breakdown;
    await cashSale(roll, 1000, 2600, '2026-10-16');
    const changed = await as(t.http().post('/settlements'))
      .send({ periodEnd: '2026-10-20', expected: stale })
      .expect(409);
    expect(errorOf(changed.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.changed }),
    ]);
    const again = await settle('2026-10-20');
    expect(again.settlement).toMatchObject({ periodStart: '2026-10-11', netProfitCents: dh(300) });
  });

  it('a settled sale keeps its cost when its kg roll is measured later (P9)', async () => {
    // 2 kg estimated at 500 cm/kg: 1000 cm for 100 dh; half of it sold, then the period settled.
    const kgRoll = await buy({
      date: '2026-10-21',
      method: 'kg',
      variantId,
      weightG: 2000,
      totalCostCents: dh(100),
      estCmPerKg: 500,
    });
    await cashSale(kgRoll, 500, 1600, '2026-10-21');
    expect((await settle('2026-10-25')).lockedCostCount).toBe(1);

    // Measured at 800 cm in all: unfrozen, the settled half would now cost 62.50 dh.
    const detail = await rollDetail(kgRoll);
    const measured = buildStockMove(
      newStockMoveSchema.parse({
        type: 'length_correction',
        rollId: kgRoll,
        date: '2026-10-27',
        measuredRemainingCm: 300,
      }),
      detail.ledger,
      { id: crypto.randomUUID(), deviceId: 'desk', now: tick() },
    );
    if (!measured.ok) throw new Error(JSON.stringify(measured.issues));
    const [result] = await push(op('stock_move', measured.move.id, measured.move));
    expect(result?.status).toBe('applied');
    expect((await rollDetail(kgRoll)).ledger).toMatchObject({
      basisLengthCm: 800,
      costs: [expect.objectContaining({ costCents: dh(50) })],
      unallocatedCostCents: dh(50),
    });
  });

  it('split rules: only future ones, each on its own date', async () => {
    const id = crypto.randomUUID();
    await as(t.http().put(`/split-rules/${id}`))
      .send({ effectiveFrom: '2026-01-01', ownerWeight: 2, partnerWeight: 2, shopWeight: 1 })
      .expect(400);
    await as(t.http().put(`/split-rules/${id}`))
      .send({ effectiveFrom: '2099-01-01', ownerWeight: 2, partnerWeight: 2, shopWeight: 1 })
      .expect(200);
    await as(t.http().put(`/split-rules/${crypto.randomUUID()}`))
      .send({ effectiveFrom: '2099-01-01', ownerWeight: 1, partnerWeight: 1, shopWeight: 1 })
      .expect(400);
    await as(t.http().post(`/split-rules/${id}/void`))
      .send({ reason: 'اتفقنا على غير ذلك' })
      .expect(200);
    expect(((await as(t.http().get('/split-rules')).expect(200)).body as unknown[]).length).toBe(1);
  });

  it('a period that has not ended, or was settled, cannot be settled', async () => {
    const notEnded = await as(t.http().get('/settlements/preview?end=2099-12-31')).expect(400);
    expect(errorOf(notEnded.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.notEnded }),
    ]);
    const settled = await as(t.http().get('/settlements/preview?end=2026-09-30')).expect(400);
    expect(errorOf(settled.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.beforeLast }),
    ]);
  });
});
