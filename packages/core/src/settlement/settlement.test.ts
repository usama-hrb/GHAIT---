import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { allocatePayment, splitSaleCapitalProfit } from '../payments/index.js';
import { partnerBalance, partnerCapital } from './balances.js';
import { computeSettlement, type Settlement, type SettlementInput } from './compute.js';
import { type PartnerOwnership, splitByOwnership } from './ownership.js';
import {
  DEFAULT_SPLIT_WEIGHTS,
  type ProfitSplitRule,
  splitNetProfit,
  splitRuleForPeriod,
} from './split-rule.js';

const dh = fromDirham;

const OWNER = { partnerId: 'owner', ownershipBp: 5000, isOwner: true } as const;
const PARTNER = { partnerId: 'partner', ownershipBp: 5000, isOwner: false } as const;
const PARTNERS: PartnerOwnership[] = [OWNER, PARTNER];
const THIRDS: ProfitSplitRule = { effectiveFrom: '2026-01-01', ...DEFAULT_SPLIT_WEIGHTS };
const NO_LOSSES = { damageCents: 0, badDebtCents: 0, belowCostCents: 0 };

function period(overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    recognizedProfitCents: 0,
    losses: NO_LOSSES,
    expensesCents: 0,
    cashOverShortCents: 0,
    carriedDeficitInCents: 0,
    splitRules: [THIRDS],
    partners: PARTNERS,
    ...overrides,
  };
}

const shares = (s: Settlement) => [s.ownerShareCents, s.partnerShareCents, s.shopShareCents];

