import { describe, expect, it } from 'vitest';
import {
  CASH_COUNT_ISSUES,
  cashCountFieldsOf,
  checkCashAdjustment,
  integrityReportOf,
  integrityStateOf,
  newCashCountSchema,
} from './index.js';
import { base, dh, OWNER, PARTNER, Shop } from './test-shop.js';

/** T13 (SPEC §16): contributions, a purchase, a cash and a credit sale, a payment, an expense, a loss, a draw. */
function t13(): Shop {
  const shop = new Shop();
  shop.contribute(OWNER, dh(1000));
  shop.contribute(PARTNER, dh(1000));
  const roll = shop.roll(dh(800), 5000); // 50 m at 16 dh (T12's roll)
  shop.sale(roll, '2026-09-05', 1000, dh(200)); // cash
  const credit = shop.sale(roll, '2026-09-06', 1000, dh(200), 0);
  shop.pay(credit, '2026-09-10', dh(100));
  shop.expense('2026-09-12', dh(10));
  shop.move(roll, 'loss', -30, '2026-09-15'); // T12: 480
  shop.draw(OWNER, dh(20), '2026-09-20');
  return shop;
}

describe('the integrity check from the records (SPEC §9, BUILD_PROMPTS 4.4)', () => {
  it('T13: balances before and after the settlement, every amount as core computes it', () => {
    const shop = t13();
    expect(integrityStateOf(shop.records)).toEqual({
      cashCents: 147_000,
      stockAtCostCents: 47_520,
      unrecoveredCapitalCents: 6000,
      capitalCents: 200_000,
      partnerBalancesCents: -2000,
      unsettledNetProfitCents: 2520,
      customerCreditsCents: 0,
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });

    shop.settle('2026-09-30');
    const report = integrityReportOf(shop.records);
    expect(report).toMatchObject({
      ok: true,
      holdingsCents: 200_520,
      claimsCents: 200_520,
      lockedThrough: '2026-09-30',
    });
    expect(report.breakdown).toEqual([
      { side: 'holdings', key: 'cash', cents: 147_000 },
      { side: 'holdings', key: 'stock_at_cost', cents: 47_520 },
      { side: 'holdings', key: 'unrecovered_capital', cents: 6000 },
      { side: 'claims', key: 'capital', cents: 200_840 },
      { side: 'claims', key: 'partner_balances', cents: -320 },
      { side: 'claims', key: 'unsettled_net_profit', cents: 0 },
      { side: 'claims', key: 'customer_credits', cents: 0 },
    ]);
  });

  it('T13: a record changed after its period was settled shows as a difference', () => {
    const shop = t13();
    shop.settle('2026-09-30');
    const [expense] = shop.records.expenses;
    if (!expense) throw new Error('T13 has an expense');
    shop.records.expenses = [{ ...expense, amountCents: expense.amountCents + 500 }];
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: false, diffCents: -500 });
  });

  it('a roll whose cost no longer matches its purchase shows its difference too', () => {
    const shop = t13();
    shop.records.rolls = shop.records.rolls.map((roll) => ({
      ...roll,
      costTotalCents: roll.costTotalCents + 77,
    }));
    expect(integrityReportOf(shop.records).diffCents).toBe(77);
  });

  it('a cash count moves the books to what was counted; the difference is the period’s (I2)', () => {
    const shop = t13();
    const over = shop.count('2026-09-25', 147_000 + dh(3), 'وجدت ورقة في الدرج');
    expect(over).toEqual({
      date: '2026-09-25',
      expectedCents: 147_000,
      countedCents: 147_300,
      diffCents: 300,
      note: 'وجدت ورقة في الدرج',
    });
    expect(integrityStateOf(shop.records)).toMatchObject({
      cashCents: 147_300,
      unsettledNetProfitCents: 2520 + 300,
    });
    expect(integrityReportOf(shop.records).ok).toBe(true);
    expect(shop.preview('2026-09-30').cashOverShortCents).toBe(300);

    // A voided count no longer counts.
    shop.records.cashAdjustments = shop.records.cashAdjustments.map((count) => ({
      ...count,
      voidedAt: '2026-09-26T10:00:00.000Z',
    }));
    expect(integrityStateOf(shop.records).cashCents).toBe(147_000);
  });

  it('money held for customers: an overpayment, a refund, a voided sale paid in cash', () => {
    const shop = t13();
    const [roll] = shop.records.rolls;
    if (!roll) throw new Error('a roll');
    const sale = shop.sale(roll, '2026-09-21', 1000, dh(200), 0);
    shop.pay(sale, '2026-09-22', dh(250), dh(200)); // 50 dh left as credit (P6)
    expect(integrityStateOf(shop.records).customerCreditsCents).toBe(dh(50));
    expect(integrityReportOf(shop.records).ok).toBe(true);

    shop.records.payments.push({
      ...base('2026-09-23'),
      id: crypto.randomUUID(),
      customerId: sale.customerId,
      kind: 'refund',
      amountCents: dh(50),
      date: '2026-09-23',
      method: 'cash',
      note: null,
    });
    expect(integrityStateOf(shop.records).customerCreditsCents).toBe(0);
    expect(integrityReportOf(shop.records).ok).toBe(true);

    // The cash sale of the 5th is voided: its cloth goes back, its money is refunded (P13).
    const [cashSale] = shop.records.sales;
    const saleMove = shop.records.stockMoves.find((move) => move.type === 'sale');
    if (!cashSale || !saleMove) throw new Error('the cash sale');
    shop.records.sales = shop.records.sales.map((s) =>
      s.id === cashSale.id ? { ...s, voidedAt: '2026-09-24T09:00:00.000Z' } : s,
    );
    shop.move(roll, 'reversal', 1000, '2026-09-24', saleMove.id);
    shop.records.payments.push({
      ...base('2026-09-24'),
      id: crypto.randomUUID(),
      customerId: null,
      kind: 'refund',
      amountCents: dh(200),
      date: '2026-09-24',
      method: 'cash',
      note: null,
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });
  });

  it('a count records its difference and says why; the server checks both', () => {
    const fields = cashCountFieldsOf(
      newCashCountSchema.parse({ date: '2026-09-25', countedCents: 900 }),
      1000,
    );
    expect(fields.diffCents).toBe(-100);
    expect(checkCashAdjustment(fields)).toEqual([
      expect.objectContaining({ message: CASH_COUNT_ISSUES.reasonRequired }),
    ]);
    expect(checkCashAdjustment({ ...fields, note: 'نقص' })).toEqual([]);
    expect(checkCashAdjustment({ ...fields, note: 'نقص', diffCents: -99 })).toEqual([
      expect.objectContaining({ message: CASH_COUNT_ISSUES.mismatch }),
    ]);
    // A count that matches needs no reason.
    expect(
      checkCashAdjustment(
        cashCountFieldsOf({ date: '2026-09-25', countedCents: 1000, note: null }, 1000),
      ),
    ).toEqual([]);
  });
});
