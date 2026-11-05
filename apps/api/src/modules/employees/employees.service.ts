import {
  type EmployeeInput,
  employeeInputSchema,
  type EmployeeSalaryInput,
  employeeSalaryInputSchema,
  type Payroll,
  payrollOf,
  SERVER_DEVICE_ID,
  shopDate,
  type SyncEntity,
} from '@fabric/contracts';
import { monthOf } from '@fabric/core';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import { EmployeeRepository, EmployeeSalaryRepository } from './employees.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Employees, their salary rates and what each is owed (docs/accounting-assumptions.md PY1–PY6).
 * Devices write through sync; these REST operations take the same SyncService path (validation,
 * audit). A salary payment is an expense (PUT /expenses/:id with employeeId and salaryMonth), so
 * payroll has no writes of its own, and the ledger is worked out from the records.
 */
@Injectable()
export class EmployeesService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly employees: EmployeeRepository,
    private readonly salaries: EmployeeSalaryRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.employees);
    this.registry.register(this.salaries);
  }

  async list(includeVoided: boolean) {
    return (await this.employees.list(includeVoided)).map(stored);
  }

  async get(id: string) {
    const row = await this.employees.find(id);
    if (!row) throw new AppHttpException('not_found', `No employee ${id}`, HttpStatus.NOT_FOUND);
    return stored(row);
  }

  put(id: string, input: EmployeeInput) {
    return this.save('employee', id, employeeInputSchema.parse(input));
  }

  async salaryRates(employeeId: string) {
    await this.get(employeeId);
    return (await this.salaries.listFor(employeeId)).map(stored);
  }

  putSalary(id: string, input: EmployeeSalaryInput) {
    return this.save('employee_salary', id, employeeSalaryInputSchema.parse(input));
  }

  /** The employee's pay month by month through `through` (default: this month). */
  async payroll(employeeId: string, through: string | undefined): Promise<Payroll> {
    const employee = await this.get(employeeId);
    const [rates, payments] = await Promise.all([
      this.salaries.listFor(employeeId),
      this.employees.payments(employeeId),
    ]);
    return payrollOf(
      employee,
      rates.map((row) => row.record),
      payments,
      through ?? monthOf(shopDate(new Date())),
    );
  }

  async void(entity: 'employee' | 'employee_salary', id: string, reason: string) {
    return stored(await this.sync.voidDirect(entity, id, reason));
  }

  /** Creates or updates through SyncService, keeping createdAt and a void. */
  private async save(entity: SyncEntity, id: string, fields: object) {
    const current = await this.sync.find(entity, id);
    const now = new Date().toISOString();
    return stored(
      await this.sync.saveDirect(entity, {
        ...fields,
        id,
        createdAt: current?.record.createdAt ?? now,
        updatedAt: now,
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
        voidedAt: current?.record.voidedAt ?? null,
      }),
    );
  }
}
