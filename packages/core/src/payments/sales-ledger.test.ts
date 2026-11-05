import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { customerAccount } from './account.js';
import { type LedgerSale, paymentState, salesLedger } from './sales-ledger.js';

const dh = fromDirham;

const invoice = (
  netTotalCents: number,
  paidCents: number,
  overrides: Partial<LedgerSale> = {},
): LedgerSale => ({
  netTotalCents,
  paidCents,
  dueCents: netTotalCents - paidCents,
  voided: false,
  writtenOff: false,
  ...overrides,
});

describe('paymentState', () => {
  it('nothing left to pay is paid, whatever the amount', () => {
    expect(paymentState({ paidCents: dh(100), dueCents: 0 })).toBe('paid');
    expect(paymentState({ paidCents: 0, dueCents: 0 })).toBe('paid');
  });

  it('something paid and something left is partial', () => {
    expect(paymentState({ paidCents: dh(40), dueCents: dh(60) })).toBe('partial');
    expect(paymentState({ paidCents: 1, dueCents: 1 })).toBe('partial');
  });

  it('nothing paid and something left is unpaid', () => {
    expect(paymentState({ paidCents: 0, dueCents: dh(100) })).toBe('unpaid');
  });

  it('refuses cents that are not whole, or below zero', () => {
    expect(() => paymentState({ paidCents: 0.5, dueCents: 0 })).toThrow(RangeError);
    expect(() => paymentState({ paidCents: 0, dueCents: -1 })).toThrow(RangeError);
    expect(() => paymentState({ paidCents: -1, dueCents: 0 })).toThrow(RangeError);
  });
});

describe('salesLedger', () => {
  it('adds each invoice once: paid in full, partly paid, unpaid', () => {
    const ledger = salesLedger([
      invoice(dh(100), dh(100)),
      invoice(dh(200), dh(50)),
      invoice(dh(300), 0),
    ]);
    expect(ledger).toEqual({
      count: 3,
      voidedCount: 0,
      totalCents: dh(600),
      paidCents: dh(150),
      outstandingCents: dh(450),
      writtenOffCents: 0,
    });
  });

  it('leaves a voided invoice out of every sum and counts it apart', () => {
    const ledger = salesLedger([
      invoice(dh(100), dh(100)),
      invoice(dh(500), dh(500), { voided: true }),
    ]);
    expect(ledger).toMatchObject({ count: 1, voidedCount: 1, totalCents: dh(100) });
    expect(ledger.paidCents).toBe(dh(100));
  });

  it('keeps a written-off debt out of what is outstanding, and apart', () => {
    const ledger = salesLedger([
      invoice(dh(100), dh(30)),
      invoice(dh(200), dh(20), { writtenOff: true }),
    ]);
    expect(ledger.outstandingCents).toBe(dh(70));
    expect(ledger.writtenOffCents).toBe(dh(180));
    expect(ledger.totalCents).toBe(
      ledger.paidCents + ledger.outstandingCents + ledger.writtenOffCents,
    );
  });

  it('is empty for no invoices', () => {
    expect(salesLedger([])).toEqual({
      count: 0,
      voidedCount: 0,
      totalCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      writtenOffCents: 0,
    });
  });

  it('refuses an invoice whose paid and due do not make its worth', () => {
    expect(() =>
      salesLedger([
        { netTotalCents: 100, paidCents: 30, dueCents: 60, voided: false, writtenOff: false },
      ]),
    ).toThrow(RangeError);
  });

  it('a voided invoice is not checked: it is out of the account', () => {
    expect(() =>
      salesLedger([
        { netTotalCents: 100, paidCents: 0, dueCents: 0, voided: true, writtenOff: false },
      ]),
    ).not.toThrow();
  });

  const invoiceArb = fc
    .integer({ min: 0, max: 5_000_000 })
    .chain((net) =>
      fc.record({
        net: fc.constant(net),
        paid: fc.integer({ min: 0, max: net }),
        voided: fc.boolean(),
        writtenOff: fc.boolean(),
      }),
    )
    .map(({ net, paid, voided, writtenOff }) => invoice(net, paid, { voided, writtenOff }));

  it('property: total = paid + outstanding + written off, for any set of invoices', () => {
    fc.assert(
      fc.property(fc.array(invoiceArb, { maxLength: 40 }), (sales) => {
        const ledger = salesLedger(sales);
        expect(ledger.totalCents).toBe(
          ledger.paidCents + ledger.outstandingCents + ledger.writtenOffCents,
        );
        expect(ledger.count + ledger.voidedCount).toBe(sales.length);
      }),
    );
  });

  it('property: splitting a period in two adds up to the whole period', () => {
    fc.assert(
      fc.property(fc.array(invoiceArb, { maxLength: 40 }), fc.nat(40), (sales, cut) => {
        const whole = salesLedger(sales);
        const a = salesLedger(sales.slice(0, cut));
        const b = salesLedger(sales.slice(cut));
        expect(a.totalCents + b.totalCents).toBe(whole.totalCents);
        expect(a.paidCents + b.paidCents).toBe(whole.paidCents);
        expect(a.outstandingCents + b.outstandingCents).toBe(whole.outstandingCents);
      }),
    );
  });

  it('matches the customer account: outstanding over all of one customer’s invoices is collectible', () => {
    const account = customerAccount({
      sales: [
        {
          saleId: 's1',
          date: '2026-10-01',
          dueDate: null,
          totalCents: dh(100),
          voided: false,
          writtenOff: false,
        },
        {
          saleId: 's2',
          date: '2026-10-02',
          dueDate: null,
          totalCents: dh(200),
          returnedCents: dh(50),
          voided: false,
          writtenOff: false,
        },
        {
          saleId: 's3',
          date: '2026-10-03',
          dueDate: null,
          totalCents: dh(300),
          voided: false,
          writtenOff: true,
        },
        {
          saleId: 's4',
          date: '2026-10-04',
          dueDate: null,
          totalCents: dh(400),
          voided: true,
          writtenOff: false,
        },
      ],
      payments: [{ paymentId: 'p1', kind: 'payment', amountCents: dh(120) }],
      allocations: [
        { paymentId: 'p1', saleId: 's1', amountCents: dh(40) },
        { paymentId: 'p1', saleId: 's2', amountCents: dh(80) },
      ],
      today: '2026-10-30',
    });
    const ledger = salesLedger(
      account.invoices.map((entry) => ({
        netTotalCents: entry.totalCents,
        paidCents: entry.paidCents,
        dueCents: entry.dueCents,
        voided: false,
        writtenOff: entry.writtenOff,
      })),
    );
    expect(ledger.outstandingCents).toBe(account.collectibleCents);
    expect(ledger.writtenOffCents).toBe(account.writtenOffCents);
    expect(ledger.totalCents).toBe(account.purchasesCents);
  });
});
