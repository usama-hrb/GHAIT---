import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { allocateGeneralPayment, allocatePayment, type OpenInvoice } from './allocation.js';
import { amountDueCents, customerBalance, unrecoveredCapitalCents } from './balance.js';
import { splitSaleCapitalProfit } from './split.js';

const dh = fromDirham;

describe('splitSaleCapitalProfit (SPEC §7, §8.2)', () => {
  it('capital = Σ line costs, profit = total − capital', () => {
    expect(
      splitSaleCapitalProfit({
        lines: [
          { lineTotalCents: 9000, lineCostCents: 8000 },
          { lineTotalCents: 5000, lineCostCents: 4348 },
        ],
      }),
    ).toEqual({
      linesTotalCents: 14_000,
      discountCents: 0,
      totalCents: 14_000,
      capitalCents: 12_348,
      profitCents: 1652,
      collectibleCapitalCents: 12_348,
      recognizableProfitCents: 1652,
      lossCents: 0,
      belowCost: false,
    });
  });

  it('an invoice discount comes out of the profit part', () => {
    expect(
      splitSaleCapitalProfit({
        lines: [{ lineTotalCents: 20_000, lineCostCents: 16_000 }],
        discountCents: 1000,
      }),
    ).toMatchObject({ totalCents: 19_000, capitalCents: 16_000, profitCents: 3000 });
  });

  it('a discount that takes the invoice under cost makes it a below-cost sale', () => {
    expect(
      splitSaleCapitalProfit({
        lines: [{ lineTotalCents: 20_000, lineCostCents: 16_000 }],
        discountCents: 5000,
      }),
    ).toMatchObject({ totalCents: 15_000, profitCents: -1000, lossCents: 1000, belowCost: true });
  });

  it('a below-cost line inside a profitable invoice only lowers its profit (no separate loss)', () => {
    expect(
      splitSaleCapitalProfit({
        lines: [
          { lineTotalCents: 14_000, lineCostCents: 10_000 }, // +4000
          { lineTotalCents: 14_000, lineCostCents: 16_000 }, // −2000
        ],
      }),
    ).toMatchObject({ profitCents: 2000, lossCents: 0, belowCost: false });
  });

  it('zero-profit sale: everything is capital', () => {
    expect(
      splitSaleCapitalProfit({ lines: [{ lineTotalCents: 16_000, lineCostCents: 16_000 }] }),
    ).toMatchObject({
      profitCents: 0,
      recognizableProfitCents: 0,
      lossCents: 0,
      collectibleCapitalCents: 16_000,
    });
  });

  it('rejects a discount larger than the lines and invalid amounts', () => {
    expect(() =>
      splitSaleCapitalProfit({
        lines: [{ lineTotalCents: 100, lineCostCents: 50 }],
        discountCents: 101,
      }),
    ).toThrow('exceeds the lines total');
    expect(() =>
      splitSaleCapitalProfit({ lines: [{ lineTotalCents: -1, lineCostCents: 0 }] }),
    ).toThrow('lineTotalCents');
    expect(() => splitSaleCapitalProfit({ lines: [], discountCents: -1 })).toThrow('discountCents');
  });
});

