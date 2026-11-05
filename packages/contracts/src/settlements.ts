import {
  computeSettlement,
  dayAfter,
  DEFAULT_SPLIT_WEIGHTS,
  monthBounds,
  monthOf,
  type PartnerWeight,
  type PeriodRecords,
  type PeriodSale,
  participantsOf,
  partnerWeightsFor,
  periodResultOf,
  type ProductStockBatchLedger,
  type ProfitSplitRule,
  type SettlementLineKey,
  splitRuleForPeriod,
} from '@fabric/core';
import { z } from 'zod';
import type { CashAdjustment } from './cash-counts.js';
import { recordBaseSchema } from './catalog.js';
import { idSchema, isoDateSchema, timestampSchema } from './common.js';
import type { PaymentAllocation, WriteOff } from './customers.js';
import type { ValidationIssue } from './errors.js';
import type { Expense } from './expenses.js';
import { syncOrder } from './order.js';
import { type CapitalMove, capitalMoveSchema, type Partner } from './partners.js';
import type { SaleReturn } from './returns.js';
import type { Sale, SaleLine } from './sales.js';
import {
  batchLedgerOf,
  netCostsOf,
  type ProductBatch,
  type SequencedProductMove,
  withLockedMoveCosts,
} from './stock.js';

const weightSchema = z.int().min(0).max(10_000);

/** One partner's weight in a rule (S17). */
export const partnerWeightSchema = z.object({ partnerId: idSchema, weight: weightSchema });
export type SplitRulePartnerWeight = z.output<typeof partnerWeightSchema>;

const splitRuleFields = z.object({
  /** Applies to every period that starts on or after it (S3); always a future date (SPEC §8.3). */
  effectiveFrom: isoDateSchema,
  /** Relative weights (S1): 1/1/1 is equal thirds. */
  ownerWeight: weightSchema,
  /** The partners together: the sum of `partnerWeights` (the only partner's weight when null). */
  partnerWeight: weightSchema,
  shopWeight: weightSchema,
  /**
   * Each partner's own weight (S17). Null on a rule made before there could be several partners:
   * it belongs to the shop's first partner (splitRulesOf).
   */
  partnerWeights: z.array(partnerWeightSchema).nullable().default(null),
});

/** SPEC §13 `profit_split_rule`: created, changed or voided only while it is in the future. */
export const splitRuleInputSchema = splitRuleFields;
export type SplitRuleInput = z.input<typeof splitRuleInputSchema>;
/** A rule's fields as stored (partnerWeights always there, null when unnamed). */
export type SplitRuleFields = z.output<typeof splitRuleInputSchema>;
/** A rule that names each partner's weight: what a preview of a change shows, never an unnamed legacy rule. */
export type NamedSplitRule = SplitRuleFields & { partnerWeights: SplitRulePartnerWeight[] };
export const splitRuleSchema = recordBaseSchema.extend(splitRuleFields.shape);
export type SplitRule = z.output<typeof splitRuleSchema>;
export const storedSplitRuleSchema = splitRuleSchema.extend({ serverSeq: z.int().positive() });

/**
 * The rule before any is entered: equal thirds (SPEC §8.1), since always. It is not a record:
 * an entered rule takes effect after it, from a future date.
 */
export const DEFAULT_SPLIT_RULE = {
  effectiveFrom: '2000-01-01',
  ...DEFAULT_SPLIT_WEIGHTS,
} as const satisfies ProfitSplitRule;

/** The breakdown's lines, in order (@fabric/core computeSettlement). */
export const SETTLEMENT_LINE_KEYS = [
  'recognized_profit',
  'returns_effect',
  'bad_debt_recovered',
  'loss_damage',
  'loss_bad_debt',
  'loss_below_cost',
  'expenses',
  'cash_over_short',
  'carried_deficit_in',
  'net_profit',
  'owner_share',
  'partner_share',
  'shop_share',
  'carry_deficit_out',
] as const satisfies readonly SettlementLineKey[];

export const settlementLineSchema = z.object({
  key: z.enum(SETTLEMENT_LINE_KEYS),
  cents: z.int(),
});
export type SettlementLine = z.output<typeof settlementLineSchema>;

