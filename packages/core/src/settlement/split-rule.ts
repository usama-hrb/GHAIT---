import { assertInteger, splitByWeights } from '../numeric/index.js';
import type { PartnerOwnership } from './ownership.js';

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Throws unless `value` is a YYYY-MM-DD date. Dates are compared as text, so the format must be exact. */
export function assertIsoDate(value: string, name: string): void {
  if (!ISO_DATE.test(value)) {
    throw new RangeError(`${name} must be a YYYY-MM-DD date, got "${value}"`);
  }
}

/** One partner's weight in a split rule. */
export interface PartnerWeight {
  partnerId: string;
  weight: number;
}

/** The shares of a period's net profit (SPEC §8.1) as of a date (profit_split_rule). */
export interface ProfitSplitRule {
  /** YYYY-MM-DD. Applies to every period that starts on or after this date (SPEC §8.3). */
  effectiveFrom: string;
  /**
   * Relative weights, not percentages: owner and partner get floor(net × weight / Σ weights)
   * and the shop gets the rest. 1/1/1 is exact thirds; basis points also work (4000/4000/2000).
   */
  ownerWeight: number;
  /** The partners together: the only partner's weight in a shop with one, else the sum of `partnerWeights`. */
  partnerWeight: number;
  shopWeight: number;
  /**
   * Each partner's own weight (S17); they add up to `partnerWeight`. Absent: the rule was made
   * for a shop with one partner, and that partner has all of `partnerWeight`.
   */
  partnerWeights?: readonly PartnerWeight[];
}

/**
 * SPEC §8.1, §8.3: equal thirds. Weights rather than basis points: 3333/3333/3334 bp would give
 * T6 9999/9999/10002 instead of 10000/10000/10000 (docs/accounting-assumptions.md S1).
 */
export const DEFAULT_SPLIT_WEIGHTS = { ownerWeight: 1, partnerWeight: 1, shopWeight: 1 } as const;

function assertRule(rule: ProfitSplitRule): void {
  assertIsoDate(rule.effectiveFrom, 'effectiveFrom');
  assertInteger(rule.ownerWeight, 'ownerWeight', 0);
  assertInteger(rule.partnerWeight, 'partnerWeight', 0);
  assertInteger(rule.shopWeight, 'shopWeight', 0);
  if (rule.ownerWeight + rule.partnerWeight + rule.shopWeight === 0) {
    throw new RangeError(`split rule of ${rule.effectiveFrom} has only zero weights`);
  }
  if (rule.partnerWeights === undefined) return;
  if (rule.partnerWeights.length === 0) {
    throw new RangeError(`split rule of ${rule.effectiveFrom} names no partner`);
  }
  const named = new Set<string>();
  let sum = 0;
  for (const { partnerId, weight } of rule.partnerWeights) {
    assertInteger(weight, `weight of ${partnerId}`, 0);
    if (named.has(partnerId)) {
      throw new RangeError(`split rule of ${rule.effectiveFrom} names ${partnerId} twice`);
    }
    named.add(partnerId);
    sum += weight;
  }
  if (sum !== rule.partnerWeight) {
    throw new RangeError(
      `partnerWeights of ${rule.effectiveFrom} add up to ${String(sum)}, partnerWeight is ${String(rule.partnerWeight)}`,
    );
  }
}

/**
 * The rule a period is settled with: the latest one in effect on its first day. Rules are never
 * applied retroactively (SPEC §8.3), so a rule that starts inside a period first applies to the
 * next one (S3).
 */
export function splitRuleForPeriod(
  rules: readonly ProfitSplitRule[],
  periodStart: string,
): ProfitSplitRule {
  assertIsoDate(periodStart, 'periodStart');
  let selected: ProfitSplitRule | undefined;
  const seen = new Set<string>();
  for (const rule of rules) {
    assertRule(rule);
    if (seen.has(rule.effectiveFrom)) {
      throw new RangeError(`two split rules take effect on ${rule.effectiveFrom}`);
    }
    seen.add(rule.effectiveFrom);
    if (
      rule.effectiveFrom <= periodStart &&
      (!selected || rule.effectiveFrom > selected.effectiveFrom)
    ) {
      selected = rule;
    }
  }
  if (!selected) throw new RangeError(`no split rule in effect on ${periodStart}`);
  return selected;
}

export interface ProfitShares {
  ownerCents: number;
  /** All the partners together. */
  partnerCents: number;
  shopCents: number;
  /** Each named partner's part of `partnerCents`, by id (when the rule names its partners). */
  partners?: { partnerId: string; cents: number }[];
}

/**
 * Splits a positive net profit; the division cents go to the shop (SPEC §8.1, T6, T7). A rule that
 * names its partners gives each one floor(net × weight / Σ weights) like the owner, in one split
 * (S17), so with one partner the result is the same as before.
 */
export function splitNetProfit(netCents: number, rule: ProfitSplitRule): ProfitShares {
  assertRule(rule);
  const named = rule.partnerWeights;
  if (named === undefined) {
    const [ownerCents = 0, partnerCents = 0, shopCents = 0] = splitByWeights(
      netCents,
      [rule.ownerWeight, rule.partnerWeight, rule.shopWeight],
      2,
    );
    return { ownerCents, partnerCents, shopCents };
  }
  const parts = splitByWeights(
    netCents,
    [rule.ownerWeight, ...named.map(({ weight }) => weight), rule.shopWeight],
    named.length + 1,
  );
  const partners = named.map(({ partnerId }, index) => ({
    partnerId,
    cents: parts[index + 1] ?? 0,
  }));
  return {
    ownerCents: parts[0] ?? 0,
    partnerCents: partners.reduce((sum, { cents }) => sum + cents, 0),
    shopCents: parts[named.length + 1] ?? 0,
    partners,
  };
}

/**
 * Each partner's weight under a rule, in participant order (the owner is not in the list). A rule
 * that does not name its partners belongs to a shop with one partner and gives that partner all
 * of `partnerWeight`; a partner the rule does not name has weight 0, and a rule that names someone
 * who is not a participant is refused, so no profit is dropped silently.
 */
export function partnerWeightsFor(
  rule: ProfitSplitRule,
  participants: readonly PartnerOwnership[],
): PartnerWeight[] {
  assertRule(rule);
  const partners = participants.filter(({ isOwner }) => !isOwner);
  if (rule.partnerWeights === undefined) {
    const [only, ...rest] = partners;
    if (!only || rest.length > 0) {
      throw new RangeError(
        `split rule of ${rule.effectiveFrom} does not name its partners, and the shop has ${String(partners.length)}`,
      );
    }
    return [{ partnerId: only.partnerId, weight: rule.partnerWeight }];
  }
  const known = new Set(partners.map(({ partnerId }) => partnerId));
  for (const { partnerId } of rule.partnerWeights) {
    if (!known.has(partnerId)) {
      throw new RangeError(
        `split rule of ${rule.effectiveFrom} names ${partnerId}, who is not a partner`,
      );
    }
  }
  const byId = new Map(rule.partnerWeights.map(({ partnerId, weight }) => [partnerId, weight]));
  return partners.map(({ partnerId }) => ({ partnerId, weight: byId.get(partnerId) ?? 0 }));
}
