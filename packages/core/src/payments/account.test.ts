import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { type AccountSale, customerAccount } from './account.js';
import {
  allocateCustomerPayment,
  applyCredit,
  type OpenInvoice,
  paymentParts,
} from './allocation.js';

const dh = fromDirham;
const TODAY = '2026-10-30';

const sale = (
  saleId: string,
  totalCents: number,
  overrides: Partial<AccountSale> = {},
): AccountSale => ({
  saleId,
  date: '2026-10-01',
  dueDate: null,
  totalCents,
  voided: false,
  writtenOff: false,
  ...overrides,
});

describe('paymentParts (SPEC §8.2)', () => {
  it('T8: 200 dh costing 160, paid 100 then 100 → capital 100 / 0, then capital 60 / profit 40', () => {
    expect(
      paymentParts({ totalCents: dh(200), capitalCents: dh(160) }, [dh(100), dh(100)]).map(
        (part) => [part.capitalRecoveredCents, part.profitRecognizedCents],
      ),
    ).toEqual([
      [dh(100), 0],
      [dh(60), dh(40)],
    ]);
  });
});

describe('allocateCustomerPayment (SPEC §4.1, P6)', () => {
  const invoices: OpenInvoice[] = [
    { saleId: 'old', date: '2026-10-01', totalCents: 1000, capitalCents: 800, paymentsCents: [] },
    {
      saleId: 'new',
      date: '2026-10-20',
      totalCents: 2000,
      capitalCents: 1600,
      paymentsCents: [500],
    },
  ];

  it('pays the target first, then the oldest of the others, and keeps the rest as credit', () => {
    const result = allocateCustomerPayment(invoices, 2000, 'new');
    expect(result.allocations.map((a) => [a.saleId, a.appliedCents])).toEqual([
      ['new', 1500],
      ['old', 500],
    ]);
    expect(allocateCustomerPayment(invoices, 3000, 'new').unappliedCents).toBe(500);
    expect(allocateCustomerPayment(invoices, 300, 'new').allocations).toHaveLength(1);
  });

  it('without a target it is the general rule; a paid target passes straight on', () => {
    expect(
      allocateCustomerPayment(invoices, 1200).allocations.map((a) => [a.saleId, a.appliedCents]),
    ).toEqual([
      ['old', 1000],
      ['new', 200],
    ]);
    const paid = [
      { ...invoices[0], paymentsCents: [1000] } as OpenInvoice,
      invoices[1] as OpenInvoice,
    ];
    expect(
      allocateCustomerPayment(paid, 300, 'old').allocations.map((a) => [a.saleId, a.appliedCents]),
    ).toEqual([['new', 300]]);
    expect(() => allocateCustomerPayment(invoices, 100, 'missing')).toThrow(RangeError);
  });
});

describe('applyCredit (P6)', () => {
  it('uses the oldest credit first, on the oldest invoices first', () => {
    const invoices: OpenInvoice[] = [
      { saleId: 'b', date: '2026-10-10', totalCents: 700, capitalCents: 500, paymentsCents: [] },
      { saleId: 'a', date: '2026-10-05', totalCents: 400, capitalCents: 300, paymentsCents: [100] },
    ];
    expect(
      applyCredit(
        [
          { paymentId: 'p2', date: '2026-10-08', unappliedCents: 500 },
          { paymentId: 'p1', date: '2026-10-02', unappliedCents: 400 },
          { paymentId: 'p0', date: '2026-10-02', unappliedCents: 0 },
        ],
        invoices,
      ),
    ).toEqual([
      { paymentId: 'p1', saleId: 'a', amountCents: 300 },
      { paymentId: 'p1', saleId: 'b', amountCents: 100 },
      { paymentId: 'p2', saleId: 'b', amountCents: 500 },
    ]);
  });
});

