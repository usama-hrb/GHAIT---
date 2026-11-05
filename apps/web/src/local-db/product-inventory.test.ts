import 'fake-indexeddb/auto';
import type { ProductStockBatch, ProductStockMovement } from '@fabric/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { ShopDatabase } from './db';
import {
  matchesStockFilter,
  type ProductBatchSource,
  type ProductIdentity,
  type ProductInventoryQuery,
  productMovements,
  type ProductStockView,
  stockStatusOf,
  summarizeInventory,
  summarizeProductStock,
} from './product-inventory';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedBatch, seedProduct } from './test-helpers';

let db: ShopDatabase;
let repos: Repositories;
let minute = 0;
const day = '2026-10-30';
const NO_LOW = { threshold: null, unit: 'meter' as const };
const lowAt = (threshold: number) => ({ threshold, unit: 'meter' as const });

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
});

afterEach(async () => {
  await db.delete();
});

const overview = (query?: ProductInventoryQuery) => repos.productInventory.overview(query);
const find = async (name: string) =>
  (await overview()).products.find((product) => product.name === name);
const names = async (query?: ProductInventoryQuery) =>
  (await overview(query)).products.map((product) => product.name);

/** A product sold by the meter, with the prices the form requires. */
const rosa = (name = 'Rosa', extra = {}) =>
  seedProduct(repos, { name, minPricePerMeterCents: 1800, ...extra });

describe('product stock from its batches (ADR 0012)', () => {
  it('shows a product with its stock from its batches through the product ledger', async () => {
    const product = await rosa('Rosa - Red');
    const batchId = await seedBatch(repos, product, 5000, { date: day });
    await repos.stock.act({ type: 'loss', batchId, date: day, quantity: 30, reason: 'x' });

    const view = await find('Rosa - Red');
    expect(view).toMatchObject({
      id: product,
      sellingUnits: ['meter'],
      availableCm: 4_970,
      availablePieces: 0,
      awaitingMeasurementG: 0,
      status: 'in_stock',
      batchCount: 1,
      needsReview: false,
      unreadable: [],
    });
    expect(view?.batches).toEqual([
      expect.objectContaining({
        batchId,
        code: 'B-A0001',
        remnant: false,
        unit: 'meter',
        purchaseDate: day,
        remainingCm: 4_970,
        remainingPieces: 0,
        receivedG: null,
        receivedQuantity: 5000,
        status: 'not_required',
        awaitingG: 0,
        costTotalCents: 80_000,
        costPerMeterCents: 1_600,
        costPerPieceCents: null,
        oversold: false,
      }),
    ]);
  });

  it('keeps a kg batch’s weight and an estimated length until it is measured (T4)', async () => {
    const product = await rosa('Rosa - Blue');
    await repos.purchases.create({
      date: day,
      productId: product,
      unit: 'kg',
      quantity: 20_000,
      totalCostCents: 40_000,
      conversion: { weightG: 20_000, lengthCm: 8000, source: 'estimated' },
    });
    expect((await find('Rosa - Blue'))?.batches[0]).toMatchObject({
      receivedG: 20_000,
      remainingCm: 8_000,
      status: 'estimated',
      costPerMeterCents: 500,
    });
    const [batch] = (await find('Rosa - Blue'))?.batches ?? [];
    await repos.productInventory.measure(batch?.batchId ?? '', 7_600);
    expect(await find('Rosa - Blue')).toMatchObject({
      availableCm: 7_600,
      awaitingMeasurementG: 0,
      batches: [{ receivedG: 20_000, status: 'measured', costPerMeterCents: 526 }],
    });
  });

  it('adds up several batches of a product, each its own', async () => {
    const product = await rosa('Rosa - Red');
    await seedBatch(repos, product, 5_000);
    await seedBatch(repos, product, 3_000);
    const view = await find('Rosa - Red');
    expect(view?.availableCm).toBe(8_000);
    expect(view?.batchCount).toBe(2);
    expect(view?.batches.map((batch) => batch.code)).toEqual(['B-A0001', 'B-A0002']);
  });

  it('flags a batch sold beyond its length and sets it off against the rest', async () => {
    const product = await rosa('Rosa - Red');
    const first = await seedBatch(repos, product, 1_000);
    await seedBatch(repos, product, 2_000);
    await repos.stock.act({
      type: 'adjustment',
      batchId: first,
      date: day,
      counted: 0,
      reason: 'count',
    });
    await repos.stock.act({ type: 'loss', batchId: first, date: day, quantity: 100, reason: 'x' });
    const view = await find('Rosa - Red');
    expect(view?.needsReview).toBe(true);
    expect(view?.batches.find((batch) => batch.batchId === first)).toMatchObject({
      remainingCm: -100,
      oversold: true,
    });
    // The ledger sets the short batch off against the rest, as the stock really is.
    expect(view?.availableCm).toBe(1_900);
  });

  it('has the same meters without the purchases, as on a cashier’s device', async () => {
    const product = await rosa('Rosa - Blue');
    const batchId = await seedBatch(repos, product, 8_000, { date: day });
    await db.purchases.clear();
    expect((await find('Rosa - Blue'))?.batches).toEqual([
      expect.objectContaining({ batchId, remainingCm: 8_000, purchaseDate: day }),
    ]);
  });

  it('finds products by name, code or tag', async () => {
    await rosa('Silk', { sku: 'SLK-1', tags: ['summer'] });
    expect(await names({ search: 'slk' })).toEqual(['Silk']);
    expect(await names({ search: 'silk' })).toEqual(['Silk']);
    expect(await names({ search: 'summer' })).toEqual(['Silk']);
    expect(await names({ search: 'nothing like this' })).toEqual([]);
  });

  it('reads a product record that has no price fields as having no price, not as undefined', async () => {
    const id = await rosa('Old record');
    const row = await db.products.get(id);
    if (!row) throw new Error('seeded product missing');
    // A record saved before prices existed has no such keys at all.
    const bare: Record<string, unknown> = { ...row };
    for (const key of [
      'pricePerMeterCents',
      'minPricePerMeterCents',
      'pricePerPieceCents',
      'minPricePerPieceCents',
    ]) {
      Reflect.deleteProperty(bare, key);
    }
    await db.products.put(bare as typeof row);
    expect(await find('Old record')).toMatchObject({
      pricePerMeterCents: null,
      minPricePerMeterCents: null,
      pricePerPieceCents: null,
      minPricePerPieceCents: null,
    });
  });

  it('lists a product without a purchase as out of stock', async () => {
    await rosa('Silk', { purchaseUnits: [] });
    expect(await find('Silk')).toMatchObject({
      availableCm: 0,
      awaitingMeasurementG: 0,
      status: 'out',
      lowStockThreshold: null,
      batchCount: 0,
      batches: [],
      needsReview: false,
    });
  });
});

