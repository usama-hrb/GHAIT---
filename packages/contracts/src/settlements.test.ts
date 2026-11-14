import { describe, expect, it } from 'vitest';
import {
  breakdownOf,
  buildSettlement,
  checkPartnerVoid,
  checkSplitRule,
  checkSplitRuleVoid,
  checkUnlock,
  DEFAULT_SPLIT_RULE,
  firstPartnerOf,
  lockedThroughOf,
  PARTNER_ISSUES,
  type Partner,
  partnerStatusOf,
  partnerWeightsOfRule,
  periodDatesOf,
  periodLockIssues,
  previewSettlement,
  batchLedgerOf,
  ruleWithPartnerWeight,
  SETTLEMENT_ISSUES,
  type SplitRule,
  splitRulesOf,
  withLockedCosts,
} from './index.js';

import { at, base, dh, NO_CONTACT, OWNER, PARTNER, Shop } from './test-shop.js';

describe('settlement from the records (BUILD_PROMPTS 4.3)', () => {
  it('T6 + T10: 100 m costing 1600 dh sold for 2000 dh, 100 dh of expenses', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(1600), 10_000);
    shop.sale(roll, '2026-10-05', 10_000, dh(2000));
    shop.expense('2026-10-10', dh(100));
    const preview = shop.preview('2026-10-31');
    expect(preview).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      recognizedProfitCents: dh(400),
      expensesCents: dh(100),
      netProfitCents: 30_000,
      ownerShareCents: 10_000,
      partnerShareCents: 10_000,
      shopShareCents: 10_000,
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      lockedCostCount: 1,
    });

    const aggregate = shop.settle('2026-10-31');
    expect(aggregate.settlement).toMatchObject({
      netProfitCents: 30_000,
      lockedAt: at('2027-01-15'),
    });
    expect(aggregate.shares.map((share) => [share.partnerId, share.amountCents])).toEqual([
      [OWNER, 10_000],
      [PARTNER, 10_000],
    ]);
    // T10: the shop's third is capital, half for each partner, dated the period's last day.
    expect(
      aggregate.retainedProfit.map((move) => [
        move.partnerId,
        move.type,
        move.amountCents,
        move.date,
      ]),
    ).toEqual([
      [OWNER, 'retained_profit', 5000, '2026-10-31'],
      [PARTNER, 'retained_profit', 5000, '2026-10-31'],
    ]);
    expect(
      aggregate.retainedProfit.every((move) => move.settlementId === aggregate.settlement.id),
    ).toBe(true);
    expect(aggregate.lockedCosts.map((cost) => cost.costCents)).toEqual([dh(1600)]);
  });

  it('a stored settlement gives back the breakdown it was approved with', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(1400), 10_000);
    shop.sale(roll, '2026-10-05', 1000, dh(190));
    shop.expense('2026-10-20', dh(150));
    const october = shop.preview('2026-10-31').breakdown;
    expect(breakdownOf(shop.settle('2026-10-31').settlement)).toEqual(october);
    shop.sale(roll, '2026-11-03', 5000, dh(1000));
    const november = shop.preview('2026-11-30').breakdown;
    expect(breakdownOf(shop.settle('2026-11-30').settlement)).toEqual(november);
  });

  it('T7: a net of 100 dh → 3333 + 3333 + 3334', () => {
    const shop = new Shop();
    shop.sale(shop.batch(dh(400), 1000), '2026-10-05', 1000, dh(500));
    expect(shop.preview('2026-10-31')).toMatchObject({
      ownerShareCents: 3333,
      partnerShareCents: 3333,
      shopShareCents: 3334,
    });
  });

  it('T9: a losing October carries its deficit into November, which starts the day after', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(1400), 10_000);
    shop.sale(roll, '2026-10-05', 1000, dh(190)); // 140 dh of cloth: 50 dh of profit
    shop.expense('2026-10-20', dh(150));
    const october = shop.settle('2026-10-31');
    expect(october.settlement).toMatchObject({
      netProfitCents: dh(-100),
      carryDeficitOutCents: 10_000,
    });
    expect(october.shares).toEqual([]);
    expect(october.retainedProfit).toEqual([]);

    shop.sale(roll, '2026-11-03', 5000, dh(1000)); // 700 dh of cloth: 300 dh of profit
    expect(shop.preview('2026-11-30')).toMatchObject({
      periodStart: '2026-11-01',
      recognizedProfitCents: dh(300),
      carriedDeficitInCents: 10_000,
      netProfitCents: dh(200),
    });
  });

  it('T8 over two months: the credit sale’s profit counts when it is paid', () => {
    const shop = new Shop();
    const sale = shop.sale(shop.batch(dh(160), 1000), '2026-10-20', 1000, dh(200), dh(100));
    expect(shop.settle('2026-10-31').settlement.recognizedProfitCents).toBe(0);
    shop.pay(sale, '2026-11-05', dh(100));
    expect(shop.preview('2026-11-30').recognizedProfitCents).toBe(dh(40));
  });

  it('a bad debt, then its recovery in a later month (S5)', () => {
    const shop = new Shop();
    const sale = shop.sale(shop.batch(dh(160), 1000), '2026-10-20', 1000, dh(200), dh(100));
    shop.records.writeOffs.push({
      ...base('2026-10-25'),
      id: crypto.randomUUID(),
      saleId: sale.id,
      date: '2026-10-25',
      reason: 'لن يدفع',
    });
    expect(shop.settle('2026-10-31').settlement).toMatchObject({
      badDebtCents: dh(60),
      netProfitCents: dh(-60),
    });
    shop.pay(sale, '2026-11-10', dh(100));
    expect(shop.preview('2026-11-30')).toMatchObject({
      recoveredBadDebtCents: dh(60),
      recognizedProfitCents: dh(40),
      carriedDeficitInCents: dh(60),
      netProfitCents: dh(40),
    });
  });

  it('a settled sale keeps its cost when the roll is measured later (P9)', () => {
    const shop = new Shop();
    // A kg roll: estimated at 1000 cm for 100 dh; half of it sold in October.
    const roll = shop.batch(dh(100), 1000, true);
    shop.sale(roll, '2026-10-05', 500, dh(80));
    expect(shop.settle('2026-10-31').lockedCosts.map((cost) => cost.costCents)).toEqual([dh(50)]);

    // Measured in November: 800 cm in all. Unfrozen, October's half would now cost 62.50 dh.
    shop.move(roll, 'measurement', 800, '2026-11-02', null, 'meter');
    shop.sale(roll, '2026-11-03', 300, dh(70));
    const ledger = batchLedgerOf(
      roll,
      withLockedCosts(shop.records.stockMoves, shop.records.lockedCosts),
    );
    expect(ledger.costs.map((cost) => cost.costCents)).toEqual([dh(50), dh(50)]);
    expect(ledger.unallocatedCostCents).toBe(0);
    expect(shop.preview('2026-11-30').recognizedProfitCents).toBe(dh(20));
    // An unlocked period's costs are not frozen: a voided locked cost no longer counts.
    const voided = shop.records.lockedCosts.map((cost) => ({
      ...cost,
      voidedAt: at('2026-11-05'),
    }));
    expect(
      batchLedgerOf(roll, withLockedCosts(shop.records.stockMoves, voided)).costs.map(
        (c) => c.costCents,
      ),
    ).toEqual([6250, 3750]);
  });

  it('damage and below-cost sales are losses of their month; a voided sale counts nothing', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(800), 5000);
    shop.move(roll, 'loss', -30, '2026-10-12'); // T12: 480
    shop.sale(roll, '2026-10-14', 1000, dh(140)); // T11: 160 dh of cloth for 140
    const voided = shop.sale(roll, '2026-10-15', 1000, dh(200));
    shop.records.sales = shop.records.sales.map((sale) =>
      sale.id === voided.id ? { ...sale, voidedAt: at('2026-10-16') } : sale,
    );
    const voidedMove = shop.records.stockMoves.find(
      (move) => move.type === 'sale' && move.date === '2026-10-15',
    );
    if (!voidedMove) throw new Error('the voided sale has a move');
    shop.move(roll, 'reversal', 1000, '2026-10-16', voidedMove.id);
    expect(shop.preview('2026-10-31')).toMatchObject({
      damageCents: 480,
      belowCostCents: dh(20),
      recognizedProfitCents: 0,
      netProfitCents: -480 - dh(20),
      lockedCostCount: 2,
    });
  });

  it('the first period starts with the first record, or its month', () => {
    const shop = new Shop();
    shop.expense('2026-08-14', dh(10));
    expect(shop.preview('2026-10-31').periodStart).toBe('2026-08-14');
    expect(new Shop().preview('2026-10-31').periodStart).toBe('2026-10-01');
  });

  it('a period is settled once it has ended, after the last one, with the two partners', () => {
    const shop = new Shop();
    const refused = (periodEnd: string, today: string) => {
      const result = previewSettlement(shop.records, { periodEnd, today });
      return result.ok ? null : result.issues[0]?.message;
    };
    expect(refused('2026-10-31', '2026-10-31')).toBe(SETTLEMENT_ISSUES.notEnded);
    shop.settle('2026-10-31', '2026-11-02');
    expect(refused('2026-10-31', '2026-12-01')).toBe(SETTLEMENT_ISSUES.beforeLast);
    expect(refused('2026-10-15', '2026-12-01')).toBe(SETTLEMENT_ISSUES.beforeLast);
    shop.records.partners = shop.records.partners.slice(0, 1);
    expect(refused('2026-11-30', '2026-12-01')).toBe(SETTLEMENT_ISSUES.noPartners);
  });

  it('approving checks that the figures are still the ones the owner saw', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(1600), 10_000);
    shop.sale(roll, '2026-10-05', 10_000, dh(2000));
    const seen = shop.preview('2026-10-31').breakdown;
    shop.expense('2026-10-30', dh(100)); // arrives from another device after the preview
    const built = buildSettlement(
      shop.records,
      { periodEnd: '2026-10-31', expected: seen, today: '2026-11-02' },
      { settlementId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      { deviceId: 'server', now: at('2026-11-02') },
    );
    expect(built).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: SETTLEMENT_ISSUES.changed })],
    });
    const notEnded = buildSettlement(
      shop.records,
      { periodEnd: '2026-10-31', expected: seen, today: '2026-10-31' },
      { settlementId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      { deviceId: 'server', now: at('2026-10-31') },
    );
    expect(notEnded.ok).toBe(false);
  });

  it('a sale line without a cost is a broken record', () => {
    const shop = new Shop();
    shop.sale(shop.batch(dh(100), 1000), '2026-10-05', 100, dh(20));
    shop.records.stockMoves = shop.records.stockMoves.filter((move) => move.type !== 'sale');
    expect(() => shop.preview('2026-10-31')).toThrow(/has no cost/);
  });

  it('only the latest settlement is unlocked; locked dates are the ones up to its end', () => {
    const shop = new Shop();
    const october = shop.settle('2026-10-31');
    const november = shop.settle('2026-11-30');
    expect(checkUnlock(november.settlement, shop.records.settlements)).toEqual([]);
    expect(checkUnlock(october.settlement, shop.records.settlements)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.notLatest }),
    ]);
    expect(lockedThroughOf(shop.records.settlements)).toBe('2026-11-30');
    expect(lockedThroughOf([])).toBeNull();
    const unlocked = shop.records.settlements.map((s) =>
      s.id === november.settlement.id ? { ...s, voidedAt: at('2026-12-02') } : s,
    );
    expect(lockedThroughOf(unlocked)).toBe('2026-10-31');
    expect(
      checkUnlock({ ...november.settlement, voidedAt: at('2026-12-02') }, unlocked),
    ).toHaveLength(1);

    expect(periodLockIssues(['2026-11-30'], '2026-11-30')).toEqual([
      expect.objectContaining({ message: 'period_locked' }),
    ]);
    expect(periodLockIssues(['2026-12-01', null], '2026-11-30')).toEqual([]);
    expect(periodLockIssues(['2020-01-01'], null)).toEqual([]);
  });

  it('the dates a change is accounted on', () => {
    const shop = new Shop();
    const roll = shop.batch(dh(100), 1000);
    const sale = shop.sale(roll, '2026-10-05', 100, dh(20));
    const [move] = shop.records.stockMoves;
    if (!move) throw new Error('a move');
    expect(periodDatesOf('product_stock_move', move)).toEqual(['2026-09-01']);
    // A purchase is dated by its own date, whether the op carries the purchase with its stock or
    // is the correction of what was paid (its record).
    const [purchase] = shop.records.purchases;
    if (!purchase) throw new Error('a purchase');
    expect(periodDatesOf('purchase', purchase as never)).toEqual(['2026-09-01']);
    expect(periodDatesOf('purchase', { purchase } as never)).toEqual(['2026-09-01']);
    expect(
      periodDatesOf('write_off', {
        ...base('2026-10-25'),
        id: crypto.randomUUID(),
        saleId: sale.id,
        date: '2026-10-25',
        reason: 'x',
      }),
    ).toEqual(['2026-10-25']);
    shop.expense(null, 100);
    const [expense] = shop.records.expenses;
    if (!expense) throw new Error('an expense');
    expect(periodDatesOf('expense', expense)).toEqual([null]);
    expect(
      periodDatesOf('customer', {
        ...base('2026-10-01'),
        id: sale.id,
        name: 'x',
        phone: null,
        notes: null,
      }),
    ).toEqual([]);
  });
});

