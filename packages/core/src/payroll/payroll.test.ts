import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertMonth,
  SALARY_EXPENSE_CATEGORY,
  type SalaryPayment,
  type SalaryRate,
  salaryDue,
  salaryLedgerOf,
  salaryMonthOf,
  salaryOutstanding,
  salaryPaid,
  salaryRateFor,
} from './index.js';

// docs/accounting-assumptions.md PY1–PY5: a salary is an expense; what is due comes from the rates.

const RATES: SalaryRate[] = [
  { effectiveFrom: '2026-03-01', amountCents: 300_000 },
  { effectiveFrom: '2026-06-01', amountCents: 350_000 },
];

describe('assertMonth', () => {
  it.each(['2026-01', '2026-12'])('accepts %s', (month) => {
    expect(() => {
      assertMonth(month, 'month');
    }).not.toThrow();
  });
  it.each(['2026-13', '2026-00', '2026-1', '2026-01-01', ''])('rejects "%s"', (month) => {
    expect(() => {
      assertMonth(month, 'month');
    }).toThrow('month must be a YYYY-MM month');
  });
});

describe('SALARY_EXPENSE_CATEGORY', () => {
  it('is the wages category of the shop’s default expense categories', () => {
    expect(SALARY_EXPENSE_CATEGORY).toBe('wages');
  });
});

describe('salaryRateFor / salaryDue (PY2)', () => {
  it('has no rate, so nothing is due, before the first one', () => {
    expect(salaryRateFor(RATES, '2026-02')).toBeUndefined();
    expect(salaryDue(RATES, '2026-02')).toBe(0);
    expect(salaryDue([], '2026-02')).toBe(0);
  });

  it('a rate applies from the first day of its month', () => {
    expect(salaryDue(RATES, '2026-03')).toBe(300_000);
    expect(salaryDue(RATES, '2026-05')).toBe(300_000);
    expect(salaryDue(RATES, '2026-06')).toBe(350_000);
    expect(salaryDue(RATES, '2027-01')).toBe(350_000);
  });

  it('does not depend on the order the rates are given in', () => {
    expect(salaryDue([...RATES].reverse(), '2026-07')).toBe(350_000);
  });

  it('a rate of 0 stops the salary until a later rate starts it again', () => {
    const paused: SalaryRate[] = [...RATES, { effectiveFrom: '2026-08-01', amountCents: 0 }];
    expect(salaryDue(paused, '2026-07')).toBe(350_000);
    expect(salaryDue(paused, '2026-08')).toBe(0);
    expect(
      salaryDue([...paused, { effectiveFrom: '2026-10-01', amountCents: 400_000 }], '2026-11'),
    ).toBe(400_000);
  });

  it('is nothing after the month the employment ended in, and full in that month', () => {
    expect(salaryDue(RATES, '2026-08', '2026-08-15')).toBe(350_000);
    expect(salaryDue(RATES, '2026-09', '2026-08-15')).toBe(0);
    expect(salaryDue(RATES, '2026-09', null)).toBe(350_000);
  });

  it.each([
    [[{ effectiveFrom: '2026-03-15', amountCents: 1 }], 'starts on the first of a month'],
    [[{ effectiveFrom: '2026-03-01', amountCents: -1 }], 'salary amountCents must be >= 0'],
    [
      [{ effectiveFrom: '2026-03-01', amountCents: 1.5 }],
      'salary amountCents must be a safe integer',
    ],
    [
      [
        { effectiveFrom: '2026-03-01', amountCents: 1 },
        { effectiveFrom: '2026-03-01', amountCents: 2 },
      ],
      'two salary rates start on 2026-03-01',
    ],
  ] satisfies [SalaryRate[], string][])('rejects %j', (rates, message) => {
    expect(() => salaryDue(rates, '2026-03')).toThrow(message);
  });
});

describe('salaryPaid / salaryMonthOf (PY3)', () => {
  const payments: SalaryPayment[] = [
    { month: '2026-06', amountCents: 200_000 },
    { month: '2026-06', amountCents: 100_000 },
    { month: '2026-05', amountCents: 300_000 },
  ];

  it('adds the payments made for the month, partial ones included', () => {
    expect(salaryPaid(payments, '2026-06')).toBe(300_000);
    expect(salaryPaid(payments, '2026-07')).toBe(0);
  });

  it('June after a raise: 3500 due, 3000 paid in two parts → partly paid, 500 left', () => {
    expect(salaryMonthOf(RATES, payments, '2026-06')).toEqual({
      month: '2026-06',
      dueCents: 350_000,
      paidCents: 300_000,
      remainingCents: 50_000,
      overpaidCents: 0,
      status: 'partial',
    });
  });

  it('May was paid in full', () => {
    expect(salaryMonthOf(RATES, payments, '2026-05')).toMatchObject({
      dueCents: 300_000,
      paidCents: 300_000,
      remainingCents: 0,
      status: 'paid',
    });
  });

  it('July is unpaid, and a month before any rate is not a debt', () => {
    expect(salaryMonthOf(RATES, payments, '2026-07')).toMatchObject({
      dueCents: 350_000,
      paidCents: 0,
      remainingCents: 350_000,
      status: 'unpaid',
    });
    expect(salaryMonthOf(RATES, payments, '2026-01')).toMatchObject({
      dueCents: 0,
      paidCents: 0,
      remainingCents: 0,
      status: 'none',
    });
  });

  it('paying more than is due shows the extra and owes nothing', () => {
    expect(
      salaryMonthOf(RATES, [{ month: '2026-03', amountCents: 310_000 }], '2026-03'),
    ).toMatchObject({
      remainingCents: 0,
      overpaidCents: 10_000,
      status: 'paid',
    });
  });

  it('a payment for a month with nothing due is extra, not a debt', () => {
    expect(
      salaryMonthOf(RATES, [{ month: '2026-01', amountCents: 5000 }], '2026-01'),
    ).toMatchObject({
      dueCents: 0,
      overpaidCents: 5000,
      status: 'paid',
    });
  });

  it('refuses a payment that is not a positive whole amount for a month', () => {
    expect(() => salaryPaid([{ month: '2026-06', amountCents: 0 }], '2026-06')).toThrow(
      'payment amountCents must be >= 1',
    );
    expect(() => salaryPaid([{ month: '2026-6', amountCents: 5 }], '2026-06')).toThrow(
      'payment month must be a YYYY-MM month',
    );
  });
});

