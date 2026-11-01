import 'fake-indexeddb/auto';
import { RETURN_ISSUES, SALE_ISSUES, SUPPLIER_PAYMENT_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { NotAllowedError, ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let minute = 0;
const day = '2026-10-30';
let red: string;
let supplier: string;
let customer: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
  });
  red = await repos.variants.save({ fabricId, colorName: 'أحمر' });
  supplier = await repos.suppliers.save({ name: 'مورد الأقمشة' });
  customer = await repos.customers.save({ name: 'فاطمة' });
  await repos.partners.saveBoth({
    owner: { name: 'أنا', ownershipBp: 5000 },
    partner: { name: 'شريكي' },
  });
  const [owner] = await repos.partners.list();
  await repos.partners.recordCapitalMove({
    partnerId: owner?.partner.id ?? '',
    kind: 'contribution',
    amountCents: 200_000,
    date: '2026-09-01',
  });
});

afterEach(async () => {
  await db.delete();
});

/** A roll of `lengthCm` at 16 dh/m. */
async function buy(lengthCm: number, extra: { supplierId?: string; paidCents?: number } = {}) {
  const purchaseId = await repos.purchases.create({
    method: 'meter',
    date: '2026-10-01',
    pricePerMeterCents: 1600,
    rolls: [{ variantId: red, lengthCm }],
    ...extra,
  });
  const [roll] = await repos.purchases.rollsOf(purchaseId);
  if (!roll) throw new Error('no roll');
  return { rollId: roll.id, purchaseId };
}

const line = (rollId: string, soldCm: number, perMeterCents = 2000) => ({
  rollId,
  soldCm,
  price: { perMeterCents },
  refPricePerMeterCents: 2000,
  minPricePerMeterCents: 1700,
});

const remaining = async (rollId: string) =>
  (await repos.inventory.roll(rollId))?.ledger.remainingCm;
const integrity = async () => (await repos.integrity.report()).ok;

describe('returns on the device (BUILD_PROMPTS 5.3)', () => {
  it('a paid sale partly returned: the cloth goes back, the cash is refunded, one append op', async () => {
    const { rollId } = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 1000)],
      paidCents: 20_000,
    });
    const view = await repos.sales.get(saleId);
    const lineId = view?.lines[0]?.line.id ?? '';

    const preview = await repos.sales.previewReturn({
      saleId,
      date: day,
      reason: 'x',
      lines: [{ lineId, returnedCm: 400 }],
      refundCents: 8000,
    });
    expect(preview).toMatchObject({ creditCents: 8000, maxRefundCents: 8000, issues: [] });

    const returnId = await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'لم يعجبها اللون',
      lines: [{ lineId, returnedCm: 400 }],
      refundCents: 8000,
    });
    expect(await remaining(rollId)).toBe(5000 - 1000 + 400);
    expect((await repos.sales.get(saleId))?.figures).toMatchObject({
      returnedCents: 8000,
      netTotalCents: 12_000,
      capitalCents: 9600,
      profitCents: 2400,
      dueCents: 0,
    });
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'sale_return');
    expect(ops).toEqual([expect.objectContaining({ entityId: returnId, kind: 'append' })]);
    expect((await db.payments.toArray()).filter((p) => p.kind === 'refund')).toEqual([
      expect.objectContaining({ amountCents: 8000 }),
    ]);
    expect(await integrity()).toBe(true);
    expect(await repos.sales.returnedOn(day)).toBe(8000);
  });

  it('refuses more than was sold, a refund beyond the overpayment, and a walk-in keeping credit', async () => {
    const { rollId } = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 500)],
      paidCents: 10_000,
    });
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    const attempt = (returnedCm: number, refundCents: number) =>
      repos.sales.giveBack({
        saleId,
        date: day,
        reason: 'x',
        lines: [{ lineId, returnedCm }],
        refundCents,
      });
    await expect(attempt(501, 0)).rejects.toEqual(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: RETURN_ISSUES.aboveSold })],
      }),
    );
    await expect(attempt(100, 5000)).rejects.toBeInstanceOf(ValidationError); // walk-in: all 2000 back
    await expect(attempt(100, 2000)).resolves.toBeTypeOf('string');
    expect(await integrity()).toBe(true);
  });

  it('a credit sale: the return lowers what the customer owes, and the account follows', async () => {
    const { rollId } = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      customerId: customer,
      lines: [line(rollId, 500)],
      paidCents: 2000,
    });
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    expect((await repos.accounts.account(customer))?.account.collectibleCents).toBe(8000);
    await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'قصيرة',
      lines: [{ lineId, returnedCm: 200 }],
      refundCents: 0,
    });
    expect((await repos.accounts.account(customer))?.account).toMatchObject({
      collectibleCents: 4000,
      balanceCents: 4000,
      creditCents: 0,
    });
    expect((await repos.sales.list())[0]?.dueCents).toBe(4000);
    expect(await integrity()).toBe(true);
  });

  it('what the customer paid beyond the new worth is credit, refundable later', async () => {
    const { rollId } = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      customerId: customer,
      lines: [line(rollId, 500)],
      paidCents: 10_000,
    });
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'x',
      lines: [{ lineId, returnedCm: 500 }],
      refundCents: 0, // kept as credit on the account
    });
    expect((await repos.accounts.account(customer))?.account).toMatchObject({
      creditCents: 10_000,
      balanceCents: -10_000,
    });
    await repos.accounts.refund({ customerId: customer, amountCents: 10_000, date: day });
    expect((await repos.accounts.account(customer))?.account.creditCents).toBe(0);
    expect(await integrity()).toBe(true);
  });

  it('a sale with returns cannot be voided; the rest is returned instead (RT7)', async () => {
    const { rollId } = await buy(5000);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 500)],
      paidCents: 10_000,
    });
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'x',
      lines: [{ lineId, returnedCm: 100 }],
      refundCents: 2000,
    });
    await expect(repos.sales.voidSale(saleId, 'خطأ')).rejects.toEqual(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: SALE_ISSUES.hasReturns })],
      }),
    );
  });

  it('marking the roll a remnant is a separate roll update, as before', async () => {
    const { rollId } = await buy(500);
    const saleId = await repos.sales.create({
      date: day,
      lines: [line(rollId, 500)],
      paidCents: 10_000,
    });
    const lineId = (await repos.sales.get(saleId))?.lines[0]?.line.id ?? '';
    await repos.sales.giveBack({
      saleId,
      date: day,
      reason: 'x',
      lines: [{ lineId, returnedCm: 150 }],
      refundCents: 3000,
    });
    await repos.inventory.setRemnant(rollId, true);
    expect((await repos.inventory.roll(rollId))?.roll.status).toBe('remnant');
  });
});

