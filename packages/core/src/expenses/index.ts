import { assertInteger } from '../numeric/index.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

function utc(date: string): number {
  const match = DATE.exec(date);
  if (!match) throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parts(month: string): [number, number] {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError(`not a YYYY-MM month: ${month}`);
  return [Number(match[1]), Number(match[2])];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The month (YYYY-MM) of a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  utc(date);
  return date.slice(0, 7);
}

/** The month before `month` (YYYY-MM). */
export function previousMonth(month: string): string {
  const [year, number] = parts(month);
  return number === 1 ? `${String(year - 1)}-12` : `${String(year)}-${pad(number - 1)}`;
}

/** The month after `month` (YYYY-MM). */
export function nextMonth(month: string): string {
  const [year, number] = parts(month);
  return number === 12 ? `${String(year + 1)}-01` : `${String(year)}-${pad(number + 1)}`;
}

/** The first and last day of a month, YYYY-MM-DD. */
export function monthBounds(month: string): { start: string; end: string } {
  const [year, number] = parts(month);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}

/** The day after a YYYY-MM-DD date: where the next settlement period starts (BUILD_PROMPTS 4.3). */
export function dayAfter(date: string): string {
  return new Date(utc(date) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * A recurring expense's due date in a month: its day of the month, or the month's last day when
 * the month is shorter (a bill due on the 31st falls on 28 or 29 February: docs/accounting-assumptions.md E1).
 */
export function dueDateIn(month: string, dayOfMonth: number): string {
  assertInteger(dayOfMonth, 'dayOfMonth', 1);
  if (dayOfMonth > 31) throw new RangeError(`dayOfMonth must be 1–31, got ${String(dayOfMonth)}`);
  const { end } = monthBounds(month);
  const last = Number(end.slice(8));
  return `${month}-${pad(Math.min(dayOfMonth, last))}`;
}

/** An expense as these rules see it (SPEC §5, §13 `expense`). */
export interface ExpenseItem {
  /** The bill's date (YYYY-MM-DD). */
  date: string;
  category: string;
  amountCents: number;
  /** Null while unpaid: the expense counts in the period of this date (S6). */
  paidDate: string | null;
  voided: boolean;
  /** The recurring template it was created from, if any. */
  recurringId: string | null;
}

/** A recurring expense template (SPEC §5, §13 `recurring_expense`). */
export interface RecurringTemplate {
  id: string;
  dayOfMonth: number;
  active: boolean;
  /** When it was set up (YYYY-MM-DD): no reminder for a month before that. */
  since: string;
}

export interface Reminder {
  templateId: string;
  month: string;
  dueDate: string;
  /** upcoming: within the reminder days; due: today; overdue: the date has passed. */
  status: 'upcoming' | 'due' | 'overdue';
  /** Days until the due date (negative when overdue). */
  daysLeft: number;
}

/**
 * Bills to create from their templates (SPEC §5 "يذكّر قبل الموعد", E2): for each active
 * template, this month's and last month's, unless an expense was already created from it for
 * that month; shown from `leadDays` days before the due date until it is created.
 */
export function recurringReminders(input: {
  templates: readonly RecurringTemplate[];
  expenses: readonly ExpenseItem[];
  /** The shop's date, YYYY-MM-DD. */
  today: string;
  leadDays: number;
}): Reminder[] {
  assertInteger(input.leadDays, 'leadDays', 0);
  const today = utc(input.today);
  const thisMonth = monthOf(input.today);
  const created = new Set(
    input.expenses
      .filter((expense) => !expense.voided && expense.recurringId !== null)
      .map((expense) => `${String(expense.recurringId)} ${monthOf(expense.date)}`),
  );
  const reminders: Reminder[] = [];
  for (const template of input.templates) {
    if (!template.active) continue;
    for (const month of [previousMonth(thisMonth), thisMonth]) {
      const dueDate = dueDateIn(month, template.dayOfMonth);
      if (dueDate < template.since || created.has(`${template.id} ${month}`)) continue;
      const daysLeft = Math.round((utc(dueDate) - today) / DAY_MS);
      if (daysLeft > input.leadDays) continue;
      reminders.push({
        templateId: template.id,
        month,
        dueDate,
        status: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due' : 'upcoming',
        daysLeft,
      });
    }
  }
  return reminders.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.templateId.localeCompare(b.templateId),
  );
}

/**
 * Expenses paid between two dates, inclusive (SPEC §5, S6): what the settlement takes off a
 * period's profit. Unpaid and voided expenses count in no period.
 */
export function paidExpensesCents(
  expenses: readonly ExpenseItem[],
  start: string,
  end: string,
): number {
  let total = 0;
  for (const expense of expenses) {
    assertInteger(expense.amountCents, 'amountCents', 1);
    if (expense.voided || expense.paidDate === null) continue;
    if (expense.paidDate >= start && expense.paidDate <= end) total += expense.amountCents;
  }
  return total;
}

export interface MonthExpenses {
  /** Paid in the month (by paid date): what the month's settlement deducts. */
  paidCents: number;
  /** The same, per category. */
  paidByCategory: Record<string, number>;
  /** Not paid yet, whatever their date, up to the month's end: bills still to pay. */
  unpaidCents: number;
  unpaidCount: number;
}

/** A month's expense totals (BUILD_PROMPTS 4.1). */
export function monthlyExpenses(expenses: readonly ExpenseItem[], month: string): MonthExpenses {
  const { start, end } = monthBounds(month);
  const paidByCategory: Record<string, number> = {};
  let unpaidCents = 0;
  let unpaidCount = 0;
  for (const expense of expenses) {
    assertInteger(expense.amountCents, 'amountCents', 1);
    if (expense.voided) continue;
    if (expense.paidDate === null) {
      if (expense.date <= end) {
        unpaidCents += expense.amountCents;
        unpaidCount += 1;
      }
    } else if (expense.paidDate >= start && expense.paidDate <= end) {
      paidByCategory[expense.category] =
        (paidByCategory[expense.category] ?? 0) + expense.amountCents;
    }
  }
  return {
    paidCents: paidExpensesCents(expenses, start, end),
    paidByCategory,
    unpaidCents,
    unpaidCount,
  };
}
