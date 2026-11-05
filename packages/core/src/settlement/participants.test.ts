import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSettlement, type SettlementInput } from './compute.js';
import { type PartnerOwnership, participantsOf, splitByOwnership } from './ownership.js';
import { partnerWeightsFor, type ProfitSplitRule, splitNetProfit } from './split-rule.js';

// docs/accounting-assumptions.md S17: the owner and N partners, one split, odd cents in a fixed order.

const OWNER: PartnerOwnership = { partnerId: 'owner', ownershipBp: 5000, isOwner: true };
const ALIA: PartnerOwnership = { partnerId: 'alia', ownershipBp: 3000, isOwner: false };
const BILAL: PartnerOwnership = { partnerId: 'bilal', ownershipBp: 2000, isOwner: false };
const THREE = [OWNER, ALIA, BILAL];

const NO_LOSSES = { damageCents: 0, badDebtCents: 0, belowCostCents: 0 };

/** Owner 1, Alia 1, Bilal 1, shop 1: a quarter each. */
const QUARTERS: ProfitSplitRule = {
  effectiveFrom: '2026-01-01',
  ownerWeight: 1,
  partnerWeight: 2,
  shopWeight: 1,
  partnerWeights: [
    { partnerId: 'alia', weight: 1 },
    { partnerId: 'bilal', weight: 1 },
  ],
};

function period(overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    recognizedProfitCents: 0,
    returnsEffectCents: 0,
    recoveredBadDebtCents: 0,
    losses: NO_LOSSES,
    expensesCents: 0,
    cashOverShortCents: 0,
    carriedDeficitInCents: 0,
    splitRules: [QUARTERS],
    partners: THREE,
    ...overrides,
  };
}

describe('participantsOf (S17)', () => {
  it('puts the owner first and the partners by id, whatever order they come in', () => {
    const ids = (partners: PartnerOwnership[]) =>
      participantsOf(partners).map(({ partnerId }) => partnerId);
    expect(ids([BILAL, ALIA, OWNER])).toEqual(['owner', 'alia', 'bilal']);
    expect(ids([ALIA, OWNER, BILAL])).toEqual(['owner', 'alia', 'bilal']);
  });

  it('orders ids by code unit, not by locale', () => {
    const upper = { ...ALIA, partnerId: 'Zed', ownershipBp: 2500 };
    const lower = { ...BILAL, partnerId: 'adam', ownershipBp: 2500 };
    expect(
      participantsOf([{ ...OWNER, ownershipBp: 5000 }, lower, upper]).map((p) => p.partnerId),
    ).toEqual(['owner', 'Zed', 'adam']);
  });

  it('takes any number of partners that add up to 100%', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      partnerId: `p${String(index)}`,
      ownershipBp: 1000,
      isOwner: false,
    }));
    expect(participantsOf([{ ...OWNER, ownershipBp: 5000 }, ...many])).toHaveLength(6);
  });

  it.each([
    [[OWNER], 'expected an owner and at least one partner, got 1'],
    [[OWNER, ALIA, { ...BILAL, isOwner: true }], 'exactly one partner must be the owner'],
    [[{ ...OWNER, isOwner: false }, ALIA, BILAL], 'exactly one partner must be the owner'],
    [[OWNER, ALIA, { ...BILAL, partnerId: 'alia' }], 'partner ids must differ'],
    [
      [OWNER, ALIA, { ...BILAL, ownershipBp: 2500 }],
      'ownership must add up to 10000 bp, got 10500',
    ],
    [
      [OWNER, ALIA, { ...BILAL, ownershipBp: 1000.5 }],
      'ownershipBp of bilal must be a safe integer',
    ],
  ] satisfies [PartnerOwnership[], string][])('rejects %j', (partners, message) => {
    expect(() => participantsOf(partners)).toThrow(message);
  });
});

