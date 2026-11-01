import { describe, expect, it } from 'vitest';
import {
  buildCreditApplication,
  buildRefund,
  buildSaleReturn,
  buildSaleVoid,
  checkSaleReturn,
  checkSaleVoid,
  customerAccountOf,
  integrityReportOf,
  integrityStateOf,
  type NewSaleReturn,
  periodBasisOf,
  previewSettlement,
  priceSaleReturn,
  RETURN_ISSUES,
  returnedCmByLine,
  saleFigures,
  saleReturnAggregateSchema,
  SALE_ISSUES,
} from './index.js';
import { at, dh, OWNER, PARTNER, Shop } from './test-shop.js';

const DAY = '2026-10-10';

/** A 50 m roll at 16 dh/m: 10 m sold for 200 dh cost 160 dh. */
function shopWithSale(paidCents = dh(200)) {
  const shop = new Shop();
  shop.contribute(OWNER, dh(1000));
  shop.contribute(PARTNER, dh(1000));
  const roll = shop.roll(dh(800), 5000, false, '2026-09-01');
  const sale = shop.sale(roll, '2026-09-05', 1000, dh(200), paidCents);
  return { shop, roll, sale };
}

const input = (
  shop: Shop,
  saleId: string,
  returnedCm: number,
  refundCents = 0,
  date = DAY,
): NewSaleReturn => {
  const line = shop.records.saleLines.find((candidate) => candidate.saleId === saleId);
  return {
    saleId,
    date,
    reason: 'لم يعجبها اللون',
    lines: [{ lineId: line?.id ?? '', returnedCm }],
    refundCents,
  };
};

describe('pricing a return (RT1–RT3)', () => {
  it('credits the proportional price of what comes back: 4 of 10 m at 20 dh = 80 dh', () => {
    const { shop, sale } = shopWithSale();
    const priced = priceSaleReturn(input(shop, sale.id, 400, dh(80)), shop.returnRecordsOf(sale));
    expect(priced).toMatchObject({
      creditCents: dh(80),
      totalAfterCents: dh(120),
      paidCents: dh(200),
      maxRefundCents: dh(80),
      issues: [],
    });
  });

  it('a credit sale: the credit lowers the debt, there is nothing to hand back', () => {
    const { shop, sale } = shopWithSale(dh(50)); // 150 dh still owed
    const priced = priceSaleReturn(input(shop, sale.id, 400), shop.returnRecordsOf(sale));
    expect(priced).toMatchObject({ creditCents: dh(80), maxRefundCents: 0, issues: [] });
  });

  it('a customer who paid most of it: only what is paid beyond the new worth can be handed back', () => {
    const { shop, sale } = shopWithSale(dh(150)); // 50 dh owed; after the return worth 120
    const priced = priceSaleReturn(input(shop, sale.id, 400), shop.returnRecordsOf(sale));
    expect(priced.maxRefundCents).toBe(dh(30));
  });

  it('refuses a refund above the overpayment, and a walk-in buyer keeping credit', () => {
    const { shop, sale } = shopWithSale(dh(150));
    const tooMuch = priceSaleReturn(input(shop, sale.id, 400, dh(31)), shop.returnRecordsOf(sale));
    expect(tooMuch.issues).toEqual([
      { path: ['refundCents'], message: RETURN_ISSUES.refundAboveOverpayment, code: 'custom' },
    ]);
    // A customer may keep the credit on their account...
    expect(
      priceSaleReturn(input(shop, sale.id, 400, 0), shop.returnRecordsOf(sale)).issues,
    ).toEqual([]);
    // ...a walk-in buyer has no account: the whole overpayment goes back.
    const cash = shopWithSale(dh(200));
    expect(
      priceSaleReturn(
        input(cash.shop, cash.sale.id, 400, dh(10)),
        cash.shop.returnRecordsOf(cash.sale),
      ).issues,
    ).toEqual([{ path: ['refundCents'], message: RETURN_ISSUES.refundRequired, code: 'custom' }]);
  });

  it('refuses a voided or written-off sale, a date before the sale, unknown or repeated lines', () => {
    const { shop, sale } = shopWithSale(0);
    const records = shop.returnRecordsOf(sale);
    const issues = (changes: Partial<NewSaleReturn>, patch: Partial<typeof records> = {}) =>
      priceSaleReturn(
        { ...input(shop, sale.id, 100), ...changes },
        { ...records, ...patch },
      ).issues.map((found) => found.message);
    expect(issues({}, { sale: { ...sale, voidedAt: at(DAY) } })).toEqual([
      RETURN_ISSUES.saleVoided,
    ]);
    expect(issues({}, { writtenOff: true })).toEqual([RETURN_ISSUES.writtenOff]);
    expect(issues({ date: '2026-09-04' })).toEqual([RETURN_ISSUES.beforeSale]);
    expect(issues({ lines: [{ lineId: crypto.randomUUID(), returnedCm: 1 }] })).toEqual([
      RETURN_ISSUES.unknownLine,
    ]);
    const lineId = records.lines[0]?.id ?? '';
    expect(
      issues({
        lines: [
          { lineId, returnedCm: 1 },
          { lineId, returnedCm: 1 },
        ],
      }),
    ).toEqual([RETURN_ISSUES.duplicateLine]);
    expect(issues({ lines: [{ lineId, returnedCm: 1001 }] })).toEqual([RETURN_ISSUES.aboveSold]);
  });

  it('counts what came back before: a second return cannot take more than is left', () => {
    const { shop, sale } = shopWithSale(0);
    shop.giveBack(sale, '2026-09-20', 700);
    const records = shop.returnRecordsOf(sale);
    expect(returnedCmByLine(records.returns).get(records.lines[0]?.id ?? '')).toBe(700);
    expect(priceSaleReturn(input(shop, sale.id, 301), records).issues).toHaveLength(1);
    expect(priceSaleReturn(input(shop, sale.id, 300), records)).toMatchObject({
      creditCents: dh(60),
      issues: [],
    });
  });

  it('shares the invoice discount in proportion to what comes back', () => {
    const { shop, sale } = shopWithSale(dh(180));
    sale.discountCents = dh(20); // 200 dh of cloth, 20 off: the customer paid 180
    sale.totalCents = dh(180);
    const priced = priceSaleReturn(input(shop, sale.id, 500), shop.returnRecordsOf(sale));
    expect(priced.creditCents).toBe(dh(90));
  });
});

