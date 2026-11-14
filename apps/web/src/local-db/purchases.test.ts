import 'fake-indexeddb/auto';
import { PURCHASE_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { isPeriodLocked, NotAllowedError, ValidationError } from './errors';
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

describe('correcting what was paid on a purchase (SP9)', () => {
  let supplier: string;

  beforeEach(async () => {
    supplier = await repos.suppliers.save({ name: 'مورد التصحيح' });
  });

  const owed = async () => (await repos.supplierAccounts.account(supplier))?.account.owedCents;
  const upserts = async () =>
    (await db.outbox.toArray()).filter((op) => op.entity === 'purchase' && op.kind === 'upsert');

  it('5000 dh bought and paid in full by mistake, 1000 dh really paid: 4000 dh is owed, offline', async () => {
    const id = await repos.purchases.create(
      meter({ supplierId: supplier, quantity: 5000, totalCostCents: 500_000 }),
    );
    expect(await owed()).toBe(0);

    await repos.purchases.setPayment(id, { paidCents: 100_000, supplierId: supplier });

    expect(await owed()).toBe(400_000);
    expect(await repos.purchases.get(id)).toMatchObject({
      paidCents: 100_000,
      totalCostCents: 500_000,
      supplierId: supplier,
    });
    // One op, a change of the record that was made; the stock it brought in is untouched.
    const [op] = await upserts();
    expect(await upserts()).toHaveLength(1);
    expect(op).toMatchObject({ entityId: id, state: 'pending' });
    expect(op?.payload).toMatchObject({ id, paidCents: 100_000, totalCostCents: 500_000 });
    const [batch] = await repos.purchases.batchesOf(id);
    expect(batch).toMatchObject({ receivedQuantity: 5000, costTotalCents: 500_000 });
  });

  it('puts the figure back to the total, and does nothing when nothing changed', async () => {
    const id = await repos.purchases.create(
      meter({ supplierId: supplier, paidCents: 20_000, totalCostCents: 80_000 }),
    );
    expect(await owed()).toBe(60_000);
    await repos.purchases.setPayment(id, { paidCents: 20_000, supplierId: supplier });
    expect(await upserts()).toHaveLength(0);

    await repos.purchases.setPayment(id, { paidCents: 80_000, supplierId: supplier });
    expect(await owed()).toBe(0);
    expect(await upserts()).toHaveLength(1);
  });

  it('refuses more than the purchase cost, a debt with no supplier, and another supplier', async () => {
    const other = await repos.suppliers.save({ name: 'مورد آخر' });
    const withSupplier = await repos.purchases.create(meter({ supplierId: supplier }));
    const without = await repos.purchases.create(meter());

    const issuesOf = async (work: Promise<void>) => {
      const error = await work.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ValidationError);
      return (error as ValidationError).issues.map((issue) => issue.message);
    };
    expect(
      await issuesOf(
        repos.purchases.setPayment(withSupplier, { paidCents: 80_001, supplierId: supplier }),
      ),
    ).toEqual([PURCHASE_ISSUES.paidAboveTotal]);
    expect(
      await issuesOf(repos.purchases.setPayment(without, { paidCents: 10_000, supplierId: null })),
    ).toEqual([PURCHASE_ISSUES.debtNeedsSupplier]);
    expect(
      await issuesOf(
        repos.purchases.setPayment(withSupplier, { paidCents: 10_000, supplierId: other }),
      ),
    ).toEqual([PURCHASE_ISSUES.fieldsFixed]);
    expect(await upserts()).toHaveLength(0);
    expect(await repos.purchases.get(withSupplier)).toMatchObject({ paidCents: 80_000 });
  });

  it('previews what a correction would leave, with the save’s own check, and saves nothing', async () => {
    const id = await repos.purchases.create(
      meter({ supplierId: supplier, quantity: 5000, totalCostCents: 500_000 }),
    );
    expect(
      await repos.purchases.previewPayment(crypto.randomUUID(), {
        paidCents: 0,
        supplierId: supplier,
      }),
    ).toBeNull();
    expect(
      await repos.purchases.previewPayment(id, { paidCents: 100_000, supplierId: supplier }),
    ).toEqual({
      issues: [],
      purchaseDueCents: 400_000,
      owedCents: 400_000,
      advanceCents: 0,
    });
    const refused = await repos.purchases.previewPayment(id, {
      paidCents: 500_001,
      supplierId: supplier,
    });
    expect(refused?.issues.map((issue) => issue.message)).toEqual([PURCHASE_ISSUES.paidAboveTotal]);
    expect(await owed()).toBe(0);
    expect(await upserts()).toHaveLength(0);

    // Another purchase from the same supplier is part of what is owed in all, not of this one.
    await repos.purchases.create(
      meter({ supplierId: supplier, paidCents: 0, totalCostCents: 80_000 }),
    );
    expect(
      await repos.purchases.previewPayment(id, { paidCents: 100_000, supplierId: supplier }),
    ).toMatchObject({
      purchaseDueCents: 400_000,
      owedCents: 480_000,
    });
  });

  it('shows the advance a correction would make when payments since already cover the debt', async () => {
    const id = await repos.purchases.create(
      meter({ supplierId: supplier, paidCents: 0, totalCostCents: 80_000 }),
    );
    await repos.supplierAccounts.pay({
      supplierId: supplier,
      amountCents: 80_000,
      date: '2026-10-30',
    });
    expect(await owed()).toBe(0);
    expect(
      await repos.purchases.previewPayment(id, { paidCents: 80_000, supplierId: supplier }),
    ).toMatchObject({
      purchaseDueCents: 0,
      owedCents: 0,
      advanceCents: 80_000,
    });
  });

  it('a purchase with no supplier takes one with the correction, and then it is owed', async () => {
    const id = await repos.purchases.create(meter());
    await repos.purchases.setPayment(id, { paidCents: 30_000, supplierId: supplier });
    expect(await owed()).toBe(50_000);
  });

  it('is refused for a purchase in a settled month until it is unlocked', async () => {
    const id = await repos.purchases.create(meter({ supplierId: supplier }));
    await db.settlements.put({
      id: crypto.randomUUID(),
      createdAt: '2026-11-02T09:00:00.000Z',
      updatedAt: '2026-11-02T09:00:00.000Z',
      deviceId: 'server',
      voidedAt: null,
      serverSeq: 1,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      recognizedProfitCents: 0,
      returnsEffectCents: 0,
      recoveredBadDebtCents: 0,
      damageCents: 0,
      badDebtCents: 0,
      belowCostCents: 0,
      expensesCents: 0,
      cashOverShortCents: 0,
      carriedDeficitInCents: 0,
      netProfitCents: 0,
      ownerShareCents: 0,
      partnerShareCents: 0,
      shopShareCents: 0,
      carryDeficitOutCents: 0,
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: null,
      lockedAt: '2026-11-02T09:00:00.000Z',
    });
    await expect(
      repos.purchases.setPayment(id, { paidCents: 10_000, supplierId: supplier }),
    ).rejects.toSatisfy(isPeriodLocked);
    expect(await owed()).toBe(0);
  });

  it('is not a cashier’s to make, and a partner’s device changes nothing', async () => {
    const id = await repos.purchases.create(meter({ supplierId: supplier }));
    store.setRole('cashier');
    await expect(
      repos.purchases.setPayment(id, { paidCents: 10_000, supplierId: supplier }),
    ).rejects.toBeInstanceOf(NotAllowedError);
    store.setRole('partner');
    await expect(
      repos.purchases.setPayment(id, { paidCents: 10_000, supplierId: supplier }),
    ).rejects.toThrow(/read/);
    expect(await repos.purchases.get(id)).toMatchObject({ paidCents: 80_000 });
  });
});
