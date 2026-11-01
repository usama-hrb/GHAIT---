import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromDirham } from '../money/index.js';
import { supplierAccount, supplierStatement } from './index.js';

const dh = fromDirham;
const purchase = (purchaseId: string, date: string, totalCents: number, paidCents = 0) => ({
  purchaseId,
  date,
  totalCents,
  paidCents,
});
const payment = (
  paymentId: string,
  date: string,
  amountCents: number,
  purchaseId: string | null = null,
) => ({
  paymentId,
  date,
  amountCents,
  purchaseId,
});

describe('supplierAccount (SP1, SP2)', () => {
  it('owes the unpaid part of a purchase', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(800), dh(300))],
      payments: [],
    });
    expect(account).toMatchObject({ balanceCents: dh(500), owedCents: dh(500), advanceCents: 0 });
    expect(account.purchases).toEqual([
      {
        ...purchase('a', '2026-10-01', dh(800), dh(300)),
        settledCents: dh(300),
        dueCents: dh(500),
      },
    ]);
    expect(account.oldestDueDate).toBe('2026-10-01');
  });

  it('a payment without a target pays the oldest purchase first', () => {
    const account = supplierAccount({
      purchases: [purchase('b', '2026-10-10', dh(400)), purchase('a', '2026-10-01', dh(300))],
      payments: [payment('p', '2026-10-20', dh(350))],
    });
    expect(account.purchases.map((p) => [p.purchaseId, p.dueCents])).toEqual([
      ['a', 0],
      ['b', dh(350)],
    ]);
    expect(account.balanceCents).toBe(dh(350));
    expect(account.oldestDueDate).toBe('2026-10-10');
  });

  it('a payment aimed at a purchase pays it first; what it does not need passes on', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(300)), purchase('b', '2026-10-10', dh(100))],
      payments: [payment('p', '2026-10-20', dh(150), 'b')],
    });
    expect(account.purchases.map((p) => [p.purchaseId, p.dueCents])).toEqual([
      ['a', dh(250)], // the 50 dh b did not need went to the oldest
      ['b', 0],
    ]);
  });

  it('payments beyond what is owed are an advance, not a negative debt', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(100))],
      payments: [payment('p', '2026-10-02', dh(130))],
    });
    expect(account).toMatchObject({ balanceCents: -dh(30), owedCents: 0, advanceCents: dh(30) });
    expect(account.oldestDueDate).toBeNull();
  });

  it('rejects a purchase paid beyond its total, and bad amounts', () => {
    expect(() =>
      supplierAccount({ purchases: [purchase('a', '2026-10-01', 100, 101)], payments: [] }),
    ).toThrow('paid beyond its total');
    expect(() =>
      supplierAccount({ purchases: [], payments: [payment('p', '2026-10-01', 0)] }),
    ).toThrow(RangeError);
  });

  it('property: the balance is Σ unpaid − Σ payments whatever order and targets', () => {
    const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-10-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              total: fc.integer({ min: 1, max: 100_000 }),
              share: fc.double({ min: 0, max: 1, noNaN: true }),
              date: day,
            })
            .map(({ total, share, date }) => ({ total, paid: Math.floor(total * share), date })),
          { maxLength: 5 },
        ),
        fc.array(
          fc.record({ amount: fc.integer({ min: 1, max: 50_000 }), date: day, target: fc.nat(6) }),
          {
            maxLength: 6,
          },
        ),
        (rows, pays) => {
          const purchases = rows.map((row, index) =>
            purchase(`p${String(index)}`, row.date, row.total, row.paid),
          );
          const payments = pays.map((row, index) =>
            payment(
              `x${String(index)}`,
              row.date,
              row.amount,
              row.target < purchases.length ? `p${String(row.target)}` : null,
            ),
          );
          const account = supplierAccount({ purchases, payments });
          const expected =
            purchases.reduce((sum, p) => sum + p.totalCents - p.paidCents, 0) -
            payments.reduce((sum, p) => sum + p.amountCents, 0);
          expect(account.balanceCents).toBe(expected);
          const dueTotal = account.purchases.reduce((sum, p) => sum + p.dueCents, 0);
          expect(dueTotal - account.advanceCents).toBe(expected);
          for (const row of account.purchases) {
            expect(row.dueCents).toBeGreaterThanOrEqual(0);
            expect(row.dueCents).toBeLessThanOrEqual(row.totalCents);
          }
        },
      ),
    );
  });
});

describe('supplierStatement', () => {
  it('lists purchases and payments with the running balance', () => {
    const lines = supplierStatement({
      purchases: [
        purchase('a', '2026-10-01', dh(800), dh(300)),
        purchase('b', '2026-10-15', dh(200)),
      ],
      payments: [payment('p', '2026-10-10', dh(100))],
    });
    expect(lines).toEqual([
      {
        date: '2026-10-01',
        kind: 'purchase',
        refId: 'a',
        deltaCents: dh(800),
        balanceCents: dh(800),
      },
      {
        date: '2026-10-01',
        kind: 'paid_at_purchase',
        refId: 'a',
        deltaCents: -dh(300),
        balanceCents: dh(500),
      },
      {
        date: '2026-10-10',
        kind: 'payment',
        refId: 'p',
        deltaCents: -dh(100),
        balanceCents: dh(400),
      },
      {
        date: '2026-10-15',
        kind: 'purchase',
        refId: 'b',
        deltaCents: dh(200),
        balanceCents: dh(600),
      },
    ]);
    expect(lines.at(-1)?.balanceCents).toBe(
      supplierAccount({
        purchases: [
          purchase('a', '2026-10-01', dh(800), dh(300)),
          purchase('b', '2026-10-15', dh(200)),
        ],
        payments: [payment('p', '2026-10-10', dh(100))],
      }).balanceCents,
    );
  });
});
