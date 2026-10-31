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
  },
  (table) => [
    index('expense_date_idx').on(table.date),
    index('expense_paid_date_idx').on(table.paidDate),
    check('expense_amount_positive', sql`${table.amountCents} > 0`),
  ],
);