describe('computeSettlement (SPEC §8.1)', () => {
  it('T6: cash sales 2000 dh, capital recovered 1600, profit 400, expenses 100 → 10000/10000/10000', () => {
    const sale = splitSaleCapitalProfit({
      lines: [{ lineTotalCents: dh(2000), lineCostCents: dh(1600) }],
    });
    const payment = allocatePayment(sale, [], dh(2000));
    expect(payment).toMatchObject({
      capitalRecoveredCents: dh(1600),
      profitRecognizedCents: dh(400),
    });

    const settlement = computeSettlement(
      period({ recognizedProfitCents: payment.profitRecognizedCents, expensesCents: dh(100) }),
    );
    expect(settlement).toMatchObject({
      recognizedProfitCents: 40_000,
      lossesCents: 0,
      expensesCents: 10_000,
      carriedDeficitInCents: 0,
      netProfitCents: 30_000,
      ownerShareCents: 10_000,
      partnerShareCents: 10_000,
      shopShareCents: 10_000,
      carryDeficitOutCents: 0,
      splitRule: THIRDS,
    });
    expect(settlement.partnerShares).toEqual([
      { partnerId: 'owner', role: 'owner', amountCents: 10_000 },
      { partnerId: 'partner', role: 'partner', amountCents: 10_000 },
    ]);
    expect(settlement.breakdown).toEqual([
      { key: 'recognized_profit', cents: 40_000 },
      { key: 'loss_damage', cents: 0 },
      { key: 'loss_bad_debt', cents: 0 },
      { key: 'loss_below_cost', cents: 0 },
      { key: 'expenses', cents: -10_000 },
      { key: 'cash_over_short', cents: 0 },
      { key: 'carried_deficit_in', cents: 0 },
      { key: 'net_profit', cents: 30_000 },
      { key: 'owner_share', cents: 10_000 },
      { key: 'partner_share', cents: 10_000 },
      { key: 'shop_share', cents: 10_000 },
    ]);
  });

  it('T7: net 100 dh = 10000 → 3333 + 3333 + 3334 (the remainder to the shop)', () => {
    expect(shares(computeSettlement(period({ recognizedProfitCents: dh(100) })))).toEqual([
      3333, 3333, 3334,
    ]);
  });

  it('T9: losing month carries the deficit; the next month absorbs it', () => {
    const october = computeSettlement(
      period({ recognizedProfitCents: dh(50), expensesCents: dh(150) }),
    );
    expect(october).toMatchObject({
      netProfitCents: -10_000,
      ownerShareCents: 0,
      partnerShareCents: 0,
      shopShareCents: 0,
      carryDeficitOutCents: 10_000,
    });
    expect(october.partnerShares).toEqual([]);
    expect(october.capitalMoves).toEqual([]);
    expect(october.breakdown.at(-1)).toEqual({ key: 'carry_deficit_out', cents: 10_000 });

    const november = computeSettlement(
      period({
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        recognizedProfitCents: dh(300),
        carriedDeficitInCents: october.carryDeficitOutCents,
      }),
    );
    expect(november).toMatchObject({
      carriedDeficitInCents: 10_000,
      netProfitCents: dh(200),
      carryDeficitOutCents: 0,
    });
    expect(shares(november)).toEqual([6666, 6666, 6668]);
  });

  it('T10: the shop third becomes capital, retained_profit 10000 split 5000/5000', () => {
    const settlement = computeSettlement(
      period({ recognizedProfitCents: dh(400), expensesCents: dh(100) }),
    );
    expect(settlement.capitalMoves).toEqual([
      { partnerId: 'owner', type: 'retained_profit', amountCents: 5000 },
      { partnerId: 'partner', type: 'retained_profit', amountCents: 5000 },
    ]);
  });

  it('losses (T11 below cost, T12 damage, bad debts) come off before the split', () => {
    // T11: 10 m at 14 dh on a roll costing 16 dh/m.
    const belowCost = splitSaleCapitalProfit({
      lines: [{ lineTotalCents: dh(140), lineCostCents: dh(160) }],
    });
    const settlement = computeSettlement(
      period({
        recognizedProfitCents: dh(400),
        losses: { damageCents: 480, badDebtCents: dh(50), belowCostCents: belowCost.lossCents },
        expensesCents: dh(100),
      }),
    );
    expect(settlement).toMatchObject({ lossesCents: 480 + 5000 + 2000, netProfitCents: 22_520 });
    expect(shares(settlement)).toEqual([7506, 7506, 7508]);
    expect(settlement.breakdown.slice(1, 4)).toEqual([
      { key: 'loss_damage', cents: -480 },
      { key: 'loss_bad_debt', cents: -5000 },
      { key: 'loss_below_cost', cents: -2000 },
    ]);
  });

  it('a cash count short of the books is a loss of the period; an overage a gain (I2)', () => {
    const short = computeSettlement(
      period({
        recognizedProfitCents: dh(400),
        expensesCents: dh(100),
        cashOverShortCents: dh(-30),
      }),
    );
    expect(short).toMatchObject({ cashOverShortCents: dh(-30), netProfitCents: dh(270) });
    expect(short.breakdown).toContainEqual({ key: 'cash_over_short', cents: dh(-30) });
    const over = computeSettlement(
      period({ recognizedProfitCents: dh(400), expensesCents: dh(100), cashOverShortCents: dh(3) }),
    );
    expect(over.netProfitCents).toBe(dh(303));
    // A shortage alone makes a losing month: it carries like any deficit.
    expect(computeSettlement(period({ cashOverShortCents: dh(-30) }))).toMatchObject({
      netProfitCents: dh(-30),
      carryDeficitOutCents: dh(30),
    });
  });

  it('net exactly 0: nothing distributed, nothing carried', () => {
    const settlement = computeSettlement(
      period({ recognizedProfitCents: dh(100), expensesCents: dh(100) }),
    );
    expect(settlement).toMatchObject({ netProfitCents: 0, carryDeficitOutCents: 0 });
    expect(shares(settlement)).toEqual([0, 0, 0]);
    expect(settlement.partnerShares).toEqual([]);
    expect(settlement.capitalMoves).toEqual([]);
    expect(settlement.breakdown.slice(-2)).toEqual([
      { key: 'net_profit', cents: 0 },
      { key: 'carry_deficit_out', cents: 0 },
    ]);
  });

  it('net of one cent goes to the shop; at 50/50 its capital cent goes to the owner', () => {
    const settlement = computeSettlement(period({ recognizedProfitCents: 1 }));
    expect(shares(settlement)).toEqual([0, 0, 1]);
    expect(settlement.partnerShares).toEqual([]);
    expect(settlement.capitalMoves).toEqual([
      { partnerId: 'owner', type: 'retained_profit', amountCents: 1 },
    ]);
  });

  it('negative with carry: the deficit accumulates until a month covers it', () => {
    const october = computeSettlement(period({ expensesCents: dh(100) }));
    const november = computeSettlement(
      period({
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        recognizedProfitCents: dh(60),
        carriedDeficitInCents: october.carryDeficitOutCents,
      }),
    );
    expect(november).toMatchObject({ netProfitCents: dh(-40), carryDeficitOutCents: dh(40) });
    const december = computeSettlement(
      period({
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
        recognizedProfitCents: dh(70),
        carriedDeficitInCents: november.carryDeficitOutCents,
      }),
    );
    expect(december).toMatchObject({ netProfitCents: dh(30), carryDeficitOutCents: 0 });
    expect(shares(december)).toEqual([1000, 1000, 1000]);
  });

  it('a carried deficit never touches capital, even when larger than the profit', () => {
    const settlement = computeSettlement(
      period({ recognizedProfitCents: dh(100), carriedDeficitInCents: dh(300) }),
    );
    expect(settlement).toMatchObject({ netProfitCents: dh(-200), carryDeficitOutCents: dh(200) });
    expect(settlement.capitalMoves).toEqual([]);
  });

  it('ownership not 50/50: the shop share is split 60/40 between the partners', () => {
    const partners = [
      { ...OWNER, ownershipBp: 6000 },
      { ...PARTNER, ownershipBp: 4000 },
    ];
    const settlement = computeSettlement(
      period({ recognizedProfitCents: dh(400), expensesCents: dh(100), partners }),
    );
    // The profit split itself does not depend on ownership (SPEC §8.1).
    expect(shares(settlement)).toEqual([10_000, 10_000, 10_000]);
    expect(settlement.capitalMoves).toEqual([
      { partnerId: 'owner', type: 'retained_profit', amountCents: 6000 },
      { partnerId: 'partner', type: 'retained_profit', amountCents: 4000 },
    ]);
  });

  it('finds the owner wherever it is in the partner list', () => {
    const settlement = computeSettlement(
      period({ recognizedProfitCents: dh(100), partners: [PARTNER, OWNER] }),
    );
    expect(settlement.partnerShares).toEqual([
      { partnerId: 'owner', role: 'owner', amountCents: 3333 },
      { partnerId: 'partner', role: 'partner', amountCents: 3333 },
    ]);
  });

  describe('split rules changing mid-history (effective_from, SPEC §8.3)', () => {
    const FORTY_FORTY_TWENTY: ProfitSplitRule = {
      effectiveFrom: '2026-07-01',
      ownerWeight: 4000,
      partnerWeight: 4000,
      shopWeight: 2000,
    };
    const rules = [FORTY_FORTY_TWENTY, THIRDS]; // any order
    const net = (periodStart: string, periodEnd: string) =>
      computeSettlement(
        period({ periodStart, periodEnd, recognizedProfitCents: 30_000, splitRules: rules }),
      );

    it('each period uses the rule in effect on its first day', () => {
      expect(shares(net('2026-06-01', '2026-06-30'))).toEqual([10_000, 10_000, 10_000]);
      const july = net('2026-07-01', '2026-07-31');
      expect(july.splitRule).toBe(FORTY_FORTY_TWENTY);
      expect(shares(july)).toEqual([12_000, 12_000, 6000]);
    });

    it('a rule starting inside a period first applies to the next one (never retroactive)', () => {
      const midJuly = { ...FORTY_FORTY_TWENTY, effectiveFrom: '2026-07-15' };
      expect(splitRuleForPeriod([THIRDS, midJuly], '2026-07-01')).toBe(THIRDS);
      expect(splitRuleForPeriod([THIRDS, midJuly], '2026-08-01')).toBe(midJuly);
    });

    it('rejects a period with no rule in effect, and two rules on the same day', () => {
      expect(() => net('2025-12-01', '2025-12-31')).toThrow(
        'no split rule in effect on 2025-12-01',
      );
      expect(() => splitRuleForPeriod([THIRDS, { ...THIRDS }], '2026-10-01')).toThrow(
        'two split rules take effect on 2026-01-01',
      );
    });
  });

  it.each([
    [{ periodStart: '2026-10-1' }, 'periodStart must be a YYYY-MM-DD date, got "2026-10-1"'],
    [{ periodEnd: '2026-13-01' }, 'periodEnd must be a YYYY-MM-DD date'],
    [{ periodEnd: '2026-09-30' }, 'period ends (2026-09-30) before it starts (2026-10-01)'],
    [{ recognizedProfitCents: -1 }, 'recognizedProfitCents must be >= 0'],
    [{ recognizedProfitCents: 1.5 }, 'recognizedProfitCents must be a safe integer'],
    [{ losses: { ...NO_LOSSES, damageCents: -1 } }, 'damageCents must be >= 0'],
    [{ losses: { ...NO_LOSSES, badDebtCents: -1 } }, 'badDebtCents must be >= 0'],
    [{ losses: { ...NO_LOSSES, belowCostCents: -1 } }, 'belowCostCents must be >= 0'],
    [{ expensesCents: -1 }, 'expensesCents must be >= 0'],
    [{ carriedDeficitInCents: -1 }, 'carriedDeficitInCents must be >= 0'],
    [{ cashOverShortCents: 0.5 }, 'cashOverShortCents must be a safe integer'],
    [
      {
        losses: {
          ...NO_LOSSES,
          damageCents: Number.MAX_SAFE_INTEGER,
          badDebtCents: Number.MAX_SAFE_INTEGER,
        },
      },
      'netProfitCents must be a safe integer',
    ],
    [{ splitRules: [] }, 'no split rule in effect on 2026-10-01'],
    [{ partners: [OWNER] }, 'expected exactly two partners, got 1'],
  ] satisfies [Partial<SettlementInput>, string][])('rejects %j', (overrides, message) => {
    expect(() => computeSettlement(period(overrides))).toThrow(message);
  });

  const amount = fc.integer({ min: 0, max: 100_000_000 });
  const scenario = fc.record({
    recognizedProfitCents: amount,
    losses: fc.record({ damageCents: amount, badDebtCents: amount, belowCostCents: amount }),
    expensesCents: amount,
    cashOverShortCents: fc.integer({ min: -100_000_000, max: 100_000_000 }),
    carriedDeficitInCents: amount,
    rule: fc
      .tuple(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
      )
      .filter((weights) => weights.some((weight) => weight > 0)),
    ownerBp: fc.integer({ min: 0, max: 10_000 }),
  });

  it('property: shares add up to the net when positive, the deficit carries when not', () => {
    fc.assert(
      fc.property(
        scenario,
        ({ rule: [ownerWeight, partnerWeight, shopWeight], ownerBp, ...amounts }) => {
          const settlement = computeSettlement(
            period({
              ...amounts,
              splitRules: [{ effectiveFrom: '2026-01-01', ownerWeight, partnerWeight, shopWeight }],
              partners: [
                { ...OWNER, ownershipBp: ownerBp },
                { ...PARTNER, ownershipBp: 10_000 - ownerBp },
              ],
            }),
          );
          const net = settlement.netProfitCents;
          const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
          expect(sum(shares(settlement))).toBe(Math.max(0, net));
          expect(settlement.carryDeficitOutCents).toBe(Math.max(0, -net));
          expect(sum(settlement.capitalMoves.map((move) => move.amountCents))).toBe(
            settlement.shopShareCents,
          );
          expect(sum(settlement.partnerShares.map((share) => share.amountCents))).toBe(
            settlement.ownerShareCents + settlement.partnerShareCents,
          );
          // The equation lines add up to the net, and what follows accounts for all of it.
          const netIndex = settlement.breakdown.findIndex((line) => line.key === 'net_profit');
          expect(sum(settlement.breakdown.slice(0, netIndex).map((line) => line.cents))).toBe(net);
          const after = sum(settlement.breakdown.slice(netIndex + 1).map((line) => line.cents));
          expect(after).toBe(Math.abs(net));
        },
      ),
    );
  });

  it('property: equal thirds give owner = partner, and the shop at most 2 cents more', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (net) => {
        const settlement = computeSettlement(period({ recognizedProfitCents: net }));
        expect(settlement.ownerShareCents).toBe(settlement.partnerShareCents);
        const extra = settlement.shopShareCents - settlement.ownerShareCents;
        expect(extra).toBeGreaterThanOrEqual(0);
        expect(extra).toBeLessThanOrEqual(2);
      }),
    );
  });

  it('property: over many periods, distributed − final carry = Σ period results (nothing lost)', () => {
    const month = fc.record({ recognizedProfitCents: amount, expensesCents: amount });
    fc.assert(
      fc.property(fc.array(month, { minLength: 1, maxLength: 24 }), (months) => {
        let carry = 0;
        let distributed = 0;
        for (const values of months) {
          const settlement = computeSettlement(period({ ...values, carriedDeficitInCents: carry }));
          distributed += Math.max(0, settlement.netProfitCents);
          carry = settlement.carryDeficitOutCents;
        }
        const results = months.reduce(
          (sum, { recognizedProfitCents, expensesCents }) =>
            sum + recognizedProfitCents - expensesCents,
          0,
        );
        expect(distributed - carry).toBe(results);
      }),
    );
  });
});

