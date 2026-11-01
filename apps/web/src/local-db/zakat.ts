import {
  daysBetween,
  lastHawl,
  type MetalPrice,
  nextHawl,
  type NewZakatPayment,
  newZakatPaymentSchema,
  type PartnerDraw,
  partnerDrawSchema,
  type SettingKey,
  settingSchema,
  type SettingValue,
  type ValidationIssue,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatPaidCents,
  zakatPaymentShares,
  zakatPositionOf,
  zakatReportFieldsOf,
  zakatReportSchema,
} from '@fabric/contracts';
import type { ZakatSettings } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { NeedsServerError, type ServerLink } from './settlements';
import { loadShopRecords } from './records';
import type { LocalStore } from './store';
import { type SettingsRepository, SyncedTable } from './tables';

class ZakatReportTable extends SyncedTable<ZakatReport> {
  constructor(store: LocalStore) {
    super(store, 'zakatReports', 'zakat_report', zakatReportSchema);
  }

  async create(fields: object): Promise<string> {
    return this.write(fields);
  }
}

class ZakatDrawTable extends SyncedTable<PartnerDraw> {
  constructor(store: LocalStore) {
    super(store, 'partnerDraws', 'partner_draw', partnerDrawSchema);
  }

  async create(fields: object): Promise<string> {
    return this.write(fields);
  }
}

/** Every zakat setting (SPEC §10), as in effect today. */
export interface ZakatOptions extends ZakatSettings {
  hawlStart: string | null;
  goldPrice: MetalPrice | null;
  silverPrice: MetalPrice | null;
  reminderDays: number;
}

export interface HawlView {
  start: string | null;
  /** The latest hawl on or before today (null before the first). */
  last: string | null;
  next: string | null;
  daysToNext: number | null;
}

export type ZakatPreview =
  | { ok: true; hawlDate: string; fields: ReturnType<typeof zakatReportFieldsOf> }
  | { ok: false; issues: ValidationIssue[] };

export interface ZakatReportView {
  report: Local<ZakatReport>;
  paidCents: number;
  payments: (Local<PartnerDraw> & { partnerName: string })[];
}

export type ZakatReminder =
  { kind: 'upcoming'; hawlDate: string; days: number } | { kind: 'due'; hawlDate: string } | null;

const issue = (path: string, message: string): ValidationIssue => ({
  path: [path],
  message,
  code: 'custom',
});

/**
 * Zakat on the device (SPEC §10, BUILD_PROMPTS 5.1): the position for the hawl from this
 * device's records (@fabric/contracts zakatReportFieldsOf → core computeZakat), saved as a
 * report and paid as a draw per partner by ownership (Z7), offline like any record. Its
 * settings are server settings: changed online.
 */
export class ZakatRepository {
  private readonly reports: ZakatReportTable;
  private readonly draws: ZakatDrawTable;

  constructor(
    private readonly store: LocalStore,
    private readonly settings: SettingsRepository,
    private readonly server?: ServerLink,
  ) {
    this.reports = new ZakatReportTable(store);
    this.draws = new ZakatDrawTable(store);
  }

  async options(): Promise<ZakatOptions> {
    const day = this.today();
    const get = <K extends SettingKey>(key: K) => this.settings.get(key, day);
    const [
      nisabMetal,
      goodsValuation,
      includeDoubtfulDebts,
      hawlStart,
      goldPrice,
      silverPrice,
      reminderDays,
    ] = await Promise.all([
      get('zakat_nisab_metal'),
      get('zakat_goods_valuation'),
      get('zakat_include_doubtful_debts'),
      get('zakat_hawl_start'),
      get('zakat_gold_price'),
      get('zakat_silver_price'),
      get('zakat_reminder_days'),
    ]);
    return {
      nisabMetal,
      goodsValuation,
      includeDoubtfulDebts,
      hawlStart,
      goldPrice,
      silverPrice,
      reminderDays,
    };
  }

