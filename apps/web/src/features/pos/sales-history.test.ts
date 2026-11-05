import { describe, expect, it } from 'vitest';
import type { SaleSummary } from '@/local-db';
import {
  activeFilters,
  countByPayment,
  DEFAULT_FILTER,
  filterSales,
  type HistoryFilter,
  pageOf,
  rangeOf,
  statusOf,
  summaryOf,
} from './sales-history';

const TODAY = '2026-10-30';
let counter = 0;

/** A row as the repository gives it: only the fields the history reads. */
function row(fields: {
  date?: string;
  customer?: string | null;
  net: number;
  paid: number;
  voided?: boolean;
  writtenOff?: boolean;
  note?: string | null;
  id?: string;
}): SaleSummary {
  counter += 1;
  return {
    sale: {
      id: fields.id ?? `0000${String(counter).padStart(4, '0')}-aaaa-bbbb-cccc-000000000000`,
      date: fields.date ?? TODAY,
      customerId: fields.customer ? 'c' : null,
      note: fields.note ?? null,
      voidedAt: fields.voided ? '2026-10-30T10:00:00.000Z' : null,
    } as SaleSummary['sale'],
    customerName: fields.customer ?? null,
    lineCount: 1,
    netTotalCents: fields.net,
    paidCents: fields.voided ? 0 : fields.paid,
    dueCents: fields.voided ? 0 : fields.net - fields.paid,
    writtenOff: fields.writtenOff ?? false,
    overdue: false,
  };
}

const filter = (changes: Partial<HistoryFilter>): HistoryFilter => ({
  ...DEFAULT_FILTER,
  ...changes,
});

