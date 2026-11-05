import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  productHoldsStock,
  productStockBatchLedger,
  productStockLedger,
  productStockValue,
  proposeProductStockSale,
  type ProductStockBatch,
  type ProductStockMovement,
  type ProductStockQuantity,
} from './stock.js';

const batch = (
  id: string,
  received: ProductStockBatch['received'],
  costTotalCents: number,
  options: Partial<Pick<ProductStockBatch, 'purchaseDate' | 'initialConversion'>> = {},
): ProductStockBatch => ({
  id,
  productId: 'rosa',
  purchaseDate: options.purchaseDate ?? '2026-01-01',
  createdAt: `${options.purchaseDate ?? '2026-01-01'}T12:00:00.000Z`,
  purchaseUnit: received.unit,
  received,
  costTotalCents,
  initialConversion: options.initialConversion ?? null,
});

const purchase = (batchId: string, delta: ProductStockBatch['received']): ProductStockMovement => ({
  id: `${batchId}-purchase`,
  batchId,
  type: 'purchase',
  date: '2026-01-01',
  createdAt: '2026-01-01T12:00:00.000Z',
  delta,
});

const move = (
  batchId: string,
  id: string,
  type: 'sale' | 'loss' | 'length_correction' | 'return' | 'adjustment' | 'reversal',
  delta: ProductStockQuantity,
  extras: Record<string, string> = {},
): ProductStockMovement => {
  const base = { id, batchId, date: '2026-01-02', createdAt: '2026-01-02T12:00:00.000Z' };
  switch (type) {
    case 'sale':
    case 'loss':
    case 'length_correction':
    case 'adjustment':
      return { ...base, type, delta };
    case 'return':
      return { ...base, type, delta, returnsMoveId: extras.returnsMoveId ?? '' };
    case 'reversal':
      return { ...base, type, delta, reversesMoveId: extras.reversesMoveId ?? '' };
  }
};

const frozenSale = (
  batchId: string,
  id: string,
  centimeters: number,
  lockedCostCents: number,
): ProductStockMovement => ({
  id,
  batchId,
  type: 'sale',
  date: '2026-01-02',
  createdAt: '2026-01-02T12:00:00.000Z',
  delta: { unit: 'meter', centimeters },
  lockedCostCents,
});

