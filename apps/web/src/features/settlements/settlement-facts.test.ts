import { DEFAULT_SPLIT_RULE, type SettlementFigures } from '@fabric/contracts';
import {
  computeSettlement,
  type PartnerOwnership,
  type ProfitSplitRule,
  type Settlement,
  type SettlementInput,
} from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  adjustmentsTotalOf,
  BREAKDOWN_GROUPS,
  distributionOf,
  factsOfPreview,
  factsOfSettlement,
  groupedBreakdown,
  isWholeMonth,
  type Participant,
  periodStateOf,
  ruleInEffect,
  type SettlementFacts,
} from './settlement-facts';

const partners: PartnerOwnership[] = [
  { partnerId: 'owner', ownershipBp: 5000, isOwner: true },
  { partnerId: 'partner', ownershipBp: 5000, isOwner: false },
];

const participants: Participant[] = [
  { partnerId: 'owner', name: 'Owner', isOwner: true, ownershipBp: 5000 },
  { partnerId: 'partner', name: 'Partner', isOwner: false, ownershipBp: 5000 },
];

const quiet: SettlementInput = {
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  recognizedProfitCents: 0,
  returnsEffectCents: 0,
  recoveredBadDebtCents: 0,
  losses: { damageCents: 0, badDebtCents: 0, belowCostCents: 0 },
  expensesCents: 0,
  cashOverShortCents: 0,
  carriedDeficitInCents: 0,
  splitRules: [DEFAULT_SPLIT_RULE],
  partners,
};

/** The record the server keeps of a settlement (contracts' figures), from core's result. */
function figuresOf(
  settlement: Settlement,
  input: SettlementInput,
  named = false,
): SettlementFigures {
  return {
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    recognizedProfitCents: settlement.recognizedProfitCents,
    returnsEffectCents: settlement.returnsEffectCents,
    recoveredBadDebtCents: settlement.recoveredBadDebtCents,
    damageCents: input.losses.damageCents,
    badDebtCents: input.losses.badDebtCents,
    belowCostCents: input.losses.belowCostCents,
    expensesCents: settlement.expensesCents,
    cashOverShortCents: settlement.cashOverShortCents,
    carriedDeficitInCents: settlement.carriedDeficitInCents,
    netProfitCents: settlement.netProfitCents,
    ownerShareCents: settlement.ownerShareCents,
    partnerShareCents: settlement.partnerShareCents,
    shopShareCents: settlement.shopShareCents,
    carryDeficitOutCents: settlement.carryDeficitOutCents,
    ownerWeight: settlement.splitRule.ownerWeight,
    partnerWeight: settlement.splitRule.partnerWeight,
    shopWeight: settlement.splitRule.shopWeight,
    // A settlement made with one partner (before S17) names none; a new one always does.
    partnerWeights: named ? settlement.partnerWeights : null,
  };
}

/** The facts of a settlement approved with `input`, the way the detail page reads them. */
function factsOf(input: SettlementInput, named = false): SettlementFacts {
  const settlement = computeSettlement(input);
  return factsOfSettlement({
    settlement: figuresOf(settlement, input, named),
    shares: settlement.partnerShares,
    retainedProfit: settlement.capitalMoves,
  });
}

