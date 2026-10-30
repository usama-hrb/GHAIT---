import {
  buildPurchaseAggregate,
  deviceRegistrationSchema,
  HEADERS,
  type NewPurchase,
  PURCHASE_ISSUES,
  type PurchaseAggregate,
  purchaseDetailSchema,
  rollCode,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const NOW = '2026-10-30T09:00:00.000Z';

describe('purchases → rolls (BUILD_PROMPTS 3.2)', () => {
  let t: TestApp;
  let session: Session;
  const fabricId = crypto.randomUUID();
  const colors = Array.from({ length: 10 }, () => crypto.randomUUID());
  let counter = 0;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1800 })
      .expect(200);
    for (const [index, id] of colors.entries()) {
      await as(t.http().put(`/variants/${id}`))
        .send({ fabricId, colorName: `لون ${String(index + 1)}` })
        .expect(200);
    }
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>, device = 'desk') {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, device);
  }

  function aggregateOf(input: NewPurchase, device = 'desk'): PurchaseAggregate {
    const count = input.method === 'meter' ? input.rolls.length : 1;
    return buildPurchaseAggregate(
      input,
      {
        purchaseId: crypto.randomUUID(),
        rollIds: Array.from({ length: count }, () => crypto.randomUUID()),
        moveIds: Array.from({ length: count }, () => crypto.randomUUID()),
        shortCodes: Array.from({ length: count }, () => rollCode('A', ++counter)),
      },
      { deviceId: device, now: NOW },
    );
  }

  const opOf = (aggregate: PurchaseAggregate): SyncOp => ({
    opId: crypto.randomUUID(),
    entity: 'purchase',
    entityId: aggregate.purchase.id,
    kind: 'append',
    payload: aggregate,
    deviceId: aggregate.purchase.deviceId,
    clientTs: NOW,
    baseServerSeq: null,
  });

  const push = async (...ops: SyncOp[]): Promise<SyncOpResult[]> => {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };

  const detail = async (id: string) =>
    purchaseDetailSchema.parse((await as(t.http().get(`/purchases/${id}`)).expect(200)).body);

  const common = { date: '2026-10-30', supplierId: null, notes: null };

  it('gives each device its own code once (A, B…), the prefix of its roll codes', async () => {
    const code = async (device: string) =>
      deviceRegistrationSchema.parse(
        (await as(t.http().post('/devices/register'), device).expect(200)).body,
      ).code;
    await expect(code('desk')).resolves.toBe('A');
    await expect(code('phone')).resolves.toBe('B');
    await expect(code('desk')).resolves.toBe('A');
    await t
      .http()
      .post('/devices/register')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(400);
  });

  it('T1: an assortment of 10 colours × 50 m at 16 dh → 10 rolls of 800 dh, atomically', async () => {
    const aggregate = aggregateOf({
      method: 'meter',
      ...common,
      pricePerMeterCents: 1600,
      rolls: colors.map((variantId) => ({ variantId, lengthCm: 5000 })),
    });
    const [result] = await push(opOf(aggregate));
    expect(result?.status).toBe('applied');
    const { purchase, rolls } = await detail(aggregate.purchase.id);
    expect(purchase).toMatchObject({
      totalCostCents: 800_000,
      paidCents: 800_000,
      method: 'meter',
    });
    expect(rolls).toHaveLength(10);
    expect(
      rolls.every((roll) => roll.lengthCmInitial === 5000 && roll.costTotalCents === 80_000),
    ).toBe(true);
    expect(rolls[0]?.shortCode).toBe('R-A0001');
    const moves = await t.sql.query<{ type: string; delta_cm: number }>(
      `SELECT type, delta_cm FROM stock_move WHERE ref_id = $1`,
      [aggregate.purchase.id],
    );
    expect(moves.rows).toHaveLength(10);
    expect(moves.rows.every((move) => move.type === 'purchase' && move.delta_cm === 5000)).toBe(
      true,
    );
  });

  it('T2: a piece of 2.3 m for 100 dh → one roll costing 10000 (43.48 dh/m)', async () => {
    const aggregate = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[0] ?? '',
      lengthCm: 230,
      totalCostCents: 10_000,
    });
    expect((await push(opOf(aggregate)))[0]?.status).toBe('applied');
    expect((await detail(aggregate.purchase.id)).rolls).toEqual([
      expect.objectContaining({
        lengthCmInitial: 230,
        costTotalCents: 10_000,
        lengthEstimated: false,
      }),
    ]);
  });

  it('T4: 20 kg for 400 dh at 400 cm/kg → an estimated 80 m roll', async () => {
    const aggregate = aggregateOf({
      method: 'kg',
      ...common,
      variantId: colors[1] ?? '',
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    });
    expect((await push(opOf(aggregate)))[0]?.status).toBe('applied');
    const { purchase, rolls } = await detail(aggregate.purchase.id);
    expect(purchase).toMatchObject({ weightG: 20_000, estCmPerKg: 400 });
    expect(rolls[0]).toMatchObject({
      lengthCmInitial: 8000,
      costTotalCents: 40_000,
      lengthEstimated: true,
    });
  });

  it('re-checks with core: a roll cheaper than its purchase is rejected, nothing is stored', async () => {
    const aggregate = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[2] ?? '',
      lengthCm: 300,
      totalCostCents: 9000,
    });
    const tampered = structuredClone(aggregate);
    if (tampered.rolls[0]) tampered.rolls[0].costTotalCents = 1;
    const [result] = await push(opOf(tampered));
    expect(result).toMatchObject({
      status: 'rejected',
      error: {
        code: 'validation_failed',
        issues: [
          expect.objectContaining({
            path: ['rolls', 0, 'costTotalCents'],
            message: PURCHASE_ISSUES.notCore,
          }),
        ],
      },
    });
    const stored = await t.sql.query(`SELECT 1 FROM purchase WHERE id = $1`, [
      tampered.purchase.id,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it('rejects a roll code already taken and a colour the server does not have', async () => {
    const first = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[3] ?? '',
      lengthCm: 100,
      totalCostCents: 1000,
    });
    await push(opOf(first));
    const sameCode = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[3] ?? '',
      lengthCm: 100,
      totalCostCents: 1000,
    });
    if (sameCode.rolls[0] && first.rolls[0]) sameCode.rolls[0].shortCode = first.rolls[0].shortCode;
    const unknownColor = aggregateOf({
      method: 'piece',
      ...common,
      variantId: crypto.randomUUID(),
      lengthCm: 100,
      totalCostCents: 1000,
    });
    const results = await push(opOf(sameCode), opOf(unknownColor));
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ['rejected', 'conflict'],
      ['rejected', 'conflict'],
    ]);
  });

  it('is idempotent, and an append-only purchase is never overwritten', async () => {
    const aggregate = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[4] ?? '',
      lengthCm: 200,
      totalCostCents: 2000,
    });
    const op = opOf(aggregate);
    const [first] = await push(op);
    const [replay] = await push(op);
    expect(replay).toMatchObject({
      status: 'duplicate',
      originalStatus: 'applied',
      serverSeq: first?.serverSeq,
    });
    const changed = structuredClone(aggregate);
    changed.purchase.notes = 'محاولة تعديل';
    const [again] = await push({ ...opOf(changed), opId: crypto.randomUUID() });
    expect(again).toMatchObject({ status: 'applied', serverSeq: first?.serverSeq });
    expect((await detail(aggregate.purchase.id)).purchase.notes).toBeNull();
    const rolls = await t.sql.query(`SELECT 1 FROM roll WHERE purchase_id = $1`, [
      aggregate.purchase.id,
    ]);
    expect(rolls.rowCount).toBe(1);
  });

  it('devices pull purchases, rolls and their moves', async () => {
    const response = await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200);
    const entities = new Set(
      syncPullResponseSchema.parse(response.body).changes.map((change) => change.entity),
    );
    expect(entities).toEqual(new Set(['fabric', 'variant', 'purchase', 'roll', 'stock_move']));
  });

  it('REST: creates the same aggregate once, audited', async () => {
    const aggregate = aggregateOf({
      method: 'piece',
      ...common,
      variantId: colors[5] ?? '',
      lengthCm: 150,
      totalCostCents: 1500,
    });
    const created = await as(t.http().post('/purchases')).send(aggregate).expect(201);
    expect(purchaseDetailSchema.parse(created.body).rolls).toHaveLength(1);
    await as(t.http().post('/purchases')).send(aggregate).expect(409);
    const audit = await t.sql.query<{ action: string; after: PurchaseAggregate }>(
      `SELECT action, after FROM audit_log WHERE entity = 'purchase' AND entity_id = $1`,
      [aggregate.purchase.id],
    );
    expect(audit.rows.map((row) => [row.action, row.after.rolls.length])).toEqual([['create', 1]]);
  });
});