describe('salaryLedgerOf / salaryOutstanding (PY3)', () => {
  const payments: SalaryPayment[] = [
    { month: '2026-03', amountCents: 300_000 },
    { month: '2026-04', amountCents: 100_000 },
  ];

  it('lists every month from the first rate through the month asked for, oldest first', () => {
    const ledger = salaryLedgerOf(RATES, payments, '2026-07');
    expect(ledger.map(({ month }) => month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(ledger.map(({ status }) => status)).toEqual([
      'paid',
      'partial',
      'unpaid',
      'unpaid',
      'unpaid',
    ]);
  });

  it('lists no month only because a raise starts in it: nothing is owed for a month not begun', () => {
    // The raise of June 2026 is known in April; April's ledger ends in April.
    const inApril = salaryLedgerOf(RATES, payments, '2026-04');
    expect(inApril.map(({ month }) => month)).toEqual(['2026-03', '2026-04']);
    expect(salaryOutstanding(inApril, '2026-04')).toBe(200_000);
    // It shows once its month is the one asked for.
    expect(salaryLedgerOf(RATES, payments, '2026-06').at(-1)).toMatchObject({
      month: '2026-06',
      dueCents: 350_000,
      status: 'unpaid',
    });
    // A first rate that starts later lists nothing yet.
    expect(
      salaryLedgerOf([{ effectiveFrom: '2026-09-01', amountCents: 100_000 }], [], '2026-07'),
    ).toEqual([]);
  });

  it('what is still owed is the unpaid part of each month through the month asked for', () => {
    const ledger = salaryLedgerOf(RATES, payments, '2026-07');
    // April 2000 + May 3000 + June 3500 + July 3500 = 12000 dirham.
    expect(salaryOutstanding(ledger, '2026-07')).toBe(1_200_000);
    expect(salaryOutstanding(ledger, '2026-05')).toBe(500_000);
  });

  it('keeps a month paid ahead of time, and is empty with no rate and no payment', () => {
    const ahead = salaryLedgerOf(RATES, [{ month: '2026-09', amountCents: 350_000 }], '2026-07');
    expect(ahead.at(-1)).toMatchObject({ month: '2026-09', status: 'paid' });
    expect(salaryLedgerOf([], [], '2026-07')).toEqual([]);
  });

  it('stops owing after the employment ended', () => {
    const ledger = salaryLedgerOf(RATES, [], '2026-10', '2026-07-31');
    expect(ledger.map(({ dueCents }) => dueCents)).toEqual([
      300_000, 300_000, 300_000, 350_000, 350_000, 0, 0, 0,
    ]);
  });

  it('property: remaining and extra never go negative, and one of them is 0', () => {
    const rate = fc.record({
      effectiveFrom: fc
        .tuple(fc.integer({ min: 2024, max: 2027 }), fc.integer({ min: 1, max: 12 }))
        .map(([year, month]) => `${String(year)}-${String(month).padStart(2, '0')}-01`),
      amountCents: fc.integer({ min: 0, max: 10_000_000 }),
    });
    const payment = fc.record({
      month: fc
        .tuple(fc.integer({ min: 2024, max: 2027 }), fc.integer({ min: 1, max: 12 }))
        .map(([year, month]) => `${String(year)}-${String(month).padStart(2, '0')}`),
      amountCents: fc.integer({ min: 1, max: 10_000_000 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(rate, { selector: (r) => r.effectiveFrom, maxLength: 6 }),
        fc.array(payment, { maxLength: 12 }),
        (rates, paid) => {
          const ledger = salaryLedgerOf(rates, paid, '2027-12');
          let paidTotal = 0;
          for (const row of ledger) {
            expect(row.remainingCents).toBeGreaterThanOrEqual(0);
            expect(row.overpaidCents).toBeGreaterThanOrEqual(0);
            expect(row.remainingCents * row.overpaidCents).toBe(0);
            expect(row.dueCents - row.paidCents).toBe(row.remainingCents - row.overpaidCents);
            paidTotal += row.paidCents;
          }
          // Every payment lands in exactly one month of the ledger.
          expect(paidTotal).toBe(paid.reduce((sum, { amountCents }) => sum + amountCents, 0));
          // Months are consecutive.
          for (const [index, row] of ledger.entries()) {
            if (index > 0) expect(row.month > (ledger[index - 1]?.month ?? '')).toBe(true);
          }
        },
      ),
    );
  });
});
