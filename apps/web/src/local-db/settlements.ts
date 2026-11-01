import {
  type CapitalMove,
  checkSplitRule,
  checkSplitRuleVoid,
  DEFAULT_SPLIT_RULE,
  lockedThroughOf,
  type Partner,
  previewSettlement,
  type SettlementLine,
  type SettlementPreview,
  type SettlementPreviewResult,
  type SettlementRecord,
  type SettlementShare,
  settlementDetailSchema,
  settlementPreviewSchema,
  type SplitRule,
  type SplitRuleInput,
  splitRuleInputSchema,
  splitRuleSchema,
} from '@fabric/contracts';
import { monthBounds, previousMonth } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { Session } from './session';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

/** What approving and unlocking need: the server, which has every device's records. */
export interface ServerLink {
  /** An authenticated API call (Session.request). */
  request: Session['request'];
  /** Pushes this device's changes and pulls everyone's. */
  syncNow(): Promise<void>;
}

/** Approving or unlocking without a server link (tests): it needs a connection. */
export class NeedsServerError extends Error {
  override readonly name = 'NeedsServerError';
}

class SplitRuleTable extends SyncedTable<SplitRule> {
  constructor(store: LocalStore) {
    super(store, 'profitSplitRules', 'profit_split_rule', splitRuleSchema);
  }

  async save(fields: SplitRuleInput, id: string): Promise<string> {
    return this.write(fields, id);
  }
}

export interface SettlementView {
  settlement: Local<SettlementRecord>;
  /** Each partner's share, with their name. */
  shares: (Local<SettlementShare> & { partner: Local<Partner> | undefined })[];
  /** The shop's third, kept as capital (T10). */
  retainedProfit: (Local<CapitalMove> & { partner: Local<Partner> | undefined })[];
  lockedCostCount: number;
}

export interface SplitRuleRow {
  /** Null for the default (equal thirds since the start). */
  rule: Local<SplitRule> | null;
  effectiveFrom: string;
  ownerWeight: number;
  partnerWeight: number;
  shopWeight: number;
  /** Not in effect yet: it can still be changed or removed. */
  future: boolean;
}

/**
 * Monthly settlement on the device (SPEC §8, BUILD_PROMPTS 4.3). The preview is computed here
 * from the local records (offline); approving and unlocking go to the server, which settles on
 * every device's records, and the result comes back through sync.
 */
export class SettlementsRepository {
  private readonly rules: SplitRuleTable;

  constructor(
    private readonly store: LocalStore,
    private readonly server?: ServerLink,
  ) {
    this.rules = new SplitRuleTable(store);
  }

  /** The last settled day: records dated up to it are locked. */
  async lockedThrough(): Promise<string | null> {
    return lockedThroughOf(await this.store.db.settlements.toArray());
  }