describe('Product purchase-batch stock ledger', () => {
  it('converts a known kg purchase to saleable meters and derives cost per meter', () => {
    const item = batch('known', { unit: 'kg', grams: 100_000 }, 20_000, {
      initialConversion: { weightG: 50_000, lengthCm: 10_000, source: 'measured' },
    });
    const ledger = productStockBatchLedger(item, [purchase('known', item.received)]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'kg', grams: 100_000 },
      available: {
        kg: { unit: 'kg', grams: 100_000 },
        meter: { unit: 'meter', centimeters: 20_000 },
      },
      costTotalCents: 20_000,
      costPerUnitCents: { kg: 200, meter: 100 },
      measurementStatus: 'measured',
    });
  });

  it('keeps unknown kg stock visible as pending without inventing saleable length', () => {
    const item = batch('pending', { unit: 'kg', grams: 100_000 }, 20_000);
    const ledger = productStockBatchLedger(item, [purchase('pending', item.received)]);

    expect(ledger).toMatchObject({
      available: {
        kg: { unit: 'kg', grams: 100_000 },
        meter: { unit: 'meter', centimeters: 0 },
      },
      awaitingMeasurement: { unit: 'kg', grams: 100_000 },
      measurementStatus: 'pending',
      costTotalCents: 20_000,
    });
    expect(ledger.costPerUnitCents.meter).toBeUndefined();
  });

  it('measures a pending batch without changing its original purchase or conversion data', () => {
    const item = batch('measured-later', { unit: 'kg', grams: 100_000 }, 20_000);
    const moves: ProductStockMovement[] = [
      purchase(item.id, item.received),
      {
        id: 'measurement-1',
        batchId: item.id,
        type: 'measurement',
        date: '2026-01-03',
        createdAt: '2026-01-03T10:00:00.000Z',
        measuredLengthCm: 19_000,
        measuredBy: 'owner-1',
        measuredAt: '2026-01-03T10:00:00.000Z',
      },
    ];
    const ledger = productStockBatchLedger(item, moves);

    expect(ledger).toMatchObject({
      available: { meter: { unit: 'meter', centimeters: 19_000 } },
      costPerUnitCents: { meter: 105 },
      measurementStatus: 'measured',
      conversion: { weightG: 100_000, lengthCm: 19_000, source: 'measured' },
    });
    expect(item).toMatchObject({
      received: { unit: 'kg', grams: 100_000 },
      initialConversion: null,
    });
    expect(moves[1]).toMatchObject({
      measuredBy: 'owner-1',
      measuredAt: '2026-01-03T10:00:00.000Z',
    });
  });

  it('applies a later measurement to earlier kg sales and keeps the remaining measured length', () => {
    const item = batch('partial-measure', { unit: 'kg', grams: 100_000 }, 20_000, {
      initialConversion: { weightG: 50_000, lengthCm: 10_000, source: 'estimated' },
    });
    const moves: ProductStockMovement[] = [
      purchase(item.id, item.received),
      move(item.id, 'sold-kg', 'sale', { unit: 'kg', grams: -25_000 }),
      {
        id: 'measurement-2',
        batchId: item.id,
        type: 'measurement',
        date: '2026-01-03',
        createdAt: '2026-01-03T10:00:00.000Z',
        measuredLengthCm: 19_000,
        measuredBy: 'owner-1',
        measuredAt: '2026-01-03T10:00:00.000Z',
      },
    ];
    const ledger = productStockBatchLedger(item, moves);

    expect(ledger).toMatchObject({
      remaining: { unit: 'kg', grams: 75_000 },
      available: { meter: { unit: 'meter', centimeters: 14_250 } },
      costs: [{ moveId: 'sold-kg', costCents: 5_000 }],
    });
  });

  it('consumes sales FIFO across batches while retaining separate cost bases', () => {
    const first = batch('first', { unit: 'meter', centimeters: 5_000 }, 5_000);
    const second = batch('second', { unit: 'meter', centimeters: 10_000 }, 20_000, {
      purchaseDate: '2026-02-01',
    });
    const proposal = proposeProductStockSale(
      [second, first],
      [purchase(first.id, first.received), purchase(second.id, second.received)],
      { unit: 'meter', centimeters: 6_000 },
      ['meter'],
    );

    expect(proposal).toEqual({
      takes: [
        { batchId: 'first', quantity: { unit: 'meter', centimeters: 5_000 } },
        { batchId: 'second', quantity: { unit: 'meter', centimeters: 1_000 } },
      ],
      shortfall: { unit: 'meter', centimeters: 0 },
    });
  });

  it('costs partial sales, restores proportional cost on return, and keeps the cost basis per batch', () => {
    const item = batch('returned', { unit: 'meter', centimeters: 20_000 }, 20_000);
    const moves: ProductStockMovement[] = [
      purchase(item.id, item.received),
      move(item.id, 'sale-1', 'sale', { unit: 'meter', centimeters: -10_000 }),
      move(
        item.id,
        'return-1',
        'return',
        { unit: 'meter', centimeters: 2_000 },
        { returnsMoveId: 'sale-1' },
      ),
    ];
    const ledger = productStockBatchLedger(item, moves);

    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: 12_000 },
      costs: [{ moveId: 'sale-1', costCents: 10_000 }],
      returns: [{ moveId: 'return-1', saleMoveId: 'sale-1', costCents: 2_000 }],
      unallocatedCostCents: 12_000,
    });
  });

  it('applies quantity-only adjustments without changing the original cost basis', () => {
    const item = batch('adjustment', { unit: 'meter', centimeters: 10_000 }, 8_000);
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'count', 'adjustment', { unit: 'meter', centimeters: -1_000 }),
      move(item.id, 'last-sale', 'sale', { unit: 'meter', centimeters: -9_000 }),
    ]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: 0 },
      costs: [{ moveId: 'last-sale', costCents: 8_000 }],
      unallocatedCostCents: 0,
    });
  });

  it('keeps piece stock count-only and reverses a voided sale', () => {
    const item = batch('pieces', { unit: 'piece', pieces: 12 }, 12_000);
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'sale', 'sale', { unit: 'piece', pieces: -2 }),
      move(
        item.id,
        'sale-reversal',
        'reversal',
        { unit: 'piece', pieces: 2 },
        { reversesMoveId: 'sale' },
      ),
    ]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'piece', pieces: 12 },
      available: { piece: { unit: 'piece', pieces: 12 } },
      costs: [],
      unallocatedCostCents: 12_000,
      conversion: null,
    });
    expect(ledger.available.kg).toBeUndefined();
    expect(ledger.available.meter).toBeUndefined();
  });

  it('uses legacy meter length corrections to update the cost basis, not the receipt', () => {
    const item = batch('corrected', { unit: 'meter', centimeters: 8_000 }, 40_000);
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'sold-before-measurement', 'sale', {
        unit: 'meter',
        centimeters: -1_000,
      }),
      move(item.id, 'length-correction', 'length_correction', {
        unit: 'meter',
        centimeters: -400,
      }),
    ]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: 6_600 },
      costs: [{ moveId: 'sold-before-measurement', costCents: 5_263 }],
      costPerUnitCents: { meter: 526 },
      conversion: null,
    });
    expect(item.received).toEqual({ unit: 'meter', centimeters: 8_000 });
  });

  it('costs a sale as if a later, longer measurement had always been known (SPEC §2.4)', () => {
    const item = batch('measured-longer', { unit: 'meter', centimeters: 8_000 }, 40_000);
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'sold-all', 'sale', { unit: 'meter', centimeters: -8_000 }),
      move(item.id, 'longer', 'length_correction', { unit: 'meter', centimeters: 500 }),
    ]);

    // 8,000 of 8,500 cm: the sale did not empty the batch, so it takes its share, not all.
    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: 500 },
      costs: [{ moveId: 'sold-all', costCents: 37_647 }],
      unallocatedCostCents: 2_353,
      oversold: { unit: 'meter', centimeters: 0 },
    });
  });

  it('gives the cost a count left on the batch to the next sale, so none is stranded', () => {
    const item = batch('counted-out', { unit: 'meter', centimeters: 1_000 }, 10_000);
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'count', 'adjustment', { unit: 'meter', centimeters: -1_000 }),
      move(item.id, 'late-sale', 'sale', { unit: 'meter', centimeters: -100 }),
    ]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: -100 },
      costs: [{ moveId: 'late-sale', costCents: 10_000 }],
      unallocatedCostCents: 0,
      oversold: { unit: 'meter', centimeters: 100 },
    });
  });

  it('keeps the cost a settlement froze, and counts it towards what is left on the batch', () => {
    const item = batch('frozen', { unit: 'kg', grams: 20_000 }, 40_000, {
      initialConversion: { weightG: 20_000, lengthCm: 8_000, source: 'estimated' },
    });
    const history = [
      purchase(item.id, item.received),
      frozenSale(item.id, 'locked-sale', -1_000, 5_000),
      move(item.id, 'later-sale', 'sale', { unit: 'meter', centimeters: -1_000 }),
      {
        id: 'measured',
        batchId: item.id,
        type: 'measurement' as const,
        date: '2026-01-03',
        createdAt: '2026-01-03T10:00:00.000Z',
        measuredLengthCm: 7_600,
        measuredBy: 'owner',
        measuredAt: '2026-01-03T10:00:00.000Z',
      },
    ];
    const ledger = productStockBatchLedger(item, history);

    // Without the frozen cost the first line would now cost 5,263; with it, 5,000 stays.
    expect(ledger.costs).toEqual([
      { moveId: 'locked-sale', costCents: 5_000 },
      { moveId: 'later-sale', costCents: 5_263 },
    ]);
    expect(ledger.unallocatedCostCents).toBe(40_000 - 5_000 - 5_263);
    expect(ledger.lengthBasisCm).toBe(7_600);
    expect(() =>
      productStockBatchLedger(item, [
        purchase(item.id, item.received),
        frozenSale(item.id, 'too-much', -100, 40_001),
      ]),
    ).toThrow('allocated costs exceed the batch cost');
  });

  it('knows the length its cost is spread over, and none for weight awaiting a length or pieces', () => {
    const meters = batch('meters', { unit: 'meter', centimeters: 5_000 }, 1_000);
    const corrected = productStockBatchLedger(meters, [
      purchase(meters.id, meters.received),
      move(meters.id, 'fix', 'length_correction', { unit: 'meter', centimeters: -200 }),
    ]);
    expect(corrected.lengthBasisCm).toBe(4_800);
    const waiting = batch('waiting', { unit: 'kg', grams: 10_000 }, 1_000);
    expect(
      productStockBatchLedger(waiting, [purchase(waiting.id, waiting.received)]).lengthBasisCm,
    ).toBeNull();
    const pieces = batch('pieces', { unit: 'piece', pieces: 3 }, 300);
    expect(
      productStockBatchLedger(pieces, [purchase(pieces.id, pieces.received)]).lengthBasisCm,
    ).toBeNull();
  });

  it('converts adjustments into the batch unit without changing its cost basis', () => {
    const item = batch('converted-adjustment', { unit: 'kg', grams: 100_000 }, 20_000, {
      initialConversion: { weightG: 50_000, lengthCm: 10_000, source: 'measured' },
    });
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'meter-count', 'adjustment', {
        unit: 'meter',
        centimeters: -100,
      }),
    ]);

    expect(ledger).toMatchObject({
      remaining: { unit: 'kg', grams: 99_500 },
      available: {
        meter: { unit: 'meter', centimeters: 19_900 },
      },
      unallocatedCostCents: 20_000,
      costPerUnitCents: { meter: 100 },
    });
  });

  it('reports an offline oversale and returns a shortfall instead of rejecting the sale proposal', () => {
    const item = batch('short', { unit: 'meter', centimeters: 2_000 }, 2_000);
    const history = [
      purchase(item.id, item.received),
      move(item.id, 'offline-sale', 'sale', { unit: 'meter', centimeters: -2_500 }),
    ];
    const ledger = productStockBatchLedger(item, history);
    const proposal = proposeProductStockSale(
      [item],
      [purchase(item.id, item.received)],
      { unit: 'meter', centimeters: 2_500 },
      ['meter'],
    );

    expect(ledger).toMatchObject({
      remaining: { unit: 'meter', centimeters: -500 },
      oversold: { unit: 'meter', centimeters: 500 },
      unallocatedCostCents: 0,
    });
    expect(proposal.shortfall).toEqual({ unit: 'meter', centimeters: 500 });
  });

  it('refuses a movement on a batch the proposal was not given, and batches of two products', () => {
    const rosa = batch('rosa-1', { unit: 'meter', centimeters: 5_000 }, 80_000);
    const satin = {
      ...batch('satin-1', { unit: 'meter', centimeters: 3_000 }, 90_000),
      productId: 'other',
    };
    const wanted = { unit: 'meter' as const, centimeters: 100 };
    // A movement of another product's batch is not this product's to read: it is refused, never skipped.
    expect(() =>
      proposeProductStockSale(
        [rosa],
        [
          purchase(rosa.id, rosa.received),
          move(satin.id, 'cart-satin-1', 'sale', { unit: 'meter', centimeters: -50 }),
        ],
        wanted,
        ['meter'],
      ),
    ).toThrow('stock movement cart-satin-1 references an unknown batch');
    expect(() => proposeProductStockSale([rosa, satin], [], wanted, ['meter'])).toThrow(
      'a sale proposal cannot mix product ids',
    );
  });

  it('uses exact rational conversions and assigns the final cost remainder on exhaustion', () => {
    const item = batch('precision', { unit: 'kg', grams: 1_000 }, 10, {
      initialConversion: { weightG: 1_000, lengthCm: 300, source: 'measured' },
    });
    const ledger = productStockBatchLedger(item, [
      purchase(item.id, item.received),
      move(item.id, 'sale-a', 'sale', { unit: 'meter', centimeters: -100 }),
      move(item.id, 'sale-b', 'sale', { unit: 'meter', centimeters: -200 }),
    ]);

    expect(ledger.costs).toEqual([
      { moveId: 'sale-a', costCents: 3 },
      { moveId: 'sale-b', costCents: 7 },
    ]);
    expect(ledger).toMatchObject({
      remaining: { unit: 'kg', grams: 0 },
      available: { meter: { unit: 'meter', centimeters: 0 } },
      unallocatedCostCents: 0,
    });
  });

  it('does not propose selling a rounded-up fraction of a base unit', () => {
    const item = batch('fractional', { unit: 'kg', grams: 2 }, 1, {
      initialConversion: { weightG: 3, lengthCm: 1, source: 'measured' },
    });
    const proposal = proposeProductStockSale(
      [item],
      [purchase(item.id, item.received)],
      { unit: 'meter', centimeters: 1 },
      ['meter'],
    );

    expect(
      productStockBatchLedger(item, [purchase(item.id, item.received)]).available.meter,
    ).toEqual({
      unit: 'meter',
      centimeters: 1,
    });
    expect(proposal).toEqual({
      takes: [],
      shortfall: { unit: 'meter', centimeters: 1 },
    });
    expect(() =>
      proposeProductStockSale(
        [item],
        [purchase(item.id, item.received)],
        { unit: 'meter', centimeters: 1 },
        ['kg'],
      ),
    ).toThrow('not configured to sell in meter');
  });

  it('aggregates only compatible units and keeps pending measurements separate', () => {
    const known = batch('known', { unit: 'kg', grams: 50_000 }, 10_000, {
      initialConversion: { weightG: 50_000, lengthCm: 10_000, source: 'measured' },
    });
    const pending = batch('pending', { unit: 'kg', grams: 50_000 }, 10_000);
    const ledger = productStockLedger(
      [known, pending],
      [purchase(known.id, known.received), purchase(pending.id, pending.received)],
    );

    expect(ledger).toMatchObject({
      available: {
        kg: { unit: 'kg', grams: 100_000 },
        meter: { unit: 'meter', centimeters: 10_000 },
      },
      awaitingMeasurement: [{ batchId: 'pending', quantity: { unit: 'kg', grams: 50_000 } }],
      awaitingMeasurementTotal: { unit: 'kg', grams: 50_000 },
    });

    const second = batch('second-pending', { unit: 'kg', grams: 20_000 }, 4_000);
    const waiting = productStockLedger(
      [pending, second, known],
      [
        purchase(pending.id, pending.received),
        purchase(second.id, second.received),
        purchase(known.id, known.received),
      ],
    );
    expect(waiting.awaitingMeasurementTotal).toEqual({ unit: 'kg', grams: 70_000 });
    expect(
      productStockLedger([known], [purchase(known.id, known.received)]).awaitingMeasurementTotal,
    ).toBeNull();
  });

  it('rejects invalid cross-unit moves, excess returns, and untraceable measurements', () => {
    const pending = batch('invalid', { unit: 'kg', grams: 10_000 }, 1_000);
    expect(() =>
      productStockBatchLedger(pending, [
        purchase(pending.id, pending.received),
        move(pending.id, 'bad-sale', 'sale', { unit: 'meter', centimeters: -100 }),
      ]),
    ).toThrow('cross-unit movement requires a batch conversion');

    const measured = batch('return-overflow', { unit: 'meter', centimeters: 100 }, 100);
    expect(() =>
      productStockBatchLedger(measured, [
        purchase(measured.id, measured.received),
        move(measured.id, 'sale', 'sale', { unit: 'meter', centimeters: -50 }),
        move(
          measured.id,
          'return-too-much',
          'return',
          { unit: 'meter', centimeters: 51 },
          { returnsMoveId: 'sale' },
        ),
      ]),
    ).toThrow('exceeds the sale quantity');

    expect(() =>
      productStockBatchLedger(pending, [
        purchase(pending.id, pending.received),
        {
          id: 'missing-actor',
          batchId: pending.id,
          type: 'measurement',
          date: '2026-01-03',
          createdAt: '2026-01-03T10:00:00.000Z',
          measuredLengthCm: 200,
          measuredBy: ' ',
          measuredAt: '2026-01-03T10:00:00.000Z',
        },
      ]),
    ).toThrow('measurement performer is required');
  });
});

