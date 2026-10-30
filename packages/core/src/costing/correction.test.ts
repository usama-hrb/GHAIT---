import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateLineCost } from './allocation.js';
import { applyLengthCorrection, type RollHistoryMove } from './correction.js';
import { buildRollsFromPurchase } from './purchase.js';
import { remainingLength } from './stock.js';

// SPEC T4: 20 kg bought for 400 dh, estimated at 400 cm/kg → 8000 cm.
const T4 = { costTotalCents: 40_000, lengthCmInitial: 8000 };

function sale(id: string, cm: number, costCents: number, locked = false): RollHistoryMove {
  return { type: 'sale', id, deltaCm: -cm, costCents, locked };
}

describe('applyLengthCorrection (SPEC §2.3, §2.4)', () => {
  it('T4: measuring 7600 cm records length_correction −400 and updates the cost per metre', () => {
    const [roll] = buildRollsFromPurchase({
      method: 'kg',
      variantId: 'jersey',
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    }).rolls;
    expect(roll).toMatchObject({ lengthCmInitial: 8000, lengthEstimated: true });

    expect(applyLengthCorrection(T4, [], 7600)).toEqual({
      correctionDeltaCm: -400,
      basisLengthCm: 7600,
      remainingCm: 7600,
      costPerMeterCents: 526, // 5.26 dh/m, was 5.00 on the estimate
      lengthEstimated: false,
      recompute: [],
      lockedIds: [],
      oversoldCm: 0,
      unallocatedCostCents: 40_000,
    });
    expect(remainingLength(8000, [{ type: 'length_correction', deltaCm: -400 }])).toBe(7600);
  });

  it('T4: profit is provisional before the measurement', () => {
    const line = allocateLineCost(
      { costTotalCents: 40_000, basisLengthCm: 8000, remainingCm: 8000, lengthEstimated: true },
      1000,
      [],
    );
    expect(line).toMatchObject({ costCents: 5000, provisional: true });
  });

  it('T4: re-costs lines sold before measuring (unlocked period)', () => {
    const correction = applyLengthCorrection(T4, [sale('s1', 1000, 5000)], 7600);
    expect(correction.recompute).toEqual([{ id: 's1', oldCostCents: 5000, newCostCents: 5263 }]);
    expect(correction.remainingCm).toBe(6600);
    expect(correction.unallocatedCostCents).toBe(40_000 - 5263);
  });

  it('keeps lines of locked periods at their recorded cost, and counts them', () => {
    const correction = applyLengthCorrection(
      T4,
      [sale('s1', 1000, 5000, true), sale('s2', 1000, 5000)],
      7600,
    );
    expect(correction.lockedIds).toEqual(['s1']);
    expect(correction.recompute).toEqual([{ id: 's2', oldCostCents: 5000, newCostCents: 5263 }]);
    expect(correction.unallocatedCostCents).toBe(40_000 - 5000 - 5263);
  });

  it('when the measured length is exactly what was sold, the last line takes the exact remainder', () => {
    // Sold 4000 + 3600 on the 8000 estimate (costs 20000 + 18000); the roll really was 7600.
    const correction = applyLengthCorrection(
      T4,
      [sale('s1', 4000, 20_000), sale('s2', 3600, 18_000)],
      7600,
    );
    expect(correction.recompute).toEqual([
      { id: 's1', oldCostCents: 20_000, newCostCents: 21_053 },
      { id: 's2', oldCostCents: 18_000, newCostCents: 18_947 },
    ]);
    expect(correction.remainingCm).toBe(0);
    expect(correction.unallocatedCostCents).toBe(0);
  });

  it('re-costs losses like sales', () => {
    const history: RollHistoryMove[] = [
      { type: 'loss', id: 'l1', deltaCm: -30, costCents: 150, locked: false },
    ];
    expect(applyLengthCorrection(T4, history, 7600).recompute).toEqual([
      { id: 'l1', oldCostCents: 150, newCostCents: 158 },
    ]);
  });

  it('reports cm sold beyond a measured length that turned out shorter', () => {
    const correction = applyLengthCorrection(T4, [sale('s1', 7800, 39_000)], 7600);
    expect(correction).toMatchObject({
      remainingCm: -200,
      oversoldCm: 200,
      unallocatedCostCents: 0,
    });
    expect(correction.recompute).toEqual([
      { id: 's1', oldCostCents: 39_000, newCostCents: 40_000 },
    ]);
  });

  it('supersedes an earlier correction: the delta is from the current basis', () => {
    const history: RollHistoryMove[] = [
      { type: 'length_correction', deltaCm: -400 },
      sale('s1', 1000, 5263),
    ];
    const correction = applyLengthCorrection(T4, history, 7800);
    expect(correction.correctionDeltaCm).toBe(200);
    expect(correction.recompute).toEqual([{ id: 's1', oldCostCents: 5263, newCostCents: 5128 }]);
    expect(correction.remainingCm).toBe(6800);
  });

  it('keeps returns and stocktake adjustments in the remaining length', () => {
    const history: RollHistoryMove[] = [
      sale('s1', 1000, 5000),
      { type: 'return', deltaCm: 200 },
      { type: 'adjustment', deltaCm: -50 },
    ];
    expect(applyLengthCorrection(T4, history, 7600).remainingCm).toBe(6750);
  });

  it('measuring the estimated length exactly changes nothing but the estimated flag', () => {
    const correction = applyLengthCorrection(T4, [sale('s1', 1000, 5000)], 8000);
    expect(correction).toMatchObject({
      correctionDeltaCm: 0,
      recompute: [],
      lengthEstimated: false,
    });
  });

  it('rejects invalid input', () => {
    expect(() => applyLengthCorrection(T4, [], 0)).toThrow('newLengthCm');
    expect(() =>
      applyLengthCorrection(
        T4,
        [{ type: 'sale', id: 's', deltaCm: 100, costCents: 0, locked: false }],
        7600,
      ),
    ).toThrow('negative deltaCm');
    expect(() => applyLengthCorrection(T4, [sale('s', 100, -1)], 7600)).toThrow('costCents');
    // A locked line after the roll was already emptied by unlocked ones cannot fit.
    expect(() =>
      applyLengthCorrection(T4, [sale('s1', 7600, 38_000), sale('s2', 100, 5000, true)], 7600),
    ).toThrow('locked costs exceed');
  });

  it('property: re-costing a roll that is used up allocates exactly its cost', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.array(fc.integer({ min: 1, max: 2000 }), { minLength: 1, maxLength: 30 }),
        (costTotalCents, estimateCm, lines) => {
          const measured = lines.reduce((sum, cm) => sum + cm, 0);
          const history = lines.map((cm, index) => sale(`s${String(index)}`, cm, 0));
          const correction = applyLengthCorrection(
            { costTotalCents, lengthCmInitial: estimateCm },
            history,
            measured,
          );
          const newCosts = history.map((move) => {
            const changed = correction.recompute.find((c) => 'id' in move && c.id === move.id);
            return changed ? changed.newCostCents : 0;
          });
          expect(newCosts.reduce((sum, cost) => sum + cost, 0)).toBe(costTotalCents);
          expect(correction).toMatchObject({ remainingCm: 0, unallocatedCostCents: 0 });
        },
      ),
    );
  });
});
