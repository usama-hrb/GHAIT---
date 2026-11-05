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

  it('carries what was bought and what was paid, at purchase or later', () => {
    const account = supplierAccount({
      purchases: [
        purchase('a', '2026-10-01', dh(800), dh(300)),
        purchase('b', '2026-10-15', dh(200)),
      ],
      payments: [payment('p', '2026-10-10', dh(100))],
    });
    expect(account.purchasesCents).toBe(dh(1000));
    expect(account.paidCents).toBe(dh(400));
    expect(account.purchasesCents - account.paidCents).toBe(account.balanceCents);
    expect(supplierAccount({ purchases: [], payments: [] })).toMatchObject({
      purchasesCents: 0,
      paidCents: 0,
      allocations: [],
    });
  });

  it('says where each payment went: the purchase it names, then the oldest', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(300)), purchase('b', '2026-10-10', dh(100))],
      payments: [payment('p1', '2026-10-20', dh(150), 'b'), payment('p2', '2026-10-21', dh(200))],
    });
    expect(account.allocations).toEqual([
      { paymentId: 'p1', purchaseId: 'b', amountCents: dh(100) },
      { paymentId: 'p1', purchaseId: 'a', amountCents: dh(50) },
      { paymentId: 'p2', purchaseId: 'a', amountCents: dh(200) },
    ]);
    expect(account.purchases.map((p) => [p.purchaseId, p.dueCents])).toEqual([
      ['a', dh(50)],
      ['b', 0],
    ]);
  });

  it('splits an untargeted payment over the oldest purchases, oldest payment first', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(100)), purchase('b', '2026-10-02', dh(100))],
      payments: [payment('p1', '2026-10-05', dh(70)), payment('p2', '2026-10-06', dh(70))],
    });
    expect(account.allocations).toEqual([
      { paymentId: 'p1', purchaseId: 'a', amountCents: dh(70) },
      { paymentId: 'p2', purchaseId: 'a', amountCents: dh(30) },
      { paymentId: 'p2', purchaseId: 'b', amountCents: dh(40) },
    ]);
  });

  it('keeps a payment beyond everything owed as an allocation to no purchase (an advance)', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(100))],
      payments: [payment('p', '2026-10-02', dh(130))],
    });
    expect(account.allocations).toEqual([
      { paymentId: 'p', purchaseId: 'a', amountCents: dh(100) },
      { paymentId: 'p', purchaseId: null, amountCents: dh(30) },
    ]);
    // A payment with nothing to pay at all is all advance.
    expect(
      supplierAccount({ purchases: [], payments: [payment('q', '2026-10-02', dh(5))] }).allocations,
    ).toEqual([{ paymentId: 'q', purchaseId: null, amountCents: dh(5) }]);
  });

  it('treats a payment aimed at an unknown purchase as one with no target', () => {
    const account = supplierAccount({
      purchases: [purchase('a', '2026-10-01', dh(100))],
      payments: [payment('p', '2026-10-02', dh(40), 'gone')],
    });
    expect(account.allocations).toEqual([{ paymentId: 'p', purchaseId: 'a', amountCents: dh(40) }]);
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
          // Bought less paid is what is owed, and the statement ends on it.
          expect(account.purchasesCents - account.paidCents).toBe(account.balanceCents);
          const lines = supplierStatement({ purchases, payments });
          expect(lines.at(-1)?.balanceCents ?? 0).toBe(account.balanceCents);
          // Every payment is given out in full, and each purchase's settled part is what was paid
          // at purchase plus what the payments gave it.
          for (const pay of payments) {
            const given = account.allocations
              .filter((part) => part.paymentId === pay.paymentId)
              .reduce((sum, part) => sum + part.amountCents, 0);
            expect(given).toBe(pay.amountCents);
          }
          for (const row of account.purchases) {
            const given = account.allocations
              .filter((part) => part.purchaseId === row.purchaseId)
              .reduce((sum, part) => sum + part.amountCents, 0);
            expect(row.paidCents + given).toBe(row.settledCents);
          }
          const unapplied = account.allocations
            .filter((part) => part.purchaseId === null)
            .reduce((sum, part) => sum + part.amountCents, 0);
          expect(unapplied).toBe(account.advanceCents);
        },
      ),
    );
  });
});

describe('supplierStatement, purchases of one day (SP6)', () => {
  it("puts what was paid with a purchase right after it, not after the day's other purchases", () => {
    const lines = supplierStatement({
      purchases: [
        { purchaseId: 'p1', date: '2026-10-01', totalCents: dh(320), paidCents: dh(100) },
        { purchaseId: 'p2', date: '2026-10-01', totalCents: dh(60), paidCents: dh(60) },
      ],
      payments: [payment('a', '2026-10-01', dh(50))],
    });
    expect(lines.map((line) => [line.kind, line.refId, line.balanceCents])).toEqual([
      ['purchase', 'p1', dh(320)],
      ['paid_at_purchase', 'p1', dh(220)],
      ['purchase', 'p2', dh(280)],
      ['paid_at_purchase', 'p2', dh(220)],
      ['payment', 'a', dh(170)],
    ]);
  });
});

describe('supplierStatement, records of one day (SP6)', () => {
  it('keeps payments of one day in the order given, and ends on the same balance either way', () => {
    const purchases = [purchase('a', '2026-10-01', dh(1000))];
    const first = payment('z', '2026-10-02', dh(300));
    const second = payment('b', '2026-10-02', dh(600));
    const forward = supplierStatement({ purchases, payments: [first, second] });
    const paymentsOf = (lines: typeof forward) =>
      lines
        .filter((line) => line.kind === 'payment')
        .map((line) => [line.refId, line.balanceCents]);
    // The id order (b before z) does not decide: the order given does.
    expect(paymentsOf(forward)).toEqual([
      ['z', dh(700)],
      ['b', dh(100)],
    ]);
    const backward = supplierStatement({ purchases, payments: [second, first] });
    expect(paymentsOf(backward)).toEqual([
      ['b', dh(400)],
      ['z', dh(100)],
    ]);
    expect(forward.at(-1)?.balanceCents).toBe(backward.at(-1)?.balanceCents);
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
