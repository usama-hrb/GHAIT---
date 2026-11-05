import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedBatch, seedProduct } from './test-helpers';

let db: ShopDatabase;
let repos: Repositories;
const dh = (amount: number) => amount * 100;

beforeEach(async () => {
  let minute = 0;
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 10, 3, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
});

afterEach(async () => {
  await db.delete();
});

describe('reports on the device (BUILD_PROMPTS 5.2)', () => {
  it('from the device’s records: a sale, an expense, the stock left', async () => {
    const productId = await seedProduct(repos, {
      pricePerMeterCents: dh(20),
      minPricePerMeterCents: dh(15),
    });
    const batchId = await seedBatch(repos, productId, 5000, { costPerMeterCents: dh(16) });
    await repos.sales.create({
      date: '2026-10-05',
      customerId: null,
      lines: [
        {
          batchId: batchId,
          unit: 'meter',
          quantity: 1000,
          price: { perUnitCents: dh(18) },
          refPriceCents: dh(20),
          minPriceCents: dh(15),
        },
      ],
      paidCents: dh(180),
    });
    await repos.expenses.save({
      date: '2026-10-12',
      category: 'rent',
      amountCents: dh(50),
      paidDate: '2026-10-12',
    });

    const view = await repos.reports.all({ from: '2026-10-01', to: '2026-11-30' });
    expect(view.profit.map((row) => [row.month, row.grossProfitCents, row.netProfitCents])).toEqual(
      [
        ['2026-10', dh(20), dh(-30)],
        ['2026-11', 0, 0],
      ],
    );
    expect(view.products[0]).toMatchObject({
      productName: 'روزا',
      soldCm: 1000,
      profitCents: dh(20),
    });
    expect(view.byProduct[0]).toMatchObject({
      name: 'روزا',
      discountCents: dh(20),
      discountBp: 1000,
    });
    expect(view.expenses).toEqual([{ category: 'rent', amountCents: dh(50), label: 'كراء' }]);
    expect(view.stock[0]).toMatchObject({
      remainingCm: 4000,
      costCents: dh(640),
      marketCents: dh(800),
    });
    expect(view.cash.map((row) => row.balanceCents)).toEqual([
      dh(180) - dh(800) - dh(50),
      dh(180) - dh(850),
    ]);
  });
});
