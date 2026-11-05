import {
  batchCode,
  batchDetailSchema,
  buildBatchMove,
  buildProductPurchase,
  batchLedgerOf,
  deviceRegistrationSchema,
  HEADERS,
  newBatchActionSchema,
  type NewProductPurchaseInput,
  newProductPurchaseSchema,
  PURCHASE_ISSUES,
  type ProductPurchaseAggregate,
  PRODUCT_PURCHASE_ISSUES,
  purchaseDetailSchema,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const NOW = '2026-11-03T09:00:00.000Z';
const DAY = '2026-11-03';

describe('purchases → stock batches (ADR 0012)', () => {
  let t: TestApp;
  let session: Session;
  const products = Array.from({ length: 8 }, () => crypto.randomUUID());
  let counter = 0;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    for (const [index, id] of products.entries()) {
      await as(t.http().put(`/products/${id}`))
        .send({
          name: `Rosa ${String(index + 1)}`,
          purchaseUnits: ['kg', 'meter', 'piece'],
          sellingUnits: ['meter'],
          pricePerMeterCents: 300,
          minPricePerMeterCents: 200,
        })
        .expect(200);
    }
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>, device = 'desk') {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, device);
  }

  const product = (index: number) => products[index] ?? '';

  function aggregateOf(input: NewProductPurchaseInput, device = 'desk'): ProductPurchaseAggregate {
    return buildProductPurchase(
      newProductPurchaseSchema.parse(input),
      {
        purchaseId: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        moveId: crypto.randomUUID(),
        code: batchCode('A', ++counter),
      },
      { deviceId: device, now: NOW },
    );
  }

  const opOf = (aggregate: ProductPurchaseAggregate): SyncOp => ({
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
  const batchDetail = async (id: string) =>
    batchDetailSchema.parse((await as(t.http().get(`/batches/${id}`)).expect(200)).body);

  const base = { date: DAY, supplierId: null, notes: null };
  /** Rosa: 100 kg for 200 dh. */
  const rosa = (index: number, extra: Partial<NewProductPurchaseInput> = {}) =>
    ({
      ...base,
      productId: product(index),
      unit: 'kg',
      quantity: 100_000,
      totalCostCents: 20_000,
      ...extra,
    }) satisfies NewProductPurchaseInput;

  it('gives each device its own code once (A, B…), the prefix of its batch codes', async () => {
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

  it('known conversion: 100 kg for 200 dh at 0.5 kg per meter is 200 m at 1 dh, atomically', async () => {
    const aggregate = aggregateOf(
      rosa(0, { conversion: { weightG: 500, lengthCm: 100, source: 'measured' } }),
    );
    const [result] = await push(opOf(aggregate));
    expect(result?.status).toBe('applied');
    const { purchase, batches } = await detail(aggregate.purchase.id);
    expect(purchase).toMatchObject({
      totalCostCents: 20_000,
      paidCents: 20_000,
      method: 'kg',
      weightG: 100_000,
    });
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch).toMatchObject({
      code: 'B-A0001',
      productId: product(0),
      unit: 'kg',
      receivedQuantity: 100_000,
      costTotalCents: 20_000,
      conversion: { weightG: 500, lengthCm: 100, source: 'measured' },
    });
    const { ledger } = await batchDetail(batch?.id ?? '');
    expect(ledger).toMatchObject({
      available: { meter: { unit: 'meter', centimeters: 20_000 } },
      costPerUnitCents: { meter: 100 },
      measurementStatus: 'measured',
      unallocatedCostCents: 20_000,
    });
  });

  it('unknown conversion: the stock is recorded, awaits a measurement, and no meters are made up', async () => {
    const aggregate = aggregateOf(rosa(1));
    expect((await push(opOf(aggregate)))[0]?.status).toBe('applied');
    const batch = (await detail(aggregate.purchase.id)).batches[0];
    expect(batch).toMatchObject({ unit: 'kg', receivedQuantity: 100_000, conversion: null });
    const { ledger } = await batchDetail(batch?.id ?? '');
    expect(ledger).toMatchObject({
      measurementStatus: 'pending',
      awaitingMeasurement: { unit: 'kg', grams: 100_000 },
      available: { meter: { unit: 'meter', centimeters: 0 } },
      unallocatedCostCents: 20_000,
      lengthBasisCm: null,
    });
  });

  it('measuring it makes it saleable (190 m, 200 dh over 190 m) and leaves the purchase as it was', async () => {
    const aggregate = aggregateOf(rosa(2));
    await push(opOf(aggregate));
    const [batch] = aggregate.batches;
    const [receipt] = aggregate.moves;
    if (!batch || !receipt) throw new Error('a purchase makes a batch');
    const built = buildBatchMove(
      newBatchActionSchema.parse({
        type: 'measure',
        batchId: batch.id,
        date: DAY,
        lengthCm: 19_000,
      }),
      batch,
      batchLedgerOf(batch, [receipt]),
      { id: crypto.randomUUID(), deviceId: 'desk', now: NOW, actor: 'Owner' },
    );
    if (!built.ok) throw new Error('expected a measurement');
    const [result] = await push({
      opId: crypto.randomUUID(),
      entity: 'product_stock_move',
      entityId: built.move.id,
      kind: 'append',
      payload: built.move,
      deviceId: 'desk',
      clientTs: NOW,
      baseServerSeq: null,
    });
    expect(result?.status).toBe('applied');

    const after = await batchDetail(batch.id);
    expect(after.ledger).toMatchObject({
      measurementStatus: 'measured',
      awaitingMeasurement: null,
      available: { meter: { unit: 'meter', centimeters: 19_000 } },
      costPerUnitCents: { meter: 105 },
      unallocatedCostCents: 20_000,
    });
    expect(after.moves.map((move) => move.type)).toEqual(['purchase', 'measurement']);
    expect(after.batch).toMatchObject({
      receivedQuantity: 100_000,
      costTotalCents: 20_000,
      conversion: null,
    });
    expect(after.moves[1]).toMatchObject({ actor: 'Owner', delta: 19_000 });
  });

  it('refuses a stock move that does not belong alone, or that the ledger cannot read', async () => {
    const aggregate = aggregateOf(rosa(3));
    await push(opOf(aggregate));
    const batch = aggregate.batches[0];
    const send = async (fields: Record<string, unknown>) => {
      const move = {
        id: crypto.randomUUID(),
        createdAt: NOW,
        updatedAt: NOW,
        deviceId: 'desk',
        voidedAt: null,
        batchId: batch?.id,
        type: 'loss',
        unit: 'meter',
        delta: -100,
        refId: null,
        date: DAY,
        note: 'stain',
        actor: null,
        ...fields,
      };
      const [result] = await push({
        opId: crypto.randomUUID(),
        entity: 'product_stock_move',
        entityId: move.id,
        kind: 'append',
        payload: move,
        deviceId: 'desk',
        clientTs: NOW,
        baseServerSeq: null,
      });
      return result;
    };
    // A loss in meters of a weight that has no length.
    expect(await send({})).toMatchObject({
      status: 'rejected',
      error: { code: 'validation_failed' },
    });
    // A sale comes inside a sale.
    expect(await send({ type: 'sale', refId: crypto.randomUUID() })).toMatchObject({
      status: 'rejected',
    });
    // A batch the server does not have.
    expect(await send({ batchId: crypto.randomUUID() })).toMatchObject({
      status: 'rejected',
      error: { code: 'conflict' },
    });
    // In kilograms it is a loss the ledger can read.
    expect(await send({ unit: 'kg', delta: -500 })).toMatchObject({ status: 'applied' });
  });

  it('a restock is a batch of its own with its own cost and conversion', async () => {
    const first = aggregateOf(
      rosa(4, { conversion: { weightG: 500, lengthCm: 100, source: 'measured' } }),
    );
    const second = aggregateOf(
      rosa(4, {
        date: '2026-11-10',
        quantity: 50_000,
        totalCostCents: 15_000,
        conversion: { weightG: 400, lengthCm: 100, source: 'estimated' },
      }),
    );
    expect((await push(opOf(first), opOf(second))).map((result) => result.status)).toEqual([
      'applied',
      'applied',
    ]);
    const one = (await detail(first.purchase.id)).batches[0];
    const two = (await detail(second.purchase.id)).batches[0];
    expect([one?.productId, two?.productId]).toEqual([product(4), product(4)]);
    expect(one?.code).not.toBe(two?.code);
    expect((await batchDetail(one?.id ?? '')).ledger.costPerUnitCents.meter).toBe(100);
    expect((await batchDetail(two?.id ?? '')).ledger.costPerUnitCents.meter).toBe(120);
  });

  it('meters and pieces are received in their own unit', async () => {
    const meters = aggregateOf({
      ...rosa(5),
      unit: 'meter',
      quantity: 5_000,
      totalCostCents: 80_000,
    });
    const pieces = aggregateOf({ ...rosa(5), unit: 'piece', quantity: 12, totalCostCents: 6_000 });
    await push(opOf(meters), opOf(pieces));
    const m = await batchDetail((await detail(meters.purchase.id)).batches[0]?.id ?? '');
    const p = await batchDetail((await detail(pieces.purchase.id)).batches[0]?.id ?? '');
    expect(m.ledger.available.meter).toEqual({ unit: 'meter', centimeters: 5_000 });
    expect(m.ledger.costPerUnitCents.meter).toBe(1_600);
    expect(p.ledger.available.piece).toEqual({ unit: 'piece', pieces: 12 });
    expect(p.ledger.costPerUnitCents.piece).toBe(500);
  });

  it('re-checks with core: a batch that does not match its purchase is rejected, nothing is stored', async () => {
    const aggregate = aggregateOf(rosa(6));
    const tampered = structuredClone(aggregate);
    if (tampered.batches[0]) tampered.batches[0].receivedQuantity = 1;
    const [result] = await push(opOf(tampered));
    expect(result).toMatchObject({
      status: 'rejected',
      error: {
        code: 'validation_failed',
        issues: [expect.objectContaining({ message: PURCHASE_ISSUES.notCore })],
      },
    });
    const stored = await t.sql.query(`SELECT 1 FROM purchase WHERE id = $1`, [
      tampered.purchase.id,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it('rejects a batch code already taken, a product the server does not have, and a unit it is not bought in', async () => {
    const first = aggregateOf({ ...rosa(6), unit: 'piece', quantity: 3, totalCostCents: 3_000 });
    await push(opOf(first));
    const sameCode = aggregateOf({ ...rosa(6), unit: 'piece', quantity: 3, totalCostCents: 3_000 });
    if (sameCode.batches[0] && first.batches[0]) sameCode.batches[0].code = first.batches[0].code;
    const unknown = aggregateOf({
      ...rosa(6),
      productId: crypto.randomUUID(),
      unit: 'piece',
      quantity: 1,
      totalCostCents: 100,
    });
    const results = await push(opOf(sameCode), opOf(unknown));
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ['rejected', 'conflict'],
      ['rejected', 'validation_failed'],
    ]);
    expect(results[1]?.error?.issues?.[0]?.message).toBe(PRODUCT_PURCHASE_ISSUES.unknownProduct);

    const meterOnly = crypto.randomUUID();
    await as(t.http().put(`/products/${meterOnly}`))
      .send({
        name: 'Meters only',
        purchaseUnits: ['meter'],
        sellingUnits: ['meter'],
        pricePerMeterCents: 300,
        minPricePerMeterCents: 200,
      })
      .expect(200);
    const byWeight = aggregateOf({ ...rosa(6), productId: meterOnly });
    const [refused] = await push(opOf(byWeight));
    expect(refused?.error?.issues?.[0]?.message).toBe(PRODUCT_PURCHASE_ISSUES.unitNotSupported);
  });

  it('is idempotent, and an append-only purchase is never overwritten', async () => {
    const aggregate = aggregateOf({
      ...rosa(7),
      unit: 'meter',
      quantity: 200,
      totalCostCents: 2_000,
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
    changed.purchase.notes = 'edit attempt';
    const [again] = await push({ ...opOf(changed), opId: crypto.randomUUID() });
    expect(again).toMatchObject({ status: 'applied', serverSeq: first?.serverSeq });
    expect((await detail(aggregate.purchase.id)).purchase.notes).toBeNull();
    const batches = await t.sql.query(`SELECT 1 FROM product_batch WHERE purchase_id = $1`, [
      aggregate.purchase.id,
    ]);
    expect(batches.rowCount).toBe(1);
  });

  it('devices pull the products, purchases, batches and their moves', async () => {
    const response = await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200);
    const entities = new Set(
      syncPullResponseSchema.parse(response.body).changes.map((change) => change.entity),
    );
    expect(entities).toEqual(
      new Set(['product', 'purchase', 'product_batch', 'product_stock_move']),
    );
  });

  it('REST: creates the same aggregate once, audited', async () => {
    const aggregate = aggregateOf({
      ...rosa(0),
      unit: 'piece',
      quantity: 5,
      totalCostCents: 1_500,
    });
    const created = await as(t.http().post('/purchases')).send(aggregate).expect(201);
    expect(purchaseDetailSchema.parse(created.body).batches).toHaveLength(1);
    await as(t.http().post('/purchases')).send(aggregate).expect(409);
    const audit = await t.sql.query<{ action: string; after: ProductPurchaseAggregate }>(
      `SELECT action, after FROM audit_log WHERE entity = 'purchase' AND entity_id = $1`,
      [aggregate.purchase.id],
    );
    expect(audit.rows.map((row) => [row.action, row.after.batches.length])).toEqual([
      ['create', 1],
    ]);
  });
});
