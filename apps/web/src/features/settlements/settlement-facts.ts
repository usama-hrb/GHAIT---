import {
  breakdownOf,
  DEFAULT_SPLIT_RULE,
  type SettlementFigures,
  type SettlementLine,
  type SettlementPreview,
} from '@fabric/contracts';
import { monthBounds, monthOf, type ProfitSplitRule, splitRuleForPeriod } from '@fabric/core';
import { permilleOf } from '@/shared/lib/percent';

/*
 * What the settlement screens show, read from figures that are already computed: the server's
 * preview (or this device's, offline), or a settlement as it was approved. Nothing here works out
 * an accounting amount: it groups the breakdown's lines, names who receives each share and checks
 * that what is shown adds up. The formulas are @fabric/core's (computeSettlement, S1-S16).
 */

/** The partner records a settlement's shares point to: the owner and every partner. */
export interface Participant {
  partnerId: string;
  name: string;
  isOwner: boolean;
  /** Basis points (5000 = 50%): how the shop's share is split between everyone as capital (T10). */
  ownershipBp: number;
}

/** The participants of a list of partner views, in the order given (the owner first). */
export function participantsOf(
  partners: readonly {
    partner: { id: string; name: string; isOwner: boolean; ownershipBp: number };
  }[],
): Participant[] {
  return partners.map(({ partner }) => ({
    partnerId: partner.id,
    name: partner.name,
    isOwner: partner.isOwner,
    ownershipBp: partner.ownershipBp,
  }));
}

/** One settlement's figures, from a preview or from a stored settlement. */
export interface SettlementFacts {
  periodStart: string;
  periodEnd: string;
  breakdown: readonly SettlementLine[];
  netProfitCents: number;
  ownerShareCents: number;
  partnerShareCents: number;
  shopShareCents: number;
  carryDeficitOutCents: number;
  /**
   * The split rule's weights it was settled with (S15). `partner` is the partners together;
   * `partners` names each one's own (S17), null on a settlement made with a single partner.
   */
  weights: {
    owner: number;
    partner: number;
    shop: number;
    partners: readonly { partnerId: string; weight: number }[] | null;
  };
  /** The owner's and each partner's shares: their undrawn profit (non-zero amounts only). */
  shares: readonly { partnerId: string; amountCents: number }[];
  /** The shop's share, kept as capital: `retained_profit` per partner, split by ownership. */
  retained: readonly { partnerId: string; amountCents: number }[];
}

export function factsOfPreview(preview: SettlementPreview): SettlementFacts {
  return {
    periodStart: preview.periodStart,
    periodEnd: preview.periodEnd,
    breakdown: preview.breakdown,
    netProfitCents: preview.netProfitCents,
    ownerShareCents: preview.ownerShareCents,
    partnerShareCents: preview.partnerShareCents,
    shopShareCents: preview.shopShareCents,
    carryDeficitOutCents: preview.carryDeficitOutCents,
    weights: {
      owner: preview.ownerWeight,
      partner: preview.partnerWeight,
      shop: preview.shopWeight,
      partners: preview.partnerWeights,
    },
    shares: preview.shares.map(({ partnerId, amountCents }) => ({ partnerId, amountCents })),
    retained: preview.retainedProfit.map(({ partnerId, amountCents }) => ({
      partnerId,
      amountCents,
    })),
  };
}

/** What a stored settlement keeps of one partner's share or capital move. */
interface StoredAmount {
  partnerId: string;
  amountCents: number;
}

/**
 * A settlement as it was approved: its own figures and weights, never recomputed (S15). An
 * unlocked settlement keeps its figures too: its shares are cancelled but still tell what it was.
 */
