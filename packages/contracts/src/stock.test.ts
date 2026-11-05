import { productStockLedger } from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  availableIn,
  batchLedgerOf,
  buildBatchMove,
  buildProductPurchase,
  checkBatchMove,
  checkBatchUpdate,
  checkProductPurchase,
  checkProductRemoval,
  coreBatchOf,
  newBatchActionSchema,
  type NewProductPurchaseInput,
  newProductPurchaseSchema,
  type ProductBatch,
  type ProductPurchaseIds,
  previewProductPurchase,
  type ProductStockMove,
  wholeLengthFrom,
  workingUnitOf,
} from './index.js';

const NOW = '2026-11-03T10:00:00.000Z';
const DAY = '2026-11-03';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SUPPLIER = '22222222-2222-4222-8222-222222222222';
const META = { deviceId: 'desk', now: NOW };

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const idsFor = (code = 'B-A0001'): ProductPurchaseIds => ({
  purchaseId: uuid(),
  batchId: uuid(),
  moveId: uuid(),
  code,
});

const buy = (input: NewProductPurchaseInput, code?: string) =>
  buildProductPurchase(newProductPurchaseSchema.parse(input), idsFor(code), META);

/** Rosa: 100 kg for 200 dh (20,000 cents). */
const rosa = (extra: Partial<NewProductPurchaseInput> = {}): NewProductPurchaseInput => ({
  date: DAY,
  productId: PRODUCT,
  unit: 'kg',
  quantity: 100_000,
  totalCostCents: 20_000,
  ...extra,
});

