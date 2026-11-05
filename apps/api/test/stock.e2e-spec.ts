import {
  buildBatchMove,
  HEADERS,
  newBatchActionSchema,
  type NewBatchActionInput,
  type ProductStockMove,
  STOCK_ISSUES,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';
import { stockKit } from './support/stock.js';

/** Losses, counts and measurements of a batch, pushed the way a device does (ADR 0012). */
describe('stock: losses, stocktake, measurements', () => {
  let t: TestApp;
  let session: Session;
  let kit: ReturnType<typeof stockKit>;
  let productId = '';
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();
  const day = '2026-10-30';

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    kit = stockKit(t, () => session, push);
    productId = await kit.product();
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
    payload: unknown,
    kind: SyncOp['kind'] = 'append',
    baseServerSeq: number | null = null,
    entityId = (payload as { id: string }).id,
  ): SyncOp => ({
    opId: crypto.randomUUID(),
    entity,
    entityId,
    kind,
    payload,
    deviceId: 'desk',
    clientTs: new Date(clock).toISOString(),
    baseServerSeq,
  });

  /** Builds the move on the server's current view of the batch, as a device would on its own. */
  async function move(input: NewBatchActionInput): Promise<ProductStockMove> {
    const { batch, ledger } = await kit.detail(input.batchId);
    const built = buildBatchMove(newBatchActionSchema.parse(input), batch, ledger, {
      id: crypto.randomUUID(),
      deviceId: 'desk',
      now: tick(),
      actor: 'owner',
    });
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.move;
  }

  const record = async (input: NewBatchActionInput) => {
    const stockMove = await move(input);
    const [result] = await push(op('product_stock_move', stockMove));
    return { stockMove, result };
  };

  it('T3: 100 + 100 + 30 cm off the 230 cm piece cost 4348 + 4348 + 1304, exactly the batch', async () => {
    const piece = await kit.buy({ productId, quantity: 230, totalCostCents: 10_000 });
    for (const quantity of [100, 100, 30]) {
      const { result } = await record({
        type: 'loss',
        batchId: piece.id,
        date: day,
        quantity,
        reason: 'تالف',
      });
      expect(result?.status).toBe('applied');
    }
    const { ledger, moves } = await kit.detail(piece.id);
    expect(ledger.costs.map((entry) => entry.costCents)).toEqual([4348, 4348, 1304]);
    expect(ledger).toMatchObject({ unallocatedCostCents: 0 });
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 0 });
    expect(moves.map((m) => m.type)).toEqual(['purchase', 'loss', 'loss', 'loss']);
  });

  it('T12: a 30 cm loss on a 50 m batch that cost 800 dh costs 480 and leaves 49.70 m', async () => {
    const batch = await kit.rosa(productId);
    const { stockMove } = await record({
      type: 'loss',
      batchId: batch.id,
      date: day,
      quantity: 30,
      reason: 'بقعة',
    });
    const { ledger } = await kit.detail(batch.id);
    expect(ledger.costs).toEqual([{ moveId: stockMove.id, costCents: 480 }]);
    expect(ledger).toMatchObject({
      unallocatedCostCents: 79_520,
      costPerUnitCents: { meter: 1600 },
    });
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 4970 });
  });

  it('T4: measuring the 80 m kg estimate at 76 m: 5.26 dh/m, no longer estimated', async () => {
    const batch = await kit.buy({
      productId,
      unit: 'kg',
      quantity: 20_000,
      totalCostCents: 40_000,
      conversion: { weightG: 20_000, lengthCm: 8000, source: 'estimated' },
    });
    expect((await kit.detail(batch.id)).ledger).toMatchObject({
      measurementStatus: 'estimated',
      costPerUnitCents: { meter: 500 },
    });
    const { stockMove, result } = await record({
      type: 'measure',
      batchId: batch.id,
      date: day,
      lengthCm: 7600,
    });
    expect(result?.status).toBe('applied');
    expect(stockMove).toMatchObject({ type: 'measurement', delta: 7600 });
    const { ledger } = await kit.detail(batch.id);
    expect(ledger).toMatchObject({
      lengthBasisCm: 7600,
      measurementStatus: 'measured',
      costPerUnitCents: { meter: 526 },
    });
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 7600 });
  });

  it('a stocktake records the difference with the books', async () => {
    const batch = await kit.rosa(productId);
    const { stockMove } = await record({
      type: 'adjustment',
      batchId: batch.id,
      date: day,
      counted: 4920,
      reason: 'جرد الشهر',
    });
    expect(stockMove).toMatchObject({ type: 'adjustment', delta: -80, note: 'جرد الشهر' });
    const { ledger } = await kit.detail(batch.id);
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 4920 });
    expect(ledger.lengthBasisCm).toBe(5000);
  });

  it('re-checks every move against its batch', async () => {
    const batch = await kit.buy({ productId, quantity: 1000, totalCostCents: 16_000 });
    const loss = await move({
      type: 'loss',
      batchId: batch.id,
      date: day,
      quantity: 30,
      reason: 'x',
    });
    const results = await push(
      op('product_stock_move', { ...loss, id: crypto.randomUUID(), delta: 30 }),
      op('product_stock_move', { ...loss, id: crypto.randomUUID(), note: null }),
      op('product_stock_move', { ...loss, id: crypto.randomUUID(), type: 'purchase' }),
      op('product_stock_move', {
        ...loss,
        id: crypto.randomUUID(),
        type: 'length_correction',
        delta: 0,
      }),
      op('product_stock_move', { ...loss, id: crypto.randomUUID(), batchId: crypto.randomUUID() }),
    );
    expect(
      results.map((result) => [
        result.status,
        result.error?.issues?.[0]?.message ?? result.error?.code,
      ]),
    ).toEqual([
      ['rejected', STOCK_ISSUES.invalidQuantity],
      ['rejected', STOCK_ISSUES.reasonRequired],
      ['rejected', STOCK_ISSUES.notPushable],
      ['rejected', STOCK_ISSUES.noChange],
      ['rejected', 'conflict'],
    ]);
    // Append-only: the same move again is a no-op, never a second row.
    const [first] = await push(op('product_stock_move', loss));
    const [again] = await push(op('product_stock_move', loss));
    expect(again).toMatchObject({ status: 'applied', serverSeq: first?.serverSeq });
    expect((await kit.detail(batch.id)).moves.filter((m) => m.type === 'loss')).toHaveLength(1);
  });

  it('a batch can be marked a remnant; its other fields are fixed', async () => {
    const batch = await kit.buy({ productId, quantity: 300, totalCostCents: 4800 });
    const { batch: current } = await kit.detail(batch.id);
    const { serverSeq, ...record } = current;
    const [marked] = await push(
      op('product_batch', { ...record, status: 'remnant', updatedAt: tick() }, 'upsert', serverSeq),
    );
    expect(marked?.status).toBe('applied');
    expect((await kit.detail(batch.id)).batch.status).toBe('remnant');

    const [cheaper, voided] = await push(
      op(
        'product_batch',
        { ...record, costTotalCents: 1, updatedAt: tick() },
        'upsert',
        marked?.serverSeq ?? null,
      ),
      { ...op('product_batch', record, 'void'), payload: { reason: 'خطأ' } },
    );
    expect(cheaper).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(voided).toMatchObject({ status: 'rejected', error: { code: 'bad_request' } });
  });
});
