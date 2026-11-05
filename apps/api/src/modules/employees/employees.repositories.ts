import {
  checkEmployee,
  checkEmployeeVoid,
  checkSalaryRate,
  checkSalaryRateVoid,
  checkUnchanged,
  type Employee,
  type EmployeeSalary,
  PAYROLL_ISSUES,
  shopDate,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type EmployeeRow = typeof schema.employee.$inferSelect;

function employeeOf(row: EmployeeRow): SyncedRow<Employee> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      name: row.name,
      phone: row.phone,
      position: row.position,
      startDate: row.startDate,
      endDate: row.endDate,
      notes: row.notes,
    },
  };
}

/**
 * Employees (PY1, PY6): mutable, last write wins; ended with an end date. Never removed once paid:
 * their salary payments are expenses that stay in the books.
 */
@Injectable()
export class EmployeeRepository implements SyncHandler<'employee'> {
  readonly entity = 'employee' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Employee> | undefined> {
    const [row] = await this.tx.db.select().from(schema.employee).where(eq(schema.employee.id, id));
    return row && employeeOf(row);
  }

  async write(record: Employee): Promise<SyncedRow<Employee>> {
    const issues = checkEmployee(record);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'Invalid employee', issues);
    }
    const fields = {
      name: record.name,
      phone: record.phone,
      position: record.position,
      startDate: record.startDate,
      endDate: record.endDate,
      notes: record.notes,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.employee)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.employee.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return employeeOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Employee>> {
    const paid = await this.tx.db
      .select({ employeeId: schema.expense.employeeId, voidedAt: schema.expense.voidedAt })
      .from(schema.expense)
      .where(and(eq(schema.expense.employeeId, id), isNull(schema.expense.voidedAt)));
    const issues = checkEmployeeVoid(
      id,
      paid.map((row) => ({ employeeId: row.employeeId, voidedAt: null })),
    );
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'An employee who was paid stays', issues);
    }
    const [row] = await this.tx.db
      .update(schema.employee)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.employee.id, id))
      .returning();
    if (!row) throw new Error(`no employee ${id}`);
    return employeeOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Employee>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.employee)
      .where(gt(schema.employee.serverSeq, since))
      .orderBy(asc(schema.employee.serverSeq))
      .limit(limit);
    return rows.map(employeeOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<Employee>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.employee)
      .where(includeVoided ? undefined : isNull(schema.employee.voidedAt))
      .orderBy(asc(schema.employee.name), asc(schema.employee.createdAt));
    return rows.map(employeeOf);
  }

  /** What an employee was paid: the live salary expenses linked to them, whatever their month. */
  async payments(employeeId: string) {
    return this.tx.db
      .select({
        employeeId: schema.expense.employeeId,
        salaryMonth: schema.expense.salaryMonth,
        amountCents: schema.expense.amountCents,
        paidDate: schema.expense.paidDate,
      })
      .from(schema.expense)
      .where(and(eq(schema.expense.employeeId, employeeId), isNull(schema.expense.voidedAt)))
      .then((rows) => rows.map((row) => ({ ...row, voidedAt: null })));
  }
}

type SalaryRow = typeof schema.employeeSalary.$inferSelect;

function salaryOf(row: SalaryRow): SyncedRow<EmployeeSalary> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      employeeId: row.employeeId,
      effectiveFrom: row.effectiveFrom,
      amountCents: row.amountCents,
    },
  };
}

const SALARY_FIELDS = ['employeeId', 'effectiveFrom', 'amountCents'] as const;

/**
 * "Today" for a rate, as the device that made it saw it: the day it was created, or the server's
 * day if that is earlier. A raise typed offline on the last day of a month still reaches the
 * server in the next one, and a device clock set ahead gains nothing.
 */
function dayOf(moment: Date): string {
  const server = shopDate(new Date());
  const device = shopDate(moment);
  return device < server ? device : server;
}

/** Salary rates (PY2, PY4): created or voided, never edited. */
@Injectable()
export class EmployeeSalaryRepository implements SyncHandler<'employee_salary'> {
  readonly entity = 'employee_salary' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<EmployeeSalary> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.employeeSalary)
      .where(eq(schema.employeeSalary.id, id));
    return row && salaryOf(row);
  }

  async write(record: EmployeeSalary): Promise<SyncedRow<EmployeeSalary>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(
        current.record,
        record,
        SALARY_FIELDS,
        PAYROLL_ISSUES.rateFixed,
      );
      if (issues.length > 0) {
        throw new SyncRejection('validation_failed', 'A salary rate is never edited', issues);
      }
      return current;
    }
    const [employee] = await this.tx.db
      .select({ startDate: schema.employee.startDate, voidedAt: schema.employee.voidedAt })
      .from(schema.employee)
      .where(eq(schema.employee.id, record.employeeId));
    const issues = checkSalaryRate(record, {
      today: dayOf(new Date(record.createdAt)),
      employee: employee && employee.voidedAt === null ? employee : undefined,
      rates: (await this.listFor(record.employeeId)).map((row) => row.record),
    });
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'Invalid salary rate', issues);
    }
    const [row] = await this.tx.db
      .insert(schema.employeeSalary)
      .values({
        ...baseValues(record),
        employeeId: record.employeeId,
        effectiveFrom: record.effectiveFrom,
        amountCents: record.amountCents,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return salaryOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<EmployeeSalary>> {
    const current = await this.find(id);
    const issues = current ? checkSalaryRateVoid(current.record, dayOf(at)) : [];
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'A rate that has started stays', issues);
    }
    const [row] = await this.tx.db
      .update(schema.employeeSalary)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.employeeSalary.id, id))
      .returning();
    if (!row) throw new Error(`no salary rate ${id}`);
    return salaryOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<EmployeeSalary>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.employeeSalary)
      .where(gt(schema.employeeSalary.serverSeq, since))
      .orderBy(asc(schema.employeeSalary.serverSeq))
      .limit(limit);
    return rows.map(salaryOf);
  }

  /** Every rate of an employee, voided ones included, oldest first. */
  async listFor(employeeId: string): Promise<SyncedRow<EmployeeSalary>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.employeeSalary)
      .where(eq(schema.employeeSalary.employeeId, employeeId))
      .orderBy(asc(schema.employeeSalary.effectiveFrom), asc(schema.employeeSalary.createdAt));
    return rows.map(salaryOf);
  }
}