describe('groupedBreakdown', () => {
  it('covers every line up to the net profit exactly once, in the order computeSettlement gives', () => {
    const settlement = computeSettlement({ ...quiet, recognizedProfitCents: 100 });
    const upToNet = settlement.breakdown
      .map((line) => line.key)
      .slice(
        0,
        settlement.breakdown.findIndex((line) => line.key === 'net_profit'),
      );
    expect(BREAKDOWN_GROUPS.flatMap((group) => group.lines)).toEqual(upToNet);
  });

  it('keeps every signed line and adds up to the net profit with every adjustment non-zero', () => {
    const input: SettlementInput = {
      ...quiet,
      recognizedProfitCents: 500_000,
      returnsEffectCents: -12_000,
      recoveredBadDebtCents: 3_000,
      losses: { damageCents: 20_000, badDebtCents: 5_000, belowCostCents: 1_500 },
      expensesCents: 150_000,
      cashOverShortCents: -2_500,
      carriedDeficitInCents: 10_000,
    };
    const breakdown = computeSettlement(input).breakdown;
    const grouped = groupedBreakdown(breakdown);
    expect(grouped.reconciles).toBe(true);
    expect(grouped.netProfitCents).toBe(
      500_000 - 12_000 + 3_000 - 26_500 - 150_000 - 2_500 - 10_000,
    );
    expect(
      Object.fromEntries(grouped.groups.map((group) => [group.key, group.subtotalCents])),
    ).toEqual({
      profit: 500_000,
      sales: -9_000,
      losses: -26_500,
      costs: -152_500,
      before: -10_000,
    });
    // Deductions stay negative, as the server computed them.
    const lines = Object.fromEntries(
      grouped.groups.flatMap((group) => group.lines).map((line) => [line.key, line.cents]),
    );
    expect(lines).toMatchObject({
      loss_damage: -20_000,
      loss_bad_debt: -5_000,
      loss_below_cost: -1_500,
      expenses: -150_000,
      cash_over_short: -2_500,
      carried_deficit_in: -10_000,
    });
  });

  it('the profit plus the adjustments in total is the net profit', () => {
    const grouped = groupedBreakdown(
      computeSettlement({
        ...quiet,
        recognizedProfitCents: 80_000,
        returnsEffectCents: -5_000,
        expensesCents: 20_000,
        cashOverShortCents: 1_000,
      }).breakdown,
    );
    expect(adjustmentsTotalOf(grouped)).toBe(-24_000);
    expect(80_000 + adjustmentsTotalOf(grouped)).toBe(grouped.netProfitCents);
  });

  it('keeps the zero lines: a reconciliation shows every adjustment, taken or not', () => {
    const grouped = groupedBreakdown(
      computeSettlement({ ...quiet, recognizedProfitCents: 1_000 }).breakdown,
    );
    expect(grouped.groups.flatMap((group) => group.lines)).toHaveLength(9);
    expect(
      grouped.groups.find((group) => group.key === 'losses')?.lines.map((line) => line.cents),
    ).toEqual([0, 0, 0]);
    expect(grouped.reconciles).toBe(true);
  });

  it('reconciles a deficit period too (net below zero)', () => {
    const grouped = groupedBreakdown(
      computeSettlement({ ...quiet, recognizedProfitCents: 4_000, expensesCents: 10_000 })
        .breakdown,
    );
    expect(grouped.netProfitCents).toBe(-6_000);
    expect(grouped.reconciles).toBe(true);
  });

  it('reports a breakdown that does not add up instead of hiding it', () => {
    const breakdown = computeSettlement({ ...quiet, recognizedProfitCents: 1_000 }).breakdown.map(
      (line) => (line.key === 'net_profit' ? { ...line, cents: line.cents + 1 } : line),
    );
    expect(groupedBreakdown(breakdown).reconciles).toBe(false);
  });
});

