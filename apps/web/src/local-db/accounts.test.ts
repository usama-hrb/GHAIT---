import 'fake-indexeddb/auto';
import { RECEIVABLE_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
let minute = 0;
let rollId: string;
let customerId: string;

beforeEach(async () => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date(Date.UTC(2026, 9, 30, 9, minute++)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
  });
  const variantId = await repos.variants.save({ fabricId, colorName: 'أحمر' });
  const purchaseId = await repos.purchases.create({
    method: 'meter',
    date: '2026-09-01',
    pricePerMeterCents: 1600,
    rolls: [{ variantId, lengthCm: 50_000 }],
  });
  rollId = (await repos.purchases.rollsOf(purchaseId))[0]?.id ?? '';
  customerId = await repos.customers.save({ name: 'فاطمة', phone: '0612345678' });
});

afterEach(async () => {
  await db.delete();
});

/** A credit sale of `soldCm` at 20 dh/m, nothing paid. */
const creditSale = (soldCm: number, date: string) =>
  repos.sales.create({
    date,
    customerId,
    lines: [
      {
        rollId,
        soldCm,
        price: { perMeterCents: 2000 },
        refPricePerMeterCents: 2000,
        minPricePerMeterCents: 1700,
      },
    ],
    paidCents: 0,
  });

const account = async () => {
  const view = await repos.accounts.account(customerId);
  if (!view) throw new Error('no account');
  return view.account;
};

describe('customer accounts on the device (BUILD_PROMPTS 3.5)', () => {
  it('T8: 200 dh costing 160 paid 100 then 100: capital 100 / 0, then 60 / 40', async () => {
    const saleId = await creditSale(1000, '2026-10-01');
    expect(await account()).toMatchObject({ balanceCents: 20_000, collectibleCents: 20_000 });
    await repos.accounts.recordPayment({
      customerId,
      amountCents: 10_000,
      date: '2026-10-10',
      targetSaleId: saleId,
    });
    await repos.accounts.recordPayment({ customerId, amountCents: 10_000, date: '2026-10-20' });
    const sale = await repos.sales.get(saleId);
    expect(sale?.figures.payments.map((p) => [p.capitalCents, p.profitCents])).toEqual([
      [10_000, 0],
      [6000, 4000],
    ]);
    expect(await account()).toMatchObject({ balanceCents: 0, collectibleCents: 0 });
    expect((await db.outbox.toArray()).filter((op) => op.entity === 'payment')).toHaveLength(2);
  });

  it('balance = Σ sales − Σ payments; an overpayment is credit, refunded or applied later', async () => {
    await creditSale(100, '2026-10-01');
    const { unappliedCents } = await repos.accounts.recordPayment({
      customerId,
      amountCents: 3000,
      date: '2026-10-02',
    });
    expect(unappliedCents).toBe(1000);
    expect(await account()).toMatchObject({ balanceCents: 2000 - 3000, creditCents: 1000 });
    await expect(
      repos.accounts.refund({ customerId, amountCents: 1500, date: '2026-10-03' }),
    ).rejects.toEqual(
      new ValidationError([
        { path: ['amountCents'], message: RECEIVABLE_ISSUES.aboveCredit, code: 'custom' },
      ]),
    );
    await repos.accounts.refund({ customerId, amountCents: 400, date: '2026-10-03' });
    await creditSale(100, '2026-10-04');
    await repos.accounts.applyCredit(customerId);
    expect(await account()).toMatchObject({
      balanceCents: 2000 + 2000 - 3000 + 400,
      creditCents: 0,
      collectibleCents: 1400,
    });
    await expect(repos.accounts.applyCredit(customerId)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a written-off invoice leaves the list of who owes me; once only, with a reason', async () => {
    const old = await creditSale(300, '2026-08-01');
    await creditSale(100, '2026-10-01');
    const other = await repos.customers.save({ name: 'سعيد' });
    await repos.sales.create({
      date: '2026-09-01',
      customerId: other,
      lines: [
        {
          rollId,
          soldCm: 1000,
          price: { perMeterCents: 2000 },
          refPricePerMeterCents: 2000,
          minPricePerMeterCents: 1700,
        },
      ],
      paidCents: 0,
    });
    expect((await repos.accounts.debts('oldest')).map((d) => d.customer.name)).toEqual([
      'فاطمة',
      'سعيد',
    ]);
    expect((await repos.accounts.debts('largest')).map((d) => d.customer.name)).toEqual([
      'سعيد',
      'فاطمة',
    ]);

    await expect(repos.accounts.writeOff(old, ' ')).rejects.toBeInstanceOf(ValidationError);
    await repos.accounts.writeOff(old, 'سافر');
    expect(await account()).toMatchObject({
      collectibleCents: 2000,
      writtenOffCents: 6000,
      oldestOpenDate: '2026-10-01',
    });
    expect((await repos.sales.get(old))?.writeOff).toMatchObject({ reason: 'سافر' });
    await expect(repos.accounts.writeOff(old, 'مرة أخرى')).rejects.toBeInstanceOf(ValidationError);
    expect((await repos.accounts.debts('oldest')).map((d) => d.customer.name)).toEqual([
      'سعيد',
      'فاطمة',
    ]);
    expect((await repos.accounts.list('سع')).map((s) => s.customer.name)).toEqual(['سعيد']);
  });
});