export function factsOfSettlement(view: {
  settlement: SettlementFigures;
  shares: readonly StoredAmount[];
  retainedProfit: readonly StoredAmount[];
}): SettlementFacts {
  const { settlement } = view;
  return {
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    breakdown: breakdownOf(settlement),
    netProfitCents: settlement.netProfitCents,
    ownerShareCents: settlement.ownerShareCents,
    partnerShareCents: settlement.partnerShareCents,
    shopShareCents: settlement.shopShareCents,
    carryDeficitOutCents: settlement.carryDeficitOutCents,
    weights: {
      owner: settlement.ownerWeight,
      partner: settlement.partnerWeight,
      shop: settlement.shopWeight,
      partners: settlement.partnerWeights,
    },
    shares: view.shares.map(({ partnerId, amountCents }) => ({ partnerId, amountCents })),
    retained: view.retainedProfit.map(({ partnerId, amountCents }) => ({
      partnerId,
      amountCents,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// The breakdown, grouped

/** What a line is about; the order is the order shown. */
export type BreakdownGroupKey = 'profit' | 'sales' | 'losses' | 'costs' | 'before';

type AdjustmentKey = Exclude<
  SettlementLine['key'],
  'net_profit' | 'owner_share' | 'partner_share' | 'shop_share' | 'carry_deficit_out'
>;

/**
 * Where each line of the net profit sits. Only grouping: every line keeps its own signed amount
 * (a deduction is negative, as computeSettlement gives it), so the groups add up to the net profit.
 */
export const BREAKDOWN_GROUPS: readonly {
  key: BreakdownGroupKey;
  lines: readonly AdjustmentKey[];
}[] = [
  { key: 'profit', lines: ['recognized_profit'] },
  { key: 'sales', lines: ['returns_effect', 'bad_debt_recovered'] },
  { key: 'losses', lines: ['loss_damage', 'loss_bad_debt', 'loss_below_cost'] },
  { key: 'costs', lines: ['expenses', 'cash_over_short'] },
  { key: 'before', lines: ['carried_deficit_in'] },
];

export interface BreakdownGroup {
  key: BreakdownGroupKey;
  lines: SettlementLine[];
  /** The plain sum of the group's signed lines. */
  subtotalCents: number;
}

export interface GroupedBreakdown {
  groups: BreakdownGroup[];
  netProfitCents: number;
  /** The groups add up to the net profit line (always, for a breakdown from computeSettlement). */
  reconciles: boolean;
}

/** The breakdown's lines in groups; a zero line stays (reconciliation needs it). */
export function groupedBreakdown(lines: readonly SettlementLine[]): GroupedBreakdown {
  const byKey = new Map(lines.map((line) => [line.key, line]));
  const groups = BREAKDOWN_GROUPS.map(({ key, lines: keys }) => {
    const members = keys.map((lineKey) => byKey.get(lineKey) ?? { key: lineKey, cents: 0 });
    return {
      key,
      lines: members,
      subtotalCents: members.reduce((sum, line) => sum + line.cents, 0),
    };
  });
  const netProfitCents = byKey.get('net_profit')?.cents ?? 0;
  const sum = groups.reduce((total, group) => total + group.subtotalCents, 0);
  return { groups, netProfitCents, reconciles: sum === netProfitCents };
}

/** The adjustments together: every group but the profit (so the profit plus this is the net). */
export function adjustmentsTotalOf(grouped: GroupedBreakdown): number {
  return grouped.groups
    .filter((group) => group.key !== 'profit')
    .reduce((sum, group) => sum + group.subtotalCents, 0);
}

// ---------------------------------------------------------------------------------------------
// The distribution

export interface Allocation {
  /** Tells the rows of one distribution apart (the owner, each partner, the shop). */
  id: string;
  kind: 'owner' | 'partner' | 'shop';
  /** Who gets it: the owner's or a partner's name; the shop has none. */
  participant: Participant | null;
  amountCents: number;
  weight: number;
  /** The weight's part of all the weights, in thousandths, rounded half up (display only). */
  permille: number;
  /** The shop's share only: what each partner's capital receives. */
  capital: { participant: Participant | undefined; partnerId: string; amountCents: number }[];
}

export interface Distribution {
  /** Net profit above zero: there is something to share out. */
  distributes: boolean;
  /** The owner, each partner who takes part, then the shop. */
  allocations: Allocation[];
  /**
   * The shares add up to the net profit, the partners' add up to the partners' share, and the
   * capital moves add up to the shop's share.
   */
  reconciles: boolean;
}

/**
 * Who receives what: the owner's share, each partner's, and the shop's, as the settlement
 * computed them (the division's odd cents are in the shop's, as computeSettlement leaves them),
 * and the capital moves of the shop's share. The weights are the rule's: a settlement that names
 * none (made with one partner) belongs to that partner (S17).
 */
export function distributionOf(
  facts: SettlementFacts,
  participants: readonly Participant[],
): Distribution {
  const totalWeight = facts.weights.owner + facts.weights.partner + facts.weights.shop;
  const permille = (weight: number) => permilleOf(weight, totalWeight);
  const owner = participants.find((candidate) => candidate.isOwner) ?? null;
  const byId = new Map(participants.map((candidate) => [candidate.partnerId, candidate]));
  const capital = facts.retained.map(({ partnerId, amountCents }) => ({
    participant: byId.get(partnerId),
    partnerId,
    amountCents,
  }));
  const partnerShares = new Map(
    facts.shares
      .filter(({ partnerId }) => partnerId !== owner?.partnerId)
      .map(({ partnerId, amountCents }) => [partnerId, amountCents]),
  );
  // Who took part: the partners the rule names (a weight above zero), plus anyone who got a
  // share. A settlement that names none belongs to its one partner: whoever got the share, or the
  // shop's first partner (the owner is listed first, then the partners in the order they joined).
  const named = facts.weights.partners
    ? facts.weights.partners.filter(({ weight }) => weight > 0)
    : [
        {
          partnerId:
            [...partnerShares.keys()][0] ??
            participants.find((candidate) => !candidate.isOwner)?.partnerId ??
            '',
          weight: facts.weights.partner,
        },
      ].filter(({ weight }) => weight > 0);
  const weightOf = new Map(named.map(({ partnerId, weight }) => [partnerId, weight]));
  const partnerIds = [...new Set([...weightOf.keys(), ...partnerShares.keys()])];
  const joined = (partnerId: string) => {
    const at = participants.findIndex((candidate) => candidate.partnerId === partnerId);
    return at === -1 ? participants.length : at;
  };
  const partners: Allocation[] = partnerIds
    .sort((a, b) => joined(a) - joined(b))
    .map((partnerId) => ({
      id: `partner:${partnerId}`,
      kind: 'partner',
      participant: byId.get(partnerId) ?? null,
      amountCents: partnerShares.get(partnerId) ?? 0,
      weight: weightOf.get(partnerId) ?? 0,
      permille: permille(weightOf.get(partnerId) ?? 0),
      capital: [],
    }));
  const allocations: Allocation[] = [
    {
      id: 'owner',
      kind: 'owner',
      participant: owner,
      amountCents: facts.ownerShareCents,
      weight: facts.weights.owner,
      permille: permille(facts.weights.owner),
      capital: [],
    },
    ...partners,
    {
      id: 'shop',
      kind: 'shop',
      participant: null,
      amountCents: facts.shopShareCents,
      weight: facts.weights.shop,
      permille: permille(facts.weights.shop),
      capital,
    },
  ];
  const distributes = facts.netProfitCents > 0;
  const shared = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const partnersTotal = partners.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const retained = capital.reduce((sum, move) => sum + move.amountCents, 0);
  const reconciles = distributes
    ? shared === facts.netProfitCents &&
      partnersTotal === facts.partnerShareCents &&
      retained === facts.shopShareCents
    : shared === 0 && retained === 0 && facts.carryDeficitOutCents === -facts.netProfitCents;
  return { distributes, allocations, reconciles };
}

/**
 * The rule a period starts under (S3): the latest in effect on its first day. `rows` are the
 * entered rules; the default (equal thirds, since the start) is always there before them.
 */
export function ruleInEffect(
  rows: readonly ProfitSplitRule[],
  periodStart: string,
): { rule: ProfitSplitRule; isDefault: boolean } {
  const rule = splitRuleForPeriod([DEFAULT_SPLIT_RULE, ...rows], periodStart);
  return { rule, isDefault: rule.effectiveFrom === DEFAULT_SPLIT_RULE.effectiveFrom };
}

// ---------------------------------------------------------------------------------------------
// The state of a period, and its name

/** What the screen calls a period: the three states the settlement already has. */
export type PeriodState = 'settled' | 'ready' | 'notSettled';

/**
 * Settled and locked: a live settlement holds it. Ready for approval: its figures can be
 * computed (it has ended, it follows the last settlement, the partners are set up). Otherwise
 * not settled. No state is stored: this reads the settlement records and the preview's result.
 */
export function periodStateOf(input: { settled: boolean; previewOk: boolean }): PeriodState {
  if (input.settled) return 'settled';
  return input.previewOk ? 'ready' : 'notSettled';
}

/** The period is exactly one calendar month (so it can be called by the month's name). */
export function isWholeMonth(start: string, end: string): boolean {
  const bounds = monthBounds(monthOf(end));
  return start === bounds.start && end === bounds.end;
}
