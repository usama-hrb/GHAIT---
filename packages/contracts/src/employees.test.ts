import { salaryLedgerOf } from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  checkEmployee,
  checkEmployeeVoid,
  checkSalaryPayment,
  checkSalaryRate,
  checkSalaryRateVoid,
  type Employee,
  type EmployeeSalary,
  employeeInputSchema,
  employeeSalaryInputSchema,
  employeeStatusOf,
  type Expense,
  newSalaryPaymentSchema,
  PAYROLL_ISSUES,
  payrollOf,
  salaryPaymentExpense,
  salaryPaymentsOf,
  salaryRatesOf,
} from './index.js';
import { at, base } from './test-shop.js';

const ALI = crypto.randomUUID();
const SARA = crypto.randomUUID();

const employee = (id: string, startDate: string, voidedAt: string | null = null): Employee => ({
  ...base(startDate),
  voidedAt,
  id,
  name: 'علي',
  phone: null,
  position: null,
  startDate,
  endDate: null,
  notes: null,
});

const rate = (
  employeeId: string,
  effectiveFrom: string,
  amountCents: number,
  voidedAt: string | null = null,
): EmployeeSalary => ({
  ...base(effectiveFrom),
  voidedAt,
  id: crypto.randomUUID(),
  employeeId,
  effectiveFrom,
  amountCents,
});

const wage = (
  employeeId: string | null,
  salaryMonth: string | null,
  amountCents: number,
  paidDate: string | null,
  overrides: Partial<Expense> = {},
): Expense => ({
  ...base(paidDate ?? '2026-10-01'),
  id: crypto.randomUUID(),
  date: paidDate ?? '2026-10-01',
  category: 'wages',
  amountCents,
  paidDate,
  note: null,
  recurringExpenseId: null,
  employeeId,
  salaryMonth,
  ...overrides,
});

const messages = (issues: { message: string }[]) => issues.map(({ message }) => message);

describe('employee record (P6)', () => {
  it('trims the name, defaults the optional fields to null, and refuses an end before the start', () => {
    expect(employeeInputSchema.parse({ name: '  علي  ', startDate: '2026-03-01' })).toEqual({
      name: 'علي',
      phone: null,
      position: null,
      startDate: '2026-03-01',
      endDate: null,
      notes: null,
    });
    expect(employeeInputSchema.safeParse({ name: ' ', startDate: '2026-03-01' }).success).toBe(
      false,
    );
    const ended = employeeInputSchema.safeParse({
      name: 'علي',
      startDate: '2026-03-01',
      endDate: '2026-02-28',
    });
    expect(ended.success).toBe(false);
    expect(ended.error?.issues[0]).toMatchObject({
      path: ['endDate'],
      message: PAYROLL_ISSUES.endBeforeStart,
    });
    expect(
      employeeInputSchema.safeParse({
        name: 'علي',
        startDate: '2026-03-01',
        endDate: '2026-03-01',
      }).success,
    ).toBe(true);
  });

  it('is active until the day after the last day of employment', () => {
    expect(employeeStatusOf({ endDate: null }, '2026-10-15')).toBe('active');
    expect(employeeStatusOf({ endDate: '2026-10-15' }, '2026-10-15')).toBe('active');
    expect(employeeStatusOf({ endDate: '2026-10-15' }, '2026-10-16')).toBe('inactive');
  });
});

