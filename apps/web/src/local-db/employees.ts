import {
  checkEmployeeVoid,
  checkSalaryPayment,
  checkSalaryRate,
  checkSalaryRateVoid,
  type Employee,
  type EmployeeInput,
  employeeInputSchema,
  type EmployeeSalary,
  type EmployeeSalaryInput,
  employeeSalaryInputSchema,
  employeeSalarySchema,
  employeeSchema,
  type EmployeeStatus,
  employeeStatusOf,
  type Expense,
  type NewSalaryPaymentInput,
  newSalaryPaymentSchema,
  type Payroll,
  payrollOf,
  salaryPaymentExpense,
  salaryPaymentsOf,
  salaryRatesOf,
} from '@fabric/contracts';
import { monthOf, type SalaryMonth, salaryMonthOf, salaryRateFor } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import type { ExpensesRepository } from './expenses';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class EmployeeTable extends SyncedTable<Employee> {
  constructor(store: LocalStore) {
    super(store, 'employees', 'employee', employeeSchema);
  }

  async save(input: EmployeeInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(employeeInputSchema, input), id);
  }
}

/** A salary rate is created or voided, never edited (PY4). */
class SalaryRateTable extends SyncedTable<EmployeeSalary> {
  constructor(store: LocalStore) {
    super(store, 'employeeSalaries', 'employee_salary', employeeSalarySchema);
  }

  async create(fields: object, id: string): Promise<string> {
    return this.write(fields, id);
  }
}

export const SALARY_NEEDS_CONFIRMATION = 'salary_payment_needs_confirmation';

/** What a salary payment would need confirmed. */
export interface SalaryWarning {
  /** The payment takes the month's pay above what is due for it. */
  kind: 'over_due';
  dueCents: number;
  paidAfterCents: number;
}

/** One employee of the directory, with how the month asked for stands. */
export interface EmployeeSummary {
  employee: Local<Employee>;
  status: EmployeeStatus;
  /** The monthly salary in force this month (0 before the first rate). */
  currentSalaryCents: number;
  /** Due, paid and still to pay for the month asked for. */
  month: SalaryMonth;
}

export interface EmployeeDirectory {
  month: string;
  /** Working here first, then the ones who left; by name. */
  employees: EmployeeSummary[];
  /** The month's pay across the employees who work here. */
  totals: { dueCents: number; paidCents: number; remainingCents: number };
}

