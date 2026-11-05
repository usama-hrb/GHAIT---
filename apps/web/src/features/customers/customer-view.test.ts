import { customerAccountOf } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import type { CustomerAccountView, CustomerSummary } from '@/local-db';
import {
  accountStatusOf,
  activityOf,
  directoryStats,
  filterCounts,
  filterCustomers,
  invoiceRowsOf,
  invoiceStatusOf,
  isUnpaid,
  paymentRowsOf,
  sortCustomers,
} from './customer-view';

const TODAY = '2026-10-30';
let counter = 0;
const base = (createdAt = '2026-10-01T09:00:00.000Z') => ({
  id: `id-${String(++counter)}`,
  createdAt,
  updatedAt: createdAt,
  deviceId: 'A',
  voidedAt: null,
  serverSeq: null,
});

type Records = Pick<
  CustomerAccountView,
  'sales' | 'payments' | 'allocations' | 'writeOffs' | 'returns'
>;

const sale = (
  fields: { totalCents: number; date: string; dueDate?: string | null; voidedAt?: string | null },
  at?: string,
): Records['sales'][number] => ({
  ...base(at),
  customerId: 'c1',
  discountCents: 0,
  confirmedBelowCost: false,
  note: null,
  dueDate: null,
  ...fields,
  voidedAt: fields.voidedAt ?? null,
});

const payment = (
  fields: { amountCents: number; date: string; kind?: 'payment' | 'refund' },
  at?: string,
): Records['payments'][number] => ({
  ...base(at),
  customerId: 'c1',
  kind: fields.kind ?? 'payment',
  method: 'cash',
  note: null,
  amountCents: fields.amountCents,
  date: fields.date,
});

const viewOf = (records: Partial<Records>): CustomerAccountView => {
  const full: Records = {
    sales: [],
    payments: [],
    allocations: [],
    writeOffs: [],
    returns: [],
    ...records,
  };
  return {
    customer: {
      ...base(),
      name: 'خديجة',
      phone: '0611223344',
      notes: null,
    },
    account: customerAccountOf(full, TODAY),
    ...full,
  };
};

const summary = (
  name: string,
  figures: { owed?: number; credit?: number; oldest?: string | null },
): CustomerSummary => ({
  customer: { ...base(), name, phone: '', notes: null },
  account: {
    balanceCents: (figures.owed ?? 0) - (figures.credit ?? 0),
    purchasesCents: 0,
    receivedCents: 0,
    refundedCents: 0,
    collectibleCents: figures.owed ?? 0,
    writtenOffCents: 0,
    creditCents: figures.credit ?? 0,
    overdueCents: 0,
    invoices: [],
    openInvoices: [],
    oldestOpenDate: figures.oldest ?? null,
  },
  lastActivity: null,
});

describe('accountStatusOf', () => {
  it('owes while something can be collected, is in credit while the shop holds money, else settled', () => {
    expect(accountStatusOf(summary('a', { owed: 100 }).account)).toBe('owing');
    expect(accountStatusOf(summary('b', { credit: 100 }).account)).toBe('credit');
    expect(accountStatusOf(summary('c', {}).account)).toBe('settled');
  });

  it('does not call a written-off debt owing (it is no longer expected)', () => {
    const only = sale({ totalCents: 1000, date: '2026-10-01' });
    const account = customerAccountOf(
      {
        sales: [only],
        payments: [],
        allocations: [],
        returns: [],
        writeOffs: [{ ...base(), saleId: only.id, date: TODAY, reason: 'x' }],
      },
      TODAY,
    );
    expect(account.balanceCents).toBe(1000);
    expect(accountStatusOf(account)).toBe('settled');
  });
});