describe('supplier payables on the device (BUILD_PROMPTS 5.3)', () => {
  it('a purchase part paid is a debt; payments lower it; never beyond it', async () => {
    const { purchaseId } = await buy(5000, { supplierId: supplier, paidCents: 30_000 });
    expect((await repos.supplierAccounts.payables())[0]?.account).toMatchObject({
      owedCents: 50_000,
    });
    expect(await integrity()).toBe(true);

    await repos.supplierAccounts.pay({
      supplierId: supplier,
      amountCents: 20_000,
      date: day,
      purchaseId,
    });
    const statement = await repos.supplierAccounts.statement(supplier);
    expect(statement?.account.balanceCents).toBe(30_000);
    expect(statement?.statement.map((entry) => entry.kind)).toEqual([
      'purchase',
      'paid_at_purchase',
      'payment',
    ]);
    await expect(
      repos.supplierAccounts.pay({ supplierId: supplier, amountCents: 30_001, date: day }),
    ).rejects.toEqual(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: SUPPLIER_PAYMENT_ISSUES.aboveOwed })],
      }),
    );
    expect(await repos.supplierAccounts.totalOwedCents()).toBe(30_000);
    expect(await integrity()).toBe(true);
    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'supplier_payment');
    expect(ops).toHaveLength(1);
  });

  it('a payment can be voided with a reason, and the debt returns', async () => {
    await buy(5000, { supplierId: supplier, paidCents: 0 });
    await repos.supplierAccounts.pay({ supplierId: supplier, amountCents: 80_000, date: day });
    expect(await repos.supplierAccounts.payables()).toEqual([]);
    const [payment] = await db.supplierPayments.toArray();
    await repos.supplierAccounts.voidPayment(payment?.id ?? '', 'خطأ في المبلغ');
    expect((await repos.supplierAccounts.payables())[0]?.account.owedCents).toBe(80_000);
  });

  it('a debt needs a supplier, and nothing is paid beyond the cost', async () => {
    await expect(buy(5000, { paidCents: 100 })).rejects.toBeInstanceOf(ValidationError);
    await expect(buy(5000, { supplierId: supplier, paidCents: 900_000 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('a cashier’s device (BUILD_PROMPTS 5.3, RL3)', () => {
  it('sells and takes payments, and nothing that buys, spends or settles', async () => {
    const { rollId } = await buy(5000);
    store.setRole('cashier');
    await expect(
      repos.sales.create({ date: day, lines: [line(rollId, 100)], paidCents: 2000 }),
    ).resolves.toBeTypeOf('string');
    await expect(repos.customers.save({ name: 'زبونة' })).resolves.toBeTypeOf('string');
    await expect(
      repos.expenses.save({ date: day, category: 'rent', amountCents: 100 }),
    ).rejects.toBeInstanceOf(NotAllowedError);
    await expect(buy(100)).rejects.toBeInstanceOf(NotAllowedError);
    await expect(repos.inventory.setRemnant(rollId, true)).rejects.toBeInstanceOf(NotAllowedError);
  });

  it('a partner’s device changes nothing', async () => {
    store.setRole('partner');
    await expect(repos.customers.save({ name: 'x' })).rejects.toThrow(/read/);
  });
});
