import 'fake-indexeddb/auto';
import {
  batchLedgerOf,
  type Roll,
  rollLedgerOf,
  type SequencedMove,
  type StockMove,
} from '@fabric/contracts';
import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { createRepositories } from './repositories';
import { LocalStore } from './store';

/**
 * The device database as it was before ADR 0012 (versions 1 to 13, never edited), so the upgrade
 * is tried on what real devices hold.
 */
class DatabaseV13 extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      fabrics: 'id, name',
      variants: 'id, fabricId',
      suppliers: 'id, name',
      settings: 'id, key',
      outbox: '++seq, opId, entityId, state',
      meta: 'key',
    });
    this.version(2).stores({
      purchases: 'id, date',
      rolls: 'id, variantId, purchaseId, shortCode',
      stockMoves: 'id, rollId',
    });
    this.version(3).stores({
      stockMoves: 'id, rollId, refId',
      customers: 'id, name',
      sales: 'id, date, customerId',
      saleLines: 'id, saleId, rollId',
      payments: 'id, customerId',
      paymentAllocations: 'id, saleId, paymentId',
      saleVoids: 'id, saleId',
    });
    this.version(4).stores({ writeOffs: 'id, saleId' });
    this.version(5).stores({ syncConflicts: 'id, entityId' });
    this.version(6).stores({
      expenses: 'id, date, paidDate, recurringExpenseId',
      recurringExpenses: 'id',
    });
    this.version(7).stores({
      partners: 'id',
      capitalMoves: 'id, partnerId',
      partnerDraws: 'id, partnerId',
    });
    this.version(8).stores({
      profitSplitRules: 'id',
      settlements: 'id, periodEnd',
      settlementShares: 'id, settlementId, partnerId',
      lockedCosts: 'id, stockMoveId, settlementId',
    });
    this.version(9).stores({ cashAdjustments: 'id, date' });
    this.version(10).stores({ zakatReports: 'id, hawlDate' });
    this.version(11).stores({ saleReturns: 'id, saleId', supplierPayments: 'id, supplierId' });
    this.version(12).stores({ photos: 'id, variantId' });
    this.version(13).stores({ products: 'id, name, sku, active' });
  }
}

/**
 * The device database as it stood at version 15, just before employees (ADR 0022). Versions 14 and
 * 15 are declared without their upgrade: these tests carry over nothing but what version 16 touches.
 */
class DatabaseV15 extends DatabaseV13 {
  constructor(name: string) {
    super(name);
    this.version(14).stores({
      productBatches: 'id, productId, purchaseId, code',
      productStockMoves: 'id, batchId, refId',
      saleLines: 'id, saleId, batchId',
      photos: 'id, variantId, productId',
    });
    this.version(15).stores({
      sales: 'id, date, customerId, createdAt',
      payments: 'id, customerId, createdAt',
      purchases: 'id, date, createdAt',
      supplierPayments: 'id, supplierId, createdAt',
      expenses: 'id, date, paidDate, recurringExpenseId, createdAt',
      productStockMoves: 'id, batchId, refId, [type+createdAt]',
      saleReturns: 'id, saleId, date',
    });
  }
}

/** The device database at version 16 (employees), just before products named their suppliers. */
class DatabaseV16 extends DatabaseV15 {
  constructor(name: string) {
    super(name);
    this.version(16).stores({
      employees: 'id, name',
      employeeSalaries: 'id, employeeId, effectiveFrom',
      expenses: 'id, date, paidDate, recurringExpenseId, createdAt, employeeId',
    });
  }
}

const base = (n: number) => ({
  createdAt: `2026-10-0${String(n)}T09:00:00.000Z`,
  updatedAt: `2026-10-0${String(n)}T09:00:00.000Z`,
  deviceId: 'desk',
  voidedAt: null,
});
const id = () => crypto.randomUUID();

let name: string;
beforeEach(() => {
  name = `test-${crypto.randomUUID()}`;
});
afterEach(async () => {
  await Dexie.delete(name);
});