/** A settlement's figures (SPEC §8.1, §13): what a preview shows and the record keeps. */
const figuresFields = {
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  recognizedProfitCents: z.int(),
  /** What returns changed in the period (RT4); signed; 0 on settlements made before returns. */
  returnsEffectCents: z.int().default(0),
  recoveredBadDebtCents: z.int(),
  damageCents: z.int(),
  badDebtCents: z.int(),
  belowCostCents: z.int(),
  expensesCents: z.int(),
  cashOverShortCents: z.int(),
  carriedDeficitInCents: z.int(),
  netProfitCents: z.int(),
  ownerShareCents: z.int(),
  partnerShareCents: z.int(),
  shopShareCents: z.int(),
  carryDeficitOutCents: z.int(),
  /** The split rule's weights it was settled with (S3). */
  ownerWeight: z.int(),
  partnerWeight: z.int(),
  shopWeight: z.int(),
  /** Each partner's weight in that rule (S17); null on a settlement made with one partner. */
  partnerWeights: z.array(partnerWeightSchema).nullable().default(null),
};

/**
 * SPEC §13 `settlement`: written by the server when the owner approves (BUILD_PROMPTS 4.3) and
 * pulled by the devices. It locks its period; unlocking voids it (with the reason, audited).
 */
export const settlementSchema = recordBaseSchema.extend({
  ...figuresFields,
  lockedAt: timestampSchema,
});
export type SettlementRecord = z.output<typeof settlementSchema>;

/** A partner's share of a settlement: their balance entry (SPEC §8.1, §13). */
export const settlementShareSchema = recordBaseSchema.extend({
  settlementId: idSchema,
  partnerId: idSchema,
  amountCents: z.int().min(1),
});
export type SettlementShare = z.output<typeof settlementShareSchema>;

/** The cost a settlement froze for a sale or loss move it counted (P9). */
export const lockedCostSchema = recordBaseSchema.extend({
  settlementId: idSchema,
  stockMoveId: idSchema,
  costCents: z.int().min(0),
});
export type LockedCost = z.output<typeof lockedCostSchema>;

export const settlementFiguresSchema = z.object(figuresFields);
export type SettlementFigures = z.output<typeof settlementFiguresSchema>;

export const settlementPreviewSchema = z.object({
  ...figuresFields,
  breakdown: z.array(settlementLineSchema),
  /** What each partner's balance gets (SPEC §8.1): non-zero shares only. */
  shares: z.array(
    z.object({ partnerId: idSchema, role: z.enum(['owner', 'partner']), amountCents: z.int() }),
  ),
  /** The shop's third, kept as capital: retained_profit split by ownership (T10). */
  retainedProfit: z.array(z.object({ partnerId: idSchema, amountCents: z.int() })),
  /** Sale and loss costs approving it freezes (P9). */
  lockedCostCount: z.int(),
});
export type SettlementPreview = z.output<typeof settlementPreviewSchema>;

/** What the owner approves: the period, and the breakdown they saw (it must still hold). */
export const newSettlementSchema = z.object({
  periodEnd: isoDateSchema,
  expected: z.array(settlementLineSchema),
});
export type NewSettlement = z.output<typeof newSettlementSchema>;

export const settlementPreviewQuerySchema = z.object({ end: isoDateSchema });

const withServerSeq = { serverSeq: z.int().positive() };
export const storedSettlementSchema = settlementSchema.extend(withServerSeq);

/** GET /settlements/:id: the settlement and what it created. */
export const settlementDetailSchema = z.object({
  settlement: storedSettlementSchema,
  shares: z.array(settlementShareSchema.extend(withServerSeq)),
  retainedProfit: z.array(capitalMoveSchema.extend(withServerSeq)),
  lockedCostCount: z.int(),
});
export type SettlementDetail = z.output<typeof settlementDetailSchema>;