describe('salary rate (P2, P4)', () => {
  it('starts on the first of a month; 0 is allowed (a pause), a negative amount or a part-month date is not', () => {
    const input = { employeeId: ALI, effectiveFrom: '2026-10-01', amountCents: 300_000 };
    expect(employeeSalaryInputSchema.parse(input)).toEqual(input);
    expect(employeeSalaryInputSchema.safeParse({ ...input, amountCents: 0 }).success).toBe(true);
    expect(employeeSalaryInputSchema.safeParse({ ...input, amountCents: -1 }).success).toBe(false);
    expect(employeeSalaryInputSchema.safeParse({ ...input, amountCents: 1.5 }).success).toBe(false);
    expect(
      employeeSalaryInputSchema.safeParse({ ...input, effectiveFrom: '2026-10-15' }).success,
    ).toBe(false);
  });

  it('the first rate may reach back to the start; later ones start this month or after', () => {
    const today = '2026-10-15';
    const ali = employee(ALI, '2026-03-12');
    const first = rate(ALI, '2026-03-01', 250_000);
    const next = { id: crypto.randomUUID(), employeeId: ALI };
    const context = { today, employee: ali, rates: [] as EmployeeSalary[] };

    // No rate yet: any month from the start month on, even one long gone.
    expect(checkSalaryRate({ ...next, effectiveFrom: first.effectiveFrom }, context)).toEqual([]);
    expect(checkSalaryRate({ ...next, effectiveFrom: '2026-02-01' }, context)).toEqual([
      expect.objectContaining({ message: PAYROLL_ISSUES.rateBeforeStart }),
    ]);

    // A rate exists: a raise starts this month or later, never in a month that is over.
    const withFirst = { ...context, rates: [first] };
    expect(checkSalaryRate({ ...next, effectiveFrom: '2026-10-01' }, withFirst)).toEqual([]);
    expect(checkSalaryRate({ ...next, effectiveFrom: '2027-01-01' }, withFirst)).toEqual([]);
    expect(checkSalaryRate({ ...next, effectiveFrom: '2026-09-01' }, withFirst)).toEqual([
      expect.objectContaining({ message: PAYROLL_ISSUES.ratePast }),
    ]);
    expect(checkSalaryRate({ ...next, effectiveFrom: '2026-03-01' }, withFirst)).toEqual([
      expect.objectContaining({ message: PAYROLL_ISSUES.rateDateTaken }),
    ]);
  });

  it('a voided rate does not count, a rate of another employee does not count, a rate is not its own twin', () => {
    const ali = employee(ALI, '2026-03-01');
    const voided = rate(ALI, '2026-10-01', 1, at('2026-10-02'));
    const saras = rate(SARA, '2026-10-01', 1);
    const mine = rate(ALI, '2026-10-01', 1);
    const context = { today: '2026-10-15', employee: ali, rates: [voided, saras] };
    const next = { id: mine.id, employeeId: ALI, effectiveFrom: '2026-10-01' };
    expect(checkSalaryRate(next, context)).toEqual([]);
    expect(checkSalaryRate(next, { ...context, rates: [mine] })).toEqual([]);
    expect(
      checkSalaryRate({ ...next, id: crypto.randomUUID() }, { ...context, rates: [mine] }),
    ).toEqual([expect.objectContaining({ message: PAYROLL_ISSUES.rateDateTaken })]);
  });

  it('refuses a rate for an employee that does not exist', () => {
    expect(
      messages(
        checkSalaryRate(
          { id: crypto.randomUUID(), employeeId: ALI, effectiveFrom: '2026-10-01' },
          { today: '2026-10-15', employee: undefined, rates: [] },
        ),
      ),
    ).toEqual([PAYROLL_ISSUES.unknownEmployee]);
  });

  it('voids only a rate that starts this month or later', () => {
    expect(checkSalaryRateVoid({ effectiveFrom: '2026-10-01' }, '2026-10-31')).toEqual([]);
    expect(checkSalaryRateVoid({ effectiveFrom: '2026-11-01' }, '2026-10-31')).toEqual([]);
    expect(checkSalaryRateVoid({ effectiveFrom: '2026-09-01' }, '2026-10-01')).toEqual([
      expect.objectContaining({ message: PAYROLL_ISSUES.ratePast }),
    ]);
  });
});

