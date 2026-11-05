import { monthOf, nextMonth } from '@fabric/core';
import type { MonthRow, TemplateView } from '@/local-db';
import { matchesSearch } from '@/shared/lib/search';

/**
 * What the expenses screen shows of a month's expenses, named, filtered and counted. Nothing here
 * adds money up: totals, standing and next due dates come from @fabric/core through the repository.
 */

export type StatusFilter = 'all' | 'paid' | 'unpaid';

/** The status a link asks for (/expenses?status=unpaid); anything else is every expense. */
export function statusFilterOf(value: string | null): StatusFilter {
  return value === 'paid' || value === 'unpaid' ? value : 'all';
}

export interface ExpenseFilters {
  search: string;
  status: StatusFilter;
  /** A category key, or null for every category. */
  category: string | null;
}

/** Paid is a payment date; unpaid is none (S6). */
export const statusOfRow = (row: MonthRow): 'paid' | 'unpaid' =>
  row.expense.paidDate === null ? 'unpaid' : 'paid';

/** Rows matching the search and the category (not the status: the status tabs count these). */
export function searchRows(
  rows: readonly MonthRow[],
  filters: Pick<ExpenseFilters, 'search' | 'category'>,
  categoryLabel: (key: string) => string,
): MonthRow[] {
  return rows.filter(
    ({ expense }) =>
      (filters.category === null || expense.category === filters.category) &&
      matchesSearch(filters.search, [expense.note, categoryLabel(expense.category)]),
  );
}

export function statusCounts(rows: readonly MonthRow[]): Record<StatusFilter, number> {
  const paid = rows.filter((row) => statusOfRow(row) === 'paid').length;
  return { all: rows.length, paid, unpaid: rows.length - paid };
}

export function filterByStatus(rows: readonly MonthRow[], status: StatusFilter): MonthRow[] {
  return status === 'all' ? [...rows] : rows.filter((row) => statusOfRow(row) === status);
}

/**
 * The latest month the page goes to: the month after this one. A bill can be dated ahead (rent
 * for next month), but nothing sensible lies further on.
 */
export const latestMonth = (today: string): string => nextMonth(monthOf(today));

export const canGoForward = (month: string, today: string): boolean => month < latestMonth(today);

export const isThisMonth = (month: string, today: string): boolean => month === monthOf(today);

/** A date a form holds, as long as it is a whole YYYY-MM-DD date. */
export const isFullDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Templates whose next bill is overdue, due today or coming up: what the owner should look at. */
export const dueSoonCount = (bills: readonly TemplateView[]): number =>
  bills.filter((bill) => bill.next !== null && bill.next.status !== 'later').length;
