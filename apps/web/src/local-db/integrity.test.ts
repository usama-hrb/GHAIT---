import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
/** 3 November 2026, a minute later at each call: history order is creation order. */
let now = Date.UTC(2026, 10, 3, 9, 0);
const dh = (amount: number) => amount * 100;

beforeEach(async () => {
  now = Date.UTC(2026, 10, 3, 9, 0);
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date((now += 60_000)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
});

afterEach(async () => {
  await db.delete();
});

/** T13 (SPEC §16), entered through this device's repositories, offline. */
async function t13(): Promise<{ expenseId: string }> {
  await repos.partners.saveBoth({
    owner: { name: 'أنا', ownershipBp: 5000 },
    partner: { name: 'شريكي' },
  });
  const [owner, partner] = await repos.partners.list();
  if (!owner || !partner) throw new Error('two partners');
  for (const view of [owner, partner]) {
    await repos.partners.recordCapitalMove({
      partnerId: view.partner.id,
      kind: 'contribution',
      amountCents: dh(1000),
      date: '2026-10-01',
    });
  }
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1000,
  });
  const variantId = await repos.variants.save({ fabricId, colorName: 'أحمر' });
  const purchaseId = await repos.purchases.create({
    method: 'meter',
    date: '2026-10-02',
    pricePerMeterCents: 1600,
    rolls: [{ variantId, lengthCm: 5000 }],
  });
  const [roll] = await repos.purchases.rollsOf(purchaseId);
  if (!roll) throw new Error('a roll');
  const sell = (date: string, customerId: string | null, paidCents: number) =>
    repos.sales.create({
      date,
      customerId,
      lines: [
        {
          rollId: roll.id,
          soldCm: 1000,
          price: { perMeterCents: 2000 },
          refPricePerMeterCents: 2000,
          minPricePerMeterCents: 1000,
        },
      ],
      paidCents,
    });
  await sell('2026-10-05', null, dh(200));
  const customerId = await repos.customers.save({ name: 'فاطمة' });
  const credit = await sell('2026-10-06', customerId, 0);
  await repos.accounts.recordPayment({
    customerId,
    amountCents: dh(100),
    date: '2026-10-10',
    targetSaleId: credit,
  });
  const expenseId = await repos.expenses.save({
    date: '2026-10-12',
    category: 'rent',
    amountCents: dh(10),
    paidDate: '2026-10-12',
  });
  await repos.inventory.record({
    type: 'loss',
    rollId: roll.id,
    date: '2026-10-15',
    lengthCm: 30,
    reason: 'تلف',
  });
  await repos.partners.recordDraw(
    { partnerId: owner.partner.id, amountCents: dh(20), date: '2026-10-20', reason: 'شخصي' },
    true,
  );
  return { expenseId };
}

describe('the integrity check on the device (BUILD_PROMPTS 4.4)', () => {
  it('T13 balances on this device’s own records; a record changed behind its back shows', async () => {
    const { expenseId } = await t13();
    const report = await repos.integrity.report();
    expect(report).toMatchObject({ ok: true, diffCents: 0, holdingsCents: 200_520 });
    expect(report.breakdown.find((line) => line.key === 'unsettled_net_profit')?.cents).toBe(2520);

    // An expense of the open month edited: its cash and its month's result move together.
    await db.expenses.update(expenseId, { amountCents: dh(10) + 500 });
    expect(await repos.integrity.report()).toMatchObject({ ok: true });

    // A roll whose cost no longer matches what was paid for it, edited straight in the
    // device's database past the repositories: the check shows exactly that difference.
    const [roll] = await db.rolls.toArray();
    if (!roll) throw new Error('a roll');
    await db.rolls.update(roll.id, { costTotalCents: roll.costTotalCents + 77 });
    expect(await repos.integrity.report()).toMatchObject({ ok: false, diffCents: 77 });
  });

  it('a cash count: the books move to the money counted, a difference says why, a void undoes it', async () => {
    await t13();
    const expected = await repos.integrity.expectedCashCents();
    expect(expected).toBe(147_000);
    await expect(
      repos.integrity.recordCount({ date: '2026-11-03', countedCents: expected - 500 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const id = await repos.integrity.recordCount({
      date: '2026-11-03',
      countedCents: expected - 500,
      note: 'نقص في الصندوق',
    });
    expect(await repos.integrity.expectedCashCents()).toBe(expected - 500);
    expect(await repos.integrity.report()).toMatchObject({ ok: true });
    expect((await repos.integrity.countHistory())[0]).toMatchObject({
      expectedCents: expected,
      countedCents: expected - 500,
      diffCents: -500,
    });
    expect((await repos.integrity.recent()).map((event) => event.entity)[0]).toBe(
      'cash_adjustment',
    );
    await repos.integrity.voidCount(id, 'عددت خطأ');
    expect(await repos.integrity.expectedCashCents()).toBe(expected);
    expect((await db.outbox.toArray()).slice(-2).map((op) => [op.entity, op.kind])).toEqual([
      ['cash_adjustment', 'upsert'],
      ['cash_adjustment', 'void'],
    ]);
  });

  it('a count dated in a settled period is refused, like any record in it', async () => {
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
      lockedAt: '2026-11-02T09:00:00.000Z',
    });
    await expect(
      repos.integrity.recordCount({ date: '2026-10-31', countedCents: 0 }),
    ).rejects.toMatchObject({ issues: [expect.objectContaining({ message: 'period_locked' })] });
    await expect(
      repos.integrity.recordCount({ date: '2026-11-03', countedCents: 0 }),
    ).resolves.toBeTypeOf('string');
  });
});
