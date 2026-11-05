import { supplierAccountOf, supplierStatementOf } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import type { SupplierAccountView, SupplierSummary } from '@/local-db';
import {
  activityOf,
  directoryStats,
  filterCounts,
  filterSuppliers,
  isUnpaid,
  payablePurchasesOf,
  paymentRowsOf,
  purchaseRowsOf,
  purchaseStatusOf,
  sortSuppliers,
  statementWindow,
  supplierStatusOf,
} from './supplier-view';

let counter = 0;
const base = (createdAt = '2026-10-01T09:00:00.000Z') => ({
  id: `id-${String(++counter)}`,
  createdAt,
  updatedAt: createdAt,
  deviceId: 'A',
  voidedAt: null,
  serverSeq: null,
});

type Records = Pick<SupplierAccountView, 'purchases' | 'payments'>;
type PurchaseRecord = Records['purchases'][number];
type Payment = Records['payments'][number];

const purchase = (
  fields: { totalCostCents: number; paidCents?: number; date: string },
  names: string[] = ['حرير'],
  at?: string,
): PurchaseRecord => ({
  purchase: {
    ...base(at),
    supplierId: 's1',
    method: 'meter',
    pricePerMeterCents: null,
    weightG: null,
    estCmPerKg: null,
    notes: null,
    paidCents: 0,
    ...fields,
  },
  productNames: names,
  batchCodes: ['A00001'],
});

const payment = (
  fields: { amountCents: number; date: string; purchaseId?: string | null; voidedAt?: string },
  at?: string,
): Payment => ({
  ...base(at),
  supplierId: 's1',
  purchaseId: fields.purchaseId ?? null,
  method: 'cash',
  note: null,
  amountCents: fields.amountCents,
  date: fields.date,
  voidedAt: fields.voidedAt ?? null,
});

const viewOf = (records: Partial<Records>): SupplierAccountView => {
  const full: Records = { purchases: [], payments: [], ...records };
  const counted = {
    purchases: full.purchases.map((row) => row.purchase),
    payments: full.payments,
  };
  return {
    supplier: {
      ...base('2026-09-01T09:00:00.000Z'),
      name: 'مورد الحرير',
      phone: null,
      notes: null,
    },
    account: supplierAccountOf('s1', counted),
    statement: supplierStatementOf('s1', counted),
    lastActivity: null,
    ...full,
  };
};

const summary = (
  name: string,
  figures: { owed?: number; advance?: number; oldest?: string | null },
): SupplierSummary => ({
  supplier: { ...base(), name, phone: null, notes: null },
  account: {
    balanceCents: (figures.owed ?? 0) - (figures.advance ?? 0),
    owedCents: figures.owed ?? 0,
    advanceCents: figures.advance ?? 0,
    purchasesCents: 0,
    paidCents: 0,
    purchases: [],
    allocations: [],
    oldestDueDate: figures.oldest ?? null,
  },
  lastActivity: null,
});

describe('supplierStatusOf', () => {
  it('is owing while the shop owes, advance while it paid beyond that, else settled', () => {
    expect(supplierStatusOf({ owedCents: 100, advanceCents: 0 })).toBe('owing');
    expect(supplierStatusOf({ owedCents: 0, advanceCents: 100 })).toBe('advance');
    expect(supplierStatusOf({ owedCents: 0, advanceCents: 0 })).toBe('settled');
  });
});

