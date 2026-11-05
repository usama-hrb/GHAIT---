import {
  dayAfter,
  monthBounds,
  monthOf,
  nextMonth,
  previousMonth,
  type ProfitSplitRule,
  splitByWeights,
} from '@fabric/core';
import type { ValidationIssue } from './errors.js';
import { type ExitState, type Partner, PARTNER_ISSUES } from './partners.js';
import {
  type NamedSplitRule,
  type SplitRule,
  ruleInForceOn,
  sharesProfitFrom,
  type SplitRuleWeights,
  splitRulesOf,
} from './settlements.js';

/**
 * A partner leaves (S20). Nothing is erased: the partner stays, marked with the day they left, so
 * their capital, their undrawn profit and every settlement share they were given stay on their
 * account and can be paid later. The checks here run on the device when the exit is made and on
 * the server when it syncs, because the records an exit writes travel one by one.
 */

/** Who takes over a share of the profit that a leaving partner held. */
export type ExitRecipient =
  { kind: 'owner' } | { kind: 'shop' } | { kind: 'partner'; partnerId: string };

/** A part of the leaving partner's profit share handed to someone: 10000 basis points is all of it. */
export interface ExitShare {
  to: ExitRecipient;
  bp: number;
}

/** A part of the leaving partner's ownership handed to someone, in basis points of the shop. */
export interface OwnershipShare {
  partnerId: string;
  bp: number;
}

/** Where a partner stands: taking part, leaving on a day still to come, or gone. */
export type PartnerStanding = 'active' | 'leaving' | 'former';

export function partnerStandingOf(partner: ExitState, today: string): PartnerStanding {
  if (partner.exitedOn == null) return 'active';
  return partner.exitedOn > today ? 'leaving' : 'former';
}

/**
 * The day the profit rules for an exit start: the day they leave, or tomorrow when that day has
 * passed. A rule is never retroactive (SPEC §8.3, S15), and a period is settled with the rule in
 * force on its first day (S3), so the leaver keeps their share of a period that began before it.
 */
export function exitRuleDate(exitedOn: string, today: string): string {
  const tomorrow = dayAfter(today);
  return exitedOn > tomorrow ? exitedOn : tomorrow;
}

const issue = (path: string, message: string): ValidationIssue => ({
  path: [path],
  message,
  code: 'custom',
});

type ExitPartner = Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'> & ExitState;

/**
 * Whether a partner can exit on a day. `next` is the partner as the exit leaves them: not the
 * owner, owning nothing, and from that day on no rule gives them a share (the rule in force and
 * every later one). Their money is not asked about: what the shop owes them or they it stays on
 * their account. `current` is the partner before the exit.
 */
export function checkPartnerExit(
  next: Pick<Partner, 'id' | 'isOwner' | 'ownershipBp' | 'startDate'> & { exitedOn: string },
  current: ExitState | undefined,
  context: {
    today: string;
    partners: readonly ExitPartner[];
    rules: readonly SplitRuleWeights[];
  },
): ValidationIssue[] {
  if (next.isOwner) return [issue('id', PARTNER_ISSUES.exitOwner)];
  if (current?.exitedOn != null) return [issue('exitedOn', PARTNER_ISSUES.alreadyExited)];
  const issues: ValidationIssue[] = [];
  if (next.startDate !== null && next.exitedOn < next.startDate) {
    issues.push(issue('exitedOn', PARTNER_ISSUES.exitBeforeStart));
  }
  if (next.ownershipBp > 0) issues.push(issue('ownershipBp', PARTNER_ISSUES.hasOwnership));
  const from = exitRuleDate(next.exitedOn, context.today);
  if (sharesProfitFrom(next.id, context.rules, context.partners, from)) {
    issues.push(issue('exitedOn', PARTNER_ISSUES.exitProfitShare));
  }
  return issues;
}

/** Whoever can take over from a leaving partner: the owner and the partners who have not left. */
function takesOver(partner: ExitPartner | undefined, leaverId: string): boolean {
  return (
    partner !== undefined &&
    partner.voidedAt === null &&
    partner.id !== leaverId &&
    partner.exitedOn == null
  );
}