/** What a device that sold, lost, measured and queued ops on rolls holds. */
async function seedLegacy() {
  const old = new DatabaseV13(name);
  const productId = id(); // the Product that reuses the colour's id
  const meterPurchase = {
    ...base(1),
    id: id(),
    supplierId: null,
    date: '2026-10-01',
    method: 'meter',
    pricePerMeterCents: 1600,
    weightG: null,
    estCmPerKg: null,
    totalCostCents: 80_000,
    paidCents: 80_000,
    notes: null,
    serverSeq: 10,
  };
  const kgPurchase = {
    ...meterPurchase,
    id: id(),
    method: 'kg',
    pricePerMeterCents: null,
    weightG: 20_000,
    estCmPerKg: 400,
    totalCostCents: 40_000,
    paidCents: 40_000,
    serverSeq: 11,
  };
  const roll = (
    purchase: { id: string },
    shortCode: string,
    lengthCm: number,
    cost: number,
    estimated: boolean,
    serverSeq: number | null,
  ): Roll & { serverSeq: number | null } => ({
    ...base(1),
    id: id(),
    shortCode,
    variantId: productId,
    purchaseId: purchase.id,
    lengthCmInitial: lengthCm,
    costTotalCents: cost,
    lengthEstimated: estimated,
    status: 'active',
    serverSeq,
  });
  const metre = roll(meterPurchase, 'R-A0001', 5000, 80_000, false, 20);
  const kg = roll(kgPurchase, 'R-A0002', 8000, 40_000, true, 21);
  let seq = 30;
  const move = (
    r: Roll,
    type: StockMove['type'],
    deltaCm: number,
    refId: string | null,
    serverSeq: number | null = ++seq,
  ): StockMove & { serverSeq: number | null } => ({
    ...base(2),
    id: id(),
    rollId: r.id,
    type,
    deltaCm,
    refId,
    date: '2026-10-02',
    note: type === 'loss' || type === 'adjustment' ? 'reason' : null,
    serverSeq,
  });
  const saleId = id();
  const lineId = id();
  const kgLineId = id();
  const moves = [
    move(metre, 'purchase', 5000, meterPurchase.id),
    move(metre, 'sale', -275, lineId),
    move(metre, 'loss', -30, null),
    move(kg, 'purchase', 8000, kgPurchase.id),
    move(kg, 'sale', -1000, kgLineId),
    move(kg, 'length_correction', -400, null),
  ];
  const line = (rollId: string, lineIdValue: string, soldCm: number) => ({
    ...base(2),
    id: lineIdValue,
    saleId,
    rollId,
    soldCm,
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
    actualPricePerMeterCents: 1800,
    wholePiece: false,
    lineTotalCents: Math.round((1800 * soldCm) / 100),
    serverSeq: 40,
  });
  const lines = [line(metre.id, lineId, 275), line(kg.id, kgLineId, 1000)];

  await old.table('purchases').bulkPut([meterPurchase, kgPurchase]);
  await old.table('rolls').bulkPut([metre, kg]);
  await old.table('stockMoves').bulkPut(moves);
  await old.table('saleLines').bulkPut(lines);
  await old.table('sales').put({
    ...base(2),
    id: saleId,
    date: '2026-10-02',
    customerId: null,
    totalCents: lines.reduce((total, l) => total + l.lineTotalCents, 0),
    discountCents: 0,
    dueDate: null,
    confirmedBelowCost: false,
    note: null,
    serverSeq: 41,
  });
  await old.table('photos').put({
    ...base(1),
    id: id(),
    variantId: productId,
    contentType: 'image/jpeg',
    width: 10,
    height: 10,
    byteLength: 4,
    data: '/9j/AAA=',
    serverSeq: 5,
  });

  // A loss waiting to be pushed, a sale waiting to be pushed, a remnant mark, a purchase of a new
  // roll, an edit of a fabric, and a customer.
  const pendingLoss = move(metre, 'loss', -10, null, null);
  await old.table('stockMoves').put(pendingLoss);
  const pendingRoll = roll(meterPurchase, 'R-A0003', 300, 4800, false, null);
  const pendingPurchase = { ...meterPurchase, id: id(), totalCostCents: 4800, serverSeq: null };
  pendingRoll.purchaseId = pendingPurchase.id;
  const pendingReceipt = move(pendingRoll, 'purchase', 300, pendingPurchase.id, null);
  await old.table('purchases').put(pendingPurchase);
  await old.table('rolls').put(pendingRoll);
  await old.table('stockMoves').put(pendingReceipt);
  const pendingSaleId = id();
  const pendingLineId = id();
  const pendingSaleMove = move(pendingRoll, 'sale', -100, pendingLineId, null);
  await old.table('stockMoves').put(pendingSaleMove);
  const op = (entity: string, entityId: string, kind: string, payload: unknown) => ({
    opId: id(),
    entity,
    entityId,
    kind,
    payload,
    deviceId: 'desk',
    clientTs: '2026-10-03T09:00:00.000Z',
    baseServerSeq: null,
    state: 'pending',
    error: null,
  });
  await old.table('outbox').bulkAdd([
    op('stock_move', pendingLoss.id, 'append', pendingLoss),
    op('roll', metre.id, 'upsert', { ...metre, status: 'remnant' }),
    op('purchase', pendingPurchase.id, 'append', {
      purchase: pendingPurchase,
      rolls: [pendingRoll],
      moves: [pendingReceipt],
    }),
    op('sale', pendingSaleId, 'append', {
      sale: {
        ...base(3),
        id: pendingSaleId,
        date: '2026-10-03',
        customerId: null,
        totalCents: 1800,
        discountCents: 0,
        dueDate: null,
        confirmedBelowCost: false,
        note: null,
      },
      lines: [{ ...line(pendingRoll.id, pendingLineId, 100), serverSeq: undefined }],
      moves: [pendingSaleMove],
      payment: null,
      allocation: null,
    }),
    op('fabric', id(), 'upsert', { name: 'روزا' }),
    op('customer', id(), 'upsert', { name: 'فاطمة' }),
  ]);
  old.close();
  return {
    metre,
    kg,
    moves,
    lines,
    pendingRoll,
    pendingPurchase,
    pendingLoss,
    pendingSaleId,
    saleId,
    productId,
  };
}