describe('buying stock of a product (ADR 0012)', () => {
  it('known conversion: 100 kg at 0.5 kg per meter is 200 m for 200 dh, 1 dh per meter', () => {
    const input = newProductPurchaseSchema.parse(
      rosa({ conversion: { weightG: 500, lengthCm: 100, source: 'measured' } }),
    );
    const ledger = previewProductPurchase(input);
    expect(ledger).toMatchObject({
      purchaseUnit: 'kg',
      available: { meter: { unit: 'meter', centimeters: 20_000 } },
      costPerUnitCents: { meter: 100 },
      measurementStatus: 'measured',
      awaitingMeasurement: null,
      unallocatedCostCents: 20_000,
    });
  });

  it('unknown conversion: the weight is recorded, waits for a measurement and invents no meters', () => {
    const input = newProductPurchaseSchema.parse(rosa());
    const ledger = previewProductPurchase(input);
    expect(ledger).toMatchObject({
      measurementStatus: 'pending',
      awaitingMeasurement: { unit: 'kg', grams: 100_000 },
      available: { meter: { unit: 'meter', centimeters: 0 } },
      unallocatedCostCents: 20_000,
      lengthBasisCm: null,
    });
    expect(ledger.costPerUnitCents.meter).toBeUndefined();
    const aggregate = buy(rosa());
    expect(aggregate.batches[0]).toMatchObject({
      unit: 'kg',
      receivedQuantity: 100_000,
      conversion: null,
    });
    expect(aggregate.purchase).toMatchObject({
      method: 'kg',
      weightG: 100_000,
      totalCostCents: 20_000,
    });
  });

  it('measuring makes the weight saleable by the meter and keeps the purchase as it was (190 m)', () => {
    const aggregate = buy(rosa());
    const [batch] = aggregate.batches;
    const [receipt] = aggregate.moves;
    if (!batch || !receipt) throw new Error('a purchase makes a batch');
    const pending = batchLedgerOf(batch, [receipt]);
    expect(workingUnitOf(pending)).toBe('kg');

    const built = buildBatchMove(
      newBatchActionSchema.parse({
        type: 'measure',
        batchId: batch.id,
        date: DAY,
        lengthCm: 19_000,
      }),
      batch,
      pending,
      { id: uuid(), deviceId: 'desk', now: NOW, actor: 'Owner' },
    );
    if (!built.ok) throw new Error('expected a measurement');
    expect(built.move).toMatchObject({
      type: 'measurement',
      unit: 'meter',
      delta: 19_000,
      actor: 'Owner',
    });
    expect(checkBatchMove(built.move, batch, [receipt])).toEqual([]);

    const measured = batchLedgerOf(batch, [receipt, built.move]);
    expect(measured).toMatchObject({
      measurementStatus: 'measured',
      awaitingMeasurement: null,
      available: { meter: { unit: 'meter', centimeters: 19_000 } },
      lengthBasisCm: 19_000,
      // 200 dh over 190 m = 1.0526 dh per meter.
      costPerUnitCents: { meter: 105 },
      unallocatedCostCents: 20_000,
    });
    expect(batch).toMatchObject({
      receivedQuantity: 100_000,
      conversion: null,
      costTotalCents: 20_000,
    });
  });

  it('a restock is a batch of its own, with its own cost and conversion', () => {
    const first = buy(
      rosa({ conversion: { weightG: 500, lengthCm: 100, source: 'measured' } }),
      'B-A0001',
    );
    const second = buy(
      rosa({
        date: '2026-11-10',
        quantity: 50_000,
        totalCostCents: 15_000,
        conversion: { weightG: 400, lengthCm: 100, source: 'estimated' },
      }),
      'B-A0002',
    );
    const batches = [...first.batches, ...second.batches];
    expect(batches.map((batch) => batch.code)).toEqual(['B-A0001', 'B-A0002']);
    const ledger = productStockLedger(
      batches.map(coreBatchOf),
      [...first.moves, ...second.moves].map((move) => ({
        id: move.id,
        batchId: move.batchId,
        type: 'purchase' as const,
        date: move.date,
        createdAt: move.createdAt,
        delta: { unit: 'kg' as const, grams: move.delta },
      })),
    );
    // 100 kg at 0.5 kg/m = 200 m; 50 kg at 0.4 kg/m = 125 m: never blended.
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 32_500 });
    expect(ledger.batches.map((entry) => entry.costPerUnitCents.meter)).toEqual([100, 120]);
  });

  it('meters and pieces are received as they are bought', () => {
    const meters = buy({ ...rosa(), unit: 'meter', quantity: 5_000, totalCostCents: 80_000 });
    expect(meters.batches[0]).toMatchObject({
      unit: 'meter',
      receivedQuantity: 5_000,
      conversion: null,
    });
    expect(meters.purchase).toMatchObject({ method: 'meter', weightG: null });
    const pieces = buy({ ...rosa(), unit: 'piece', quantity: 12, totalCostCents: 6_000 });
    expect(
      previewProductPurchase(
        newProductPurchaseSchema.parse({
          ...rosa(),
          unit: 'piece',
          quantity: 12,
          totalCostCents: 6_000,
        }),
      ),
    ).toMatchObject({
      available: { piece: { unit: 'piece', pieces: 12 } },
      costPerUnitCents: { piece: 500 },
    });
    expect(pieces.batches[0]?.conversion).toBeNull();
  });

  it('only a weight can carry a conversion', () => {
    const parsed = newProductPurchaseSchema.safeParse({
      ...rosa(),
      unit: 'meter',
      conversion: { weightG: 500, lengthCm: 100, source: 'measured' },
    });
    expect(parsed.success).toBe(false);
  });

  it('what is paid now defaults to everything, and less leaves a debt to a named supplier', () => {
    expect(buy(rosa()).purchase.paidCents).toBe(20_000);
    expect(buy(rosa({ supplierId: SUPPLIER, paidCents: 5_000 })).purchase).toMatchObject({
      paidCents: 5_000,
      supplierId: SUPPLIER,
    });
  });
});