/**
 * The ownership handed over: it is all of what the leaver owns, given to the owner and to partners
 * who have not left (capital is never moved with it, S20). A partner is named once.
 */
export function checkOwnershipTransfer(
  leaver: Pick<Partner, 'id' | 'ownershipBp'>,
  to: readonly OwnershipShare[],
  partners: readonly ExitPartner[],
): ValidationIssue[] {
  const named = new Set<string>();
  for (const { partnerId, bp } of to) {
    const recipient = partners.find(({ id }) => id === partnerId);
    if (!takesOver(recipient, leaver.id) || named.has(partnerId) || bp <= 0) {
      return [issue('ownershipBp', PARTNER_ISSUES.exitRecipient)];
    }
    named.add(partnerId);
  }
  const total = to.reduce((sum, { bp }) => sum + bp, 0);
  return total === leaver.ownershipBp ? [] : [issue('ownershipBp', PARTNER_ISSUES.exitSharesTotal)];
}

/**
 * The profit share handed over. Nothing named means the others keep their weights and so take the
 * leaver's part in proportion; otherwise the parts add up to all of it.
 */
export function checkExitShares(
  shares: readonly ExitShare[],
  leaverId: string,
  partners: readonly ExitPartner[],
): ValidationIssue[] {
  const named = new Set<string>();
  for (const { to, bp } of shares) {
    const key = to.kind === 'partner' ? to.partnerId : to.kind;
    const bad =
      bp <= 0 ||
      named.has(key) ||
      (to.kind === 'partner' &&
        !takesOver(
          partners.find(({ id }) => id === to.partnerId),
          leaverId,
        ));
    if (bad) return [issue('partnerWeights', PARTNER_ISSUES.exitRecipient)];
    named.add(key);
  }
  if (shares.length === 0) return [];
  const total = shares.reduce((sum, { bp }) => sum + bp, 0);
  return total === 10_000 ? [] : [issue('partnerWeights', PARTNER_ISSUES.exitSharesTotal)];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * How `weight` splits by `bps` (they add up to 10000) in whole weights. Weights are whole
 * numbers, so one part of a 1/1/1 rule cannot be halved: the whole rule is scaled up by `scale`
 * (every weight times it, which changes nobody's share) until the split is exact. When that would
 * pass the largest weight a rule allows, the nearest whole split is used instead.
 */
function apportion(
  weight: number,
  bps: readonly number[],
  ruleTotal: number,
): { scale: number; parts: number[] } {
  let scale = 1;
  for (const bp of bps) {
    const step = 10_000 / gcd(weight * bp, 10_000);
    scale = (scale / gcd(scale, step)) * step;
  }
  if (scale * ruleTotal <= 10_000) {
    return { scale, parts: bps.map((bp) => (weight * scale * bp) / 10_000) };
  }
  return { scale: 1, parts: splitByWeights(weight, bps) };
}

/** A rule with the leaver's part taken out and handed to `shares` (or left to the others). */
function ruleWithoutLeaver(
  rule: ProfitSplitRule,
  leaverId: string,
  shares: readonly ExitShare[],
  known: ReadonlySet<string>,
): NamedSplitRule {
  const named = (rule.partnerWeights ?? []).filter(({ partnerId }) => known.has(partnerId));
  const weight = named.find(({ partnerId }) => partnerId === leaverId)?.weight ?? 0;
  const rest = named.filter(({ partnerId }) => partnerId !== leaverId);
  const ruleTotal =
    rule.ownerWeight + rule.shopWeight + named.reduce((sum, w) => sum + w.weight, 0);
  const { scale, parts } =
    weight > 0 && shares.length > 0
      ? apportion(
          weight,
          shares.map(({ bp }) => bp),
          ruleTotal,
        )
      : { scale: 1, parts: [] as number[] };
  let ownerWeight = rule.ownerWeight * scale;
  let shopWeight = rule.shopWeight * scale;
  const partnerWeights = rest.map(({ partnerId, weight: own }) => ({
    partnerId,
    weight: own * scale,
  }));
  for (const [index, { to }] of shares.entries()) {
    const part = parts[index] ?? 0;
    if (to.kind === 'owner') ownerWeight += part;
    else if (to.kind === 'shop') shopWeight += part;
    else {
      const existing = partnerWeights.find(({ partnerId }) => partnerId === to.partnerId);
      if (existing) existing.weight += part;
      else partnerWeights.push({ partnerId: to.partnerId, weight: part });
    }
  }
  // A rule names at least one partner (@fabric/core): the leaver stays in it, at 0.
  if (partnerWeights.length === 0) partnerWeights.push({ partnerId: leaverId, weight: 0 });
  return {
    effectiveFrom: rule.effectiveFrom,
    ownerWeight,
    partnerWeight: partnerWeights.reduce((sum, { weight: own }) => sum + own, 0),
    shopWeight,
    partnerWeights,
  };
}

/** A rule an exit writes: `id` is the live rule it changes in place, or null for a new one. */
export interface ExitRuleChange {
  id: string | null;
  rule: NamedSplitRule;
}

/**
 * The rules that stop the profit going to a partner who leaves (S20): a rule from `from` that is
 * the one in force that day without them, and every later rule that still names them changed the
 * same way. Their part is handed to `shares`, or, with none, left out so that everyone else's part
 * grows in proportion. Rules before `from` are never touched, so no period that has started is
 * settled differently. Nothing when no rule gives them a share. One rule per day (S15): a live
 * rule dated `from` is changed in place.
 */
export function exitRuleChanges(
  rules: readonly SplitRule[],
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
  exit: { partnerId: string; from: string; shares: readonly ExitShare[] },
): ExitRuleChange[] {
  const all = splitRulesOf(rules, partners);
  const weightOf = (rule: ProfitSplitRule) =>
    rule.partnerWeights?.find(({ partnerId }) => partnerId === exit.partnerId)?.weight ?? 0;
  const inForce = ruleInForceOn(all, exit.from);
  const targets = [
    ...(inForce && weightOf(inForce) > 0 ? [{ ...inForce, effectiveFrom: exit.from }] : []),
    ...all.filter((rule) => rule.effectiveFrom > exit.from && weightOf(rule) > 0),
  ];
  const known = new Set(
    partners.filter(({ isOwner, voidedAt }) => !isOwner && voidedAt === null).map(({ id }) => id),
  );
  const live = rules.filter(({ voidedAt }) => voidedAt === null);
  return targets.map((target) => ({
    id: live.find(({ effectiveFrom }) => effectiveFrom === target.effectiveFrom)?.id ?? null,
    rule: ruleWithoutLeaver(target, exit.partnerId, exit.shares, known),
  }));
}

/**
 * Whether profit that is not settled yet will still be shared with a partner (S3): a period is
 * settled with the rule in force on its first day, so every unsettled period that starts before
 * `before` (the day the exit rules take over) and whose rule gives them a share counts. The first
 * unsettled period starts the day after the last settled day; with nothing settled, any of the last
 * two years' months might be the start of the first one.
 */
export function sharesUnsettledProfit(
  partnerId: string,
  rules: readonly SplitRuleWeights[],
  partners: readonly Pick<Partner, 'id' | 'isOwner' | 'createdAt' | 'voidedAt'>[],
  period: { lockedThrough: string | null; before: string; today: string },
): boolean {
  const first = period.lockedThrough === null ? '2000-01-01' : dayAfter(period.lockedThrough);
  const starts = [first];
  let month = period.lockedThrough === null ? monthOf(period.today) : monthOf(first);
  if (period.lockedThrough === null) {
    for (let back = 0; back < 24; back += 1) month = previousMonth(month);
  } else {
    month = nextMonth(month);
  }
  for (let count = 0; count < 120; count += 1) {
    const { start } = monthBounds(month);
    if (start >= period.before) break;
    if (start > first) starts.push(start);
    month = nextMonth(month);
  }
  const all = splitRulesOf(rules, partners);
  return starts.some((start) =>
    ruleInForceOn(all, start)?.partnerWeights?.some(
      ({ partnerId: id, weight }) => id === partnerId && weight > 0,
    ),
  );
}
