import {
  type ExpenseInput,
  expenseInputSchema,
  expenseItemOf,
  type MonthExpensesSummary,
  type RecurringExpenseInput,
  recurringExpenseInputSchema,
  SERVER_DEVICE_ID,
  type StoredExpense,
  type SyncEntity,
} from '@fabric/contracts';
import { monthBounds, monthlyExpenses } from '@fabric/core';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import { ExpenseRepository, RecurringExpenseRepository } from './expenses.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Expenses and their recurring templates (SPEC §5, BUILD_PROMPTS 4.1). Devices change them
 * through sync; these REST operations take the same SyncService path (validation, audit).
 * Monthly totals come from @fabric/core monthlyExpenses (by paid date, S6).
 */
@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly expenses: ExpenseRepository,
    private readonly recurring: RecurringExpenseRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.expenses);
    this.registry.register(this.recurring);
  }

  /** Expenses dated or paid in the month (YYYY-MM). */
  async month(month: string): Promise<StoredExpense[]> {
    const { start, end } = monthBounds(month);
    return (await this.expenses.listBetween(start, end)).map(stored);
  }

  async summary(month: string): Promise<MonthExpensesSummary> {
    const all = (await this.expenses.listAll()).map((row) => expenseItemOf(row.record));
    return { month, ...monthlyExpenses(all, month) };
  }

  async get(id: string) {
    const row = await this.expenses.find(id);
    if (!row) throw new AppHttpException('not_found', `No expense ${id}`, HttpStatus.NOT_FOUND);
    return stored(row);
  }

  put(id: string, input: ExpenseInput) {
    return this.save('expense', id, expenseInputSchema.parse(input));
  }

  async listRecurring(includeVoided: boolean) {
    return (await this.recurring.list(includeVoided)).map(stored);
  }

  putRecurring(id: string, input: RecurringExpenseInput) {
    return this.save('recurring_expense', id, recurringExpenseInputSchema.parse(input));
  }

  async void(entity: 'expense' | 'recurring_expense', id: string, reason: string) {
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