describe('salary payment (P1, P3)', () => {
  const employees = [employee(ALI, '2026-03-12'), employee(SARA, '2026-01-01', at('2026-06-01'))];

  it('an expense with neither link is an ordinary one', () => {
    expect(checkSalaryPayment(wage(null, null, 1000, '2026-10-05'), employees)).toEqual([]);
    expect(
      checkSalaryPayment(wage(null, null, 1000, null, { category: 'rent' }), employees),
    ).toEqual([]);
  });

  it('needs the employee and the month together', () => {
    expect(messages(checkSalaryPayment(wage(ALI, null, 1000, '2026-10-05'), employees))).toEqual([
      PAYROLL_ISSUES.needsEmployeeAndMonth,
    ]);
    expect(
      messages(checkSalaryPayment(wage(null, '2026-10', 1000, '2026-10-05'), employees)),
    ).toEqual([PAYROLL_ISSUES.needsEmployeeAndMonth]);
  });

  it('is booked as wages, paid, for a month that has begun and not before the employee started', () => {
    expect(checkSalaryPayment(wage(ALI, '2026-10', 300_000, '2026-10-05'), employees)).toEqual([]);
    // The first month counts although they started mid-month (no proration, P2).
    expect(checkSalaryPayment(wage(ALI, '2026-03', 300_000, '2026-03-31'), employees)).toEqual([]);
    // Paid late: September's salary paid in October.
    expect(checkSalaryPayment(wage(ALI, '2026-09', 300_000, '2026-10-05'), employees)).toEqual([]);

    expect(
      messages(
        checkSalaryPayment(wage(ALI, '2026-10', 1, '2026-10-05', { category: 'rent' }), employees),
      ),
    ).toEqual([PAYROLL_ISSUES.notSalaryCategory]);
    expect(messages(checkSalaryPayment(wage(ALI, '2026-10', 1, null), employees))).toEqual([
      PAYROLL_ISSUES.notPaid,
    ]);
    // November's salary cannot be paid on 20 October: the month has not begun.
    expect(messages(checkSalaryPayment(wage(ALI, '2026-11', 1, '2026-10-20'), employees))).toEqual([
      PAYROLL_ISSUES.monthNotStarted,
    ]);
    expect(messages(checkSalaryPayment(wage(ALI, '2026-02', 1, '2026-10-20'), employees))).toEqual([
      PAYROLL_ISSUES.monthBeforeStart,
    ]);
  });

  it('is refused for an employee that is unknown or voided', () => {
    expect(
      messages(
        checkSalaryPayment(wage(crypto.randomUUID(), '2026-10', 1, '2026-10-05'), employees),
      ),
    ).toEqual([PAYROLL_ISSUES.unknownEmployee]);
    expect(messages(checkSalaryPayment(wage(SARA, '2026-10', 1, '2026-10-05'), employees))).toEqual(
      [PAYROLL_ISSUES.unknownEmployee],
    );
  });
});

describe('removing an employee (P6)', () => {
  it('is refused once they were paid; a voided payment does not count', () => {
    const paid = wage(ALI, '2026-10', 1000, '2026-10-05');
    const voided = wage(SARA, '2026-10', 1000, '2026-10-05', { voidedAt: at('2026-10-06') });
    expect(messages(checkEmployeeVoid(ALI, [paid]))).toEqual([PAYROLL_ISSUES.hasPayments]);
    expect(checkEmployeeVoid(SARA, [voided, paid])).toEqual([]);
    expect(checkEmployeeVoid(ALI, [])).toEqual([]);
  });
});

describe('payroll from the records, through @fabric/core', () => {
  it('rates and payments of one employee give the due, paid and remaining of each month', () => {
    const rates = [
      rate(ALI, '2026-08-01', 250_000),
      rate(ALI, '2026-10-01', 300_000),
      rate(ALI, '2026-12-01', 999_999, at('2026-10-02')),
      rate(SARA, '2026-08-01', 111_111),
    ];
    const expenses = [
      wage(ALI, '2026-08', 250_000, '2026-08-31'),
      wage(ALI, '2026-09', 100_000, '2026-09-30'),
      // Voided: not paid.
      wage(ALI, '2026-09', 150_000, '2026-10-02', { voidedAt: at('2026-10-03') }),
      wage(ALI, '2026-10', 100_000, '2026-10-05'),
      wage(ALI, '2026-10', 50_000, '2026-10-20'),
      wage(SARA, '2026-09', 111_111, '2026-09-30'),
      // An ordinary expense is not a payment.
      wage(null, null, 5000, '2026-10-02', { category: 'rent' }),
    ];
    expect(salaryRatesOf(rates, ALI)).toEqual([
      { effectiveFrom: '2026-08-01', amountCents: 250_000 },
      { effectiveFrom: '2026-10-01', amountCents: 300_000 },
    ]);
    expect(salaryPaymentsOf(expenses, ALI)).toEqual([
      { month: '2026-08', amountCents: 250_000 },
      { month: '2026-09', amountCents: 100_000 },
      { month: '2026-10', amountCents: 100_000 },
      { month: '2026-10', amountCents: 50_000 },
    ]);
    // An unpaid wage (no paid date) is no payment: it is not in the list.
    expect(salaryPaymentsOf([wage(ALI, '2026-10', 1000, null)], ALI)).toEqual([]);

    const ledger = salaryLedgerOf(
      salaryRatesOf(rates, ALI),
      salaryPaymentsOf(expenses, ALI),
      '2026-10',
    );
    expect(
      ledger.map(({ month, dueCents, paidCents, remainingCents, status }) => ({
        month,
        dueCents,
        paidCents,
        remainingCents,
        status,
      })),
    ).toEqual([
      {
        month: '2026-08',
        dueCents: 250_000,
        paidCents: 250_000,
        remainingCents: 0,
        status: 'paid',
      },
      {
        month: '2026-09',
        dueCents: 250_000,
        paidCents: 100_000,
        remainingCents: 150_000,
        status: 'partial',
      },
      {
        month: '2026-10',
        dueCents: 300_000,
        paidCents: 150_000,
        remainingCents: 150_000,
        status: 'partial',
      },
    ]);
  });
});

