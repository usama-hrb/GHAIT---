import { monthBounds } from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  cashFlowByMonth,
  daysOf,
  expensesByCategory,
  grossProfitByDay,
  monthsOf,
  negotiation,
  profitByMonth,
  type ReportRecords,
  receivablesAgeing,
  salesByDay,
  salesByProduct,
  slowMoving,
  stockValue,
} from './index.js';
import type { SaleReturn } from './returns.js';
import { base, dh, OWNER, Shop } from './test-shop.js';

/** The shop's records with a product (20 dh/m, minimum 15) for every batch, and named customers. */
function withNames(shop: Shop): ReportRecords {
  const products = shop.records.batches.map((batch, index) => ({
    ...base('2026-09-01'),
    id: batch.productId,
    name: index === 0 ? 'روزا أحمر' : 'روزا أزرق',
    sku: null,
    description: null,
    tags: [],
    purchaseUnits: ['meter' as const],
    sellingUnits: ['meter' as const],
    kgToMeterConversion: null,
    pricePerMeterCents: dh(20),
    minPricePerMeterCents: dh(15),
    pricePerPieceCents: null,
    minPricePerPieceCents: null,
    lowStockThreshold: null,
    active: true,
  }));
  const customers = shop.records.sales.flatMap((sale) =>
    sale.customerId
      ? [{ ...base('2026-09-01'), id: sale.customerId, name: 'فاطمة', phone: null, notes: null }]
      : [],
  );
  return {
    ...shop.records,
    // The reference price at the time of each sale, as the POS stores it on the line.
    saleLines: shop.records.saleLines.map((line) => ({ ...line, refPriceCents: dh(20) })),
    suppliers: [],
    products,
    customers,
  };
}

