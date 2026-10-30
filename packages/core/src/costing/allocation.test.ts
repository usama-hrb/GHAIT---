import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mulDivRoundHalfUp } from '../numeric/index.js';
import {
  allocateLineCost,
  allocateRollCosts,
  costPerMeterCents,
  unallocatedCostCents,
} from './allocation.js';

const CREPE = { costTotalCents: 10_000, basisLengthCm: 230 }; // SPEC T2/T3
const ROSA = { costTotalCents: 80_000, basisLengthCm: 5000 }; // SPEC T1/T12

describe('allocateLineCost (SPEC §2.4)', () => {
  it('T2: selling 100 cm of the 230 cm crepe costs round(10000 × 100 / 230) = 4348', () => {
    expect(allocateLineCost({ ...CREPE, remainingCm: 230 }, 100, [])).toEqual({
      costCents: 4348,
      exhaustsRoll: false,
      oversoldCm: 0,
      provisional: false,
    });
  });

  it('T3: 100, 100 then 30 cm → 4348 + 4348 + (10000 − 8696 = 1304) = 10000 exactly', () => {
    const first = allocateLineCost({ ...CREPE, remainingCm: 230 }, 100, []);
    const second = allocateLineCost({ ...CREPE, remainingCm: 130 }, 100, [first.costCents]);
    const last = allocateLineCost({ ...CREPE, remainingCm: 30 }, 30, [
      first.costCents,
      second.costCents,
    ]);
    expect([first.costCents, second.costCents, last.costCents]).toEqual([4348, 4348, 1304]);
    expect([first.exhaustsRoll, second.exhaustsRoll, last.exhaustsRoll]).toEqual([
      false,
      false,
      true,
    ]);
    expect(first.costCents + second.costCents + last.costCents).toBe(10_000);
  });

  it('T3 via allocateRollCosts', () => {
    const costs = allocateRollCosts(CREPE, [100, 100, 30]).map((line) => line.costCents);
    expect(costs).toEqual([4348, 4348, 1304]);
  });

  it('T12: losing 30 cm of the 5000 cm roll costing 80000 is a loss of round(80000 × 30 / 5000) = 480', () => {
    expect(allocateLineCost({ ...ROSA, remainingCm: 5000 }, 30, []).costCents).toBe(480);
  });

  it('counts losses towards the remainder, so a roll with a loss still totals its cost', () => {
    const [loss, sale, last] = allocateRollCosts(CREPE, [30, 100, 100]);
    expect(loss?.costCents).toBe(1304); // 1304.3
    expect(sale?.costCents).toBe(4348);
    expect(last).toMatchObject({ costCents: 4348, exhaustsRoll: true }); // 10000 − 5652
  });

  it('a line that takes more than what is left gets the remainder and reports the excess', () => {
    expect(allocateLineCost({ ...CREPE, remainingCm: 30 }, 50, [4348, 4348])).toEqual({
      costCents: 1304,
      exhaustsRoll: true,
      oversoldCm: 20,
      provisional: false,
    });
  });

  it('a line on an already empty (or oversold) roll costs 0 and is all oversold', () => {
    expect(allocateLineCost({ ...CREPE, remainingCm: 0 }, 40, [10_000])).toMatchObject({
      costCents: 0,
      oversoldCm: 40,
    });
    expect(allocateLineCost({ ...CREPE, remainingCm: -20 }, 40, [10_000])).toMatchObject({
      costCents: 0,
      oversoldCm: 40,
    });
  });

  it('marks lines on a roll whose length is still estimated as provisional (SPEC §2.3, T4)', () => {
    const line = allocateLineCost(
      { costTotalCents: 40_000, basisLengthCm: 8000, remainingCm: 8000, lengthEstimated: true },
      1000,
      [],
    );
    expect(line).toMatchObject({ costCents: 5000, provisional: true });
  });

  it('never lets rounding push a line below 0 (cost 2 over 4 cm, sold 1 cm at a time)', () => {
    // Plain round(2 × 1 / 4) = 1 each would give 1, 1, 1 and then −1 for the last line.
    const costs = allocateRollCosts({ costTotalCents: 2, basisLengthCm: 4 }, [1, 1, 1, 1]);
    expect(costs.map((line) => line.costCents)).toEqual([1, 1, 0, 0]);
  });

  it('a whole-piece sale takes the full cost (SPEC §2.3 sellable_as_piece)', () => {
    expect(allocateLineCost({ ...CREPE, remainingCm: 230 }, 230, [])).toMatchObject({
      costCents: 10_000,
      exhaustsRoll: true,
      oversoldCm: 0,
    });
  });

  it.each([
    [{ ...CREPE, remainingCm: 230 }, 0, [], 'soldCm must be >= 1'],
    [{ ...CREPE, remainingCm: 230 }, 2.5, [], 'soldCm must be a safe integer'],
    [{ costTotalCents: -1, basisLengthCm: 230, remainingCm: 230 }, 10, [], 'costTotalCents'],
    [{ costTotalCents: 100, basisLengthCm: 0, remainingCm: 230 }, 10, [], 'basisLengthCm'],
    [{ ...CREPE, remainingCm: 1.5 }, 10, [], 'remainingCm'],
    [{ ...CREPE, remainingCm: 230 }, 10, [-1], 'previous cost'],
    [{ ...CREPE, remainingCm: 230 }, 10, [6000, 6000], 'exceed the roll'],
  ] as const)('rejects %j / %d / %j', (roll, soldCm, previous, message) => {
    expect(() => allocateLineCost(roll, soldCm, previous)).toThrow(message);
  });
});

