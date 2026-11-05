import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromMeters } from '../length/index.js';
import { fromDirham } from '../money/index.js';
import { costPerMeterCents } from './allocation.js';
import {
  averageCostPerMeterCents,
  buildRollsFromPurchase,
  isRenewalCostHigher,
  measuredCmPerKg,
  meterPurchaseCostCents,
  nextEstCmPerKg,
  piecePurchaseCostCents,
  weightPurchaseCostCents,
} from './purchase.js';

describe('buildRollsFromPurchase', () => {
  it('T1: Rosa assortment, 10 colours × 50 m at 16 dh/m → 10 rolls of 5000 cm costing 80000', () => {
    const colours = Array.from({ length: 10 }, (_, index) => ({
      variantId: `rosa-${String(index)}`,
      lengthCm: fromMeters(50),
    }));
    const purchase = buildRollsFromPurchase({
      method: 'meter',
      pricePerMeterCents: fromDirham(16),
      rolls: colours,
    });

    expect(purchase.rolls).toHaveLength(10);
    for (const roll of purchase.rolls) {
      expect(roll).toEqual({
        variantId: expect.stringMatching(/^rosa-/) as unknown,
        lengthCmInitial: 5000,
        costTotalCents: 80_000,
        lengthEstimated: false,
      });
    }
    expect(purchase.rolls.map((roll) => roll.variantId)).toEqual(colours.map((c) => c.variantId));
    expect(purchase.totalCostCents).toBe(800_000);
    expect(costPerMeterCents(80_000, 5000)).toBe(1600);
  });

  it('T2: Korean crepe, a 2.3 m piece for 100 dh → one 230 cm roll costing 10000 (≈ 43.478 dh/m)', () => {
    const purchase = buildRollsFromPurchase({
      method: 'piece',
      variantId: 'crepe',
      lengthCm: fromMeters(2.3),
      totalCostCents: fromDirham(100),
    });
    expect(purchase).toEqual({
      method: 'piece',
      totalCostCents: 10_000,
      rolls: [
        {
          variantId: 'crepe',
          lengthCmInitial: 230,
          costTotalCents: 10_000,
          lengthEstimated: false,
        },
      ],
    });
    expect(costPerMeterCents(10_000, 230)).toBe(4348);
  });

  it('T4: 20 kg for 400 dh with est_cm_per_kg = 400 → estimated 8000 cm', () => {
    const purchase = buildRollsFromPurchase({
      method: 'kg',
      variantId: 'jersey',
      weightG: 20_000,
      totalCostCents: fromDirham(400),
      estCmPerKg: 400,
    });
    expect(purchase).toEqual({
      method: 'kg',
      totalCostCents: 40_000,
      rolls: [
        {
          variantId: 'jersey',
          lengthCmInitial: 8000,
          costTotalCents: 40_000,
          lengthEstimated: true,
          weightG: 20_000,
        },
      ],
    });
  });

  it('rounds a non-exact metre cost half up: 16.05 dh/m × 2.75 m = 44.1375 dh → 4414', () => {
    const purchase = buildRollsFromPurchase({
      method: 'meter',
      pricePerMeterCents: 1605,
      rolls: [{ variantId: 'a', lengthCm: 275 }],
    });
    expect(purchase.rolls[0]?.costTotalCents).toBe(4414);
  });

  it('sums rolls of different lengths into the purchase total', () => {
    const purchase = buildRollsFromPurchase({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [
        { variantId: 'a', lengthCm: 5000 },
        { variantId: 'b', lengthCm: 4250 },
        { variantId: 'c', lengthCm: 1 },
      ],
    });
    expect(purchase.rolls.map((roll) => roll.costTotalCents)).toEqual([80_000, 68_000, 16]);
    expect(purchase.totalCostCents).toBe(148_016);
  });

  it('rounds the kg estimate half up: 1.5 kg × 333 cm/kg = 499.5 → 500 cm', () => {
    const purchase = buildRollsFromPurchase({
      method: 'kg',
      variantId: 'a',
      weightG: 1500,
      totalCostCents: 3000,
      estCmPerKg: 333,
    });
    expect(purchase.rolls[0]?.lengthCmInitial).toBe(500);
  });

  it('allows a zero cost (a sample or a gift)', () => {
    const purchase = buildRollsFromPurchase({
      method: 'piece',
      variantId: 'gift',
      lengthCm: 100,
      totalCostCents: 0,
    });
    expect(purchase.totalCostCents).toBe(0);
  });

  it.each([
    [{ method: 'meter', pricePerMeterCents: 1600, rolls: [] }, 'at least one roll'],
    [{ method: 'meter', pricePerMeterCents: -1, rolls: [{ variantId: 'a', lengthCm: 1 }] }, '>= 0'],
    [
      { method: 'meter', pricePerMeterCents: 16.5, rolls: [{ variantId: 'a', lengthCm: 1 }] },
      'safe integer',
    ],
    [
      { method: 'meter', pricePerMeterCents: 1600, rolls: [{ variantId: 'a', lengthCm: 0 }] },
      '>= 1',
    ],
    [{ method: 'piece', variantId: 'a', lengthCm: 230, totalCostCents: -100 }, '>= 0'],
    [{ method: 'piece', variantId: 'a', lengthCm: 2.3, totalCostCents: 10_000 }, 'safe integer'],
    [{ method: 'kg', variantId: 'a', weightG: 0, totalCostCents: 1, estCmPerKg: 400 }, '>= 1'],
    [{ method: 'kg', variantId: 'a', weightG: 1000, totalCostCents: 1, estCmPerKg: 0 }, '>= 1'],
    [
      { method: 'kg', variantId: 'a', weightG: 1, totalCostCents: 1, estCmPerKg: 400 },
      'rounds to 0 cm',
    ],
  ] as const)('rejects %j', (input, message) => {
    expect(() => buildRollsFromPurchase(input)).toThrow(message);
  });
});

