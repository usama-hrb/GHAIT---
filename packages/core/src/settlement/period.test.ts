import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayAfter } from '../expenses/index.js';
import { fromDirham } from '../money/index.js';
import { computeSettlement } from './compute.js';
import { inPeriod, type PeriodRecords, periodResultOf, type PeriodSale } from './period.js';
import { DEFAULT_SPLIT_WEIGHTS } from './split-rule.js';

const dh = fromDirham;
const PARTNERS = [
  { partnerId: 'owner', ownershipBp: 5000, isOwner: true },
  { partnerId: 'partner', ownershipBp: 5000, isOwner: false },
];
const RULES = [{ effectiveFrom: '2000-01-01', ...DEFAULT_SPLIT_WEIGHTS }];
const OCTOBER = { after: '2026-09-30', end: '2026-10-31' };
const NOVEMBER = { after: '2026-10-31', end: '2026-11-30' };
const DECEMBER = { after: '2026-11-30', end: '2026-12-31' };

function records(overrides: Partial<PeriodRecords> = {}): PeriodRecords {
  return { sales: [], losses: [], expenses: [], cashAdjustments: [], ...overrides };
}

function sale(overrides: Partial<PeriodSale> = {}): PeriodSale {
  return {
    date: '2026-10-05',
    totalCents: dh(200),
    capitalCents: dh(160),
    allocations: [],
    writtenOffOn: null,
    ...overrides,
  };
}

function settle(bounds: { after: string | null; end: string }, data: PeriodRecords, carry = 0) {
  return computeSettlement({
    periodStart: bounds.after === null ? bounds.end : dayAfter(bounds.after),
    periodEnd: bounds.end,
    ...periodResultOf(data, bounds, carry),
    splitRules: RULES,
    partners: PARTNERS,
  });
}

