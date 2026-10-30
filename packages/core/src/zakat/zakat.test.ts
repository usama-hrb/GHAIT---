import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import {
  computeZakat,
  DEFAULT_ZAKAT_SETTINGS,
  NISAB_GRAMS,
  type ZakatSettings,
  type ZakatSnapshot,
} from './index.js';

const dh = fromDirham;

/**
 * T14: stock at market price 30,000 dh + cash 5,000 + expected debts 2,000 − debts owed 1,000
 * = 36,000 × 2.5% = 900 dh. T14 assumes the nisab is reached: the gold price here (300 dh/g,
 * nisab 25,500 dh) makes it so.
 */
const T14: ZakatSnapshot = {
  hawlCompleted: true,
  goods: [
    {
      rollId: 'R-0001',
      remainingCm: 100_000,
      refPricePerMeterCents: dh(20),
      costCents: dh(16_000),
    },
    { rollId: 'R-0002', remainingCm: 50_000, refPricePerMeterCents: dh(20), costCents: dh(8000) },
  ],
  cashCents: dh(5000),
  receivables: [
    { customerId: 'c1', amountCents: dh(1500), doubtful: false },
    { customerId: 'c2', amountCents: dh(500), doubtful: false },
    { customerId: 'c3', amountCents: dh(400), doubtful: true },
  ],
  debtsDueCents: dh(1000),
  goldPricePerGramCents: dh(300),
};

const settings = (overrides: Partial<ZakatSettings>): ZakatSettings => ({
  ...DEFAULT_ZAKAT_SETTINGS,
  ...overrides,
});