describe('distributionOf', () => {
  it('shares a round profit in thirds by the default rule and reconciles', () => {
    // SPEC T6: 30 000 dh of net profit, owner / partner / shop 10 000 dh each.
    const facts = factsOf({ ...quiet, recognizedProfitCents: 3_000_000 });
    const distribution = distributionOf(facts, participants);
    expect(distribution.distributes).toBe(true);
    expect(distribution.reconciles).toBe(true);
    expect(distribution.allocations.map((a) => [a.kind, a.amountCents])).toEqual([
      ['owner', 1_000_000],
      ['partner', 1_000_000],
      ['shop', 1_000_000],
    ]);
    expect(distribution.allocations.map((a) => a.permille)).toEqual([333, 333, 333]);
  });

  it('gives the division cents to the shop and still adds up to the net profit (SPEC T7)', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 1_000_001 });
    const distribution = distributionOf(facts, participants);
    const amounts = distribution.allocations.map((a) => a.amountCents);
    expect(amounts).toEqual([333_333, 333_333, 333_335]);
    expect(amounts.reduce((sum, cents) => sum + cents, 0)).toBe(1_000_001);
    expect(distribution.reconciles).toBe(true);
  });

  it('shows where the shop share goes as capital, per partner, and it adds up to the share', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 1_000_001 });
    const shop = distributionOf(facts, participants).allocations[2];
    expect(shop?.kind).toBe('shop');
    expect(shop?.capital.map((move) => move.participant?.name)).toEqual(['Owner', 'Partner']);
    expect(shop?.capital.reduce((sum, move) => sum + move.amountCents, 0)).toBe(shop?.amountCents);
  });

  it('follows the rule the period was settled with, not today’s', () => {
    const rule: ProfitSplitRule = {
      effectiveFrom: '2026-09-01',
      ownerWeight: 4000,
      partnerWeight: 4000,
      shopWeight: 2000,
    };
    const facts = factsOf({
      ...quiet,
      recognizedProfitCents: 100_000,
      splitRules: [DEFAULT_SPLIT_RULE, rule],
    });
    const distribution = distributionOf(facts, participants);
    expect(distribution.allocations.map((a) => [a.weight, a.permille, a.amountCents])).toEqual([
      [4000, 400, 40_000],
      [4000, 400, 40_000],
      [2000, 200, 20_000],
    ]);
    expect(distribution.reconciles).toBe(true);
  });

  it('a period with no profit distributes nothing and carries the deficit (net below zero)', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 1_000, expensesCents: 4_000 });
    const distribution = distributionOf(facts, participants);
    expect(distribution.distributes).toBe(false);
    expect(facts.carryDeficitOutCents).toBe(3_000);
    expect(distribution.allocations.map((a) => a.amountCents)).toEqual([0, 0, 0]);
    expect(distribution.reconciles).toBe(true);
  });

  it('a period of exactly zero distributes nothing and carries nothing', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 4_000, expensesCents: 4_000 });
    const distribution = distributionOf(facts, participants);
    expect(distribution.distributes).toBe(false);
    expect(facts.carryDeficitOutCents).toBe(0);
    expect(distribution.reconciles).toBe(true);
  });

  it('flags shares that do not add up to the net profit', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 3_000_000 });
    expect(
      distributionOf({ ...facts, ownerShareCents: facts.ownerShareCents + 1 }, participants)
        .reconciles,
    ).toBe(false);
    expect(
      distributionOf({ ...facts, retained: facts.retained.slice(0, 1) }, participants).reconciles,
    ).toBe(false);
  });

  it('keeps a capital move whose partner is no longer known, by id', () => {
    const facts = factsOf({ ...quiet, recognizedProfitCents: 3_000_000 });
    const shop = distributionOf(facts, [participants[0] as Participant]).allocations[2];
    expect(shop?.capital.map((move) => move.participant?.name)).toEqual(['Owner', undefined]);
    expect(shop?.capital.map((move) => move.partnerId)).toEqual(['owner', 'partner']);
  });

  describe('with several partners (S17)', () => {
    const three: PartnerOwnership[] = [
      { partnerId: 'owner', ownershipBp: 4000, isOwner: true },
      { partnerId: 'p1', ownershipBp: 3000, isOwner: false },
      { partnerId: 'p2', ownershipBp: 3000, isOwner: false },
    ];
    const everyone: Participant[] = [
      { partnerId: 'owner', name: 'Owner', isOwner: true, ownershipBp: 4000 },
      { partnerId: 'p1', name: 'P1', isOwner: false, ownershipBp: 3000 },
      { partnerId: 'p2', name: 'P2', isOwner: false, ownershipBp: 3000 },
    ];
    const rule: ProfitSplitRule = {
      effectiveFrom: '2026-09-01',
      ownerWeight: 2,
      partnerWeight: 3,
      shopWeight: 1,
      partnerWeights: [
        { partnerId: 'p1', weight: 2 },
        { partnerId: 'p2', weight: 1 },
      ],
    };
    const input: SettlementInput = {
      ...quiet,
      partners: three,
      splitRules: [DEFAULT_SPLIT_RULE, rule],
      recognizedProfitCents: 1_000_001,
    };

    it('lists the owner, each partner by the weight they were given, then the shop', () => {
      const distribution = distributionOf(factsOf(input, true), everyone);
      expect(
        distribution.allocations.map((a) => [a.kind, a.participant?.name, a.weight, a.permille]),
      ).toEqual([
        ['owner', 'Owner', 2, 333],
        ['partner', 'P1', 2, 333],
        ['partner', 'P2', 1, 167],
        ['shop', undefined, 1, 167],
      ]);
      expect(new Set(distribution.allocations.map((a) => a.id)).size).toBe(4);
    });

    it('adds up to the net profit with the odd cents in the shop’s share', () => {
      const facts = factsOf(input, true);
      const distribution = distributionOf(facts, everyone);
      expect(distribution.allocations.map((a) => a.amountCents)).toEqual([
        333_333, 333_333, 166_666, 166_669,
      ]);
      expect(distribution.reconciles).toBe(true);
      const partners = distribution.allocations.filter((a) => a.kind === 'partner');
      expect(partners.reduce((sum, a) => sum + a.amountCents, 0)).toBe(facts.partnerShareCents);
    });

    it('spreads the shop’s share over everyone’s capital, by ownership', () => {
      const shop = distributionOf(factsOf(input, true), everyone).allocations.at(-1);
      expect(shop?.capital.map((move) => move.participant?.name)).toEqual(['Owner', 'P1', 'P2']);
      expect(shop?.capital.reduce((sum, move) => sum + move.amountCents, 0)).toBe(
        shop?.amountCents,
      );
    });

    it('leaves out a partner with no weight and no share', () => {
      const leaving: ProfitSplitRule = {
        ...rule,
        partnerWeight: 2,
        partnerWeights: [
          { partnerId: 'p1', weight: 2 },
          { partnerId: 'p2', weight: 0 },
        ],
      };
      const facts = factsOf({ ...input, splitRules: [DEFAULT_SPLIT_RULE, leaving] }, true);
      const distribution = distributionOf(facts, everyone);
      expect(distribution.allocations.map((a) => a.participant?.name)).toEqual([
        'Owner',
        'P1',
        undefined,
      ]);
      expect(distribution.reconciles).toBe(true);
    });

    it('gives a settlement that names no weights to its one partner: later partners took no part', () => {
      // Made when the shop had owner + p1 only; p2 joined after (they are on the device now).
      const before: SettlementInput = {
        ...quiet,
        recognizedProfitCents: 3_000_000,
        partners: [
          { partnerId: 'owner', ownershipBp: 5000, isOwner: true },
          { partnerId: 'p1', ownershipBp: 5000, isOwner: false },
        ],
      };
      const distribution = distributionOf(factsOf(before), everyone);
      expect(distribution.allocations.map((a) => [a.kind, a.participant?.name])).toEqual([
        ['owner', 'Owner'],
        ['partner', 'P1'],
        ['shop', undefined],
      ]);
      expect(distribution.reconciles).toBe(true);
    });

    it('keeps a partner’s share whose record is not on this device, by id', () => {
      const distribution = distributionOf(factsOf(input, true), [everyone[0] as Participant]);
      const partners = distribution.allocations.filter((a) => a.kind === 'partner');
      expect(partners.map((a) => [a.id, a.participant])).toEqual([
        ['partner:p1', null],
        ['partner:p2', null],
      ]);
      expect(distribution.reconciles).toBe(true);
    });
  });
});

