import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type RollLedgerMove, measuredTotalLength, rollLedger, rollState } from './ledger.js';

const move = (
  type: RollLedgerMove['type'],
  deltaCm: number,
  id: string = crypto.randomUUID(),
): RollLedgerMove => ({
  id,
  type,
  deltaCm,
});

describe('rollLedger (SPEC §2.4)', () => {
  const piece = { costTotalCents: 10_000, lengthCmInitial: 230, lengthEstimated: false };

  it('T3: 100 + 100 + 30 cm off a 230 cm roll cost 4348 + 4348 + 1304 = 10000 exactly', () => {
    const ledger = rollLedger(piece, [
      move('purchase', 230),
      move('sale', -100, 'a'),
      move('loss', -100, 'b'),
      move('sale', -30, 'c'),
    ]);
    expect(ledger.costs).toEqual([
      { id: 'a', costCents: 4348 },
      { id: 'b', costCents: 4348 },
      { id: 'c', costCents: 1304 },
    ]);
    expect(ledger).toMatchObject({
      remainingCm: 0,
      unallocatedCostCents: 0,
      oversoldCm: 0,
      costPerMeterCents: 4348,
    });
  });

  it('T12: a 30 cm loss on a 50 m roll that cost 800 dh costs 480', () => {
    const ledger = rollLedger(
      { costTotalCents: 80_000, lengthCmInitial: 5000, lengthEstimated: false },
      [move('purchase', 5000), move('loss', -30, 'damage')],
    );
    expect(ledger.costs).toEqual([{ id: 'damage', costCents: 480 }]);
    expect(ledger).toMatchObject({ remainingCm: 4970, unallocatedCostCents: 79_520 });
  });

  it('T4: an estimated 80 m kg roll measured at 76 m: 5.26 dh/m, no longer estimated, sales re-costed', () => {
    const kg = { costTotalCents: 40_000, lengthCmInitial: 8000, lengthEstimated: true };
    const before = rollLedger(kg, [move('purchase', 8000), move('sale', -1000, 's')]);
    expect(before).toMatchObject({
      lengthEstimated: true,
      costPerMeterCents: 500,
      costs: [{ id: 's', costCents: 5000 }],
    });
    const after = rollLedger(kg, [
      move('purchase', 8000),
      move('sale', -1000, 's'),
      move('length_correction', -400),
    ]);
    expect(after).toMatchObject({
      basisLengthCm: 7600,
      remainingCm: 6600,
      lengthEstimated: false,
      costPerMeterCents: 526,
      costs: [{ id: 's', costCents: 5263 }],
    });
  });

  it('stocktake adjustments move the remaining length, not the cost basis', () => {
    const ledger = rollLedger(
      { costTotalCents: 80_000, lengthCmInitial: 5000, lengthEstimated: false },
      [move('purchase', 5000), move('adjustment', -200), move('sale', -4800, 'last')],
    );
    // The last sale empties the roll and takes the whole remaining cost.
    expect(ledger).toMatchObject({
      basisLengthCm: 5000,
      remainingCm: 0,
      costs: [{ id: 'last', costCents: 80_000 }],
    });
  });

  it('keeps the cost of a locked line, and refuses locked costs above the roll cost', () => {
    const roll = { costTotalCents: 10_000, lengthCmInitial: 230, lengthEstimated: false };
    const ledger = rollLedger(roll, [
      move('purchase', 230),
      { ...move('sale', -100, 'x'), lockedCostCents: 4000 },
    ]);
    expect(ledger.costs).toEqual([{ id: 'x', costCents: 4000 }]);
    expect(() => rollLedger(roll, [{ ...move('sale', -100), lockedCostCents: 20_000 }])).toThrow(
      'exceed',
    );
  });

  it('a reversal (voided sale) puts the length back and re-costs the roll as if the line never was', () => {
    const reversal = (target: string, deltaCm: number, id = crypto.randomUUID()) => ({
      ...move('reversal', deltaCm, id),
      reverses: target,
    });
    const ledger = rollLedger(piece, [
      move('purchase', 230),
      move('sale', -100, 'a'),
      move('sale', -100, 'b'),
      reversal('a', 100),
      move('sale', -130, 'c'),
    ]);
    expect(ledger.costs).toEqual([
      { id: 'b', costCents: 4348 },
      { id: 'c', costCents: 5652 },
    ]);
    expect(ledger).toMatchObject({ remainingCm: 0, unallocatedCostCents: 0 });
    // A loss and a stocktake can be reversed too; a purchase or a measurement cannot.
    expect(
      rollLedger(piece, [move('purchase', 230), move('adjustment', 20, 'd'), reversal('d', -20)])
        .remainingCm,
    ).toBe(230);
    for (const bad of [
      [move('purchase', 230, 'p'), reversal('p', -230)],
      [move('length_correction', -10, 'm'), reversal('m', 10)],
      [move('sale', -100, 'a'), reversal('a', 90)],
      [reversal('nothing', 10)],
      [move('reversal', 10)],
      [move('sale', -100, 'a'), reversal('a', 100), reversal('a', 100)],
    ]) {
      expect(() => rollLedger(piece, bad)).toThrow(RangeError);
    }
    expect(() => rollLedger(piece, [{ id: 'z', type: 'reversal', deltaCm: 0 }])).toThrow(
      'a reversal must give back some length',
    );
  });

  it('flags length sold beyond the roll (two offline devices)', () => {
    const ledger = rollLedger(piece, [
      move('purchase', 230),
      move('sale', -200),
      move('sale', -100),
    ]);
    expect(ledger).toMatchObject({ remainingCm: -70, oversoldCm: 70, unallocatedCostCents: 0 });
  });

  it('property: the costs never exceed the roll and add up to it once the roll is empty', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.array(fc.integer({ min: 1, max: 500 }), { maxLength: 30 }),
        (costTotalCents, lengthCmInitial, takes) => {
          const moves = [
            move('purchase', lengthCmInitial),
            ...takes.map((cm) => move('loss', -cm)),
          ];
          const ledger = rollLedger(
            { costTotalCents, lengthCmInitial, lengthEstimated: false },
            moves,
          );
          const allocated = ledger.costs.reduce((sum, entry) => sum + entry.costCents, 0);
          expect(allocated + ledger.unallocatedCostCents).toBe(costTotalCents);
          if (ledger.remainingCm <= 0) expect(ledger.unallocatedCostCents).toBe(0);
        },
      ),
    );
  });
});

describe('measuredTotalLength', () => {
  it('adds what was taken off to what is on the roll now (SPEC §2.3)', () => {
    expect(measuredTotalLength({ basisLengthCm: 8000, remainingCm: 8000 }, 7600)).toBe(7600); // T4
    expect(measuredTotalLength({ basisLengthCm: 8000, remainingCm: 7000 }, 6600)).toBe(7600);
    expect(() => measuredTotalLength({ basisLengthCm: 100, remainingCm: 100 }, 0)).toThrow(
      'at least 1 cm',
    );
    expect(() => measuredTotalLength({ basisLengthCm: 100, remainingCm: 100 }, -1)).toThrow(
      RangeError,
    );
  });
});

describe('rollState (SPEC §4)', () => {
  it.each([
    [4970, false, 100, 'active'],
    [99, false, 100, 'remnant'],
    [4970, true, 100, 'remnant'],
    [0, true, 100, 'empty'],
    [-70, false, 100, 'empty'],
    [50, false, 0, 'active'],
  ] as const)('%i cm, marked %s, threshold %i → %s', (remaining, marked, threshold, state) => {
    expect(rollState(remaining, marked, threshold)).toBe(state);
  });
});
