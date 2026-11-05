import { checkSalaryPayment, type Expense, type RecurringExpense } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, isNull, lte, or } from 'drizzle-orm';
import { baseOf, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type ExpenseRow = typeof schema.expense.$inferSelect;

function expenseOf(row: ExpenseRow): SyncedRow<Expense> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      date: row.date,
      category: row.category,
      amountCents: row.amountCents,
      paidDate: row.paidDate,
      note: row.note,
      recurringExpenseId: row.recurringExpenseId,
      employeeId: row.employeeId,
      salaryMonth: row.salaryMonth,
    },
  };
}

/**
 * Expenses (SPEC §5): mutable, last write wins; voided, never deleted. One that carries an
 * employee and a month is a salary payment (PY3): an ordinary expense that is also checked as one.
 */
@Injectable()
export class ExpenseRepository implements SyncHandler<'expense'> {
  readonly entity = 'expense' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Expense> | undefined> {
    const [row] = await this.tx.db.select().from(schema.expense).where(eq(schema.expense.id, id));
    return row && expenseOf(row);
  }

  async write(record: Expense): Promise<SyncedRow<Expense>> {
    if (record.employeeId !== null || record.salaryMonth !== null) {
      const issues = checkSalaryPayment(record, await this.employees());
      if (issues.length > 0) {
        throw new SyncRejection('validation_failed', 'Invalid salary payment', issues);
      }
    }
    const fields = {
      date: record.date,
      category: record.category,
      amountCents: record.amountCents,
      paidDate: record.paidDate,
      note: record.note,
      recurringExpenseId: record.recurringExpenseId,
      employeeId: record.employeeId,
      salaryMonth: record.salaryMonth,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.expense)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.expense.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return expenseOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Expense>> {
    const [row] = await this.tx.db
      .update(schema.expense)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.expense.id, id))
      .returning();
    if (!row) throw new Error(`no expense ${id}`);
    return expenseOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Expense>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.expense)
      .where(gt(schema.expense.serverSeq, since))
      .orderBy(asc(schema.expense.serverSeq))
      .limit(limit);
    return rows.map(expenseOf);
  }

  /** Live expenses dated or paid between two dates. */
  async listBetween(start: string, end: string): Promise<SyncedRow<Expense>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.expense)
      .where(
        and(
          isNull(schema.expense.voidedAt),
          or(
            and(gte(schema.expense.date, start), lte(schema.expense.date, end)),
            and(gte(schema.expense.paidDate, start), lte(schema.expense.paidDate, end)),
          ),
        ),
      )
      .orderBy(asc(schema.expense.date), asc(schema.expense.createdAt));
    return rows.map(expenseOf);
  }

  async listAll(): Promise<SyncedRow<Expense>[]> {
    const rows = await this.tx.db.select().from(schema.expense);
    return rows.map(expenseOf);
  }

  /** The employees a salary payment may name (checkSalaryPayment). */
  private async employees() {
    const rows = await this.tx.db
      .select({
        id: schema.employee.id,
        startDate: schema.employee.startDate,
        voidedAt: schema.employee.voidedAt,
      })
      .from(schema.employee);
    return rows.map((row) => ({ ...row, voidedAt: row.voidedAt?.toISOString() ?? null }));
  }
}

type RecurringRow = typeof schema.recurringExpense.$inferSelect;

function recurringOf(row: RecurringRow): SyncedRow<RecurringExpense> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      name: row.name,
      category: row.category,
      amountCents: row.amountCents,
      dayOfMonth: row.dayOfMonth,
      active: row.active,
    },
  };
}

/** Recurring expense templates (SPEC §5): mutable, paused with `active`, voided to remove. */
@Injectable()
export class RecurringExpenseRepository implements SyncHandler<'recurring_expense'> {
  readonly entity = 'recurring_expense' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<RecurringExpense> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.recurringExpense)
      .where(eq(schema.recurringExpense.id, id));
    return row && recurringOf(row);
  }

  async write(record: RecurringExpense): Promise<SyncedRow<RecurringExpense>> {
    const fields = {
      name: record.name,
      category: record.category,
      amountCents: record.amountCents,
      dayOfMonth: record.dayOfMonth,
      active: record.active,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.recurringExpense)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.recurringExpense.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return recurringOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<RecurringExpense>> {
    const [row] = await this.tx.db
      .update(schema.recurringExpense)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.recurringExpense.id, id))
      .returning();
    if (!row) throw new Error(`no recurring expense ${id}`);
    return recurringOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<RecurringExpense>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.recurringExpense)
      .where(gt(schema.recurringExpense.serverSeq, since))
      .orderBy(asc(schema.recurringExpense.serverSeq))
      .limit(limit);
    return rows.map(recurringOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<RecurringExpense>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.recurringExpense)
      .where(includeVoided ? undefined : isNull(schema.recurringExpense.voidedAt))
      .orderBy(asc(schema.recurringExpense.dayOfMonth), asc(schema.recurringExpense.name));
    return rows.map(recurringOf);
  }
}
