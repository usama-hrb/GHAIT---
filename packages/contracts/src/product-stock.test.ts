import {
  type ProductStockBatchLedger,
  type ProductStockQuantity,
  productStockBatchLedger,
  productStockLedger,
  type RollLedger,
} from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  type LegacyPurchaseFacts,
  legacyRollAsProductBatch,
  type Roll,
  rollLedgerOf,
  type SequencedMove,
  type StockMove,
} from './index.js';

const DAY = '2026-10-30';
const base = { updatedAt: '2026-10-30T09:00:00.000Z', deviceId: 'desk', voidedAt: null };

let clock = 0;
let counter = 0;
const nextId = () => `id-${String(++counter).padStart(6, '0')}`;
const nextStamp = () => new Date(Date.UTC(2026, 9, 30, 9, 0, 0, clock++)).toISOString();

function rollOf(lengthCmInitial: number, costTotalCents: number, lengthEstimated = false): Roll {
  const createdAt = nextStamp();
  return {
    ...base,
    id: nextId(),
    createdAt,
    shortCode: 'R-A0001',
    variantId: 'rosa',
    purchaseId: nextId(),
    lengthCmInitial,
    costTotalCents,
    lengthEstimated,
    status: 'active',
  };
}

function moveOf(
  roll: Roll,
  type: StockMove['type'],
  deltaCm: number,
  refId: string | null = null,
): StockMove {
  return {
    ...base,
    id: nextId(),
    createdAt: nextStamp(),
    rollId: roll.id,
    type,
    deltaCm,
    refId: type === 'purchase' ? roll.purchaseId : refId,
    date: DAY,
    note: null,
  };
}

const receipt = (roll: Roll) => moveOf(roll, 'purchase', roll.lengthCmInitial);
const bought = (method: LegacyPurchaseFacts['method'], weightG: number | null = null) => ({
  method,
  date: DAY,
  weightG,
});

const metersOf = (quantity: ProductStockQuantity | undefined): number | undefined =>
  quantity?.unit === 'meter' ? quantity.centimeters : undefined;

interface Both {
  legacy: RollLedger;
  ledger: ProductStockBatchLedger;
}

function both(roll: Roll, purchase: LegacyPurchaseFacts | undefined, moves: SequencedMove[]): Both {
  const { batch, movements } = legacyRollAsProductBatch(roll, purchase, moves);
  return { legacy: rollLedgerOf(roll, moves), ledger: productStockBatchLedger(batch, movements) };
}

/** What every figure the product screens read must agree on with the roll's own ledger. */
function expectSameAsRoll({ legacy, ledger }: Both): void {
  expect(metersOf(ledger.available.meter)).toBe(legacy.remainingCm);
  expect(ledger.unallocatedCostCents).toBe(legacy.unallocatedCostCents);
  expect(ledger.costPerUnitCents.meter).toBe(legacy.costPerMeterCents);
  expect(ledger.measurementStatus === 'estimated').toBe(legacy.lengthEstimated);
  // The roll's cost of a sale is net of what was given back; the batch's is gross plus returns.
  const net = new Map(ledger.costs.map(({ moveId, costCents }) => [moveId, costCents]));
  for (const back of ledger.returns) {
    net.set(back.saleMoveId, (net.get(back.saleMoveId) ?? 0) - back.costCents);
  }
  expect([...net].map(([id, costCents]) => ({ id, costCents }))).toEqual(legacy.costs);
  expect(
    ledger.returns.map(({ moveId, saleMoveId, costCents }) => ({
      id: moveId,
      saleMoveId,
      costCents,
    })),
  ).toEqual(legacy.returns);
}