  /** Changes a zakat setting on the server (settings are validated and kept there), then syncs. */
  async saveOption<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    this.store.assertWritable();
    if (!this.server) throw new NeedsServerError('Settings are changed on the server');
    await this.server.request(`/settings/${key}`, settingSchema, {
      method: 'PUT',
      body: { value, effectiveFrom: null },
    });
    await this.server.syncNow();
  }

  async hawl(): Promise<HawlView> {
    const { hawlStart } = await this.options();
    if (hawlStart === null) return { start: null, last: null, next: null, daysToNext: null };
    const today = this.today();
    const next = nextHawl(hawlStart, today);
    return {
      start: hawlStart,
      last: lastHawl(hawlStart, today),
      next,
      daysToNext: daysBetween(today, next),
    };
  }

  /** The report for the latest hawl (or, before the first one, the position today). */
  async preview(): Promise<ZakatPreview> {
    const options = await this.options();
    if (options.hawlStart === null)
      return { ok: false, issues: [issue('hawlStart', ZAKAT_ISSUES.noHawlStart)] };
    const metalPrice = options.nisabMetal === 'gold' ? options.goldPrice : options.silverPrice;
    if (metalPrice === null)
      return { ok: false, issues: [issue('metalPrice', ZAKAT_ISSUES.noPrice)] };
    const today = this.today();
    const last = lastHawl(options.hawlStart, today);
    const hawlDate = last ?? today;
    const fields = zakatReportFieldsOf(zakatPositionOf(await this.records()), {
      hawlDate,
      hawlCompleted: last !== null,
      settings: {
        nisabMetal: options.nisabMetal,
        goodsValuation: options.goodsValuation,
        includeDoubtfulDebts: options.includeDoubtfulDebts,
      },
      metalPrice,
    });
    return { ok: true, hawlDate, fields };
  }

  /** Saves the latest hawl's report, with its items and settings; one per hawl. */
  async save(): Promise<string> {
    const preview = await this.preview();
    if (!preview.ok) throw new ValidationError(preview.issues);
    if (!preview.fields.breakdown.hawlCompleted) {
      throw new ValidationError([issue('hawlDate', ZAKAT_ISSUES.hawlNotReached)]);
    }
    const taken = await this.store.db.zakatReports
      .where('hawlDate')
      .equals(preview.hawlDate)
      .filter((report) => report.voidedAt === null)
      .count();
    if (taken > 0) throw new ValidationError([issue('hawlDate', ZAKAT_ISSUES.hawlTaken)]);
    return this.reports.create(preview.fields);
  }

  /** Every report, the latest hawl first, with what was paid on it. */
  async history(): Promise<(Local<ZakatReport> & { paidCents: number })[]> {
    const { db } = this.store;
    const [reports, draws] = await Promise.all([
      db.zakatReports.toArray(),
      db.partnerDraws.toArray(),
    ]);
    return reports
      .sort(
        (a, b) => b.hawlDate.localeCompare(a.hawlDate) || b.createdAt.localeCompare(a.createdAt),
      )
      .map((report) => ({ ...report, paidCents: zakatPaidCents(report.id, draws) }));
  }

  async report(id: string): Promise<ZakatReportView | undefined> {
    const { db } = this.store;
    const report = await db.zakatReports.get(id);
    if (!report) return undefined;
    const [draws, partners] = await Promise.all([
      db.partnerDraws.filter((draw) => draw.zakatReportId === id).toArray(),
      db.partners.toArray(),
    ]);
    const names = new Map(partners.map((partner) => [partner.id, partner.name]));
    const owner = new Set(
      partners.filter((partner) => partner.isOwner).map((partner) => partner.id),
    );
    return {
      report,
      paidCents: zakatPaidCents(id, draws),
      payments: draws
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            Number(owner.has(b.partnerId)) - Number(owner.has(a.partnerId)),
        )
        .map((draw) => ({ ...draw, partnerName: names.get(draw.partnerId) ?? '' })),
    };
  }

  /** Pays zakat on a report: a draw per partner by ownership (Z7), never beyond what is due. */
  async pay(reportId: string, input: NewZakatPayment): Promise<void> {
    const payment = parseOrThrow(newZakatPaymentSchema, input);
    const view = await this.report(reportId);
    if (!view || view.report.voidedAt !== null) throw new Error(`No zakat report ${reportId}`);
    if (view.paidCents + payment.amountCents > view.report.zakatDueCents) {
      throw new ValidationError([issue('amountCents', ZAKAT_ISSUES.aboveDue)]);
    }
    const partners = await this.store.db.partners.toArray();
    for (const share of zakatPaymentShares(payment.amountCents, partners)) {
      await this.draws.create({
        partnerId: share.partnerId,
        amountCents: share.amountCents,
        date: payment.date,
        reason: `zakat ${view.report.hawlDate}`,
        zakatReportId: reportId,
      });
    }
  }

  /** A report with nothing paid on it can be voided (with a reason) and saved again. */
  async void(id: string, reason: string): Promise<void> {
    const view = await this.report(id);
    if (view && view.paidCents > 0)
      throw new ValidationError([issue('id', ZAKAT_ISSUES.hasPayments)]);
    await this.reports.void(id, reason);
  }

  /** SPEC §10 "تذكير قبل الحول بأسبوعين": a hawl coming, or one passed without a report. */
  async reminder(): Promise<ZakatReminder> {
    const [options, hawl] = await Promise.all([this.options(), this.hawl()]);
    if (hawl.next === null || hawl.daysToNext === null) return null;
    const reported = async (date: string) =>
      (await this.store.db.zakatReports
        .where('hawlDate')
        .equals(date)
        .filter((report) => report.voidedAt === null)
        .count()) > 0;
    if (hawl.last !== null && !(await reported(hawl.last)))
      return { kind: 'due', hawlDate: hawl.last };
    if (hawl.daysToNext <= options.reminderDays) {
      return { kind: 'upcoming', hawlDate: hawl.next, days: hawl.daysToNext };
    }
    return null;
  }

  private today(): string {
    return shopToday(this.store.now());
  }

  private records() {
    return loadShopRecords(this.store.db);
  }
}