describe('the directory', () => {
  const list = [
    summary('أمل', {}),
    summary('بلال', { owed: 5000, oldest: '2026-10-10' }),
    summary('جميلة', { owed: 20_000, oldest: '2026-10-20' }),
    summary('حسن', { advance: 700 }),
    summary('خالد', { owed: 900, oldest: '2026-09-01' }),
  ];
  const names = (rows: readonly SupplierSummary[]) => rows.map((row) => row.supplier.name);

  it('filters to who is owed or not, and counts both (an advance is settled)', () => {
    expect(names(filterSuppliers(list, 'all'))).toHaveLength(5);
    expect(names(filterSuppliers(list, 'owing'))).toEqual(['بلال', 'جميلة', 'خالد']);
    expect(names(filterSuppliers(list, 'settled'))).toEqual(['أمل', 'حسن']);
    expect(filterCounts(list)).toEqual({ all: 5, owing: 3, settled: 2 });
  });

  it('adds up what is owed to those owed, and counts them', () => {
    expect(directoryStats(list)).toEqual({ suppliers: 5, owing: 3, owedCents: 25_900 });
    expect(directoryStats([])).toEqual({ suppliers: 0, owing: 0, owedCents: 0 });
  });

  it('sorts by name, by the largest debt or by the oldest, those owed nothing last', () => {
    expect(names(sortSuppliers(list, 'name'))).toEqual(['أمل', 'بلال', 'جميلة', 'حسن', 'خالد']);
    expect(names(sortSuppliers(list, 'largest'))).toEqual(['جميلة', 'بلال', 'خالد', 'أمل', 'حسن']);
    expect(names(sortSuppliers(list, 'oldest'))).toEqual(['خالد', 'بلال', 'جميلة', 'أمل', 'حسن']);
  });

  it('does not reorder the list it was given', () => {
    const before = names(list);
    sortSuppliers(list, 'largest');
    expect(names(list)).toEqual(before);
  });
});

describe('purchaseStatusOf', () => {
  it('is paid when nothing is due, partly paid when some was settled, else unpaid', () => {
    expect(purchaseStatusOf(undefined)).toBe('paid');
    expect(purchaseStatusOf({ dueCents: 0, settledCents: 1000 })).toBe('paid');
    expect(purchaseStatusOf({ dueCents: 600, settledCents: 400 })).toBe('partlyPaid');
    expect(purchaseStatusOf({ dueCents: 1000, settledCents: 0 })).toBe('unpaid');
  });
});

describe('purchases, payments and activity of one supplier', () => {
  const older = purchase(
    { totalCostCents: 4000, paidCents: 1000, date: '2026-09-01' },
    ['حرير', 'قطن'],
    '2026-09-01T09:00:00.000Z',
  );
  const newer = purchase({ totalCostCents: 1600, date: '2026-10-05' }, ['ساتان']);
  const first = payment({ amountCents: 3000, date: '2026-09-02' });
  const second = payment({ amountCents: 700, date: '2026-10-06', purchaseId: newer.purchase.id });
  const voided = payment({
    amountCents: 300,
    date: '2026-10-07',
    voidedAt: '2026-10-08T10:00:00.000Z',
  });
  // The view has its records newest first, as the repository gives them.
  const view = viewOf({
    purchases: [newer, older],
    payments: [voided, second, first],
  });

  it('lists every purchase, newest first, with what the account says of each', () => {
    const rows = purchaseRowsOf(view);
    expect(rows.map((row) => [row.record.purchase.id, row.status])).toEqual([
      [newer.purchase.id, 'partlyPaid'],
      [older.purchase.id, 'paid'],
    ]);
    expect(rows[0]?.due).toMatchObject({ settledCents: 700, dueCents: 900 });
    expect(rows.filter(isUnpaid).map((row) => row.record.purchase.id)).toEqual([newer.purchase.id]);
  });

  it('offers the purchases with something due, oldest first, with what they were', () => {
    expect(payablePurchasesOf(view)).toEqual([
      { purchaseId: newer.purchase.id, date: '2026-10-05', dueCents: 900, productNames: ['ساتان'] },
    ]);
  });

  it('shows where each payment went, a voided one nowhere', () => {
    const rows = paymentRowsOf(view);
    expect(rows.map((row) => row.payment.id)).toEqual([voided.id, second.id, first.id]);
    expect(rows[0]?.applied).toEqual([]);
    expect(rows[1]?.applied).toEqual([
      { purchaseId: newer.purchase.id, date: '2026-10-05', amountCents: 700 },
    ]);
    // The first, untargeted, paid the older purchase.
    expect(rows[2]?.applied).toEqual([
      { purchaseId: older.purchase.id, date: '2026-09-01', amountCents: 3000 },
    ]);
  });

  it('puts what was paid beyond everything last, as no purchase', () => {
    const only = purchase({ totalCostCents: 1000, date: '2026-10-01' });
    const over = payment({ amountCents: 1300, date: '2026-10-02' });
    const rows = paymentRowsOf(viewOf({ purchases: [only], payments: [over] }));
    expect(rows[0]?.applied).toEqual([
      { purchaseId: only.purchase.id, date: '2026-10-01', amountCents: 1000 },
      { purchaseId: null, date: null, amountCents: 300 },
    ]);
  });

  it('puts every event in order, newest first, with the balance after purchases and payments', () => {
    const events = activityOf(view);
    expect(events.map((event) => [event.kind, event.date])).toEqual([
      ['paymentVoided', '2026-10-08'],
      ['payment', '2026-10-07'],
      ['payment', '2026-10-06'],
      ['purchase', '2026-10-05'],
      ['payment', '2026-09-02'],
      ['purchase', '2026-09-01'],
      ['added', '2026-09-01'],
    ]);
    // 4000 bought, 1000 paid at the till: 3000; 3000 paid: 0; 1600 bought: 1600; 700 paid: 900.
    const balances = events.flatMap((event) =>
      event.kind === 'purchase' || event.kind === 'payment'
        ? [[event.kind, event.balanceCents]]
        : [],
    );
    expect(balances).toEqual([
      ['payment', null], // voided: it is not in the account
      ['payment', 900],
      ['purchase', 1600],
      ['payment', 0],
      ['purchase', 3000],
    ]);
  });
});

