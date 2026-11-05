import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedBatch, seedProduct } from './test-helpers';

let db: ShopDatabase;
let repos: Repositories;
let batchId: string;
const dh = (amount: number) => amount * 100;
/** The day the store's clock reads (the shop's day for 2026-11-03 09:xx UTC). */
const TODAY = '2026-11-03';

beforeEach(async () => {
  let minute = 0;
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 10, 3, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  const productId = await seedProduct(repos, {
    pricePerMeterCents: dh(20),
    minPricePerMeterCents: dh(15),
  });
  // 100 m at 16 dh a metre.
  batchId = await seedBatch(repos, productId, 10_000, { costPerMeterCents: dh(16) });
});

afterEach(async () => {
  await db.delete();
});

/** `meters` sold at 18 dh a metre: a 10 m sale is 180 dh and costs 160 dh. */
function sell(
  meters: number,
  date: string,
  extra: { customerId?: string | null; paid?: number; dueDate?: string | null } = {},
) {
  return repos.sales.create({
    date,
    customerId: extra.customerId ?? null,
    dueDate: extra.dueDate ?? null,
    lines: [
      {
        batchId,
        unit: 'meter',
        quantity: meters * 100,
        price: { perUnitCents: dh(18) },
        refPriceCents: dh(20),
        minPriceCents: dh(15),
      },
    ],
    paidCents: extra.paid === undefined ? dh(meters * 18) : extra.paid,
  });
}

/** Goods back from a sale paid in full: the credit is handed back in cash (RT3). */
async function giveBack(saleId: string, date: string, quantityCm: number, refundCents: number) {
  const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
  await repos.sales.giveBack({
    saleId,
    date,
    reason: 'x',
    lines: [{ lineId, quantity: quantityCm }],
    refundCents,
  });
}