describe('the device upgrade to product batches (ADR 0012, Dexie v14)', () => {
  it('carries rolls, moves, sale lines and pictures over in place; the books come out the same', async () => {
    const seeded = await seedLegacy();
    const db = new ShopDatabase(name);
    await db.open();

    // A batch per roll with the roll's id, and every move kept with its id and place in order.
    const batches = await db.productBatches.toArray();
    expect(batches.map((batch) => batch.id).sort()).toEqual(
      [seeded.metre.id, seeded.kg.id, seeded.pendingRoll.id].sort(),
    );
    expect(batches.find((batch) => batch.id === seeded.kg.id)).toMatchObject({
      unit: 'kg',
      receivedQuantity: 20_000,
      conversion: { weightG: 20_000, lengthCm: 8000, source: 'estimated' },
      productId: seeded.productId,
      serverSeq: 21,
    });
    const moves = await db.productStockMoves.toArray();
    for (const legacy of await db.stockMoves.toArray()) {
      expect(moves.find((move) => move.id === legacy.id)).toMatchObject({
        batchId: legacy.rollId,
        serverSeq: legacy.serverSeq,
      });
    }

    // The same stock and costs as the roll ledger said: parity, roll by roll.
    for (const roll of [seeded.metre, seeded.kg]) {
      const legacyMoves: SequencedMove[] = await db.stockMoves
        .where('rollId')
        .equals(roll.id)
        .toArray();
      const legacy = rollLedgerOf(roll, legacyMoves);
      const batch = batches.find((entry) => entry.id === roll.id);
      if (!batch) throw new Error('a batch');
      const ledger = batchLedgerOf(
        batch,
        moves.filter((move) => move.batchId === roll.id),
      );
      const meters = ledger.available.meter;
      expect(meters?.unit === 'meter' ? meters.centimeters : undefined).toBe(legacy.remainingCm);
      expect(ledger.unallocatedCostCents).toBe(legacy.unallocatedCostCents);
    }

    // Sale lines are on batches now, with the same facts, and the new index works.
    const lines = await db.saleLines.where('batchId').equals(seeded.metre.id).toArray();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      batchId: seeded.metre.id,
      unit: 'meter',
      quantity: 275,
      refPriceCents: 2000,
      minPriceCents: 1700,
      actualPriceCents: 1800,
      minOverrideBy: null,
      serverSeq: 40,
    });
    expect('rollId' in (lines[0] ?? {})).toBe(false);

    // The picture of a colour is the picture of the product that reuses its id.
    expect(await db.photos.where('productId').equals(seeded.productId).toArray()).toHaveLength(1);

    // The old tables keep the history.
    expect(await db.rolls.count()).toBe(3);
    db.close();
  });

  it('rewrites the ops still waiting to be pushed to the shapes the server takes now', async () => {
    const seeded = await seedLegacy();
    const db = new ShopDatabase(name);
    await db.open();
    const ops = await db.outbox.orderBy('seq').toArray();
    expect(ops.map((entry) => [entry.entity, entry.state])).toEqual([
      ['product_stock_move', 'pending'],
      ['product_batch', 'pending'],
      ['purchase', 'pending'],
      ['sale', 'pending'],
      ['fabric', 'rejected'],
      ['customer', 'pending'],
    ]);
    const [loss, remnant, purchase, sale, fabric] = ops;
    expect(loss?.payload).toMatchObject({
      id: seeded.pendingLoss.id,
      batchId: seeded.metre.id,
      type: 'loss',
      unit: 'meter',
      delta: -10,
    });
    expect('serverSeq' in (loss?.payload as object)).toBe(false);
    expect(remnant).toMatchObject({ entityId: seeded.metre.id });
    expect(remnant?.payload).toMatchObject({
      id: seeded.metre.id,
      status: 'remnant',
      code: 'R-A0001',
    });
    const bought = purchase?.payload as {
      rolls?: unknown;
      batches: { id: string }[];
      moves: { type: string; unit: string; delta: number }[];
    };
    expect(bought.rolls).toBeUndefined();
    expect(bought.batches.map((batch) => batch.id)).toEqual([seeded.pendingRoll.id]);
    expect(bought.moves).toEqual([
      expect.objectContaining({ type: 'purchase', unit: 'meter', delta: 300 }),
    ]);
    const sold = sale?.payload as { lines: object[]; moves: object[] };
    expect(sold.lines[0]).toMatchObject({
      batchId: seeded.pendingRoll.id,
      unit: 'meter',
      quantity: 100,
    });
    expect(sold.moves[0]).toMatchObject({
      batchId: seeded.pendingRoll.id,
      type: 'sale',
      delta: -100,
    });
    // An edit of a fabric can no longer be pushed: kept, refused, visible.
    expect(fabric?.error).toMatchObject({ code: 'bad_request' });
    db.close();
  });

  it('works afterwards: the repositories read the upgraded device like any other', async () => {
    const seeded = await seedLegacy();
    const db = new ShopDatabase(name);
    const store = new LocalStore(db);
    const repos = createRepositories(store);
    const sale = await repos.sales.get(seeded.saleId);
    expect(sale?.lines.map((entry) => entry.line.batchId).sort()).toEqual(
      [seeded.metre.id, seeded.kg.id].sort(),
    );
    // 275 cm of the metre roll at 16 dh/m (4400); 1000 cm of the kg roll, whose length turned out
    // 7600 cm in all, costed as if that had always been known: 40000 × 1000 ÷ 7600 (5263).
    expect(
      sale?.figures.lines.map((entry) => entry.costCents).sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([4400, 5263]);
    db.close();
  });

  it('is a no-op on a device with no stock, and idempotent to reopen', async () => {
    const old = new DatabaseV13(name);
    await old.open();
    old.close();
    const db = new ShopDatabase(name);
    await db.open();
    expect(await db.productBatches.count()).toBe(0);
    db.close();
    const again = new ShopDatabase(name);
    await again.open();
    expect(await again.productStockMoves.count()).toBe(0);
    again.close();
  });
});