export const SETTLEMENT_ISSUES = {
  /** A record dated inside a settled period (the error code is period_locked). */
  locked: 'period_locked',
  notEnded: 'settlement_period_not_ended',
  beforeLast: 'settlement_period_already_settled',
  noPartners: 'settlement_needs_partners',
  changed: 'settlement_preview_changed',
  notLatest: 'settlement_unlock_latest_only',
  ruleNotFuture: 'split_rule_not_in_future',
  ruleAllZero: 'split_rule_all_zero',
  ruleDateTaken: 'split_rule_date_taken',
  /** The partners' weights do not add up to the partners' weight. */
  ruleWeightsMismatch: 'split_rule_weights_mismatch',
  /** The rule names someone who is not a partner of the shop. */
  ruleUnknownPartner: 'split_rule_unknown_partner',
  /** With several partners a rule has to say what each one gets. */
  ruleNeedsPartners: 'split_rule_needs_partners',
  /** The rule in effect does not fit the shop's partners: change it before settling. */
  ruleMismatch: 'split_rule_partners_mismatch',
} as const;

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/** The settlement in force with the latest period, or undefined before the first one. */
export function latestSettlementOf<S extends Pick<SettlementRecord, 'periodEnd' | 'voidedAt'>>(
  settlements: readonly S[],
): S | undefined {
  let latest: S | undefined;
  for (const settlement of live(settlements)) {
    if (!latest || settlement.periodEnd > latest.periodEnd) latest = settlement;
  }
  return latest;
}

/** The last settled day: records dated on or before it are locked (null: nothing settled yet). */
export function lockedThroughOf(
  settlements: readonly Pick<SettlementRecord, 'periodEnd' | 'voidedAt'>[],
): string | null {
  return latestSettlementOf(settlements)?.periodEnd ?? null;
}

/**
 * A change dated inside a settled period is refused until that period is unlocked (SPEC §8.3,
 * BUILD_PROMPTS 4.3). `dates` are the ones the change is accounted on (periodDatesOf); null
 * dates (an unpaid expense) count in no period.
 */
export function periodLockIssues(
  dates: readonly (string | null)[],
  lockedThrough: string | null,
): ValidationIssue[] {
  if (lockedThrough === null) return [];
  return dates.some((date) => date !== null && date <= lockedThrough)
    ? [issue(['date'], SETTLEMENT_ISSUES.locked)]
    : [];
}

/**
 * A split rule is entered, changed or voided only while it lies in the future (SPEC §8.3: never
 * retroactive), so no period that has started is settled with it. `current` is the version it
 * replaces (undefined for a new rule).
 */
export function checkSplitRule(
  next: Pick<
    SplitRule,
    'id' | 'effectiveFrom' | 'ownerWeight' | 'partnerWeight' | 'shopWeight' | 'partnerWeights'
  >,
  current: Pick<SplitRule, 'effectiveFrom'> | undefined,
  context: {
    today: string;
    rules: readonly Pick<SplitRule, 'id' | 'effectiveFrom' | 'voidedAt'>[];
    partners: readonly Pick<Partner, 'id' | 'isOwner' | 'voidedAt'>[];
  },
): ValidationIssue[] {
  if (next.effectiveFrom <= context.today || (current && current.effectiveFrom <= context.today)) {
    return [issue(['effectiveFrom'], SETTLEMENT_ISSUES.ruleNotFuture)];
  }
  if (next.ownerWeight + next.partnerWeight + next.shopWeight === 0) {
    return [issue(['ownerWeight'], SETTLEMENT_ISSUES.ruleAllZero)];
  }
  const partners = live(context.partners).filter(({ isOwner }) => !isOwner);
  if (next.partnerWeights === null) {
    // Only a shop with one partner can leave its partners unnamed.
    if (partners.length > 1)
      return [issue(['partnerWeights'], SETTLEMENT_ISSUES.ruleNeedsPartners)];
  } else {
    const known = new Set(partners.map(({ id }) => id));
    if (next.partnerWeights.some(({ partnerId }) => !known.has(partnerId))) {
      return [issue(['partnerWeights'], SETTLEMENT_ISSUES.ruleUnknownPartner)];
    }
    if (
      new Set(next.partnerWeights.map(({ partnerId }) => partnerId)).size !==
      next.partnerWeights.length
    ) {
      return [issue(['partnerWeights'], SETTLEMENT_ISSUES.ruleUnknownPartner)];
    }
    const sum = next.partnerWeights.reduce((total, { weight }) => total + weight, 0);
    if (sum !== next.partnerWeight) {
      return [issue(['partnerWeight'], SETTLEMENT_ISSUES.ruleWeightsMismatch)];
    }
  }
  const taken = live(context.rules).some(
    (rule) => rule.id !== next.id && rule.effectiveFrom === next.effectiveFrom,
  );
  return taken ? [issue(['effectiveFrom'], SETTLEMENT_ISSUES.ruleDateTaken)] : [];
}