describe('meterPurchaseCostCents (SPEC §2.3)', () => {
  it('T1: 50 m at 16 dh/m costs 800 dh', () => {
    expect(meterPurchaseCostCents(fromDirham(16), fromMeters(50))).toBe(80_000);
  });

  it('rounds half up: 16.05 dh/m × 2.75 m = 44.1375 dh → 4414 cents', () => {
    expect(meterPurchaseCostCents(1605, 275)).toBe(4414);
  });

  it('rounds an exact half cent up: 1 cent/m × 0.5 m → 1 cent, 1 cent/m × 0.49 m → 0', () => {
    expect(meterPurchaseCostCents(1, 50)).toBe(1);
    expect(meterPurchaseCostCents(1, 49)).toBe(0);
  });

  it('costs nothing at a zero price (a sample or a gift)', () => {
    expect(meterPurchaseCostCents(0, 250)).toBe(0);
  });

  it('rejects a negative or fractional price and a length under 1 cm', () => {
    expect(() => meterPurchaseCostCents(-1, 100)).toThrow(RangeError);
    expect(() => meterPurchaseCostCents(1.5, 100)).toThrow(RangeError);
    expect(() => meterPurchaseCostCents(1600, 0)).toThrow(RangeError);
    expect(() => meterPurchaseCostCents(1600, 2.5)).toThrow(RangeError);
  });

  it('is within half a cent of the exact product, and exact on whole metres', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (price, lengthCm) => {
          const cost = meterPurchaseCostCents(price, lengthCm);
          // 100 × cost is within 50 of price × length: half a cent either way.
          expect(Math.abs(100 * cost - price * lengthCm)).toBeLessThanOrEqual(50);
          expect(meterPurchaseCostCents(price, lengthCm * 100)).toBe(price * lengthCm);
        },
      ),
    );
  });

  it('agrees with a metre purchase of the same length', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (price, lengthCm) => {
          const purchase = buildRollsFromPurchase({
            method: 'meter',
            pricePerMeterCents: price,
            rolls: [{ variantId: 'a', lengthCm }],
          });
          expect(purchase.totalCostCents).toBe(meterPurchaseCostCents(price, lengthCm));
        },
      ),
    );
  });
});

describe('est_cm_per_kg after a measurement (SPEC §2.3)', () => {
  it('T4: 7600 cm measured on a 20 kg roll → 380 cm/kg', () => {
    expect(measuredCmPerKg(7600, 20_000)).toBe(380);
  });

  it('rounds half up', () => {
    expect(measuredCmPerKg(1001, 2000)).toBe(501); // 500.5
  });

  it('"last" policy takes the new measurement', () => {
    expect(
      nextEstCmPerKg({ policy: 'last', current: 400, measurementsSoFar: 3, measured: 380 }),
    ).toBe(380);
  });

  it('"average" policy keeps a running mean of measurements', () => {
    expect(
      nextEstCmPerKg({ policy: 'average', current: 400, measurementsSoFar: 1, measured: 380 }),
    ).toBe(390);
    expect(
      nextEstCmPerKg({ policy: 'average', current: 390, measurementsSoFar: 2, measured: 381 }),
    ).toBe(387); // (780 + 381) / 3 = 387
    expect(
      nextEstCmPerKg({ policy: 'average', current: 400, measurementsSoFar: 1, measured: 381 }),
    ).toBe(391); // 390.5 half up
  });

  it('the first measurement replaces the initial guess under either policy', () => {
    expect(
      nextEstCmPerKg({ policy: 'average', current: 400, measurementsSoFar: 0, measured: 380 }),
    ).toBe(380);
  });

  it('rejects invalid input', () => {
    expect(() => measuredCmPerKg(7600, 0)).toThrow(RangeError);
    expect(() =>
      nextEstCmPerKg({ policy: 'average', current: 400, measurementsSoFar: -1, measured: 380 }),
    ).toThrow(RangeError);
  });
});