describe('splitByOwnership with several partners (S17, S5)', () => {
  it.each([
    [10_000, [5000, 3000, 2000]],
    [10_001, [5001, 3000, 2000]], // the largest remainder (.5) is the owner's
    [7, [4, 2, 1]], // 3.5 / 2.1 / 1.4 → floors 3/2/1, the one left over goes to the owner
    [0, [0, 0, 0]],
  ])('%i → %j', (amountCents, expected) => {
    expect(splitByOwnership(amountCents, THREE).map((part) => part.amountCents)).toEqual(expected);
  });

  it('an odd cent that ties goes to the earlier partner by id', () => {
    const even = [
      { ...OWNER, ownershipBp: 5000 },
      { ...ALIA, ownershipBp: 2500 },
      { ...BILAL, ownershipBp: 2500 },
    ];
    // 1.5 / 0.75 / 0.75: floors 1/0/0, two cents left, the partners tie at .75.
    expect(splitByOwnership(3, even).map((part) => part.amountCents)).toEqual([1, 1, 1]);
    // 5000/2500/2500 of 1: .5 / .25 / .25 → the owner.
    expect(splitByOwnership(1, even).map((part) => part.amountCents)).toEqual([1, 0, 0]);
    // 3333/3333/3334 bp of 100: the largest remainder is the one holding 3334.
    const thirds = [
      { ...OWNER, ownershipBp: 3333 },
      { ...ALIA, ownershipBp: 3333 },
      { ...BILAL, ownershipBp: 3334 },
    ];
    expect(splitByOwnership(100, thirds).map((part) => part.amountCents)).toEqual([33, 33, 34]);
  });

  it('is the same whatever order the partners are listed in', () => {
    expect(splitByOwnership(10_001, [BILAL, OWNER, ALIA])).toEqual(splitByOwnership(10_001, THREE));
  });
});

describe('splitNetProfit with named partners (S17)', () => {
  it('floors every participant like the owner and gives the shop the division cents', () => {
    // 10003 at 2/1/1/1: 4001.2 / 2000.6 / 2000.6 / 2000.6 → 4001, 2000, 2000, shop 2000 + 2.
    expect(
      splitNetProfit(10_003, {
        effectiveFrom: '2026-01-01',
        ownerWeight: 2,
        partnerWeight: 2,
        shopWeight: 1,
        partnerWeights: [
          { partnerId: 'alia', weight: 1 },
          { partnerId: 'bilal', weight: 1 },
        ],
      }),
    ).toEqual({
      ownerCents: 4001,
      partnerCents: 4000,
      shopCents: 2002,
      partners: [
        { partnerId: 'alia', cents: 2000 },
        { partnerId: 'bilal', cents: 2000 },
      ],
    });
  });

  it('partners of different weights are not equal shares', () => {
    const shares = splitNetProfit(60_000, {
      effectiveFrom: '2026-01-01',
      ownerWeight: 3,
      partnerWeight: 3,
      shopWeight: 0,
      partnerWeights: [
        { partnerId: 'alia', weight: 2 },
        { partnerId: 'bilal', weight: 1 },
      ],
    });
    expect(shares.ownerCents).toBe(30_000);
    expect(shares.partners).toEqual([
      { partnerId: 'alia', cents: 20_000 },
      { partnerId: 'bilal', cents: 10_000 },
    ]);
    expect(shares.shopCents).toBe(0);
  });

  it('a rule that names one partner gives what the unnamed rule gave (T6/T7 unchanged)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.tuple(
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: 0, max: 10_000 }),
        ),
        (net, [ownerWeight, partnerWeight, shopWeight]) => {
          fc.pre(ownerWeight + partnerWeight + shopWeight > 0);
          const plain = splitNetProfit(net, {
            effectiveFrom: '2026-01-01',
            ownerWeight,
            partnerWeight,
            shopWeight,
          });
          const named = splitNetProfit(net, {
            effectiveFrom: '2026-01-01',
            ownerWeight,
            partnerWeight,
            shopWeight,
            partnerWeights: [{ partnerId: 'p', weight: partnerWeight }],
          });
          expect({
            ownerCents: named.ownerCents,
            partnerCents: named.partnerCents,
            shopCents: named.shopCents,
          }).toEqual(plain);
        },
      ),
    );
  });

  it.each([
    [{ partnerWeights: [] }, 'split rule of 2026-01-01 names no partner'],
    [
      {
        partnerWeights: [
          { partnerId: 'alia', weight: 1 },
          { partnerId: 'alia', weight: 1 },
        ],
      },
      'split rule of 2026-01-01 names alia twice',
    ],
    [
      { partnerWeights: [{ partnerId: 'alia', weight: 1 }] },
      'partnerWeights of 2026-01-01 add up to 1, partnerWeight is 2',
    ],
    [
      {
        partnerWeight: 1,
        partnerWeights: [
          { partnerId: 'alia', weight: 2 },
          { partnerId: 'bilal', weight: -1 },
        ],
      },
      'weight of bilal must be >= 0',
    ],
  ] satisfies [Partial<ProfitSplitRule>, string][])('rejects %j', (overrides, message) => {
    expect(() => splitNetProfit(100, { ...QUARTERS, ...overrides })).toThrow(message);
  });
});