describe('adding a product with its stock, restocking and measuring (ADR 0012)', () => {
  const form = (name: string) => ({
    name,
    purchaseUnits: [],
    sellingUnits: ['meter' as const],
    pricePerMeterCents: 300,
    minPricePerMeterCents: 200,
  });

  it('Rosa: 100 kg at 200 dh and 0.5 kg per meter makes the product and its stock together: 200 m at 1 dh', async () => {
    const { productId, purchaseId } = await repos.productInventory.addProduct(form('Rosa'), {
      unit: 'kg',
      quantity: 100_000,
      totalCostCents: 20_000,
      conversion: { weightG: 500, lengthCm: 100, source: 'measured' },
    });
    expect(purchaseId).toBeTypeOf('string');
    // The product can be bought in the unit the stock came in, without being told so.
    expect((await repos.products.get(productId))?.purchaseUnits).toEqual(['kg']);
    expect(await find('Rosa')).toMatchObject({
      availableCm: 20_000,
      status: 'in_stock',
      batches: [{ unit: 'kg', receivedG: 100_000, status: 'measured', costPerMeterCents: 100 }],
    });
    // One local transaction, two ops, in the order the server needs them.
    expect((await db.outbox.toArray()).map((op) => op.entity)).toEqual(['product', 'purchase']);
  });

  it('Rosa with the conversion unknown: the stock is recorded and awaits a measurement; no meters are made up', async () => {
    await repos.productInventory.addProduct(form('Rosa'), {
      unit: 'kg',
      quantity: 100_000,
      totalCostCents: 20_000,
    });
    expect(await find('Rosa')).toMatchObject({
      availableCm: 0,
      awaitingMeasurementG: 100_000,
      status: 'awaiting',
    });
    // Measured later at 190 m: now it can be sold, at 200 dh over 190 m.
    const [batch] = (await find('Rosa'))?.batches ?? [];
    await repos.productInventory.measure(batch?.batchId ?? '', 19_000);
    expect(await find('Rosa')).toMatchObject({
      availableCm: 19_000,
      awaitingMeasurementG: 0,
      status: 'in_stock',
      batches: [{ status: 'measured', costPerMeterCents: 105 }],
    });
  });

  it('a product without stock is just a product, out of stock', async () => {
    const { purchaseId } = await repos.productInventory.addProduct(form('Silk'));
    expect(purchaseId).toBeNull();
    expect(await find('Silk')).toMatchObject({ status: 'out', batchCount: 0 });
    expect(await db.purchases.count()).toBe(0);
  });

  it('is all or nothing: stock that is refused leaves no product behind', async () => {
    await expect(
      repos.productInventory.addProduct(form('Rosa'), {
        unit: 'meter',
        quantity: 0,
        totalCostCents: 100,
      }),
    ).rejects.toThrow();
    expect(await db.products.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('restocking adds a batch with its own quantity, cost and conversion; the earlier one is untouched', async () => {
    const { productId } = await repos.productInventory.addProduct(form('Rosa'), {
      unit: 'meter',
      quantity: 5_000,
      totalCostCents: 80_000,
    });
    await repos.productInventory.restock(productId, {
      unit: 'kg',
      quantity: 10_000,
      totalCostCents: 30_000,
      conversion: { weightG: 1000, lengthCm: 400, source: 'estimated' },
    });
    const view = await find('Rosa');
    expect(await db.products.count()).toBe(1);
    expect(view?.batchCount).toBe(2);
    expect(view?.availableCm).toBe(5_000 + 4_000);
    expect(view?.batches.map((batch) => [batch.code, batch.unit, batch.costTotalCents])).toEqual([
      ['B-A0001', 'meter', 80_000],
      ['B-A0002', 'kg', 30_000],
    ]);
  });

  it('measuring a weight batch moves the product’s usual weight to length: the first replaces the guess, then the average (SPEC §2.3, C11)', async () => {
    const { productId } = await repos.productInventory.addProduct(form('Silk'), {
      unit: 'kg',
      quantity: 20_000,
      totalCostCents: 8000,
    });
    const usual = async () => (await repos.products.get(productId))?.kgToMeterConversion;
    expect(await usual()).toBeNull();

    // Measured at 76 m for 20 kg: 380 cm a kilo is the product's now.
    const first = (await find('Silk'))?.batches[0]?.batchId ?? '';
    await repos.productInventory.measure(first, 7600);
    expect(await usual()).toEqual({ weightG: 1000, lengthCm: 380, source: 'measured' });

    // A second batch bought at an estimate, measured at 82 m (410 cm a kilo): the average, 395.
    await repos.productInventory.restock(productId, {
      unit: 'kg',
      quantity: 20_000,
      totalCostCents: 8000,
      conversion: { weightG: 1000, lengthCm: 400, source: 'estimated' },
    });
    const second = (await find('Silk'))?.batches.find((batch) => batch.batchId !== first);
    await repos.productInventory.measure(second?.batchId ?? '', 8200);
    expect(await usual()).toEqual({ weightG: 1000, lengthCm: 395, source: 'measured' });
  });

  it('a batch bought with a measured weight to length is not a guess: measuring it leaves the product’s alone', async () => {
    const { productId } = await repos.productInventory.addProduct(form('Silk'), {
      unit: 'kg',
      quantity: 20_000,
      totalCostCents: 8000,
      conversion: { weightG: 1000, lengthCm: 400, source: 'measured' },
    });
    const batch = (await find('Silk'))?.batches[0]?.batchId ?? '';
    await repos.productInventory.measure(batch, 7600);
    expect((await repos.products.get(productId))?.kgToMeterConversion).toBeNull();
  });
});

describe('status, filters and totals', () => {
  beforeEach(async () => {
    const full = await rosa('Full');
    await seedBatch(repos, full, 5_000);
    const low = await rosa('Low', { lowStockThreshold: 800 });
    await seedBatch(repos, low, 500);
    await rosa('Out');
    const waiting = await rosa('Waiting');
    await repos.purchases.create({
      date: day,
      productId: waiting,
      unit: 'kg',
      quantity: 50_000,
      totalCostCents: 10_000,
    });
  });

  it('gives each product its status, reading the product’s low-stock threshold', async () => {
    const statuses = (await overview()).products.map((product) => [product.name, product.status]);
    expect(statuses).toEqual([
      ['Full', 'in_stock'],
      ['Low', 'low'],
      ['Out', 'out'],
      ['Waiting', 'awaiting'],
    ]);
  });

  it('filters on the real stock: in stock includes low, awaiting is only weight with no length', async () => {
    expect(await names({ filter: 'in_stock' })).toEqual(['Full', 'Low']);
    expect(await names({ filter: 'low' })).toEqual(['Low']);
    expect(await names({ filter: 'out' })).toEqual(['Out']);
    expect(await names({ filter: 'awaiting' })).toEqual(['Waiting']);
  });

  it('totals every product, whatever the search and the filter', async () => {
    expect((await overview({ search: 'full', filter: 'out' })).summary).toEqual({
      products: 4,
      availableCm: 5_500,
      availablePieces: 0,
      // 50 m at 16 a metre, 5 m at 16, and the 10,000 cents of the weight still waiting for a length.
      stockValueCents: 98_000,
      awaiting: 1,
      low: 1,
      out: 1,
    });
  });

  it('an empty shop has empty totals', async () => {
    await db.delete();
    db = new ShopDatabase(`test-${crypto.randomUUID()}`);
    repos = createRepositories(new LocalStore(db));
    expect((await overview()).summary).toEqual({
      products: 0,
      availableCm: 0,
      availablePieces: 0,
      stockValueCents: 0,
      awaiting: 0,
      low: 0,
      out: 0,
    });
  });
});

describe('a product with its batches and movements', () => {
  it('lists every movement newest first, with what the purchase cost and what a loss carried', async () => {
    const product = await rosa('Rosa');
    const batchId = await seedBatch(repos, product, 5_000, { date: '2026-10-01' });
    await repos.stock.act({ type: 'loss', batchId, date: day, quantity: 30, reason: 'x' });
    const detail = await repos.productInventory.detail(product);
    expect(
      detail?.movements.map((move) => [move.type, move.unit, move.amount, move.costCents]),
    ).toEqual([
      ['loss', 'meter', -30, 480],
      ['purchase', 'meter', 5_000, 80_000],
    ]);
    expect(detail?.movements[0]).toMatchObject({ batchId, code: 'B-A0001' });
    expect(detail?.record.name).toBe('Rosa');
  });

  it('shows the weight bought, and a measurement as the length measured', async () => {
    const { productId } = await repos.productInventory.addProduct(
      {
        name: 'Rosa',
        purchaseUnits: [],
        sellingUnits: ['meter'],
        pricePerMeterCents: 300,
        minPricePerMeterCents: 200,
      },
      { unit: 'kg', quantity: 100_000, totalCostCents: 20_000 },
    );
    const [batch] = (await repos.productInventory.detail(productId))?.stock.batches ?? [];
    await repos.productInventory.measure(batch?.batchId ?? '', 19_000);
    const detail = await repos.productInventory.detail(productId);
    expect(detail?.movements.map((move) => [move.type, move.unit, move.amount])).toEqual([
      ['measurement', 'meter', 19_000],
      ['purchase', 'kg', 100_000],
    ]);
  });

  it('is not found when the product is not on this device or has been voided', async () => {
    const product = await rosa('Rosa');
    expect(await repos.productInventory.detail(crypto.randomUUID())).toBeNull();
    await repos.products.void(product, 'test');
    expect(await repos.productInventory.detail(product)).toBeNull();
    expect(await find('Rosa')).toBeUndefined();
  });
});

describe('where a product’s movements came from', () => {
  it('names the purchase and its supplier, the sale (also once voided) and the reason of a loss', async () => {
    const product = await rosa('Traced');
    const supplierId = await repos.suppliers.save({ name: 'Atlas' });
    const purchaseId = await repos.purchases.create({
      date: day,
      productId: product,
      unit: 'meter',
      quantity: 5000,
      totalCostCents: 80_000,
      supplierId,
      paidCents: 80_000,
    });
    const [batch] = await repos.purchases.batchesOf(purchaseId);
    if (!batch) throw new Error('a purchase makes a batch');
    const saleId = await repos.sales.create({
      date: day,
      lines: [
        {
          batchId: batch.id,
          unit: 'meter',
          quantity: 100,
          price: { perUnitCents: 1800 },
          refPriceCents: 2000,
          minPriceCents: 1700,
        },
      ],
      paidCents: 1800,
    });
    await repos.stock.act({
      type: 'loss',
      batchId: batch.id,
      date: day,
      quantity: 50,
      reason: 'moth',
    });

    const detail = await repos.productInventory.detail(product);
    expect(detail?.supplierOfPurchase).toEqual({ [purchaseId]: 'Atlas' });
    const reference = (type: string) =>
      detail?.movements.find((move) => move.type === type)?.reference;
    expect(reference('purchase')).toEqual({ kind: 'purchase', id: purchaseId });
    expect(reference('sale')).toEqual({ kind: 'sale', id: saleId });
    const loss = detail?.movements.find((move) => move.type === 'loss');
    expect(loss).toMatchObject({ reference: null, note: 'moth' });

    // Voiding the sale puts the cloth back with a move of its own, which still names the sale.
    await repos.sales.voidSale(saleId, 'entered twice');
    const after = await repos.productInventory.detail(product);
    expect(after?.movements.find((move) => move.type === 'reversal')?.reference).toEqual({
      kind: 'sale',
      id: saleId,
    });
  });

  it('a purchase with no supplier has none to name, and a movement with no source has no reference', async () => {
    const product = await rosa('Plain');
    await seedBatch(repos, product, 3000, { date: day });
    const detail = await repos.productInventory.detail(product);
    expect(detail?.supplierOfPurchase).toEqual({});
    expect(detail?.movements.map((move) => move.reference?.kind)).toEqual(['purchase']);
  });
});

describe('removing a product from the inventory (PB20)', () => {
  const pending = async (entity: string, kind: string) =>
    (await db.outbox.toArray()).filter((entry) => entry.entity === entity && entry.kind === kind);

  it('a product with no batch is cancelled with its reason, queued to sync, and never deleted', async () => {
    const product = await rosa('Lace');
    expect(await repos.productInventory.removal(product)).toEqual({
      holdsStock: false,
      batches: 0,
    });

    await repos.productInventory.remove(product, 'added by mistake');

    expect(await find('Lace')).toBeUndefined();
    expect(await repos.productInventory.removal(product)).toBeNull();
    // The record is still on the device, marked cancelled, and the cancellation is queued.
    expect((await db.products.get(product))?.voidedAt).not.toBeNull();
    expect(await pending('product', 'void')).toEqual([
      expect.objectContaining({ entityId: product, payload: { reason: 'added by mistake' } }),
    ]);
  });

  it('a product that still holds stock cannot be removed, and nothing is queued', async () => {
    const product = await rosa('Held');
    await seedBatch(repos, product, 5000, { date: day });

    expect(await repos.productInventory.removal(product)).toEqual({
      holdsStock: true,
      batches: 1,
    });
    const refused = await repos.productInventory
      .remove(product, 'x')
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ValidationError);
    expect((refused as ValidationError).issues[0]?.message).toBe('product_holds_stock');
    expect((await db.products.get(product))?.voidedAt).toBeNull();
    expect(await pending('product', 'void')).toHaveLength(0);
    expect(await find('Held')).toBeDefined();
  });

  it('a weight waiting for its length still counts as stock', async () => {
    const product = await rosa('Waiting');
    await repos.purchases.create({
      date: day,
      productId: product,
      unit: 'kg',
      quantity: 5000,
      totalCostCents: 9000,
    });
    expect((await repos.productInventory.removal(product))?.holdsStock).toBe(true);
  });

  it('once everything is lost the product can go, and its batches, moves and cost stay', async () => {
    const product = await rosa('Gone');
    const batchId = await seedBatch(repos, product, 5000, { date: day });
    await repos.stock.act({ type: 'loss', batchId, date: day, quantity: 5000, reason: 'x' });
    expect(await repos.productInventory.removal(product)).toEqual({
      holdsStock: false,
      batches: 1,
    });

    const batchesBefore = await db.productBatches.toArray();
    const movesBefore = await db.productStockMoves.toArray();
    await repos.productInventory.remove(product, 'discontinued');

    expect(await find('Gone')).toBeUndefined();
    // Nothing about its history changed: same batches, same moves, same cost.
    expect(await db.productBatches.toArray()).toEqual(batchesBefore);
    expect(await db.productStockMoves.toArray()).toEqual(movesBefore);
    expect(batchesBefore[0]?.costTotalCents).toBe(80_000);
    expect((await overview()).summary.stockValueCents).toBe(0);
  });

  it('removing a product another product does not depend on leaves the others untouched', async () => {
    const gone = await rosa('Gone');
    const kept = await rosa('Kept');
    await seedBatch(repos, kept, 3000, { date: day });
    await repos.productInventory.remove(gone, 'x');
    expect(await names()).toEqual(['Kept']);
    expect((await find('Kept'))?.availableCm).toBe(3000);
  });

  it('is refused for a product that is not on this device', async () => {
    await expect(repos.productInventory.remove(crypto.randomUUID(), 'x')).rejects.toThrow(
      /No product/,
    );
  });

  it('works as the first change after the app is reopened, before the device id is read', async () => {
    const product = await rosa('Reopened');
    // A new page load: the same database, a store that has not asked for the device id yet.
    const reopened = createRepositories(
      new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 12, 0))),
    );
    await reopened.productInventory.remove(product, 'x');
    expect((await db.products.get(product))?.voidedAt).not.toBeNull();
    expect(await pending('product', 'void')).toHaveLength(1);
  });

  it('asking again for one already removed finds nothing to remove', async () => {
    const product = await rosa('Twice');
    await repos.productInventory.remove(product, 'x');
    await expect(repos.productInventory.remove(product, 'x')).rejects.toThrow(/No product/);
    expect(await pending('product', 'void')).toHaveLength(1);
  });
});

