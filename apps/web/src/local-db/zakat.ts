import {
  type BaseCategory,
  daysBetween,
  type HawlClock,
  hawlClockOf,
  isDrawOfZakatPayment,
  lastHawl,
  type MetalPrice,
  nextHawl,
  type NewZakatPaymentInput,
  newZakatPaymentSchema,
  type NisabCheck,
  nisabCheckOf,
  type PartnerDraw,
  partnerDrawSchema,
  type SettingKey,
  settingSchema,
  type SettingValue,
  unpaidExpensesCentsOf,
  type ValidationIssue,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatBaseCategoriesOf,
  zakatDrawIdOf,
  zakatPaidCents,
  zakatPaymentReason,
  zakatPaymentShares,
  zakatPositionOf,
  zakatReportFieldsOf,
  zakatReportSchema,
  type ZakatReviewItem,
  zakatReviewOf,
  type ZakatStatus,
  zakatStatusOf,
} from '@fabric/contracts';
import type { ZakatSettings } from '@fabric/core';
import type { z } from 'zod';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { loadShopRecords } from './records';
import { NeedsServerError, type ServerLink } from './settlements';
import type { LocalStore } from './store';
import { PULLED_AT } from './sync';
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

  /** A payment that names itself gives its draws ids of their own (zakatDrawIdOf): see `pay`. */
  async create(fields: object, id?: string): Promise<string> {
    return this.write(fields, id);
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

/** A saved report with what has been paid on it. */
export type ZakatHistoryRow = Local<ZakatReport> & { paidCents: number };

export interface ZakatReportView {
  report: Local<ZakatReport>;
  paidCents: number;
  payments: (Local<PartnerDraw> & { partnerName: string })[];
}

export type ZakatReminder =
  { kind: 'upcoming'; hawlDate: string; days: number } | { kind: 'due'; hawlDate: string } | null;

/** The report for the latest hawl, with what has been paid on it. */
export interface ZakatLatestReport {
  id: string;
  hawlDate: string;
  /** When it was saved (an ISO time). */
  savedAt: string;
  nisabCents: number;
  baseCents: number;
  zakatDueCents: number;
  paidCents: number;
}

/**
 * What the calculation gives today as if the hawl were complete. It is an estimate until a report
 * is saved: nothing here is stored, and a report is only ever saved once the hawl has come.
 */
export interface ZakatEstimate {
  fields: ReturnType<typeof zakatReportFieldsOf>;
  categories: BaseCategory[];
  nisab: NisabCheck;
}

/**
 * Everything the Zakat Management Center and its guided review show, read in one go from this
 * device and saved nowhere (ADR 0028).
 */
export interface ZakatReview {
  today: string;
  options: ZakatOptions;
  clock: HawlClock;
  /** The price of the metal the nisab is measured in; null until one is entered. */
  price: MetalPrice | null;
  /** When this device last finished receiving the shop's records; null if it never has. */
  receivedAt: string | null;
  items: ZakatReviewItem[];
  /** Null while an item blocks the calculation: nothing is worked out from missing information. */
  estimate: ZakatEstimate | null;
  latest: ZakatLatestReport | null;
  /** When the newest report not voided, of any hawl, was saved. */
  lastCalculatedAt: string | null;
  /** What the shop has recorded as owed on bills not paid yet (not taken off the base, Z14). */
  unpaidExpensesCents: number;
  status: ZakatStatus;
}

const issue = (path: string, message: string): ValidationIssue => ({
  path: [path],
  message,
  code: 'custom',
});

/** Which server setting each option is. */
const SETTING_OF = {
  nisabMetal: 'zakat_nisab_metal',
  goodsValuation: 'zakat_goods_valuation',
  includeDoubtfulDebts: 'zakat_include_doubtful_debts',
  hawlStart: 'zakat_hawl_start',
  goldPrice: 'zakat_gold_price',
  silverPrice: 'zakat_silver_price',
  reminderDays: 'zakat_reminder_days',
} as const satisfies Record<keyof ZakatOptions, SettingKey>;
const OPTION_FIELDS = Object.keys(SETTING_OF) as (keyof typeof SETTING_OF)[];

function sameOption(a: ZakatOptions[keyof ZakatOptions], b: ZakatOptions[keyof ZakatOptions]) {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return a.pricePerGramCents === b.pricePerGramCents && a.date === b.date;
  }
  return a === b;
}

const settingsOf = (options: ZakatOptions): ZakatSettings => ({
  nisabMetal: options.nisabMetal,
  goodsValuation: options.goodsValuation,
  includeDoubtfulDebts: options.includeDoubtfulDebts,
});

