import { assertInteger, splitByWeights } from '../numeric/index.js';

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Throws unless `value` is a YYYY-MM-DD date. Dates are compared as text, so the format must be exact. */
export function assertIsoDate(value: string, name: string): void {
  if (!ISO_DATE.test(value)) {
    throw new RangeError(`${name} must be a YYYY-MM-DD date, got "${value}"`);
  }
}

/** The three shares of a period's net profit (SPEC §8.1) as of a date (profit_split_rule). */
export interface ProfitSplitRule {
  /** YYYY-MM-DD. Applies to every period that starts on or after this date (SPEC §8.3). */
  effectiveFrom: string;
  /**
   * Relative weights, not percentages: owner and partner get floor(net × weight / Σ weights)
   * and the shop gets the rest. 1/1/1 is exact thirds; basis points also work (4000/4000/2000).
   */
  ownerWeight: number;
  partnerWeight: number;
  shopWeight: number;
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
  partnerCents: number;
  shopCents: number;
}

/** Splits a positive net profit; the division cents go to the shop (SPEC §8.1, T6, T7). */
export function splitNetProfit(netCents: number, rule: ProfitSplitRule): ProfitShares {
  assertRule(rule);
  const [ownerCents = 0, partnerCents = 0, shopCents = 0] = splitByWeights(
    netCents,
    [rule.ownerWeight, rule.partnerWeight, rule.shopWeight],
    2,
  );
  return { ownerCents, partnerCents, shopCents };
}
