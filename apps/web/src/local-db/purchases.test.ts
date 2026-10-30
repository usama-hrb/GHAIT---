import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { DeviceNotRegisteredError } from './purchases';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let clock = new Date('2026-10-30T09:00:00.000Z');
let fabricId: string;
let colors: string[];

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => clock);
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
  });
  colors = [];
  for (const name of ['أحمر', 'أزرق', 'أخضر']) {
    colors.push(await repos.variants.save({ fabricId, colorName: name }));
  }
});

afterEach(async () => {
  await db.delete();
});

const meter = (pricePerMeterCents: number, lengthCm = 5000) => ({
  method: 'meter' as const,
  date: '2026-10-30',
  pricePerMeterCents,
  rolls: colors.map((variantId) => ({ variantId, lengthCm })),
});

describe('purchases on the device (BUILD_PROMPTS 3.2)', () => {
  it('T1: saves the purchase, its rolls and moves, and one append op', async () => {
    const id = await repos.purchases.create(meter(1600));
    expect(await repos.purchases.get(id)).toMatchObject({
      totalCostCents: 240_000,
      paidCents: 240_000,
      serverSeq: null,
    });
    const rolls = await repos.purchases.rollsOf(id);
    expect(
      rolls.map((roll) => [roll.shortCode, roll.costTotalCents, roll.lengthCmInitial]),
    ).toEqual([
      ['R-A0001', 80_000, 5000],
      ['R-A0002', 80_000, 5000],
      ['R-A0003', 80_000, 5000],
    ]);
    expect(
      await db.stockMoves
        .where('rollId')
        .equals(rolls[0]?.id ?? '')
        .toArray(),
    ).toEqual([expect.objectContaining({ type: 'purchase', deltaCm: 5000, refId: id })]);
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'purchase');
    expect(ops).toEqual([
      expect.objectContaining({
        entity: 'purchase',
        entityId: id,
        kind: 'append',
        state: 'pending',
      }),
    ]);
  });

  it('numbers rolls on from the last one, offline, with the device’s code', async () => {
    await repos.purchases.create(meter(1600));
    expect(await repos.purchases.nextRollCodes(2)).toEqual(['R-A0004', 'R-A0005']);
    const piece = await repos.purchases.create({
      method: 'piece',
      date: '2026-10-30',
      variantId: colors[0] ?? '',
      lengthCm: 230,
      totalCostCents: 10_000,
    });
    expect((await repos.purchases.rollsOf(piece))[0]).toMatchObject({
      shortCode: 'R-A0004',
      costTotalCents: 10_000,
    });
  });

  it('T4: a kg roll is estimated from the weight', async () => {
    const id = await repos.purchases.create({
      method: 'kg',
      date: '2026-10-30',
      variantId: colors[1] ?? '',
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    });
    expect((await repos.purchases.rollsOf(id))[0]).toMatchObject({
      lengthCmInitial: 8000,
      lengthEstimated: true,
    });
  });

  it('refuses without a device code, and invalid input, writing nothing', async () => {
    await store.setMeta(DEVICE_CODE, null);
    await expect(repos.purchases.create(meter(1600))).rejects.toBeInstanceOf(
      DeviceNotRegisteredError,
    );
    await store.setMeta(DEVICE_CODE, 'A');
    await expect(repos.purchases.create({ ...meter(1600), rolls: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.purchases.count()).toBe(0);
    expect((await db.outbox.toArray()).filter((op) => op.entity === 'purchase')).toEqual([]);
  });

  it('lists purchases newest first with their fabric', async () => {
    await repos.purchases.create(meter(1600));
    clock = new Date('2026-10-31T09:00:00.000Z');
    await repos.purchases.create({ ...meter(1700), date: '2026-10-31' });
    const list = await repos.purchases.list();
    expect(list.map((row) => [row.purchase.date, row.fabricName, row.rollCount])).toEqual([
      ['2026-10-31', 'روزا', 3],
      ['2026-10-30', 'روزا', 3],
    ]);
  });

  it('finds the fabric’s previous batch for the renewal warning (SPEC §8.5)', async () => {
    expect(await repos.purchases.lastBatchOf(fabricId)).toBeNull();
    await repos.purchases.create(meter(1600));
    clock = new Date('2026-10-31T09:00:00.000Z');
    await repos.purchases.create({ ...meter(1700), date: '2026-10-31' });
    expect(await repos.purchases.lastBatchOf(fabricId)).toEqual([
      { costTotalCents: 85_000, lengthCm: 5000 },
      { costTotalCents: 85_000, lengthCm: 5000 },
      { costTotalCents: 85_000, lengthCm: 5000 },
    ]);
  });
});