describe('rangeOf: the days a period covers', () => {
  it('today is one day', () => {
    expect(rangeOf('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('7 and 30 days count today as the last day', () => {
    expect(rangeOf('days7', TODAY)).toEqual({ from: '2026-10-24', to: TODAY });
    expect(rangeOf('days30', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
  });

  it('this month starts on the 1st, also across a year end and on the 1st itself', () => {
    expect(rangeOf('thisMonth', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(rangeOf('thisMonth', '2027-01-01')).toEqual({ from: '2027-01-01', to: '2027-01-01' });
  });

  it('30 days reaches back across a month and a year', () => {
    expect(rangeOf('days30', '2027-01-10')).toEqual({ from: '2026-12-12', to: '2027-01-10' });
  });

  it('all time has no limit; a custom range is as given, open ends allowed', () => {
    expect(rangeOf('all', TODAY)).toEqual({ from: '', to: '' });
    expect(rangeOf('custom', TODAY, { from: '2026-09-01', to: '' })).toEqual({
      from: '2026-09-01',
      to: '',
    });
  });

  it('reads a custom range given the wrong way round the right way round', () => {
    expect(rangeOf('custom', TODAY, { from: '2026-10-20', to: '2026-10-10' })).toEqual({
      from: '2026-10-10',
      to: '2026-10-20',
    });
  });
});

describe('statusOf: paid, partly paid, unpaid or voided', () => {
  it('reads it from the invoice’s own paid and due', () => {
    expect(statusOf(row({ net: 1000, paid: 1000 }))).toBe('paid');
    expect(statusOf(row({ net: 1000, paid: 400 }))).toBe('partial');
    expect(statusOf(row({ net: 1000, paid: 0 }))).toBe('unpaid');
    expect(statusOf(row({ net: 0, paid: 0 }))).toBe('paid');
  });

  it('a voided sale is voided, whatever it was paid', () => {
    expect(statusOf(row({ net: 1000, paid: 1000, voided: true }))).toBe('voided');
  });
});

describe('filterSales', () => {
  const rows = [
    row({ date: '2026-10-30', customer: 'فاطمة', net: 1000, paid: 1000 }),
    row({ date: '2026-10-30', customer: 'أحمد', net: 2000, paid: 500 }),
    row({ date: '2026-10-29', customer: 'فاطمة', net: 3000, paid: 0, note: 'for the wedding' }),
    row({ date: '2026-10-01', net: 400, paid: 400 }),
    row({ date: '2026-09-30', customer: 'أحمد', net: 700, paid: 700 }),
    row({ date: '2026-10-30', customer: 'فاطمة', net: 900, paid: 900, voided: true }),
  ];
  const nets = (list: readonly SaleSummary[]) => list.map((entry) => entry.netTotalCents);

  it('the default view is the last 30 days: the day 29 days back is in, the day before is out', () => {
    expect(nets(filterSales(rows, DEFAULT_FILTER, TODAY))).toEqual([1000, 2000, 3000, 400, 900]);
  });

  it('a period is inclusive at both ends', () => {
    const edge = [
      row({ date: '2026-10-01', net: 1, paid: 1 }),
      row({ date: '2026-09-30', net: 2, paid: 2 }),
    ];
    expect(nets(filterSales(edge, filter({ period: 'days30' }), TODAY))).toEqual([1]);
    expect(
      nets(
        filterSales(
          edge,
          filter({ period: 'custom', from: '2026-09-30', to: '2026-09-30' }),
          TODAY,
        ),
      ),
    ).toEqual([2]);
  });

  it('all time shows everything, voided sales included', () => {
    expect(filterSales(rows, filter({ period: 'all' }), TODAY)).toHaveLength(6);
  });

  it('today shows only today’s', () => {
    expect(nets(filterSales(rows, filter({ period: 'today' }), TODAY))).toEqual([1000, 2000, 900]);
  });

  it('an open-ended custom range limits one side only', () => {
    expect(
      nets(filterSales(rows, filter({ period: 'custom', from: '2026-10-29' }), TODAY)),
    ).toEqual([1000, 2000, 3000, 900]);
    expect(nets(filterSales(rows, filter({ period: 'custom', to: '2026-10-01' }), TODAY))).toEqual([
      400, 700,
    ]);
  });

  it('searches the customer’s name, Arabic letter variants and diacritics ignored', () => {
    expect(nets(filterSales(rows, filter({ period: 'all', search: 'فاطمه' }), TODAY))).toEqual([
      1000, 3000, 900,
    ]);
    expect(nets(filterSales(rows, filter({ period: 'all', search: ' أحمد ' }), TODAY))).toEqual([
      2000, 700,
    ]);
  });

  it('searches the sale’s note', () => {
    expect(nets(filterSales(rows, filter({ period: 'all', search: 'wedding' }), TODAY))).toEqual([
      3000,
    ]);
  });

  it('reads a long hex search as the start of a sale id; a short one never is', () => {
    const [first] = rows;
    const id = first?.sale.id ?? '';
    expect(filterSales(rows, filter({ period: 'all', search: id.slice(0, 8) }), TODAY)).toEqual([
      first,
    ]);
    expect(filterSales(rows, filter({ period: 'all', search: 'a' }), TODAY)).toEqual([]);
  });

  it('payment filters: paid, partly paid, unpaid; a voided sale is in all only', () => {
    expect(nets(filterSales(rows, filter({ payment: 'paid' }), TODAY))).toEqual([1000, 400]);
    expect(nets(filterSales(rows, filter({ payment: 'partial' }), TODAY))).toEqual([2000]);
    expect(nets(filterSales(rows, filter({ payment: 'unpaid' }), TODAY))).toEqual([3000]);
    expect(nets(filterSales(rows, filter({ payment: 'all' }), TODAY))).toContain(900);
  });

  it('the filters work together', () => {
    expect(
      nets(filterSales(rows, filter({ period: 'all', search: 'فاطمة', payment: 'unpaid' }), TODAY)),
    ).toEqual([3000]);
    expect(
      nets(
        filterSales(rows, filter({ period: 'today', search: 'فاطمة', payment: 'unpaid' }), TODAY),
      ),
    ).toEqual([]);
  });

  it('counts each payment chip under the period and the search, not under the payment filter', () => {
    expect(countByPayment(rows, filter({ payment: 'unpaid' }), TODAY)).toEqual({
      all: 5,
      paid: 2,
      partial: 1,
      unpaid: 1,
    });
    expect(countByPayment(rows, filter({ search: 'أحمد' }), TODAY)).toEqual({
      all: 1,
      paid: 0,
      partial: 1,
      unpaid: 0,
    });
  });

  it('the chip counts add up to all, less the voided sales', () => {
    const counts = countByPayment(rows, DEFAULT_FILTER, TODAY);
    expect(counts.paid + counts.partial + counts.unpaid).toBe(counts.all - 1);
  });
});

describe('activeFilters: what narrows the list beyond the default view', () => {
  it('none for the default view', () => {
    expect(activeFilters(DEFAULT_FILTER)).toEqual([]);
  });

  it('names each change, a blank search not among them', () => {
    expect(activeFilters(filter({ period: 'today', search: ' ', payment: 'paid' }))).toEqual([
      'period',
      'payment',
    ]);
    expect(activeFilters(filter({ search: 'x' }))).toEqual(['search']);
  });
});

describe('summaryOf: the figures of the rows shown', () => {
  it('adds each invoice once: count, total, collected, outstanding', () => {
    const rows = [
      row({ net: 1000, paid: 1000 }),
      row({ customer: 'a', net: 2000, paid: 500 }),
      row({ customer: 'b', net: 3000, paid: 0 }),
    ];
    expect(summaryOf(rows)).toEqual({
      count: 3,
      voidedCount: 0,
      totalCents: 6000,
      paidCents: 1500,
      outstandingCents: 4500,
      writtenOffCents: 0,
    });
  });

  it('leaves voided sales out and a written-off debt out of what is outstanding', () => {
    const rows = [
      row({ customer: 'a', net: 1000, paid: 200 }),
      row({ customer: 'b', net: 5000, paid: 0, voided: true }),
      row({ customer: 'c', net: 2000, paid: 500, writtenOff: true }),
    ];
    expect(summaryOf(rows)).toEqual({
      count: 2,
      voidedCount: 1,
      totalCents: 3000,
      paidCents: 700,
      outstandingCents: 800,
      writtenOffCents: 1500,
    });
  });

  it('the rows of a filter sum to the rows of its parts: no sale is counted twice', () => {
    const rows = [
      row({ customer: 'a', net: 1000, paid: 1000 }),
      row({ customer: 'b', net: 2000, paid: 500 }),
      row({ customer: 'c', net: 3000, paid: 0 }),
    ];
    const parts = (['paid', 'partial', 'unpaid'] as const).map((payment) =>
      summaryOf(filterSales(rows, filter({ payment }), TODAY)),
    );
    const whole = summaryOf(filterSales(rows, DEFAULT_FILTER, TODAY));
    expect(parts.reduce((sum, part) => sum + part.totalCents, 0)).toBe(whole.totalCents);
    expect(parts.reduce((sum, part) => sum + part.paidCents, 0)).toBe(whole.paidCents);
    expect(parts.reduce((sum, part) => sum + part.outstandingCents, 0)).toBe(
      whole.outstandingCents,
    );
  });
});

describe('pageOf', () => {
  const items = Array.from({ length: 60 }, (_, index) => index);

  it('cuts pages of 25 and says where it is', () => {
    expect(pageOf(items, 0)).toMatchObject({ pages: 3, first: 1, last: 25, total: 60 });
    expect(pageOf(items, 2)).toMatchObject({ page: 2, first: 51, last: 60 });
    expect(pageOf(items, 2).items).toHaveLength(10);
  });

  it('holds a page that is gone (after a filter) inside the pages there are', () => {
    expect(pageOf(items.slice(0, 10), 5)).toMatchObject({ page: 0, pages: 1, first: 1, last: 10 });
    expect(pageOf(items, -3).page).toBe(0);
  });

  it('is one empty page for nothing', () => {
    expect(pageOf([], 0)).toMatchObject({ pages: 1, first: 0, last: 0, total: 0, items: [] });
  });
});