describe('renewal cost (SPEC §8.5)', () => {
  const rosa = [
    { costTotalCents: 80_000, lengthCm: 5000 },
    { costTotalCents: 80_000, lengthCm: 5000 },
  ];

  it('averages a batch per metre', () => {
    expect(averageCostPerMeterCents(rosa)).toBe(1600);
    expect(averageCostPerMeterCents([{ costTotalCents: 10_000, lengthCm: 230 }])).toBe(4348); // T2
  });

  it('warns only when the new batch costs more per metre, compared exactly', () => {
    expect(isRenewalCostHigher(rosa, [{ costTotalCents: 85_000, lengthCm: 5000 }])).toBe(true);
    expect(isRenewalCostHigher(rosa, [{ costTotalCents: 80_000, lengthCm: 5000 }])).toBe(false);
    expect(isRenewalCostHigher(rosa, [{ costTotalCents: 75_000, lengthCm: 5000 }])).toBe(false);
    // 43.478… vs 43.48: equal once rounded, but the new piece is a fraction dearer.
    expect(
      isRenewalCostHigher(
        [{ costTotalCents: 10_000, lengthCm: 230 }],
        [{ costTotalCents: 4348, lengthCm: 100 }],
      ),
    ).toBe(true);
  });

  it('rejects an empty batch and invalid amounts', () => {
    expect(() => averageCostPerMeterCents([])).toThrow('at least one roll');
    expect(() => isRenewalCostHigher(rosa, [{ costTotalCents: 1, lengthCm: 0 }])).toThrow(
      RangeError,
    );
  });
});

describe('weightPurchaseCostCents (PB21)', () => {
  it('20 kg at 400 dh/kg costs 8,000 dh', () => {
    expect(weightPurchaseCostCents(fromDirham(400), 20_000)).toBe(800_000);
  });

  it('rounds half up: 38.50 dh/kg × 2.345 kg = 90.2825 dh → 9028 cents', () => {
    expect(weightPurchaseCostCents(3850, 2345)).toBe(9028);
  });

  it('rounds an exact half cent up: 1 cent/kg × 0.5 kg → 1 cent, × 0.499 kg → 0', () => {
    expect(weightPurchaseCostCents(1, 500)).toBe(1);
    expect(weightPurchaseCostCents(1, 499)).toBe(0);
  });

  it('costs nothing at a zero price, and rejects a bad price or a weight under 1 g', () => {
    expect(weightPurchaseCostCents(0, 500)).toBe(0);
    expect(() => weightPurchaseCostCents(-1, 1000)).toThrow(RangeError);
    expect(() => weightPurchaseCostCents(1.5, 1000)).toThrow(RangeError);
    expect(() => weightPurchaseCostCents(1000, 0)).toThrow(RangeError);
    expect(() => weightPurchaseCostCents(1000, 2.5)).toThrow(RangeError);
  });

  it('is within half a cent of the exact product, and exact on whole kilos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (price, weightG) => {
          const cost = weightPurchaseCostCents(price, weightG);
          expect(Math.abs(1000 * cost - price * weightG)).toBeLessThanOrEqual(500);
          expect(weightPurchaseCostCents(price, weightG * 1000)).toBe(price * weightG);
        },
      ),
    );
  });
});

describe('piecePurchaseCostCents (PB21)', () => {
  it('10 pieces at 100 dh each cost 1,000 dh', () => {
    expect(piecePurchaseCostCents(fromDirham(100), 10)).toBe(100_000);
  });

  it('is exact: the price in cents times the pieces, never rounded', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (price, pieces) => {
          expect(piecePurchaseCostCents(price, pieces)).toBe(price * pieces);
        },
      ),
    );
  });

  it('rejects a negative or fractional price and fewer than one whole piece', () => {
    expect(() => piecePurchaseCostCents(-1, 3)).toThrow(RangeError);
    expect(() => piecePurchaseCostCents(1.5, 3)).toThrow(RangeError);
    expect(() => piecePurchaseCostCents(1000, 0)).toThrow(RangeError);
    expect(() => piecePurchaseCostCents(1000, 1.5)).toThrow(RangeError);
  });
});
