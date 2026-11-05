import 'fake-indexeddb/auto';
import { SALE_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedBatch, seedProduct } from './test-helpers';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let minute = 0;
const day = '2026-10-30';
let rosa: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  // A clock that moves a minute per call: history order is creation order.
  store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  rosa = await seedProduct(repos);
});

afterEach(async () => {
  await db.delete();
});

/** A batch of `lengthCm` at 16 dh/m, bought on `date`. */
const buy = (lengthCm: number, date = '2026-10-01') => seedBatch(repos, rosa, lengthCm, { date });

const line = (batchId: string, soldCm: number, perMeterCents = 1800, extra = {}) => ({
  batchId,
  unit: 'meter' as const,
  quantity: soldCm,
  price: { perUnitCents: perMeterCents },
  refPriceCents: 2000,
  minPriceCents: 1700,
  ...extra,
});

const opsOf = async (entity: string) =>
  (await db.outbox.toArray()).filter((op) => op.entity === entity);

const remaining = async (batchId: string) => {
  const quantity = (await repos.stock.view(batchId))?.ledger.available.meter;
  return quantity?.unit === 'meter' ? quantity.centimeters : undefined;
};

describe('sales on the device (BUILD_PROMPTS 3.4, ADR 0012)', () => {
  it('T5: a cash sale is saved with its move and payment, as one append op', async () => {
    const batchId = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(batchId, 100)],
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
    expect(view?.lines[0]?.product?.name).toBe('روزا');
    expect(view?.lines[0]?.line).toMatchObject({
      unit: 'meter',
      quantity: 100,
      minOverrideBy: null,
    });
    expect(await remaining(batchId)).toBe(4900);
    const [op] = await opsOf('sale');
    expect(op).toMatchObject({ entityId: saleId, kind: 'append' });
    expect(await repos.sales.list()).toEqual([
      expect.objectContaining({ customerName: null, lineCount: 1, dueCents: 0 }),
    ]);
  });

  it('proposes the oldest batch that holds enough, else splits oldest first; minus the cart', async () => {
    const old = await buy(300, '2026-09-01');
    const young = await buy(5000, '2026-10-01');
    expect((await repos.sales.batchesOfProduct(rosa)).map((choice) => choice.batch.id)).toEqual([
      old,
      young,
    ]);
    const flat = (found: Awaited<ReturnType<typeof repos.sales.propose>>) =>
      found.takes.map(({ take }) => [
        take.batchId,
        take.quantity.unit === 'meter' ? take.quantity.centimeters : 0,
      ]);
    expect(flat(await repos.sales.propose(rosa, 'meter', 200))).toEqual([[old, 200]]);
    expect(flat(await repos.sales.propose(rosa, 'meter', 400, new Map([[old, 100]])))).toEqual([
      [old, 200],
      [young, 200],
    ]);
    const across = await repos.sales.propose(rosa, 'meter', 5200);
    expect(across.shortfall).toBe(0);
    expect(flat(across)).toEqual([
      [old, 300],
      [young, 4900],
    ]);
    expect((await repos.sales.propose(rosa, 'meter', 6000)).shortfall).toBe(700);
  });

  describe('proposing a line next to the rest of the bill', () => {
    // The bill holds batches of several products; a proposal reads the batches of one of them.
    const SATIN_COST = 3000; // 30 dh/m
    let satin: string;
    beforeEach(async () => {
      satin = await seedProduct(repos, { name: 'ساتان', pricePerMeterCents: 4000 });
    });

    const flat = (found: Awaited<ReturnType<typeof repos.sales.propose>>) =>
      found.takes.map(({ take }) => [
        take.batchId,
        take.quantity.unit === 'meter' ? take.quantity.centimeters : 0,
      ]);
    /** Every take is a real batch, and of the product that was asked for. */
    const expectOwnBatches = async (
      found: Awaited<ReturnType<typeof repos.sales.propose>>,
      productId: string,
    ) => {
      for (const { take, choice } of found.takes) {
        expect(choice.batch.id).toBe(take.batchId);
        expect((await db.productBatches.get(take.batchId))?.productId).toBe(productId);
        expect(choice.batch.productId).toBe(productId);
      }
    };

    it('one product, one line on the bill: the next line is proposed what the line left', async () => {
      const only = await buy(1000);
      const found = await repos.sales.propose(rosa, 'meter', 300, new Map([[only, 400]]));
      expect(flat(found)).toEqual([[only, 300]]);
      expect(
        (await repos.sales.propose(rosa, 'meter', 700, new Map([[only, 400]]))).shortfall,
      ).toBe(100);
      await expectOwnBatches(found, rosa);
    });

    it('a second product after the first: its line is proposed from its own batches', async () => {
      const rosaBatch = await buy(5000);
      const satinBatch = await seedBatch(repos, satin, 3000, { costPerMeterCents: SATIN_COST });
      // 0.5 m of the first product is on the bill; 1 m of the second is added.
      const onBill = new Map([[rosaBatch, 50]]);
      const found = await repos.sales.propose(satin, 'meter', 100, onBill);
      expect(found.shortfall).toBe(0);
      expect(flat(found)).toEqual([[satinBatch, 100]]);
      await expectOwnBatches(found, satin);
      // And the other way round: the first product still gets all of its own stock.
      const back = await repos.sales.propose(rosa, 'meter', 4950, new Map([[satinBatch, 100]]));
      expect(flat(back)).toEqual([[rosaBatch, 4950]]);
      expect(back.shortfall).toBe(0);
      await expectOwnBatches(back, rosa);
    });

    it('two lines of one product add up, whatever else is on the bill', async () => {
      const old = await buy(300, '2026-09-01');
      const young = await buy(5000, '2026-10-01');
      const satinBatch = await seedBatch(repos, satin, 3000);
      // Two lines took 100 and 150 of the oldest batch (the dialog sums them per batch).
      const onBill = new Map([
        [old, 250],
        [satinBatch, 700],
      ]);
      const found = await repos.sales.propose(rosa, 'meter', 200, onBill);
      expect(flat(found)).toEqual([
        [old, 50],
        [young, 150],
      ]);
      await expectOwnBatches(found, rosa);
    });

    it('several batches per product: each product splits across its own, oldest first', async () => {
      const rosaOld = await buy(300, '2026-09-01');
      const rosaYoung = await buy(5000, '2026-10-01');
      const satinOld = await seedBatch(repos, satin, 200, { date: '2026-08-01' });
      const satinYoung = await seedBatch(repos, satin, 1000, { date: '2026-10-05' });
      const onBill = new Map([
        [rosaOld, 300],
        [satinOld, 150],
      ]);
      const forSatin = await repos.sales.propose(satin, 'meter', 300, onBill);
      expect(flat(forSatin)).toEqual([
        [satinOld, 50],
        [satinYoung, 250],
      ]);
      await expectOwnBatches(forSatin, satin);
      const forRosa = await repos.sales.propose(rosa, 'meter', 400, onBill);
      expect(flat(forRosa)).toEqual([[rosaYoung, 400]]);
      await expectOwnBatches(forRosa, rosa);
    });

    it('each take keeps the cost of the batch it comes from, and the sale costs them so', async () => {
      const rosaOld = await seedBatch(repos, rosa, 300, {
        date: '2026-09-01',
        costPerMeterCents: 1600,
      });
      const rosaYoung = await seedBatch(repos, rosa, 5000, { costPerMeterCents: 2000 });
      const satinBatch = await seedBatch(repos, satin, 3000, { costPerMeterCents: SATIN_COST });
      const onBill = new Map([[satinBatch, 100]]);
      const forRosa = await repos.sales.propose(rosa, 'meter', 400, onBill);
      expect(
        forRosa.takes.map(({ take, choice }) => [take.batchId, choice.batch.costTotalCents]),
      ).toEqual([
        [rosaOld, 4800],
        [rosaYoung, 2000 * 50],
      ]);
      // The whole bill: 400 cm of the first product (300 at 16 dh, 100 at 20 dh), 100 cm of satin at 30 dh.
      const lines = [
        ...forRosa.takes.map(({ take }) =>
          line(take.batchId, take.quantity.unit === 'meter' ? take.quantity.centimeters : 0, 2000),
        ),
        line(satinBatch, 100, 4000, { refPriceCents: 4000, minPriceCents: 3500 }),
      ];
      const saleId = await repos.sales.create({ date: day, lines, paidCents: 2000 * 4 + 4000 });
      expect((await repos.sales.get(saleId))?.figures).toMatchObject({
        totalCents: 12_000,
        capitalCents: 300 * 16 + 100 * 20 + SATIN_COST,
      });
    });

    it('a line removed or made smaller after another product was added frees its stock', async () => {
      const rosaBatch = await buy(1000);
      const satinBatch = await seedBatch(repos, satin, 3000, { costPerMeterCents: SATIN_COST });
      const both = new Map([
        [rosaBatch, 800],
        [satinBatch, 100],
      ]);
      expect((await repos.sales.propose(rosa, 'meter', 500, both)).shortfall).toBe(300);
      // The first line is made smaller (the dialog is then given the bill without it)…
      const smaller = new Map([
        [rosaBatch, 300],
        [satinBatch, 100],
      ]);
      expect(flat(await repos.sales.propose(rosa, 'meter', 500, smaller))).toEqual([
        [rosaBatch, 500],
      ]);
      // …or removed: the second product's hold stays, the first product has it all again.
      const removed = new Map([[satinBatch, 100]]);
      expect(flat(await repos.sales.propose(rosa, 'meter', 1000, removed))).toEqual([
        [rosaBatch, 1000],
      ]);
      expect(flat(await repos.sales.propose(satin, 'meter', 2900, removed))).toEqual([
        [satinBatch, 2900],
      ]);
      expect((await repos.sales.propose(satin, 'meter', 2901, removed)).shortfall).toBe(1);
    });

    it('not enough stock: the shortfall counts only this product, and nothing is taken twice', async () => {
      const rosaBatch = await buy(5000);
      const satinBatch = await seedBatch(repos, satin, 150);
      const onBill = new Map([
        [rosaBatch, 5000],
        [satinBatch, 100],
      ]);
      // The first product is all on the bill; the second has 50 cm left.
      const forRosa = await repos.sales.propose(rosa, 'meter', 10, onBill);
      expect(forRosa).toMatchObject({ takes: [], shortfall: 10 });
      const forSatin = await repos.sales.propose(satin, 'meter', 80, onBill);
      expect(flat(forSatin)).toEqual([[satinBatch, 50]]);
      expect(forSatin.shortfall).toBe(30);
    });

    it('a batch on the bill that has since gone off the shelf is left out, not an error', async () => {
      const gone = await buy(100, '2026-09-01');
      const kept = await buy(500, '2026-10-01');
      await repos.sales.create({ date: day, lines: [line(gone, 100)], paidCents: 1800 });
      const found = await repos.sales.propose(rosa, 'meter', 200, new Map([[gone, 100]]));
      expect(flat(found)).toEqual([[kept, 200]]);
    });
  });

  it('T11: under cost the preview asks for a confirmation and saving refuses without it', async () => {
    const batchId = await buy(5000);
    // 14 dh is under the cost (16) and under the minimum (17): each is its own decision.
    const input = {
      date: day,
      lines: [line(batchId, 100, 1400, { minOverrideBy: 'owner' })],
      paidCents: 1400,
    };
    expect(await repos.sales.preview(input)).toMatchObject({
      requiresConfirmation: true,
      belowMinimum: true,
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
    const batchId = await buy(5000);
    const customerId = await repos.customers.save({ name: 'فاطمة', phone: '0612345678' });
    await expect(
      repos.sales.create({ date: day, lines: [line(batchId, 250, 2000)], paidCents: 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const saleId = await repos.sales.create({
      date: day,
      customerId,
      lines: [line(batchId, 250, 2000)],
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
      'product',
      'purchase',
      'customer',
      'sale',
    ]);
  });

  it('voiding a sale puts the cloth back and refunds it, as one append op; only once', async () => {
    const batchId = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(batchId, 400)],
      paidCents: 7200,
    });
    await repos.sales.voidSale(saleId, 'خطأ في الإدخال');
    const view = await repos.sales.get(saleId);
    expect(view?.sale.voidedAt).not.toBeNull();
    expect(view?.saleVoid).toMatchObject({ reason: 'خطأ في الإدخال' });
    expect(view?.figures).toMatchObject({ capitalCents: null, dueCents: 0 });
    expect(await remaining(batchId)).toBe(5000);
    expect((await repos.stock.view(batchId))?.ledger.costs).toEqual([]);
    expect(await db.payments.toArray()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'refund', amountCents: 7200 })]),
    );
    expect(await opsOf('sale_void')).toHaveLength(1);
    await repos.sales.voidSale(saleId, 'مرة أخرى');
    expect(await opsOf('sale_void')).toHaveLength(1);
    await expect(repos.sales.voidSale(saleId, ' ')).rejects.toBeInstanceOf(ValidationError);
  });

  describe('the minimum selling price (ADR 0012)', () => {
    // 16.50 a meter: under the minimum (17) and over the cost (16).
    const underMinimum = (batchId: string, extra = {}) => ({
      date: day,
      lines: [line(batchId, 100, 1650, extra)],
      paidCents: 1650,
    });

    it('is a floor: a sale under it is refused, in the preview and on save', async () => {
      const batchId = await buy(5000);
      expect(
        (await repos.sales.preview(underMinimum(batchId))).issues.map((i) => i.message),
      ).toEqual([SALE_ISSUES.belowMinimum]);
      store.setUser({ role: 'cashier', username: 'amina' });
      await expect(repos.sales.create(underMinimum(batchId))).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(await opsOf('sale')).toHaveLength(0);
      expect(await remaining(batchId)).toBe(5000);
    });

    it('is judged against the product, not the figure the line carries', async () => {
      const batchId = await buy(5000);
      store.setUser({ role: 'owner', username: 'owner' });
      await expect(repos.sales.create(underMinimum(batchId, { minPriceCents: 0 }))).rejects.toEqual(
        new ValidationError([
          { path: ['lines', 0, 'price'], message: SALE_ISSUES.belowMinimum, code: 'custom' },
        ]),
      );
    });

    it('lets the owner override it, recording who and the price it went at', async () => {
      const batchId = await buy(5000);
      store.setUser({ role: 'owner', username: 'owner' });
      const saleId = await repos.sales.create(underMinimum(batchId, { minOverrideBy: 'owner' }));
      const view = await repos.sales.get(saleId);
      expect(view?.lines[0]?.line).toMatchObject({
        minOverrideBy: 'owner',
        actualPriceCents: 1650,
        lineTotalCents: 1650,
      });
      // Above the cost: no under-cost confirmation was needed.
      expect(view?.sale.confirmedBelowCost).toBe(false);
      expect(view?.figures).toMatchObject({ profitCents: 50 });
    });

    it('is never a cashier’s to override, whatever name the line gives', async () => {
      const batchId = await buy(5000);
      store.setUser({ role: 'cashier', username: 'amina' });
      await expect(
        repos.sales.create(underMinimum(batchId, { minOverrideBy: 'amina' })),
      ).rejects.toBeInstanceOf(Error);
      expect(await opsOf('sale')).toHaveLength(0);
    });

    it('is the owner’s own name that goes on the line', async () => {
      const batchId = await buy(5000);
      store.setUser({ role: 'owner', username: 'owner' });
      await expect(
        repos.sales.create(underMinimum(batchId, { minOverrideBy: 'someone-else' })),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

describe("the sales list: each invoice's figures come from the customer account", () => {
  const credit = async (soldCm: number, paidCents: number, extra = {}, date = day) => {
    const batchId = await buy(5000);
    const customerId = await repos.customers.save({ name: 'فاطمة', phone: '0612345678' });
    const saleId = await repos.sales.create({
      date,
      customerId,
      lines: [line(batchId, soldCm, 2000)],
      paidCents,
      ...extra,
    });
    return { saleId, customerId };
  };
  const rowOf = async (saleId: string) =>
    (await repos.sales.list()).find((row) => row.sale.id === saleId);

  it('a cash sale is paid in full, with nothing due, written off or overdue', async () => {
    const batchId = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(batchId, 100)],
      paidCents: 1800,
    });
    expect(await rowOf(saleId)).toMatchObject({
      netTotalCents: 1800,
      paidCents: 1800,
      dueCents: 0,
      writtenOff: false,
      overdue: false,
    });
  });

  it('a part-paid credit sale: paid + due = its worth, and a later payment moves both', async () => {
    const { saleId, customerId } = await credit(250, 1000);
    expect(await rowOf(saleId)).toMatchObject({
      netTotalCents: 5000,
      paidCents: 1000,
      dueCents: 4000,
    });
    await repos.accounts.recordPayment({ customerId, amountCents: 1500, date: day });
    expect(await rowOf(saleId)).toMatchObject({
      netTotalCents: 5000,
      paidCents: 2500,
      dueCents: 2500,
    });
  });

  it('the figures are the ones the customer account holds for that invoice', async () => {
    const { saleId, customerId } = await credit(250, 1000);
    await repos.accounts.recordPayment({ customerId, amountCents: 700, date: day });
    const account = (await repos.accounts.account(customerId))?.account;
    const invoice = account?.invoices.find((entry) => entry.saleId === saleId);
    const row = await rowOf(saleId);
    expect(row).toMatchObject({
      netTotalCents: invoice?.totalCents,
      paidCents: invoice?.paidCents,
      dueCents: invoice?.dueCents,
    });
    const owed = (await repos.sales.list())
      .filter((entry) => entry.sale.customerId === customerId && !entry.writtenOff)
      .reduce((sum, entry) => sum + entry.dueCents, 0);
    expect(owed).toBe(account?.collectibleCents);
  });

  it('a voided sale has nothing paid and nothing due', async () => {
    const { saleId } = await credit(250, 1000);
    await repos.sales.voidSale(saleId, 'خطأ في الإدخال');
    expect(await rowOf(saleId)).toMatchObject({ paidCents: 0, dueCents: 0, writtenOff: false });
  });

  it('goods given back lower its worth and what is paid on it never exceeds that', async () => {
    const { saleId } = await credit(250, 3000);
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'قصيرة',
      lines: [{ lineId, quantity: 200 }],
      refundCents: 0,
    });
    const row = await rowOf(saleId);
    expect(row?.netTotalCents).toBe(1000);
    expect(row?.paidCents).toBe(1000);
    expect(row?.dueCents).toBe(0);
    expect((row?.paidCents ?? 0) + (row?.dueCents ?? 0)).toBe(row?.netTotalCents);
  });

  it('a written-off debt keeps its due amount and is flagged', async () => {
    const { saleId } = await credit(250, 1000);
    await repos.accounts.writeOff(saleId, 'سافر');
    expect(await rowOf(saleId)).toMatchObject({ dueCents: 4000, writtenOff: true, overdue: false });
  });

  it('is overdue once its due date has passed and something is still due', async () => {
    const { saleId } = await credit(250, 1000, { dueDate: '2026-10-15' }, '2026-10-01');
    expect(await rowOf(saleId)).toMatchObject({ dueCents: 4000, overdue: true });
  });

  it('is not overdue before its due date, nor once it is paid', async () => {
    const { saleId, customerId } = await credit(250, 1000, { dueDate: '2026-11-30' });
    expect((await rowOf(saleId))?.overdue).toBe(false);
    await repos.accounts.recordPayment({ customerId, amountCents: 4000, date: day });
    expect(await rowOf(saleId)).toMatchObject({ dueCents: 0, overdue: false });
  });

  it('lists the newest day first, then the latest saved', async () => {
    const batchId = await buy(5000);
    const older = await repos.sales.create({
      date: '2026-10-01',
      lines: [line(batchId, 100)],
      paidCents: 1800,
    });
    const newer = await repos.sales.create({
      date: day,
      lines: [line(batchId, 100)],
      paidCents: 1800,
    });
    const sameDay = await repos.sales.create({
      date: day,
      lines: [line(batchId, 100)],
      paidCents: 1800,
    });
    expect((await repos.sales.list()).map((row) => row.sale.id)).toEqual([sameDay, newer, older]);
  });
});