describe('splitNetProfit', () => {
  it('a zero shop weight still takes the division cents', () => {
    expect(
      splitNetProfit(10_001, {
        effectiveFrom: '2026-01-01',
        ownerWeight: 1,
        partnerWeight: 1,
        shopWeight: 0,
      }),
    ).toEqual({ ownerCents: 5000, partnerCents: 5000, shopCents: 1 });
  });

  it('basis points 3333/3333/3334 are not thirds: T6 would give 9999/9999/10002', () => {
    expect(
      splitNetProfit(30_000, {
        effectiveFrom: '2026-01-01',
        ownerWeight: 3333,
        partnerWeight: 3333,
        shopWeight: 3334,
      }),
    ).toEqual({ ownerCents: 9999, partnerCents: 9999, shopCents: 10_002 });
  });

  it.each([
    [
      { ownerWeight: 0, partnerWeight: 0, shopWeight: 0 },
      'split rule of 2026-01-01 has only zero weights',
    ],
    [{ ownerWeight: -1 }, 'ownerWeight must be >= 0'],
    [{ partnerWeight: 0.5 }, 'partnerWeight must be a safe integer'],
    [{ shopWeight: -1 }, 'shopWeight must be >= 0'],
    [{ effectiveFrom: '01/01/2026' }, 'effectiveFrom must be a YYYY-MM-DD date'],
  ] satisfies [Partial<ProfitSplitRule>, string][])('rejects %j', (overrides, message) => {
    expect(() => splitNetProfit(100, { ...THIRDS, ...overrides })).toThrow(message);
  });
});

