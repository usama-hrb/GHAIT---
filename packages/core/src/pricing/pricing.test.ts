import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { splitSaleCapitalProfit } from '../payments/index.js';
import {
  computeBatchSaleLine,
  computeSaleLine,
  isBelowMinimum,
  type SaleLineInput,
} from './index.js';

// Rosa at 16 dh/m: a 50 m roll (SPEC T1) costs 80000; 100 m costs 160000.
const rosaRoll = (lengthCm: number) => ({
  costTotalCents: lengthCm * 16,
  basisLengthCm: lengthCm,
  remainingCm: lengthCm,
});

function line(overrides: Partial<SaleLineInput>): SaleLineInput {
  return {
    roll: rosaRoll(5000),
    soldCm: 100,
    price: { perMeterCents: fromDirham(20) },
    refPricePerMeterCents: fromDirham(20),
    minPricePerMeterCents: fromDirham(17),
    previousCostsCents: [],
    ...overrides,
  };
}

describe('computeSaleLine (SPEC §3)', () => {
  it('T5: 100 m of Rosa (cost 16 dh/m), reference 20, sold at 18 → capital 1600 dh, profit 200 dh', () => {
    const sold = computeSaleLine(
      line({
        roll: rosaRoll(10_000),
        soldCm: 10_000,
        price: { perMeterCents: fromDirham(18) },
      }),
    );
    expect(sold).toMatchObject({
      actualPricePerMeterCents: 1800,
      refPricePerMeterCents: 2000,
      lineTotalCents: 180_000,
      lineCostCents: 160_000,
      profitCents: 20_000,
      warnings: [],
      requiresConfirmation: false,
    });
    const split = splitSaleCapitalProfit({ lines: [sold] });
    expect(split).toMatchObject({ capitalCents: 160_000, profitCents: 20_000 });
  });

  it('T5 across two 50 m rolls (the line split over rolls, SPEC §4) gives the same parts', () => {
    const lines = [0, 1].map(() =>
      computeSaleLine(line({ soldCm: 5000, price: { perMeterCents: fromDirham(18) } })),
    );
    expect(splitSaleCapitalProfit({ lines })).toMatchObject({
      capitalCents: 160_000,
      profitCents: 20_000,
    });
  });

  it('T11: a roll at 16 dh/m sold at 14 → warning + explicit confirmation; 2 dh/m is a loss', () => {
    const sold = computeSaleLine(line({ soldCm: 1000, price: { perMeterCents: fromDirham(14) } }));
    expect(sold).toMatchObject({
      lineTotalCents: 14_000,
      lineCostCents: 16_000,
      profitCents: -2000, // 2 dh/m × 10 m
      warnings: ['below_min_price', 'below_cost'],
      requiresConfirmation: true,
    });
    expect(splitSaleCapitalProfit({ lines: [sold] })).toMatchObject({
      lossCents: 2000,
      belowCost: true,
    });
  });

  it('under the minimum but above cost: warning only, no confirmation', () => {
    const sold = computeSaleLine(line({ price: { perMeterCents: fromDirham(16.5) } }));
    expect(sold).toMatchObject({ warnings: ['below_min_price'], requiresConfirmation: false });
  });

  it('at exactly the cost: profit 0, no below-cost warning (zero-profit sale)', () => {
    const sold = computeSaleLine(
      line({ price: { perMeterCents: fromDirham(16) }, minPricePerMeterCents: 0 }),
    );
    expect(sold).toMatchObject({ profitCents: 0, warnings: [], requiresConfirmation: false });
  });

  it('rounds a non-exact line total half up: 18.05 dh/m × 2.55 m = 46.0275 dh → 4603', () => {
    expect(
      computeSaleLine(line({ soldCm: 255, price: { perMeterCents: 1805 } })).lineTotalCents,
    ).toBe(4603);
  });

  it('uses the roll cost allocation: the crepe piece (T2) sells 100 cm at 4348 cost', () => {
    const crepe = { costTotalCents: 10_000, basisLengthCm: 230, remainingCm: 230 };
    const sold = computeSaleLine(
      line({
        roll: crepe,
        soldCm: 100,
        price: { perMeterCents: fromDirham(50) },
        minPricePerMeterCents: 0,
      }),
    );
    expect(sold).toMatchObject({ lineTotalCents: 5000, lineCostCents: 4348, profitCents: 652 });
  });

  it('passes the costing flags through (provisional, exhausted, oversold)', () => {
    const sold = computeSaleLine(
      line({ roll: { ...rosaRoll(5000), remainingCm: 50, lengthEstimated: true }, soldCm: 80 }),
    );
    expect(sold.costing).toMatchObject({ exhaustsRoll: true, oversoldCm: 30, provisional: true });
  });

  describe('whole piece (sellable_as_piece, SPEC §2.3)', () => {
    const crepe = { costTotalCents: 10_000, basisLengthCm: 230, remainingCm: 230 };

    it('sells the whole length at the piece price; per-metre price is derived', () => {
      const sold = computeSaleLine(
        line({
          roll: crepe,
          soldCm: 230,
          price: { wholePieceCents: fromDirham(120) },
          minPricePerMeterCents: fromDirham(45),
        }),
      );
      expect(sold).toMatchObject({
        lineTotalCents: 12_000,
        lineCostCents: 10_000,
        profitCents: 2000,
        actualPricePerMeterCents: 5217, // 120 / 2.3 = 52.17 dh/m
        warnings: [],
      });
    });

    it('compares the piece price with the minimum for its length exactly', () => {
      // minimum 52.18 dh/m × 2.3 m = 120.014 dh > 120 dh → below the minimum
      const sold = computeSaleLine(
        line({
          roll: crepe,
          soldCm: 230,
          price: { wholePieceCents: 12_000 },
          minPricePerMeterCents: 5218,
        }),
      );
      expect(sold.warnings).toEqual(['below_min_price']);
    });

    it('rejects a whole-piece sale of part of the piece, or of a piece already cut', () => {
      expect(() =>
        computeSaleLine(line({ roll: crepe, soldCm: 100, price: { wholePieceCents: 12_000 } })),
      ).toThrow('whole, untouched piece');
      expect(() =>
        computeSaleLine(
          line({
            roll: { ...crepe, remainingCm: 130 },
            soldCm: 130,
            price: { wholePieceCents: 12_000 },
          }),
        ),
      ).toThrow('whole, untouched piece');
    });
  });

  it.each([
    [{ soldCm: 0 }, 'soldCm'],
    [{ price: { perMeterCents: -1 } }, 'perMeterCents'],
    [{ price: { perMeterCents: 18.5 } }, 'perMeterCents'],
    [{ price: { wholePieceCents: -1 } }, 'wholePieceCents'],
    [{ refPricePerMeterCents: -1 }, 'refPricePerMeterCents'],
    [{ minPricePerMeterCents: 1.5 }, 'minPricePerMeterCents'],
  ] as const)('rejects %j', (overrides, message) => {
    expect(() => computeSaleLine(line(overrides))).toThrow(message);
  });
});

