import { type PaymentState, paymentState, type SalesLedger, salesLedger } from '@fabric/core';
import type { SaleSummary } from '@/local-db';
import { addDays } from '@/shared/lib/dates';
import { matchesSearch } from '@/shared/lib/search';

/**
 * What the sales history screen shows, made from the figures each row already carries (the
 * customer account's, see `SalesRepository.list`): rows are narrowed, counted, paged and named
 * here; the money is added by `@fabric/core` `salesLedger`, never by this file.
 */

// ---------------------------------------------------------------------------------------------
// The period

export type PeriodPreset = 'today' | 'days7' | 'days30' | 'thisMonth' | 'all' | 'custom';

/** Shop days (YYYY-MM-DD), both ends included; an empty end is no limit. */
export interface DateRange {
  from: string;
  to: string;
}

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  'today',
  'days7',
  'days30',
  'thisMonth',
  'all',
  'custom',
];

/**
 * The days a period covers. A sale belongs to the shop day saved on it (`sale.date`), so a range
 * is compared as plain dates and no time zone is involved. `today` is the shop's date. A custom
 * range given the wrong way round is read the right way round.
 */
export function rangeOf(
  period: PeriodPreset,
  today: string,
  custom: DateRange = { from: '', to: '' },
): DateRange {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'days7':
      return { from: addDays(today, -6), to: today };
    case 'days30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'all':
      return { from: '', to: '' };
    case 'custom':
      return custom.from !== '' && custom.to !== '' && custom.from > custom.to
        ? { from: custom.to, to: custom.from }
        : { ...custom };
  }
}

// ---------------------------------------------------------------------------------------------
// The filter

export type PaymentFilter = 'all' | PaymentState;
export const PAYMENT_FILTERS: readonly PaymentFilter[] = ['all', 'paid', 'partial', 'unpaid'];

export interface HistoryFilter {
  period: PeriodPreset;
  /** The days of a custom period (`period` is `custom`). */
  from: string;
  to: string;
  search: string;
  payment: PaymentFilter;
}

export const DEFAULT_FILTER: HistoryFilter = {
  period: 'days30',
  from: '',
  to: '',
  search: '',
  payment: 'all',
};

export type ActiveFilter = 'period' | 'search' | 'payment';

/** What is narrowing the list beyond the default view, in the order the bar shows it. */
export function activeFilters(filter: HistoryFilter): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filter.period !== DEFAULT_FILTER.period) active.push('period');
  if (filter.search.trim() !== '') active.push('search');
  if (filter.payment !== 'all') active.push('payment');
  return active;
}

/** The status a row shows: its payment state, or voided (out of the account). */
export type RowStatus = PaymentState | 'voided';

export function statusOf(row: SaleSummary): RowStatus {
  if (row.sale.voidedAt !== null) return 'voided';
  return paymentState({ paidCents: row.paidCents, dueCents: row.dueCents });
}

const ID_FRAGMENT = /^[0-9a-f-]{6,}$/i;

/**
 * A sale has no number of its own, only its id. A search is read as part of an id only when it
 * looks like one (six or more hex digits and dashes), so a short word never matches by chance.
 */
function matchesQuery(row: SaleSummary, query: string): boolean {
  const text = query.trim();
  if (text === '') return true;
  if (ID_FRAGMENT.test(text) && row.sale.id.toLowerCase().startsWith(text.toLowerCase())) {
    return true;
  }
  return matchesSearch(text, [row.customerName, row.sale.note]);
}

const inRange = (row: SaleSummary, range: DateRange): boolean =>
  (range.from === '' || row.sale.date >= range.from) &&
  (range.to === '' || row.sale.date <= range.to);

const matchesPayment = (row: SaleSummary, payment: PaymentFilter): boolean =>
  payment === 'all' || statusOf(row) === payment;

/** The period and the search only: the rows the payment chips count over. */
function withinPeriodAndSearch(
  rows: readonly SaleSummary[],
  filter: HistoryFilter,
  today: string,
): SaleSummary[] {
  const range = rangeOf(filter.period, today, { from: filter.from, to: filter.to });
  return rows.filter((row) => inRange(row, range) && matchesQuery(row, filter.search));
}

/** The rows that pass every part of the filter, in the order they came (newest first). */
export function filterSales(
  rows: readonly SaleSummary[],
  filter: HistoryFilter,
  today: string,
): SaleSummary[] {
  return withinPeriodAndSearch(rows, filter, today).filter((row) =>
    matchesPayment(row, filter.payment),
  );
}

/**
 * How many sales each payment chip would show under the period and the search: the number on a
 * chip is what picking it gives. A voided sale is in `all` only.
 */
export function countByPayment(
  rows: readonly SaleSummary[],
  filter: HistoryFilter,
  today: string,
): Record<PaymentFilter, number> {
  const counts: Record<PaymentFilter, number> = { all: 0, paid: 0, partial: 0, unpaid: 0 };
  for (const row of withinPeriodAndSearch(rows, filter, today)) {
    counts.all += 1;
    const status = statusOf(row);
    if (status !== 'voided') counts[status] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// The figures

/** The sales shown, added up by `@fabric/core` from each invoice's own paid and due. */
export function summaryOf(rows: readonly SaleSummary[]): SalesLedger {
  return salesLedger(
    rows.map((row) => ({
      netTotalCents: row.netTotalCents,
      paidCents: row.paidCents,
      dueCents: row.dueCents,
      voided: row.sale.voidedAt !== null,
      writtenOff: row.writtenOff,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// The pages

export const PAGE_SIZE = 25;

export interface Page<T> {
  items: T[];
  /** 0-based, held inside the pages there are. */
  page: number;
  pages: number;
  /** The 1-based position of the first and last item shown (0 and 0 when there are none). */
  first: number;
  last: number;
  total: number;
}

export function pageOf<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, Math.trunc(page)), pages - 1);
  const slice = items.slice(at * size, (at + 1) * size);
  return {
    items: slice,
    page: at,
    pages,
    first: slice.length === 0 ? 0 : at * size + 1,
    last: at * size + slice.length,
    total: items.length,
  };
}
