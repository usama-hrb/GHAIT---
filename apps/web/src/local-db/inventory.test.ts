import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
let minute = 0;
const day = '2026-10-30';
let fabricId: string;
let red: string;
let blue: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  // A clock that moves a minute per call: history order is creation order.
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
    estCmPerKg: 400,
  });
  red = await repos.variants.save({ fabricId, colorName: 'أحمر', lowStockThresholdCm: 1000 });
  blue = await repos.variants.save({ fabricId, colorName: 'أزرق' });
});

afterEach(async () => {
  await db.delete();
});

async function rollOf(purchaseId: string): Promise<string> {
  const [roll] = await repos.purchases.rollsOf(purchaseId);
  if (!roll) throw new Error('no roll');
  return roll.id;
}

const meterRoll = async (variantId: string, lengthCm = 5000) =>
  rollOf(
    await repos.purchases.create({
      method: 'meter',
      date: day,
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm }],
    }),
  );

describe('stock actions (BUILD_PROMPTS 3.3)', () => {
  it('T12: a 30 cm loss costs 480 and queues an append op', async () => {
    const rollId = await meterRoll(red);
    const moveId = await repos.inventory.record({
      type: 'loss',
      rollId,
      date: day,
      lengthCm: 30,
      reason: 'بقعة',
    });
    const view = await repos.inventory.roll(rollId);
    expect(view?.ledger).toMatchObject({
      remainingCm: 4970,
      costs: [{ id: moveId, costCents: 480 }],
    });
    expect(view?.moves.map((move) => move.type)).toEqual(['purchase', 'loss']);
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'stock_move');
    expect(ops).toEqual([expect.objectContaining({ entityId: moveId, kind: 'append' })]);
  });

  it('T4: measuring a kg roll corrects it, re-costs it and updates the fabric’s m/kg', async () => {
    const purchaseId = await repos.purchases.create({
      method: 'kg',
      date: day,
      variantId: blue,
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    });
    const rollId = await rollOf(purchaseId);
    expect((await repos.inventory.roll(rollId))?.ledger).toMatchObject({
      lengthEstimated: true,
      costPerMeterCents: 500,
    });
    await repos.inventory.record({
      type: 'length_correction',
      rollId,
      date: day,
      measuredRemainingCm: 7600,
    });
    const view = await repos.inventory.roll(rollId);
    expect(view?.ledger).toMatchObject({
      basisLengthCm: 7600,
      lengthEstimated: false,
      costPerMeterCents: 526,
    });
    expect(view?.moves.at(-1)).toMatchObject({ type: 'length_correction', deltaCm: -400 });
    expect((await repos.fabrics.get(fabricId))?.estCmPerKg).toBe(380);
  });

  it('a stocktake records the difference; a count that changes nothing is refused', async () => {
    const rollId = await meterRoll(red);
    await repos.inventory.record({
      type: 'adjustment',
      rollId,
      date: day,
      countedCm: 4950,
      reason: 'جرد',
    });
    expect((await repos.inventory.roll(rollId))?.ledger.remainingCm).toBe(4950);
    await expect(
      repos.inventory.record({
        type: 'adjustment',
        rollId,
        date: day,
        countedCm: 4950,
        reason: 'جرد',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repos.inventory.record({ type: 'loss', rollId, date: day, lengthCm: 30, reason: ' ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('marks a roll as a remnant (and back), as a roll upsert op', async () => {
    const rollId = await meterRoll(red);
    await repos.inventory.setRemnant(rollId, true);
    expect((await repos.inventory.roll(rollId))?.state).toBe('remnant');
    await repos.inventory.setRemnant(rollId, false);
    expect((await repos.inventory.roll(rollId))?.state).toBe('active');
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'roll');
    expect(ops.map((op) => (op.payload as { status: string }).status)).toEqual([
      'remnant',
      'active',
    ]);
  });
});

describe('inventory overview', () => {
  it('shows what is left per colour, low and out of stock, and finds a roll by its code', async () => {
    const first = await meterRoll(red, 800);
    const second = await meterRoll(red, 150);
    await repos.inventory.record({
      type: 'loss',
      rollId: second,
      date: day,
      lengthCm: 150,
      reason: 'تالف',
    });
    const { fabrics } = await repos.inventory.overview();
    expect(fabrics).toHaveLength(1);
    expect(
      fabrics[0]?.colors.map((color) => [
        color.variant.colorName,
        color.remainingCm,
        color.rollCount,
        color.state,
      ]),
    ).toEqual([
      ['أحمر', 800, 1, 'low'],
      ['أزرق', 0, 0, 'out'],
    ]);
    const code = (await repos.inventory.roll(first))?.roll.shortCode ?? '';
    const byCode = await repos.inventory.overview(code.toLowerCase());
    expect(byCode.rollMatch?.id).toBe(first);
    expect((await repos.inventory.overview('أحمر')).fabrics).toHaveLength(1);
    expect((await repos.inventory.overview('كريب')).fabrics).toHaveLength(0);
  });

  it('lists a colour’s rolls with those that still have cloth first', async () => {
    const empty = await meterRoll(red, 100);
    await repos.inventory.record({
      type: 'loss',
      rollId: empty,
      date: day,
      lengthCm: 100,
      reason: 'تالف',
    });
    const full = await meterRoll(red);
    const rolls = await repos.inventory.rollsOfColor(red);
    expect(rolls.map((view) => [view.roll.id, view.state])).toEqual([
      [full, 'active'],
      [empty, 'empty'],
    ]);
  });
});