/** What a device that kept the books before employees holds: two partners, an expense, a rule and a settlement. */
async function seedBeforePeople() {
  const old = new DatabaseV15(name);
  const owner = {
    ...base(1),
    id: id(),
    name: 'Owner',
    ownershipBp: 6000,
    isOwner: true,
    serverSeq: 1,
  };
  const partner = {
    ...base(2),
    id: id(),
    name: 'Partner',
    ownershipBp: 4000,
    isOwner: false,
    serverSeq: 2,
  };
  const expense = {
    ...base(3),
    id: id(),
    date: '2026-10-03',
    category: 'rent',
    amountCents: 50_000,
    paidDate: '2026-10-03',
    recurringExpenseId: null,
    notes: null,
    serverSeq: 3,
  };
  const rule = {
    ...base(4),
    id: id(),
    effectiveFrom: '2026-12-01',
    ownerWeight: 1,
    partnerWeight: 1,
    shopWeight: 2,
    serverSeq: 4,
  };
  const settlement = {
    ...base(5),
    id: id(),
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    serverSeq: 5,
  };
  await old.table('partners').bulkAdd([owner, partner]);
  await old.table('expenses').add(expense);
  await old.table('profitSplitRules').add(rule);
  await old.table('settlements').add(settlement);
  old.close();
  return { owner, partner, expense, rule, settlement };
}

