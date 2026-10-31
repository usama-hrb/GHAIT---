import { describe, expect, it } from 'vitest';
import {
  breakdownOf,
  buildSettlement,
  checkSplitRule,
  checkSplitRuleVoid,
  checkUnlock,
  DEFAULT_SPLIT_RULE,
  lockedThroughOf,
  periodDatesOf,
  periodLockIssues,
  previewSettlement,
  rollLedgerOf,
  SETTLEMENT_ISSUES,
  type SplitRule,
  splitRulesOf,
  withLockedCosts,
} from './index.js';

import { at, base, dh, OWNER, PARTNER, Shop } from './test-shop.js';

describe('settlement from the records (BUILD_PROMPTS 4.3)', () => {
  it('T6 + T10: 100 m costing 1600 dh sold for 2000 dh, 100 dh of expenses', () => {
    const shop = new Shop();
    const roll = shop.roll(dh(1600), 10_000);
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
    const roll = shop.roll(dh(1400), 10_000);
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
    shop.sale(shop.roll(dh(400), 1000), '2026-10-05', 1000, dh(500));
    expect(shop.preview('2026-10-31')).toMatchObject({
      ownerShareCents: 3333,
      partnerShareCents: 3333,
      shopShareCents: 3334,
    });
  });

  it('T9: a losing October carries its deficit into November, which starts the day after', () => {
    const shop = new Shop();
    const roll = shop.roll(dh(1400), 10_000);
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
    const sale = shop.sale(shop.roll(dh(160), 1000), '2026-10-20', 1000, dh(200), dh(100));
    expect(shop.settle('2026-10-31').settlement.recognizedProfitCents).toBe(0);
    shop.pay(sale, '2026-11-05', dh(100));
    expect(shop.preview('2026-11-30').recognizedProfitCents).toBe(dh(40));
  });

  it('a bad debt, then its recovery in a later month (S5)', () => {
    const shop = new Shop();
    const sale = shop.sale(shop.roll(dh(160), 1000), '2026-10-20', 1000, dh(200), dh(100));
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
    const roll = shop.roll(dh(100), 1000, true);
    shop.sale(roll, '2026-10-05', 500, dh(80));
    expect(shop.settle('2026-10-31').lockedCosts.map((cost) => cost.costCents)).toEqual([dh(50)]);

    // Measured in November: 800 cm in all. Unfrozen, October's half would now cost 62.50 dh.
    shop.move(roll, 'length_correction', -200, '2026-11-02');
    shop.sale(roll, '2026-11-03', 300, dh(70));
    const ledger = rollLedgerOf(
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
      rollLedgerOf(roll, withLockedCosts(shop.records.stockMoves, voided)).costs.map(
        (c) => c.costCents,
      ),
    ).toEqual([6250, 3750]);
  });

  it('damage and below-cost sales are losses of their month; a voided sale counts nothing', () => {
    const shop = new Shop();
    const roll = shop.roll(dh(800), 5000);
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
    const roll = shop.roll(dh(1600), 10_000);
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
    shop.sale(shop.roll(dh(100), 1000), '2026-10-05', 100, dh(20));
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
    const roll = shop.roll(dh(100), 1000);
    const sale = shop.sale(roll, '2026-10-05', 100, dh(20));
    const [move] = shop.records.stockMoves;
    if (!move) throw new Error('a move');
    expect(periodDatesOf('stock_move', move)).toEqual(['2026-09-01']);
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
  });

  it('only in the future: never applied to a period that has started', () => {
    const context = { today: '2026-11-15', rules: [] };
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
    shop.sale(shop.roll(dh(400), 1000), '2026-11-05', 1000, dh(500));
    shop.records.splitRules.push(rule('2026-11-15', [2, 2, 1]));
    expect(splitRulesOf(shop.records.splitRules)[0]).toEqual(DEFAULT_SPLIT_RULE);
    expect(shop.preview('2026-11-30')).toMatchObject({ ownerWeight: 1, shopShareCents: 3334 });
    shop.settle('2026-11-30');
    shop.sale(shop.roll(dh(400), 1000), '2026-12-05', 1000, dh(500));
    expect(shop.preview('2026-12-31')).toMatchObject({
      ownerWeight: 2,
      partnerWeight: 2,
      shopWeight: 1,
    });
    shop.records.splitRules = shop.records.splitRules.map((r) => ({
      ...r,
      voidedAt: at('2026-11-20'),
    }));
    expect(splitRulesOf(shop.records.splitRules)).toEqual([DEFAULT_SPLIT_RULE]);
  });
});