describe('activityOf, records of one day', () => {
  it('lists them in the statement’s order, so the top one carries the account’s balance', () => {
    const bought = purchase({ totalCostCents: 1000, date: '2026-10-01' });
    const first = payment({ amountCents: 300, date: '2026-10-01' });
    const second = payment({ amountCents: 600, date: '2026-10-01' });
    const view = viewOf({ purchases: [bought], payments: [second, first] });
    const events = activityOf(view);
    expect(events.map((event) => event.kind)).toEqual(['payment', 'payment', 'purchase', 'added']);
    const balances = events.flatMap((event) =>
      event.kind === 'purchase' || event.kind === 'payment' ? [event.balanceCents] : [],
    );
    // Newest first, each balance reads on from the next one down, the top one is the account's.
    expect(balances[0]).toBe(view.account.balanceCents);
    expect(balances).toEqual([100, 700, 1000]);
  });
});

describe('statementWindow', () => {
  const lines = supplierStatementOf(
    's1',
    (() => {
      const a = purchase({ totalCostCents: 1000, paidCents: 200, date: '2026-10-01' });
      const b = purchase({ totalCostCents: 500, date: '2026-10-05' });
      const p = payment({ amountCents: 300, date: '2026-10-10' });
      return { purchases: [a.purchase, b.purchase], payments: [p] };
    })(),
  );

  it('leads from the balance before the latest lines to the balance after them', () => {
    const all = statementWindow(lines, 10);
    expect(all.openingCents).toBe(0);
    expect(all.lines).toHaveLength(4);
    expect(all.closingCents).toBe(lines.at(-1)?.balanceCents);

    const last = statementWindow(lines, 2);
    expect(last.lines).toHaveLength(2);
    expect(last.openingCents).toBe(lines[1]?.balanceCents);
    expect(last.closingCents).toBe(all.closingCents);
    // Opening + what the lines add is the closing balance.
    expect(last.lines.reduce((sum, line) => sum + line.deltaCents, last.openingCents)).toBe(
      last.closingCents,
    );
  });

  it('is nothing at 0 for an account with no records', () => {
    expect(statementWindow([], 5)).toEqual({ openingCents: 0, lines: [], closingCents: 0 });
  });

  it('closes on the authoritative balance of the account', () => {
    const records = {
      purchases: [purchase({ totalCostCents: 1000, paidCents: 200, date: '2026-10-01' }).purchase],
      payments: [payment({ amountCents: 300, date: '2026-10-10' })],
    };
    const window = statementWindow(supplierStatementOf('s1', records), 5);
    expect(window.closingCents).toBe(supplierAccountOf('s1', records).balanceCents);
  });
});
