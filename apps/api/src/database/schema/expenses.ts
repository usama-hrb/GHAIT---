import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';
import { employee } from './employees.js';

/** SPEC §13 `recurring_expense`: a template the app reminds about (BUILD_PROMPTS 4.1). */
export const recurringExpense = pgTable(
  'recurring_expense',
  {
    ...baseColumns('recurring_expense'),
    name: text().notNull(),
    category: text().notNull(),
    /** Null for a bill whose amount changes (typed when it is created). */
    amountCents: bigint({ mode: 'number' }),
    dayOfMonth: integer().notNull(),
    active: boolean().notNull(),
  },
  (table) => [
    check('recurring_expense_day_valid', sql`${table.dayOfMonth} BETWEEN 1 AND 31`),
    check(
      'recurring_expense_amount_positive',
      sql`${table.amountCents} IS NULL OR ${table.amountCents} > 0`,
    ),
  ],
);

/** SPEC §13 `expense`: counts in the period of its paid date (SPEC §5, S6). */
export const expense = pgTable(
  'expense',
  {
    ...baseColumns('expense'),
    date: date({ mode: 'string' }).notNull(),
    category: text().notNull(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    paidDate: date({ mode: 'string' }),
    note: text(),
    recurringExpenseId: uuid().references(() => recurringExpense.id),
    /** The employee a salary payment pays, and the month (YYYY-MM) it is for: both or neither (PY3). */
    employeeId: uuid().references(() => employee.id),
    salaryMonth: text(),
  },
  (table) => [
    index('expense_date_idx').on(table.date),
    index('expense_paid_date_idx').on(table.paidDate),
    index('expense_employee_idx').on(table.employeeId),
    check('expense_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'expense_salary_link_valid',
      sql`(${table.employeeId} IS NULL) = (${table.salaryMonth} IS NULL)`,
    ),
    check(
      'expense_salary_month_valid',
      sql`${table.salaryMonth} IS NULL OR ${table.salaryMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    // A salary is booked as wages, and only once paid (PY3).
    check(
      'expense_salary_booked_valid',
      sql`${table.employeeId} IS NULL OR (${table.category} = 'wages' AND ${table.paidDate} IS NOT NULL)`,
    ),
  ],
);
