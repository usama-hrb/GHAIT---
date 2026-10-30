import { describe, expect, it } from 'vitest';
import {
  buildStockMove,
  checkRollUpdate,
  checkStockMove,
  INVENTORY_ISSUES,
  newStockMoveSchema,
  nextFabricEstimate,
  type Roll,
  rollLedgerOf,
  type StockMove,
} from './index.js';

const NOW = '2026-10-30T10:00:00.000Z';
const base = { createdAt: NOW, updatedAt: NOW, deviceId: 'desk', voidedAt: null };

const roll: Roll = {
  ...base,
  id: crypto.randomUUID(),
  shortCode: 'R-A0001',
  variantId: crypto.randomUUID(),
  purchaseId: crypto.randomUUID(),
  lengthCmInitial: 5000,
  costTotalCents: 80_000,
  lengthEstimated: false,
  status: 'active',
};
const kgRoll: Roll = {
  ...roll,
  id: crypto.randomUUID(),
  lengthCmInitial: 8000,
  costTotalCents: 40_000,
  lengthEstimated: true,
};

const moveOf = (
  r: Roll,
  type: StockMove['type'],
  deltaCm: number,
  at = NOW,
  note: string | null = null,
): StockMove => ({
  ...base,
  createdAt: at,
  updatedAt: at,
  id: crypto.randomUUID(),
  rollId: r.id,
  type,
  deltaCm,
  refId: type === 'purchase' ? r.purchaseId : null,
  date: '2026-10-30',
  note,
});

function build(input: unknown, r: Roll, history: StockMove[]) {
  return buildStockMove(newStockMoveSchema.parse(input), rollLedgerOf(r, history), {
    id: crypto.randomUUID(),
    deviceId: 'desk',
    now: NOW,
  });
}

