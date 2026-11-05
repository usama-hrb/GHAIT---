import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/**
 * SPEC §13 `employee`: someone the shop pays a salary. Not a partner: no weight in the profit
 * split, no capital (PY1, ADR 0022). Never removed once paid (PY6): they end with `end_date`.
 */
export const employee = pgTable(
  'employee',
  {
    ...baseColumns('employee'),
    name: text().notNull(),
    phone: text(),
    position: text(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    notes: text(),
  },
  (table) => [
    check(
      'employee_dates_valid',
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

/**
 * SPEC §13 `employee_salary`: what an employee earns a month from the first day of a month on;
 * created or voided, never edited, so a raise never rewrites a month that is over (PY4).
 */
export const employeeSalary = pgTable(
  'employee_salary',
  {
    ...baseColumns('employee_salary'),
    employeeId: uuid()
      .notNull()
      .references(() => employee.id),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    amountCents: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    index('employee_salary_employee_idx').on(table.employeeId),
    uniqueIndex('employee_salary_live_month_key')
      .on(table.employeeId, table.effectiveFrom)
      .where(sql`${table.voidedAt} IS NULL`),
    check('employee_salary_month_start', sql`EXTRACT(DAY FROM ${table.effectiveFrom}) = 1`),
    check('employee_salary_amount_valid', sql`${table.amountCents} >= 0`),
  ],
);