describe('the server’s check of a purchase', () => {
  const product = { voidedAt: null, purchaseUnits: ['kg', 'meter'] as const };

  it('accepts what the builder made and refuses anything else', () => {
    const aggregate = buy(rosa({ supplierId: SUPPLIER, paidCents: 5_000 }));
    expect(
      checkProductPurchase(aggregate, { ...product, purchaseUnits: [...product.purchaseUnits] }),
    ).toEqual([]);

    const dearer = structuredClone(aggregate);
    dearer.batches[0] = { ...(dearer.batches[0] as ProductBatch), costTotalCents: 1 };
    expect(
      checkProductPurchase(dearer, { ...product, purchaseUnits: [...product.purchaseUnits] }),
    ).not.toEqual([]);

    const mismatched = structuredClone(aggregate);
    mismatched.batches[0] = { ...(mismatched.batches[0] as ProductBatch), receivedQuantity: 1 };
    expect(
      checkProductPurchase(mismatched, { ...product, purchaseUnits: [...product.purchaseUnits] }),
    ).not.toEqual([]);

    const noSupplier = buy(rosa({ paidCents: 5_000 }));
    expect(
      checkProductPurchase(noSupplier, { ...product, purchaseUnits: [...product.purchaseUnits] }),
    ).toEqual([expect.objectContaining({ path: ['supplierId'] })]);
  });

  it('refuses a product that is unknown or voided, or not bought in that unit', () => {
    const aggregate = buy(rosa());
    expect(checkProductPurchase(aggregate, undefined)).toEqual([
      expect.objectContaining({ path: ['productId'] }),
    ]);
    expect(checkProductPurchase(aggregate, { voidedAt: NOW, purchaseUnits: ['kg'] })).toEqual([
      expect.objectContaining({ path: ['productId'] }),
    ]);
    expect(checkProductPurchase(aggregate, { voidedAt: null, purchaseUnits: ['meter'] })).toEqual([
      expect.objectContaining({ path: ['unit'] }),
    ]);
  });
});

