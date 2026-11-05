import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dayAfter,
  dueDateIn,
  type ExpenseItem,
  expenseStanding,
  monthBounds,
  monthlyExpenses,
  monthOf,
  nextMonth,
  nextRecurringDue,
  paidExpensesCents,
  previousMonth,
  recurringReminders,
  type RecurringTemplate,
} from './index.js';

const expense = (overrides: Partial<ExpenseItem>): ExpenseItem => ({
  date: '2026-10-05',
  category: 'rent',
  amountCents: 10_000,
  paidDate: null,
  voided: false,
  recurringId: null,
  ...overrides,
});

describe('months and due dates', () => {
  it('clamps a due day to the month’s last day (E1)', () => {
    expect(dueDateIn('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateIn('2028-02', 30)).toBe('2028-02-29');
    expect(dueDateIn('2026-10', 5)).toBe('2026-10-05');
    expect(() => dueDateIn('2026-10', 0)).toThrow(RangeError);
    expect(() => dueDateIn('2026-10', 32)).toThrow(RangeError);
    expect(() => dueDateIn('2026-13x', 1)).toThrow(RangeError);
  });

  it('knows a date’s month, the month before and its bounds', () => {
    expect(monthOf('2026-10-30')).toBe('2026-10');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(nextMonth('2026-09')).toBe('2026-10');
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(() => monthOf('30/10/2026')).toThrow(RangeError);
  });

  it('dayAfter crosses months and years (where the next settlement period starts)', () => {
    expect(dayAfter('2026-10-31')).toBe('2026-11-01');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(() => dayAfter('2026-10')).toThrow(RangeError);
  });
});

describe('recurringReminders (SPEC §5, E2)', () => {
  const rent: RecurringTemplate = { id: 'rent', dayOfMonth: 1, active: true, since: '2026-01-01' };
  const power: RecurringTemplate = {
    id: 'power',
    dayOfMonth: 15,
    active: true,
    since: '2026-01-01',
  };
  const remind = (today: string, expenses: ExpenseItem[] = [], templates = [rent, power]) =>
    recurringReminders({ templates, expenses, today, leadDays: 3 }).map((r) => [
      r.templateId,
      r.month,
      r.status,
      r.daysLeft,
    ]);

  it('reminds from three days before the due date until the expense is created', () => {
    expect(remind('2026-10-11')).toEqual([
      ['rent', '2026-09', 'overdue', -40],
      ['power', '2026-09', 'overdue', -26],
      ['rent', '2026-10', 'overdue', -10],
    ]);
    expect(
      remind('2026-10-12', [
        expense({ recurringId: 'rent', date: '2026-09-01' }),
        expense({ recurringId: 'rent', date: '2026-10-01' }),
        expense({ recurringId: 'power', date: '2026-09-15' }),
      ]),
    ).toEqual([['power', '2026-10', 'upcoming', 3]]);
    expect(
      remind('2026-10-15', [
        expense({ recurringId: 'rent', date: '2026-09-01' }),
        expense({ recurringId: 'rent', date: '2026-10-01' }),
      ]),
    ).toEqual([
      ['power', '2026-09', 'overdue', -30],
      ['power', '2026-10', 'due', 0],
    ]);
  });

  it('lists bills due the same day by template, the same on every device', () => {
    const water = { ...rent, id: 'water' };
    const internet = { ...rent, id: 'internet' };
    expect(remind('2026-10-01', [], [water, internet]).map((r) => [r[0], r[1]])).toEqual([
      ['internet', '2026-09'],
      ['water', '2026-09'],
      ['internet', '2026-10'],
      ['water', '2026-10'],
    ]);
  });

  it('skips paused templates, months before a template existed, and voided expenses', () => {
    const fresh = { ...rent, since: '2026-10-20' };
    expect(remind('2026-10-28', [], [fresh, { ...power, active: false }])).toEqual([]);
    expect(
      remind(
        '2026-11-01',
        [expense({ recurringId: 'rent', date: '2026-11-01', voided: true })],
        [fresh],
      ),
    ).toEqual([['rent', '2026-11', 'due', 0]]);
  });
});

describe('nextRecurringDue (E5)', () => {
  const rent: RecurringTemplate = { id: 'rent', dayOfMonth: 1, active: true, since: '2026-01-01' };
  const next = (today: string, expenses: ExpenseItem[] = [], template: RecurringTemplate = rent) =>
    nextRecurringDue({ template, expenses, today, leadDays: 3 });
  const made = (month: string, recurringId = 'rent', voided = false) =>
    expense({ date: `${month}-01`, recurringId, voided });

  it('is this month’s bill until it is created, then next month’s', () => {
    expect(next('2026-10-12', [made('2026-09')])).toEqual({
      month: '2026-10',
      dueDate: '2026-10-01',
      status: 'overdue',
      daysLeft: -11,
    });
    expect(next('2026-10-12', [made('2026-09'), made('2026-10')])).toEqual({
      month: '2026-11',
      dueDate: '2026-11-01',
      status: 'later',
      daysLeft: 20,
    });
  });

  it('is last month’s bill when it was never created, and says how soon each one is', () => {
    expect(next('2026-10-12')).toMatchObject({ month: '2026-09', status: 'overdue' });
    expect(next('2026-10-01', [made('2026-09')])).toMatchObject({ status: 'due', daysLeft: 0 });
    expect(next('2026-09-29', [made('2026-08'), made('2026-09')])).toMatchObject({
      month: '2026-10',
      status: 'upcoming',
      daysLeft: 2,
    });
    expect(next('2026-09-20', [made('2026-08'), made('2026-09')])).toMatchObject({
      month: '2026-10',
      status: 'later',
    });
  });

  it('agrees with the reminders: the first reminder of a template is its next bill', () => {
    const power: RecurringTemplate = {
      id: 'power',
      dayOfMonth: 15,
      active: true,
      since: '2026-01-01',
    };
    const today = '2026-10-13';
    const [first] = recurringReminders({
      templates: [power],
      expenses: [],
      today,
      leadDays: 3,
    });
    expect(next(today, [], power)).toMatchObject({
      month: first?.month,
      dueDate: first?.dueDate,
      daysLeft: first?.daysLeft,
    });
  });

  it('skips a voided expense’s month, months before the template existed, and has none when paused', () => {
    expect(next('2026-10-12', [made('2026-09'), made('2026-10', 'rent', true)])).toMatchObject({
      month: '2026-10',
    });
    expect(next('2026-10-12', [], { ...rent, since: '2026-10-05' })).toMatchObject({
      month: '2026-11',
    });
    expect(next('2026-10-12', [], { ...rent, active: false })).toBeNull();
  });

  it('a bill created for a month is created once: another template’s expense does not hide it', () => {
    expect(next('2026-10-12', [made('2026-09', 'other'), made('2026-10', 'other')])).toMatchObject({
      month: '2026-09',
    });
  });

  it('has none when the next twelve months are all created', () => {
    const every = Array.from({ length: 14 }, (_, index) => {
      let month = '2026-09';
      for (let step = 0; step < index; step++) month = nextMonth(month);
      return made(month);
    });
    expect(next('2026-10-12', every)).toBeNull();
  });
});

describe('totals (SPEC §5, S6: by paid date)', () => {
  const items = [
    expense({ amountCents: 300_000, paidDate: '2026-10-01' }),
    expense({ category: 'power', amountCents: 45_000, paidDate: '2026-10-20' }),
    expense({ category: 'power', amountCents: 40_000, date: '2026-09-15', paidDate: '2026-10-02' }),
    expense({ amountCents: 300_000, date: '2026-11-01', paidDate: '2026-10-30' }),
    expense({ category: 'water', amountCents: 8000, date: '2026-10-25' }),
    expense({ category: 'water', amountCents: 9000, date: '2026-11-25' }),
    expense({ amountCents: 1, paidDate: '2026-10-03', voided: true }),
  ];

  it('counts what was paid in the month, per category, and what is still unpaid', () => {
    expect(monthlyExpenses(items, '2026-10')).toEqual({
      paidCents: 685_000,
      paidByCategory: { rent: 600_000, power: 85_000 },
      unpaidCents: 8000,
      unpaidCount: 1,
      totalCents: 693_000,
      paidCount: 4,
      entryCount: 5,
    });
    expect(paidExpensesCents(items, '2026-09-01', '2026-09-30')).toBe(0);
  });

  it('the total is what was paid in the month plus what is still unpaid, nothing counted twice (E4)', () => {
    const october = monthlyExpenses(items, '2026-10');
    expect(october.totalCents).toBe(october.paidCents + october.unpaidCents);
    // An unpaid bill of an earlier month is still to pay: it counts in every later month, once.
    const carried = [expense({ category: 'water', amountCents: 7000, date: '2026-08-10' })];
    expect(monthlyExpenses(carried, '2026-10')).toMatchObject({ unpaidCents: 7000, entryCount: 1 });
    expect(monthlyExpenses(carried, '2026-07')).toMatchObject({ unpaidCents: 0, entryCount: 0 });
    // Paid in November: no longer unpaid, and in no month before November's.
    const settled = [{ ...carried[0], paidDate: '2026-11-02' } as ExpenseItem];
    expect(monthlyExpenses(settled, '2026-10').totalCents).toBe(0);
    expect(monthlyExpenses(settled, '2026-11')).toMatchObject({
      paidCents: 7000,
      totalCents: 7000,
    });
  });

  it('says how each expense counts in a month (S6, E4)', () => {
    const month = '2026-10';
    expect(expenseStanding(expense({ paidDate: '2026-10-31' }), month)).toBe('paid');
    expect(expenseStanding(expense({ date: '2026-08-01' }), month)).toBe('unpaid');
    expect(expenseStanding(expense({ date: '2026-10-31' }), month)).toBe('unpaid');
    // Dated in October, paid in November (or October's bill paid in September): counted there.
    expect(expenseStanding(expense({ date: '2026-10-28', paidDate: '2026-11-03' }), month)).toBe(
      'other',
    );
    expect(expenseStanding(expense({ date: '2026-10-02', paidDate: '2026-09-30' }), month)).toBe(
      'other',
    );
    // Not due yet in the month, and voided ones, count nowhere.
    expect(expenseStanding(expense({ date: '2026-11-01' }), month)).toBe('other');
    expect(expenseStanding(expense({ voided: true }), month)).toBe('other');
  });

  it('property: the entries add up to the paid and the unpaid, and the standing agrees with the totals', () => {
    const item = fc.record({
      amountCents: fc.integer({ min: 1, max: 1_000_000 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      paidMonth: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
      voided: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(item, { maxLength: 30 }),
        fc.integer({ min: 1, max: 12 }),
        (specs, m) => {
          const pad = (n: number) => String(n).padStart(2, '0');
          const list = specs.map((spec) =>
            expense({
              amountCents: spec.amountCents,
              date: `2026-${pad(spec.month)}-${pad(spec.day)}`,
              paidDate: spec.paidMonth === null ? null : `2026-${pad(spec.paidMonth)}-15`,
              voided: spec.voided,
            }),
          );
          const month = `2026-${pad(m)}`;
          const totals = monthlyExpenses(list, month);
          const by = (standing: string) =>
            list.filter((entry) => expenseStanding(entry, month) === standing);
          expect(totals.entryCount).toBe(by('paid').length + by('unpaid').length);
          expect(totals.totalCents).toBe(
            by('paid').reduce((sum, entry) => sum + entry.amountCents, 0) +
              by('unpaid').reduce((sum, entry) => sum + entry.amountCents, 0),
          );
          expect(totals.paidCents).toBe(
            by('paid').reduce((sum, entry) => sum + entry.amountCents, 0),
          );
        },
      ),
    );
  });

  it('property: months add up to the whole year', () => {
    const item = fc.record({
      amountCents: fc.integer({ min: 1, max: 1_000_000 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      paid: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(item, { maxLength: 30 }), (specs) => {
        const list = specs.map((spec) => {
          const date = `2026-${String(spec.month).padStart(2, '0')}-${String(spec.day).padStart(2, '0')}`;
          return expense({
            amountCents: spec.amountCents,
            date,
            paidDate: spec.paid ? date : null,
          });
        });
        const months = Array.from(
          { length: 12 },
          (_, index) => `2026-${String(index + 1).padStart(2, '0')}`,
        );
        const sum = months.reduce(
          (total, month) => total + monthlyExpenses(list, month).paidCents,
          0,
        );
        expect(sum).toBe(paidExpensesCents(list, '2026-01-01', '2026-12-31'));
      }),
    );
  });
});
