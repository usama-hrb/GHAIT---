import { describe, expect, it } from 'vitest';
import {
  buildCreditApplication,
  buildPayment,
  buildRefund,
  buildWriteOff,
  checkAllocations,
  checkPaymentAggregate,
  checkWriteOff,
  type CustomerRecords,
  customerAccountOf,
  newPaymentSchema,
  newRefundSchema,
  type Payment,
  type PaymentAllocation,
  RECEIVABLE_ISSUES,
  type Sale,
} from './index.js';

const TODAY = '2026-10-30';
let clock = Date.UTC(2026, 9, 30, 9, 0);
const now = () => new Date((clock += 60_000)).toISOString();
const base = () => {
  const at = now();
  return { createdAt: at, updatedAt: at, deviceId: 'desk', voidedAt: null };
};
const meta = () => ({ deviceId: 'desk', now: now() });
const newId = () => crypto.randomUUID();
const customerId = crypto.randomUUID();

const sale = (totalCents: number, date: string, overrides: Partial<Sale> = {}): Sale => ({
  ...base(),
  id: crypto.randomUUID(),
  date,
  customerId,
  totalCents,
  discountCents: 0,
  dueDate: null,
  confirmedBelowCost: false,
  note: null,
  ...overrides,
});

const empty = (sales: Sale[]): CustomerRecords => ({
  sales,
  payments: [],
  allocations: [],
  writeOffs: [],
});

/** Records the payment as the device would, and returns the records with it. */
function pay(records: CustomerRecords, amountCents: number, targetSaleId: string | null = null) {
  const built = buildPayment(
    newPaymentSchema.parse({ customerId, amountCents, date: TODAY, targetSaleId }),
    records,
    { paymentId: newId(), newId },
    meta(),
  );
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return {
    built,
    records: {
      ...records,
      payments: [...records.payments, built.aggregate.payment],
      allocations: [...records.allocations, ...built.aggregate.allocations],
    },
  };
}

describe('customer payments (SPEC §4.1, §8.2)', () => {
  it('paying an invoice in two parts settles it (the parts: sales.test.ts, T8)', () => {
    const invoice = sale(20_000, '2026-10-01');
    const first = pay(empty([invoice]), 10_000, invoice.id);
    expect(customerAccountOf(first.records, TODAY)).toMatchObject({ collectibleCents: 10_000 });
    const second = pay(first.records, 10_000);
    expect(customerAccountOf(second.records, TODAY)).toMatchObject({
      balanceCents: 0,
      collectibleCents: 0,
      creditCents: 0,
      openInvoices: [],
    });
  });

  it('pays the chosen invoice first, then the oldest; an overpayment stays as credit (P6)', () => {
    const older = sale(1000, '2026-09-01');
    const newer = sale(3000, '2026-10-10');
    const { built, records } = pay(empty([older, newer]), 5000, newer.id);
    expect(built.aggregate.allocations.map((a) => [a.saleId, a.amountCents])).toEqual([
      [newer.id, 3000],
      [older.id, 1000],
    ]);
    expect(built.unappliedCents).toBe(1000);
    expect(customerAccountOf(records, TODAY)).toMatchObject({
      balanceCents: -1000,
      collectibleCents: 0,
      creditCents: 1000,
    });
    expect(
      checkPaymentAggregate(built.aggregate, new Map(records.sales.map((s) => [s.id, s]))),
    ).toEqual([]);
  });

  it('a general payment skips written-off invoices; aimed at one, it is a recovery (S5)', () => {
    const bad = sale(1000, '2026-08-01');
    const good = sale(1000, '2026-09-01');
    const records: CustomerRecords = {
      ...empty([bad, good]),
      writeOffs: [
        buildWriteOff({ saleId: bad.id, reason: 'سافر', date: TODAY }, { id: newId() }, meta()),
      ],
    };
    expect(customerAccountOf(records, TODAY)).toMatchObject({
      collectibleCents: 1000,
      writtenOffCents: 1000,
      oldestOpenDate: '2026-09-01',
    });
    expect(pay(records, 1000).built.aggregate.allocations.map((a) => a.saleId)).toEqual([good.id]);
    expect(pay(records, 1000, bad.id).built.aggregate.allocations.map((a) => a.saleId)).toEqual([
      bad.id,
    ]);
    expect(
      buildPayment(
        newPaymentSchema.parse({
          customerId,
          amountCents: 100,
          date: TODAY,
          targetSaleId: newId(),
        }),
        records,
        { paymentId: newId(), newId },
        meta(),
      ),
    ).toMatchObject({ ok: false, issues: [{ message: RECEIVABLE_ISSUES.unknownTarget }] });
  });

  it('a credit is refunded (never beyond it) or applied to a later invoice, after refunds', () => {
    const first = sale(1000, '2026-09-01');
    let { records } = pay(empty([first]), 1500);
    const refund = (amountCents: number) =>
      buildRefund(
        newRefundSchema.parse({ customerId, amountCents, date: TODAY }),
        records,
        { paymentId: newId() },
        { ...meta(), today: TODAY },
      );
    expect(refund(600)).toMatchObject({
      ok: false,
      issues: [{ message: RECEIVABLE_ISSUES.aboveCredit }],
    });
    const refunded = refund(200);
    if (!refunded.ok) throw new Error('expected a refund');
    expect(refunded.aggregate).toMatchObject({
      payment: { kind: 'refund', amountCents: 200 },
      allocations: [],
    });
    records = { ...records, payments: [...records.payments, refunded.aggregate.payment] };

    // A new credit sale: the 300 left of the credit goes to it.
    const later = sale(1000, '2026-10-20');
    records = { ...records, sales: [...records.sales, later] };
    const applied = buildCreditApplication(records, { newId }, { ...meta(), date: TODAY });
    if (!applied.ok) throw new Error('expected an application');
    expect(applied.application.allocations.map((a) => [a.saleId, a.amountCents])).toEqual([
      [later.id, 300],
    ]);
    const after = {
      ...records,
      allocations: [...records.allocations, ...applied.application.allocations],
    };
    expect(customerAccountOf(after, TODAY)).toMatchObject({
      creditCents: 0,
      collectibleCents: 700,
    });
    expect(buildCreditApplication(after, { newId }, { ...meta(), date: TODAY })).toMatchObject({
      ok: false,
      issues: [{ message: RECEIVABLE_ISSUES.noCredit }],
    });
  });
});

