import type { ExpenseItem, RecurringTemplate } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';

/** A category's key (the label lives in the `expense_categories` setting). */
export const expenseCategoryKeySchema = z.string().regex(/^[a-z0-9_-]{1,40}$/);

const expenseFields = z.object({
  /** The bill's date (for a recurring bill: its due date that month). */
  date: isoDateSchema,
  category: expenseCategoryKeySchema,
  amountCents: amountCentsSchema.min(1),
  /** Null while unpaid. The expense counts in the period of this date (SPEC §5, S6). */
  paidDate: isoDateSchema.nullable().default(null),
  note: optionalTextSchema(500).default(null),
  /** The recurring template it was created from (BUILD_PROMPTS 4.1). */
  recurringExpenseId: idSchema.nullable().default(null),
});

/** SPEC §13 `expense`: mutable (edited, or voided with a reason; never deleted). */
export const expenseInputSchema = expenseFields;
export type ExpenseInput = z.input<typeof expenseInputSchema>;
export const expenseSchema = recordBaseSchema.extend(expenseFields.shape);
export type Expense = z.output<typeof expenseSchema>;
export const storedExpenseSchema = expenseSchema.extend({ serverSeq: z.int().positive() });
export type StoredExpense = z.output<typeof storedExpenseSchema>;

const recurringFields = z.object({
  /** "كراء المحل", "كهرباء": what the reminder says. */
  name: z.string().trim().min(1).max(80),
  category: expenseCategoryKeySchema,
  /** Null for a bill whose amount changes (electricity): typed when it is created. */
  amountCents: amountCentsSchema.min(1).nullable().default(null),
  dayOfMonth: z.int().min(1).max(31),
  active: z.boolean().default(true),
});

/** SPEC §13 `recurring_expense`: a template (rent, electricity…) the app reminds about. */
export const recurringExpenseInputSchema = recurringFields;
export type RecurringExpenseInput = z.input<typeof recurringExpenseInputSchema>;
export const recurringExpenseSchema = recordBaseSchema.extend(recurringFields.shape);
export type RecurringExpense = z.output<typeof recurringExpenseSchema>;
export const storedRecurringExpenseSchema = recurringExpenseSchema.extend({
  serverSeq: z.int().positive(),
});

/** An expense as @fabric/core's expense rules take it. */
export function expenseItemOf(expense: Expense): ExpenseItem {
  return {
    date: expense.date,
    category: expense.category,
    amountCents: expense.amountCents,
    paidDate: expense.paidDate,
    voided: expense.voidedAt !== null,
    recurringId: expense.recurringExpenseId,
  };
}

/** A template as @fabric/core's reminders take it; it exists from the day it was set up. */
export function recurringTemplateOf(
  template: RecurringExpense,
  sinceDate: string,
): RecurringTemplate {
  return {
    id: template.id,
    dayOfMonth: template.dayOfMonth,
    active: template.active && template.voidedAt === null,
    since: sinceDate,
  };
}

export const monthExpensesSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  paidCents: z.int(),
  paidByCategory: z.record(z.string(), z.int()),
  unpaidCents: z.int(),
  unpaidCount: z.int(),
});
export type MonthExpensesSummary = z.output<typeof monthExpensesSchema>;
