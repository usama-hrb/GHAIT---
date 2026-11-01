import { describe, expect, it } from 'vitest';
import {
  cashFlowByMonth,
  expensesByCategory,
  monthsOf,
  negotiation,
  profitByMonth,
  type ReportRecords,
  receivablesAgeing,
  salesByColor,
  salesByFabric,
  slowMoving,
  stockValue,
} from './index.js';
import { base, dh, OWNER, Shop } from './test-shop.js';

const FABRIC = crypto.randomUUID();

/** The shop's records with a fabric (ref 20 dh/m) for every roll's colour, and named customers. */
function withNames(shop: Shop): ReportRecords {
  const variants = shop.records.rolls.map((roll, index) => ({
    ...base('2026-09-01'),
    id: roll.variantId,
    fabricId: FABRIC,
    colorName: index === 0 ? 'أحمر' : 'أزرق',
    lowStockThresholdCm: 0,
  }));
  const customers = shop.records.sales.flatMap((sale) =>
    sale.customerId
      ? [{ ...base('2026-09-01'), id: sale.customerId, name: 'فاطمة', phone: null, notes: null }]
      : [],
  );
  return {
    ...shop.records,
    // The reference price at the time of each sale, as the POS stores it on the line.
    saleLines: shop.records.saleLines.map((line) => ({ ...line, refPricePerMeterCents: dh(20) })),
    suppliers: [],
    fabrics: [
      {
        ...base('2026-09-01'),
        id: FABRIC,
        name: 'روزا',
        type: null,
        defaultSupplierId: null,
        refPricePerMeterCents: dh(20),
        minPricePerMeterCents: dh(15),
        estCmPerKg: null,
        sellableAsPiece: false,
        piecePriceCents: null,
        tags: [],
        notes: null,
      },
    ],
    variants,
    customers,
  };
}

function shop() {
  const s = new Shop();
  s.contribute(OWNER, dh(2000), '2026-08-01');
  const red = s.roll(dh(800), 5000, false, '2026-08-01'); // 16 dh/m
  const blue = s.roll(dh(800), 5000, false, '2026-08-01');
  s.sale(red, '2026-09-05', 1000, dh(180)); // 10 m at 18: 20 dh under the reference
  const credit = s.sale(red, '2026-10-06', 1000, dh(200), dh(50));
  s.expense('2026-09-12', dh(100));
  s.expense('2026-10-01', dh(30));
  s.records.expenses[1] = {
    ...(s.records.expenses[1] as (typeof s.records.expenses)[number]),
    category: 'water',
  };
  return { s, red, blue, credit };
}

const RANGE = { from: '2026-09-01', to: '2026-10-31' };

describe('reports (BUILD_PROMPTS 5.2)', () => {
  it('returns lower the month’s sales and profit they are made in, not the sale’s (RT4)', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 500, 0); // half of the 200 dh credit sale comes back: 100 dh, cost 80
    const rows = profitByMonth(withNames(s), RANGE);
    expect(rows.find((row) => row.month === '2026-10')).toMatchObject({
      salesCents: dh(200) - dh(100),
      grossProfitCents: dh(40) - dh(20),
    });
    expect(rows.find((row) => row.month === '2026-09')).toMatchObject({ salesCents: dh(180) });
  });

  it('sales by colour count only what was kept', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 400, 0);
    const [row] = salesByColor(withNames(s), { from: '2026-10-01', to: '2026-10-31' });
    expect(row).toMatchObject({
      soldCm: 600,
      revenueCents: dh(120),
      costCents: dh(96),
      profitCents: dh(24),
    });
  });

  it('a sale that came back whole was not sold', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 1000, 0);
    expect(salesByColor(withNames(s), { from: '2026-10-01', to: '2026-10-31' })).toEqual([]);
  });

  it('months of a range', () => {
    expect(monthsOf({ from: '2026-11-15', to: '2027-02-01' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('profit by month: sales and gross profit by sale date; the period result as settled', () => {
    const { s } = shop();
    expect(profitByMonth(withNames(s), RANGE)).toEqual([
      {
        month: '2026-09',
        salesCents: dh(180),
        grossProfitCents: dh(20),
        recognizedProfitCents: dh(20),
        lossesCents: 0,
        expensesCents: dh(100),
        cashOverShortCents: 0,
        netProfitCents: dh(-80),
      },
      {
        month: '2026-10',
        salesCents: dh(200),
        grossProfitCents: dh(40),
        recognizedProfitCents: 0, // 50 dh paid of 160 dh of capital
        lossesCents: 0,
        expensesCents: dh(30),
        cashOverShortCents: 0,
        netProfitCents: dh(-30),
      },
    ]);
  });

  it('sales by colour and fabric, slow-moving colours, stock at cost and at the reference price', () => {
    const { s } = shop();
    const records = withNames(s);
    expect(salesByColor(records, RANGE)).toEqual([
      expect.objectContaining({
        colorName: 'أحمر',
        soldCm: 2000,
        revenueCents: dh(380),
        costCents: dh(320),
        profitCents: dh(60),
      }),
    ]);
    expect(salesByFabric(records, { from: '2026-10-01', to: '2026-10-31' })).toEqual([
      expect.objectContaining({ fabricName: 'روزا', soldCm: 1000, revenueCents: dh(200) }),
    ]);
    expect(
      slowMoving(records, '2026-11-30').map((row) => [row.colorName, row.daysIdle, row.lastSale]),
    ).toEqual([
      ['أزرق', 121, null],
      ['أحمر', 55, '2026-10-06'],
    ]);
    expect(stockValue(records)).toEqual([
      expect.objectContaining({ remainingCm: 8000, costCents: dh(1280), marketCents: dh(1600) }),
    ]);
  });

  it('negotiation: sold against the reference price, per customer and per fabric', () => {
    const { s, credit } = shop();
    const records = withNames(s);
    expect(negotiation(records, RANGE, 'customer')).toEqual([
      {
        key: '',
        name: '',
        lines: 1,
        refCents: dh(200),
        soldCents: dh(180),
        discountCents: dh(20),
        discountBp: 1000,
      },
      {
        key: credit.customerId,
        name: 'فاطمة',
        lines: 1,
        refCents: dh(200),
        soldCents: dh(200),
        discountCents: 0,
        discountBp: 0,
      },
    ]);
    expect(negotiation(records, RANGE, 'fabric')).toEqual([
      expect.objectContaining({ name: 'روزا', lines: 2, discountCents: dh(20), discountBp: 500 }),
    ]);
  });

  it('expenses by category, receivables by age, the money month by month', () => {
    const { s, credit } = shop();
    const records = withNames(s);
    expect(expensesByCategory(records, RANGE)).toEqual([
      { category: 'rent', amountCents: dh(100) },
      { category: 'water', amountCents: dh(30) },
    ]);
    expect(receivablesAgeing(records, '2026-12-20')).toEqual([
      {
        customerId: credit.customerId,
        name: 'فاطمة',
        days0to30: 0,
        days31to60: 0,
        days61to90: dh(150),
        over90: 0,
        totalCents: dh(150),
      },
    ]);
    expect(cashFlowByMonth(records, RANGE)).toEqual([
      {
        month: '2026-09',
        inCents: dh(180),
        outCents: dh(100),
        capitalCents: 0,
        countsCents: 0,
        netCents: dh(80),
        balanceCents: dh(480),
      },
      {
        month: '2026-10',
        inCents: dh(50),
        outCents: dh(30),
        capitalCents: 0,
        countsCents: 0,
        netCents: dh(20),
        balanceCents: dh(500),
      },
    ]);
  });
});