/** Voiding a split rule: only one that has not taken effect yet. */
export function checkSplitRuleVoid(
  rule: Pick<SplitRule, 'effectiveFrom'>,
  today: string,
): ValidationIssue[] {
  return rule.effectiveFrom <= today
    ? [issue(['effectiveFrom'], SETTLEMENT_ISSUES.ruleNotFuture)]
    : [];
}

/** The partner a rule that names no partners belongs to: the shop's first one (S17). */
export function firstPartnerOf<
  P extends Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>,
>(partners: readonly P[]): P | undefined {
  let first: P | undefined;
  for (const partner of live(partners)) {
    if (partner.isOwner) continue;
    if (
      !first ||
      partner.createdAt < first.createdAt ||
      (partner.createdAt === first.createdAt && partner.id < first.id)
    ) {
      first = partner;
    }
  }
  return first;
}

/**
 * The rules a period is settled with: the default, then the live entered ones. A rule that names
 * no partners (the default, and any made when the shop had one) belongs to the first partner, so a
 * partner who joined later takes no part in a period settled with it (S17).
 */
export function splitRulesOf(
  rules: readonly SplitRule[],
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
): ProfitSplitRule[] {
  const first = firstPartnerOf(partners);
  return [
    DEFAULT_SPLIT_RULE,
    ...live(rules).map(
      ({ effectiveFrom, ownerWeight, partnerWeight, shopWeight, partnerWeights }) => ({
        effectiveFrom,
        ownerWeight,
        partnerWeight,
        shopWeight,
        ...(partnerWeights ? { partnerWeights } : {}),
      }),
    ),
  ].map((rule): ProfitSplitRule => {
    if ('partnerWeights' in rule || !first) return rule;
    return { ...rule, partnerWeights: [{ partnerId: first.id, weight: rule.partnerWeight }] };
  });
}

/** What each partner's weight is under a rule: the named ones, or the first partner's for an unnamed rule. */
export function partnerWeightsOfRule(
  rule: Pick<SplitRule, 'partnerWeight' | 'partnerWeights'>,
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
): PartnerWeight[] {
  if (rule.partnerWeights) return rule.partnerWeights;
  const first = firstPartnerOf(partners);
  return first ? [{ partnerId: first.id, weight: rule.partnerWeight }] : [];
}

/**
 * The rule that gives one partner a weight from `effectiveFrom` on (S17): the rule in force that
 * day with the partner added to it (or changed in it), nothing else touched. `id` is the live rule
 * already entered for that very day, which is changed in place (one rule per day, S15); null for
 * a new one. Rules after that day are not touched: the owner sees which of them leave the partner
 * out and decides.
 */
export function ruleWithPartnerWeight(
  rules: readonly SplitRule[],
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
  change: { partnerId: string; weight: number; effectiveFrom: string },
): { id: string | null; rule: NamedSplitRule } {
  const inForce: ProfitSplitRule =
    splitRulesOf(rules, partners)
      .filter((rule) => rule.effectiveFrom <= change.effectiveFrom)
      .reduce<ProfitSplitRule | undefined>(
        (latest, rule) => (!latest || rule.effectiveFrom > latest.effectiveFrom ? rule : latest),
        undefined,
      ) ?? DEFAULT_SPLIT_RULE;
  const known = new Set(
    live(partners)
      .filter(({ isOwner }) => !isOwner)
      .map(({ id }) => id),
  );
  const partnerWeights = [
    ...(inForce.partnerWeights ?? []).filter(
      ({ partnerId }) => partnerId !== change.partnerId && known.has(partnerId),
    ),
    { partnerId: change.partnerId, weight: change.weight },
  ];
  const sameDay = live(rules).find(({ effectiveFrom }) => effectiveFrom === change.effectiveFrom);
  return {
    id: sameDay?.id ?? null,
    rule: {
      effectiveFrom: change.effectiveFrom,
      ownerWeight: inForce.ownerWeight,
      partnerWeight: partnerWeights.reduce((sum, { weight }) => sum + weight, 0),
      shopWeight: inForce.shopWeight,
      partnerWeights,
    },
  };
}