  /** Every settlement, the latest period first (unlocked ones included). */
  async history(): Promise<Local<SettlementRecord>[]> {
    const settlements = await this.store.db.settlements.toArray();
    return settlements.sort(
      (a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.createdAt.localeCompare(a.createdAt),
    );
  }

  async detail(id: string): Promise<SettlementView | undefined> {
    const { db } = this.store;
    const settlement = await db.settlements.get(id);
    if (!settlement) return undefined;
    const [shares, moves, partners, lockedCostCount] = await Promise.all([
      db.settlementShares.where('settlementId').equals(id).toArray(),
      db.capitalMoves.filter((move) => move.settlementId === id).toArray(),
      db.partners.toArray(),
      db.lockedCosts.where('settlementId').equals(id).count(),
    ]);
    const partnerOf = new Map(partners.map((partner) => [partner.id, partner]));
    const ownerFirst = <R extends { partnerId: string }>(a: R, b: R) =>
      Number(partnerOf.get(b.partnerId)?.isOwner) - Number(partnerOf.get(a.partnerId)?.isOwner);
    return {
      settlement,
      shares: shares
        .sort(ownerFirst)
        .map((share) => ({ ...share, partner: partnerOf.get(share.partnerId) })),
      retainedProfit: moves
        .sort(ownerFirst)
        .map((move) => ({ ...move, partner: partnerOf.get(move.partnerId) })),
      lockedCostCount,
    };
  }

  /** The period end to propose: last month's end, unless it is settled already (then null). */
  async nextPeriodEnd(): Promise<string | null> {
    const lastMonthEnd = monthBounds(previousMonth(shopToday(this.store.now()).slice(0, 7))).end;
    const through = await this.lockedThrough();
    return through === null || lastMonthEnd > through ? lastMonthEnd : null;
  }

  /** The period ending on `periodEnd`, from this device's records. */
  async preview(periodEnd: string): Promise<SettlementPreviewResult> {
    const { db } = this.store;
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
      db.rolls.toArray(),
      db.stockMoves.toArray(),
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.saleReturns.toArray(),
      db.paymentAllocations.toArray(),
      db.writeOffs.toArray(),
      db.expenses.toArray(),
      db.cashAdjustments.toArray(),
      db.lockedCosts.toArray(),
      db.settlements.toArray(),
      db.profitSplitRules.toArray(),
      db.partners.toArray(),
    ]);
    return previewSettlement(
      {
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
      },
      { periodEnd, today: shopToday(this.store.now()) },
    );
  }

  /** The server's preview, after this device has synced: what approving it will settle. */
  async serverPreview(periodEnd: string): Promise<SettlementPreview> {
    const server = this.requireServer();
    await server.syncNow();
    return server.request(`/settlements/preview?end=${periodEnd}`, settlementPreviewSchema);
  }

  /**
   * Approves the period as the server previewed it (`expected`): a 409 means records arrived
   * since; preview again. Returns the settlement's id, synced to this device.
   */
  async approve(periodEnd: string, expected: SettlementLine[]): Promise<string> {
    this.store.assertWritable();
    const server = this.requireServer();
    const detail = await server.request('/settlements', settlementDetailSchema, {
      method: 'POST',
      body: { periodEnd, expected },
    });
    await server.syncNow();
    return detail.settlement.id;
  }

  /** Unlocks the latest settled period with a reason (audited); it can then be settled again. */
  async unlock(id: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const server = this.requireServer();
    await server.request(`/settlements/${id}/unlock`, settlementDetailSchema, {
      method: 'POST',
      body: { reason },
    });
    await server.syncNow();
  }

  /** The split rules: the default first, then the entered ones by date. */
  async splitRules(): Promise<SplitRuleRow[]> {
    const today = shopToday(this.store.now());
    const rules = (await this.store.db.profitSplitRules.toArray())
      .filter((rule) => rule.voidedAt === null)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return [
      { rule: null, ...DEFAULT_SPLIT_RULE, future: false },
      ...rules.map((rule) => ({
        rule,
        effectiveFrom: rule.effectiveFrom,
        ownerWeight: rule.ownerWeight,
        partnerWeight: rule.partnerWeight,
        shopWeight: rule.shopWeight,
        future: rule.effectiveFrom > today,
      })),
    ];
  }

  /** A rule for a future date (SPEC §8.3: never retroactive); `id` to change one. */
  async saveSplitRule(input: SplitRuleInput, id: string = crypto.randomUUID()): Promise<string> {
    const fields = parseOrThrow(splitRuleInputSchema, input);
    const rules = await this.store.db.profitSplitRules.toArray();
    const issues = checkSplitRule(
      { id, ...fields },
      rules.find((rule) => rule.id === id),
      { today: shopToday(this.store.now()), rules },
    );
    if (issues.length > 0) throw new ValidationError(issues);
    return this.rules.save(fields, id);
  }

  async voidSplitRule(id: string, reason: string): Promise<void> {
    const rule = await this.rules.get(id);
    const issues = rule ? checkSplitRuleVoid(rule, shopToday(this.store.now())) : [];
    if (issues.length > 0) throw new ValidationError(issues);
    await this.rules.void(id, reason);
  }

  private requireServer(): ServerLink {
    if (!this.server) throw new NeedsServerError('Settling needs the server');
    return this.server;
  }
}