describe('sales for the chart and the cards', () => {
  async function shop() {
    const previous = await sell(10, '2026-10-25'); // 180 dh, in the 7 days before the window
    await sell(5, '2026-11-01'); // 90 dh
    await sell(10, TODAY); // 180 dh
    await giveBack(previous, TODAY, 500, dh(90)); // 5 m of the old sale back today: 90 dh off today
  }

  it('is every day of the window, a quiet day a zero, today last, returns on the day they are made', async () => {
    await shop();
    const week = await repos.home.sales(TODAY, 7);
    expect(week.days.map((day) => day.date)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(week.days.map((day) => day.salesCents)).toEqual([0, 0, 0, 0, dh(90), 0, dh(90)]);
    expect(week.days.at(-1)?.salesCount).toBe(1);
    expect(week).toMatchObject({
      totalCents: dh(180),
      previousTotalCents: dh(180),
      todayCents: dh(90),
      todayCount: 1,
      yesterdayCents: 0,
    });
    expect((await repos.home.sales(TODAY, 30)).days).toHaveLength(30);
  });

  it('adds up to what the profit report says for the same month', async () => {
    await shop();
    const { days } = await repos.home.sales(TODAY, 30);
    const report = await repos.reports.all({ from: '2026-10-01', to: '2026-11-30' });
    const november = report.profit.find((row) => row.month === '2026-11');
    expect(
      days.filter((day) => day.date.startsWith('2026-11')).reduce((s, d) => s + d.salesCents, 0),
    ).toBe(november?.salesCents);
  });

  it('leaves a voided sale out, and the return of a voided sale', async () => {
    const id = await sell(10, TODAY);
    await sell(2, TODAY);
    await repos.sales.voidSale(id, 'x');
    expect((await repos.home.sales(TODAY, 7)).todayCents).toBe(dh(36));
  });

  it('is zero on a shop with no sales', async () => {
    expect(await repos.home.sales(TODAY, 7)).toMatchObject({
      totalCents: 0,
      previousTotalCents: 0,
      todayCents: 0,
      todayCount: 0,
    });
  });
});

describe('gross profit today', () => {
  it('is the day’s sales less their batch cost, less what returns took back, as the report counts it', async () => {
    const previous = await sell(10, '2026-10-25');
    await sell(5, '2026-11-01'); // 90 dh, cost 80
    await sell(10, TODAY); // 180 dh, cost 160
    await giveBack(previous, TODAY, 500, dh(90)); // 90 dh back, cost 80
    expect(await repos.home.grossProfitToday(TODAY)).toBe(dh(20) - dh(10));
    const report = await repos.reports.all({ from: '2026-11-01', to: '2026-11-30' });
    // 1 Nov: 10 dh, today: 10 dh.
    expect(report.profit[0]?.grossProfitCents).toBe(dh(20));
  });

  it('is left out (null) when the costs cannot be worked out, never guessed', async () => {
    await sell(10, TODAY);
    await db.productStockMoves.clear();
    expect(await repos.home.grossProfitToday(TODAY)).toBeNull();
  });
});

describe('debts', () => {
  it('customers: what is owed in all, and how much of it is late', async () => {
    const fatima = await repos.customers.save({ name: 'فاطمة' });
    const said = await repos.customers.save({ name: 'سعيد' });
    await sell(10, '2026-10-20', { customerId: fatima, paid: 0, dueDate: '2026-10-30' }); // late
    await sell(5, '2026-10-28', { customerId: said, paid: dh(20) }); // 70 dh left, no due date
    expect(await repos.home.receivables()).toEqual({
      owedCents: dh(180) + dh(70),
      owingCount: 2,
      overdueCents: dh(180),
      overdueCount: 1,
    });
    const directory = await repos.accounts.list();
    expect(
      directory.reduce((sum, { account }) => sum + Math.max(0, account.collectibleCents), 0),
    ).toBe(dh(250));
  });

  it('customers: nothing owed is all zeros', async () => {
    await sell(1, TODAY);
    expect(await repos.home.receivables()).toEqual({
      owedCents: 0,
      owingCount: 0,
      overdueCents: 0,
      overdueCount: 0,
    });
  });

  it('suppliers: what the shop owes, as the suppliers directory sums it', async () => {
    const atlas = await repos.suppliers.save({ name: 'أطلس' });
    const productId = await seedProduct(repos, { name: 'ساتان' });
    await repos.purchases.create({
      date: '2026-10-10',
      productId,
      unit: 'meter',
      quantity: 5000,
      totalCostCents: dh(800),
      supplierId: atlas,
      paidCents: dh(300),
    });
    expect(await repos.home.payables()).toEqual({ owedCents: dh(500), owingCount: 1 });
    expect(await repos.supplierAccounts.totalOwedCents()).toBe(dh(500));
  });
});

describe('stock that needs attention', () => {
  it('counts what the stock screen’s filters show: out, low, and the names', async () => {
    const low = await seedProduct(repos, { name: 'حرير', lowStockThreshold: 500 });
    await seedBatch(repos, low, 300, { costPerMeterCents: dh(10) }); // 3 m left, limit 5 m
    await sell(100, TODAY); // the 100 m of روزا, all of it
    const attention = await repos.home.stock();
    expect(attention).toMatchObject({
      outCount: 1,
      lowCount: 1,
      awaitingCount: 0,
      out: ['روزا'],
      low: ['حرير'],
    });
    const overview = await repos.productInventory.overview();
    expect(overview.summary).toMatchObject({ out: 1, low: 1 });
  });
});

describe('dues', () => {
  it('the month’s unpaid bills as the expenses screen counts them (a carried-over one too, a voided one never)', async () => {
    await repos.expenses.save({
      date: '2026-11-01',
      category: 'rent',
      amountCents: dh(100),
      paidDate: '2026-11-01',
    });
    await repos.expenses.save({
      date: '2026-11-02',
      category: 'water',
      amountCents: dh(30),
      paidDate: null,
    });
    await repos.expenses.save({
      date: '2026-10-20',
      category: 'electricity',
      amountCents: dh(70),
      paidDate: null,
    });
    const gone = await repos.expenses.save({
      date: '2026-11-02',
      category: 'water',
      amountCents: dh(999),
      paidDate: null,
    });
    await repos.expenses.void(gone, 'x');
    const dues = await repos.home.dues(TODAY);
    const month = await repos.expenses.month('2026-11');
    expect(dues).toMatchObject({ unpaidCents: dh(100), unpaidCount: 2, zakat: null });
    expect([dues.unpaidCents, dues.unpaidCount]).toEqual([
      month.totals.unpaidCents,
      month.totals.unpaidCount,
    ]);
  });
});

describe('recent activity', () => {
  it('lists each kind from its own records, newest first, and a sale paid at the till once', async () => {
    const fatima = await repos.customers.save({ name: 'فاطمة' });
    const atlas = await repos.suppliers.save({ name: 'أطلس' });
    await sell(2, TODAY); // paid in full at the till: one sale, no payment line
    const credit = await sell(10, TODAY, { customerId: fatima, paid: 0 });
    await repos.accounts.recordPayment({ customerId: fatima, amountCents: dh(50), date: TODAY });
    const productId = await seedProduct(repos, { name: 'ساتان' });
    const purchaseId = await repos.purchases.create({
      date: TODAY,
      productId,
      unit: 'meter',
      quantity: 2000,
      totalCostCents: dh(400),
      supplierId: atlas,
      paidCents: 0,
    });
    await repos.supplierAccounts.pay({
      supplierId: atlas,
      amountCents: dh(100),
      date: TODAY,
      purchaseId,
    });
    await repos.expenses.save({
      date: TODAY,
      category: 'rent',
      amountCents: dh(60),
      paidDate: TODAY,
    });
    // A bill not paid yet is not money out: it is no event of the feed (it is an attention item).
    await repos.expenses.save({
      date: TODAY,
      category: 'water',
      amountCents: dh(30),
      paidDate: null,
    });
    await repos.stock.act({ type: 'loss', batchId, date: TODAY, quantity: 100, reason: 'x' });

    const events = await repos.home.recent(20, true);
    expect(events.map((event) => event.kind)).toEqual([
      'stock_adjustment',
      'expense',
      'supplier_payment',
      'purchase',
      'customer_payment',
      'sale',
      'sale',
      'purchase', // the stock the shop started with
    ]);
    const [loss, expense, supplierPayment, purchase, payment, creditSale, tillSale] = events;
    expect(loss).toMatchObject({
      subject: 'روزا',
      quantity: { unit: 'meter', amount: -100 },
      adjustment: 'loss',
    });
    expect(expense).toMatchObject({
      amountCents: dh(60),
      category: { key: 'rent' },
      href: '/expenses',
    });
    expect(supplierPayment).toMatchObject({ subject: 'أطلس', amountCents: dh(100) });
    expect(supplierPayment?.href).toMatch(/^\/payables\/view\?id=/);
    expect(purchase).toMatchObject({
      subject: 'ساتان',
      more: 0,
      amountCents: dh(400),
      quantity: { unit: 'meter', amount: 2000 },
    });
    expect(purchase?.href).toBe(`/inventory/product?id=${productId}`);
    expect(payment).toMatchObject({ subject: 'فاطمة', amountCents: dh(50) });
    expect(payment?.href).toBe(`/customers/view?id=${fatima}`);
    expect(creditSale).toMatchObject({
      subject: 'فاطمة',
      amountCents: dh(180),
      href: `/pos/view?id=${credit}`,
    });
    expect(tillSale).toMatchObject({ subject: null, amountCents: dh(36) });
  });

  it('shows no cost side to an account that does not see costs, and at most `limit` events', async () => {
    await sell(2, TODAY);
    await repos.expenses.save({
      date: TODAY,
      category: 'rent',
      amountCents: dh(60),
      paidDate: TODAY,
    });
    expect((await repos.home.recent(20, false)).map((event) => event.kind)).toEqual(['sale']);
    await sell(1, TODAY);
    await sell(1, TODAY);
    expect(await repos.home.recent(2, true)).toHaveLength(2);
  });

  it('leaves out what was voided', async () => {
    const id = await sell(2, TODAY);
    await sell(1, TODAY);
    await repos.sales.voidSale(id, 'x');
    const events = await repos.home.recent(20, false);
    expect(events).toHaveLength(1);
    expect(events[0]?.amountCents).toBe(dh(18));
  });

  it('finds a customer payment buried under many sales paid at the till', async () => {
    const fatima = await repos.customers.save({ name: 'فاطمة' });
    await sell(10, TODAY, { customerId: fatima, paid: 0 });
    await repos.accounts.recordPayment({ customerId: fatima, amountCents: dh(10), date: TODAY });
    for (let sale = 0; sale < 12; sale += 1) await sell(1, TODAY);
    const kinds = (await repos.home.recent(50, false)).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === 'customer_payment')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'sale')).toHaveLength(13);
  });
});