describe('status rules', () => {
  const stockOf = (availableCm: number, awaitingMeasurementG = 0, availablePieces = 0) => ({
    availableCm,
    availablePieces,
    awaitingMeasurementG,
  });

  it('weight waiting for a length is not out of stock', () => {
    expect(stockStatusOf(stockOf(0), NO_LOW)).toBe('out');
    expect(stockStatusOf(stockOf(0, 100_000), NO_LOW)).toBe('awaiting');
    expect(stockStatusOf(stockOf(-300, 100_000), lowAt(500))).toBe('awaiting');
    expect(stockStatusOf(stockOf(-300), lowAt(500))).toBe('out');
  });

  it('is low at or under the threshold, and never without one', () => {
    expect(stockStatusOf(stockOf(500), lowAt(500))).toBe('low');
    expect(stockStatusOf(stockOf(501), lowAt(500))).toBe('in_stock');
    expect(stockStatusOf(stockOf(50), NO_LOW)).toBe('in_stock');
    // Stock that also waits for a length keeps its own status.
    expect(stockStatusOf(stockOf(5_000, 100_000), lowAt(500))).toBe('in_stock');
    expect(stockStatusOf(stockOf(100, 100_000), lowAt(500))).toBe('low');
  });

  it('pieces in stock are in stock', () => {
    expect(stockStatusOf(stockOf(0, 0, 3), lowAt(500))).toBe('in_stock');
    expect(stockStatusOf(stockOf(0, 100_000, 3), NO_LOW)).toBe('in_stock');
  });

  it('filters: in stock includes low; awaiting is any product with weight waiting', () => {
    const view = (status: ProductStockView['status'], awaitingMeasurementG = 0) => ({
      status,
      awaitingMeasurementG,
    });
    expect(matchesStockFilter(view('low'), 'in_stock')).toBe(true);
    expect(matchesStockFilter(view('awaiting', 5), 'in_stock')).toBe(false);
    expect(matchesStockFilter(view('awaiting', 5), 'out')).toBe(false);
    expect(matchesStockFilter(view('out'), 'out')).toBe(true);
    expect(matchesStockFilter(view('in_stock', 5), 'awaiting')).toBe(true);
    expect(matchesStockFilter(view('out'), 'awaiting')).toBe(false);
    expect(matchesStockFilter(view('out'), 'all')).toBe(true);
  });

  it('totals count a short product as nothing and a product waiting for a length once', () => {
    const view = (
      status: ProductStockView['status'],
      availableCm: number,
      awaitingMeasurementG = 0,
      availablePieces = 0,
      stockValueCents = 0,
    ) =>
      ({
        status,
        availableCm,
        availablePieces,
        awaitingMeasurementG,
        stockValueCents,
      }) as ProductStockView;
    expect(
      summarizeInventory([
        view('in_stock', 1_000, 0, 0, 16_000),
        view('low', 300, 20_000, 0, 4_800),
        view('out', -250),
        view('awaiting', 0, 50_000, 0, 10_000),
        view('in_stock', 0, 0, 4, 2_000),
      ]),
    ).toEqual({
      products: 5,
      availableCm: 1_300,
      availablePieces: 4,
      stockValueCents: 32_800,
      awaiting: 2,
      low: 1,
      out: 1,
    });
  });
});

