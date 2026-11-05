import type { Expense } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import type { MonthRow, TemplateView } from '@/local-db';
import {
  canGoForward,
  dueSoonCount,
  filterByStatus,
  isFullDate,
  isThisMonth,
  latestMonth,
  searchRows,
  statusCounts,
  statusFilterOf,
} from './expense-view';

const row = (
  category: string,
  note: string | null,
  paidDate: string | null,
  id = `${category}-${String(note)}`,
): MonthRow => ({
  expense: {
    id,
    date: '2026-10-05',
    category,
    amountCents: 10_000,
    paidDate,
    note,
  } as unknown as MonthRow['expense'] & Expense,
  standing: paidDate === null ? 'unpaid' : 'paid',
  carriedOver: false,
  countsIn: null,
  employeeName: null,
});

const label = (key: string) => ({ rent: 'كراء', water: 'ماء' })[key] ?? key;
const rows = [
  row('rent', 'كراء المحل', '2026-10-01'),
  row('water', 'فاتورة الماء', null),
  row('water', null, '2026-10-09', 'water-2'),
];

describe('expense rows, filtered and counted', () => {
  it('searches the note and the category name, ignoring the way a word is spelled', () => {
    const found = (search: string, category: string | null = null) =>
      searchRows(rows, { search, category }, label).map((entry) => entry.expense.id);
    expect(found('')).toHaveLength(3);
    expect(found('ماء')).toEqual(['water-فاتورة الماء', 'water-2']);
    expect(found('المحل')).toEqual(['rent-كراء المحل']);
    expect(found('اجار')).toEqual([]);
    expect(found('', 'water')).toEqual(['water-فاتورة الماء', 'water-2']);
    expect(found('كراء', 'water')).toEqual([]);
  });

  it('counts and filters by payment status, a payment date meaning paid', () => {
    expect(statusCounts(rows)).toEqual({ all: 3, paid: 2, unpaid: 1 });
    expect(filterByStatus(rows, 'paid')).toHaveLength(2);
    expect(filterByStatus(rows, 'unpaid').map((entry) => entry.expense.category)).toEqual([
      'water',
    ]);
    expect(filterByStatus(rows, 'all')).toEqual(rows);
  });
});

describe('month navigation', () => {
  it('goes back freely and forward to the month after this one, no further', () => {
    const today = '2026-10-12';
    expect(latestMonth(today)).toBe('2026-11');
    expect(canGoForward('2026-09', today)).toBe(true);
    expect(canGoForward('2026-10', today)).toBe(true);
    expect(canGoForward('2026-11', today)).toBe(false);
    expect(canGoForward('2027-01', today)).toBe(false);
    expect(latestMonth('2026-12-31')).toBe('2027-01');
  });

  it('knows this month, and a whole date', () => {
    expect(isThisMonth('2026-10', '2026-10-31')).toBe(true);
    expect(isThisMonth('2026-09', '2026-10-31')).toBe(false);
    expect(isFullDate('2026-10-05')).toBe(true);
    expect(isFullDate('2026-10-')).toBe(false);
    expect(isFullDate('')).toBe(false);
  });
});

describe('templates to look at', () => {
  const bill = (status: NonNullable<TemplateView['next']>['status'] | null): TemplateView =>
    ({
      template: {},
      next:
        status === null ? null : { month: '2026-10', dueDate: '2026-10-05', status, daysLeft: 1 },
    }) as unknown as TemplateView;

  it('counts the overdue, due and upcoming ones, not the later ones or the paused', () => {
    expect(dueSoonCount([])).toBe(0);
    expect(
      dueSoonCount([bill('overdue'), bill('due'), bill('upcoming'), bill('later'), bill(null)]),
    ).toBe(3);
  });
});

describe('the status a link asks for', () => {
  it('opens the unpaid or the paid expenses, and every expense for anything else', () => {
    expect(statusFilterOf('unpaid')).toBe('unpaid');
    expect(statusFilterOf('paid')).toBe('paid');
    expect(statusFilterOf('all')).toBe('all');
    expect(statusFilterOf(null)).toBe('all');
    expect(statusFilterOf('overdue')).toBe('all');
  });
});