function shop() {
  const s = new Shop();
  s.contribute(OWNER, dh(2000), '2026-08-01');
  const red = s.batch(dh(800), 5000, false, '2026-08-01'); // 16 dh/m
  const blue = s.batch(dh(800), 5000, false, '2026-08-01');
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

  it('sales by product count only what was kept', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 400, 0);
    const [row] = salesByProduct(withNames(s), { from: '2026-10-01', to: '2026-10-31' });
    expect(row).toMatchObject({
      soldCm: 600,
      soldPieces: 0,
      revenueCents: dh(120),
      costCents: dh(96),
      profitCents: dh(24),
    });
  });

  it('a sale that came back whole was not sold', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 1000, 0);
    expect(salesByProduct(withNames(s), { from: '2026-10-01', to: '2026-10-31' })).toEqual([]);
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

  it('days of a range, month ends and a leap day included', () => {
    expect(daysOf({ from: '2026-12-30', to: '2027-01-02' })).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysOf({ from: '2028-02-28', to: '2028-03-01' })).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(daysOf({ from: '2026-11-04', to: '2026-11-04' })).toEqual(['2026-11-04']);
    expect(daysOf({ from: '2026-11-05', to: '2026-11-04' })).toEqual([]);
  });

  it('sales by day: every day of the range, quiet days as zeros, no cost read', () => {
    const { s } = shop();
    const rows = salesByDay(s.records, { from: '2026-09-04', to: '2026-09-07' });
    expect(rows).toEqual([
      { date: '2026-09-04', salesCents: 0, salesCount: 0, returnedCents: 0 },
      { date: '2026-09-05', salesCents: dh(180), salesCount: 1, returnedCents: 0 },
      { date: '2026-09-06', salesCents: 0, salesCount: 0, returnedCents: 0 },
      { date: '2026-09-07', salesCents: 0, salesCount: 0, returnedCents: 0 },
    ]);
  });

  it('sales by day: a return lowers the day it is made, a voided sale or return counts for nothing', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 500, 0); // 100 dh of the 200 dh sale of 6 October
    const day = (date: string) =>
      salesByDay(s.records, { from: date, to: date }).map(({ salesCents }) => salesCents)[0];
    expect(day('2026-10-06')).toBe(dh(200));
    expect(day('2026-10-20')).toBe(-dh(100));
    // The return is voided: the 20th is quiet again.
    const [given] = s.records.saleReturns;
    s.records.saleReturns[0] = { ...(given as SaleReturn), voidedAt: '2026-10-21T09:00:00.000Z' };
    expect(day('2026-10-20')).toBe(0);
    // The sale is voided: it was never sold, and a return of it is not counted either.
    s.records.saleReturns[0] = given as SaleReturn;
    const sale = s.records.sales.find((row) => row.id === credit.id);
    s.records.sales = s.records.sales.map((row) =>
      row.id === sale?.id ? { ...row, voidedAt: '2026-10-22T09:00:00.000Z' } : row,
    );
    expect(day('2026-10-06')).toBe(0);
    expect(day('2026-10-20')).toBe(0);
  });

  it('a month of days adds up to the month of the profit report (sales and gross profit)', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 500, 0);
    const records = withNames(s);
    for (const month of profitByMonth(records, RANGE)) {
      const { start, end } = monthBounds(month.month);
      const days = salesByDay(records, { from: start, to: end });
      expect(days.reduce((total, row) => total + row.salesCents, 0)).toBe(month.salesCents);
      const profit = grossProfitByDay(records, { from: start, to: end });
      expect(profit.reduce((total, row) => total + row.grossProfitCents, 0)).toBe(
        month.grossProfitCents,
      );
    }
  });

  it('gross profit by day: the sale’s total less its batch cost on its date; a return takes its share away on its own day', () => {
    const { s, credit } = shop();
    s.giveBack(credit, '2026-10-20', 500, 0); // 100 dh back, cost 80 -> 20 dh of profit given back
    const records = withNames(s);
    const profit = (date: string) => grossProfitByDay(records, { from: date, to: date })[0];
    expect(profit('2026-09-05')).toEqual({ date: '2026-09-05', grossProfitCents: dh(20) });
    expect(profit('2026-10-06')).toEqual({ date: '2026-10-06', grossProfitCents: dh(40) });
    expect(profit('2026-10-20')).toEqual({ date: '2026-10-20', grossProfitCents: -dh(20) });
    expect(profit('2026-10-07')).toEqual({ date: '2026-10-07', grossProfitCents: 0 });
  });

  it('gross profit by day refuses records whose costs cannot be worked out, rather than guess', () => {
    const { s } = shop();
    const records = withNames(s);
    expect(() =>
      grossProfitByDay({ ...records, stockMoves: [] }, { from: '2026-09-01', to: '2026-09-30' }),
    ).toThrow();
  });

  it('sales by product, slow-moving products, stock at cost and at the reference price', () => {
    const { s } = shop();
    const records = withNames(s);
    expect(salesByProduct(records, RANGE)).toEqual([
      expect.objectContaining({
        productName: 'روزا أحمر',
        soldCm: 2000,
        revenueCents: dh(380),
        costCents: dh(320),
        profitCents: dh(60),
      }),
    ]);
    expect(salesByProduct(records, { from: '2026-10-01', to: '2026-10-31' })).toEqual([
      expect.objectContaining({ productName: 'روزا أحمر', soldCm: 1000, revenueCents: dh(200) }),
    ]);
    expect(
      slowMoving(records, '2026-11-30').map((row) => [row.productName, row.daysIdle, row.lastSale]),
    ).toEqual([
      ['روزا أزرق', 121, null],
      ['روزا أحمر', 55, '2026-10-06'],
    ]);
    expect(stockValue(records)).toEqual([
      expect.objectContaining({
        productName: 'روزا أزرق',
        remainingCm: 5000,
        costCents: dh(800),
        marketCents: dh(1000),
      }),
      expect.objectContaining({
        productName: 'روزا أحمر',
        remainingCm: 3000,
        costCents: dh(480),
        marketCents: dh(600),
      }),
    ]);
  });

  it('negotiation: sold against the reference price, per customer and per product', () => {
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
    expect(negotiation(records, RANGE, 'product')).toEqual([
      expect.objectContaining({
        name: 'روزا أحمر',
        lines: 2,
        discountCents: dh(20),
        discountBp: 500,
      }),
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