const batchOf = (
  id: string,
  received: ProductStockBatch['received'],
  options: Partial<ProductStockBatch> = {},
): ProductBatchSource => {
  const batch: ProductStockBatch = {
    id,
    productId: 'rosa',
    purchaseDate: '2026-10-01',
    createdAt: '2026-10-01T09:00:00.000Z',
    purchaseUnit: received.unit,
    received,
    costTotalCents: 20_000,
    initialConversion: null,
    ...options,
  };
  const receipt: ProductStockMovement = {
    id: `${id}-receipt`,
    batchId: id,
    type: 'purchase',
    date: '2026-10-01',
    createdAt: '2026-10-01T09:00:00.000Z',
    delta: received,
  };
  return {
    batchId: id,
    code: id.toUpperCase(),
    purchaseId: `purchase-${id}`,
    remnant: false,
    unit: received.unit,
    receivedQuantity:
      received.unit === 'kg'
        ? received.grams
        : received.unit === 'meter'
          ? received.centimeters
          : received.pieces,
    conversion: null,
    history: { batch, movements: [receipt] },
  };
};

describe('summarizing a product’s stock', () => {
  const identity: ProductIdentity = {
    id: 'rosa',
    name: 'Rosa',
    sku: null,
    tags: [],
    sellingUnits: ['meter'],
    lowStockThreshold: null,
    lowStockUnit: 'meter',
    pricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
    pricePerPieceCents: null,
    minPricePerPieceCents: null,
    description: null,
  };

  it('keeps weight with no known length aside: nothing to sell by the metre, nothing lost', () => {
    const view = summarizeProductStock(identity, [
      batchOf('pending', { unit: 'kg', grams: 100_000 }),
      batchOf('known', { unit: 'meter', centimeters: 1_000 }),
    ]);
    expect(view).toMatchObject({
      availableCm: 1_000,
      awaitingMeasurementG: 100_000,
      status: 'in_stock',
      batchCount: 2,
      needsReview: false,
      // Both batches cost 20,000 cents: the weight counts in the value, and not in the average.
      stockValueCents: 40_000,
      averageCostPerMeterCents: 2_000,
      averageCostPerPieceCents: null,
    });
    expect(view.batches.find((batch) => batch.batchId === 'pending')).toEqual({
      batchId: 'pending',
      code: 'PENDING',
      remnant: false,
      unit: 'kg',
      purchaseId: 'purchase-pending',
      purchaseDate: '2026-10-01',
      remainingCm: 0,
      remainingPieces: 0,
      receivedG: 100_000,
      receivedQuantity: 100_000,
      conversion: null,
      status: 'pending',
      awaitingG: 100_000,
      costTotalCents: 20_000,
      costPerMeterCents: null,
      costPerPieceCents: null,
      remainingCostCents: 20_000,
      oversold: false,
    });
  });

  it('values stock batch by batch and averages by what is left, never by the product’s latest cost', () => {
    const view = summarizeProductStock(identity, [
      batchOf('cheap', { unit: 'meter', centimeters: 3_000 }, { costTotalCents: 3_000 }),
      batchOf('dear', { unit: 'meter', centimeters: 1_000 }, { costTotalCents: 3_000 }),
    ]);
    expect(view).toMatchObject({
      stockValueCents: 6_000,
      // 6,000 cents over 40 m, not the newest batch's 300 a metre.
      averageCostPerMeterCents: 150,
      averageCostPerPieceCents: null,
    });
    expect(
      view.batches.map((batch) => [batch.code, batch.costTotalCents, batch.remainingCostCents]),
    ).toEqual([
      ['CHEAP', 3_000, 3_000],
      ['DEAR', 3_000, 3_000],
    ]);
  });

  it('a product with only weight waiting for a length is awaiting, not out of stock', () => {
    const view = summarizeProductStock(identity, [
      batchOf('pending', { unit: 'kg', grams: 100_000 }),
    ]);
    expect(view).toMatchObject({
      availableCm: 0,
      awaitingMeasurementG: 100_000,
      status: 'awaiting',
      batchCount: 1,
    });
    expect(matchesStockFilter(view, 'out')).toBe(false);
    expect(matchesStockFilter(view, 'awaiting')).toBe(true);
  });

  it('sells the Rosa example: 100 kg at 200 dh and 0.5 kg per metre is 200 m at 1 dh', () => {
    const view = summarizeProductStock(identity, [
      batchOf(
        'rosa-kg',
        { unit: 'kg', grams: 100_000 },
        { initialConversion: { weightG: 500, lengthCm: 100, source: 'measured' } },
      ),
    ]);
    expect(view.availableCm).toBe(20_000);
    expect(view.batches[0]).toMatchObject({ status: 'measured', costPerMeterCents: 100 });
  });

  it('lists a batch the ledger refuses and keeps it out of the stock', () => {
    const broken = batchOf('broken', { unit: 'meter', centimeters: 500 });
    if (broken.history) broken.history.movements = [];
    const view = summarizeProductStock(identity, [
      batchOf('fine', { unit: 'meter', centimeters: 1_000 }),
      broken,
      {
        ...batchOf('unmapped', { unit: 'meter', centimeters: 1 }),
        history: null,
      },
    ]);
    expect(view.availableCm).toBe(1_000);
    expect(view.needsReview).toBe(true);
    expect(view.unreadable).toEqual([
      { batchId: 'broken', code: 'BROKEN' },
      { batchId: 'unmapped', code: 'UNMAPPED' },
    ]);
  });

  it('puts batches with stock first, oldest purchase first, and emptied ones last', () => {
    const emptied = batchOf(
      'emptied',
      { unit: 'meter', centimeters: 100 },
      { purchaseDate: '2026-09-01' },
    );
    emptied.history?.movements.push({
      id: 'emptied-sale',
      batchId: 'emptied',
      type: 'sale',
      date: '2026-10-02',
      createdAt: '2026-10-02T09:00:00.000Z',
      delta: { unit: 'meter', centimeters: -100 },
    });
    const view = summarizeProductStock(identity, [
      emptied,
      batchOf('newer', { unit: 'meter', centimeters: 100 }, { purchaseDate: '2026-10-05' }),
      batchOf('older', { unit: 'meter', centimeters: 100 }, { purchaseDate: '2026-10-02' }),
      batchOf('piece-batch', { unit: 'piece', pieces: 3 }, { purchaseDate: '2026-10-03' }),
    ]);
    expect(view.batches.map((batch) => batch.batchId)).toEqual([
      'older',
      'piece-batch',
      'newer',
      'emptied',
    ]);
    expect(view.availablePieces).toBe(3);
    expect(view.availableCm).toBe(200);
    expect(view.batchCount).toBe(3);
  });

  it('lists the movements of the readable batches, newest first, and skips the others', () => {
    const sources = [
      batchOf('pending', { unit: 'kg', grams: 100_000 }),
      {
        ...batchOf('unmapped', { unit: 'meter', centimeters: 1 }),
        history: null,
      },
    ];
    expect(productMovements(sources)).toEqual([
      expect.objectContaining({
        batchId: 'pending',
        type: 'purchase',
        unit: 'kg',
        amount: 100_000,
        // What the purchase cost, even before the weight has a length.
        costCents: 20_000,
      }),
    ]);
  });
});
