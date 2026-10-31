import {
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
  monthBounds,
  type MonthExpenses,
  monthlyExpenses,
  type Reminder,
  recurringReminders,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow } from './errors';
import type { LocalStore } from './store';
import { type SettingsRepository, SyncedTable } from './tables';

class ExpenseTable extends SyncedTable<Expense> {
  constructor(store: LocalStore) {
    super(store, 'expenses', 'expense', expenseSchema);
  }

  async save(input: ExpenseInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(expenseInputSchema, input), id);
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

export interface MonthView {
  month: string;
  /** Live expenses dated or paid in the month, by date. */
  expenses: Local<Expense>[];
  /** @fabric/core monthlyExpenses: paid in the month (S6), per category, still unpaid. */
  totals: MonthExpenses;
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
    const { start, end } = monthBounds(month);
    const inMonth = (date: string | null) => date !== null && date >= start && date <= end;
    return {
      month,
      expenses: all
        .filter(
          (expense) =>
            expense.voidedAt === null && (inMonth(expense.date) || inMonth(expense.paidDate)),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
      totals: monthlyExpenses(all.map(expenseItemOf), month),
    };
  }

  /** Live templates, by due day. */
  async recurring(): Promise<Local<RecurringExpense>[]> {
    const templates = await this.store.db.recurringExpenses.toArray();
    return templates
      .filter((template) => template.voidedAt === null)
      .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.name.localeCompare(b.name, 'ar'));
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
   * amount typed for a variable bill such as electricity, paid now or not.
   */
  async createFromTemplate(input: {
    templateId: string;
    month: string;
    amountCents: number;
    paidDate: string | null;
  }): Promise<string> {
    const template = await this.templates.get(input.templateId);
    if (!template) throw new Error(`No recurring expense ${input.templateId}`);
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