describe('legacy roll as a product stock batch (ADR 0011)', () => {
  it('a metre roll is a meter batch of its length with its cost, and sells like the roll', () => {
    const roll = rollOf(5000, 80_000);
    const sale = moveOf(roll, 'sale', -275);
    const result = both(roll, bought('meter'), [
      receipt(roll),
      sale,
      moveOf(roll, 'loss', -30),
      moveOf(roll, 'return', 75, sale.id),
      moveOf(roll, 'adjustment', -20),
    ]);
    expect(result.ledger).toMatchObject({
      purchaseUnit: 'meter',
      remaining: { unit: 'meter', centimeters: 4_750 },
      measurementStatus: 'not_required',
      awaitingMeasurement: null,
    });
    expectSameAsRoll(result);
  });

  it('a ready piece is a meter batch of its length; selling it whole sells all of it', () => {
    const roll = rollOf(230, 10_000);
    const result = both(roll, bought('piece'), [receipt(roll), moveOf(roll, 'sale', -230)]);
    expect(result.ledger).toMatchObject({
      purchaseUnit: 'meter',
      remaining: { unit: 'meter', centimeters: 0 },
      unallocatedCostCents: 0,
      costs: [{ costCents: 10_000 }],
    });
    expectSameAsRoll(result);
  });

  it('a kg roll holds the weight bought, converts at the roll’s length and stays estimated', () => {
    // 100 kg at 200 dh, 200 cm per kg estimated: 200 m, 1 dh per metre.
    const roll = rollOf(20_000, 20_000, true);
    const result = both(roll, bought('kg', 100_000), [receipt(roll)]);
    expect(result.ledger).toMatchObject({
      purchaseUnit: 'kg',
      remaining: { unit: 'kg', grams: 100_000 },
      available: {
        kg: { unit: 'kg', grams: 100_000 },
        meter: { unit: 'meter', centimeters: 20_000 },
      },
      costPerUnitCents: { meter: 100 },
      measurementStatus: 'estimated',
      conversion: { weightG: 100_000, lengthCm: 20_000, source: 'estimated' },
    });
    expectSameAsRoll(result);
  });

  it('T4: measuring a kg roll after a sale re-costs it as the roll does and marks it measured', () => {
    const roll = rollOf(8_000, 40_000, true);
    const result = both(roll, bought('kg', 20_000), [
      receipt(roll),
      moveOf(roll, 'sale', -1_000),
      moveOf(roll, 'length_correction', -400),
    ]);
    expect(result.ledger).toMatchObject({
      remaining: { unit: 'kg', grams: 17_368 },
      available: { meter: { unit: 'meter', centimeters: 6_600 } },
      costs: [{ costCents: 5_263 }],
      costPerUnitCents: { meter: 526 },
      measurementStatus: 'measured',
      conversion: { weightG: 20_000, lengthCm: 7_600, source: 'measured' },
    });
    expectSameAsRoll(result);
  });

  it('keeps the receipt a measurement did not touch: only the latest measurement counts', () => {
    const roll = rollOf(8_000, 40_000, true);
    const result = both(roll, bought('kg', 20_000), [
      receipt(roll),
      moveOf(roll, 'length_correction', -400),
      moveOf(roll, 'sale', -500),
      moveOf(roll, 'length_correction', 150),
    ]);
    expect(result.ledger.conversion).toEqual({
      weightG: 20_000,
      lengthCm: 7_750,
      source: 'measured',
    });
    expect(metersOf(result.ledger.available.meter)).toBe(7_250);
    expectSameAsRoll(result);
  });

  it('without the purchase (a cashier’s device) it is the same stock in meters, at no cost', () => {
    const roll = { ...rollOf(8_000, 0, true) };
    const sale = moveOf(roll, 'sale', -1_000);
    const result = both(roll, undefined, [receipt(roll), sale]);
    expect(result.ledger).toMatchObject({
      purchaseUnit: 'meter',
      remaining: { unit: 'meter', centimeters: 7_000 },
    });
    expect(legacyRollAsProductBatch(roll, undefined, [receipt(roll)]).batch.purchaseDate).toBe(
      roll.createdAt.slice(0, 10),
    );
  });

  it('works when the receipt move has not arrived yet, and keeps the receipt first', () => {
    const roll = rollOf(5_000, 80_000);
    const sale = moveOf(roll, 'sale', -100);
    const { batch, movements } = legacyRollAsProductBatch(roll, bought('meter'), [sale]);
    expect(movements.map((entry) => entry.type)).toEqual(['purchase', 'sale']);
    expect(productStockBatchLedger(batch, movements).remaining).toEqual({
      unit: 'meter',
      centimeters: 4_900,
    });
  });

  it('sets a product’s rolls side by side, each with its own cost', () => {
    const older = rollOf(1_000, 10_000);
    const newer = rollOf(1_000, 20_000);
    const a = legacyRollAsProductBatch(older, bought('meter'), [receipt(older)]);
    const b = legacyRollAsProductBatch(newer, bought('meter'), [receipt(newer)]);
    const ledger = productStockLedger([a.batch, b.batch], [...a.movements, ...b.movements]);
    expect(ledger.available.meter).toEqual({ unit: 'meter', centimeters: 2_000 });
    expect(ledger.batches.map((entry) => entry.costPerUnitCents.meter)).toEqual([1_000, 2_000]);
  });
});