describe('computeBatchSaleLine (ADR 0012)', () => {
  const line = (overrides: Partial<Parameters<typeof computeBatchSaleLine>[0]> = {}) =>
    computeBatchSaleLine({
      unit: 'meter',
      quantity: 275,
      price: { perUnitCents: 2000 },
      refPriceCents: 2000,
      minPriceCents: 1800,
      costCents: 3000,
      ...overrides,
    });

  it('prices a metre line by the metre, half up, and a piece line by the piece', () => {
    expect(line()).toMatchObject({
      lineTotalCents: 5500,
      profitCents: 2500,
      belowMin: false,
      warnings: [],
    });
    expect(line({ price: { perUnitCents: 1605 }, quantity: 275 }).lineTotalCents).toBe(4414);
    expect(
      line({ unit: 'piece', quantity: 3, price: { perUnitCents: 1000 }, costCents: 1500 }),
    ).toMatchObject({
      lineTotalCents: 3000,
      actualPriceCents: 1000,
      profitCents: 1500,
    });
  });

  it('under the minimum price is flagged, at the minimum is not', () => {
    expect(line({ price: { perUnitCents: 1799 } })).toMatchObject({
      belowMin: true,
      warnings: ['below_min_price'],
      requiresConfirmation: false,
    });
    expect(line({ price: { perUnitCents: 1800 } }).belowMin).toBe(false);
    expect(line({ minPriceCents: 0, price: { perUnitCents: 1 } }).belowMin).toBe(false);
    expect(
      line({ unit: 'piece', quantity: 1, minPriceCents: 800, price: { perUnitCents: 799 } })
        .belowMin,
    ).toBe(true);
  });

  it('under cost is separate from under the minimum: it needs an explicit confirmation', () => {
    const cheap = line({ price: { perUnitCents: 1000 }, minPriceCents: 0, costCents: 3000 });
    expect(cheap).toMatchObject({
      belowMin: false,
      requiresConfirmation: true,
      warnings: ['below_cost'],
    });
    const both = line({ price: { perUnitCents: 1000 }, costCents: 3000 });
    expect(both.warnings).toEqual(['below_min_price', 'below_cost']);
  });

  it('a ready piece sold whole takes the piece price, judged against the minimum for its length', () => {
    // 2.30 m at a minimum of 39 dh/m is 89.70 dh: 90 dh clears it.
    const whole = line({
      quantity: 230,
      price: { wholePieceCents: 9000 },
      minPriceCents: 3900,
      costCents: 7000,
    });
    expect(whole).toMatchObject({ lineTotalCents: 9000, actualPriceCents: 3913, belowMin: false });
    // At 40 dh/m the floor for the whole piece is exactly 92 dh.
    expect(
      line({ quantity: 230, price: { wholePieceCents: 9200 }, minPriceCents: 4000 }).belowMin,
    ).toBe(false);
    expect(
      line({ quantity: 230, price: { wholePieceCents: 9199 }, minPriceCents: 4000 }).belowMin,
    ).toBe(true);
    expect(() => line({ unit: 'piece', quantity: 1, price: { wholePieceCents: 100 } })).toThrow(
      'whole piece',
    );
  });
});