describe('factsOfSettlement / factsOfPreview', () => {
  it('a stored settlement shows the figures it was approved with', () => {
    const input: SettlementInput = {
      ...quiet,
      recognizedProfitCents: 90_000,
      expensesCents: 30_000,
    };
    const settlement = computeSettlement(input);
    const facts = factsOf(input);
    expect(facts.netProfitCents).toBe(60_000);
    expect(facts.breakdown).toEqual(settlement.breakdown);
    expect(facts.weights).toEqual({ owner: 1, partner: 1, shop: 1, partners: null });
    expect(facts.shares).toEqual(
      settlement.partnerShares.map(({ partnerId, amountCents }) => ({ partnerId, amountCents })),
    );
  });

  it('a preview and the settlement approved from it give the same facts', () => {
    const input: SettlementInput = {
      ...quiet,
      recognizedProfitCents: 1_000_001,
      losses: { ...quiet.losses, damageCents: 1 },
    };
    const settlement = computeSettlement(input);
    const figures = figuresOf(settlement, input);
    const preview = factsOfPreview({
      ...figures,
      breakdown: settlement.breakdown,
      shares: settlement.partnerShares,
      retainedProfit: settlement.capitalMoves,
      lockedCostCount: 0,
    });
    expect(preview).toEqual(factsOf(input));
  });
});

