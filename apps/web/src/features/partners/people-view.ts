import {
  monthOf,
  nextMonth,
  parseScaledDecimal,
  previousMonth,
  type SalaryMonth,
} from '@fabric/core';
import type { PartnerDraft, PartnerView, SplitRuleRow } from '@/local-db';
import { permilleOf } from '@/shared/lib/percent';

/**
 * What the people screens show and how, kept apart from the components so it can be tested.
 * Nothing here is an accounting rule: the weights, the amounts due and the statuses all come
 * from @fabric/core and @fabric/contracts; this only picks and labels what they return.
 */

/** The first day of next month: the usual start of a new profit rule or a pay raise. */
export function nextMonthStart(today: string): string {
  return `${nextMonth(monthOf(today))}-01`;
}

/** The first day of the month `today` is in. */
export function thisMonthStart(today: string): string {
  return `${monthOf(today)}-01`;
}

/** The rule in force today: the latest one that has started (the default, when none has). */
export function ruleInForce(rows: readonly SplitRuleRow[]): SplitRuleRow | undefined {
  return rows.filter((row) => !row.future).at(-1);
}

/** The next rule to take effect, if one is entered. */
export function upcomingRule(rows: readonly SplitRuleRow[]): SplitRuleRow | undefined {
  return rows.find((row) => row.future);
}

export type ProfitParticipant =
  { kind: 'owner' } | { kind: 'shop' } | { kind: 'partner'; partnerId: string };

/** A rule's weight for one participant: 0 when the rule does not name the partner. */
export function weightIn(row: SplitRuleRow, who: ProfitParticipant): number {
  if (who.kind === 'owner') return row.ownerWeight;
  if (who.kind === 'shop') return row.shopWeight;
  return row.partnerWeights.find(({ partnerId }) => partnerId === who.partnerId)?.weight ?? 0;
}

/** Everyone's weights together: the rule's whole. */
export function totalWeight(row: SplitRuleRow): number {
  return row.ownerWeight + row.partnerWeight + row.shopWeight;
}

/** A participant's share of the profit under a rule, in thousandths (333 = 33.3%). Display only. */
export function shareIn(row: SplitRuleRow, who: ProfitParticipant): number {
  return permilleOf(weightIn(row, who), totalWeight(row));
}

/** What a participant gets of the profit now, and from the next rule when that differs. */
export interface ProfitOutlook {
  /** Thousandths under the rule in force today. */
  nowPermille: number;
  /** The next rule's share and the day it starts; null when no rule is coming or it changes nothing for them. */
  next: { permille: number; from: string } | null;
}

/** A participant's profit share under the rule in force and the next one entered. Display only. */
export function profitOutlookOf(
  rows: readonly SplitRuleRow[],
  who: ProfitParticipant,
): ProfitOutlook {
  const current = ruleInForce(rows);
  const upcoming = upcomingRule(rows);
  const nowPermille = current ? shareIn(current, who) : 0;
  const next = upcoming ? { permille: shareIn(upcoming, who), from: upcoming.effectiveFrom } : null;
  return { nowPermille, next: next && next.permille !== nowPermille ? next : null };
}

/**
 * The rules entered after `from` that do not name the partner. When a partner is given a weight
 * from a date, a later rule keeps its own weights: the owner decides whether to add the partner
 * to it, so these are shown, not changed.
 */
export function rulesLeavingOut(
  rows: readonly SplitRuleRow[],
  partnerId: string,
  from: string,
): SplitRuleRow[] {
  return rows.filter(
    (row) =>
      row.rule !== null &&
      row.future &&
      row.effectiveFrom > from &&
      !row.partnerWeights.some((weight) => weight.partnerId === partnerId),
  );
}

export type SalaryStatus = SalaryMonth['status'];

/** The badge colour of a month's pay status; the badge also says it in words. */
export const SALARY_STATUS_VARIANT = {
  none: 'secondary',
  unpaid: 'destructive',
  partial: 'warning',
  paid: 'success',
} as const satisfies Record<SalaryStatus, 'secondary' | 'destructive' | 'warning' | 'success'>;

export type RateTiming = 'current' | 'upcoming' | 'past';

/**
 * Where each salary rate stands today: the one paying this month, the ones that start later, the
 * ones that were replaced. `rates` are one employee's live rates, in any order.
 */