describe('partnerWeightsFor (S17)', () => {
  it('gives a rule that names nobody to the shop’s only partner', () => {
    const legacy: ProfitSplitRule = {
      effectiveFrom: '2026-01-01',
      ownerWeight: 1,
      partnerWeight: 3,
      shopWeight: 1,
    };
    expect(partnerWeightsFor(legacy, [OWNER, { ...ALIA, ownershipBp: 5000 }])).toEqual([
      { partnerId: 'alia', weight: 3 },
    ]);
  });

  it('refuses a rule that names nobody once there are several partners', () => {
    const legacy: ProfitSplitRule = {
      effectiveFrom: '2026-01-01',
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
    };
    expect(() => partnerWeightsFor(legacy, THREE)).toThrow(
      'split rule of 2026-01-01 does not name its partners, and the shop has 2',
    );
  });

  it('lists every partner in participant order, 0 for one the rule does not name', () => {
    const onlyBilal: ProfitSplitRule = {
      ...QUARTERS,
      partnerWeight: 1,
      partnerWeights: [{ partnerId: 'bilal', weight: 1 }],
    };
    expect(partnerWeightsFor(onlyBilal, THREE)).toEqual([
      { partnerId: 'alia', weight: 0 },
      { partnerId: 'bilal', weight: 1 },
    ]);
  });

  it('refuses a rule that names someone who is not a partner', () => {
    expect(() =>
      partnerWeightsFor(QUARTERS, [OWNER, ALIA, { ...BILAL, partnerId: 'carim' }]),
    ).toThrow('split rule of 2026-01-01 names bilal, who is not a partner');
  });
});