describe('allocatePayment: capital first, then profit (SPEC §8.2)', () => {
  const T8 = { totalCents: dh(200), capitalCents: dh(160) };

  it('T8: invoice 200 dh costing 160; paying 100 then 100', () => {
    const first = allocatePayment(T8, [], dh(100));
    expect(first).toEqual({
      appliedCents: dh(100),
      capitalRecoveredCents: dh(100),
      profitRecognizedCents: 0,
      overpaymentCents: 0,
    });
    const second = allocatePayment(T8, [dh(100)], dh(100));
    expect(second).toEqual({
      appliedCents: dh(100),
      capitalRecoveredCents: dh(60),
      profitRecognizedCents: dh(40),
      overpaymentCents: 0,
    });
  });

  it('a payment that crosses the capital line splits exactly there', () => {
    expect(allocatePayment(T8, [dh(150)], dh(30))).toMatchObject({
      capitalRecoveredCents: dh(10),
      profitRecognizedCents: dh(20),
    });
  });

  it('never recognises profit already recognised by earlier payments', () => {
    expect(allocatePayment(T8, [dh(100), dh(80)], dh(20))).toMatchObject({
      capitalRecoveredCents: 0,
      profitRecognizedCents: dh(20),
    });
  });

  it('overpayment: only what was due is applied; the rest is a credit', () => {
    expect(allocatePayment(T8, [dh(150)], dh(100))).toEqual({
      appliedCents: dh(50),
      capitalRecoveredCents: dh(10),
      profitRecognizedCents: dh(40),
      overpaymentCents: dh(50),
    });
    expect(allocatePayment(T8, [dh(200)], dh(10))).toEqual({
      appliedCents: 0,
      capitalRecoveredCents: 0,
      profitRecognizedCents: 0,
      overpaymentCents: dh(10),
    });
  });

  it('zero-profit sale: every payment is capital', () => {
    const sale = { totalCents: dh(160), capitalCents: dh(160) };
    expect(allocatePayment(sale, [dh(100)], dh(60))).toMatchObject({
      capitalRecoveredCents: dh(60),
      profitRecognizedCents: 0,
    });
  });

  it('negative-profit sale (T11 on credit): payments recover at most the total, no profit', () => {
    const sale = { totalCents: dh(140), capitalCents: dh(160) };
    expect(allocatePayment(sale, [], dh(100))).toMatchObject({
      capitalRecoveredCents: dh(100),
      profitRecognizedCents: 0,
    });
    expect(allocatePayment(sale, [dh(100)], dh(50))).toEqual({
      appliedCents: dh(40),
      capitalRecoveredCents: dh(40),
      profitRecognizedCents: 0,
      overpaymentCents: dh(10),
    });
  });

  it('rejects invalid payments', () => {
    expect(() => allocatePayment(T8, [], 0)).toThrow('newPaymentCents');
    expect(() => allocatePayment(T8, [-5], 10)).toThrow('payment');
    expect(() => allocatePayment({ totalCents: -1, capitalCents: 0 }, [], 10)).toThrow(
      'totalCents',
    );
  });

  it('property: parts add up and never exceed the invoice', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 3_000_000 }), { minLength: 1, maxLength: 20 }),
        (totalCents, capitalCents, payments) => {
          const sale = { totalCents, capitalCents };
          const collectible = Math.min(totalCents, capitalCents);
          const profit = Math.max(0, totalCents - capitalCents);
          let capital = 0;
          let recognized = 0;
          let credit = 0;
          payments.forEach((amount, index) => {
            const part = allocatePayment(sale, payments.slice(0, index), amount);
            expect(
              part.capitalRecoveredCents + part.profitRecognizedCents + part.overpaymentCents,
            ).toBe(amount);
            // capital first: no profit while capital is still owed
            if (part.profitRecognizedCents > 0)
              expect(capital + part.capitalRecoveredCents).toBe(collectible);
            capital += part.capitalRecoveredCents;
            recognized += part.profitRecognizedCents;
            credit += part.overpaymentCents;
          });
          const paid = payments.reduce((sum, amount) => sum + amount, 0);
          expect(capital).toBe(Math.min(paid, collectible));
          expect(recognized).toBe(Math.min(Math.max(0, paid - collectible), profit));
          expect(credit).toBe(Math.max(0, paid - totalCents));
        },
      ),
    );
  });
});