/** The price of the metal the nisab is measured in (the nisab setting picks the metal). */
const priceOf = (options: ZakatOptions): MetalPrice | null =>
  options.nisabMetal === 'gold' ? options.goldPrice : options.silverPrice;

/** Of two live reports for one hawl, the one the server accepted first, else the older. */
const acceptedFirst = (a: Local<ZakatReport>, b: Local<ZakatReport>) =>
  Number(b.serverSeq !== null) - Number(a.serverSeq !== null) ||
  a.createdAt.localeCompare(b.createdAt);

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

  /**
   * Changes the zakat settings that differ from today's and leaves the rest alone, so saving the
   * form never rewrites a setting nobody changed (the server keeps a history per setting). One sync
   * at the end. Returns the settings it changed. What a saved report used stays with that report:
   * a change reaches only the calculations made after it.
   */
  async saveOptions(changes: Partial<ZakatOptions>): Promise<SettingKey[]> {
    this.store.assertWritable();
    const { server } = this;
    if (!server) throw new NeedsServerError('Settings are changed on the server');
    const current = await this.options();
    const changed: SettingKey[] = [];
    for (const field of OPTION_FIELDS) {
      const value = changes[field];
      if (value === undefined || sameOption(value, current[field])) continue;
      await server.request(`/settings/${SETTING_OF[field]}`, settingSchema, {
        method: 'PUT',
        body: { value, effectiveFrom: null },
      });
      changed.push(SETTING_OF[field]);
    }
    if (changed.length > 0) await server.syncNow();
    return changed;
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
    const metalPrice = priceOf(options);
    if (metalPrice === null)
      return { ok: false, issues: [issue('metalPrice', ZAKAT_ISSUES.noPrice)] };
    const today = this.today();
    const last = lastHawl(options.hawlStart, today);
    const hawlDate = last ?? today;
    const fields = zakatReportFieldsOf(zakatPositionOf(await this.records()), {
      hawlDate,
      hawlCompleted: last !== null,
      settings: settingsOf(options),
      metalPrice,
    });
    return { ok: true, hawlDate, fields };
  }

  /**
   * The state of zakat today, for the overview and the guided review: the hawl clock, what needs
   * looking at, the calculation as it stands (an estimate, nothing is saved) and the report for
   * the latest hawl with what was paid on it. It writes nothing.
   */
  async review(): Promise<ZakatReview> {
    const today = this.today();
    const [options, records, receivedAt, reports] = await Promise.all([
      this.options(),
      this.records(),
      this.receivedAt(),
      this.store.db.zakatReports.toArray(),
    ]);
    const clock = hawlClockOf(options.hawlStart, today);
    const price = priceOf(options);
    const settings = settingsOf(options);
    const position = zakatPositionOf(records);
    const unpaidExpensesCents = unpaidExpensesCentsOf(records);
    const items = zakatReviewOf({
      hawlStart: options.hawlStart,
      price,
      settings,
      today,
      hawlDate: clock.last,
      position,
      unpaidExpensesCents,
      recordsReceived: receivedAt !== null,
    });

    let estimate: ZakatEstimate | null = null;
    if (price !== null && !items.some((item) => item.severity === 'blocking')) {
      const fields = zakatReportFieldsOf(position, {
        hawlDate: clock.last ?? today,
        hawlCompleted: true,
        settings,
        metalPrice: price,
      });
      estimate = {
        fields,
        categories: zakatBaseCategoriesOf(fields.breakdown, settings, unpaidExpensesCents),
        nisab: nisabCheckOf({
          settings,
          metalPrice: price,
          nisabCents: fields.nisabCents,
          baseCents: fields.baseCents,
          breakdown: fields.breakdown,
        }),
      };
    }

    const live = reports.filter((report) => report.voidedAt === null);
    const saved = live.filter((report) => report.hawlDate === clock.last).sort(acceptedFirst)[0];
    const latest: ZakatLatestReport | null = saved
      ? {
          id: saved.id,
          hawlDate: saved.hawlDate,
          savedAt: saved.createdAt,
          nisabCents: saved.nisabCents,
          baseCents: saved.baseCents,
          zakatDueCents: saved.zakatDueCents,
          paidCents: zakatPaidCents(saved.id, records.draws),
        }
      : null;
    return {
      today,
      options,
      clock,
      price,
      receivedAt,
      items,
      estimate,
      latest,
      lastCalculatedAt:
        live
          .map((report) => report.createdAt)
          .sort()
          .at(-1) ?? null,
      unpaidExpensesCents,
      status: zakatStatusOf({
        clock,
        review: items,
        latest,
        reachesNisab: estimate?.fields.breakdown.reachesNisab ?? null,
      }),
    };
  }

  /**
   * Saves the latest hawl's report, with its items and settings; one per hawl. A device that has
   * never received the shop's records saves nothing: its empty books are not a position. When the
   * figures the person confirmed are given (`expected`), nothing is saved if the records have moved
   * since and the report would say something else: what is saved is what was shown.
   */
  async save(expected?: { baseCents: number; zakatDueCents: number }): Promise<string> {
    if ((await this.receivedAt()) === null) {
      throw new ValidationError([issue('records', ZAKAT_ISSUES.recordsNotReceived)]);
    }
    const preview = await this.preview();
    if (!preview.ok) throw new ValidationError(preview.issues);
    if (!preview.fields.breakdown.hawlCompleted) {
      throw new ValidationError([issue('hawlDate', ZAKAT_ISSUES.hawlNotReached)]);
    }
    if (
      expected &&
      (expected.baseCents !== preview.fields.baseCents ||
        expected.zakatDueCents !== preview.fields.zakatDueCents)
    ) {
      throw new ValidationError([issue('baseCents', ZAKAT_ISSUES.figuresChanged)]);
    }
    this.store.assertWritable();
    await this.store.deviceId();
    const { db } = this.store;
    // Looking for the hawl's report and writing it are one step: two taps never both find it free.
    return db.transaction('rw', [db.zakatReports, db.outbox, db.settlements], async () => {
      const taken = await db.zakatReports
        .where('hawlDate')
        .equals(preview.hawlDate)
        .filter((report) => report.voidedAt === null)
        .count();
      if (taken > 0) throw new ValidationError([issue('hawlDate', ZAKAT_ISSUES.hawlTaken)]);
      return this.reports.create(preview.fields);
    });
  }

  /** Every report, the latest hawl first, with what was paid on it. */
  async history(): Promise<ZakatHistoryRow[]> {
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

  /**
   * Pays zakat on a report: a draw per partner by ownership (Z7), never beyond what is due. All
   * the payment's draws are written together or not at all. A payment that names itself
   * (`paymentId`, made once when the person starts it) is recorded once: the same payment sent
   * again, by a second tap or a retry, writes nothing; the same id with another amount or day is
   * refused (ADR 0028).
   */
  async pay(reportId: string, input: NewZakatPaymentInput): Promise<void> {
    const payment = parseOrThrow(newZakatPaymentSchema, input);
    this.store.assertWritable();
    await this.store.deviceId();
    const { db } = this.store;
    await db.transaction(
      'rw',
      [db.zakatReports, db.partners, db.partnerDraws, db.settlements, db.outbox],
      () => this.payWithin(reportId, payment),
    );
  }

  private async payWithin(
    reportId: string,
    payment: z.output<typeof newZakatPaymentSchema>,
  ): Promise<void> {
    const view = await this.report(reportId);
    if (!view || view.report.voidedAt !== null) throw new Error(`No zakat report ${reportId}`);
    const { paymentId } = payment;
    if (paymentId !== undefined) {
      const earlier = view.payments.filter((draw) => isDrawOfZakatPayment(draw, paymentId));
      if (earlier.length > 0) {
        const same =
          earlier.reduce((sum, draw) => sum + draw.amountCents, 0) === payment.amountCents &&
          earlier.every((draw) => draw.date === payment.date);
        if (same) return;
        throw new ValidationError([issue('paymentId', ZAKAT_ISSUES.paymentReused)]);
      }
    }
    if (view.paidCents + payment.amountCents > view.report.zakatDueCents) {
      throw new ValidationError([issue('amountCents', ZAKAT_ISSUES.aboveDue)]);
    }
    const partners = await this.store.db.partners.toArray();
    const reason = zakatPaymentReason(view.report.hawlDate, payment.note);
    for (const share of zakatPaymentShares(payment.amountCents, partners)) {
      await this.draws.create(
        {
          partnerId: share.partnerId,
          amountCents: share.amountCents,
          date: payment.date,
          reason,
          zakatReportId: reportId,
        },
        paymentId === undefined ? undefined : zakatDrawIdOf(paymentId, share.partnerId),
      );
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

  /** When this device last finished receiving the whole shop (an ISO time); null if it never has. */
  private async receivedAt(): Promise<string | null> {
    const at = await this.store.getMeta(PULLED_AT);
    return typeof at === 'string' ? at : null;
  }

  private records() {
    return loadShopRecords(this.store.db);
  }
}