describe('costPerMeterCents / unallocatedCostCents', () => {
  it('T2: ≈ 43.478 dh/m → 4348; T1: 16 dh/m → 1600', () => {
    expect(costPerMeterCents(10_000, 230)).toBe(4348);
    expect(costPerMeterCents(80_000, 5000)).toBe(1600);
  });

  it('what is left on the roll carries the unallocated cost exactly', () => {
    expect(unallocatedCostCents(10_000, [4348, 4348])).toBe(1304);
    expect(unallocatedCostCents(10_000, [])).toBe(10_000);
    expect(() => unallocatedCostCents(100, [101])).toThrow('exceed');
    expect(() => costPerMeterCents(100, 0)).toThrow(RangeError);
  });
});

/** A roll and a random split of its full length into consumptions (sale lines and losses). */
const exhaustingSequence = fc
  .record({
    basisLengthCm: fc.integer({ min: 1, max: 50_000 }),
    costTotalCents: fc.integer({ min: 0, max: 100_000_000 }),
  })
  .chain(({ basisLengthCm, costTotalCents }) =>
    fc
      .uniqueArray(fc.integer({ min: 1, max: Math.max(1, basisLengthCm - 1) }), {
        maxLength: Math.min(80, basisLengthCm - 1),
      })
      .map((cuts) => {
        const points = [0, ...cuts.toSorted((a, b) => a - b), basisLengthCm];
        const lines = points.slice(1).map((point, index) => point - (points[index] ?? 0));
        return { roll: { basisLengthCm, costTotalCents }, lines };
      }),
  );

/** Small rolls with tiny costs and many 1–3 cm lines: where rounding matters most. */
const roundingHeavySequence = fc
  .record({
    costTotalCents: fc.integer({ min: 0, max: 60 }),
    lines: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 60 }),
  })
  .map(({ costTotalCents, lines }) => ({
    roll: { costTotalCents, basisLengthCm: lines.reduce((sum, cm) => sum + cm, 0) },
    lines,
  }));

describe('property: a roll that is used up allocates exactly its cost', () => {
  it.each([
    ['random splits', exhaustingSequence],
    ['many tiny lines', roundingHeavySequence],
  ])('%s: Σ line costs === cost_total, every cost >= 0', (_name, sequences) => {
    fc.assert(
      fc.property(sequences, ({ roll, lines }) => {
        const allocations = allocateRollCosts(roll, lines);
        const costs = allocations.map((line) => line.costCents);
        expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(roll.costTotalCents);
        for (const cost of costs) expect(cost).toBeGreaterThanOrEqual(0);
        // Only the last line empties the roll; earlier lines never exceed the plain formula.
        expect(allocations.map((line) => line.exhaustsRoll)).toEqual(
          lines.map((_, index) => index === lines.length - 1),
        );
        allocations.slice(0, -1).forEach((line, index) => {
          const plain = mulDivRoundHalfUp(
            roll.costTotalCents,
            lines[index] ?? 0,
            roll.basisLengthCm,
          );
          expect(line.costCents).toBeLessThanOrEqual(plain);
        });
      }),
    );
  });

  it('never allocates more than the cost at any point', () => {
    fc.assert(
      fc.property(exhaustingSequence, ({ roll, lines }) => {
        let running = 0;
        for (const line of allocateRollCosts(roll, lines)) {
          running += line.costCents;
          expect(running).toBeLessThanOrEqual(roll.costTotalCents);
        }
      }),
    );
  });

  it('overselling still allocates exactly the cost; the excess is reported, not costed', () => {
    fc.assert(
      fc.property(
        exhaustingSequence,
        fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 5 }),
        ({ roll, lines }, extra) => {
          const allocations = allocateRollCosts(roll, [...lines, ...extra]);
          const total = allocations.reduce((sum, line) => sum + line.costCents, 0);
          const oversold = allocations.reduce((sum, line) => sum + line.oversoldCm, 0);
          expect(total).toBe(roll.costTotalCents);
          expect(oversold).toBe(extra.reduce((sum, cm) => sum + cm, 0));
        },
      ),
    );
  });
});
