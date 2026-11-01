import {
  type CashAdjustment,
  cashAdjustmentSchema,
  cashCountFieldsOf,
  cashFlowsOf,
  checkCashAdjustment,
  type IntegrityReport,
  integrityReportOf,
  type NewCashCountInput,
  newCashCountSchema,
  type SyncEntity,
} from '@fabric/contracts';
import { cashBalanceCents } from '@fabric/core';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { loadShopRecords } from './records';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class CashCountTable extends SyncedTable<CashAdjustment> {
  constructor(store: LocalStore) {
    super(store, 'cashAdjustments', 'cash_adjustment', cashAdjustmentSchema);
  }

  async create(fields: object): Promise<string> {
    return this.write(fields);
  }
}

/** One recent change, for "what may explain a difference" (BUILD_PROMPTS 4.4). */
export interface RecentEvent {
  entity: SyncEntity;
  id: string;
  /** When it was last written (updatedAt). */
  at: string;
  /** The day it is accounted on. */
  date: string;
  /** Its money, signed as it moves the shop's money (null: none, e.g. a stocktake). */
  amountCents: number | null;
  voided: boolean;
  /** Where to see it. */
  href: string | null;
}

/**
 * The integrity check and cash counts on the device (SPEC §9, BUILD_PROMPTS 4.4): the same
 * function the server runs (integrityReportOf), on this device's records, offline too.
 */
export class IntegrityRepository {
  private readonly counts: CashCountTable;

  constructor(private readonly store: LocalStore) {
    this.counts = new CashCountTable(store);
  }

  async report(): Promise<IntegrityReport> {
    return integrityReportOf(await this.records());
  }

  /** The shop's money according to the records: what a count is compared with. */
  async expectedCashCents(): Promise<number> {
    return cashBalanceCents(cashFlowsOf(await this.records()));
  }

  /**
   * Of that money, what customers paid by bank transfer (a count takes the shop's bank account
   * too, I5): a figure to reconcile with, not part of the check.
   */
  async bankPaymentsCents(): Promise<number> {
    const payments = await this.store.db.payments.toArray();
    return payments
      .filter((payment) => payment.voidedAt === null && payment.method === 'bank')
      .reduce(
        (sum, payment) => sum + (payment.kind === 'payment' ? 1 : -1) * payment.amountCents,
        0,
      );
  }

  /** Records a count against the books as they are now; a difference needs a reason. */
  async recordCount(input: NewCashCountInput): Promise<string> {
    const parsed = parseOrThrow(newCashCountSchema, input);
    const fields = cashCountFieldsOf(parsed, await this.expectedCashCents());
    const issues = checkCashAdjustment(fields);
    if (issues.length > 0) throw new ValidationError(issues);
    return this.counts.create(fields);
  }

  /** Every count, newest first (voided ones included). */
  async countHistory(): Promise<Local<CashAdjustment>[]> {
    const counts = await this.store.db.cashAdjustments.toArray();
    return counts.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  }

  voidCount(id: string, reason: string): Promise<void> {
    return this.counts.void(id, reason);
  }

  /** The latest changes across the shop's money and stock, newest first. */
  async recent(limit = 12): Promise<RecentEvent[]> {
    const { db } = this.store;
    const [
      sales,
      voids,
      payments,
      expenses,
      purchases,
      moves,
      capitalMoves,
      draws,
      writeOffs,
      counts,
      settlements,
      returns,
      supplierPayments,
    ] = await Promise.all([
      db.sales.toArray(),
      db.saleVoids.toArray(),
      db.payments.toArray(),
      db.expenses.toArray(),
      db.purchases.toArray(),
      db.stockMoves.filter((move) => move.type !== 'purchase' && move.type !== 'sale').toArray(),
      db.capitalMoves.toArray(),
      db.partnerDraws.toArray(),
      db.writeOffs.toArray(),
      db.cashAdjustments.toArray(),
      db.settlements.toArray(),
      db.saleReturns.toArray(),
      db.supplierPayments.toArray(),
    ]);
    const event = (
      entity: SyncEntity,
      record: { id: string; updatedAt: string; voidedAt: string | null },
      date: string,
      amountCents: number | null,
      href: string | null,
    ): RecentEvent => ({
      entity,
      id: record.id,
      at: record.updatedAt,
      date,
      amountCents,
      voided: record.voidedAt !== null,
      href,
    });
    const events = [
      ...sales.map((s) => event('sale', s, s.date, s.totalCents, `/pos/view?id=${s.id}`)),
      ...voids.map((v) => event('sale_void', v, v.date, null, `/pos/view?id=${v.saleId}`)),
      ...payments.map((p) =>
        event(
          'payment',
          p,
          p.date,
          p.kind === 'payment' ? p.amountCents : -p.amountCents,
          p.customerId ? `/customers/view?id=${p.customerId}` : null,
        ),
      ),
      ...expenses.map((e) =>
        event('expense', e, e.paidDate ?? e.date, -e.amountCents, '/expenses'),
      ),
      ...purchases.map((p) =>
        event('purchase', p, p.date, -p.paidCents, `/purchases/view?id=${p.id}`),
      ),
      ...moves.map((m) => event('stock_move', m, m.date, null, `/inventory/roll?id=${m.rollId}`)),
      ...capitalMoves.map((m) =>
        event('capital_move', m, m.date, m.amountCents, `/partners/view?id=${m.partnerId}`),
      ),
      ...draws.map((d) =>
        event('partner_draw', d, d.date, -d.amountCents, `/partners/view?id=${d.partnerId}`),
      ),
      ...writeOffs.map((w) => event('write_off', w, w.date, null, `/pos/view?id=${w.saleId}`)),
      ...counts.map((c) => event('cash_adjustment', c, c.date, c.diffCents, '/integrity')),
      ...settlements.map((s) =>
        event('settlement', s, s.periodEnd, s.netProfitCents, `/settlements/view?id=${s.id}`),
      ),
      ...returns.map((r) =>
        event('sale_return', r, r.date, -r.creditCents, `/pos/view?id=${r.saleId}`),
      ),
      ...supplierPayments.map((p) =>
        event('supplier_payment', p, p.date, -p.amountCents, `/payables/view?id=${p.supplierId}`),
      ),
    ];
    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /** Everything the check is derived from, on this device. */
  private records() {
    return loadShopRecords(this.store.db);
  }
}
