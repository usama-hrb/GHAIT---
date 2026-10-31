import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import {
  cashBalanceCents,
  checkIntegrity,
  type IntegrityState,
  receivablesPosition,
  stockAtCostCents,
} from './check.js';
import {
  applyEvent,
  emptyLedger,
  integrityStateOf,
  type Ledger,
  periodDates,
  periodResult,
  runScenario,
  type ScenarioEvent,
} from './scenario.js';

const dh = fromDirham;
const check = (ledger: Ledger) => checkIntegrity(integrityStateOf(ledger));

// T13: purchase, cash sale, credit sale, payment, expense, loss, draw, settlement.
const T13: ScenarioEvent[] = [
  { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
  { type: 'contribution', partner: 'partner', amountCents: dh(1000) },
  { type: 'purchase', lengthCm: 5000, costCents: dh(800) }, // 50 m at 16 dh (T12's roll)
  { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(20), paidCents: dh(200) },
  { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(20), paidCents: 0 },
  { type: 'payment', sale: 1, amountCents: dh(100) },
  { type: 'expense', amountCents: dh(10) },
  { type: 'loss', roll: 0, lengthCm: 30 }, // T12: 480
  { type: 'draw', partner: 'owner', amountCents: dh(20) },
  { type: 'settlement' },
];

describe('checkIntegrity (SPEC §9)', () => {
  it('T13: balances to the cent after every event of the sequence', () => {
    const ledger = emptyLedger();
    for (const event of T13) {
      applyEvent(ledger, event);
      expect(check(ledger)).toMatchObject({ ok: true, diffCents: 0 });
    }
  });

  it('T13: the two sides, before and after the settlement', () => {
    const beforeSettlement = runScenario(T13.slice(0, -1));
    expect(integrityStateOf(beforeSettlement)).toEqual({
      cashCents: 147_000, // 2000 − 800 + 200 + 100 − 10 − 20 dh
      stockAtCostCents: 47_520, // 80000 − 16000 − 16000 − 480
      unrecoveredCapitalCents: 6000, // 160 dh capital, 100 dh recovered
      capitalCents: 200_000,
      partnerBalancesCents: -2000, // the owner drew 20 dh before any settlement
      unsettledNetProfitCents: 2520, // 40 dh profit − 4.80 loss − 10 expense
      customerCreditsCents: 0,
    } satisfies IntegrityState);

    const settled = runScenario(T13);
    expect(settled.settlements[0]).toMatchObject({
      netProfitCents: 2520,
      ownerShareCents: 840,
      partnerShareCents: 840,
      shopShareCents: 840,
    });
    const result = check(settled);
    expect(result).toMatchObject({ ok: true, holdingsCents: 200_520, claimsCents: 200_520 });
    expect(result.breakdown).toEqual([
      { side: 'holdings', key: 'cash', cents: 147_000 },
      { side: 'holdings', key: 'stock_at_cost', cents: 47_520 },
      { side: 'holdings', key: 'unrecovered_capital', cents: 6000 },
      { side: 'claims', key: 'capital', cents: 200_840 }, // + the shop third
      { side: 'claims', key: 'partner_balances', cents: -320 }, // 840 − 2000 + 840
      { side: 'claims', key: 'unsettled_net_profit', cents: 0 },
      { side: 'claims', key: 'customer_credits', cents: 0 },
    ]);
  });

  it('T13: the rest of the credit sale, paid next month, is that month’s profit', () => {
    const ledger = runScenario([...T13, { type: 'payment', sale: 1, amountCents: dh(100) }]);
    expect(integrityStateOf(ledger)).toMatchObject({
      unrecoveredCapitalCents: 0,
      unsettledNetProfitCents: 4000,
    });
    expect(check(ledger).ok).toBe(true);
  });

  it('T13: an error entered on purpose shows as a difference', () => {
    const ledger = runScenario(T13);
    const expense = ledger.expenses[0];
    if (!expense) throw new Error('T13 has an expense');
    expense.amountCents += 500; // edited after its period was settled
    expect(check(ledger)).toMatchObject({ ok: false, diffCents: -500 });
  });

  it('a bad debt loses only its unrecovered capital (S5)', () => {
    const events: ScenarioEvent[] = [
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'purchase', lengthCm: 1000, costCents: dh(160) },
      { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(20), paidCents: dh(100) }, // T8
      { type: 'write_off', sale: 0 },
    ];
    const ledger = runScenario(events);
    expect(ledger.writeOffs).toEqual([{ sale: 0, period: 0 }]);
    // 60 dh, not the 100 dh due: the 40 dh of profit in it were never recognised.
    expect(periodResult(ledger, 0).losses.badDebtCents).toBe(dh(60));
    expect(check(ledger).ok).toBe(true);
  });

  it('a bad debt paid the next month: its capital is a gain of that month, the rest profit (S5)', () => {
    const ledger = runScenario([
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'purchase', lengthCm: 1000, costCents: dh(160) },
      { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(20), paidCents: dh(100) },
      { type: 'write_off', sale: 0 },
      { type: 'settlement' },
      { type: 'recovery', sale: 0, amountCents: dh(150) }, // 50 dh more than was due: credit
    ]);
    expect(periodResult(ledger, 1)).toMatchObject({
      recoveredBadDebtCents: dh(60),
      recognizedProfitCents: dh(40),
    });
    expect(integrityStateOf(ledger).customerCreditsCents).toBe(dh(50));
    expect(check(ledger).ok).toBe(true);
  });

  it('an overpayment is held for the customer (I1), so it is a claim', () => {
    const ledger = runScenario([
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'purchase', lengthCm: 1000, costCents: dh(160) },
      { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(20), paidCents: dh(250) },
    ]);
    const result = check(ledger);
    expect(result.ok).toBe(true);
    expect(result.breakdown).toContainEqual({
      side: 'claims',
      key: 'customer_credits',
      cents: dh(50),
    });
  });

  it('a below-cost credit sale loses its negative part at once (P3)', () => {
    const ledger = runScenario([
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'purchase', lengthCm: 1000, costCents: dh(160) },
      { type: 'sale', roll: 0, soldCm: 1000, pricePerMeterCents: dh(14), paidCents: 0 }, // T11
    ]);
    expect(integrityStateOf(ledger)).toMatchObject({
      unrecoveredCapitalCents: dh(140),
      unsettledNetProfitCents: dh(-20),
    });
    expect(check(ledger).ok).toBe(true);
  });

  it('a losing month carries its deficit in the claims until a later month covers it', () => {
    const ledger = runScenario([
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'expense', amountCents: dh(100) },
      { type: 'settlement' },
    ]);
    expect(ledger.settlements[0]?.carryDeficitOutCents).toBe(dh(100));
    expect(integrityStateOf(ledger).unsettledNetProfitCents).toBe(dh(-100));
    expect(check(ledger).ok).toBe(true);
  });

  it('a cash count short of the books lowers the cash and the period result alike (I2)', () => {
    const ledger = runScenario([
      { type: 'contribution', partner: 'owner', amountCents: dh(1000) },
      { type: 'cash_count', differenceCents: dh(-30) },
      { type: 'cash_count', differenceCents: dh(-5000) }, // more than the till holds
    ]);
    expect(ledger.cashAdjustments).toEqual([
      { diffCents: dh(-30), period: 0 },
      { diffCents: dh(-970), period: 0 },
    ]);
    expect(integrityStateOf(ledger)).toMatchObject({
      cashCents: 0,
      unsettledNetProfitCents: dh(-1000),
    });
    expect(check(ledger).ok).toBe(true);
  });

  it('skips events that cannot apply', () => {
    const ledger = runScenario([
      { type: 'purchase', lengthCm: 100, costCents: 100 }, // no cash yet
      { type: 'expense', amountCents: 100 },
      { type: 'draw', partner: 'partner', amountCents: 100 },
      { type: 'sale', roll: 0, soldCm: 10, pricePerMeterCents: 100, paidCents: 0 }, // no roll
      { type: 'loss', roll: 0, lengthCm: 10 },
      { type: 'payment', sale: 0, amountCents: 100 }, // no sale
      { type: 'write_off', sale: 0 },
      { type: 'recovery', sale: 0, amountCents: 100 }, // nothing written off
      { type: 'cash_count', differenceCents: 0 },
      { type: 'cash_count', differenceCents: -100 }, // nothing in the till to be short of
    ]);
    expect(ledger).toEqual(emptyLedger());
  });

  const amount = fc.nat({ max: 5_000_000 });
  const role = fc.constantFrom('owner' as const, 'partner' as const);
  const event: fc.Arbitrary<ScenarioEvent> = fc.oneof(
    fc.record({ type: fc.constant('contribution' as const), partner: role, amountCents: amount }),
    fc.record({
      type: fc.constant('purchase' as const),
      lengthCm: fc.nat({ max: 10_000 }),
      costCents: amount,
    }),
    fc.record({
      type: fc.constant('sale' as const),
      roll: fc.nat(),
      soldCm: fc.nat({ max: 5000 }),
      pricePerMeterCents: fc.nat({ max: 10_000 }),
      paidCents: fc.oneof(fc.constant(0), amount),
    }),
    fc.record({ type: fc.constant('payment' as const), sale: fc.nat(), amountCents: amount }),
    fc.record({ type: fc.constant('expense' as const), amountCents: amount }),
    fc.record({
      type: fc.constant('loss' as const),
      roll: fc.nat(),
      lengthCm: fc.nat({ max: 500 }),
    }),
    fc.record({ type: fc.constant('write_off' as const), sale: fc.nat() }),
    fc.record({ type: fc.constant('recovery' as const), sale: fc.nat(), amountCents: amount }),
    fc.record({ type: fc.constant('draw' as const), partner: role, amountCents: amount }),
    fc.record({
      type: fc.constant('cash_count' as const),
      differenceCents: fc.integer({ min: -100_000, max: 100_000 }),
    }),
    fc.record({ type: fc.constant('settlement' as const) }),
  );
  // Every history starts with cash and a roll, so there is always something to corrupt.
  const history = fc
    .array(event, { maxLength: 40 })
    .map((events): ScenarioEvent[] => [
      { type: 'contribution', partner: 'owner', amountCents: dh(10_000) },
      { type: 'purchase', lengthCm: 5000, costCents: dh(800) },
      ...events,
    ]);

  it('property: any valid history balances after every event', () => {
    fc.assert(
      fc.property(history, fc.integer({ min: 0, max: 10_000 }), (events, ownerBp) => {
        const ledger = emptyLedger(ownerBp);
        for (const next of events) {
          applyEvent(ledger, next);
          expect(check(ledger).diffCents).toBe(0);
        }
      }),
    );
  });

  /** Each corruption changes one record and returns the difference it must cause. */
  const corruptions: Record<
    string,
    (ledger: Ledger, pick: number, delta: number) => number | null
  > = {
    'a roll whose cost no longer matches its purchase': (ledger, pick, delta) => {
      const roll = ledger.rolls[pick % ledger.rolls.length];
      if (!roll) return null;
      roll.costTotalCents += delta;
      return delta;
    },
    'a purchase paid amount edited': (ledger, pick, delta) => {
      const purchase = ledger.purchases[pick % ledger.purchases.length];
      if (!purchase) return null;
      purchase.paidCents += delta;
      return -delta;
    },
    'an expense edited after its period was settled': (ledger, pick, delta) => {
      const settled = ledger.expenses.filter((expense) => expense.period < ledger.period);
      const expense = settled[pick % Math.max(1, settled.length)];
      if (!expense) return null;
      expense.amountCents += delta;
      return -delta;
    },
    'a loss reduced after its period was settled': (ledger, pick, delta) => {
      const settled = ledger.lossMoves.filter(
        (move) => move.period < ledger.period && move.costCents > 0,
      );
      const move = settled[pick % Math.max(1, settled.length)];
      if (!move) return null;
      const reduction = 1 + (delta % move.costCents);
      move.costCents -= reduction;
      return reduction;
    },
    'a cash count edited after its period was settled': (ledger, pick, delta) => {
      const settled = ledger.cashAdjustments.filter((count) => count.period < ledger.period);
      const count = settled[pick % Math.max(1, settled.length)];
      if (!count) return null;
      count.diffCents += delta;
      return delta;
    },
    'a settlement share edited': (ledger, pick, delta) => {
      const shares = ledger.settlements.flatMap((settlement) => settlement.partnerShares);
      const share = shares[pick % Math.max(1, shares.length)];
      if (!share) return null;
      share.amountCents += delta;
      return -delta;
    },
    'a retained-profit capital move edited': (ledger, pick, delta) => {
      const retained = ledger.capitalMoves.filter((move) => move.type === 'retained_profit');
      const move = retained[pick % Math.max(1, retained.length)];
      if (!move) return null;
      move.amountCents += delta;
      return -delta;
    },
  };

  it('property: corrupting a single record shows exactly that amount as the difference', () => {
    const kinds = Object.entries(corruptions);
    fc.assert(
      fc.property(
        history,
        fc.nat({ max: kinds.length - 1 }),
        fc.nat(),
        fc.integer({ min: 1, max: 1_000_000 }),
        (events, kind, pick, delta) => {
          const ledger = runScenario(events);
          const [, corrupt] = kinds[kind] ?? [];
          const expected = corrupt?.(ledger, pick, delta) ?? null;
          fc.pre(expected !== null);
          expect(check(ledger)).toMatchObject({ ok: false, diffCents: expected });
        },
      ),
    );
  });

  it('rejects amounts that cannot be negative, and non-integers', () => {
    const state = integrityStateOf(runScenario(T13));
    expect(() => checkIntegrity({ ...state, stockAtCostCents: -1 })).toThrow(
      'stockAtCostCents must be >= 0',
    );
    expect(() => checkIntegrity({ ...state, unrecoveredCapitalCents: -1 })).toThrow(
      'unrecoveredCapitalCents must be >= 0',
    );
    expect(() => checkIntegrity({ ...state, customerCreditsCents: -1 })).toThrow(
      'customerCreditsCents must be >= 0',
    );
    expect(() => checkIntegrity({ ...state, cashCents: 0.5 })).toThrow(
      'cashCents must be a safe integer',
    );
    // Cash, capital, balances and unsettled profit may be negative: the check reports, it does not judge.
    expect(checkIntegrity({ ...state, cashCents: state.cashCents - 300_000 }).diffCents).toBe(
      -300_000,
    );
  });
});

