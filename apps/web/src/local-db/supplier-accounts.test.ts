import 'fake-indexeddb/auto';
import { SUPPLIER_PAYMENT_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';
import { seedProduct } from './test-helpers';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let minute = 0;
let silk: string;
let cotton: string;
let product: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  product = await seedProduct(repos);
  silk = await repos.suppliers.save({ name: 'مورد الحرير', phone: '0661234567' });
  cotton = await repos.suppliers.save({ name: 'مورد القطن' });
});

afterEach(async () => {
  await db.delete();
});

/** `meters` of the product at 16 dh a metre, from a supplier, `paidCents` paid on the spot. */
async function buy(date: string, meters: number, supplierId: string, paidCents?: number) {
  return repos.purchases.create({
    date,
    productId: product,
    unit: 'meter',
    quantity: meters * 100,
    totalCostCents: meters * 1600,
    supplierId,
    ...(paidCents === undefined ? {} : { paidCents }),
  });
}

describe('the supplier directory', () => {
  it('lists every supplier by name with their account and the day of their last dealing', async () => {
    await buy('2026-10-01', 100, silk, 60_000); // 160,000 cents, 100,000 owed
    const payment = await repos.supplierAccounts.pay({
      supplierId: silk,
      amountCents: 30_000,
      date: '2026-10-20',
    });
    expect(payment).toBeTypeOf('string');

    const rows = await repos.supplierAccounts.list();
    const names = rows.map((row) => row.supplier.name);
    expect(names).toHaveLength(2);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ar')));
    const silkRow = rows.find((row) => row.supplier.id === silk);
    expect(silkRow?.account).toMatchObject({
      purchasesCents: 160_000,
      paidCents: 90_000,
      balanceCents: 70_000,
      owedCents: 70_000,
    });
    expect(silkRow?.lastActivity).toBe('2026-10-20');
    const cottonRow = rows.find((row) => row.supplier.id === cotton);
    expect(cottonRow?.account.balanceCents).toBe(0);
    expect(cottonRow?.lastActivity).toBeNull();
  });

  it('leaves voided suppliers out, and payables() keeps to who is owed', async () => {
    await buy('2026-10-01', 10, silk, 0);
    expect((await repos.supplierAccounts.payables()).map((row) => row.supplier.id)).toEqual([silk]);
    expect(await repos.supplierAccounts.totalOwedCents()).toBe(16_000);
    await repos.suppliers.void(cotton, 'doublon');
    expect((await repos.supplierAccounts.list()).map((row) => row.supplier.id)).toEqual([silk]);
  });
});

describe('one supplier’s account', () => {
  it('has the purchases with what they brought in, the payments and a statement that ends on the balance', async () => {
    const first = await buy('2026-10-01', 100, silk, 60_000);
    await buy('2026-10-10', 10, silk);
    await repos.supplierAccounts.pay({
      supplierId: silk,
      amountCents: 30_000,
      date: '2026-10-20',
      purchaseId: first,
    });
    const view = await repos.supplierAccounts.account(silk);
    expect(view?.purchases.map((row) => row.purchase.date)).toEqual(['2026-10-10', '2026-10-01']);
    expect(view?.purchases[0]?.productNames).toEqual(['روزا']);
    expect(view?.purchases[0]?.batchCodes).toHaveLength(1);
    expect(view?.payments).toHaveLength(1);
    expect(view?.account.allocations).toEqual([
      { paymentId: view?.payments[0]?.id, purchaseId: first, amountCents: 30_000 },
    ]);
    expect(view?.statement.at(-1)?.balanceCents).toBe(view?.account.balanceCents);
    expect(view?.account.purchasesCents).toBe(160_000 + 16_000);
  });

  it('keeps a voided payment in the list, out of the account, and the debt returns', async () => {
    await buy('2026-10-01', 10, silk, 0);
    await repos.supplierAccounts.pay({ supplierId: silk, amountCents: 16_000, date: '2026-10-05' });
    const paid = await repos.supplierAccounts.account(silk);
    expect(paid?.account.owedCents).toBe(0);
    await repos.supplierAccounts.voidPayment(paid?.payments[0]?.id ?? '', 'saisie en double');
    const after = await repos.supplierAccounts.account(silk);
    expect(after?.account.owedCents).toBe(16_000);
    expect(after?.payments).toHaveLength(1);
    expect(after?.payments[0]?.voidedAt).not.toBeNull();
    // A voided payment is not a dealing with the supplier.
    expect(after?.lastActivity).toBe('2026-10-01');
  });

  it('is unknown for a supplier that is not on the device', async () => {
    expect(await repos.supplierAccounts.account(crypto.randomUUID())).toBeUndefined();
  });
});

describe('previewing a payment', () => {
  it('says where it goes and what stays owed, without saving anything', async () => {
    const older = await buy('2026-10-01', 10, silk, 0); // 16,000 owed
    const newer = await buy('2026-10-05', 5, silk, 0); // 8,000 owed
    const preview = await repos.supplierAccounts.previewPayment({
      supplierId: silk,
      amountCents: 20_000,
      date: '2026-10-20',
      purchaseId: newer,
    });
    expect(preview?.issues).toEqual([]);
    expect(preview?.allocations.map((part) => [part.purchaseId, part.amountCents])).toEqual([
      [newer, 8000],
      [older, 12_000],
    ]);
    expect(preview?.owedAfterCents).toBe(4000);
    expect(await db.supplierPayments.count()).toBe(0);
    expect(await db.outbox.filter((op) => op.entity === 'supplier_payment').count()).toBe(0);
  });

  it('refuses more than is owed, the same way the save does', async () => {
    await buy('2026-10-01', 10, silk, 0);
    const input = { supplierId: silk, amountCents: 16_001, date: '2026-10-20' };
    const preview = await repos.supplierAccounts.previewPayment(input);
    expect(preview?.issues.map((issue) => issue.message)).toEqual([
      SUPPLIER_PAYMENT_ISSUES.aboveOwed,
    ]);
    await expect(repos.supplierAccounts.pay(input)).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: SUPPLIER_PAYMENT_ISSUES.aboveOwed })],
    });
  });

  it('is nothing until an amount is typed', async () => {
    expect(
      await repos.supplierAccounts.previewPayment({
        supplierId: silk,
        amountCents: 0,
        date: '2026-10-20',
      }),
    ).toBeNull();
  });
});