describe('allocateGeneralPayment: oldest invoices first (SPEC §4.1)', () => {
  const invoices: OpenInvoice[] = [
    {
      saleId: 'b',
      date: '2026-10-12',
      totalCents: dh(300),
      capitalCents: dh(240),
      paymentsCents: [],
    },
    {
      saleId: 'a',
      date: '2026-10-05',
      totalCents: dh(200),
      capitalCents: dh(160),
      paymentsCents: [dh(100)],
    },
    {
      saleId: 'c',
      date: '2026-10-20',
      totalCents: dh(100),
      capitalCents: dh(80),
      paymentsCents: [],
    },
  ];

  it('a payment spanning two invoices pays the oldest off, then starts the next', () => {
    expect(allocateGeneralPayment(invoices, dh(150))).toEqual({
      allocations: [
        {
          saleId: 'a',
          appliedCents: dh(100),
          capitalRecoveredCents: dh(60),
          profitRecognizedCents: dh(40),
          overpaymentCents: 0,
        },
        {
          saleId: 'b',
          appliedCents: dh(50),
          capitalRecoveredCents: dh(50),
          profitRecognizedCents: 0,
          overpaymentCents: 0,
        },
      ],
      unappliedCents: 0,
    });
  });

  it('partial payments across many invoices', () => {
    const first = allocateGeneralPayment(invoices, dh(80));
    expect(first.allocations.map((a) => [a.saleId, a.appliedCents])).toEqual([['a', dh(80)]]);

    const afterFirst = invoices.map((invoice) =>
      invoice.saleId === 'a' ? { ...invoice, paymentsCents: [dh(100), dh(80)] } : invoice,
    );
    const second = allocateGeneralPayment(afterFirst, dh(400));
    expect(second.allocations.map((a) => [a.saleId, a.appliedCents])).toEqual([
      ['a', dh(20)],
      ['b', dh(300)],
      ['c', dh(80)],
    ]);
    expect(second.unappliedCents).toBe(0);
  });

  it('more than everything owed leaves a credit', () => {
    expect(allocateGeneralPayment(invoices, dh(600)).unappliedCents).toBe(dh(100));
  });

  it('skips invoices that are already paid (or overpaid) and breaks date ties by id', () => {
    const tied: OpenInvoice[] = [
      { saleId: 'z', date: '2026-10-01', totalCents: 500, capitalCents: 400, paymentsCents: [] },
      { saleId: 'y', date: '2026-10-01', totalCents: 500, capitalCents: 400, paymentsCents: [] },
      { saleId: 'x', date: '2026-09-01', totalCents: 500, capitalCents: 400, paymentsCents: [600] },
    ];
    expect(
      allocateGeneralPayment(tied, 600).allocations.map((a) => [a.saleId, a.appliedCents]),
    ).toEqual([
      ['y', 500],
      ['z', 100],
    ]);
  });

  it('property: every cent goes to an invoice or to the credit, oldest invoices first', () => {
    const invoiceArb = fc.record({
      totalCents: fc.integer({ min: 0, max: 100_000 }),
      capitalCents: fc.integer({ min: 0, max: 100_000 }),
      paid: fc.integer({ min: 0, max: 120_000 }),
      day: fc.integer({ min: 1, max: 28 }),
    });
    fc.assert(
      fc.property(
        fc.array(invoiceArb, { maxLength: 12 }),
        fc.integer({ min: 1, max: 500_000 }),
        (raw, amount) => {
          const open: OpenInvoice[] = raw.map((r, index) => ({
            saleId: `s${String(index).padStart(2, '0')}`,
            date: `2026-10-${String(r.day).padStart(2, '0')}`,
            totalCents: r.totalCents,
            capitalCents: r.capitalCents,
            paymentsCents: r.paid > 0 ? [r.paid] : [],
          }));
          const result = allocateGeneralPayment(open, amount);
          const applied = result.allocations.reduce((sum, a) => sum + a.appliedCents, 0);
          expect(applied + result.unappliedCents).toBe(amount);
          for (const allocation of result.allocations) expect(allocation.overpaymentCents).toBe(0);
          // Every invoice before the last one reached is fully paid.
          const order = [...open].sort(
            (a, b) => a.date.localeCompare(b.date) || a.saleId.localeCompare(b.saleId),
          );
          const reached = result.allocations.map((a) => a.saleId);
          const lastIndex = order.findIndex((invoice) => invoice.saleId === reached.at(-1));
          order.slice(0, Math.max(0, lastIndex)).forEach((invoice) => {
            const extra =
              result.allocations.find((a) => a.saleId === invoice.saleId)?.appliedCents ?? 0;
            const paid = invoice.paymentsCents.reduce((sum, p) => sum + p, 0) + extra;
            expect(paid).toBeGreaterThanOrEqual(invoice.totalCents);
          });
        },
      ),
    );
  });

  it('rejects a non-positive amount', () => {
    expect(() => allocateGeneralPayment(invoices, 0)).toThrow('amountCents');
  });
});