describe('profit split rules (SPEC §8.3)', () => {
  const rule = (effectiveFrom: string, weights = [1, 1, 1]): SplitRule => ({
    ...base('2026-10-01'),
    id: crypto.randomUUID(),
    effectiveFrom,
    ownerWeight: weights[0] ?? 0,
    partnerWeight: weights[1] ?? 0,
    shopWeight: weights[2] ?? 0,
    partnerWeights: null,
  });

  it('only in the future: never applied to a period that has started', () => {
    const context = {
      today: '2026-11-15',
      rules: [],
      partners: [
        { id: OWNER, isOwner: true, voidedAt: null },
        { id: PARTNER, isOwner: false, voidedAt: null },
      ],
    };
    expect(checkSplitRule(rule('2026-12-01'), undefined, context)).toEqual([]);
    expect(checkSplitRule(rule('2026-11-15'), undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleNotFuture }),
    ]);
    const started = rule('2026-11-01');
    expect(checkSplitRule({ ...started, effectiveFrom: '2027-01-01' }, started, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleNotFuture }),
    ]);
    expect(checkSplitRule(rule('2026-12-01', [0, 0, 0]), undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleAllZero }),
    ]);
    const december = rule('2026-12-01');
    expect(
      checkSplitRule(rule('2026-12-01'), undefined, { ...context, rules: [december] }),
    ).toEqual([expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleDateTaken })]);
    expect(checkSplitRule(december, december, { ...context, rules: [december] })).toEqual([]);
    expect(checkSplitRuleVoid(december, context.today)).toEqual([]);
    expect(checkSplitRuleVoid(started, context.today)).toHaveLength(1);
  });

  it('a rule from 15 November applies from December (S3); voided rules do not count', () => {
    const shop = new Shop();
    shop.sale(shop.batch(dh(400), 1000), '2026-11-05', 1000, dh(500));
    shop.records.splitRules.push(rule('2026-11-15', [2, 2, 1]));
    // The default belongs to the shop's first partner (S17): the same weights, now by name.
    const namedDefault = {
      ...DEFAULT_SPLIT_RULE,
      partnerWeights: [{ partnerId: PARTNER, weight: DEFAULT_SPLIT_RULE.partnerWeight }],
    };
    expect(splitRulesOf(shop.records.splitRules, shop.records.partners)[0]).toEqual(namedDefault);
    expect(shop.preview('2026-11-30')).toMatchObject({ ownerWeight: 1, shopShareCents: 3334 });
    shop.settle('2026-11-30');
    shop.sale(shop.batch(dh(400), 1000), '2026-12-05', 1000, dh(500));
    expect(shop.preview('2026-12-31')).toMatchObject({
      ownerWeight: 2,
      partnerWeight: 2,
      shopWeight: 1,
    });
    shop.records.splitRules = shop.records.splitRules.map((r) => ({
      ...r,
      voidedAt: at('2026-11-20'),
    }));
    expect(splitRulesOf(shop.records.splitRules, shop.records.partners)).toEqual([namedDefault]);
  });
});