export interface EmployeeDetailView {
  employee: Local<Employee>;
  status: EmployeeStatus;
  currentSalaryCents: number;
  /** Live rates, the latest start first. A start after this month has not taken effect yet. */
  rates: Local<EmployeeSalary>[];
  /** The month asked for. */
  month: SalaryMonth;
  /** Month by month, oldest first, through the month asked for (and any later month that was paid). */
  payroll: Payroll;
  /** Live salary payments, the latest paid first. */
  payments: Local<Expense>[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ar');

/**
 * Employees and their pay (ADR 0022, docs/accounting-assumptions.md PY1–PY6), saved on the device
 * first. An employee is not a partner. A salary payment is an ordinary expense linked to the
 * employee and the month it pays, so it goes through the expenses repository; what is due, paid
 * and still owed comes from @fabric/contracts' payrollOf over @fabric/core's payroll rules.
 */
export class EmployeesRepository {
  private readonly employees: EmployeeTable;
  private readonly rates: SalaryRateTable;

  constructor(
    private readonly store: LocalStore,
    private readonly expenses: ExpensesRepository,
  ) {
    this.employees = new EmployeeTable(store);
    this.rates = new SalaryRateTable(store);
  }

  /** The employees with their pay for `month` (YYYY-MM). */
  async list(month: string): Promise<EmployeeDirectory> {
    const { db } = this.store;
    const [employees, rates, expenses] = await Promise.all([
      db.employees.toArray(),
      db.employeeSalaries.toArray(),
      db.expenses.filter((expense) => expense.employeeId !== null).toArray(),
    ]);
    const today = shopToday(this.store.now());
    const rows = employees
      .filter((employee) => employee.voidedAt === null)
      .map((employee): EmployeeSummary => {
        const employeeRates = salaryRatesOf(rates, employee.id);
        return {
          employee,
          status: employeeStatusOf(employee, today),
          currentSalaryCents: salaryRateFor(employeeRates, monthOf(today))?.amountCents ?? 0,
          month: salaryMonthOf(
            employeeRates,
            salaryPaymentsOf(expenses, employee.id),
            month,
            employee.endDate,
          ),
        };
      })
      .sort(
        (a, b) =>
          Number(b.status === 'active') - Number(a.status === 'active') ||
          byName(a.employee, b.employee),
      );
    const working = rows.filter(({ status }) => status === 'active');
    const total = (pick: (row: SalaryMonth) => number) =>
      working.reduce((sum, { month: row }) => sum + pick(row), 0);
    return {
      month,
      employees: rows,
      totals: {
        dueCents: total((row) => row.dueCents),
        paidCents: total((row) => row.paidCents),
        remainingCents: total((row) => row.remainingCents),
      },
    };
  }

  /** One employee with their pay through `month`; undefined once removed. */
  async get(id: string, month: string): Promise<EmployeeDetailView | undefined> {
    const { db } = this.store;
    const employee = await db.employees.get(id);
    if (!employee || employee.voidedAt !== null) return undefined;
    const [rates, expenses] = await Promise.all([
      db.employeeSalaries.where('employeeId').equals(id).toArray(),
      db.expenses.where('employeeId').equals(id).toArray(),
    ]);
    const today = shopToday(this.store.now());
    const live = rates.filter((rate) => rate.voidedAt === null);
    return {
      employee,
      status: employeeStatusOf(employee, today),
      currentSalaryCents: salaryRateFor(salaryRatesOf(rates, id), monthOf(today))?.amountCents ?? 0,
      rates: live.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
      month: salaryMonthOf(
        salaryRatesOf(rates, id),
        salaryPaymentsOf(expenses, id),
        month,
        employee.endDate,
      ),
      payroll: payrollOf(employee, rates, expenses, month),
      payments: expenses
        .filter((expense) => expense.voidedAt === null && expense.salaryMonth !== null)
        .sort(
          (a, b) =>
            (b.paidDate ?? '').localeCompare(a.paidDate ?? '') ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    };
  }

  save(input: EmployeeInput, id?: string): Promise<string> {
    return this.employees.save(input, id);
  }

  /** Removes an employee who was never paid; one who was is ended with an end date instead (PY6). */
  async remove(id: string, reason: string): Promise<void> {
    const expenses = await this.store.db.expenses.where('employeeId').equals(id).toArray();
    const issues = checkEmployeeVoid(id, expenses);
    if (issues.length > 0) throw new ValidationError(issues);
    await this.employees.void(id, reason);
  }

  /**
   * A new monthly salary from the first day of a month (PY2, PY4). A rate is never changed: to
   * correct one that has not started, void it and add the right one.
   */
  async setSalary(input: EmployeeSalaryInput): Promise<string> {
    const fields = parseOrThrow(employeeSalaryInputSchema, input);
    const { db } = this.store;
    const [employee, rates] = await Promise.all([
      db.employees.get(fields.employeeId),
      db.employeeSalaries.toArray(),
    ]);
    const id = crypto.randomUUID();
    const issues = checkSalaryRate(
      { id, ...fields },
      {
        today: shopToday(this.store.now()),
        employee: employee?.voidedAt === null ? employee : undefined,
        rates,
      },
    );
    if (issues.length > 0) throw new ValidationError(issues);
    return this.rates.create(fields, id);
  }

  async voidSalary(id: string, reason: string): Promise<void> {
    const rate = await this.rates.get(id);
    const issues = rate ? checkSalaryRateVoid(rate, shopToday(this.store.now())) : [];
    if (issues.length > 0) throw new ValidationError(issues);
    await this.rates.void(id, reason);
  }

  /** What a payment would need confirmed: paying a month more than is due for it. */
  async paymentWarnings(input: NewSalaryPaymentInput): Promise<SalaryWarning[]> {
    const parsed = newSalaryPaymentSchema.safeParse(input);
    if (!parsed.success) return [];
    const detail = await this.get(parsed.data.employeeId, parsed.data.month);
    if (!detail) return [];
    const paidAfterCents = detail.month.paidCents + parsed.data.amountCents;
    return paidAfterCents > detail.month.dueCents
      ? [{ kind: 'over_due', dueCents: detail.month.dueCents, paidAfterCents }]
      : [];
  }

  /**
   * Pays a salary, or part of it: an expense in the wages category, paid on `paidDate`, linked to
   * the employee and the month (PY3). It counts in the period of its paid date (S6), like any
   * expense; the settlement has no second salary calculation (PY1).
   */
  async recordPayment(input: NewSalaryPaymentInput, confirmed = false): Promise<string> {
    const parsed = parseOrThrow(newSalaryPaymentSchema, input);
    // What is wrong comes before what to confirm: a month before they started is not a "more than due".
    const issues = checkSalaryPayment(
      salaryPaymentExpense(parsed),
      await this.store.db.employees.toArray(),
    );
    if (issues.length > 0) throw new ValidationError(issues);
    if (!confirmed && (await this.paymentWarnings(input)).length > 0) {
      throw new ValidationError([
        { path: ['confirmed'], message: SALARY_NEEDS_CONFIRMATION, code: 'custom' },
      ]);
    }
    return this.expenses.save(salaryPaymentExpense(parsed));
  }

  /** A payment entered by mistake: voided with the reason; the month owes it again. */
  voidPayment(expenseId: string, reason: string): Promise<void> {
    return this.expenses.void(expenseId, reason);
  }
}
