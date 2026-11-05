import {
  checkSalaryPayment,
  type Expense,
  type ExpenseInput,
  expenseInputSchema,
  expenseItemOf,
  expenseSchema,
  type RecurringExpense,
  type RecurringExpenseInput,
  recurringExpenseInputSchema,
  recurringExpenseSchema,
  recurringTemplateOf,
  shopDate,
} from '@fabric/contracts';
import {
  dueDateIn,
  type ExpenseStanding,
  expenseStanding,
  monthBounds,
  type MonthExpenses,
  monthlyExpenses,
  monthOf,
  type NextDue,
  nextRecurringDue,
  type Reminder,
  recurringReminders,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import { type SettingsRepository, SyncedTable } from './tables';

class ExpenseTable extends SyncedTable<Expense> {
  constructor(store: LocalStore) {
    super(store, 'expenses', 'expense', expenseSchema);
  }

  /**
   * An expense that pays a salary names the employee and the month it pays, and is paid
   * (checkSalaryPayment, as the server checks it: PY3).
   */
  async save(input: ExpenseInput, id?: string): Promise<string> {
    const fields = parseOrThrow(expenseInputSchema, input);
    const issues = checkSalaryPayment(fields, await this.store.db.employees.toArray());
    if (issues.length > 0) throw new ValidationError(issues);
    return this.write(fields, id);
  }
}

class RecurringTable extends SyncedTable<RecurringExpense> {
  constructor(store: LocalStore) {
    super(store, 'recurringExpenses', 'recurring_expense', recurringExpenseSchema);
  }

  async save(input: RecurringExpenseInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(recurringExpenseInputSchema, input), id);
  }
}

export interface ExpenseCategory {
  key: string;
  label: string;
}

/** One expense of a month's list, with how it counts in that month (@fabric/core expenseStanding). */
export interface MonthRow {
  expense: Local<Expense>;
  /** paid: paid in the month; unpaid: still to pay; other: dated here but counted in another month. */
  standing: ExpenseStanding;
  /** An unpaid bill of an earlier month, still to pay. */
  carriedOver: boolean;
  /** For `other`: the month (YYYY-MM) it was paid in, where it counts. */
  countsIn: string | null;
  /** The employee whose salary it pays, if it is a salary payment (ADR 0022). */
  employeeName: string | null;
}

export interface MonthView {
  month: string;
  /**
   * The month's expenses, newest first: those that count in it (paid in it, or still unpaid up to
   * its end) and those dated in it that were paid in another month.
   */
  rows: MonthRow[];
  /** @fabric/core monthlyExpenses: paid in the month (S6), per category, still unpaid, the total. */
  totals: MonthExpenses;
}

/** A recurring template and when its next bill is due. */
export interface TemplateView {
  template: Local<RecurringExpense>;
  /** @fabric/core nextRecurringDue: null for a paused template. */
  next: NextDue | null;
}

export interface ReminderView extends Reminder {
  template: Local<RecurringExpense>;
}

/** The day a template was set up (reminders start from it). */
const sinceOf = (template: RecurringExpense) => shopDate(new Date(template.createdAt));

/**
 * Expenses and recurring bills (SPEC §5, BUILD_PROMPTS 4.1), saved on the device first. Totals
 * and reminders come from @fabric/core (monthlyExpenses, recurringReminders).
 */
export class ExpensesRepository {
  private readonly expenses: ExpenseTable;
  private readonly templates: RecurringTable;

  constructor(
    private readonly store: LocalStore,
    private readonly settings: SettingsRepository,
  ) {
    this.expenses = new ExpenseTable(store);
    this.templates = new RecurringTable(store);
  }

  /** The categories in effect today (the `expense_categories` setting). */
  categories(): Promise<ExpenseCategory[]> {
    return this.settings.get('expense_categories', shopToday(this.store.now()));
  }

  get(id: string): Promise<Local<Expense> | undefined> {
    return this.expenses.get(id);
  }

  async month(month: string): Promise<MonthView> {
    const all = await this.store.db.expenses.toArray();
    const names = new Map(
      (await this.store.db.employees.toArray()).map((employee) => [employee.id, employee.name]),
    );
    const { start, end } = monthBounds(month);
    const rows = all
      .filter((expense) => expense.voidedAt === null)
      .map((expense): MonthRow => {
        const standing = expenseStanding(expenseItemOf(expense), month);
        return {
          expense,
          standing,
          carriedOver: standing === 'unpaid' && expense.date < start,
          countsIn: standing === 'other' && expense.paidDate ? monthOf(expense.paidDate) : null,
          employeeName:
            expense.employeeId === null ? null : (names.get(expense.employeeId) ?? null),
        };
      })
      .filter(
        ({ expense, standing }) =>
          standing !== 'other' || (expense.date >= start && expense.date <= end),
      )
      .sort(
        (a, b) =>
          b.expense.date.localeCompare(a.expense.date) ||
          b.expense.createdAt.localeCompare(a.expense.createdAt),
      );
    return { month, rows, totals: monthlyExpenses(all.map(expenseItemOf), month) };
  }

