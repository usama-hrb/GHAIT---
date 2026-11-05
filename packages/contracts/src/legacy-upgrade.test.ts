import { describe, expect, it } from 'vitest';
import {
  batchLedgerOf,
  coreBatchOf,
  coreMovesOf,
  legacyMoveAsBatchMove,
  legacyOpPayload,
  legacyRollAsBatch,
  legacyRollAsProductBatch,
  legacySaleLineAsBatchLine,
  type Purchase,
  type Roll,
  rollLedgerOf,
  type StockMove,
} from './index.js';

const base = (n: number) => ({
  createdAt: `2026-10-0${String(n)}T09:00:00.000Z`,
  updatedAt: `2026-10-0${String(n)}T09:00:00.000Z`,
  deviceId: 'desk',
  voidedAt: null,
});

function rollOf(
  lengthCm: number,
  costTotalCents: number,
  options: { weightG?: number; estimated?: boolean } = {},
) {
  const purchaseId = crypto.randomUUID();
  const purchase: Purchase = {
    ...base(1),
    id: purchaseId,
    supplierId: null,
    date: '2026-10-01',
    method: options.weightG ? 'kg' : 'meter',
    pricePerMeterCents: null,
    weightG: options.weightG ?? null,
    estCmPerKg: null,
    totalCostCents: costTotalCents,
    paidCents: costTotalCents,
    notes: null,
  };
  const roll: Roll = {
    ...base(1),
    id: crypto.randomUUID(),
    shortCode: 'R-A0001',
    variantId: crypto.randomUUID(),
    purchaseId,
    lengthCmInitial: lengthCm,
    costTotalCents,
    lengthEstimated: options.estimated ?? false,
    status: 'active',
  };
  let seq = 0;
  const moves: (StockMove & { serverSeq: number | null })[] = [];
  const move = (type: StockMove['type'], deltaCm: number, refId: string | null = null) => {
    seq += 1;
    const entry = {
      ...base(Math.min(seq, 9)),
      id: crypto.randomUUID(),
      rollId: roll.id,
      type,
      deltaCm,
      refId,
      date: '2026-10-02',
      note: type === 'loss' || type === 'adjustment' ? 'reason' : null,
      serverSeq: seq,
    };
    moves.push(entry);
    return entry.id;
  };
  move('purchase', lengthCm, purchaseId);
  return { roll, purchase, moves, move };
}

/** The roll ledger and the batch ledger of the same history say the same (what migration 0029 holds too). */
function expectSameBooks(h: ReturnType<typeof rollOf>) {
  const { batch, moves, serverSeqOf } = legacyRollAsBatch(h.roll, h.purchase, h.moves);
  const legacy = rollLedgerOf(h.roll, h.moves);
  const ledger = batchLedgerOf(
    batch,
    moves.map((move) => ({ ...move, serverSeq: serverSeqOf.get(move.id) ?? null })),
  );
  const meters = ledger.available.meter;
  expect(meters?.unit === 'meter' ? meters.centimeters : undefined).toBe(legacy.remainingCm);
  expect(ledger.unallocatedCostCents).toBe(legacy.unallocatedCostCents);
  expect(ledger.measurementStatus === 'estimated').toBe(legacy.lengthEstimated);
  // And it is the mapping the product screens were always tested against.
  const bridge = legacyRollAsProductBatch(h.roll, h.purchase, h.moves);
  expect(JSON.parse(JSON.stringify(coreBatchOf(batch)))).toEqual(
    JSON.parse(JSON.stringify(bridge.batch)),
  );
  expect(JSON.parse(JSON.stringify(coreMovesOf(moves)))).toEqual(
    JSON.parse(JSON.stringify(bridge.movements)),
  );
  return { batch, moves, serverSeqOf };
}

describe('a roll carried over to a batch on the device (ADR 0012)', () => {
  it('a roll bought by the meter: a meter batch with its sales, loss, return and count', () => {
    const h = rollOf(5000, 80_000);
    const sale = h.move('sale', -275, crypto.randomUUID());
    h.move('loss', -30);
    h.move('return', 75, sale);
    h.move('adjustment', -20);
    const { batch, moves } = expectSameBooks(h);
    expect(batch).toMatchObject({
      id: h.roll.id,
      code: 'R-A0001',
      productId: h.roll.variantId,
      unit: 'meter',
      receivedQuantity: 5000,
      conversion: null,
      status: 'active',
    });
    expect(moves.map((move) => [move.id, move.type, move.unit, move.delta])).toEqual(
      h.moves.map((move) => [move.id, move.type, 'meter', move.deltaCm]),
    );
  });

  it('a roll bought by weight: a kg batch converting at its length; corrections become measurements', () => {
    const h = rollOf(8000, 40_000, { weightG: 20_000, estimated: true });
    h.move('sale', -1000, crypto.randomUUID());
    h.move('length_correction', -400);
    h.move('sale', -500, crypto.randomUUID());
    h.move('length_correction', 150);
    const { batch, moves } = expectSameBooks(h);
    expect(batch).toMatchObject({
      unit: 'kg',
      receivedQuantity: 20_000,
      conversion: { weightG: 20_000, lengthCm: 8000, source: 'estimated' },
    });
    expect(moves.map((move) => [move.type, move.unit, move.delta])).toEqual([
      ['purchase', 'kg', 20_000],
      ['sale', 'meter', -1000],
      ['measurement', 'meter', 7600],
      ['sale', 'meter', -500],
      ['measurement', 'meter', 7750],
    ]);
  });

  it('a measured roll, a voided sale, an oversold roll, and a roll with no purchase move', () => {
    const measured = rollOf(1000, 9000, { weightG: 5000 });
    const voided = measured.move('sale', -300, crypto.randomUUID());
    measured.move('reversal', 300, voided);
    measured.move('sale', -1200, crypto.randomUUID());
    expectSameBooks(measured);

    const noReceipt = rollOf(400, 500);
    noReceipt.moves.length = 0;
    const { moves, serverSeqOf } = expectSameBooks(noReceipt);
    expect(moves).toMatchObject([{ type: 'purchase', unit: 'meter', delta: 400 }]);
    expect(serverSeqOf.get(moves[0]?.id ?? '')).toBeNull();

    const noPurchase = legacyRollAsBatch(noReceipt.roll, undefined, []);
    expect(noPurchase.batch).toMatchObject({ unit: 'meter', purchaseDate: '2026-10-01' });
  });

  it('keeps each move’s place in the server’s order, and the ids that sales point at', () => {
    const h = rollOf(5000, 80_000);
    h.move('sale', -100, crypto.randomUUID());
    const { moves, serverSeqOf } = legacyRollAsBatch(h.roll, h.purchase, h.moves);
    expect(moves.map((move) => serverSeqOf.get(move.id))).toEqual([1, 2]);
    expect(moves.map((move) => move.id)).toEqual(h.moves.map((move) => move.id));
  });
});