/** Whether a partner still takes part: they hold part of the shop or share in the profit from now on. */
export type PartnerStatus = 'active' | 'inactive';

/**
 * The owner is always active. A partner is active while they own a part of the shop (ownership
 * above 0) or the rule in force today, or one that starts later, gives them a weight (S18). It is
 * worked out, never stored, so it cannot disagree with the ownership and the rules.
 */
export function partnerStatusOf(
  partner: Pick<Partner, 'id' | 'isOwner' | 'ownershipBp'>,
  rules: readonly SplitRule[],
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
  today: string,
): PartnerStatus {
  if (partner.isOwner || partner.ownershipBp > 0) return 'active';
  const all = splitRulesOf(rules, partners);
  const current = all
    .filter((rule) => rule.effectiveFrom <= today)
    .reduce<ProfitSplitRule | undefined>(
      (latest, rule) => (!latest || rule.effectiveFrom > latest.effectiveFrom ? rule : latest),
      undefined,
    );
  const upcoming = all.filter((rule) => rule.effectiveFrom > today);
  return [...(current ? [current] : []), ...upcoming].some((rule) =>
    rule.partnerWeights?.some(({ partnerId, weight }) => partnerId === partner.id && weight > 0),
  )
    ? 'active'
    : 'inactive';
}

/** Moves with the costs live settlements froze for them (P9), for batchLedgerOf. */
export const withLockedCosts: typeof withLockedMoveCosts = withLockedMoveCosts;

/** Everything a settlement is computed from, voided records included. */
export interface SettlementRecords {
  batches: readonly ProductBatch[];
  /** With their server_seq where known (history order). */
  stockMoves: readonly SequencedProductMove[];
  sales: readonly Sale[];
  saleLines: readonly SaleLine[];
  /** Goods given back (RT1), voided ones included. */
  saleReturns: readonly SaleReturn[];
  allocations: readonly (PaymentAllocation & { serverSeq?: number | null })[];
  writeOffs: readonly WriteOff[];
  expenses: readonly Expense[];
  cashAdjustments: readonly CashAdjustment[];
  lockedCosts: readonly LockedCost[];
  settlements: readonly SettlementRecord[];
  splitRules: readonly SplitRule[];
  partners: readonly Partner[];
}

/** Map.groupBy (ES2024; the project targets ES2023). */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** What settlements and the integrity check derive from the records, computed once. */
export interface PeriodBasis {
  /** Each batch's ledger, with the costs earlier settlements froze (P9). */
  ledgers: Map<string, ProductStockBatchLedger>;
  /** Each sale or loss move's cost. */
  costOf: Map<string, number>;
  /** Moves whose cost a live settlement froze. */
  frozen: Set<string>;
  /** Each sale move's cost before its returns (what a settlement freezes). */
  grossCostOf: Map<string, number>;
  /**
   * Live sales, with the ids of their sale moves. `period` is the invoice as it was sold and its
   * returns, for periodResultOf; `now` is the invoice once its returns are taken off.
   */
  sales: {
    sale: Sale;
    moveIds: string[];
    period: PeriodSale;
    now: { totalCents: number; capitalCents: number };
  }[];
  /** Loss moves that were not reversed, at cost. */
  losses: { id: string; date: string; costCents: number }[];
  /** What periodResultOf takes. */
  records: PeriodRecords;
}

/**
 * The records as the settlement sees them (BUILD_PROMPTS 4.3): every sale and loss costed on
 * its batch's ledger, frozen costs kept; each live sale with its capital, the payments applied
 * to it in history order (syncOrder) and its write-off; live expenses and cash counts.
 */