describe('Product stock value and weighted average cost (PB18)', () => {
  const ledgerOf = (item: ProductStockBatch, extra: ProductStockMovement[] = []) =>
    productStockBatchLedger(item, [purchase(item.id, item.received), ...extra]);

  it('values what is left at the batch cost, after a sale took its share', () => {
    const item = batch('a', { unit: 'meter', centimeters: 10_000 }, 20_000);
    const sold = move('a', 'sale-a', 'sale', { unit: 'meter', centimeters: -4_000 });
    expect(productStockValue([ledgerOf(item, [sold])])).toEqual({
      valueCents: 12_000,
      averageCostPerMeterCents: 200,
      averageCostPerPieceCents: null,
    });
  });

  it('averages batches bought at different costs by what is left of each, not by batch count', () => {
    const cheap = batch('cheap', { unit: 'meter', centimeters: 3_000 }, 3_000); // 1.00 per metre
    const dear = batch('dear', { unit: 'meter', centimeters: 1_000 }, 3_000); // 3.00 per metre
    const result = productStockValue([ledgerOf(cheap), ledgerOf(dear)]);
    expect(result.valueCents).toBe(6_000);
    // 6000 cents over 40 m = 150 per metre; a plain mean of the two batches' 100 and 300 would say 200.
    expect(result.averageCostPerMeterCents).toBe(150);
  });

  it('weights by the metres left: a sale from the cheap batch moves the average up', () => {
    const cheap = batch('cheap', { unit: 'meter', centimeters: 3_000 }, 3_000);
    const dear = batch('dear', { unit: 'meter', centimeters: 1_000 }, 3_000);
    const sold = move('cheap', 'sale-c', 'sale', { unit: 'meter', centimeters: -2_000 });
    const result = productStockValue([ledgerOf(cheap, [sold]), ledgerOf(dear)]);
    // 1,000 cents of the cheap batch + 3,000 of the dear one, over 10 m + 10 m.
    expect(result).toMatchObject({ valueCents: 4_000, averageCostPerMeterCents: 200 });
  });

  it('counts weight awaiting a length in the value but never gives it a cost per metre', () => {
    const measured = batch('m', { unit: 'meter', centimeters: 1_000 }, 1_000);
    const waiting = batch('w', { unit: 'kg', grams: 5_000 }, 9_000);
    expect(productStockValue([ledgerOf(measured), ledgerOf(waiting)])).toEqual({
      valueCents: 10_000,
      averageCostPerMeterCents: 100,
      averageCostPerPieceCents: null,
    });
    expect(productStockValue([ledgerOf(waiting)])).toEqual({
      valueCents: 9_000,
      averageCostPerMeterCents: null,
      averageCostPerPieceCents: null,
    });
  });

  it('uses the measured length of a weight batch for its share of the average', () => {
    const kg = batch('k', { unit: 'kg', grams: 100_000 }, 20_000, {
      initialConversion: { weightG: 50_000, lengthCm: 10_000, source: 'measured' },
    });
    expect(productStockValue([ledgerOf(kg)])).toMatchObject({
      valueCents: 20_000,
      averageCostPerMeterCents: 100,
    });
  });

  it('averages pieces apart from metres', () => {
    const pieces = batch('p', { unit: 'piece', pieces: 4 }, 10_000);
    const metres = batch('m', { unit: 'meter', centimeters: 1_000 }, 1_000);
    expect(productStockValue([ledgerOf(pieces), ledgerOf(metres)])).toEqual({
      valueCents: 11_000,
      averageCostPerMeterCents: 100,
      averageCostPerPieceCents: 2_500,
    });
  });

  it('rounds the average half up, once, at the end', () => {
    // 1 cent over 2 m = 0.5 cent per metre: rounds up to 1.
    expect(
      productStockValue([ledgerOf(batch('h', { unit: 'meter', centimeters: 200 }, 1))])
        .averageCostPerMeterCents,
    ).toBe(1);
    // 100 cents over 3 m = 33.33...: rounds down.
    expect(
      productStockValue([ledgerOf(batch('t', { unit: 'meter', centimeters: 300 }, 100))])
        .averageCostPerMeterCents,
    ).toBe(33);
  });

  it('has no average and no value when nothing is held', () => {
    expect(productStockValue([])).toEqual({
      valueCents: 0,
      averageCostPerMeterCents: null,
      averageCostPerPieceCents: null,
    });
    const spent = batch('s', { unit: 'meter', centimeters: 500 }, 5_000);
    const all = move('s', 'sale-s', 'sale', { unit: 'meter', centimeters: -500 });
    expect(productStockValue([ledgerOf(spent, [all])])).toEqual({
      valueCents: 0,
      averageCostPerMeterCents: null,
      averageCostPerPieceCents: null,
    });
  });

  it('is not misled by an oversold batch: it holds nothing and carries no cost', () => {
    const item = batch('o', { unit: 'meter', centimeters: 500 }, 5_000);
    const more = move('o', 'sale-o', 'sale', { unit: 'meter', centimeters: -800 });
    expect(productStockValue([ledgerOf(item, [more])])).toEqual({
      valueCents: 0,
      averageCostPerMeterCents: null,
      averageCostPerPieceCents: null,
    });
  });

  it('values stock as the sum of its batches, and the average is within half a cent of exact', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            centimeters: fc.integer({ min: 1, max: 100_000 }),
            costCents: fc.integer({ min: 0, max: 5_000_000 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (rows) => {
          const ledgers = rows.map((row, index) =>
            ledgerOf(
              batch(
                `b${String(index)}`,
                { unit: 'meter', centimeters: row.centimeters },
                row.costCents,
              ),
            ),
          );
          const cost = rows.reduce((sum, row) => sum + row.costCents, 0);
          const cm = rows.reduce((sum, row) => sum + row.centimeters, 0);
          const result = productStockValue(ledgers);
          expect(result.valueCents).toBe(cost);
          // |average − exact| ≤ ½ cent, checked without floats: |2·avg·cm − 200·cost| ≤ cm.
          const average = BigInt(result.averageCostPerMeterCents ?? -1);
          const drift = 2n * average * BigInt(cm) - 200n * BigInt(cost);
          expect(drift <= BigInt(cm) && -drift <= BigInt(cm)).toBe(true);
        },
      ),
    );
  });
});