describe('periodResultOf (SPEC §8.1, BUILD_PROMPTS 4.3)', () => {
  it('T6 + T10 from the records: cash sales 2000 dh costing 1600, expenses 100 → thirds of 300', () => {
    const data = records({
      sales: [
        sale({
          totalCents: dh(2000),
          capitalCents: dh(1600),
          allocations: [{ date: '2026-10-05', amountCents: dh(2000) }],
        }),
      ],
      expenses: [{ paidDate: '2026-10-10', amountCents: dh(100) }],
    });
    expect(periodResultOf(data, OCTOBER, 0)).toEqual({
      recognizedProfitCents: dh(400),
      returnsEffectCents: 0,
      recoveredBadDebtCents: 0,
      losses: { damageCents: 0, badDebtCents: 0, belowCostCents: 0 },
      expensesCents: dh(100),
      cashOverShortCents: 0,
      carriedDeficitInCents: 0,
    });
    const settlement = settle(OCTOBER, data);
    expect([
      settlement.ownerShareCents,
      settlement.partnerShareCents,
      settlement.shopShareCents,
    ]).toEqual([10_000, 10_000, 10_000]);
    expect(settlement.capitalMoves).toEqual([
      { partnerId: 'owner', type: 'retained_profit', amountCents: 5000 },
      { partnerId: 'partner', type: 'retained_profit', amountCents: 5000 },
    ]);
  });

  it('T7 from the records: a net of 100 dh → 3333 + 3333 + 3334', () => {
    const data = records({
      sales: [
        sale({
          totalCents: dh(500),
          capitalCents: dh(400),
          allocations: [{ date: '2026-10-05', amountCents: dh(500) }],
        }),
      ],
    });
    const settlement = settle(OCTOBER, data);
    expect([
      settlement.ownerShareCents,
      settlement.partnerShareCents,
      settlement.shopShareCents,
    ]).toEqual([3333, 3333, 3334]);
  });

  it('T9 from the records: a losing month carries its deficit into the next one', () => {
    const data = records({
      sales: [
        sale({
          totalCents: dh(250),
          capitalCents: dh(200),
          allocations: [{ date: '2026-10-05', amountCents: dh(250) }],
        }),
        sale({
          date: '2026-11-03',
          totalCents: dh(1500),
          capitalCents: dh(1200),
          allocations: [{ date: '2026-11-03', amountCents: dh(1500) }],
        }),
      ],
      expenses: [{ paidDate: '2026-10-20', amountCents: dh(150) }],
    });
    const october = settle(OCTOBER, data);
    expect(october).toMatchObject({ netProfitCents: dh(-100), carryDeficitOutCents: 10_000 });
    const november = settle(NOVEMBER, data, october.carryDeficitOutCents);
    expect(november).toMatchObject({ netProfitCents: dh(200), carriedDeficitInCents: 10_000 });
  });

  it('T8 across months: profit counts when it is paid, capital first', () => {
    const data = records({
      sales: [
        sale({
          date: '2026-10-20',
          allocations: [
            { date: '2026-10-20', amountCents: dh(100) },
            { date: '2026-11-05', amountCents: dh(100) },
          ],
        }),
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0).recognizedProfitCents).toBe(0);
    expect(periodResultOf(data, NOVEMBER, 0).recognizedProfitCents).toBe(dh(40));
  });

  it('S5: a bad debt loses its unrecovered capital; what is recovered later is a gain, then profit', () => {
    const data = records({
      sales: [
        sale({
          allocations: [
            { date: '2026-10-05', amountCents: dh(100) },
            { date: '2026-12-10', amountCents: dh(100) },
          ],
          writtenOffOn: '2026-11-03',
        }),
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
      recognizedProfitCents: 0,
      losses: { badDebtCents: 0 },
    });
    expect(periodResultOf(data, NOVEMBER, 0).losses.badDebtCents).toBe(dh(60));
    expect(periodResultOf(data, DECEMBER, 0)).toMatchObject({
      recoveredBadDebtCents: dh(60),
      recognizedProfitCents: dh(40),
    });
  });

  it('S5: a payment dated the day of the write-off counts before it (a smaller loss)', () => {
    const data = records({
      sales: [
        sale({
          allocations: [
            { date: '2026-10-05', amountCents: dh(100) },
            { date: '2026-10-20', amountCents: dh(30) },
          ],
          writtenOffOn: '2026-10-20',
        }),
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
      recoveredBadDebtCents: 0,
      losses: { badDebtCents: dh(30) },
    });
  });

  it('a written-off invoice whose capital was all recovered loses nothing (its profit was never counted)', () => {
    const data = records({
      sales: [
        sale({
          allocations: [{ date: '2026-10-05', amountCents: dh(170) }],
          writtenOffOn: '2026-10-25',
        }),
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
      recognizedProfitCents: dh(10),
      losses: { badDebtCents: 0 },
    });
  });

  it('T11: a below-cost invoice loses its negative part in the month it is sold, paid or not', () => {
    const data = records({
      sales: [
        sale({
          totalCents: dh(140),
          allocations: [{ date: '2026-11-02', amountCents: dh(140) }],
        }),
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0).losses.belowCostCents).toBe(dh(20));
    expect(periodResultOf(data, NOVEMBER, 0)).toMatchObject({
      recognizedProfitCents: 0,
      losses: { belowCostCents: 0 },
    });
  });

  it('T12: damage at cost, an expense by its paid date (S6), cash counts signed (I2)', () => {
    const data = records({
      losses: [
        { date: '2026-10-12', costCents: 480 },
        { date: '2026-11-01', costCents: 100 },
      ],
      expenses: [
        { paidDate: '2026-10-31', amountCents: dh(50) },
        { paidDate: '2026-11-02', amountCents: dh(70) },
        { paidDate: null, amountCents: dh(999) },
      ],
      cashAdjustments: [
        { date: '2026-10-15', diffCents: -300 },
        { date: '2026-10-16', diffCents: 100 },
        { date: '2026-11-15', diffCents: 9 },
      ],
    });
    expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
      losses: { damageCents: 480 },
      expensesCents: dh(50),
      cashOverShortCents: -200,
    });
  });

  describe('returns (RT4)', () => {
    // 200 dh of cloth that cost 160, paid in full in October.
    const paidInOctober = sale({ allocations: [{ date: '2026-10-05', amountCents: dh(200) }] });

    it('reverse the profit recognised on what comes back, on the day of the return', () => {
      // Half back in November: 100 dh credited, 80 dh of cost back on the roll.
      const data = records({
        sales: [
          {
            ...paidInOctober,
            returns: [{ date: '2026-11-10', creditCents: dh(100), costCents: dh(80), after: 1 }],
          },
        ],
      });
      expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
        recognizedProfitCents: dh(40),
        returnsEffectCents: 0,
      });
      // The kept half is worth 100 and cost 80, fully paid: 20 of profit instead of 40.
      expect(periodResultOf(data, NOVEMBER, 0)).toMatchObject({
        recognizedProfitCents: 0,
        returnsEffectCents: -dh(20),
      });
    });

    it('a return in the same period only lowers that period’s profit', () => {
      const data = records({
        sales: [
          {
            ...paidInOctober,
            returns: [{ date: '2026-10-20', creditCents: dh(200), costCents: dh(160), after: 1 }],
          },
        ],
      });
      const october = periodResultOf(data, OCTOBER, 0);
      expect(october.recognizedProfitCents + october.returnsEffectCents).toBe(0);
    });

    it('on a credit sale, only the debt is reduced: nothing was recognised to reverse', () => {
      const data = records({
        sales: [
          {
            ...sale(),
            returns: [{ date: '2026-10-20', creditCents: dh(100), costCents: dh(80), after: 0 }],
          },
        ],
      });
      expect(periodResultOf(data, OCTOBER, 0)).toMatchObject({
        recognizedProfitCents: 0,
        returnsEffectCents: 0,
      });
    });

    it('a payment after the return is recognised on the invoice as it then is', () => {
      // 100 dh back first (invoice now 100 dh, cost 80); then 100 dh paid: capital 80, profit 20.
      const data = records({
        sales: [
          {
            ...sale({ allocations: [{ date: '2026-11-15', amountCents: dh(100) }] }),
            returns: [{ date: '2026-10-20', creditCents: dh(100), costCents: dh(80), after: 0 }],
          },
        ],
      });
      expect(periodResultOf(data, NOVEMBER, 0)).toMatchObject({ recognizedProfitCents: dh(20) });
    });

    it('a below-cost invoice’s loss shrinks with the goods that come back', () => {
      // Sold 100 dh of cloth that cost 160: a 60 dh loss. Half back: the kept half lost 30.
      const data = records({
        sales: [
          {
            ...sale({ totalCents: dh(100), capitalCents: dh(160) }),
            returns: [{ date: '2026-11-02', creditCents: dh(50), costCents: dh(80), after: 0 }],
          },
        ],
      });
      expect(periodResultOf(data, OCTOBER, 0).losses.belowCostCents).toBe(dh(60));
      expect(periodResultOf(data, NOVEMBER, 0)).toMatchObject({ returnsEffectCents: dh(30) });
    });

    it('a debt written off after a return loses only what is left of the capital', () => {
      // Paid 30 of 200 (capital 160); half back (100 dh, cost 80); then the rest written off.
      const data = records({
        sales: [
          {
            ...sale({
              allocations: [{ date: '2026-10-06', amountCents: dh(30) }],
              writtenOffOn: '2026-10-30',
            }),
            returns: [{ date: '2026-10-10', creditCents: dh(100), costCents: dh(80), after: 1 }],
          },
        ],
      });
      // Collectible capital now 80, 30 recovered: 50 lost.
      expect(periodResultOf(data, OCTOBER, 0).losses.badDebtCents).toBe(dh(50));
    });

    it('property: splitting time never changes what returns add up to', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000 }),
          fc.integer({ min: 0, max: 100_000 }),
          fc.integer({ min: 0, max: 150_000 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.integer({ min: 0, max: 1 }),
          (total, capital, paid, fraction, after) => {
            const credit = Math.floor(total * fraction);
            const cost = Math.floor(capital * fraction);
            const allocations = paid > 0 ? [{ date: '2026-10-05', amountCents: paid }] : [];
            const data = records({
              sales: [
                {
                  date: '2026-10-01',
                  totalCents: total,
                  capitalCents: capital,
                  allocations,
                  writtenOffOn: null,
                  returns: [
                    {
                      date: '2026-11-10',
                      creditCents: credit,
                      costCents: cost,
                      after: Math.min(after, allocations.length),
                    },
                  ],
                },
              ],
            });
            const whole = periodResultOf(data, { after: null, end: '2026-12-31' }, 0);
            const october = periodResultOf(data, { after: null, end: '2026-10-31' }, 0);
            const rest = periodResultOf(data, { after: '2026-10-31', end: '2026-12-31' }, 0);
            expect(october.returnsEffectCents + rest.returnsEffectCents).toBe(
              whole.returnsEffectCents,
            );
            expect(october.recognizedProfitCents + rest.recognizedProfitCents).toBe(
              whole.recognizedProfitCents,
            );
            // Over the invoice's life: the profit it recognises, whenever it is booked, is that of the
            // invoice as it ends up (capital first), less its below-cost loss.
            const ends = { totalCents: total - credit, capitalCents: capital - cost };
            const recognised =
              Math.min(paid, ends.totalCents) -
              Math.min(paid, Math.min(ends.capitalCents, ends.totalCents));
            const loss = Math.max(0, ends.capitalCents - ends.totalCents);
            const initialLoss = Math.max(0, capital - total);
            expect(
              whole.recognizedProfitCents + whole.returnsEffectCents - whole.losses.belowCostCents,
            ).toBe(recognised - loss);
            expect(whole.losses.belowCostCents).toBe(initialLoss);
          },
        ),
      );
    });
  });

  it('the first period takes everything up to its end; later ones start the day after the last', () => {
    const data = records({ losses: [{ date: '2024-03-01', costCents: 7 }] });
    expect(periodResultOf(data, { after: null, end: '2026-10-31' }, 0).losses.damageCents).toBe(7);
    expect(periodResultOf(data, OCTOBER, 0).losses.damageCents).toBe(0);
    expect(inPeriod('2026-10-31', OCTOBER)).toBe(true);
    expect(inPeriod('2026-09-30', OCTOBER)).toBe(false);
    expect(inPeriod('2026-11-01', OCTOBER)).toBe(false);
  });

  it.each([
    [{ after: null, end: '2026-10-1' }, 'end must be a YYYY-MM-DD date'],
    [{ after: '2026-9-30', end: '2026-10-31' }, 'after must be a YYYY-MM-DD date'],
    [
      { after: '2026-10-31', end: '2026-10-31' },
      'period ends (2026-10-31) on or before 2026-10-31',
    ],
  ])('rejects the bounds %j', (bounds, message) => {
    expect(() => periodResultOf(records(), bounds, 0)).toThrow(message);
  });

  it.each([
    [records({ sales: [sale({ date: '5 Oct' })] }), 'sale date must be a YYYY-MM-DD date'],
    [
      records({ sales: [sale({ allocations: [{ date: 'x', amountCents: 1 }] })] }),
      'allocation date must be a YYYY-MM-DD date',
    ],
    [records({ sales: [sale({ writtenOffOn: 'x' })] }), 'write-off date must be a YYYY-MM-DD date'],
    [records({ losses: [{ date: 'x', costCents: 1 }] }), 'loss date must be a YYYY-MM-DD date'],
    [records({ losses: [{ date: '2026-10-01', costCents: -1 }] }), 'loss costCents must be >= 0'],
    [
      records({ expenses: [{ paidDate: '2026-10-01', amountCents: -1 }] }),
      'expense amountCents must be >= 0',
    ],
    [
      records({ expenses: [{ paidDate: 'x', amountCents: 1 }] }),
      'expense paidDate must be a YYYY-MM-DD date',
    ],
    [
      records({ cashAdjustments: [{ date: 'x', diffCents: 1 }] }),
      'cash count date must be a YYYY-MM-DD date',
    ],
    [
      records({ cashAdjustments: [{ date: '2026-10-01', diffCents: 0.5 }] }),
      'cash count diffCents must be a safe integer',
    ],
  ])('rejects invalid records (%#)', (data, message) => {
    expect(() => periodResultOf(data, OCTOBER, 0)).toThrow(message);
  });

  it('rejects a negative carried deficit', () => {
    expect(() => periodResultOf(records(), OCTOBER, -1)).toThrow(
      'carriedDeficitInCents must be >= 0',
    );
  });

  // Any day of 2026, as YYYY-MM-DD.
  const day = fc
    .integer({ min: 0, max: 364 })
    .map((n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10));
  const amount = fc.integer({ min: 1, max: 1_000_000 });
  const anySale = fc
    .record({
      date: day,
      totalCents: fc.integer({ min: 0, max: 1_000_000 }),
      capitalCents: fc.integer({ min: 0, max: 1_000_000 }),
      allocations: fc.array(fc.record({ date: day, amountCents: amount }), { maxLength: 5 }),
      writtenOffOn: fc.option(day, { nil: null }),
    })
    .map((s): PeriodSale => s);
  const anyRecords = fc.record({
    sales: fc.array(anySale, { maxLength: 6 }),
    losses: fc.array(fc.record({ date: day, costCents: amount }), { maxLength: 4 }),
    expenses: fc.array(
      fc.record({ paidDate: fc.option(day, { nil: null }), amountCents: amount }),
      { maxLength: 4 },
    ),
    cashAdjustments: fc.array(
      fc.record({ date: day, diffCents: fc.integer({ min: -1000, max: 1000 }) }),
      { maxLength: 4 },
    ),
  });

  it('property: splitting the year into periods changes when amounts count, never their total', () => {
    fc.assert(
      fc.property(anyRecords, fc.uniqueArray(day, { maxLength: 6 }), (data, cuts) => {
        const ends = [...cuts.filter((cut) => cut < '2026-12-31').sort(), '2026-12-31'];
        const whole = periodResultOf(data, { after: null, end: '2026-12-31' }, 0);
        const parts = ends.map((end, index) =>
          periodResultOf(data, { after: index === 0 ? null : (ends[index - 1] ?? null), end }, 0),
        );
        const total = (pick: (result: typeof whole) => number) =>
          parts.reduce((sum, part) => sum + pick(part), 0);
        expect(total((r) => r.recognizedProfitCents)).toBe(whole.recognizedProfitCents);
        expect(total((r) => r.recoveredBadDebtCents)).toBe(whole.recoveredBadDebtCents);
        expect(total((r) => r.losses.badDebtCents)).toBe(whole.losses.badDebtCents);
        expect(total((r) => r.losses.belowCostCents)).toBe(whole.losses.belowCostCents);
        expect(total((r) => r.losses.damageCents)).toBe(whole.losses.damageCents);
        expect(total((r) => r.expensesCents)).toBe(whole.expensesCents);
        expect(total((r) => r.cashOverShortCents)).toBe(whole.cashOverShortCents);
      }),
    );
  });

  it('property: over its life, a written-off invoice nets its profit less what was never recovered', () => {
    fc.assert(
      fc.property(anySale, (any) => {
        const result = periodResultOf(
          records({ sales: [any] }),
          { after: null, end: '2026-12-31' },
          0,
        );
        const paid = any.allocations.reduce((sum, a) => sum + a.amountCents, 0);
        const collectible = Math.min(any.capitalCents, any.totalCents);
        const applied = Math.min(paid, any.totalCents);
        const profit = applied - Math.min(applied, collectible);
        const unrecovered =
          any.writtenOffOn === null ? 0 : collectible - Math.min(paid, collectible);
        expect(
          result.recognizedProfitCents +
            result.recoveredBadDebtCents -
            result.losses.badDebtCents -
            result.losses.belowCostCents,
        ).toBe(profit - unrecovered - Math.max(0, any.capitalCents - any.totalCents));
      }),
    );
  });
});