export function periodBasisOf(records: SettlementRecords): PeriodBasis {
  const moves = withLockedCosts(records.stockMoves, records.lockedCosts);
  const movesByBatch = groupBy(moves, (move) => move.batchId);
  const ledgers = new Map<string, ProductStockBatchLedger>();
  const costOf = new Map<string, number>();
  const grossCostOf = new Map<string, number>();
  const returnCostOf = new Map<string, number>();
  for (const batch of records.batches) {
    const ledger = batchLedgerOf(batch, movesByBatch.get(batch.id) ?? []);
    ledgers.set(batch.id, ledger);
    // The ledger keeps a sale's gross cost and its returns apart; the period counts the net.
    for (const cost of netCostsOf(ledger)) costOf.set(cost.moveId, cost.costCents);
    for (const cost of ledger.costs) grossCostOf.set(cost.moveId, cost.costCents);
    for (const back of ledger.returns) returnCostOf.set(back.moveId, back.costCents);
  }
  const moveOfLine = new Map<string, string>();
  for (const move of moves) {
    if (move.type === 'sale' && move.refId) moveOfLine.set(move.refId, move.id);
  }
  const linesBySale = groupBy(records.saleLines, (line) => line.saleId);
  const allocationsBySale = groupBy(records.allocations, (allocation) => allocation.saleId);
  const returnsBySale = groupBy(live(records.saleReturns), (given) => given.saleId);
  const writtenOffOn = new Map(live(records.writeOffs).map((w) => [w.saleId, w.date]));

  const sales = live(records.sales).map((sale) => {
    let capitalCents = 0;
    const moveIds: string[] = [];
    for (const line of linesBySale.get(sale.id) ?? []) {
      const moveId = moveOfLine.get(line.id);
      const cost = moveId === undefined ? undefined : grossCostOf.get(moveId);
      if (moveId === undefined || cost === undefined) {
        throw new Error(`sale line ${line.id} has no cost`);
      }
      capitalCents += cost;
      moveIds.push(moveId);
    }
    const allocations = [...(allocationsBySale.get(sale.id) ?? [])].sort(syncOrder);
    // Each return in the order it was recorded among the payments (RT4).
    const returns = [...(returnsBySale.get(sale.id) ?? [])].sort(syncOrder).map((given) => ({
      date: given.date,
      creditCents: given.creditCents,
      costCents: given.lines.reduce(
        (total, line) => total + (returnCostOf.get(line.moveId) ?? 0),
        0,
      ),
      after: allocations.filter((allocation) => syncOrder(allocation, given) < 0).length,
    }));
    const period: PeriodSale = {
      date: sale.date,
      totalCents: sale.totalCents,
      capitalCents,
      allocations: allocations.map((allocation) => ({
        date: allocation.date,
        amountCents: allocation.amountCents,
      })),
      writtenOffOn: writtenOffOn.get(sale.id) ?? null,
      returns,
    };
    const now = {
      totalCents: sale.totalCents - returns.reduce((total, given) => total + given.creditCents, 0),
      capitalCents: capitalCents - returns.reduce((total, given) => total + given.costCents, 0),
    };
    return { sale, moveIds, period, now };
  });
  const losses = moves
    .filter((move) => move.type === 'loss' && costOf.has(move.id))
    .map((move) => ({ id: move.id, date: move.date, costCents: costOf.get(move.id) ?? 0 }));
  return {
    ledgers,
    costOf,
    grossCostOf,
    frozen: new Set(
      moves.filter((move) => move.lockedCostCents !== undefined).map((move) => move.id),
    ),
    sales,
    losses,
    records: {
      sales: sales.map(({ period }) => period),
      losses,
      expenses: live(records.expenses).map((expense) => ({
        paidDate: expense.paidDate,
        amountCents: expense.amountCents,
      })),
      cashAdjustments: live(records.cashAdjustments).map((count) => ({
        date: count.date,
        diffCents: count.diffCents,
      })),
    },
  };
}

export type SettlementPreviewResult =
  | {
      ok: true;
      preview: SettlementPreview;
      /** The costs to freeze (P9): each counted sale and loss move not frozen yet. */
      lockedCosts: { stockMoveId: string; costCents: number }[];
    }
  | { ok: false; issues: ValidationIssue[] };

/**
 * The settlement of the period that ends on `periodEnd` (SPEC §8, BUILD_PROMPTS 4.3). The period
 * starts the day after the last settlement (the first one takes everything before it), so
 * periods never overlap or leave a gap; it can be settled once it has ended. Its amounts come
 * from the records through @fabric/core periodResultOf and computeSettlement, each batch costed
 * with the costs earlier settlements froze.
 */