describe('integrity amounts', () => {
  it('cashBalanceCents: in − out', () => {
    expect(
      cashBalanceCents({
        customerPaymentsCents: 30_000,
        customerRefundsCents: 3000,
        contributionsCents: 200_000,
        capitalWithdrawalsCents: 10_000,
        purchasesPaidCents: 80_000,
        expensesPaidCents: 1000,
        drawsCents: 2000,
        cashAdjustmentsCents: -500,
      }),
    ).toBe(133_500);
    expect(() =>
      cashBalanceCents({
        customerPaymentsCents: -1,
        customerRefundsCents: 0,
        contributionsCents: 0,
        capitalWithdrawalsCents: 0,
        purchasesPaidCents: 0,
        expensesPaidCents: 0,
        drawsCents: 0,
        cashAdjustmentsCents: 0,
      }),
    ).toThrow('customerPaymentsCents must be >= 0');
  });

  it('stockAtCostCents: Σ (roll cost − allocated costs), exact (T3)', () => {
    expect(
      stockAtCostCents([
        { costTotalCents: 10_000, allocatedCostsCents: [4348, 4348] },
        { costTotalCents: 80_000, allocatedCostsCents: [480] },
        { costTotalCents: 10_000, allocatedCostsCents: [4348, 4348, 1304] },
      ]),
    ).toBe(1304 + 79_520);
  });

  it('receivablesPosition: unrecovered capital of open invoices, and overpayments', () => {
    expect(
      receivablesPosition([
        { totalCents: 20_000, capitalCents: 16_000, paymentsCents: [10_000] }, // T8
        { totalCents: 20_000, capitalCents: 16_000, paymentsCents: [25_000] },
        { totalCents: 14_000, capitalCents: 16_000, paymentsCents: [] }, // T11
        { totalCents: 20_000, capitalCents: 16_000, paymentsCents: [], writtenOff: true },
      ]),
    ).toEqual({ unrecoveredCapitalCents: 6000 + 14_000, customerCreditsCents: 5000 });
  });

  it('periodDates: month n from January 2026', () => {
    expect(periodDates(0)).toEqual({ periodStart: '2026-01-01', periodEnd: '2026-01-28' });
    expect(periodDates(13)).toEqual({ periodStart: '2027-02-01', periodEnd: '2027-02-28' });
  });
});
