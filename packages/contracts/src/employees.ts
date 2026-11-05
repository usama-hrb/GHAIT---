import {
  monthBounds,
  monthOf,
  SALARY_EXPENSE_CATEGORY,
  type SalaryMonth,
  salaryLedgerOf,
  salaryOutstanding,
  type SalaryPayment,
  type SalaryRate,
} from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import type { ValidationIssue } from './errors.js';
import type { Expense, ExpenseFields } from './expenses.js';

/**
 * Employees and their pay (docs/accounting-assumptions.md PY1–PY6, ADR 0022). An employee is not a
 * partner: no weight in the profit split, no capital. A salary payment is an ordinary expense
 * (category wages) linked to the employee and the month it pays; nothing else in the books knows
 * about payroll.
 */
const employeeFields = z.object({
  name: z.string().trim().min(1).max(80),
  phone: optionalTextSchema(40).default(null),
  /** The job ("cutter", "cashier"). */
  position: optionalTextSchema(60).default(null),
  startDate: isoDateSchema,
  /** The last day of employment: null while they work here. No salary is due after its month. */
  endDate: isoDateSchema.nullable().default(null),
  notes: optionalTextSchema(1000).default(null),
});

export const PAYROLL_ISSUES = {
  endBeforeStart: 'employee_end_before_start',
  /** A rate for an employee who already has one cannot start in a month that has passed (PY4). */
  ratePast: 'salary_rate_in_past',
  rateDateTaken: 'salary_rate_date_taken',
  rateBeforeStart: 'salary_rate_before_employment',
  unknownEmployee: 'salary_unknown_employee',
  notSalaryCategory: 'salary_wrong_category',
  needsEmployeeAndMonth: 'salary_needs_employee_and_month',
  notPaid: 'salary_not_paid',
  monthNotStarted: 'salary_month_not_started',
  monthBeforeStart: 'salary_month_before_employment',
  /** An employee with a live salary payment is never removed (PY6). */
  hasPayments: 'employee_has_payments',
  /** A rate is created or voided, never edited (PY4). */
  rateFixed: 'salary_rate_is_fixed',
} as const;

/** SPEC §13 `employee`: edited (LWW), ended with an end date; removed only if never paid. */
export const employeeInputSchema = employeeFields.refine(
  (employee) => employee.endDate === null || employee.endDate >= employee.startDate,
  { path: ['endDate'], message: PAYROLL_ISSUES.endBeforeStart },
);
export type EmployeeInput = z.input<typeof employeeInputSchema>;
export const employeeSchema = recordBaseSchema.extend(employeeFields.shape);
export type Employee = z.output<typeof employeeSchema>;
export const storedEmployeeSchema = employeeSchema.extend({ serverSeq: z.int().positive() });

/** Re-checks an employee a device pushed: the refinement of employeeInputSchema, for a record. */
export function checkEmployee(
  employee: Pick<Employee, 'startDate' | 'endDate'>,
): ValidationIssue[] {
  return employee.endDate !== null && employee.endDate < employee.startDate
    ? [issue(['endDate'], PAYROLL_ISSUES.endBeforeStart)]
    : [];
}

export type EmployeeStatus = 'active' | 'inactive';

/** Active until the day after the last day of employment. */
export function employeeStatusOf(
  employee: Pick<Employee, 'endDate'>,
  today: string,
): EmployeeStatus {
  return employee.endDate !== null && employee.endDate < today ? 'inactive' : 'active';
}

const salaryFields = z.object({
  employeeId: idSchema,
  /** The first day of the month the rate starts in (PY2). */
  effectiveFrom: isoDateSchema.refine((date) => date.endsWith('-01'), {
    message: 'salary_rate_not_month_start',
  }),
  /** A month's salary. 0 stops it (leave, a pause). */
  amountCents: amountCentsSchema,
});