describe('the directory', () => {
  const list = [
    summary('أمل', {}),
    summary('بلال', { owed: 5000, oldest: '2026-10-10' }),
    summary('جميلة', { owed: 20_000, oldest: '2026-10-20' }),
    summary('حسن', { credit: 700 }),
    summary('خالد', { owed: 900, oldest: '2026-09-01' }),
  ];
  const names = (rows: readonly CustomerSummary[]) => rows.map((row) => row.customer.name);

  it('filters to who owes or who does not, and counts both', () => {
    expect(names(filterCustomers(list, 'all'))).toHaveLength(5);
    expect(names(filterCustomers(list, 'owing'))).toEqual(['بلال', 'جميلة', 'خالد']);
    expect(names(filterCustomers(list, 'settled'))).toEqual(['أمل', 'حسن']);
    expect(filterCounts(list)).toEqual({ all: 5, owing: 3, settled: 2 });
  });

  it('adds up what the customers who owe owe, and counts them', () => {
    expect(directoryStats(list)).toEqual({ customers: 5, owing: 3, owedCents: 25_900 });
    expect(directoryStats([])).toEqual({ customers: 0, owing: 0, owedCents: 0 });
  });

  it('sorts by name, by the largest debt or by the oldest, those who owe nothing last', () => {
    expect(names(sortCustomers(list, 'name'))).toEqual(['أمل', 'بلال', 'جميلة', 'حسن', 'خالد']);
    expect(names(sortCustomers(list, 'largest'))).toEqual(['جميلة', 'بلال', 'خالد', 'أمل', 'حسن']);
    expect(names(sortCustomers(list, 'oldest'))).toEqual(['خالد', 'بلال', 'جميلة', 'أمل', 'حسن']);
  });

  it('does not reorder the list it was given', () => {
    const before = names(list);
    sortCustomers(list, 'largest');
    expect(names(list)).toEqual(before);
  });
});

describe('invoiceStatusOf', () => {
  const invoice = (over: Partial<Parameters<typeof invoiceStatusOf>[0] & object> = {}) => ({
    saleId: 's',
    date: '2026-10-01',
    dueDate: null,
    totalCents: 1000,
    returnedCents: 0,
    paidCents: 0,
    dueCents: 1000,
    writtenOff: false,
    overdue: false,
    ...over,
  });

  it('reads the invoice the way the account does', () => {
    expect(invoiceStatusOf(invoice(), true)).toBe('voided');
    expect(invoiceStatusOf(undefined, false)).toBe('paid');
    expect(invoiceStatusOf(invoice({ paidCents: 1000, dueCents: 0 }), false)).toBe('paid');
    expect(invoiceStatusOf(invoice(), false)).toBe('unpaid');
    expect(invoiceStatusOf(invoice({ paidCents: 400, dueCents: 600 }), false)).toBe('partlyPaid');
    expect(invoiceStatusOf(invoice({ overdue: true }), false)).toBe('overdue');
    expect(invoiceStatusOf(invoice({ writtenOff: true, overdue: true }), false)).toBe('writtenOff');
  });

  it('calls a written-off invoice that was paid later paid', () => {
    expect(
      invoiceStatusOf(invoice({ writtenOff: true, paidCents: 1000, dueCents: 0 }), false),
    ).toBe('paid');
  });
});

