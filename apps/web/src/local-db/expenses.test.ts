import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { isAlreadyCreated, ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
/** The device's clock: moved by the tests. */
let now = new Date('2026-10-12T09:00:00.000Z');

beforeEach(() => {
  now = new Date('2026-10-12T09:00:00.000Z');
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  repos = createRepositories(new LocalStore(db, () => now));
});

afterEach(async () => {
  await db.delete();
});

describe('expenses on the device (BUILD_PROMPTS 4.1)', () => {
  it('recurring bills: reminded before they are due, created in one go with the amount typed', async () => {
    // Set up on 1 October: rent on the 1st (fixed), electricity on the 15th (variable).
    now = new Date('2026-10-01T08:00:00.000Z');
    const rent = await repos.expenses.saveTemplate({
      name: 'كراء المحل',
      category: 'rent',
      amountCents: 300_000,
      dayOfMonth: 1,
    });
    const power = await repos.expenses.saveTemplate({
      name: 'كهرباء',
      category: 'electricity',
      dayOfMonth: 15,
    });
    now = new Date('2026-10-12T09:00:00.000Z');
    expect(
      (await repos.expenses.reminders()).map((r) => [r.template.name, r.month, r.status]),
    ).toEqual([
      ['كراء المحل', '2026-10', 'overdue'],
      ['كهرباء', '2026-10', 'upcoming'],
    ]);

    await repos.expenses.createFromTemplate({
      templateId: rent,
      month: '2026-10',
      amountCents: 300_000,
      paidDate: '2026-10-12',
    });
    const bill = await repos.expenses.createFromTemplate({
      templateId: power,
      month: '2026-10',
      amountCents: 45_500,
      paidDate: null,
    });
    expect(await repos.expenses.get(bill)).toMatchObject({
      date: '2026-10-15',
      category: 'electricity',
      amountCents: 45_500,
      paidDate: null,
      note: 'كهرباء',
      recurringExpenseId: power,
    });
    expect(await repos.expenses.reminders()).toEqual([]);
    // Saved on the device with their ops: they sync later (offline-first).
    expect((await db.outbox.toArray()).map((op) => op.entity)).toEqual([
      'recurring_expense',
      'recurring_expense',
      'expense',
      'expense',
    ]);
  });

  it('a month counts what was paid in it; marking paid moves a bill into its month', async () => {
    const rent = await repos.expenses.save({
      date: '2026-10-01',
      category: 'rent',
      amountCents: 300_000,
      paidDate: '2026-10-01',
    });
    const water = await repos.expenses.save({
      date: '2026-10-20',
      category: 'water',
      amountCents: 8000,
    });
    await repos.expenses.save({
      date: '2026-09-25',
      category: 'transport',
      amountCents: 5000,
      paidDate: '2026-09-25',
    });
    expect((await repos.expenses.month('2026-10')).totals).toEqual({
      paidCents: 300_000,
      paidByCategory: { rent: 300_000 },
      unpaidCents: 8000,
      unpaidCount: 1,
      totalCents: 308_000,
      paidCount: 1,
      entryCount: 2,
    });
    await repos.expenses.setPaid(water, '2026-11-02');
    const october = await repos.expenses.month('2026-10');
    expect(october.totals).toMatchObject({ paidCents: 300_000, unpaidCents: 0 });
    // Newest first. The water bill is dated in October but counts in November, where it was paid.
    expect(october.rows.map((row) => [row.expense.id, row.standing, row.countsIn])).toEqual([
      [water, 'other', '2026-11'],
      [rent, 'paid', null],
    ]);
    expect((await repos.expenses.month('2026-11')).totals.paidByCategory).toEqual({ water: 8000 });

    await repos.expenses.void(rent, 'أُدخل مرتين');
    expect((await repos.expenses.month('2026-10')).totals.paidCents).toBe(0);
    await expect(
      repos.expenses.save({ date: '2026-10-01', category: 'rent', amountCents: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await repos.expenses.categories()).map((category) => category.key)).toContain(
      'electricity',
    );
  });

  it('a month lists what counts in it: earlier unpaid bills are carried over, and the rows add up to the total', async () => {
    await repos.expenses.save({
      date: '2026-09-20',
      category: 'water',
      amountCents: 8000,
    });
    await repos.expenses.save({
      date: '2026-09-27',
      category: 'internet',
      amountCents: 20_000,
      paidDate: '2026-10-02',
    });
    await repos.expenses.save({
      date: '2026-10-03',
      category: 'electricity',
      amountCents: 45_500,
    });
    await repos.expenses.save({
      date: '2026-11-05',
      category: 'rent',
      amountCents: 300_000,
    });
    const october = await repos.expenses.month('2026-10');
    expect(
      october.rows.map((row) => [row.expense.category, row.standing, row.carriedOver]),
    ).toEqual([
      ['electricity', 'unpaid', false],
      ['internet', 'paid', false],
      ['water', 'unpaid', true],
    ]);
    expect(october.totals).toMatchObject({
      paidCents: 20_000,
      unpaidCents: 53_500,
      totalCents: 73_500,
      entryCount: 3,
    });
    const counting = october.rows.filter((row) => row.standing !== 'other');
    expect(counting.reduce((sum, row) => sum + row.expense.amountCents, 0)).toBe(
      october.totals.totalCents,
    );
    expect(counting).toHaveLength(october.totals.entryCount);
  });

  it('templates are listed by what is due first, paused ones last; a bill is created once a month (E5, E6)', async () => {
    now = new Date('2026-10-01T08:00:00.000Z');
    const rent = await repos.expenses.saveTemplate({
      name: 'كراء المحل',
      category: 'rent',
      amountCents: 300_000,
      dayOfMonth: 1,
    });
    const net = await repos.expenses.saveTemplate({
      name: 'إنترنت',
      category: 'internet',
      amountCents: 20_000,
      dayOfMonth: 28,
    });
    await repos.expenses.saveTemplate({
      name: 'حارس',
      category: 'wages',
      amountCents: 50_000,
      dayOfMonth: 10,
      active: false,
    });
    now = new Date('2026-10-12T09:00:00.000Z');
    expect(
      (await repos.expenses.recurringBills()).map((bill) => [
        bill.template.name,
        bill.next?.month ?? null,
        bill.next?.status ?? null,
      ]),
    ).toEqual([
      ['كراء المحل', '2026-10', 'overdue'],
      ['إنترنت', '2026-10', 'later'],
      ['حارس', null, null],
    ]);

    await repos.expenses.createFromTemplate({
      templateId: rent,
      month: '2026-10',
      amountCents: 300_000,
      paidDate: null,
    });
    // Created already: a second tap, or another device's, makes nothing.
    const again = repos.expenses.createFromTemplate({
      templateId: rent,
      month: '2026-10',
      amountCents: 300_000,
      paidDate: '2026-10-12',
    });
    await expect(again).rejects.toBeInstanceOf(ValidationError);
    await expect(again).rejects.toSatisfy(isAlreadyCreated);
    expect(
      (await repos.expenses.month('2026-10')).rows.filter((row) => row.expense.category === 'rent'),
    ).toHaveLength(1);
    const rentBill = (await repos.expenses.recurringBills()).find(
      (bill) => bill.template.id === rent,
    );
    expect(rentBill?.next).toMatchObject({ month: '2026-11' });
    // A voided bill can be created again; another template's bill is not in the way.
    const created = (await repos.expenses.month('2026-10')).rows.find(
      (row) => row.expense.category === 'rent',
    );
    await repos.expenses.void(created?.expense.id ?? '', 'خطأ');
    await repos.expenses.createFromTemplate({
      templateId: rent,
      month: '2026-10',
      amountCents: 300_000,
      paidDate: null,
    });
    await repos.expenses.createFromTemplate({
      templateId: net,
      month: '2026-10',
      amountCents: 20_000,
      paidDate: null,
    });
  });
});