  /** Live templates, by due day. */
  async recurring(): Promise<Local<RecurringExpense>[]> {
    const templates = await this.store.db.recurringExpenses.toArray();
    return templates
      .filter((template) => template.voidedAt === null)
      .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.name.localeCompare(b.name, 'ar'));
  }

  /** Live templates with their next bill: what is due first comes first, paused ones last (E5). */
  async recurringBills(): Promise<TemplateView[]> {
    const today = shopToday(this.store.now());
    const [templates, expenses, leadDays] = await Promise.all([
      this.recurring(),
      this.store.db.expenses.toArray(),
      this.settings.get('expense_reminder_days', today),
    ]);
    const items = expenses.map(expenseItemOf);
    return templates
      .map((template) => ({
        template,
        next: nextRecurringDue({
          template: recurringTemplateOf(template, sinceOf(template)),
          expenses: items,
          today,
          leadDays,
        }),
      }))
      .sort(
        (a, b) =>
          Number(a.next === null) - Number(b.next === null) ||
          (a.next?.dueDate ?? '').localeCompare(b.next?.dueDate ?? '') ||
          a.template.name.localeCompare(b.template.name, 'ar'),
      );
  }

  /** Bills to create from their templates, from `expense_reminder_days` before they are due. */
  async reminders(): Promise<ReminderView[]> {
    const today = shopToday(this.store.now());
    const [templates, expenses, leadDays] = await Promise.all([
      this.recurring(),
      this.store.db.expenses.toArray(),
      this.settings.get('expense_reminder_days', today),
    ]);
    const byId = new Map(templates.map((template) => [template.id, template]));
    return recurringReminders({
      templates: templates.map((template) => recurringTemplateOf(template, sinceOf(template))),
      expenses: expenses.map(expenseItemOf),
      today,
      leadDays,
    }).flatMap((reminder) => {
      const template = byId.get(reminder.templateId);
      return template ? [{ ...reminder, template }] : [];
    });
  }

  save(input: ExpenseInput, id?: string): Promise<string> {
    return this.expenses.save(input, id);
  }

  /** Paid (on `paidDate`) or back to unpaid (null). */
  async setPaid(id: string, paidDate: string | null): Promise<void> {
    const expense = await this.expenses.get(id);
    if (!expense) throw new Error(`No expense ${id}`);
    await this.expenses.save(
      {
        date: expense.date,
        category: expense.category,
        amountCents: expense.amountCents,
        paidDate,
        note: expense.note,
        recurringExpenseId: expense.recurringExpenseId,
        // A salary payment stays one; it cannot go back to unpaid (checkSalaryPayment).
        employeeId: expense.employeeId,
        salaryMonth: expense.salaryMonth,
      },
      id,
    );
  }

  void(id: string, reason: string): Promise<void> {
    return this.expenses.void(id, reason);
  }

  saveTemplate(input: RecurringExpenseInput, id?: string): Promise<string> {
    return this.templates.save(input, id);
  }

  voidTemplate(id: string, reason: string): Promise<void> {
    return this.templates.void(id, reason);
  }

  /**
   * A month's bill from its template, in one tap (SPEC §5): dated on its due date (E1), with the
   * amount typed for a variable bill such as electricity, paid now or not. Refused when that
   * month's bill was already created from the template (E6).
   */
  async createFromTemplate(input: {
    templateId: string;
    month: string;
    amountCents: number;
    paidDate: string | null;
  }): Promise<string> {
    const template = await this.templates.get(input.templateId);
    if (!template) throw new Error(`No recurring expense ${input.templateId}`);
    // One bill a month per template (E6): a second tap, or another device's, creates nothing.
    const already = (await this.store.db.expenses.toArray()).some(
      (expense) =>
        expense.voidedAt === null &&
        expense.recurringExpenseId === template.id &&
        monthOf(expense.date) === input.month,
    );
    if (already) {
      throw new ValidationError([
        { path: ['month'], message: 'recurring_expense_already_created', code: 'custom' },
      ]);
    }
    return this.expenses.save({
      date: dueDateIn(input.month, template.dayOfMonth),
      category: template.category,
      amountCents: input.amountCents,
      paidDate: input.paidDate,
      note: template.name,
      recurringExpenseId: template.id,
    });
  }
}