export function rateTimings(
  rates: readonly { id: string; effectiveFrom: string }[],
  today: string,
): Map<string, RateTiming> {
  const monthStart = thisMonthStart(today);
  const current = rates
    .filter((rate) => rate.effectiveFrom <= monthStart)
    .reduce<{ id: string; effectiveFrom: string } | undefined>(
      (latest, rate) => (!latest || rate.effectiveFrom > latest.effectiveFrom ? rate : latest),
      undefined,
    );
  return new Map(
    rates.map((rate): [string, RateTiming] => [
      rate.id,
      rate.id === current?.id ? 'current' : rate.effectiveFrom > monthStart ? 'upcoming' : 'past',
    ]),
  );
}

/** Whether a rate can still be removed: one that has started in a month that is over cannot (PY4). */
export function canVoidRate(rate: { effectiveFrom: string }, today: string): boolean {
  return rate.effectiveFrom >= thisMonthStart(today);
}

/**
 * The months a new salary can start in, as YYYY-MM-01 dates, oldest first. A raise starts this
 * month or later (PY4); the first salary may start in any month from the employee's start (they
 * may have worked here for years), offered up to two years back. A year ahead at most. Never a
 * month before the employee started (salary_rate_before_employment).
 */
export function rateStartOptions(options: {
  today: string;
  /** The month the employee started in (YYYY-MM). */
  startedIn: string;
  /** They already have a salary. */
  hasRate: boolean;
}): string[] {
  const thisMonth = monthOf(options.today);
  let first = thisMonth;
  if (!options.hasRate) {
    for (let back = 0; back < 24; back += 1) first = previousMonth(first);
  }
  if (options.startedIn > first) first = options.startedIn;
  let last = thisMonth;
  for (let ahead = 0; ahead < 12; ahead += 1) last = nextMonth(last);
  if (first > last) last = first;
  const months: string[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) months.push(`${month}-01`);
  return months;
}

/**
 * A percentage typed as text ("33.33"; Arabic-Indic digits too) in basis points (3333): null
 * unless it is 0 to 100 with at most two decimals.
 */
export function shareBp(text: string): number | null {
  const parsed = parseScaledDecimal(text, 2);
  return parsed.ok && parsed.value <= 10_000 ? parsed.value : null;
}

/** The ownership shares typed, added up: `exact` when every one is valid and together they make 100%. */
export function sharesTotal(texts: readonly string[]): {
  bps: (number | null)[];
  totalBp: number;
  exact: boolean;
} {
  const bps = texts.map(shareBp);
  const totalBp = bps.reduce<number>((sum, bp) => sum + (bp ?? 0), 0);
  return { bps, totalBp, exact: bps.every((bp) => bp !== null) && totalBp === 10_000 };
}

/** A profit weight typed as a whole number from 0 to 10000 (Arabic-Indic digits too); null when it is not one. */
export function weightFrom(text: string): number | null {
  const parsed = parseScaledDecimal(text, 0);
  return parsed.ok && parsed.value <= 10_000 ? parsed.value : null;
}

export interface RuleShare {
  key: string;
  label: string;
  weight: number;
  /** Thousandths (250 = 25%). */
  permille: number;
}

/**
 * What a rule's weights come to as shares of the profit: the owner, each partner named, the shop.
 * For showing only; the split of an amount is @fabric/core's.
 */
export function ruleShares(
  rule: {
    ownerWeight: number;
    shopWeight: number;
    partnerWeights: readonly { partnerId: string; weight: number }[];
  },
  labels: { owner: string; shop: string; partner: (partnerId: string) => string },
): RuleShare[] {
  const total =
    rule.ownerWeight +
    rule.shopWeight +
    rule.partnerWeights.reduce((sum, { weight }) => sum + weight, 0);
  const share = (key: string, label: string, weight: number): RuleShare => ({
    key,
    label,
    weight,
    permille: permilleOf(weight, total),
  });
  return [
    share('owner', labels.owner, rule.ownerWeight),
    ...rule.partnerWeights.map(({ partnerId, weight }) =>
      share(`partner:${partnerId}`, labels.partner(partnerId), weight),
    ),
    share('shop', labels.shop, rule.shopWeight),
  ];
}

/**
 * A partner as the table of participants takes them, with `change` on top. The whole record is
 * carried, as saving a record without a field would blank it.
 */
export function draftOf(view: PartnerView, change: Partial<PartnerDraft> = {}): PartnerDraft {
  const { partner } = view;
  return {
    id: partner.id,
    name: partner.name,
    ownershipBp: partner.ownershipBp,
    isOwner: partner.isOwner,
    phone: partner.phone,
    title: partner.title,
    startDate: partner.startDate,
    notes: partner.notes,
    ...change,
  };
}