describe('computeSettlement with several partners (S17)', () => {
  it('three participants and the shop: a quarter each, the division cent to the shop', () => {
    // 30001 / 4 = 7500.25: 7500 each, the shop 7500 + 1.
    const settlement = computeSettlement(period({ recognizedProfitCents: 30_001 }));
    expect(settlement.netProfitCents).toBe(30_001);
    expect(settlement.ownerShareCents).toBe(7500);
    expect(settlement.partnerShareCents).toBe(15_000);
    expect(settlement.shopShareCents).toBe(7501);
    expect(settlement.partnerShares).toEqual([
      { partnerId: 'owner', role: 'owner', amountCents: 7500 },
      { partnerId: 'alia', role: 'partner', amountCents: 7500 },
      { partnerId: 'bilal', role: 'partner', amountCents: 7500 },
    ]);
    expect(settlement.partnerWeights).toEqual([
      { partnerId: 'alia', weight: 1 },
      { partnerId: 'bilal', weight: 1 },
    ]);
    // The shop’s share stays as capital, by ownership 50/30/20 (3750.5 / 2250.3 / 1500.2).
    expect(settlement.capitalMoves).toEqual([
      { partnerId: 'owner', type: 'retained_profit', amountCents: 3751 },
      { partnerId: 'alia', type: 'retained_profit', amountCents: 2250 },
      { partnerId: 'bilal', type: 'retained_profit', amountCents: 1500 },
    ]);
    expect(settlement.breakdown.slice(-4)).toEqual([
      { key: 'net_profit', cents: 30_001 },
      { key: 'owner_share', cents: 7500 },
      { key: 'partner_share', cents: 15_000 },
      { key: 'shop_share', cents: 7501 },
    ]);
  });

  it('a partner with weight 0 gets no share row', () => {
    const settlement = computeSettlement(
      period({
        recognizedProfitCents: 9000,
        splitRules: [
          {
            effectiveFrom: '2026-01-01',
            ownerWeight: 1,
            partnerWeight: 1,
            shopWeight: 1,
            partnerWeights: [{ partnerId: 'alia', weight: 1 }],
          },
        ],
      }),
    );
    expect(settlement.partnerShares.map(({ partnerId }) => partnerId)).toEqual(['owner', 'alia']);
    expect(settlement.partnerWeights).toEqual([
      { partnerId: 'alia', weight: 1 },
      { partnerId: 'bilal', weight: 0 },
    ]);
  });

  it('a rule from before the second partner keeps working for the original one', () => {
    const settlement = computeSettlement(
      period({
        recognizedProfitCents: 30_000,
        splitRules: [
          { effectiveFrom: '2026-01-01', ownerWeight: 1, partnerWeight: 1, shopWeight: 1 },
        ],
        partners: [OWNER, { ...ALIA, ownershipBp: 5000 }],
      }),
    );
    expect(settlement.partnerShares).toEqual([
      { partnerId: 'owner', role: 'owner', amountCents: 10_000 },
      { partnerId: 'alia', role: 'partner', amountCents: 10_000 },
    ]);
  });

  it('refuses an unnamed rule for several partners instead of guessing who gets the share', () => {
    expect(() =>
      computeSettlement(
        period({
          recognizedProfitCents: 100,
          splitRules: [
            { effectiveFrom: '2026-01-01', ownerWeight: 1, partnerWeight: 1, shopWeight: 1 },
          ],
        }),
      ),
    ).toThrow('does not name its partners');
  });

  it('a loss month shares nothing and carries the deficit', () => {
    const settlement = computeSettlement(period({ expensesCents: 5000 }));
    expect(settlement.partnerShares).toEqual([]);
    expect(settlement.capitalMoves).toEqual([]);
    expect(settlement.carryDeficitOutCents).toBe(5000);
  });

  const participants = fc
    .integer({ min: 1, max: 5 })
    .chain((others) =>
      fc.tuple(
        fc.uniqueArray(fc.uuid(), { minLength: others + 1, maxLength: others + 1 }),
        fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), {
          minLength: others,
          maxLength: others,
        }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: others, maxLength: others }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
      ),
    )
    .filter(([, , partnerWeights, ownerWeight, shopWeight]) => {
      return ownerWeight + shopWeight + partnerWeights.reduce((a, b) => a + b, 0) > 0;
    });

  it('property: every cent is shared once, in the same way whatever order the partners come in', () => {
    fc.assert(
      fc.property(
        participants,
        fc.integer({ min: 1, max: 1e9 }),
        ([ids, cuts, weights, ownerWeight, shopWeight], net) => {
          const sortedCuts = [...cuts].sort((a, b) => a - b);
          const bounds = [0, ...sortedCuts, 10_000];
          const ownership = bounds.slice(1).map((bound, index) => bound - (bounds[index] ?? 0));
          const people: PartnerOwnership[] = ids.map((partnerId, index) => ({
            partnerId,
            ownershipBp: ownership[index] ?? 0,
            isOwner: index === 0,
          }));
          const rule: ProfitSplitRule = {
            effectiveFrom: '2026-01-01',
            ownerWeight,
            partnerWeight: weights.reduce((a, b) => a + b, 0),
            shopWeight,
            partnerWeights: people.slice(1).map(({ partnerId }, index) => ({
              partnerId,
              weight: weights[index] ?? 0,
            })),
          };
          const result = computeSettlement(
            period({ recognizedProfitCents: net, splitRules: [rule], partners: people }),
          );
          const reversed = computeSettlement(
            period({
              recognizedProfitCents: net,
              splitRules: [rule],
              partners: [...people].reverse(),
            }),
          );
          expect(reversed).toEqual(result);

          expect(result.ownerShareCents + result.partnerShareCents + result.shopShareCents).toBe(
            net,
          );
          const total = ownerWeight + shopWeight + rule.partnerWeight;
          const floorOf = (weight: number) =>
            Number((BigInt(net) * BigInt(weight)) / BigInt(total));
          expect(result.ownerShareCents).toBe(floorOf(ownerWeight));
          expect(result.shopShareCents).toBeGreaterThanOrEqual(floorOf(shopWeight));
          for (const [index, { partnerId }] of people.slice(1).entries()) {
            const share = result.partnerShares.find((row) => row.partnerId === partnerId);
            expect(share?.amountCents ?? 0).toBe(floorOf(weights[index] ?? 0));
          }
          expect(result.partnerShares.reduce((sum, { amountCents }) => sum + amountCents, 0)).toBe(
            result.ownerShareCents + result.partnerShareCents,
          );
          expect(result.capitalMoves.reduce((sum, { amountCents }) => sum + amountCents, 0)).toBe(
            result.shopShareCents,
          );
        },
      ),
    );
  });
});