describe('splitByOwnership (SPEC §6, §8.1)', () => {
  it.each([
    [10_000, 5000, [5000, 5000]], // T10
    [3333, 5000, [1667, 1666]], // odd cent on an even split: the owner
    [10_001, 6000, [6001, 4000]],
    [10_001, 3000, [3000, 7001]], // largest remainder, not always the owner
    [500, 10_000, [500, 0]],
  ])('%i at %i bp for the owner → %j', (amountCents, ownerBp, expected) => {
    const split = splitByOwnership(amountCents, [
      { ...OWNER, ownershipBp: ownerBp },
      { ...PARTNER, ownershipBp: 10_000 - ownerBp },
    ]);
    expect(split.map((part) => part.amountCents)).toEqual(expected);
    expect(split.map((part) => part.partnerId)).toEqual(['owner', 'partner']);
  });

  it.each([
    [[OWNER], 'expected exactly two partners, got 1'],
    [[OWNER, PARTNER, { ...PARTNER, partnerId: 'third' }], 'expected exactly two partners, got 3'],
    [[OWNER, { ...PARTNER, isOwner: true }], 'exactly one partner must be the owner'],
    [[{ ...OWNER, isOwner: false }, PARTNER], 'exactly one partner must be the owner'],
    [[OWNER, { ...PARTNER, partnerId: 'owner' }], 'partner ids must differ'],
    [[OWNER, { ...PARTNER, ownershipBp: 4000 }], 'ownership must add up to 10000 bp, got 9000'],
    [
      [
        { ...OWNER, ownershipBp: 10_001 },
        { ...PARTNER, ownershipBp: -1 },
      ],
      'ownershipBp of partner must be >= 0',
    ],
  ] satisfies [PartnerOwnership[], string][])('rejects %j', (partners, message) => {
    expect(() => splitByOwnership(100, partners)).toThrow(message);
  });
});