describe('payrollOf', () => {
  it('is the ledger of one employee through a month, and what they are still owed', () => {
    const rates = [rate(ALI, '2026-08-01', 250_000), rate(SARA, '2026-08-01', 999)];
    const expenses = [
      wage(ALI, '2026-08', 250_000, '2026-08-31'),
      wage(ALI, '2026-09', 100_000, '2026-09-30'),
      wage(SARA, '2026-09', 999, '2026-09-30'),
    ];
    const payroll = payrollOf({ id: ALI, endDate: null }, rates, expenses, '2026-10');
    expect(payroll).toMatchObject({
      employeeId: ALI,
      through: '2026-10',
      outstandingCents: 400_000,
    });
    expect(payroll.months.map(({ month, status }) => [month, status])).toEqual([
      ['2026-08', 'paid'],
      ['2026-09', 'partial'],
      ['2026-10', 'unpaid'],
    ]);
  });

  it('owes nothing after the month employment ended; a voided payment is owed again', () => {
    const rates = [rate(ALI, '2026-08-01', 250_000)];
    const paid = wage(ALI, '2026-08', 250_000, '2026-08-31');
    const ended = payrollOf({ id: ALI, endDate: '2026-08-20' }, rates, [paid], '2026-12');
    expect(ended.outstandingCents).toBe(0);
    expect(ended.months.map(({ month, dueCents }) => [month, dueCents])).toEqual([
      ['2026-08', 250_000],
      ['2026-09', 0],
      ['2026-10', 0],
      ['2026-11', 0],
      ['2026-12', 0],
    ]);
    const voided = { ...paid, voidedAt: at('2026-09-01') };
    expect(payrollOf({ id: ALI, endDate: null }, rates, [voided], '2026-08').outstandingCents).toBe(
      250_000,
    );
  });
});

describe('checkEmployee', () => {
  it('refuses an end before the start', () => {
    expect(checkEmployee({ startDate: '2026-03-01', endDate: null })).toEqual([]);
    expect(checkEmployee({ startDate: '2026-03-01', endDate: '2026-03-01' })).toEqual([]);
    expect(messages(checkEmployee({ startDate: '2026-03-01', endDate: '2026-02-28' }))).toEqual([
      PAYROLL_ISSUES.endBeforeStart,
    ]);
  });
});

describe('paying a salary (P1, P3)', () => {
  it('is an ordinary wages expense, dated the day it is paid, linked to the employee and the month', () => {
    const payment = newSalaryPaymentSchema.parse({
      employeeId: ALI,
      month: '2026-10',
      amountCents: 100_000,
      paidDate: '2026-11-03',
    });
    expect(salaryPaymentExpense(payment)).toEqual({
      date: '2026-11-03',
      category: 'wages',
      amountCents: 100_000,
      paidDate: '2026-11-03',
      note: null,
      recurringExpenseId: null,
      employeeId: ALI,
      salaryMonth: '2026-10',
    });
    // The server accepts what it builds (checkSalaryPayment).
    expect(
      checkSalaryPayment(salaryPaymentExpense(payment), [
        { id: ALI, startDate: '2026-03-01', voidedAt: null },
      ]),
    ).toEqual([]);
  });

  it('needs a real month, a positive amount and a paid date', () => {
    const ok = { employeeId: ALI, month: '2026-10', amountCents: 1, paidDate: '2026-10-31' };
    expect(newSalaryPaymentSchema.safeParse(ok).success).toBe(true);
    expect(newSalaryPaymentSchema.safeParse({ ...ok, month: '2026-13' }).success).toBe(false);
    expect(newSalaryPaymentSchema.safeParse({ ...ok, amountCents: 0 }).success).toBe(false);
    expect(newSalaryPaymentSchema.safeParse({ ...ok, paidDate: null }).success).toBe(false);
  });
});