/** mulberry32: a small seeded generator, so a failing history can be replayed from its seed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const between = (next: () => number, min: number, max: number) =>
  min + Math.floor(next() * (max - min + 1));

/** A roll and a history the app can write: sales, losses, counts, returns, voids, measurements. */
function history(seed: number, method: 'meter' | 'piece' | 'kg') {
  const next = random(seed);
  const length = between(next, 200, 30_000);
  const roll = rollOf(length, between(next, 0, 400_000), method === 'kg');
  const purchase = bought(method, method === 'kg' ? between(next, 1_000, 90_000) : null);
  const moves: StockMove[] = [receipt(roll)];
  let remaining = length;
  let basis = length;
  const sales: { move: StockMove; returnableCm: number }[] = [];
  const reversed = new Set<string>();

  for (let step = between(next, 1, 14); step > 0; step -= 1) {
    const pick = next();
    if (pick < 0.35) {
      // A sale, now and then one that takes more than is left (two devices, a short estimate).
      const size = between(next, 1, Math.max(1, Math.floor(Math.max(remaining, 1) * 1.15)));
      const move = moveOf(roll, 'sale', -size);
      moves.push(move);
      sales.push({ move, returnableCm: size });
      remaining -= size;
    } else if (pick < 0.45) {
      const size = between(next, 1, Math.max(1, Math.floor(Math.max(remaining, 1) / 4)));
      moves.push(moveOf(roll, 'loss', -size));
      remaining -= size;
    } else if (pick < 0.57) {
      const counted = between(next, 0, Math.max(1, remaining + 300));
      if (counted !== remaining) {
        moves.push(moveOf(roll, 'adjustment', counted - remaining));
        remaining = counted;
      }
    } else if (pick < 0.72) {
      const giveBack = sales.filter(
        ({ move, returnableCm }) => returnableCm > 0 && !reversed.has(move.id),
      );
      const target = giveBack[between(next, 0, Math.max(0, giveBack.length - 1))];
      if (target) {
        const size = between(next, 1, target.returnableCm);
        moves.push(moveOf(roll, 'return', size, target.move.id));
        target.returnableCm -= size;
        remaining += size;
      }
    } else if (pick < 0.84) {
      // Only a sale with nothing given back can be voided (SPEC §4).
      const voidable = sales.filter(
        ({ move, returnableCm }) => !reversed.has(move.id) && returnableCm === -move.deltaCm,
      );
      const target = voidable[between(next, 0, Math.max(0, voidable.length - 1))];
      if (target) {
        moves.push(moveOf(roll, 'reversal', -target.move.deltaCm, target.move.id));
        reversed.add(target.move.id);
        remaining -= target.move.deltaCm;
      }
    } else {
      const delta = between(next, -Math.floor(basis / 3), Math.floor(basis / 2));
      if (delta !== 0 && basis + delta >= 1) {
        moves.push(moveOf(roll, 'length_correction', delta));
        basis += delta;
        remaining += delta;
      }
    }
  }
  // A settlement froze the costs the roll ledger had computed for the history up to then (P9);
  // those lines keep them whatever a later measurement says.
  const lockedUpTo = between(next, 0, moves.length);
  const computed = rollLedgerOf(roll, moves.slice(0, lockedUpTo)).costs;
  const costOf = new Map(computed.map((entry) => [entry.id, entry.costCents]));
  const frozen: SequencedMove[] = moves.map((move, index) =>
    index < lockedUpTo && costOf.has(move.id)
      ? { ...move, lockedCostCents: costOf.get(move.id) }
      : move,
  );
  return { roll, purchase, moves: frozen };
}

describe('the product ledger agrees with the roll ledger on any history the app writes', () => {
  for (const method of ['meter', 'piece', 'kg'] as const) {
    it(`${method}: remaining, costs, returns, cost per metre and estimate`, () => {
      for (let seed = 1; seed <= 400; seed += 1) {
        const { roll, purchase, moves } = history(seed, method);
        try {
          expectSameAsRoll(both(roll, purchase, moves));
        } catch (error) {
          throw new Error(`seed ${String(seed)} (${method}): ${String(error)}`, { cause: error });
        }
      }
    });
  }
});
