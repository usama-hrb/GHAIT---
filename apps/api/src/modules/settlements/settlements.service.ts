import {
  buildSettlement,
  checkUnlock,
  type NewSettlement,
  SERVER_DEVICE_ID,
  SETTLEMENT_ISSUES,
  type SettlementDetail,
  type SettlementPreview,
  type SettlementRecords,
  shopDate,
  type SplitRuleInput,
  splitRuleInputSchema,
  type SyncEntity,
  type ValidationIssue,
  previewSettlement,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { AuditService } from '../audit/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import {
  PeriodLock,
  SettlementRepository,
  SplitRuleRepository,
} from './settlements.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/** A settlement rule the request breaks: what was asked is wrong, or the records changed. */
function refused(issues: ValidationIssue[]): AppHttpException {
  const changed = issues.some((issue) => issue.message === SETTLEMENT_ISSUES.changed);
  return changed
    ? new AppHttpException(
        'conflict',
        'The figures changed: preview again',
        HttpStatus.CONFLICT,
        issues,
      )
    : new AppHttpException('validation_failed', 'Cannot settle', HttpStatus.BAD_REQUEST, issues);
}

/**
 * Monthly settlement (SPEC §8, BUILD_PROMPTS 4.3): the preview and the approved settlement come
 * from @fabric/contracts previewSettlement (core periodResultOf and computeSettlement) on every
 * device's records, which only the server has; devices preview offline and approve here. An
 * approved period is locked (PeriodLock) until it is unlocked with a reason.
 */
@Injectable()
export class SettlementsService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly settlements: SettlementRepository,
    private readonly rules: SplitRuleRepository,
    private readonly lock: PeriodLock,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.rules);
    this.registry.register({
      entity: 'settlement',
      pull: (since, limit) => this.settlements.pullSettlements(since, limit),
    });
    this.registry.register({
      entity: 'settlement_share',
      pull: (since, limit) => this.settlements.pullShares(since, limit),
    });
    this.registry.register({
      entity: 'locked_cost',
      pull: (since, limit) => this.settlements.pullLockedCosts(since, limit),
    });
    this.registry.setPeriodGuard(this.lock);
  }

  async list() {
    return (await this.settlements.listAll()).map(stored);
  }

  async detail(id: string): Promise<SettlementDetail> {
    const row = await this.settlements.find(id);
    if (!row) throw new AppHttpException('not_found', `No settlement ${id}`, HttpStatus.NOT_FOUND);
    const [shares, moves, lockedCostCount] = await Promise.all([
      this.settlements.shares(id),
      this.sync.readAll('capital_move'),
      this.settlements.lockedCostCount(id),
    ]);
    return {
      settlement: stored(row),
      shares: shares.map(stored),
      retainedProfit: moves.filter((move) => move.record.settlementId === id).map(stored),
      lockedCostCount,
    };
  }

  async preview(periodEnd: string): Promise<SettlementPreview> {
    const result = previewSettlement(await this.records(), { periodEnd, today: this.today() });
    if (!result.ok) throw refused(result.issues);
    return result.preview;
  }

  /**
   * Approves the period: the settlement, the partners' shares, the shop's third as retained
   * profit (T10) and the frozen costs (P9), if the figures are still the ones previewed.
   */
  async approve(input: NewSettlement): Promise<SettlementDetail> {
    await this.lock.exclusive();
    const built = buildSettlement(
      await this.records(),
      { ...input, today: this.today() },
      { settlementId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      {
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
        now: new Date().toISOString(),
      },
    );
    if (!built.ok) throw refused(built.issues);
    const { aggregate } = built;
    await this.settlements.insert(aggregate);
    await this.audit.record({
      entity: 'settlement',
      entityId: aggregate.settlement.id,
      action: 'create',
      before: null,
      after: {
        settlement: aggregate.settlement,
        shares: aggregate.shares,
        retainedProfit: aggregate.retainedProfit,
        lockedCostCount: aggregate.lockedCosts.length,
      },
    });
    return this.detail(aggregate.settlement.id);
  }

  /** Unlocks the latest settled period (SPEC §8.3): voids its settlement and what it created. */
  async unlock(id: string, reason: string): Promise<SettlementDetail> {
    await this.lock.exclusive();
    const before = await this.detail(id);
    const all = (await this.settlements.listAll()).map((row) => row.record);
    const issues = checkUnlock(before.settlement, all);
    if (issues.length > 0) {
      throw new AppHttpException(
        'conflict',
        'Only the latest settlement can be unlocked',
        HttpStatus.CONFLICT,
        issues,
      );
    }
    await this.settlements.voidWithChildren(
      id,
      new Date(),
      requestContext()?.deviceId ?? SERVER_DEVICE_ID,
    );
    const after = await this.detail(id);
    await this.audit.record({
      entity: 'settlement',
      entityId: id,
      action: 'void',
      before,
      after,
      reason,
    });
    return after;
  }

  async splitRules() {
    return (await this.rules.listAll()).map(stored);
  }

  /** Creates or changes a future split rule through SyncService (checks, audit). */
  async putSplitRule(id: string, input: SplitRuleInput) {
    const fields = splitRuleInputSchema.parse(input);
    const current = await this.rules.find(id);
    const now = new Date().toISOString();
    return stored(
      await this.sync.saveDirect('profit_split_rule', {
        ...fields,
        id,
        createdAt: current?.record.createdAt ?? now,
        updatedAt: now,
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
        voidedAt: current?.record.voidedAt ?? null,
      }),
    );
  }

  async voidSplitRule(id: string, reason: string) {
    return stored(await this.sync.voidDirect('profit_split_rule', id, reason));
  }

  private today(): string {
    return shopDate(new Date());
  }

  /** Everything a settlement is computed from: every device's records the server has. */
  private async records(): Promise<SettlementRecords> {
    const withSeq = <R>(rows: SyncedRow<R>[]) => rows.map(stored);
    const records = <R>(rows: SyncedRow<R>[]) => rows.map((row) => row.record);
    const read = <E extends SyncEntity>(entity: E) => this.sync.readAll(entity);
    const [
      rolls,
      stockMoves,
      sales,
      saleLines,
      saleReturns,
      allocations,
      writeOffs,
      expenses,
      cashAdjustments,
      lockedCosts,
      settlements,
      splitRules,
      partners,
    ] = await Promise.all([
      read('roll'),
      read('stock_move'),
      read('sale'),
      read('sale_line'),
      read('sale_return'),
      read('payment_allocation'),
      read('write_off'),
      read('expense'),
      read('cash_adjustment'),
      read('locked_cost'),
      read('settlement'),
      read('profit_split_rule'),
      read('partner'),
    ]);
    return {
      rolls: records(rolls),
      stockMoves: withSeq(stockMoves),
      sales: records(sales),
      saleLines: records(saleLines),
      saleReturns: withSeq(saleReturns),
      allocations: withSeq(allocations),
      writeOffs: records(writeOffs),
      expenses: records(expenses),
      cashAdjustments: records(cashAdjustments),
      lockedCosts: records(lockedCosts),
      settlements: records(settlements),
      splitRules: records(splitRules),
      partners: records(partners),
    };
  }
}