describe('Whether a product still holds stock (PB20)', () => {
  const ledgerOf = (item: ProductStockBatch, extra: ProductStockMovement[] = []) =>
    productStockBatchLedger(item, [purchase(item.id, item.received), ...extra]);

  it('holds stock while a batch has metres, pieces or cost left', () => {
    expect(
      productHoldsStock([ledgerOf(batch('a', { unit: 'meter', centimeters: 500 }, 5_000))]),
    ).toBe(true);
    expect(productHoldsStock([ledgerOf(batch('p', { unit: 'piece', pieces: 2 }, 400))])).toBe(true);
    const part = batch('b', { unit: 'meter', centimeters: 1_000 }, 5_000);
    const sold = move('b', 'sale-b', 'sale', { unit: 'meter', centimeters: -400 });
    expect(productHoldsStock([ledgerOf(part, [sold])])).toBe(true);
  });

  it('holds stock while a weight waits for its length, which no sale can use yet', () => {
    expect(productHoldsStock([ledgerOf(batch('w', { unit: 'kg', grams: 5_000 }, 9_000))])).toBe(
      true,
    );
  });

  it('holds stock if any one of its batches does', () => {
    const spent = batch('s', { unit: 'meter', centimeters: 500 }, 5_000);
    const all = move('s', 'sale-s', 'sale', { unit: 'meter', centimeters: -500 });
    const left = batch('l', { unit: 'meter', centimeters: 100 }, 1_000);
    expect(productHoldsStock([ledgerOf(spent, [all]), ledgerOf(left)])).toBe(true);
  });

  it('holds none once everything was sold, lost or sold and given back out again', () => {
    const spent = batch('s', { unit: 'meter', centimeters: 500 }, 5_000);
    const all = move('s', 'sale-s', 'sale', { unit: 'meter', centimeters: -500 });
    expect(productHoldsStock([ledgerOf(spent, [all])])).toBe(false);
    const lost = batch('x', { unit: 'meter', centimeters: 300 }, 3_000);
    const gone = move('x', 'loss-x', 'loss', { unit: 'meter', centimeters: -300 });
    expect(productHoldsStock([ledgerOf(lost, [gone])])).toBe(false);
  });

  it('holds none with no batch at all, and when oversold (nothing left to value)', () => {
    expect(productHoldsStock([])).toBe(false);
    const item = batch('o', { unit: 'meter', centimeters: 500 }, 5_000);
    const more = move('o', 'sale-o', 'sale', { unit: 'meter', centimeters: -800 });
    expect(productHoldsStock([ledgerOf(item, [more])])).toBe(false);
  });

  it('agrees with the stock value: it holds stock exactly when there is a value or a quantity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (received, cost, sold) => {
          const item = batch('f', { unit: 'meter', centimeters: received }, cost);
          const moves =
            sold === 0 ? [] : [move('f', 'sale-f', 'sale', { unit: 'meter', centimeters: -sold })];
          const ledger = ledgerOf(item, moves);
          const left = Math.max(0, received - sold);
          expect(productHoldsStock([ledger])).toBe(left > 0 || ledger.unallocatedCostCents > 0);
          if (left > 0) expect(productHoldsStock([ledger])).toBe(true);
        },
      ),
    );
  });
});
