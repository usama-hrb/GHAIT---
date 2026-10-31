import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dayAfter,
  dueDateIn,
  type ExpenseItem,
  monthBounds,
  monthlyExpenses,
  monthOf,
  nextMonth,
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
    });
    expect(paidExpensesCents(items, '2026-09-01', '2026-09-30')).toBe(0);
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