describe('building and re-checking a return (RT1)', () => {
  function built(refundCents = dh(80), paidCents = dh(200)) {
    const { shop, sale } = shopWithSale(paidCents);
    const records = shop.returnRecordsOf(sale);
    const result = buildSaleReturn(
      input(shop, sale.id, 400, refundCents),
      records,
      {
        returnId: crypto.randomUUID(),
        moveIds: [crypto.randomUUID()],
        refundId: refundCents > 0 ? crypto.randomUUID() : null,
      },
      { deviceId: 'phone', now: at(DAY) },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return { shop, sale, records, aggregate: result.aggregate };
  }

  it('creates the return, a `return` move putting the length back, and the refund', () => {
    const { aggregate, records } = built();
    const sold = records.moves[0];
    expect(aggregate.saleReturn).toMatchObject({
      saleId: records.sale.id,
      date: DAY,
      creditCents: dh(80),
      refundId: aggregate.refund?.id,
    });
    expect(aggregate.moves).toEqual([
      expect.objectContaining({
        type: 'return',
        deltaCm: 400,
        refId: sold?.id,
        rollId: sold?.rollId,
        date: DAY,
      }),
    ]);
    expect(aggregate.refund).toMatchObject({
      kind: 'refund',
      amountCents: dh(80),
      customerId: null,
    });
    expect(saleReturnAggregateSchema.safeParse(aggregate).success).toBe(true);
  });

  it('the server accepts what the device built, and refuses what does not add up', () => {
    const { aggregate, records } = built();
    expect(checkSaleReturn(aggregate, records)).toEqual([]);

    const lessCredit = structuredClone(aggregate);
    lessCredit.saleReturn.creditCents -= 1;
    expect(checkSaleReturn(lessCredit, records)).toEqual([
      { path: ['saleReturn', 'creditCents'], message: RETURN_ISSUES.notCore, code: 'custom' },
    ]);

    const wrongMove = structuredClone(aggregate);
    if (wrongMove.moves[0]) wrongMove.moves[0].deltaCm = 500;
    expect(checkSaleReturn(wrongMove, records)[0]?.message).toBe(RETURN_ISSUES.notCore);

    const noMove = { ...aggregate, moves: [] };
    expect(checkSaleReturn(noMove, records)[0]?.message).toBe(RETURN_ISSUES.inconsistent);

    const otherSale = structuredClone(aggregate);
    otherSale.saleReturn.saleId = crypto.randomUUID();
    expect(checkSaleReturn(otherSale, records)[0]?.message).toBe(RETURN_ISSUES.inconsistent);
  });

  it('refuses a return of more than the server knows was sold (another device returned it first)', () => {
    const { aggregate, shop, sale } = built(0, 0);
    shop.giveBack(sale, '2026-09-20', 800);
    expect(checkSaleReturn(aggregate, shop.returnRecordsOf(sale))[0]?.message).toBe(
      RETURN_ISSUES.aboveSold,
    );
  });

  it('a return the server already has is accepted again (an op sent twice)', () => {
    const { aggregate, records } = built();
    expect(checkSaleReturn(aggregate, { ...records, returns: [aggregate.saleReturn] })).toEqual([]);
  });
});

describe('what a return does to the books (RT1–RT4)', () => {
  it('a paid, refunded return keeps every side of the integrity check balanced', () => {
    const { shop, sale } = shopWithSale();
    shop.giveBack(sale, DAY, 400, dh(80));
    expect(integrityStateOf(shop.records)).toMatchObject({
      cashCents: dh(2000 - 800 + 200 - 80),
      stockAtCostCents: dh(800 - 160 + 64),
      unsettledNetProfitCents: dh(24),
      customerCreditsCents: 0,
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });
  });

  it('a return after the settlement lowers the open period; the settled one is as it was', () => {
    const { shop, sale } = shopWithSale();
    const settled = shop.settle('2026-09-30');
    expect(settled.settlement).toMatchObject({
      recognizedProfitCents: dh(40),
      returnsEffectCents: 0,
    });
    shop.giveBack(sale, DAY, 400, dh(80));

    // The cost the settlement froze is the cost of the whole sale: the return takes a share of it.
    const move = shop.records.stockMoves.find((candidate) => candidate.type === 'sale');
    expect(settled.lockedCosts.find((cost) => cost.stockMoveId === move?.id)?.costCents).toBe(
      dh(160),
    );
    const preview = shop.preview('2026-10-31');
    expect(preview).toMatchObject({
      recognizedProfitCents: 0,
      returnsEffectCents: -dh(16),
      netProfitCents: -dh(16),
    });
    expect(preview.breakdown.slice(0, 2)).toEqual([
      { key: 'recognized_profit', cents: 0 },
      { key: 'returns_effect', cents: -dh(16) },
    ]);
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });
  });

  it('settling the month of the return stores its effect; unlocking nothing is needed for the old month', () => {
    const { shop, sale } = shopWithSale();
    shop.settle('2026-09-30');
    shop.giveBack(sale, DAY, 400, dh(80));
    const second = shop.settle('2026-10-31');
    expect(second.settlement).toMatchObject({
      returnsEffectCents: -dh(16),
      netProfitCents: -dh(16),
      carryDeficitOutCents: dh(16),
    });
    expect(integrityReportOf(shop.records).ok).toBe(true);
  });

  it('a return cannot be dated into a settled month', () => {
    // The lock itself is the sync layer's (periodDatesOf); here the preview ignores returns' dates
    // outside the period being settled.
    const { shop, sale } = shopWithSale();
    shop.giveBack(sale, '2026-10-20', 400, dh(80));
    expect(shop.preview('2026-09-30').returnsEffectCents).toBe(0);
  });

  it('payments before and after a return are recognised on the invoice as it was then; the books balance', () => {
    // A credit sale of 200 dh (cost 160): 50 and 60 paid, then 4 of the 10 m back, then 10 more.
    const { shop, sale } = shopWithSale(dh(50));
    shop.pay(sale, '2026-09-10', dh(60));
    shop.giveBack(sale, '2026-09-15', 400, 0);
    expect(integrityReportOf(shop.records).ok).toBe(true);
    shop.pay(sale, '2026-09-20', dh(10));
    // The kept 6 m (worth 120, cost 96) are paid in full: 24 dh of profit, however it was booked.
    expect(shop.preview('2026-09-30')).toMatchObject({
      recognizedProfitCents: dh(10),
      returnsEffectCents: dh(14),
      netProfitCents: dh(24),
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });
    shop.settle('2026-09-30');
    expect(integrityReportOf(shop.records).ok).toBe(true);
  });

  it('periodBasisOf keeps the sale as it was sold, and its returns apart', () => {
    const { shop, sale } = shopWithSale();
    shop.giveBack(sale, DAY, 400, dh(80));
    const basis = periodBasisOf(shop.records);
    const entry = basis.sales.find((candidate) => candidate.sale.id === sale.id);
    expect(entry?.period).toMatchObject({
      totalCents: dh(200),
      capitalCents: dh(160),
      returns: [{ date: DAY, creditCents: dh(80), costCents: dh(64), after: 1 }],
    });
    expect(entry?.now).toEqual({ totalCents: dh(120), capitalCents: dh(96) });
  });

  it('a voided return is as if it had never been made', () => {
    const { shop, sale } = shopWithSale(0);
    const given = shop.giveBack(sale, DAY, 400, 0);
    const stored = shop.records.saleReturns.find((candidate) => candidate.id === given.id);
    if (stored) stored.voidedAt = at(DAY);
    expect(returnedCmByLine(shop.records.saleReturns).size).toBe(0);
    expect(shop.preview('2026-10-31').returnsEffectCents).toBe(0);
  });

  it('previewSettlement still refuses a period that has not ended', () => {
    const { shop } = shopWithSale();
    expect(
      previewSettlement(shop.records, { periodEnd: '2026-10-31', today: '2026-10-31' }).ok,
    ).toBe(false);
  });
});