describe('the device upgrade to people and salaries (ADR 0022, Dexie v16)', () => {
  it('gives the rows already here the fields they lack, as none, and keeps the rest', async () => {
    const seeded = await seedBeforePeople();
    const db = new ShopDatabase(name);
    await db.open();
    expect(await db.partners.get(seeded.partner.id)).toEqual({
      ...seeded.partner,
      phone: null,
      title: null,
      startDate: null,
      notes: null,
    });
    expect(await db.expenses.get(seeded.expense.id)).toEqual({
      ...seeded.expense,
      employeeId: null,
      salaryMonth: null,
    });
    expect(await db.profitSplitRules.get(seeded.rule.id)).toEqual({
      ...seeded.rule,
      partnerWeights: null,
    });
    expect(await db.settlements.get(seeded.settlement.id)).toEqual({
      ...seeded.settlement,
      partnerWeights: null,
    });
    expect(await db.employees.count()).toBe(0);
    expect(await db.employeeSalaries.count()).toBe(0);
    // The new index is there: no expense pays an employee yet.
    expect(await db.expenses.where('employeeId').equals('nobody').toArray()).toEqual([]);
    db.close();
  });

  it('works afterwards: a rule from before names no partner, so it stays with the first one', async () => {
    const seeded = await seedBeforePeople();
    const db = new ShopDatabase(name);
    const repos = createRepositories(new LocalStore(db, () => new Date('2026-11-04T10:00:00Z')));
    const people = await repos.partners.list();
    expect(people.map(({ partner }) => partner.id)).toEqual([seeded.owner.id, seeded.partner.id]);
    expect(people.map(({ status }) => status)).toEqual(['active', 'active']);
    const rules = await repos.settlements.splitRules();
    // The rule in force before any is entered, and the one entered: both are the first partner's.
    expect(rules.map(({ partnerWeights }) => partnerWeights)).toEqual([
      [{ partnerId: seeded.partner.id, weight: 1 }],
      [{ partnerId: seeded.partner.id, weight: 1 }],
    ]);
    const directory = await repos.employees.list('2026-11');
    expect(directory.employees).toEqual([]);
    expect(directory.totals).toEqual({ dueCents: 0, paidCents: 0, remainingCents: 0 });
    db.close();
  });

  it('is idempotent to reopen: what was saved after the upgrade stays', async () => {
    const seeded = await seedBeforePeople();
    const first = new ShopDatabase(name);
    await first.open();
    await first.partners.update(seeded.partner.id, { phone: '0600000000' });
    first.close();
    const again = new ShopDatabase(name);
    await again.open();
    expect((await again.partners.get(seeded.partner.id))?.phone).toBe('0600000000');
    expect(again.verno).toBe(17);
    again.close();
  });

  it('is a no-op on a device with no records', async () => {
    const old = new DatabaseV15(name);
    await old.open();
    old.close();
    const db = new ShopDatabase(name);
    await db.open();
    expect(await db.partners.count()).toBe(0);
    expect(await db.employees.count()).toBe(0);
    db.close();
  });
});

describe('the device upgrade to products with suppliers (Dexie v17)', () => {
  const oldProduct = (serverSeq: number | null) => ({
    ...base(1),
    id: id(),
    name: 'Rosa',
    sku: null,
    description: null,
    tags: [],
    purchaseUnits: ['meter'],
    sellingUnits: ['meter'],
    kgToMeterConversion: null,
    pricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
    pricePerPieceCents: null,
    minPricePerPieceCents: null,
    lowStockThreshold: null,
    active: true,
    serverSeq,
  });

  it('gives the products already here an empty list of suppliers, and keeps the rest', async () => {
    const old = new DatabaseV16(name);
    const [synced, local] = [oldProduct(7), oldProduct(null)];
    await old.table('products').bulkAdd([synced, local]);
    old.close();
    const db = new ShopDatabase(name);
    await db.open();
    expect(await db.products.get(synced.id)).toEqual({ ...synced, supplierIds: [] });
    expect(await db.products.get(local.id)).toEqual({ ...local, supplierIds: [] });
    db.close();
  });

  it('leaves a list that is already there, and a device with no products, alone', async () => {
    const first = new DatabaseV16(name);
    const kept = { ...oldProduct(3), supplierIds: [id()] };
    await first.table('products').add(kept);
    first.close();
    const db = new ShopDatabase(name);
    await db.open();
    expect(await db.products.get(kept.id)).toEqual(kept);
    db.close();

    const empty = `${name}-empty`;
    const none = new DatabaseV16(empty);
    await none.open();
    none.close();
    const upgraded = new ShopDatabase(empty);
    await upgraded.open();
    expect(await upgraded.products.count()).toBe(0);
    upgraded.close();
    await Dexie.delete(empty);
  });
});