describe('partnerBalance (SPEC §8.1)', () => {
  it('Σ shares − Σ draws; positive = owed to the partner, negative = drew too much', () => {
    expect(
      partnerBalance([{ amountCents: 10_000 }, { amountCents: 6666 }], [{ amountCents: 12_000 }]),
    ).toBe(4666);
    expect(partnerBalance([{ amountCents: 10_000 }], [{ amountCents: 15_000 }])).toBe(-5000);
    expect(partnerBalance([], [])).toBe(0);
  });

  it('ignores voided shares and draws', () => {
    expect(
      partnerBalance(
        [{ amountCents: 10_000 }, { amountCents: 3000, voided: true }],
        [{ amountCents: 2000 }, { amountCents: 9000, voided: true }],
      ),
    ).toBe(8000);
  });

  it('rejects a negative share and an empty draw', () => {
    expect(() => partnerBalance([{ amountCents: -1 }], [])).toThrow(
      'share amountCents must be >= 0',
    );
    expect(() => partnerBalance([], [{ amountCents: 0 }])).toThrow('draw amountCents must be >= 1');
  });
});

describe('partnerCapital (SPEC §8.4)', () => {
  it('Σ capital moves: contributions and retained profit add, withdrawals subtract', () => {
    expect(
      partnerCapital([
        { type: 'contribution', amountCents: dh(5000) },
        { type: 'retained_profit', amountCents: 5000 },
        { type: 'withdrawal', amountCents: dh(-1000) },
        { type: 'contribution', amountCents: dh(2000), voided: true },
      ]),
    ).toBe(405_000);
  });

  it.each([
    [{ type: 'contribution', amountCents: 0 }, 'contribution must be positive, got 0'],
    [{ type: 'retained_profit', amountCents: -5 }, 'retained_profit must be positive, got -5'],
    [{ type: 'withdrawal', amountCents: 100 }, 'withdrawal must be negative, got 100'],
    [{ type: 'contribution', amountCents: 0.5 }, 'contribution amountCents must be a safe integer'],
  ] as const)('rejects %j', (move, message) => {
    expect(() => partnerCapital([move])).toThrow(message);
  });
});
