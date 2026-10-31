import {
  cashCountFieldsOf,
  cashFlowsOf,
  type IntegrityRecords,
  type IntegrityReport,
  integrityReportOf,
  type NewCashCountInput,
  newCashCountSchema,
  SERVER_DEVICE_ID,
  type SyncEntity,
} from '@fabric/contracts';
import { cashBalanceCents } from '@fabric/core';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import { CashAdjustmentRepository } from './integrity.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * The integrity check and cash counts (SPEC §9, BUILD_PROMPTS 4.4). The check is
 * @fabric/contracts integrityReportOf on every record the server has: what each device computes
 * on its own records. A count is recorded against the server's books here, against the
 * device's books when a device records it (then synced).
 */
@Injectable()
export class IntegrityService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly counts: CashAdjustmentRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.counts);
  }

  async report(): Promise<IntegrityReport> {
    return integrityReportOf(await this.records());
  }

  async listCounts() {
    return (await this.counts.list()).map(stored);
  }

  /** A count of the shop's money against the books as the server has them. */
  async recordCount(id: string, input: NewCashCountInput) {
    const parsed = newCashCountSchema.parse(input);
    const current = await this.sync.find('cash_adjustment', id);
    const records = await this.records();
    const fields = current
      ? current.record
      : cashCountFieldsOf(parsed, cashBalanceCents(cashFlowsOf(records)));
    const now = new Date().toISOString();
    return stored(
      await this.sync.saveDirect('cash_adjustment', {
        ...fields,
        id,
        createdAt: current?.record.createdAt ?? now,
        updatedAt: now,
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
        voidedAt: current?.record.voidedAt ?? null,
      }),
    );
  }

  async voidCount(id: string, reason: string) {
    return stored(await this.sync.voidDirect('cash_adjustment', id, reason));
  }

  /** Everything the check is derived from: every device's records the server has. */
  private async records(): Promise<IntegrityRecords> {
    const read = <E extends SyncEntity>(entity: E) => this.sync.readAll(entity);
    const records = <R>(rows: SyncedRow<R>[]) => rows.map((row) => row.record);
    const [
      rolls,
      stockMoves,
      sales,
      saleLines,
      allocations,
      writeOffs,
      expenses,
      cashAdjustments,
      lockedCosts,
      settlements,
      splitRules,
      partners,
      payments,
      purchases,
      capitalMoves,
      draws,
      settlementShares,
    ] = await Promise.all([
      read('roll'),
      read('stock_move'),
      read('sale'),
      read('sale_line'),
      read('payment_allocation'),
      read('write_off'),
      read('expense'),
      read('cash_adjustment'),
      read('locked_cost'),
      read('settlement'),
      read('profit_split_rule'),
      read('partner'),
      read('payment'),
      read('purchase'),
      read('capital_move'),
      read('partner_draw'),
      read('settlement_share'),
    ]);
    return {
      rolls: records(rolls),
      stockMoves: stockMoves.map(stored),
      sales: records(sales),
      saleLines: records(saleLines),
      allocations: allocations.map(stored),
      writeOffs: records(writeOffs),
      expenses: records(expenses),
      cashAdjustments: records(cashAdjustments),
      lockedCosts: records(lockedCosts),
      settlements: records(settlements),
      splitRules: records(splitRules),
      partners: records(partners),
      payments: records(payments),
      purchases: records(purchases),
      capitalMoves: records(capitalMoves),
      draws: records(draws),
      settlementShares: records(settlementShares),
    };
  }
}
