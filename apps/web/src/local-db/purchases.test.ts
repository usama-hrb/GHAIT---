import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { DeviceNotRegisteredError } from './purchases';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedProduct } from './test-helpers';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let clock = new Date('2026-10-30T09:00:00.000Z');
let rosa: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => clock);
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  rosa = await seedProduct(repos, { minPricePerMeterCents: 1800 });
});

afterEach(async () => {
  await db.delete();
});

/** 50 m bought by the meter at 16 dh. */
const meter = (extra = {}) => ({
  date: '2026-10-30',
  productId: rosa,
  unit: 'meter' as const,
  quantity: 5000,
  totalCostCents: 80_000,
  ...extra,
});

describe('purchases on the device (BUILD_PROMPTS 3.2, ADR 0012)', () => {
  it('T1: saves the purchase, its batch and receipt, and one append op', async () => {
    const id = await repos.purchases.create(meter());
    expect(await repos.purchases.get(id)).toMatchObject({
      totalCostCents: 80_000,
      paidCents: 80_000,
      serverSeq: null,
    });
    const [batch] = await repos.purchases.batchesOf(id);
    expect(batch).toMatchObject({
      code: 'B-A0001',
      productId: rosa,
      unit: 'meter',
      receivedQuantity: 5000,
      costTotalCents: 80_000,
      conversion: null,
      status: 'active',
    });
    expect(
      await db.productStockMoves
        .where('batchId')
        .equals(batch?.id ?? '')
        .toArray(),
    ).toEqual([
      expect.objectContaining({ type: 'purchase', unit: 'meter', delta: 5000, refId: id }),
    ]);
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'purchase');
    expect(ops).toEqual([
      expect.objectContaining({ entityId: id, kind: 'append', state: 'pending' }),
    ]);
  });

  it('Rosa: 100 kg for 200 dh at 0.5 kg a meter is 200 m at 1 dh, kept as the weight it was bought in', async () => {
    const id = await repos.purchases.create(
      meter({
        unit: 'kg',
        quantity: 100_000,
        totalCostCents: 20_000,
        conversion: { weightG: 500, lengthCm: 100, source: 'measured' },
      }),
    );
    const [batch] = await repos.purchases.batchesOf(id);
    expect(batch).toMatchObject({ unit: 'kg', receivedQuantity: 100_000 });
    const view = await repos.stock.view(batch?.id ?? '');
    expect(view?.ledger).toMatchObject({
      available: { meter: { unit: 'meter', centimeters: 20_000 } },
      costPerUnitCents: { meter: 100 },
      measurementStatus: 'measured',
    });
  });

  it('Rosa without a known conversion: the weight is recorded and awaits a measurement, no meters made up', async () => {
    const id = await repos.purchases.create(
      meter({ unit: 'kg', quantity: 100_000, totalCostCents: 20_000 }),
    );
    const [batch] = await repos.purchases.batchesOf(id);
    const ledger = (await repos.stock.view(batch?.id ?? ''))?.ledger;
    expect(ledger).toMatchObject({
      measurementStatus: 'pending',
      awaitingMeasurement: { unit: 'kg', grams: 100_000 },
    });
    expect(ledger?.available.meter).toEqual({ unit: 'meter', centimeters: 0 });
  });

  it('a restock is a batch of its own, numbered on from the last one, offline', async () => {
    const first = await repos.purchases.create(meter());
    expect(await repos.purchases.nextBatchCode()).toBe('B-A0002');
    const second = await repos.purchases.create(meter({ totalCostCents: 90_000 }));
    expect((await repos.purchases.batchesOf(second))[0]).toMatchObject({
      code: 'B-A0002',
      costTotalCents: 90_000,
    });
    // The first batch is exactly as it was.
    expect((await repos.purchases.batchesOf(first))[0]).toMatchObject({
      code: 'B-A0001',
      costTotalCents: 80_000,
    });
    expect(await db.productBatches.count()).toBe(2);
  });

  it('refuses without a device code, an unknown product or unit, and invalid input, writing nothing', async () => {
    await store.setMeta(DEVICE_CODE, null);
    await expect(repos.purchases.create(meter())).rejects.toBeInstanceOf(DeviceNotRegisteredError);
    await store.setMeta(DEVICE_CODE, 'A');
    await expect(repos.purchases.create(meter({ quantity: 0 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      repos.purchases.create(meter({ productId: crypto.randomUUID() })),
    ).rejects.toBeInstanceOf(ValidationError);
    const metersOnly = await seedProduct(repos, { name: 'م', purchaseUnits: ['meter'] });
    await expect(
      repos.purchases.create(meter({ productId: metersOnly, unit: 'piece', quantity: 3 })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.purchases.count()).toBe(0);
    expect((await db.outbox.toArray()).filter((op) => op.entity === 'purchase')).toEqual([]);
  });

  it('lists purchases newest first with their product', async () => {
    await repos.purchases.create(meter());
    clock = new Date('2026-10-31T09:00:00.000Z');
    await repos.purchases.create(meter({ date: '2026-10-31' }));
    const list = await repos.purchases.list();
    expect(list.map((row) => [row.purchase.date, row.productNames, row.batchCount])).toEqual([
      ['2026-10-31', ['روزا'], 1],
      ['2026-10-30', ['روزا'], 1],
    ]);
  });

  it('finds the product’s previous batch for the renewal warning (SPEC §8.5)', async () => {
    expect(await repos.purchases.lastBatchOf(rosa)).toBeNull();
    await repos.purchases.create(meter());
    clock = new Date('2026-10-31T09:00:00.000Z');
    await repos.purchases.create(meter({ date: '2026-10-31', totalCostCents: 85_000 }));
    expect(await repos.purchases.lastBatchOf(rosa)).toEqual([
      { costTotalCents: 85_000, lengthCm: 5000 },
    ]);
    // A weight with no length yet has nothing to compare.
    clock = new Date('2026-11-01T09:00:00.000Z');
    await repos.purchases.create(
      meter({ date: '2026-11-01', unit: 'kg', quantity: 1000, totalCostCents: 5000 }),
    );
    expect(await repos.purchases.lastBatchOf(rosa)).toBeNull();
  });

  it('reads a weight batch by the length it makes, not by its conversion’s own length', async () => {
    // 20 kg at 4 m a kilo is 80 m for 8000 rial: 100 rial a metre, not 8000 rial over 4 m.
    clock = new Date('2026-11-01T09:00:00.000Z');
    await repos.purchases.create(
      meter({
        date: '2026-11-01',
        unit: 'kg',
        quantity: 20_000,
        totalCostCents: 40_000,
        conversion: { weightG: 1000, lengthCm: 400, source: 'estimated' },
      }),
    );
    expect(await repos.purchases.lastBatchOf(rosa)).toEqual([
      { costTotalCents: 40_000, lengthCm: 8000 },
    ]);
  });

  it('reads a measured weight batch by the length measured', async () => {
    clock = new Date('2026-11-01T09:00:00.000Z');
    await repos.purchases.create(
      meter({ date: '2026-11-01', unit: 'kg', quantity: 20_000, totalCostCents: 40_000 }),
    );
    const [batch] = await db.productBatches.toArray();
    await repos.productInventory.measure(batch?.id ?? '', 7600);
    expect(await repos.purchases.lastBatchOf(rosa)).toEqual([
      { costTotalCents: 40_000, lengthCm: 7600 },
    ]);
  });
});
