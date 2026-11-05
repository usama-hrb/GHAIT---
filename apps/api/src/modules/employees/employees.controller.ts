import {
  type EmployeeInput,
  employeeInputSchema,
  type EmployeeSalaryInput,
  employeeSalaryInputSchema,
  idSchema,
  payrollQuerySchema,
  payrollSchema,
  storedEmployeeSalarySchema,
  storedEmployeeSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { EmployeesService } from './employees.service.js';

const listQuerySchema = z.object({ includeVoided: z.stringbool().default(false) });
type ListQuery = z.infer<typeof listQuerySchema>;
type PayrollQuery = z.infer<typeof payrollQuerySchema>;

/** REST access to employees and their pay; the web app does the same offline through sync. */
@ApiTags('employees')
@ApiBearerAuth()
@Controller()
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('employees')
  @ZodResponse(z.array(storedEmployeeSchema))
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.employees.list(query.includeVoided);
  }

  @Get('employees/:id')
  @ZodResponse(storedEmployeeSchema)
  get(@ZodParam('id', idSchema) id: string) {
    return this.employees.get(id);
  }

  @Put('employees/:id')
  @ZodResponse(storedEmployeeSchema)
  put(@ZodParam('id', idSchema) id: string, @ZodBody(employeeInputSchema) body: EmployeeInput) {
    return this.employees.put(id, body);
  }

  /** Refused once the employee has been paid (PY6). */
  @Post('employees/:id/void')
  @HttpCode(200)
  @ZodResponse(storedEmployeeSchema)
  void(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.employees.void('employee', id, body.reason);
  }

  /** Salary rates of an employee, oldest first (voided ones included). */
  @Get('employees/:id/salary')
  @ZodResponse(z.array(storedEmployeeSalarySchema))
  salaryRates(@ZodParam('id', idSchema) id: string) {
    return this.employees.salaryRates(id);
  }

  /** What is due, paid and owed month by month, from the rates and the salary expenses (PY2, PY3). */
  @Get('employees/:id/payroll')
  @ZodResponse(payrollSchema)
  payroll(@ZodParam('id', idSchema) id: string, @ZodQuery(payrollQuerySchema) query: PayrollQuery) {
    return this.employees.payroll(id, query.through);
  }

  @Put('employee-salaries/:id')
  @ZodResponse(storedEmployeeSalarySchema)
  putSalary(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(employeeSalaryInputSchema) body: EmployeeSalaryInput,
  ) {
    return this.employees.putSalary(id, body);
  }

  @Post('employee-salaries/:id/void')
  @HttpCode(200)
  @ZodResponse(storedEmployeeSalarySchema)
  voidSalary(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.employees.void('employee_salary', id, body.reason);
  }
}