describe('stock actions on a batch', () => {
  function stocked(input: NewProductPurchaseInput) {
    const aggregate = buy(input);
    const batch = aggregate.batches[0] as ProductBatch;
    const receipt = aggregate.moves[0] as ProductStockMove;
    return { batch, receipt };
  }
  const act = (
    input: Parameters<typeof newBatchActionSchema.parse>[0],
    batch: ProductBatch,
    moves: ProductStockMove[],
  ) => {
    const built = buildBatchMove(
      newBatchActionSchema.parse(input),
      batch,
      batchLedgerOf(batch, moves),
      {
        id: uuid(),
        deviceId: 'desk',
        now: NOW,
        actor: null,
      },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.move;
  };

  it('a loss costs its share (T12), counted in meters once the length is known', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      unit: 'meter',
      quantity: 5_000,
      totalCostCents: 80_000,
    });
    const loss = act(
      { type: 'loss', batchId: batch.id, date: DAY, quantity: 30, reason: 'stain' },
      batch,
      [receipt],
    );
    expect(loss).toMatchObject({ type: 'loss', unit: 'meter', delta: -30 });
    const ledger = batchLedgerOf(batch, [receipt, loss]);
    expect(ledger.costs).toEqual([{ moveId: loss.id, costCents: 480 }]);
    expect(availableIn(ledger, 'meter')).toBe(4_970);
  });

  it('a weight with no length is counted and lost in kilograms, never in invented meters', () => {
    const { batch, receipt } = stocked(rosa());
    const count = act(
      { type: 'adjustment', batchId: batch.id, date: DAY, counted: 99_500, reason: 'weighed' },
      batch,
      [receipt],
    );
    expect(count).toMatchObject({ type: 'adjustment', unit: 'kg', delta: -500 });
    expect(batchLedgerOf(batch, [receipt, count]).awaitingMeasurement).toEqual({
      unit: 'kg',
      grams: 99_500,
    });
  });

  it('a count that changes nothing is refused', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      unit: 'meter',
      quantity: 5_000,
      totalCostCents: 80_000,
    });
    const built = buildBatchMove(
      newBatchActionSchema.parse({
        type: 'adjustment',
        batchId: batch.id,
        date: DAY,
        counted: 5_000,
        reason: 'ok',
      }),
      batch,
      batchLedgerOf(batch, [receipt]),
      { id: uuid(), deviceId: 'desk', now: NOW, actor: null },
    );
    expect(built.ok).toBe(false);
  });

  it('a batch bought by the meter is re-measured as a correction of its length', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      unit: 'meter',
      quantity: 8_000,
      totalCostCents: 40_000,
    });
    const correction = act(
      { type: 'measure', batchId: batch.id, date: DAY, lengthCm: 7_600 },
      batch,
      [receipt],
    );
    expect(correction).toMatchObject({ type: 'length_correction', delta: -400 });
    expect(batchLedgerOf(batch, [receipt, correction]).costPerUnitCents.meter).toBe(526);
  });

  it('pieces cannot be measured', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      unit: 'piece',
      quantity: 12,
      totalCostCents: 6_000,
    });
    const built = buildBatchMove(
      newBatchActionSchema.parse({ type: 'measure', batchId: batch.id, date: DAY, lengthCm: 100 }),
      batch,
      batchLedgerOf(batch, [receipt]),
      { id: uuid(), deviceId: 'desk', now: NOW, actor: null },
    );
    expect(built.ok).toBe(false);
  });

  it('the whole length from a measurement of what is left adds what was sold (SPEC §2.3)', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      conversion: { weightG: 20_000, lengthCm: 8_000, source: 'estimated' },
      quantity: 20_000,
      totalCostCents: 40_000,
    });
    const sale: ProductStockMove = {
      ...receipt,
      id: uuid(),
      type: 'sale',
      unit: 'meter',
      delta: -1_000,
      refId: uuid(),
      createdAt: '2026-11-03T11:00:00.000Z',
    };
    const ledger = batchLedgerOf(batch, [receipt, sale]);
    // 70 m measured on the roll after 10 m were sold: it was 80 m, nothing to correct.
    expect(wholeLengthFrom(ledger, 7_000)).toBe(8_000);
    // 66 m left means it was 76 m long.
    expect(wholeLengthFrom(ledger, 6_600)).toBe(7_600);
  });

  it('the server accepts only these moves alone, for this batch, and only if the ledger can read them', () => {
    const { batch, receipt } = stocked({
      ...rosa(),
      unit: 'meter',
      quantity: 5_000,
      totalCostCents: 80_000,
    });
    const loss = act(
      { type: 'loss', batchId: batch.id, date: DAY, quantity: 30, reason: 'stain' },
      batch,
      [receipt],
    );
    expect(checkBatchMove(loss, batch, [receipt])).toEqual([]);
    expect(checkBatchMove({ ...loss, type: 'sale' }, batch, [receipt])).toEqual([
      expect.objectContaining({ path: ['type'] }),
    ]);
    expect(checkBatchMove({ ...loss, batchId: uuid() }, batch, [receipt])).toEqual([
      expect.objectContaining({ path: ['batchId'] }),
    ]);
    expect(checkBatchMove({ ...loss, note: null }, batch, [receipt])).toEqual([
      expect.objectContaining({ path: ['note'] }),
    ]);
    expect(checkBatchMove({ ...loss, unit: 'kg' }, batch, [receipt])).toEqual([
      expect.objectContaining({ path: ['delta'] }),
    ]);
    expect(
      checkBatchMove(
        { ...loss, type: 'measurement', unit: 'meter', delta: 100, note: null },
        batch,
        [receipt],
      ),
    ).toEqual([expect.objectContaining({ path: ['delta'] })]);
  });

  it('a batch’s own fields never change; only its remnant mark does', () => {
    const { batch } = stocked(rosa());
    expect(checkBatchUpdate(batch, { ...batch, status: 'remnant' })).toEqual([]);
    expect(checkBatchUpdate(batch, { ...batch, costTotalCents: 1 })).toEqual([
      expect.objectContaining({ path: ['costTotalCents'] }),
    ]);
    expect(checkBatchUpdate(batch, { ...batch, status: 'empty' })).not.toEqual([]);
  });
});

describe('removing a product from the inventory (PB20)', () => {
  const ledgerOf = (input: NewProductPurchaseInput) => {
    const { batches, moves } = buy(input);
    const [batch] = batches;
    if (!batch) throw new Error('no batch');
    return batchLedgerOf(batch, moves);
  };

  it('is refused while a batch still holds metres, with an issue on the product', () => {
    const issues = checkProductRemoval([
      ledgerOf(rosa({ unit: 'meter', quantity: 5_000, totalCostCents: 80_000 })),
    ]);
    expect(issues).toEqual([
      { path: ['productId'], message: 'product_holds_stock', code: 'custom' },
    ]);
  });

  it('is refused for a weight still waiting for its length', () => {
    expect(checkProductRemoval([ledgerOf(rosa())])).toHaveLength(1);
  });

  it('is allowed for a product with no batch yet', () => {
    expect(checkProductRemoval([])).toEqual([]);
  });
});