describe('the customer’s account after a return (RT3)', () => {
  const CUSTOMER = crypto.randomUUID();
  function customerShop(paid: number) {
    const { shop, sale } = shopWithSale(paid);
    sale.customerId = CUSTOMER;
    for (const payment of shop.records.payments) payment.customerId = CUSTOMER;
    return { shop, sale };
  }
  const recordsOf = (shop: Shop) => ({
    sales: shop.records.sales,
    payments: shop.records.payments,
    allocations: shop.records.allocations,
    writeOffs: shop.records.writeOffs,
    returns: shop.records.saleReturns,
  });

  it('reduces what a customer owes by the credit', () => {
    const { shop, sale } = customerShop(dh(50));
    shop.giveBack(sale, DAY, 400, 0);
    const account = customerAccountOf(recordsOf(shop), '2026-11-01');
    expect(account).toMatchObject({
      balanceCents: dh(70),
      collectibleCents: dh(70),
      creditCents: 0,
    });
    expect(account.openInvoices[0]).toMatchObject({
      totalCents: dh(120),
      paidCents: dh(50),
      dueCents: dh(70),
    });
  });

  it('what is paid beyond the new worth is the customer’s credit, to refund or to apply', () => {
    const { shop, sale } = customerShop(dh(200));
    shop.giveBack(sale, DAY, 400, 0);
    const account = customerAccountOf(recordsOf(shop), '2026-11-01');
    expect(account).toMatchObject({
      balanceCents: -dh(80),
      creditCents: dh(80),
      collectibleCents: 0,
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true });

    // Handed back later, in cash:
    const refund = buildRefund(
      { customerId: CUSTOMER, amountCents: dh(80), date: '2026-11-02', method: 'cash', note: null },
      recordsOf(shop),
      { paymentId: crypto.randomUUID() },
      { deviceId: 'desk', now: at('2026-11-02'), today: '2026-11-02' },
    );
    expect(refund.ok).toBe(true);
    // ...never more than that:
    expect(
      buildRefund(
        {
          customerId: CUSTOMER,
          amountCents: dh(81),
          date: '2026-11-02',
          method: 'cash',
          note: null,
        },
        recordsOf(shop),
        { paymentId: crypto.randomUUID() },
        { deviceId: 'desk', now: at('2026-11-02'), today: '2026-11-02' },
      ).ok,
    ).toBe(false);
  });

  it('the credit a return frees pays another unpaid invoice of the same customer', () => {
    const { shop, sale } = customerShop(dh(200));
    const roll = shop.records.rolls[0];
    if (!roll) throw new Error('a roll');
    const second = shop.sale(roll, '2026-09-08', 500, dh(100), 0);
    second.customerId = CUSTOMER;
    shop.giveBack(sale, DAY, 400, 0); // 80 dh credit
    const application = buildCreditApplication(
      recordsOf(shop),
      { newId: () => crypto.randomUUID() },
      { deviceId: 'desk', now: at(DAY), date: DAY },
    );
    expect(application.ok).toBe(true);
    if (!application.ok) return;
    expect(application.application.allocations).toEqual([
      expect.objectContaining({ saleId: second.id, amountCents: dh(80) }),
    ]);
    shop.records.allocations.push(
      ...application.application.allocations.map((allocation) => ({
        ...allocation,
        serverSeq: 9999,
      })),
    );
    const account = customerAccountOf(recordsOf(shop), '2026-11-01');
    expect(account).toMatchObject({ creditCents: 0, balanceCents: dh(20) });
    expect(integrityReportOf(shop.records).ok).toBe(true);
  });
});

