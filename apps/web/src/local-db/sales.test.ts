import 'fake-indexeddb/auto';
import { SALE_ISSUES } from '@fabric/contracts';
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
let red: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  // A clock that moves a minute per call: history order is creation order.
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
  });
  red = await repos.variants.save({ fabricId, colorName: 'أحمر' });
});

afterEach(async () => {
  await db.delete();
});

/** A roll of `lengthCm` at 16 dh/m, bought on `date`. */
async function buy(lengthCm: number, date = '2026-10-01'): Promise<string> {
  const purchaseId = await repos.purchases.create({
    method: 'meter',
    date,
    pricePerMeterCents: 1600,
    rolls: [{ variantId: red, lengthCm }],
  });
  const [roll] = await repos.purchases.rollsOf(purchaseId);
  if (!roll) throw new Error('no roll');
  return roll.id;
}

const line = (rollId: string, soldCm: number, perMeterCents = 1800) => ({
  rollId,
  soldCm,
  price: { perMeterCents },
  refPricePerMeterCents: 2000,
  minPricePerMeterCents: 1700,
});

const opsOf = async (entity: string) =>
  (await db.outbox.toArray()).filter((op) => op.entity === entity);

describe('sales on the device (BUILD_PROMPTS 3.4)', () => {
  it('T5: a cash sale is saved with its move and payment, as one append op', async () => {
    const rollId = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 100)],
      paidCents: 1800,
    });
    const view = await repos.sales.get(saleId);
    expect(view?.figures).toMatchObject({
      totalCents: 1800,
      capitalCents: 1600,
      profitCents: 200,
      paidCents: 1800,
      dueCents: 0,
    });
    expect(view?.lines[0]?.fabric?.name).toBe('روزا');
    expect((await repos.inventory.roll(rollId))?.ledger.remainingCm).toBe(4900);
    const [op] = await opsOf('sale');
    expect(op).toMatchObject({ entityId: saleId, kind: 'append' });
    expect(await repos.sales.list()).toEqual([
      expect.objectContaining({ customerName: null, lineCount: 1, dueCents: 0 }),
    ]);
  });

  it('proposes the oldest roll that holds enough, else splits oldest first; minus the cart', async () => {
    const old = await buy(300, '2026-09-01');
    const young = await buy(5000, '2026-10-01');
    expect((await repos.sales.rollsOfColor(red)).map((choice) => choice.roll.id)).toEqual([
      old,
      young,
    ]);
    const single = await repos.sales.propose(red, 200);
    expect(single.takes.map((take) => [take.rollId, take.cm])).toEqual([[old, 200]]);
    const split = await repos.sales.propose(red, 400, new Map([[old, 100]]));
    expect(split.takes.map((take) => [take.rollId, take.cm])).toEqual([[young, 400]]);
    const across = await repos.sales.propose(red, 5200);
    expect(across).toMatchObject({ shortCm: 0 });
    expect(across.takes.map((take) => [take.rollId, take.cm])).toEqual([
      [old, 300],
      [young, 4900],
    ]);
    expect((await repos.sales.propose(red, 6000)).shortCm).toBe(700);
  });

  it('T11: under cost the preview asks for a confirmation and saving refuses without it', async () => {
    const rollId = await buy(5000);
    const input = { date: day, lines: [line(rollId, 100, 1400)], paidCents: 1400 };
    expect(await repos.sales.preview(input)).toMatchObject({
      requiresConfirmation: true,
      split: { lossCents: 200 },
    });
    await expect(repos.sales.create(input)).rejects.toEqual(
      new ValidationError([
        { path: ['confirmedBelowCost'], message: SALE_ISSUES.belowCostUnconfirmed, code: 'custom' },
      ]),
    );
    await expect(repos.sales.create({ ...input, confirmedBelowCost: true })).resolves.toBeTypeOf(
      'string',
    );
  });

  it('a credit sale to a customer added on the spot owes the rest', async () => {
    const rollId = await buy(5000);
    const customerId = await repos.customers.save({ name: 'فاطمة', phone: '0612345678' });
    await expect(
      repos.sales.create({ date: day, lines: [line(rollId, 250, 2000)], paidCents: 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const saleId = await repos.sales.create({
      date: day,
      customerId,
      lines: [line(rollId, 250, 2000)],
      paidCents: 1000,
      dueDate: '2026-11-30',
    });
    expect((await repos.sales.get(saleId))?.figures).toMatchObject({
      paidCents: 1000,
      dueCents: 4000,
    });
    expect((await repos.sales.list())[0]).toMatchObject({ customerName: 'فاطمة', dueCents: 4000 });
    // The customer's op is queued first, so the server has them before the sale.
    expect((await db.outbox.toArray()).map((op) => op.entity)).toEqual([
      'fabric',
      'variant',
      'purchase',
      'customer',
      'sale',
    ]);
  });

  it('voiding a sale puts the cloth back and refunds it, as one append op; only once', async () => {
    const rollId = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 400)],
      paidCents: 7200,
    });
    await repos.sales.voidSale(saleId, 'خطأ في الإدخال');
    const view = await repos.sales.get(saleId);
    expect(view?.sale.voidedAt).not.toBeNull();
    expect(view?.saleVoid).toMatchObject({ reason: 'خطأ في الإدخال' });
    expect(view?.figures).toMatchObject({ capitalCents: null, dueCents: 0 });
    expect((await repos.inventory.roll(rollId))?.ledger).toMatchObject({
      remainingCm: 5000,
      costs: [],
    });
    expect(await db.payments.toArray()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'refund', amountCents: 7200 })]),
    );
    expect(await opsOf('sale_void')).toHaveLength(1);
    await repos.sales.voidSale(saleId, 'مرة أخرى');
    expect(await opsOf('sale_void')).toHaveLength(1);
    await expect(repos.sales.voidSale(saleId, ' ')).rejects.toBeInstanceOf(ValidationError);
  });
});
