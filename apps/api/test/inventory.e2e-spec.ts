import {
  buildPurchaseAggregate,
  buildStockMove,
  HEADERS,
  INVENTORY_ISSUES,
  type NewPurchase,
  newStockMoveSchema,
  type NewStockMoveInput,
  type Roll,
  rollCode,
  type RollDetail,
  rollDetailSchema,
  type StockMove,
  type SyncOp,
  type SyncOpResult,
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

describe('inventory: losses, stocktake, measurements (BUILD_PROMPTS 3.3)', () => {
  let t: TestApp;
  let session: Session;
  const variantId = crypto.randomUUID();
  let counter = 0;
  // Each move a little later than the previous one: history order is creation order.
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    const fabricId = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1800 })
      .expect(200);
    await as(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
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
    kind: SyncOp['kind'],
    payload: { id: string; [field: string]: unknown },
    baseServerSeq: number | null = null,
  ): SyncOp => ({
    opId: crypto.randomUUID(),
    entity,
    entityId: payload.id,
    kind,
    payload,
    deviceId: 'desk',
    clientTs: new Date(clock).toISOString(),
    baseServerSeq,
  });

  /** Buys one roll and returns it. */
  async function buy(input: PurchaseBody): Promise<Roll> {
    const aggregate = buildPurchaseAggregate(
      { ...input, date: '2026-10-30', supplierId: null, notes: null },
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('A', ++counter)],
      },
      { deviceId: 'desk', now: tick() },
    );
    const [result] = await push({
      ...op('purchase', 'append', aggregate.purchase),
      payload: aggregate,
    });
    expect(result?.status).toBe('applied');
    const [roll] = aggregate.rolls;
    if (!roll) throw new Error('no roll');
    return roll;
  }

  const detail = async (rollId: string): Promise<RollDetail> =>
    rollDetailSchema.parse((await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body);

  /** Builds the move on the server's current view of the roll, as a device would on its own. */
  async function move(input: NewStockMoveInput): Promise<StockMove> {
    const { ledger } = await detail(input.rollId);
    const built = buildStockMove(newStockMoveSchema.parse(input), ledger, {
      id: crypto.randomUUID(),
      deviceId: 'desk',
      now: tick(),
    });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.move;
  }

  const record = async (input: NewStockMoveInput) => {
    const stockMove = await move(input);
    const [result] = await push(op('stock_move', 'append', stockMove));
    return { stockMove, result };
  };

  const day = '2026-10-30';

  it('T3: 100 + 100 + 30 cm off the 230 cm piece cost 4348 + 4348 + 1304, exactly the roll', async () => {
    const piece = await buy({ method: 'piece', variantId, lengthCm: 230, totalCostCents: 10_000 });
    for (const lengthCm of [100, 100, 30]) {
      const { result } = await record({
        type: 'loss',
        rollId: piece.id,
        date: day,
        lengthCm,
        reason: 'تالف',
      });
      expect(result?.status).toBe('applied');
    }
    const { ledger, moves } = await detail(piece.id);
    expect(ledger.costs.map((entry) => entry.costCents)).toEqual([4348, 4348, 1304]);
    expect(ledger).toMatchObject({ remainingCm: 0, unallocatedCostCents: 0 });
    expect(moves.map((m) => m.type)).toEqual(['purchase', 'loss', 'loss', 'loss']);
  });

  it('T12: a 30 cm loss on a 50 m roll that cost 800 dh costs 480 and leaves 49.70 m', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 5000 }],
    });
    const { stockMove } = await record({
      type: 'loss',
      rollId: roll.id,
      date: day,
      lengthCm: 30,
      reason: 'بقعة',
    });
    const { ledger } = await detail(roll.id);
    expect(ledger.costs).toEqual([{ id: stockMove.id, costCents: 480 }]);
    expect(ledger).toMatchObject({
      remainingCm: 4970,
      unallocatedCostCents: 79_520,
      costPerMeterCents: 1600,
    });
  });

  it('T4: measuring the 80 m kg estimate at 76 m: −400 cm, 5.26 dh/m, no longer estimated', async () => {
    const roll = await buy({
      method: 'kg',
      variantId,
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    });
    expect((await detail(roll.id)).ledger).toMatchObject({
      lengthEstimated: true,
      costPerMeterCents: 500,
    });
    const { stockMove, result } = await record({
      type: 'length_correction',
      rollId: roll.id,
      date: day,
      measuredRemainingCm: 7600,
    });
    expect(result?.status).toBe('applied');
    expect(stockMove.deltaCm).toBe(-400);
    expect((await detail(roll.id)).ledger).toMatchObject({
      basisLengthCm: 7600,
      remainingCm: 7600,
      lengthEstimated: false,
      costPerMeterCents: 526,
    });
  });

  it('a stocktake records the difference with the books', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 5000 }],
    });
    const { stockMove } = await record({
      type: 'adjustment',
      rollId: roll.id,
      date: day,
      countedCm: 4920,
      reason: 'جرد الشهر',
    });
    expect(stockMove).toMatchObject({ type: 'adjustment', deltaCm: -80, note: 'جرد الشهر' });
    expect((await detail(roll.id)).ledger).toMatchObject({
      remainingCm: 4920,
      basisLengthCm: 5000,
    });
  });

  it('re-checks every move against its roll', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 1000 }],
    });
    const loss = await move({
      type: 'loss',
      rollId: roll.id,
      date: day,
      lengthCm: 30,
      reason: 'x',
    });
    const results = await push(
      op('stock_move', 'append', { ...loss, id: crypto.randomUUID(), deltaCm: 30 }),
      op('stock_move', 'append', { ...loss, id: crypto.randomUUID(), note: null }),
      op('stock_move', 'append', { ...loss, id: crypto.randomUUID(), type: 'purchase' }),
      op('stock_move', 'append', {
        ...loss,
        id: crypto.randomUUID(),
        type: 'length_correction',
        deltaCm: -1000,
      }),
      op('stock_move', 'append', { ...loss, id: crypto.randomUUID(), rollId: crypto.randomUUID() }),
    );
    expect(
      results.map((result) => [
        result.status,
        result.error?.issues?.[0]?.message ?? result.error?.code,
      ]),
    ).toEqual([
      ['rejected', INVENTORY_ISSUES.invalidLength],
      ['rejected', INVENTORY_ISSUES.reasonRequired],
      ['rejected', INVENTORY_ISSUES.notPushable],
      ['rejected', INVENTORY_ISSUES.invalidLength],
      ['rejected', 'conflict'],
    ]);
    // Append-only: the same move again is a no-op, never a second row.
    const [first] = await push(op('stock_move', 'append', loss));
    const [again] = await push(op('stock_move', 'append', loss));
    expect(again).toMatchObject({ status: 'applied', serverSeq: first?.serverSeq });
    expect((await detail(roll.id)).moves.filter((m) => m.type === 'loss')).toHaveLength(1);
  });

  it('a roll can be marked a remnant; its other fields are fixed', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 300 }],
    });
    const { roll: current } = await detail(roll.id);
    const { serverSeq, ...record } = current;
    const [marked] = await push(
      op('roll', 'upsert', { ...record, status: 'remnant', updatedAt: tick() }, serverSeq),
    );
    expect(marked?.status).toBe('applied');
    expect((await detail(roll.id)).roll.status).toBe('remnant');

    const [cheaper, voided] = await push(
      op(
        'roll',
        'upsert',
        { ...record, costTotalCents: 1, updatedAt: tick() },
        marked?.serverSeq ?? null,
      ),
      { ...op('roll', 'void', record), payload: { reason: 'خطأ' } },
    );
    expect(cheaper).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(voided).toMatchObject({ status: 'rejected', error: { code: 'bad_request' } });
  });
});