describe('customerBalance (SPEC §4.1, §13)', () => {
  it('Σ invoices − Σ payments, ignoring voided records', () => {
    const sales = [
      { totalCents: dh(200) },
      { totalCents: dh(300) },
      { totalCents: dh(999), voided: true },
    ];
    const payments = [
      { amountCents: dh(100) },
      { amountCents: dh(50) },
      { amountCents: dh(77), voided: true },
    ];
    expect(customerBalance(sales, payments)).toBe(dh(350));
  });

  it('goes negative when the customer overpaid (a credit)', () => {
    expect(customerBalance([{ totalCents: dh(200) }], [{ amountCents: dh(250) }])).toBe(-dh(50));
  });

  it('is 0 for a customer with nothing', () => {
    expect(customerBalance([], [])).toBe(0);
  });

  it('rejects invalid amounts', () => {
    expect(() => customerBalance([{ totalCents: -1 }], [])).toThrow('totalCents');
    expect(() => customerBalance([], [{ amountCents: 0 }])).toThrow('amountCents');
  });

  it('property: equals Σ amountDue over invoices when every payment targets an invoice', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            totalCents: fc.integer({ min: 0, max: 1_000_000 }),
            payments: fc.array(fc.integer({ min: 1, max: 500_000 }), { maxLength: 5 }),
          }),
          { maxLength: 10 },
        ),
        (invoices) => {
          const balance = customerBalance(
            invoices.map((i) => ({ totalCents: i.totalCents })),
            invoices.flatMap((i) => i.payments.map((amountCents) => ({ amountCents }))),
          );
          const due = invoices.reduce(
            (sum, i) => sum + amountDueCents(i.totalCents, i.payments),
            0,
          );
          expect(balance).toBe(due);
        },
      ),
    );
  });
});

describe('amountDueCents', () => {
  it('total − payments, negative when overpaid', () => {
    expect(amountDueCents(dh(200), [dh(100), dh(30)])).toBe(dh(70));
    expect(amountDueCents(dh(200), [dh(250)])).toBe(-dh(50));
    expect(() => amountDueCents(-1, [])).toThrow('totalCents');
    expect(() => amountDueCents(100, [0])).toThrow('payment');
  });
});

describe('unrecoveredCapitalCents (SPEC §8.2, §9)', () => {
  const T8 = { totalCents: dh(200), capitalCents: dh(160) };

  it('T8: capital still in the debt after each payment', () => {
    expect(unrecoveredCapitalCents(T8, [])).toBe(dh(160));
    expect(unrecoveredCapitalCents(T8, [dh(100)])).toBe(dh(60));
    expect(unrecoveredCapitalCents(T8, [dh(100), dh(100)])).toBe(0);
    expect(unrecoveredCapitalCents(T8, [dh(300)])).toBe(0); // overpaid
  });

  it('a below-cost invoice can only recover its total (T11)', () => {
    expect(unrecoveredCapitalCents({ totalCents: dh(140), capitalCents: dh(160) }, [dh(40)])).toBe(
      dh(100),
    );
  });

  it('rejects invalid amounts', () => {
    expect(() => unrecoveredCapitalCents({ totalCents: 100, capitalCents: -1 }, [])).toThrow(
      'capitalCents must be >= 0',
    );
    expect(() => unrecoveredCapitalCents({ totalCents: -1, capitalCents: 0 }, [])).toThrow(
      'totalCents must be >= 0',
    );
  });
});