describe('isBelowMinimum (ADR 0012)', () => {
  it('judges a per-unit price against the minimum, 0 meaning none', () => {
    expect(
      isBelowMinimum({ quantity: 100, price: { perUnitCents: 199 }, minPriceCents: 200 }),
    ).toBe(true);
    expect(
      isBelowMinimum({ quantity: 100, price: { perUnitCents: 200 }, minPriceCents: 200 }),
    ).toBe(false);
    expect(isBelowMinimum({ quantity: 100, price: { perUnitCents: 0 }, minPriceCents: 0 })).toBe(
      false,
    );
    expect(
      isBelowMinimum({ quantity: 3, price: { perUnitCents: 4999 }, minPriceCents: 5000 }),
    ).toBe(true);
  });

  it('judges a whole piece against the minimum for its length, exactly', () => {
    // 2.30 m at 40 dh/m: the floor is 92 dh.
    const whole = (wholePieceCents: number) =>
      isBelowMinimum({ quantity: 230, price: { wholePieceCents }, minPriceCents: 4000 });
    expect(whole(9199)).toBe(true);
    expect(whole(9200)).toBe(false);
  });

  it('refuses non-integers and a zero quantity', () => {
    expect(() =>
      isBelowMinimum({ quantity: 0, price: { perUnitCents: 1 }, minPriceCents: 0 }),
    ).toThrow();
    expect(() =>
      isBelowMinimum({ quantity: 1, price: { perUnitCents: 1.5 }, minPriceCents: 0 }),
    ).toThrow();
  });
});