export function previewSettlement(
  records: SettlementRecords,
  input: { periodEnd: string; today: string },
): SettlementPreviewResult {
  const { periodEnd } = input;
  const latest = latestSettlementOf(records.settlements);
  const after = latest?.periodEnd ?? null;
  if (periodEnd >= input.today) {
    return { ok: false, issues: [issue(['periodEnd'], SETTLEMENT_ISSUES.notEnded)] };
  }
  if (after !== null && periodEnd <= after) {
    return { ok: false, issues: [issue(['periodEnd'], SETTLEMENT_ISSUES.beforeLast)] };
  }
  const partners = live(records.partners).map((partner) => ({
    partnerId: partner.id,
    ownershipBp: partner.ownershipBp,
    isOwner: partner.isOwner,
  }));
  let participants;
  try {
    participants = participantsOf(partners);
  } catch {
    return { ok: false, issues: [issue(['partners'], SETTLEMENT_ISSUES.noPartners)] };
  }
  const splitRules = splitRulesOf(records.splitRules, records.partners);

  const basis = periodBasisOf(records);
  // A sale's capital is frozen once anything about it is counted, so its payments' parts stay
  // put; a loss once its date is (S14).
  const toFreeze = new Set<string>();
  for (const { moveIds, period } of basis.sales) {
    const counted =
      period.date <= periodEnd ||
      period.allocations.some((allocation) => allocation.date <= periodEnd) ||
      (period.writtenOffOn !== null && period.writtenOffOn <= periodEnd);
    if (counted) for (const moveId of moveIds) toFreeze.add(moveId);
  }
  for (const loss of basis.losses) if (loss.date <= periodEnd) toFreeze.add(loss.id);
  const result = periodResultOf(
    basis.records,
    { after, end: periodEnd },
    latest?.carryDeficitOutCents ?? 0,
  );
  // The first period starts with the shop's first sale, loss or expense (or its month).
  const earliest = [
    monthBounds(monthOf(periodEnd)).start,
    ...basis.records.sales.map((sale) => sale.date),
    ...basis.losses.map((loss) => loss.date),
    ...basis.records.expenses.flatMap((expense) => expense.paidDate ?? []),
  ].reduce((min, date) => (date < min ? date : min));
  const periodStart = after === null ? earliest : dayAfter(after);
  try {
    // The rule in force must say what each of today's partners gets; refuse rather than guess.
    partnerWeightsFor(splitRuleForPeriod(splitRules, periodStart), participants);
  } catch {
    return { ok: false, issues: [issue(['splitRule'], SETTLEMENT_ISSUES.ruleMismatch)] };
  }
  const settlement = computeSettlement({
    periodStart,
    periodEnd,
    ...result,
    splitRules,
    partners,
  });

  const lockedCosts = [...toFreeze]
    .filter((moveId) => !basis.frozen.has(moveId))
    .map((stockMoveId) => ({ stockMoveId, costCents: basis.grossCostOf.get(stockMoveId) ?? 0 }));
  return {
    ok: true,
    preview: {
      periodStart: settlement.periodStart,
      periodEnd,
      recognizedProfitCents: settlement.recognizedProfitCents,
      returnsEffectCents: settlement.returnsEffectCents,
      recoveredBadDebtCents: settlement.recoveredBadDebtCents,
      damageCents: result.losses.damageCents,
      badDebtCents: result.losses.badDebtCents,
      belowCostCents: result.losses.belowCostCents,
      expensesCents: settlement.expensesCents,
      cashOverShortCents: settlement.cashOverShortCents,
      carriedDeficitInCents: settlement.carriedDeficitInCents,
      netProfitCents: settlement.netProfitCents,
      ownerShareCents: settlement.ownerShareCents,
      partnerShareCents: settlement.partnerShareCents,
      shopShareCents: settlement.shopShareCents,
      carryDeficitOutCents: settlement.carryDeficitOutCents,
      ownerWeight: settlement.splitRule.ownerWeight,
      partnerWeight: settlement.splitRule.partnerWeight,
      shopWeight: settlement.splitRule.shopWeight,
      partnerWeights: settlement.partnerWeights,
      breakdown: settlement.breakdown,
      shares: settlement.partnerShares,
      retainedProfit: settlement.capitalMoves.map(({ partnerId, amountCents }) => ({
        partnerId,
        amountCents,
      })),
      lockedCostCount: lockedCosts.length,
    },
    lockedCosts,
  };
}