/** A salary rate: created, or voided with a reason; never edited (PY4). */
export const employeeSalaryInputSchema = salaryFields;
export type EmployeeSalaryInput = z.input<typeof employeeSalaryInputSchema>;
export const employeeSalarySchema = recordBaseSchema.extend(salaryFields.shape);
export type EmployeeSalary = z.output<typeof employeeSalarySchema>;
export const storedEmployeeSalarySchema = employeeSalarySchema.extend({
  serverSeq: z.int().positive(),
});

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/**
 * A new salary rate (PY4). The first rate of an employee can start in any month from their start
 * date (they may have worked here for years); after that a rate starts this month or later, so a
 * raise never rewrites a month that is over.
 */
export function checkSalaryRate(
  next: Pick<EmployeeSalary, 'id' | 'employeeId' | 'effectiveFrom'>,
  context: {
    today: string;
    employee: Pick<Employee, 'startDate'> | undefined;
    rates: readonly Pick<EmployeeSalary, 'id' | 'employeeId' | 'effectiveFrom' | 'voidedAt'>[];
  },
): ValidationIssue[] {
  const { employee } = context;
  if (!employee) return [issue(['employeeId'], PAYROLL_ISSUES.unknownEmployee)];
  if (monthOf(next.effectiveFrom) < monthOf(employee.startDate)) {
    return [issue(['effectiveFrom'], PAYROLL_ISSUES.rateBeforeStart)];
  }
  const others = live(context.rates).filter(
    (rate) => rate.employeeId === next.employeeId && rate.id !== next.id,
  );
  if (others.some((rate) => rate.effectiveFrom === next.effectiveFrom)) {
    return [issue(['effectiveFrom'], PAYROLL_ISSUES.rateDateTaken)];
  }
  if (others.length > 0 && next.effectiveFrom < monthBounds(monthOf(context.today)).start) {
    return [issue(['effectiveFrom'], PAYROLL_ISSUES.ratePast)];
  }
  return [];
}

/** Voiding a rate: only one that starts this month or later (PY4). */
export function checkSalaryRateVoid(
  rate: Pick<EmployeeSalary, 'effectiveFrom'>,
  today: string,
): ValidationIssue[] {
  return rate.effectiveFrom < monthBounds(monthOf(today)).start
    ? [issue(['effectiveFrom'], PAYROLL_ISSUES.ratePast)]
    : [];
}

/**
 * An expense that pays a salary (PY3): linked to a live employee and the month it pays, in the
 * wages category, with a paid date (an unpaid wage is not a payment and creates no expense), for
 * a month that has begun by the day it is paid and not before the employee started. An expense
 * with neither link is an ordinary one.
 */
export function checkSalaryPayment(
  expense: Pick<Expense, 'category' | 'paidDate' | 'employeeId' | 'salaryMonth'>,
  employees: readonly Pick<Employee, 'id' | 'startDate' | 'voidedAt'>[],
): ValidationIssue[] {
  const { employeeId, salaryMonth } = expense;
  if (employeeId === null && salaryMonth === null) return [];
  if (employeeId === null || salaryMonth === null) {
    return [issue(['employeeId'], PAYROLL_ISSUES.needsEmployeeAndMonth)];
  }
  const employee = live(employees).find(({ id }) => id === employeeId);
  if (!employee) return [issue(['employeeId'], PAYROLL_ISSUES.unknownEmployee)];
  if (expense.category !== SALARY_EXPENSE_CATEGORY) {
    return [issue(['category'], PAYROLL_ISSUES.notSalaryCategory)];
  }
  if (expense.paidDate === null) return [issue(['paidDate'], PAYROLL_ISSUES.notPaid)];
  if (salaryMonth > monthOf(expense.paidDate)) {
    return [issue(['salaryMonth'], PAYROLL_ISSUES.monthNotStarted)];
  }
  if (salaryMonth < monthOf(employee.startDate)) {
    return [issue(['salaryMonth'], PAYROLL_ISSUES.monthBeforeStart)];
  }
  return [];
}

/** An employee with a payment in the books cannot be removed (PY6): they are ended with an end date. */
export function checkEmployeeVoid(
  employeeId: string,
  expenses: readonly Pick<Expense, 'employeeId' | 'voidedAt'>[],
): ValidationIssue[] {
  return live(expenses).some((expense) => expense.employeeId === employeeId)
    ? [issue(['id'], PAYROLL_ISSUES.hasPayments)]
    : [];
}