describe('records written by a device that had not upgraded (ADR 0012)', () => {
  const rollId = crypto.randomUUID();

  it('a sale line gets its batch, unit, quantity and prices', () => {
    const line = {
      id: 'l',
      saleId: 's',
      rollId,
      soldCm: 100,
      refPricePerMeterCents: 2000,
      minPricePerMeterCents: 1700,
      actualPricePerMeterCents: 1800,
      wholePiece: false,
      lineTotalCents: 1800,
    };
    expect(legacySaleLineAsBatchLine(line)).toEqual({
      id: 'l',
      saleId: 's',
      batchId: rollId,
      unit: 'meter',
      quantity: 100,
      refPriceCents: 2000,
      minPriceCents: 1700,
      actualPriceCents: 1800,
      minOverrideBy: null,
      wholePiece: false,
      lineTotalCents: 1800,
    });
    const upgraded = legacySaleLineAsBatchLine(line);
    expect(legacySaleLineAsBatchLine(upgraded)).toEqual(upgraded);
  });

  it('a move inside a sale, void or return op is a meter move of the batch', () => {
    expect(
      legacyMoveAsBatchMove({ id: 'm', rollId, type: 'sale', deltaCm: -100, refId: 'l' }),
    ).toEqual({
      id: 'm',
      batchId: rollId,
      type: 'sale',
      unit: 'meter',
      delta: -100,
      refId: 'l',
      actor: null,
    });
  });

  it('rewrites the payload of each kind of pending op, and leaves the others', () => {
    const none = () => undefined;
    const sale = legacyOpPayload(
      'sale',
      {
        sale: { id: 's' },
        lines: [
          {
            id: 'l',
            rollId,
            soldCm: 100,
            refPricePerMeterCents: 1,
            minPricePerMeterCents: 1,
            actualPricePerMeterCents: 1,
          },
        ],
        moves: [{ id: 'm', rollId, type: 'sale', deltaCm: -100 }],
      },
      none,
    );
    expect(sale).toMatchObject({
      lines: [{ batchId: rollId, quantity: 100, unit: 'meter' }],
      moves: [{ batchId: rollId, delta: -100, unit: 'meter' }],
    });
    expect(
      legacyOpPayload('sale_void', { saleVoid: {}, reversals: [{ rollId, deltaCm: 100 }] }, none),
    ).toMatchObject({ reversals: [{ batchId: rollId, delta: 100 }] });
    expect(
      legacyOpPayload(
        'sale_return',
        {
          saleReturn: { lines: [{ lineId: 'l', moveId: 'm', returnedCm: 40 }] },
          moves: [{ rollId, type: 'return', deltaCm: 40 }],
        },
        none,
      ),
    ).toMatchObject({
      saleReturn: { lines: [{ lineId: 'l', moveId: 'm', quantity: 40 }] },
      moves: [{ batchId: rollId, delta: 40 }],
    });
    expect(legacyOpPayload('customer', { id: 'c' }, none)).toEqual({ id: 'c' });
    expect(legacyOpPayload('sale', null, none)).toBeNull();

    // A purchase carries its rolls: they leave as the batches and receipts they became.
    const h = rollOf(5000, 80_000);
    const converted = legacyRollAsBatch(h.roll, h.purchase, h.moves);
    const purchase = legacyOpPayload(
      'purchase',
      { purchase: h.purchase, rolls: [h.roll], moves: h.moves },
      (id) => (id === h.roll.id ? converted : undefined),
    ) as { rolls?: unknown; batches: unknown[]; moves: { type: string }[] };
    expect(purchase.rolls).toBeUndefined();
    expect(purchase.batches).toEqual([converted.batch]);
    expect(purchase.moves.map((move) => move.type)).toEqual(['purchase']);
  });
});