/** The records an approved settlement creates, stored together (BUILD_PROMPTS 4.3). */
export interface SettlementAggregate {
  settlement: SettlementRecord;
  shares: SettlementShare[];
  /** retained_profit capital moves dated on the period's last day (T10). */
  retainedProfit: CapitalMove[];
  lockedCosts: LockedCost[];
}

/**
 * Approving a settlement: the preview must still give what the owner saw (`expected`), or
 * something changed since (another device synced) and they look again.
 */
export function buildSettlement(
  records: SettlementRecords,
  input: NewSettlement & { today: string },
  ids: { settlementId: string; newId: () => string },
  meta: { deviceId: string; now: string },
):
  | { ok: true; aggregate: SettlementAggregate; preview: SettlementPreview }
  | { ok: false; issues: ValidationIssue[] } {
  const result = previewSettlement(records, input);
  if (!result.ok) return result;
  const { preview } = result;
  if (JSON.stringify(preview.breakdown) !== JSON.stringify(input.expected)) {
    return { ok: false, issues: [issue(['expected'], SETTLEMENT_ISSUES.changed)] };
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const { settlementId } = ids;
  const figures = settlementFiguresSchema.parse(preview);
  return {
    ok: true,
    preview,
    aggregate: {
      settlement: { ...base, id: settlementId, ...figures, lockedAt: meta.now },
      shares: preview.shares.map((share) => ({
        ...base,
        id: ids.newId(),
        settlementId,
        partnerId: share.partnerId,
        amountCents: share.amountCents,
      })),
      retainedProfit: preview.retainedProfit.map((move) => ({
        ...base,
        id: ids.newId(),
        partnerId: move.partnerId,
        type: 'retained_profit',
        amountCents: move.amountCents,
        date: preview.periodEnd,
        note: null,
        settlementId,
      })),
      lockedCosts: result.lockedCosts.map((cost) => ({
        ...base,
        id: ids.newId(),
        settlementId,
        stockMoveId: cost.stockMoveId,
        costCents: cost.costCents,
      })),
    },
  };
}

/**
 * A stored settlement's breakdown: the lines computeSettlement gave when it was approved, from
 * the figures the record keeps (deductions negative, as in the preview).
 */
export function breakdownOf(figures: SettlementFigures): SettlementLine[] {
  const net = figures.netProfitCents;
  return [
    { key: 'recognized_profit', cents: figures.recognizedProfitCents },
    { key: 'returns_effect', cents: figures.returnsEffectCents },
    { key: 'bad_debt_recovered', cents: figures.recoveredBadDebtCents },
    { key: 'loss_damage', cents: 0 - figures.damageCents },
    { key: 'loss_bad_debt', cents: 0 - figures.badDebtCents },
    { key: 'loss_below_cost', cents: 0 - figures.belowCostCents },
    { key: 'expenses', cents: 0 - figures.expensesCents },
    { key: 'cash_over_short', cents: figures.cashOverShortCents },
    { key: 'carried_deficit_in', cents: 0 - figures.carriedDeficitInCents },
    { key: 'net_profit', cents: net },
    ...(net > 0
      ? ([
          { key: 'owner_share', cents: figures.ownerShareCents },
          { key: 'partner_share', cents: figures.partnerShareCents },
          { key: 'shop_share', cents: figures.shopShareCents },
        ] as const)
      : ([{ key: 'carry_deficit_out', cents: figures.carryDeficitOutCents }] as const)),
  ];
}

/** Only the latest settlement can be unlocked: a later one carried its deficit (SPEC §8.3). */
export function checkUnlock(
  settlement: SettlementRecord,
  settlements: readonly SettlementRecord[],
): ValidationIssue[] {
  return settlement.voidedAt === null && latestSettlementOf(settlements)?.id === settlement.id
    ? []
    : [issue(['id'], SETTLEMENT_ISSUES.notLatest)];
}