describe('several partners (S17, S18)', () => {
  const THIRD = crypto.randomUUID();
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('missing record in the test shop');
    return value;
  };
  const partner = (id: string, createdOn: string, ownershipBp: number, name: string): Partner => ({
    ...base(createdOn),
    ...NO_CONTACT,
    id,
    name,
    ownershipBp,
    isOwner: false,
  });
  const rule = (
    effectiveFrom: string,
    ownerWeight: number,
    named: { partnerId: string; weight: number }[],
    shopWeight: number,
  ): SplitRule => ({
    ...base('2026-10-01'),
    id: crypto.randomUUID(),
    effectiveFrom,
    ownerWeight,
    partnerWeight: named.reduce((sum, { weight }) => sum + weight, 0),
    shopWeight,
    partnerWeights: named,
  });
  /** The owner (50%), the first partner (30%) and a partner who joined in October (20%). */
  const threeOwners = () => {
    const shop = new Shop();
    shop.records.partners = shop.records.partners.map((p) =>
      p.id === PARTNER ? { ...p, ownershipBp: 3000 } : p,
    );
    shop.records.partners.push(partner(THIRD, '2026-10-01', 2000, 'ثالث'));
    return shop;
  };

  it('the first partner is the earliest one live; ties go to the smaller id; the owner and voided partners never are', () => {
    const owner = need(new Shop().records.partners.find((p) => p.isOwner));
    const first = need(new Shop().records.partners.find((p) => p.id === PARTNER));
    const later = partner(THIRD, '2026-10-01', 0, 'ثالث');
    const nobody: Partner[] = [];
    expect(firstPartnerOf(nobody)).toBeUndefined();
    expect(firstPartnerOf([owner])).toBeUndefined();
    expect(firstPartnerOf([owner, later, first])?.id).toBe(PARTNER);
    const departed = { ...later, createdAt: at('2026-01-01'), voidedAt: at('2026-02-01') };
    expect(firstPartnerOf([departed, first])?.id).toBe(PARTNER);
    const ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
    const [low, high] = [need(ids[0]), need(ids[1])];
    const twins = [partner(high, '2026-10-01', 0, 'ب'), partner(low, '2026-10-01', 0, 'أ')];
    expect(firstPartnerOf(twins)?.id).toBe(low);
  });

  it('a rule that names no partners belongs to the first partner, the default included', () => {
    const shop = threeOwners();
    const unnamed: SplitRule = {
      ...rule('2026-12-01', 1, [], 1),
      partnerWeight: 2,
      partnerWeights: null,
    };
    expect(partnerWeightsOfRule(unnamed, shop.records.partners)).toEqual([
      { partnerId: PARTNER, weight: 2 },
    ]);
    const named = rule('2026-12-01', 1, [{ partnerId: THIRD, weight: 3 }], 1);
    expect(partnerWeightsOfRule(named, shop.records.partners)).toEqual([
      { partnerId: THIRD, weight: 3 },
    ]);
    expect(partnerWeightsOfRule(unnamed, [])).toEqual([]);
    shop.records.splitRules.push(unnamed);
    expect(splitRulesOf(shop.records.splitRules, shop.records.partners)).toEqual([
      { ...DEFAULT_SPLIT_RULE, partnerWeights: [{ partnerId: PARTNER, weight: 1 }] },
      {
        effectiveFrom: '2026-12-01',
        ownerWeight: 1,
        partnerWeight: 2,
        shopWeight: 1,
        partnerWeights: [{ partnerId: PARTNER, weight: 2 }],
      },
    ]);
  });

  it('a partner joins the profit from a day: the rule in force that day with them added, nothing else touched', () => {
    const shop = threeOwners();
    const { partners } = shop.records;
    // Nothing entered: the default thirds (owner 1, first partner 1, shop 1) plus the newcomer.
    expect(
      ruleWithPartnerWeight([], partners, {
        partnerId: THIRD,
        weight: 2,
        effectiveFrom: '2026-12-01',
      }),
    ).toEqual({
      id: null,
      rule: {
        effectiveFrom: '2026-12-01',
        ownerWeight: 1,
        partnerWeight: 3,
        shopWeight: 1,
        partnerWeights: [
          { partnerId: PARTNER, weight: 1 },
          { partnerId: THIRD, weight: 2 },
        ],
      },
    });

    // A rule already entered for that very day is changed in place, and one before it is the base.
    const before = rule('2026-11-20', 4, [{ partnerId: PARTNER, weight: 3 }], 2);
    const sameDay = rule('2026-12-01', 4, [{ partnerId: PARTNER, weight: 3 }], 2);
    const after = rule('2027-01-01', 1, [{ partnerId: PARTNER, weight: 1 }], 1);
    const built = ruleWithPartnerWeight([before, sameDay, after], partners, {
      partnerId: THIRD,
      weight: 1,
      effectiveFrom: '2026-12-01',
    });
    expect(built.id).toBe(sameDay.id);
    expect(built.rule).toEqual({
      effectiveFrom: '2026-12-01',
      ownerWeight: 4,
      partnerWeight: 4,
      shopWeight: 2,
      partnerWeights: [
        { partnerId: PARTNER, weight: 3 },
        { partnerId: THIRD, weight: 1 },
      ],
    });
    // The later rule is left as it is.
    expect(after.partnerWeights).toEqual([{ partnerId: PARTNER, weight: 1 }]);

    // A partner already named has their weight replaced (0 takes them out from that day).
    const left = ruleWithPartnerWeight(
      [
        rule(
          '2026-12-01',
          1,
          [
            { partnerId: PARTNER, weight: 1 },
            { partnerId: THIRD, weight: 1 },
          ],
          1,
        ),
      ],
      partners,
      { partnerId: THIRD, weight: 0, effectiveFrom: '2027-02-01' },
    );
    expect(left.id).toBeNull();
    expect(left.rule.partnerWeights).toEqual([
      { partnerId: PARTNER, weight: 1 },
      { partnerId: THIRD, weight: 0 },
    ]);
    expect(left.rule.partnerWeight).toBe(1);

    // What it builds is a rule the server accepts, saved over the one of that day.
    expect(
      checkSplitRule({ id: sameDay.id, ...built.rule }, sameDay, {
        today: '2026-11-15',
        rules: [before, sameDay, after],
        partners,
      }),
    ).toEqual([]);
  });

  it('checkSplitRule asks several partners for a weight each, all of them real, adding up', () => {
    const shop = threeOwners();
    const context = { today: '2026-11-15', rules: [], partners: shop.records.partners };
    const ok = rule(
      '2026-12-01',
      2,
      [
        { partnerId: PARTNER, weight: 3 },
        { partnerId: THIRD, weight: 1 },
      ],
      2,
    );
    expect(checkSplitRule(ok, undefined, context)).toEqual([]);

    const unnamed: SplitRule = { ...ok, partnerWeights: null };
    expect(checkSplitRule(unnamed, undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleNeedsPartners }),
    ]);
    // A shop with one partner may leave them unnamed (a rule made before the second joined).
    expect(
      checkSplitRule(unnamed, undefined, {
        ...context,
        partners: shop.records.partners.filter((p) => p.id !== THIRD),
      }),
    ).toEqual([]);

    const stranger = { ...ok, partnerWeights: [{ partnerId: crypto.randomUUID(), weight: 4 }] };
    expect(checkSplitRule(stranger, undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
    const owner = { ...ok, partnerWeights: [{ partnerId: OWNER, weight: 4 }] };
    expect(checkSplitRule(owner, undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
    const twice = {
      ...ok,
      partnerWeights: [
        { partnerId: PARTNER, weight: 2 },
        { partnerId: PARTNER, weight: 2 },
      ],
    };
    expect(checkSplitRule(twice, undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
    expect(checkSplitRule({ ...ok, partnerWeight: 5 }, undefined, context)).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleWeightsMismatch }),
    ]);
    // A voided partner is no partner.
    const voided = shop.records.partners.map((p) =>
      p.id === THIRD ? { ...p, voidedAt: at('2026-11-01') } : p,
    );
    expect(checkSplitRule(ok, undefined, { ...context, partners: voided })).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
  });

  it('a partner who joined later takes no part in a period settled with the default rule', () => {
    const shop = threeOwners();
    shop.sale(shop.batch(dh(400), 1000), '2026-11-05', 1000, dh(500) + 1);
    const preview = shop.preview('2026-11-30');
    // 100.01 dh in thirds: 33.33 / 33.33 / the shop's 33.35 (the division cents).
    expect(preview).toMatchObject({
      netProfitCents: 10_001,
      ownerShareCents: 3333,
      partnerShareCents: 3333,
      shopShareCents: 3335,
      partnerWeight: 1,
      partnerWeights: [
        { partnerId: PARTNER, weight: 1 },
        { partnerId: THIRD, weight: 0 },
      ].sort((a, b) => (a.partnerId < b.partnerId ? -1 : 1)),
    });
    expect(Object.fromEntries(preview.shares.map((s) => [s.partnerId, s.amountCents]))).toEqual({
      [OWNER]: 3333,
      [PARTNER]: 3333,
    });
    // The shop's part stays as capital, by ownership 50 / 30 / 20 (largest remainder).
    expect(
      Object.fromEntries(preview.retainedProfit.map((m) => [m.partnerId, m.amountCents])),
    ).toEqual({ [OWNER]: 1668, [PARTNER]: 1000, [THIRD]: 667 });
  });

  it('a rule that names every partner splits the net in one go; the shares and the capital add up', () => {
    const shop = threeOwners();
    shop.sale(shop.batch(dh(400), 1000), '2026-11-05', 1000, dh(500) + 1);
    shop.records.splitRules.push(
      rule(
        '2026-11-01',
        1,
        [
          { partnerId: PARTNER, weight: 1 },
          { partnerId: THIRD, weight: 1 },
        ],
        1,
      ),
    );
    const aggregate = shop.settle('2026-11-30');
    // 100.01 dh in four: 25.00 each and the odd cent to the shop.
    const shares = Object.fromEntries(aggregate.shares.map((s) => [s.partnerId, s.amountCents]));
    expect(shares).toEqual({ [OWNER]: 2500, [PARTNER]: 2500, [THIRD]: 2500 });
    expect(aggregate.settlement).toMatchObject({
      netProfitCents: 10_001,
      ownerShareCents: 2500,
      partnerShareCents: 5000,
      shopShareCents: 2501,
    });
    const retained = Object.fromEntries(
      aggregate.retainedProfit.map((m) => [m.partnerId, m.amountCents]),
    );
    expect(retained).toEqual({ [OWNER]: 1251, [PARTNER]: 750, [THIRD]: 500 });
    expect(Object.values(retained).reduce((sum, cents) => sum + cents, 0)).toBe(2501);
  });

  it('refuses to settle with a rule that names someone who is not a partner', () => {
    const shop = threeOwners();
    shop.sale(shop.batch(dh(400), 1000), '2026-11-05', 1000, dh(500));
    shop.records.splitRules.push(
      rule('2026-11-01', 1, [{ partnerId: crypto.randomUUID(), weight: 1 }], 1),
    );
    expect(
      previewSettlement(shop.records, { periodEnd: '2026-11-30', today: '2027-01-15' }),
    ).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleMismatch })],
    });
  });

  it('partners are active while they own a part or share in the profit from now on (S18)', () => {
    const shop = threeOwners();
    const partners = shop.records.partners;
    const owner = need(partners.find((p) => p.isOwner));
    const first = need(partners.find((p) => p.id === PARTNER));
    const third = need(partners.find((p) => p.id === THIRD));
    const today = '2026-11-15';
    const status = (who: Pick<Partner, 'id' | 'isOwner' | 'ownershipBp'>, rules: SplitRule[]) =>
      partnerStatusOf(who, rules, partners, today);

    // The owner always is; an owner of a part always is.
    expect(status({ ...owner, ownershipBp: 0 }, [])).toBe('active');
    expect(status(third, [])).toBe('active');
    // No ownership: only the rules count. The default rule is the first partner's.
    expect(status({ ...first, ownershipBp: 0 }, [])).toBe('active');
    expect(status({ ...third, ownershipBp: 0 }, [])).toBe('inactive');
    const names = (partnerId: string, weight: number) => [{ partnerId, weight }];
    // A rule in force that names them.
    const inForce = rule('2026-11-01', 1, names(THIRD, 2), 1);
    expect(status({ ...third, ownershipBp: 0 }, [inForce])).toBe('active');
    // A later rule gives them a weight; the one in force does not.
    const dropped = rule('2026-11-01', 1, names(PARTNER, 1), 1);
    const comeback = rule('2027-01-01', 1, names(THIRD, 1), 1);
    expect(status({ ...third, ownershipBp: 0 }, [dropped])).toBe('inactive');
    expect(status({ ...third, ownershipBp: 0 }, [dropped, comeback])).toBe('active');
    // The first partner, dropped by the rule in force (weight 0 there): out, no matter an older rule.
    const gone = rule('2026-11-01', 1, [{ partnerId: PARTNER, weight: 0 }, ...names(THIRD, 1)], 1);
    expect(status({ ...first, ownershipBp: 0 }, [gone])).toBe('inactive');
  });

  describe('removing a partner (S19)', () => {
    const none = { capitalMoves: [], draws: [], shares: [], rules: [] };
    const issuesOf = (
      partnerId: string,
      partners: Partner[],
      records: Partial<Parameters<typeof checkPartnerVoid>[1]> = {},
    ) =>
      checkPartnerVoid(partnerId, { partners, ...none, ...records }).map(({ message }) => message);
    /** The third partner has given their part away and takes no part in the profit. */
    const settledUp = () => {
      const { partners } = threeOwners().records;
      return partners.map((p) => (p.id === THIRD ? { ...p, ownershipBp: 0 } : p));
    };

    it('the owner stays, and so do people who are not partners or are already removed', () => {
      const { partners } = threeOwners().records;
      expect(issuesOf(OWNER, partners)).toEqual([PARTNER_ISSUES.ownerStays]);
      expect(issuesOf(crypto.randomUUID(), partners)).toEqual([]);
      const departed = partners.map((p) =>
        p.id === THIRD ? { ...p, voidedAt: at('2026-11-01') } : p,
      );
      expect(issuesOf(THIRD, departed)).toEqual([]);
    });

    it('a partner who took part in nothing can be removed', () => {
      expect(issuesOf(THIRD, settledUp())).toEqual([]);
    });

    it('a partner who still owns part of the shop stays until the parts are given to others', () => {
      const { partners } = threeOwners().records;
      expect(issuesOf(THIRD, partners)).toEqual([PARTNER_ISSUES.hasOwnership]);
    });

    it('capital, draws and settlement shares keep the partner; voided ones do not', () => {
      const partners = settledUp();
      const mine = { partnerId: THIRD, voidedAt: null };
      const voided = { partnerId: THIRD, voidedAt: at('2026-11-02') };
      const others = { partnerId: PARTNER, voidedAt: null };
      for (const records of [{ capitalMoves: [mine] }, { draws: [mine] }, { shares: [mine] }]) {
        expect(issuesOf(THIRD, partners, records)).toEqual([PARTNER_ISSUES.hasRecords]);
      }
      expect(
        issuesOf(THIRD, partners, { capitalMoves: [voided], draws: [voided], shares: [others] }),
      ).toEqual([]);
    });

    it('a profit rule that gives them a weight keeps them; a weight of 0 or a voided rule does not', () => {
      const partners = settledUp();
      const given = rule('2026-11-01', 1, [{ partnerId: THIRD, weight: 2 }], 1);
      const zero = rule(
        '2026-11-01',
        1,
        [
          { partnerId: PARTNER, weight: 1 },
          { partnerId: THIRD, weight: 0 },
        ],
        1,
      );
      const cancelled = { ...given, voidedAt: at('2026-11-03') };
      expect(issuesOf(THIRD, partners, { rules: [given] })).toEqual([PARTNER_ISSUES.inProfitSplit]);
      expect(issuesOf(THIRD, partners, { rules: [zero, cancelled] })).toEqual([]);
    });

    it('the first partner holds every rule that names no one, so they stay while others are partners', () => {
      const { partners } = threeOwners().records;
      const free = partners.map((p) => (p.ownershipBp > 0 ? { ...p, ownershipBp: 0 } : p));
      // PARTNER is first of two partners: blocked. Alone, nobody else would take those rules.
      expect(issuesOf(PARTNER, free)).toEqual([PARTNER_ISSUES.inProfitSplit]);
      const alone = free.map((p) => (p.id === THIRD ? { ...p, voidedAt: at('2026-11-01') } : p));
      expect(issuesOf(PARTNER, alone)).toEqual([]);
    });

    it('lists every reason that applies', () => {
      const { partners } = threeOwners().records;
      const mine = { partnerId: THIRD, voidedAt: null };
      const given = rule('2026-11-01', 1, [{ partnerId: THIRD, weight: 1 }], 1);
      expect(issuesOf(THIRD, partners, { draws: [mine], rules: [given] })).toEqual([
        PARTNER_ISSUES.hasOwnership,
        PARTNER_ISSUES.hasRecords,
        PARTNER_ISSUES.inProfitSplit,
      ]);
    });

    it('after the removal their zero weights drop out of the rules, so the settlement still runs', () => {
      const shop = threeOwners();
      shop.sale(shop.batch(dh(400), 1000), '2026-11-05', 1000, dh(500));
      shop.records.partners = shop.records.partners.map((p) =>
        p.id === THIRD
          ? { ...p, ownershipBp: 0, voidedAt: at('2026-11-10') }
          : p.id === PARTNER
            ? { ...p, ownershipBp: 5000 }
            : p,
      );
      const withZero = rule(
        '2026-11-01',
        1,
        [
          { partnerId: PARTNER, weight: 1 },
          { partnerId: THIRD, weight: 0 },
        ],
        1,
      );
      shop.records.splitRules.push(withZero);
      expect(
        splitRulesOf(shop.records.splitRules, shop.records.partners)[1]?.partnerWeights,
      ).toEqual([{ partnerId: PARTNER, weight: 1 }]);
      expect(partnerWeightsOfRule(withZero, shop.records.partners)).toEqual([
        { partnerId: PARTNER, weight: 1 },
      ]);
      expect(
        previewSettlement(shop.records, { periodEnd: '2026-11-30', today: '2027-01-15' }).ok,
      ).toBe(true);
    });

    it('a weight above 0 for someone removed is kept, so core refuses the rule instead of dropping it', () => {
      const shop = threeOwners();
      shop.records.partners = shop.records.partners.map((p) =>
        p.id === THIRD ? { ...p, ownershipBp: 0, voidedAt: at('2026-11-10') } : p,
      );
      const stranded = rule('2026-11-01', 1, [{ partnerId: THIRD, weight: 1 }], 1);
      expect(partnerWeightsOfRule(stranded, shop.records.partners)).toEqual([
        { partnerId: THIRD, weight: 1 },
      ]);
    });
  });
});