describe('server checks of pushed payments', () => {
  const invoice = sale(1000, '2026-10-01');
  const sales = new Map([[invoice.id, invoice]]);
  const { built } = pay(empty([invoice]), 600);
  const { payment, allocations } = built.aggregate;
  const [allocation] = allocations as [PaymentAllocation];

  it.each([
    [
      'a payment without a customer',
      { payment: { ...payment, customerId: null }, allocations },
      RECEIVABLE_ISSUES.needsCustomer,
    ],
    [
      'a refund applied to a sale',
      { payment: { ...payment, kind: 'refund' as const }, allocations },
      RECEIVABLE_ISSUES.refundApplied,
    ],
    [
      'an allocation of another payment',
      { payment, allocations: [{ ...allocation, paymentId: newId() }] },
      RECEIVABLE_ISSUES.allocationMismatch,
    ],
    [
      'an unknown sale',
      { payment, allocations: [{ ...allocation, saleId: newId() }] },
      RECEIVABLE_ISSUES.unknownSale,
    ],
    [
      'more than the payment',
      { payment, allocations: [{ ...allocation, amountCents: 700 }] },
      RECEIVABLE_ISSUES.overApplied,
    ],
  ])('refuses %s', (_label, aggregate, message) => {
    expect(checkPaymentAggregate(aggregate, sales)).toEqual([expect.objectContaining({ message })]);
  });

  it('refuses paying another customer’s sale, and credit beyond what a payment had', () => {
    const theirs = { ...invoice, customerId: newId() };
    expect(checkPaymentAggregate(built.aggregate, new Map([[invoice.id, theirs]]))).toEqual([
      expect.objectContaining({ message: RECEIVABLE_ISSUES.otherCustomer }),
    ]);
    const payments = new Map<string, Payment>([[payment.id, payment]]);
    expect(checkAllocations([allocation], payments, sales, new Map([[payment.id, 600]]))).toEqual([
      expect.objectContaining({ message: RECEIVABLE_ISSUES.overApplied }),
    ]);
    expect(
      checkAllocations([{ ...allocation, paymentId: newId() }], payments, sales, new Map()),
    ).toEqual([expect.objectContaining({ message: RECEIVABLE_ISSUES.allocationMismatch })]);
  });

  it('a write-off needs a live customer sale with something due, once', () => {
    const records = empty([invoice]);
    const writeOff = buildWriteOff(
      { saleId: invoice.id, reason: 'لن يدفع', date: TODAY },
      { id: newId() },
      meta(),
    );
    expect(checkWriteOff(writeOff, invoice, records)).toEqual([]);
    for (const [target, of] of [
      [undefined, records],
      [{ ...invoice, customerId: null }, records],
      [{ ...invoice, voidedAt: TODAY }, records],
      [invoice, { ...records, writeOffs: [writeOff] }],
      [invoice, pay(records, 1000).records],
    ] as const) {
      expect(checkWriteOff(writeOff, target, of)).toEqual([
        expect.objectContaining(
          target
            ? { message: RECEIVABLE_ISSUES.writeOffNoDebt }
            : { message: RECEIVABLE_ISSUES.unknownSale },
        ),
      ]);
    }
  });
});
