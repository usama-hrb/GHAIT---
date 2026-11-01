import {
  checkUnchanged,
  checkZakatReport,
  metalPriceSchema,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatBreakdownSchema,
  zakatSettingsSchema,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type ReportRow = typeof schema.zakatReport.$inferSelect;

function reportOf(row: ReportRow): SyncedRow<ZakatReport> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      hawlDate: row.hawlDate,
      metalPrice: metalPriceSchema.parse(row.metalPrice),
      nisabCents: row.nisabCents,
      baseCents: row.baseCents,
      zakatDueCents: row.zakatDueCents,
      settings: zakatSettingsSchema.parse(row.settings),
      breakdown: zakatBreakdownSchema.parse(row.breakdown),
    },
  };
}

const FIELDS = [
  'hawlDate',
  'metalPrice',
  'nisabCents',
  'baseCents',
  'zakatDueCents',
  'settings',
  'breakdown',
] as const;

/** Zakat reports (SPEC §10): saved once (checkZakatReport), voided while nothing is paid on them. */
@Injectable()
export class ZakatReportRepository implements SyncHandler<'zakat_report'> {
  readonly entity = 'zakat_report' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<ZakatReport> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.zakatReport)
      .where(eq(schema.zakatReport.id, id));
    return row && reportOf(row);
  }

  async write(record: ZakatReport): Promise<SyncedRow<ZakatReport>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(current.record, record, FIELDS, ZAKAT_ISSUES.fixed);
      if (issues.length > 0) {
        throw new SyncRejection('validation_failed', 'A zakat report is never edited', issues);
      }
      return current;
    }
    const issues = checkZakatReport(record);
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid zakat report', issues);
    const [row] = await this.tx.db
      .insert(schema.zakatReport)
      .values({
        ...baseValues(record),
        hawlDate: record.hawlDate,
        metalPrice: record.metalPrice,
        nisabCents: record.nisabCents,
        baseCents: record.baseCents,
        zakatDueCents: record.zakatDueCents,
        settings: record.settings,
        breakdown: record.breakdown,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return reportOf(row);
  }

  /** A report something was paid on stays: void its payments first. */
  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<ZakatReport>> {
    const [paid] = await this.tx.db
      .select({ n: count() })
      .from(schema.partnerDraw)
      .where(and(eq(schema.partnerDraw.zakatReportId, id), isNull(schema.partnerDraw.voidedAt)));
    if ((paid?.n ?? 0) > 0) {
      throw new SyncRejection('validation_failed', 'Zakat was paid on this report', [
        { path: ['id'], message: ZAKAT_ISSUES.hasPayments, code: 'custom' },
      ]);
    }
    const [row] = await this.tx.db
      .update(schema.zakatReport)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.zakatReport.id, id))
      .returning();
    if (!row) throw new Error(`no zakat report ${id}`);
    return reportOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<ZakatReport>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.zakatReport)
      .where(gt(schema.zakatReport.serverSeq, since))
      .orderBy(asc(schema.zakatReport.serverSeq))
      .limit(limit);
    return rows.map(reportOf);
  }

  /** The latest hawl first (voided ones included). */
  async list(): Promise<SyncedRow<ZakatReport>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.zakatReport)
      .orderBy(sql`${schema.zakatReport.hawlDate} DESC`, sql`${schema.zakatReport.createdAt} DESC`);
    return rows.map(reportOf);
  }
}