/** An employee's rates as @fabric/core's payroll rules take them. */
export function salaryRatesOf(
  rates: readonly Pick<
    EmployeeSalary,
    'employeeId' | 'effectiveFrom' | 'amountCents' | 'voidedAt'
  >[],
  employeeId: string,
): SalaryRate[] {
  return live(rates)
    .filter((rate) => rate.employeeId === employeeId)
    .map(({ effectiveFrom, amountCents }) => ({ effectiveFrom, amountCents }));
}

/** What an employee has been paid, by the month it pays: paid, live expenses linked to them. */
export function salaryPaymentsOf(
  expenses: readonly Pick<
    Expense,
    'employeeId' | 'salaryMonth' | 'amountCents' | 'paidDate' | 'voidedAt'
  >[],
  employeeId: string,
): SalaryPayment[] {
  return live(expenses).flatMap((expense) =>
    expense.employeeId === employeeId && expense.salaryMonth !== null && expense.paidDate !== null
      ? [{ month: expense.salaryMonth, amountCents: expense.amountCents }]
      : [],
  );
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const salaryMonthSchema = z.object({
  month: monthSchema,
  dueCents: z.int(),
  paidCents: z.int(),
  /** Still to pay, never negative. */
  remainingCents: z.int(),
  /** Paid beyond what was due, never negative. */
  overpaidCents: z.int(),
  status: z.enum(['none', 'unpaid', 'partial', 'paid']),
});

/** An employee's pay month by month, oldest first, and what is still owed through `through`. */
export const payrollSchema = z.object({
  employeeId: idSchema,
  through: monthSchema,
  months: z.array(salaryMonthSchema),
  outstandingCents: z.int(),
});
export type Payroll = z.output<typeof payrollSchema>;

export const payrollQuerySchema = z.object({ through: monthSchema.optional() });

/** What the owner enters to pay a salary, or part of it: the expense that books it is built from this. */
export const newSalaryPaymentSchema = z.object({
  employeeId: idSchema,
  /** The month it pays (YYYY-MM), whatever day it is paid. */
  month: monthSchema,
  amountCents: amountCentsSchema.min(1),
  paidDate: isoDateSchema,
  note: optionalTextSchema(500).default(null),
});
export type NewSalaryPayment = z.output<typeof newSalaryPaymentSchema>;
export type NewSalaryPaymentInput = z.input<typeof newSalaryPaymentSchema>;

/**
 * The expense a salary payment is (PY1, PY3): category wages, dated the day it is paid, linked to the
 * employee and the month it pays. Nothing else in the books knows about payroll.
 */
export function salaryPaymentExpense(payment: NewSalaryPayment): ExpenseFields {
  return {
    date: payment.paidDate,
    category: SALARY_EXPENSE_CATEGORY,
    amountCents: payment.amountCents,
    paidDate: payment.paidDate,
    note: payment.note,
    recurringExpenseId: null,
    employeeId: payment.employeeId,
    salaryMonth: payment.month,
  };
}

/**
 * One employee's salary ledger from the records (PY2, PY3): the rate in force each month, the live
 * paid expenses linked to them, and what remains, through @fabric/core's payroll rules. Nothing
 * here is stored or entered: delete a payment and the month owes it again.
 */
export function payrollOf(
  employee: Pick<Employee, 'id' | 'endDate'>,
  rates: readonly Pick<
    EmployeeSalary,
    'employeeId' | 'effectiveFrom' | 'amountCents' | 'voidedAt'
  >[],
  expenses: readonly Pick<
    Expense,
    'employeeId' | 'salaryMonth' | 'amountCents' | 'paidDate' | 'voidedAt'
  >[],
  through: string,
): Payroll {
  const months: SalaryMonth[] = salaryLedgerOf(
    salaryRatesOf(rates, employee.id),
    salaryPaymentsOf(expenses, employee.id),
    through,
    employee.endDate,
  );
  return {
    employeeId: employee.id,
    through,
    months,
    outstandingCents: salaryOutstanding(months, through),
  };
}