describe('the sale and its void after a return', () => {
  it('the figures show what is kept: worth, cost, profit and what is paid (RT2)', () => {
    const { shop, sale } = shopWithSale(dh(100));
    const given = shop.giveBack(sale, DAY, 400, 0);
    const basis = periodBasisOf(shop.records);
    const figures = saleFigures(
      sale,
      shop.records.saleLines,
      shop.records.stockMoves.filter((move) => move.type === 'sale'),
      basis.ledgers,
      shop.records.allocations,
      [given],
    );
    expect(figures).toMatchObject({
      totalCents: dh(200),
      returnedCents: dh(80),
      netTotalCents: dh(120),
      capitalCents: dh(96),
      profitCents: dh(24),
      paidCents: dh(100),
      dueCents: dh(20),
    });
    expect(figures.lines[0]).toMatchObject({
      returnedCm: 400,
      costCents: dh(96),
      profitCents: dh(24),
    });
    // The first 96 dh paid recover the capital; the rest is profit (T8).
    expect(figures.payments[0]).toMatchObject({ capitalCents: dh(96), profitCents: dh(4) });
  });

  it('a sale with returns cannot be voided: return the rest instead (RT7)', () => {
    const { shop, sale } = shopWithSale();
    const given = shop.giveBack(sale, DAY, 400, dh(80));
    const records = { ...shop.returnRecordsOf(sale), moves: shop.returnRecordsOf(sale).moves };
    const voided = buildSaleVoid(
      { reason: 'خطأ', date: DAY },
      { sale, moves: records.moves, allocations: records.allocations, returns: [] },
      {
        voidId: crypto.randomUUID(),
        reversalIds: [crypto.randomUUID()],
        refundId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: at(DAY) },
    );
    expect(
      checkSaleVoid(voided, {
        sale,
        moves: records.moves,
        allocations: records.allocations,
        returns: [given],
      }),
    ).toEqual([{ path: ['saleVoid', 'saleId'], message: SALE_ISSUES.hasReturns, code: 'custom' }]);
    // A voided return does not stand in the way.
    expect(
      checkSaleVoid(voided, {
        sale,
        moves: records.moves,
        allocations: records.allocations,
        returns: [{ ...given, voidedAt: at(DAY) }],
      }),
    ).toEqual([]);
  });
});