describe('computeZakat (SPEC §10)', () => {
  it('T14: base 36,000 dh → 900 dh', () => {
    expect(computeZakat(T14)).toEqual({
      goods: [
        { rollId: 'R-0001', valueCents: dh(20_000) },
        { rollId: 'R-0002', valueCents: dh(10_000) },
      ],
      goodsCents: dh(30_000),
      cashCents: dh(5000),
      receivablesCents: dh(2000),
      doubtfulReceivablesCents: dh(400),
      debtsDueCents: dh(1000),
      baseCents: dh(36_000),
      nisabCents: dh(25_500),
      reachesNisab: true,
      hawlCompleted: true,
      zakatDueCents: dh(900),
      settings: DEFAULT_ZAKAT_SETTINGS,
    });
  });

  it('valuation at cost instead of the selling price: base 30,000 → 750 dh', () => {
    expect(computeZakat(T14, settings({ goodsValuation: 'cost' }))).toMatchObject({
      goodsCents: dh(24_000),
      baseCents: dh(30_000),
      zakatDueCents: dh(750),
    });
  });

  it('doubtful debts are excluded by default and counted only if the owner says so', () => {
    expect(computeZakat(T14, settings({ includeDoubtfulDebts: true }))).toMatchObject({
      receivablesCents: dh(2400),
      doubtfulReceivablesCents: dh(400),
      baseCents: dh(36_400),
      zakatDueCents: dh(910),
    });
  });

  it('silver nisab: under the gold nisab at 1,000 dh/g, but over the silver one at 10 dh/g', () => {
    const snapshot = { ...T14, goldPricePerGramCents: dh(1000), silverPricePerGramCents: dh(10) };
    expect(computeZakat(snapshot)).toMatchObject({
      nisabCents: dh(85_000),
      reachesNisab: false,
      zakatDueCents: 0,
    });
    expect(computeZakat(snapshot, settings({ nisabMetal: 'silver' }))).toMatchObject({
      nisabCents: dh(5950),
      reachesNisab: true,
      zakatDueCents: dh(900),
    });
    expect(NISAB_GRAMS).toEqual({ gold: 85, silver: 595 });
  });

  it('nothing is due before the hawl, even above the nisab', () => {
    expect(computeZakat({ ...T14, hawlCompleted: false })).toMatchObject({
      baseCents: dh(36_000),
      reachesNisab: true,
      zakatDueCents: 0,
    });
  });

  it('a base exactly at the nisab reaches it; one cent under does not', () => {
    const cashOnly = (cashCents: number) =>
      computeZakat({
        hawlCompleted: true,
        goods: [],
        cashCents,
        receivables: [],
        debtsDueCents: 0,
        goldPricePerGramCents: dh(100),
      });
    expect(cashOnly(dh(8500))).toMatchObject({ nisabCents: dh(8500), reachesNisab: true });
    expect(cashOnly(dh(8500) - 1)).toMatchObject({ reachesNisab: false, zakatDueCents: 0 });
  });

  it('debts larger than the assets: negative base, nothing due', () => {
    expect(computeZakat({ ...T14, debtsDueCents: dh(40_000) })).toMatchObject({
      baseCents: dh(-3000),
      reachesNisab: false,
      zakatDueCents: 0,
    });
  });

  it('rounds the zakat half up to the cent', () => {
    const only = (cashCents: number) =>
      computeZakat({
        hawlCompleted: true,
        goods: [],
        cashCents,
        receivables: [],
        debtsDueCents: 0,
        goldPricePerGramCents: 1,
      }).zakatDueCents;
    expect(only(3_600_001)).toBe(90_000); // 90000.025
    expect(only(3_600_020)).toBe(90_001); // 90000.5
    expect(only(3_600_019)).toBe(90_000); // 90000.475
  });

  it('values a partly sold roll at market price per cm, rounded half up', () => {
    const result = computeZakat({
      ...T14,
      goods: [{ rollId: 'R-0003', remainingCm: 255, refPricePerMeterCents: 1805, costCents: 4000 }],
    });
    expect(result.goods).toEqual([{ rollId: 'R-0003', valueCents: 4603 }]); // 46.0275 dh
  });

  it.each([
    [{ cashCents: -1 }, 'cashCents must be >= 0'],
    [{ debtsDueCents: -1 }, 'debtsDueCents must be >= 0'],
    [
      { goods: [{ rollId: 'R-1', remainingCm: -1, refPricePerMeterCents: 1, costCents: 0 }] },
      'remainingCm of R-1 must be >= 0',
    ],
    [
      { goods: [{ rollId: 'R-1', remainingCm: 1, refPricePerMeterCents: -1, costCents: 0 }] },
      'refPricePerMeterCents of R-1 must be >= 0',
    ],
    [
      { goods: [{ rollId: 'R-1', remainingCm: 1, refPricePerMeterCents: 1, costCents: -1 }] },
      'costCents of R-1 must be >= 0',
    ],
    [
      { receivables: [{ customerId: 'c9', amountCents: 0, doubtful: false }] },
      'receivable of c9 must be >= 1',
    ],
    [{ goldPricePerGramCents: undefined }, 'a gold price is needed for the nisab'],
    [{ goldPricePerGramCents: 0 }, 'goldPricePerGramCents must be >= 1'],
  ] satisfies [Partial<ZakatSnapshot>, string][])('rejects %j', (overrides, message) => {
    expect(() => computeZakat({ ...T14, ...overrides })).toThrow(message);
  });

  it('needs a silver price when the nisab is in silver', () => {
    expect(() => computeZakat(T14, settings({ nisabMetal: 'silver' }))).toThrow(
      'a silver price is needed for the nisab',
    );
  });

  it('property: zakat is 2.5% of the base (half up) exactly when due, else 0', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000_000 }),
        fc.nat({ max: 1_000_000_000 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 2_000_000 }),
        (cashCents, debtsDueCents, hawlCompleted, gold) => {
          const result = computeZakat({
            hawlCompleted,
            goods: [],
            cashCents,
            receivables: [],
            debtsDueCents,
            goldPricePerGramCents: gold,
          });
          const due = hawlCompleted && result.baseCents >= gold * 85;
          expect(result.zakatDueCents).toBe(due ? Math.floor((result.baseCents + 20) / 40) : 0);
        },
      ),
    );
  });
});
