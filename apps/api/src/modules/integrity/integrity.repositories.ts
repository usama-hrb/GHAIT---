import {
  CASH_COUNT_ISSUES,
  type CashAdjustment,
  checkCashAdjustment,
  checkUnchanged,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt, sql } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type CountRow = typeof schema.cashAdjustment.$inferSelect;

function countOf(row: CountRow): SyncedRow<CashAdjustment> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      date: row.date,
      expectedCents: row.expectedCents,
      countedCents: row.countedCents,
      diffCents: row.diffCents,
      note: row.note,
    },
  };
}

const FIELDS = ['date', 'expectedCents', 'countedCents', 'diffCents', 'note'] as const;

/** Cash counts (SPEC §9): created once (checkCashAdjustment), then only voided. */
@Injectable()
export class CashAdjustmentRepository implements SyncHandler<'cash_adjustment'> {
  readonly entity = 'cash_adjustment' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<CashAdjustment> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.cashAdjustment)
      .where(eq(schema.cashAdjustment.id, id));
    return row && countOf(row);
  }

  async write(record: CashAdjustment): Promise<SyncedRow<CashAdjustment>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(current.record, record, FIELDS, CASH_COUNT_ISSUES.fixed);
      if (issues.length > 0) {
        throw new SyncRejection('validation_failed', 'A cash count is never edited', issues);
      }
      return current;
    }
    const issues = checkCashAdjustment(record);
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid cash count', issues);
    const [row] = await this.tx.db
      .insert(schema.cashAdjustment)
      .values({
        ...baseValues(record),
        date: record.date,
        expectedCents: record.expectedCents,
        countedCents: record.countedCents,
        diffCents: record.diffCents,
        note: record.note,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return countOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<CashAdjustment>> {
    const [row] = await this.tx.db
      .update(schema.cashAdjustment)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.cashAdjustment.id, id))
      .returning();
    if (!row) throw new Error(`no cash count ${id}`);
    return countOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<CashAdjustment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.cashAdjustment)
      .where(gt(schema.cashAdjustment.serverSeq, since))
      .orderBy(asc(schema.cashAdjustment.serverSeq))
      .limit(limit);
    return rows.map(countOf);
  }

  /** Newest first (voided ones included). */
  async list(): Promise<SyncedRow<CashAdjustment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.cashAdjustment)
      .orderBy(
        sql`${schema.cashAdjustment.date} DESC`,
        sql`${schema.cashAdjustment.createdAt} DESC`,
      );
    return rows.map(countOf);
  }
}
