import {
  type CapitalMove,
  checkSplitRule,
  checkSplitRuleVoid,
  DEFAULT_SPLIT_RULE,
  lockedThroughOf,
  type NamedSplitRule,
  type Partner,
  partnerWeightsOfRule,
  previewSettlement,
  ruleWithPartnerWeight,
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
  type SplitRulePartnerWeight,
  splitRuleSchema,
} from '@fabric/contracts';
import { dayAfter, monthBounds, monthOf, nextMonth, previousMonth } from '@fabric/core';
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

export class SplitRuleTable extends SyncedTable<SplitRule> {
  constructor(store: LocalStore) {
    super(store, 'profitSplitRules', 'profit_split_rule', splitRuleSchema);
  }

  async save(fields: SplitRuleInput, id: string): Promise<string> {
    return this.write(fields, id);
  }
}

/** One partner's allocation by a settlement (what the history lists). */
export interface HistoryShare {
  partnerId: string;
  /** Null when the partner's record is not on this device. */
  name: string | null;
  amountCents: number;
}

/** A settlement of the history: its record, and the partners' shares it allocated. */
export type SettlementHistoryRow = Local<SettlementRecord> & { partnerShares: HistoryShare[] };

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
  /** The partners together. */
  partnerWeight: number;
  shopWeight: number;
  /**
   * What each partner gets under the rule (S17). A rule that names none (the default, and any
   * made before there were several partners) is the shop's first partner's.
   */
  partnerWeights: SplitRulePartnerWeight[];
  /** Not in effect yet: it can still be changed or removed. */
  future: boolean;
}

/**
 * The period ends the owner can pick from: the last day of each month that has ended since the
 * last settled day, the oldest first (S7: a period starts the day after the last settlement, so
 * picking a later month settles the months before it too). With nothing settled yet the first
 * period takes everything before it, so only the last ended month is offered. `[]` when every
 * ended month is settled.
 */
export function openPeriodEnds(lockedThrough: string | null, today: string, limit = 24): string[] {
  const lastEnded = monthBounds(previousMonth(monthOf(today))).end;
  if (lockedThrough === null) return [lastEnded];
  const ends: string[] = [];
  let month = monthOf(dayAfter(lockedThrough));
  while (ends.length < limit) {
    const { end } = monthBounds(month);
    if (end > lastEnded) break;
    ends.push(end);
    month = nextMonth(month);
  }
  return ends;
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

  /**
   * Every settlement, the latest period first (unlocked ones included), with what each partner
   * (the owner apart: their share is on the settlement) was allocated by it.
   */
  async history(): Promise<SettlementHistoryRow[]> {
    const { db } = this.store;
    const [settlements, shares, partners] = await Promise.all([
      db.settlements.toArray(),
      db.settlementShares.toArray(),
      db.partners.toArray(),
    ]);
    const partnerOf = new Map(partners.map((partner) => [partner.id, partner]));
    const joined = (id: string) => partnerOf.get(id)?.createdAt ?? '';
    return settlements
      .sort(
        (a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.createdAt.localeCompare(a.createdAt),
      )
      .map((settlement) => ({
        ...settlement,
        partnerShares: shares
          .filter(
            (share) =>
              share.settlementId === settlement.id &&
              partnerOf.get(share.partnerId)?.isOwner !== true,
          )
          .sort(
            (a, b) =>
              joined(a.partnerId).localeCompare(joined(b.partnerId)) ||
              a.partnerId.localeCompare(b.partnerId),
          )
          .map((share) => ({
            partnerId: share.partnerId,
            name: partnerOf.get(share.partnerId)?.name ?? null,
            amountCents: share.amountCents,
          })),
      }));
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

  /** The month ends that can be settled now, the oldest first (`openPeriodEnds`). */
  async openPeriodEnds(): Promise<string[]> {
    return openPeriodEnds(await this.lockedThrough(), shopToday(this.store.now()));
  }

  /** The period end to propose: the oldest open month's end (null when all are settled). */
  async nextPeriodEnd(): Promise<string | null> {
    return (await this.openPeriodEnds())[0] ?? null;
  }

  /** The period ending on `periodEnd`, from this device's records. */
  async preview(periodEnd: string): Promise<SettlementPreviewResult> {
    const { db } = this.store;
    const [
      batches,
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
      db.productBatches.toArray(),
      db.productStockMoves.toArray(),
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
        batches,
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
    const partners = await this.store.db.partners.toArray();
    const rules = (await this.store.db.profitSplitRules.toArray())
      .filter((rule) => rule.voidedAt === null)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const unnamed = { partnerWeights: null };
    return [
      {
        rule: null,
        ...DEFAULT_SPLIT_RULE,
        partnerWeights: partnerWeightsOfRule({ ...DEFAULT_SPLIT_RULE, ...unnamed }, partners),
        future: false,
      },
      ...rules.map((rule) => ({
        rule,
        effectiveFrom: rule.effectiveFrom,
        ownerWeight: rule.ownerWeight,
        partnerWeight: rule.partnerWeight,
        shopWeight: rule.shopWeight,
        partnerWeights: partnerWeightsOfRule(rule, partners),
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
      {
        today: shopToday(this.store.now()),
        rules,
        partners: await this.store.db.partners.toArray(),
      },
    );
    if (issues.length > 0) throw new ValidationError(issues);
    return this.rules.save(fields, id);
  }

  /**
   * The rule that gives one partner a weight in the profit split from a future date (S17): the
   * rule in force that day with this partner's weight added or changed, every other weight as it
   * stands. `id` is the rule already entered for that very day, which is changed in place (one
   * rule per day, S15); null for a new one. Nothing is saved: this is what the screens show.
   */
  async previewPartnerWeight(input: {
    partnerId: string;
    weight: number;
    effectiveFrom: string;
  }): Promise<{ id: string | null; rule: NamedSplitRule }> {
    const { db } = this.store;
    const [rules, partners] = await Promise.all([
      db.profitSplitRules.toArray(),
      db.partners.toArray(),
    ]);
    return ruleWithPartnerWeight(
      rules.filter((current) => current.voidedAt === null),
      partners,
      input,
    );
  }

  /**
   * Saves what previewPartnerWeight shows. Rules after that day are left alone: the owner sees
   * which of them leave the partner out and decides.
   */
  async setPartnerWeight(input: {
    partnerId: string;
    weight: number;
    effectiveFrom: string;
  }): Promise<string> {
    const { id, rule } = await this.previewPartnerWeight(input);
    return this.saveSplitRule(rule, id ?? undefined);
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