describe('stock moves (BUILD_PROMPTS 3.3)', () => {
  const purchased = [moveOf(roll, 'purchase', 5000)];

  it('T12: a 30 cm loss is −30 cm with its reason, and costs 480 in the ledger', () => {
    const result = build(
      { type: 'loss', rollId: roll.id, date: '2026-10-30', lengthCm: 30, reason: 'بقعة' },
      roll,
      purchased,
    );
    if (!result.ok) throw new Error('expected a move');
    expect(result.move).toMatchObject({ type: 'loss', deltaCm: -30, note: 'بقعة' });
    expect(checkStockMove(result.move, roll, purchased)).toEqual([]);
    expect(rollLedgerOf(roll, [...purchased, result.move]).costs).toEqual([
      { id: result.move.id, costCents: 480 },
    ]);
  });

  it('a stocktake records the difference with the books, and refuses a count that changes nothing', () => {
    const result = build(
      { type: 'adjustment', rollId: roll.id, date: '2026-10-30', countedCm: 4950, reason: 'جرد' },
      roll,
      purchased,
    );
    expect(result).toMatchObject({ ok: true, move: { type: 'adjustment', deltaCm: -50 } });
    expect(
      build(
        { type: 'adjustment', rollId: roll.id, date: '2026-10-30', countedCm: 5000, reason: 'جرد' },
        roll,
        purchased,
      ),
    ).toEqual({
      ok: false,
      issues: [{ path: ['countedCm'], message: INVENTORY_ISSUES.noChange, code: 'custom' }],
    });
  });

  it('T4: measuring 76 m on the 80 m estimate records −400 cm; after a sale it adds the sold length back', () => {
    const history = [moveOf(kgRoll, 'purchase', 8000)];
    const fresh = build(
      {
        type: 'length_correction',
        rollId: kgRoll.id,
        date: '2026-10-30',
        measuredRemainingCm: 7600,
      },
      kgRoll,
      history,
    );
    expect(fresh).toMatchObject({ ok: true, move: { deltaCm: -400 } });
    const sold = [...history, moveOf(kgRoll, 'sale', -1000, '2026-10-30T10:01:00.000Z')];
    const later = build(
      {
        type: 'length_correction',
        rollId: kgRoll.id,
        date: '2026-10-30',
        measuredRemainingCm: 6600,
      },
      kgRoll,
      sold,
    );
    expect(later).toMatchObject({ ok: true, move: { deltaCm: -400 } });
    if (!later.ok) return;
    expect(rollLedgerOf(kgRoll, [...sold, later.move])).toMatchObject({
      basisLengthCm: 7600,
      remainingCm: 6600,
      lengthEstimated: false,
      costPerMeterCents: 526,
    });
  });

  it('refuses a measurement that changes nothing or leaves no roll', () => {
    const history = [moveOf(kgRoll, 'purchase', 8000), moveOf(kgRoll, 'loss', -8000, NOW, 'x')];
    expect(
      build(
        {
          type: 'length_correction',
          rollId: kgRoll.id,
          date: '2026-10-30',
          measuredRemainingCm: 0,
        },
        kgRoll,
        history,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ message: INVENTORY_ISSUES.noChange }],
    });
    expect(
      build(
        {
          type: 'length_correction',
          rollId: kgRoll.id,
          date: '2026-10-30',
          measuredRemainingCm: 0,
        },
        kgRoll,
        [moveOf(kgRoll, 'adjustment', 100, NOW, 'x')],
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ message: INVENTORY_ISSUES.invalidLength }],
    });
  });

  it.each([
    [
      'a purchase move on its own',
      (m: StockMove) => ({ ...m, type: 'purchase' as const }),
      INVENTORY_ISSUES.notPushable,
    ],
    [
      'a move with a reference',
      (m: StockMove) => ({ ...m, refId: crypto.randomUUID() }),
      INVENTORY_ISSUES.notPushable,
    ],
    [
      'a move of another roll',
      (m: StockMove) => ({ ...m, rollId: crypto.randomUUID() }),
      INVENTORY_ISSUES.wrongRoll,
    ],
    [
      'a loss that adds length',
      (m: StockMove) => ({ ...m, deltaCm: 30 }),
      INVENTORY_ISSUES.invalidLength,
    ],
    [
      'a loss without a reason',
      (m: StockMove) => ({ ...m, note: null }),
      INVENTORY_ISSUES.reasonRequired,
    ],
    [
      'an empty adjustment',
      (m: StockMove) => ({ ...m, type: 'adjustment' as const, deltaCm: 0 }),
      INVENTORY_ISSUES.noChange,
    ],
    [
      'a correction below 1 cm',
      (m: StockMove) => ({ ...m, type: 'length_correction' as const, deltaCm: -5000 }),
      INVENTORY_ISSUES.invalidLength,
    ],
  ])('the server refuses %s', (_label, change, message) => {
    const loss = moveOf(roll, 'loss', -30, NOW, 'بقعة');
    expect(checkStockMove(change(loss), roll, purchased)).toEqual([
      expect.objectContaining({ message }),
    ]);
  });

  it('orders the history by creation time, the same everywhere', () => {
    const piece: Roll = {
      ...roll,
      id: crypto.randomUUID(),
      lengthCmInitial: 230,
      costTotalCents: 10_000,
    };
    const first = moveOf(piece, 'loss', -100, '2026-10-30T10:01:00.000Z', 'a');
    const second = moveOf(piece, 'loss', -130, '2026-10-30T10:02:00.000Z', 'b');
    // Given in any order, the last one in time empties the roll and takes the remainder.
    const ledger = rollLedgerOf(piece, [second, moveOf(piece, 'purchase', 230), first]);
    expect(ledger.costs).toEqual([
      { id: first.id, costCents: 4348 },
      { id: second.id, costCents: 5652 },
    ]);
  });
});

describe('roll updates', () => {
  it('only the remnant mark may change', () => {
    expect(
      checkRollUpdate(roll, { ...roll, status: 'remnant', updatedAt: '2026-10-31T00:00:00.000Z' }),
    ).toEqual([]);
    expect(checkRollUpdate(roll, { ...roll, costTotalCents: 1 })).toEqual([
      expect.objectContaining({
        path: ['costTotalCents'],
        message: INVENTORY_ISSUES.rollFieldsFixed,
      }),
    ]);
    expect(checkRollUpdate(roll, { ...roll, status: 'empty' })).toEqual([
      expect.objectContaining({ path: ['status'] }),
    ]);
  });
});

describe('nextFabricEstimate (SPEC §2.3, C11)', () => {
  it('T4: the first measurement replaces the guess (7600 cm / 20 kg → 380 cm/kg)', () => {
    expect(
      nextFabricEstimate({
        policy: 'average',
        current: 400,
        measurementsSoFar: 0,
        measuredTotalCm: 7600,
        weightG: 20_000,
      }),
    ).toBe(380);
    expect(
      nextFabricEstimate({
        policy: 'average',
        current: null,
        measurementsSoFar: 3,
        measuredTotalCm: 7600,
        weightG: 20_000,
      }),
    ).toBe(380);
  });

  it('then follows the policy', () => {
    const next = { current: 380, measurementsSoFar: 1, measuredTotalCm: 8400, weightG: 20_000 };
    expect(nextFabricEstimate({ ...next, policy: 'average' })).toBe(400);
    expect(nextFabricEstimate({ ...next, policy: 'last' })).toBe(420);
  });
});