describe('ruleInEffect (S3, S15)', () => {
  const rule = (effectiveFrom: string, owner: number): ProfitSplitRule => ({
    effectiveFrom,
    ownerWeight: owner,
    partnerWeight: 1,
    shopWeight: 1,
  });

  it('is the default (equal thirds) until a rule is entered', () => {
    expect(ruleInEffect([], '2026-10-01')).toEqual({ rule: DEFAULT_SPLIT_RULE, isDefault: true });
  });

  it('an entered rule applies to a period that starts on its date or after', () => {
    const rules = [rule('2026-10-01', 2)];
    expect(ruleInEffect(rules, '2026-10-01').rule.ownerWeight).toBe(2);
    expect(ruleInEffect(rules, '2026-10-01').isDefault).toBe(false);
    expect(ruleInEffect(rules, '2026-11-01').rule.ownerWeight).toBe(2);
  });

  it('is never retroactive: a rule that starts inside a period first applies to the next one', () => {
    const rules = [rule('2026-10-15', 2)];
    expect(ruleInEffect(rules, '2026-10-01').isDefault).toBe(true);
    expect(ruleInEffect(rules, '2026-11-01').rule.ownerWeight).toBe(2);
  });

  it('the latest rule in effect on the first day wins', () => {
    const rules = [rule('2026-01-01', 2), rule('2026-06-01', 3), rule('2027-01-01', 4)];
    expect(ruleInEffect(rules, '2026-10-01').rule.ownerWeight).toBe(3);
  });
});

describe('periodStateOf', () => {
  it('a period held by a settlement is settled, whatever its preview says', () => {
    expect(periodStateOf({ settled: true, previewOk: true })).toBe('settled');
    expect(periodStateOf({ settled: true, previewOk: false })).toBe('settled');
  });

  it('an open period whose figures can be computed is ready for approval', () => {
    expect(periodStateOf({ settled: false, previewOk: true })).toBe('ready');
  });

  it('an open period that cannot be settled yet (not ended, partners missing) is not settled', () => {
    expect(periodStateOf({ settled: false, previewOk: false })).toBe('notSettled');
  });
});

describe('isWholeMonth', () => {
  it('is true for exactly one calendar month', () => {
    expect(isWholeMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(isWholeMonth('2024-02-01', '2024-02-29')).toBe(true);
  });

  it('is false for a period that starts late, ends early or spans months', () => {
    expect(isWholeMonth('2026-10-05', '2026-10-31')).toBe(false);
    expect(isWholeMonth('2026-10-01', '2026-10-30')).toBe(false);
    expect(isWholeMonth('2026-09-01', '2026-10-31')).toBe(false);
  });
});
