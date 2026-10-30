import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { splitSaleCapitalProfit } from '../payments/index.js';
import { computeSaleLine, type SaleLineInput } from './index.js';

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