describe('invoices and payments of one customer', () => {
  const older = sale({ totalCents: 4000, date: '2026-09-01' }, '2026-09-01T09:00:00.000Z');
  const newer = sale({ totalCents: 1600, date: '2026-10-05', dueDate: '2026-10-20' });
  const voided = sale({
    totalCents: 900,
    date: '2026-10-07',
    voidedAt: '2026-10-08T10:00:00.000Z',
  });
  const first = payment({ amountCents: 2000, date: '2026-09-02' });
  const second = payment({ amountCents: 700, date: '2026-10-06' });
  const allocation = (paymentId: string, saleId: string, amountCents: number, date: string) => ({
    ...base(),
    paymentId,
    saleId,
    amountCents,
    date,
  });
  // The view has its records newest first, as the repository gives them.
  const view = viewOf({
    sales: [voided, newer, older],
    payments: [second, first],
    allocations: [
      allocation(first.id, older.id, 2000, '2026-09-02'),
      allocation(second.id, older.id, 700, '2026-10-06'),
    ],
  });

  it('lists every invoice, newest first, with what the account says of each', () => {
    const rows = invoiceRowsOf(view);
    expect(rows.map((row) => [row.sale.id, row.status])).toEqual([
      [voided.id, 'voided'],
      [newer.id, 'overdue'],
      [older.id, 'partlyPaid'],
    ]);
    expect(rows[2]?.invoice).toMatchObject({ paidCents: 2700, dueCents: 1300 });
    expect(rows[0]?.invoice).toBeUndefined();
    expect(rows.filter(isUnpaid).map((row) => row.sale.id)).toEqual([newer.id, older.id]);
  });

  it('shows where each payment went, the oldest invoice first', () => {
    const rows = paymentRowsOf(view);
    expect(rows.map((row) => row.payment.id)).toEqual([second.id, first.id]);
    expect(rows[1]?.applied).toEqual([{ saleId: older.id, date: '2026-09-01', amountCents: 2000 }]);
    expect(rows[0]?.applied.map((part) => part.amountCents)).toEqual([700]);
  });

  it('has nothing applied to a refund', () => {
    const refund = payment({ amountCents: 300, date: '2026-10-09', kind: 'refund' });
    expect(paymentRowsOf(viewOf({ payments: [refund] }))[0]?.applied).toEqual([]);
  });
});

describe('activityOf', () => {
  it('puts every kind of event in order, newest first, a voided sale as a purchase and a void', () => {
    const bought = sale({ totalCents: 4000, date: '2026-10-01' });
    const gone = sale({
      totalCents: 900,
      date: '2026-10-02',
      voidedAt: '2026-10-04T10:00:00.000Z',
    });
    const paid = payment({ amountCents: 1000, date: '2026-10-03' });
    const refund = payment({ amountCents: 100, date: '2026-10-06', kind: 'refund' });
    const back = {
      ...base('2026-10-05T09:00:00.000Z'),
      saleId: bought.id,
      date: '2026-10-05',
      reason: 'x',
      lines: [],
      creditCents: 500,
      refundId: null,
    } as unknown as Records['returns'][number];
    const bad = {
      ...base('2026-10-07T09:00:00.000Z'),
      saleId: bought.id,
      date: '2026-10-07',
      reason: 'سافر',
    };
    const events = activityOf(
      viewOf({
        sales: [gone, bought],
        payments: [refund, paid],
        returns: [back],
        writeOffs: [bad],
      }),
    );
    expect(events.map((event) => [event.kind, event.date])).toEqual([
      ['writeOff', '2026-10-07'],
      ['refund', '2026-10-06'],
      ['return', '2026-10-05'],
      ['voided', '2026-10-04'],
      ['payment', '2026-10-03'],
      ['purchase', '2026-10-02'],
      ['purchase', '2026-10-01'],
    ]);
    expect(events[0]).toMatchObject({ reason: 'سافر', saleId: bought.id });
    expect(events[2]).toMatchObject({ amountCents: 500 });
  });

  it('orders the events of one day by when they were recorded', () => {
    const early = sale({ totalCents: 100, date: '2026-10-01' }, '2026-10-01T08:00:00.000Z');
    const late = payment({ amountCents: 100, date: '2026-10-01' }, '2026-10-01T16:00:00.000Z');
    expect(activityOf(viewOf({ sales: [early], payments: [late] })).map((e) => e.kind)).toEqual([
      'payment',
      'purchase',
    ]);
  });

  it('leaves out a return that was voided and has nothing for an empty account', () => {
    const dead = {
      ...base(),
      voidedAt: '2026-10-08T10:00:00.000Z',
      saleId: 'x',
      date: '2026-10-05',
      reason: 'x',
      lines: [],
      creditCents: 5,
      refundId: null,
    } as unknown as Records['returns'][number];
    expect(activityOf(viewOf({ returns: [dead] }))).toEqual([]);
  });
});