describe('customerAccount (SPEC §4.1, §13)', () => {
  it('balance = Σ sales − Σ payments + Σ refunds; credit, written-off and overdue apart', () => {
    const account = customerAccount({
      sales: [
        sale('a', 1000, { date: '2026-09-01', dueDate: '2026-10-01' }),
        sale('b', 2000, { date: '2026-10-05', writtenOff: true }),
        sale('c', 3000, { voided: true }),
        sale('d', 500, { date: '2026-10-10' }),
      ],
      payments: [
        { paymentId: 'p1', kind: 'payment', amountCents: 1200 },
        { paymentId: 'p2', kind: 'payment', amountCents: 3000 },
        { paymentId: 'r', kind: 'refund', amountCents: 3000 },
      ],
      allocations: [
        { paymentId: 'p1', saleId: 'a', amountCents: 400 },
        { paymentId: 'p1', saleId: 'd', amountCents: 500 },
        { paymentId: 'p2', saleId: 'c', amountCents: 3000 },
      ],
      today: TODAY,
    });
    expect(account).toMatchObject({
      balanceCents: 1000 + 2000 + 500 - 4200 + 3000,
      collectibleCents: 600,
      writtenOffCents: 2000,
      creditCents: 300,
      overdueCents: 600,
      oldestOpenDate: '2026-09-01',
    });
    expect(account.openInvoices.map((invoice) => [invoice.saleId, invoice.dueCents])).toEqual([
      ['a', 600],
      ['b', 2000],
    ]);
  });

  it('refuses allocations that a payment cannot cover or that are not payments', () => {
    const base = { sales: [sale('a', 1000)], today: TODAY };
    expect(() =>
      customerAccount({
        ...base,
        payments: [{ paymentId: 'p', kind: 'payment', amountCents: 100 }],
        allocations: [{ paymentId: 'p', saleId: 'a', amountCents: 200 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      customerAccount({
        ...base,
        payments: [{ paymentId: 'r', kind: 'refund', amountCents: 100 }],
        allocations: [{ paymentId: 'r', saleId: 'a', amountCents: 100 }],
      }),
    ).toThrow(RangeError);
  });

  it('property: balance always equals Σ sales − Σ payments + Σ refunds and Σ due − credit', () => {
    const saleArb = fc.record({
      totalCents: fc.integer({ min: 0, max: 50_000 }),
      voided: fc.boolean(),
      writtenOff: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(saleArb, { maxLength: 8 }),
        fc.array(fc.integer({ min: 1, max: 60_000 }), { maxLength: 6 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), { maxLength: 3 }),
        (salesSpec, paid, refunds) => {
          const sales = salesSpec.map((spec, index) =>
            sale(`s${String(index)}`, spec.totalCents, spec),
          );
          const payments = [
            ...paid.map((amountCents, index) => ({
              paymentId: `p${String(index)}`,
              kind: 'payment' as const,
              amountCents,
            })),
            ...refunds.map((amountCents, index) => ({
              paymentId: `r${String(index)}`,
              kind: 'refund' as const,
              amountCents,
            })),
          ];
          // Each payment applied like the POS and the payment screen would: oldest first.
          const allocations: { paymentId: string; saleId: string; amountCents: number }[] = [];
          paid.forEach((amountCents, index) => {
            const open = sales
              .filter((s) => !s.voided && !s.writtenOff)
              .map((s) => ({
                saleId: s.saleId,
                date: s.date,
                totalCents: s.totalCents,
                capitalCents: 0,
                paymentsCents: allocations
                  .filter((a) => a.saleId === s.saleId)
                  .map((a) => a.amountCents),
              }));
            for (const allocation of allocateCustomerPayment(open, amountCents).allocations) {
              allocations.push({
                paymentId: `p${String(index)}`,
                saleId: allocation.saleId,
                amountCents: allocation.appliedCents,
              });
            }
          });
          const account = customerAccount({ sales, payments, allocations, today: TODAY });
          const live = sales.filter((s) => !s.voided);
          expect(account.balanceCents).toBe(
            live.reduce((sum, s) => sum + s.totalCents, 0) -
              paid.reduce((sum, a) => sum + a, 0) +
              refunds.reduce((sum, a) => sum + a, 0),
          );
          const due = live.reduce(
            (sum, s) =>
              sum +
              s.totalCents -
              allocations
                .filter((a) => a.saleId === s.saleId)
                .reduce((t, a) => t + a.amountCents, 0),
            0,
          );
          expect(account.balanceCents).toBe(due - account.creditCents);
          expect(account.collectibleCents + account.writtenOffCents).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
