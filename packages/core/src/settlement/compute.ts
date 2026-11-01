import { assertInteger } from '../numeric/index.js';
import { ownerAndPartner, type PartnerOwnership, splitByOwnership } from './ownership.js';
import {
  assertIsoDate,
  type ProfitSplitRule,
  splitNetProfit,
  splitRuleForPeriod,
} from './split-rule.js';

export interface SettlementInput {
  /** YYYY-MM-DD, inclusive. */
  periodStart: string;
  /** YYYY-MM-DD, inclusive. */
  periodEnd: string;
  /** Σ profitRecognizedCents of the payments dated in the period (allocatePayment, SPEC §8.2). */
  recognizedProfitCents: number;
  /**
   * What returns changed in the period (RT4): the profit their invoices' payments recognise, less
   * the below-cost loss, after the goods came back. Signed: reversing profit lowers the result, a
   * kept-goods invoice that is now fully paid can raise it.
   */
  returnsEffectCents: number;
  /**
   * Capital recovered in the period by payments on written-off invoices (S5): written off as a
   * loss before, so a gain now.
   */
  recoveredBadDebtCents: number;
  /** SPEC §8.1 "الخسائر", each at cost. */
  losses: {
    /** Loss moves dated in the period: damage and wasted remnants (T12). */
    damageCents: number;
    /** Debts written off in the period. */
    badDebtCents: number;
    /** lossCents of the below-cost invoices dated in the period (splitSaleCapitalProfit, T11). */
    belowCostCents: number;
  };
  /** Expenses paid in the period: by their paid date (SPEC §5, S6). */
  expensesCents: number;
  /**
   * Σ cash_adjustment differences (counted − expected) dated in the period: an overage adds to
   * the period's result, a shortage takes from it ("cash over and short", I2). Signed.
   */
  cashOverShortCents: number;
  /** carry_deficit_out of the previous settlement; 0 for the first one. */
  carriedDeficitInCents: number;
  /** The whole profit_split_rule history; the one in effect on periodStart is used. */
  splitRules: readonly ProfitSplitRule[];
  partners: readonly PartnerOwnership[];
}

/** One line of the settlement's breakdown; the UI labels each key through i18n. */
export type SettlementLineKey =
  | 'recognized_profit'
  | 'returns_effect'
  | 'bad_debt_recovered'
  | 'loss_damage'
  | 'loss_bad_debt'
  | 'loss_below_cost'
  | 'expenses'
  | 'cash_over_short'
  | 'carried_deficit_in'
  | 'net_profit'
  | 'owner_share'
  | 'partner_share'
  | 'shop_share'
  | 'carry_deficit_out';

export interface SettlementLine {
  key: SettlementLineKey;
  /**
   * Up to `net_profit`: signed, what the line adds to the net profit (deductions are negative),
   * so those lines add up to it. After it: the amounts the net profit becomes.
   */
  cents: number;
}

/** The settlement row (SPEC §13) and the records it creates. */
export interface Settlement {
  periodStart: string;
  periodEnd: string;
  recognizedProfitCents: number;
  returnsEffectCents: number;
  recoveredBadDebtCents: number;
  /** damage + bad debts + below cost. */
  lossesCents: number;
  expensesCents: number;
  cashOverShortCents: number;
  carriedDeficitInCents: number;
  /** recognized + recovered − losses − expenses ± cash over/short − carried deficit; may be negative. */
  netProfitCents: number;
  ownerShareCents: number;
  partnerShareCents: number;
  shopShareCents: number;
  /** −net when net ≤ 0, else 0: next period's carriedDeficitInCents. */
  carryDeficitOutCents: number;
  /** The rule the shares were computed with (store its id with the settlement). */
  splitRule: ProfitSplitRule;
  /** Added to each partner's undrawn profit (partner balance); non-zero amounts only. */
  partnerShares: { partnerId: string; role: 'owner' | 'partner'; amountCents: number }[];
  /** capital_move rows to create: the shop share kept as capital, split by ownership (T10). */
  capitalMoves: { partnerId: string; type: 'retained_profit'; amountCents: number }[];
  breakdown: SettlementLine[];
}

/** The amounts that make up a period's net profit. */
export type PeriodResult = Pick<
  SettlementInput,
  | 'recognizedProfitCents'
  | 'returnsEffectCents'
  | 'recoveredBadDebtCents'
  | 'losses'
  | 'expensesCents'
  | 'cashOverShortCents'
  | 'carriedDeficitInCents'
>;

/**
 * SPEC §8.1: net = recognized profit ± returns + recovered bad debts − losses − paid expenses ± cash
 * over/short − carried deficit (may be negative). For the open period so far, this is the
 * integrity check's unsettled net profit (§9).
 */
export function periodNetProfit(result: PeriodResult): {
  lossesCents: number;
  netProfitCents: number;
} {
  const { losses } = result;
  assertInteger(result.recognizedProfitCents, 'recognizedProfitCents', 0);
  assertInteger(result.returnsEffectCents, 'returnsEffectCents');
  assertInteger(result.recoveredBadDebtCents, 'recoveredBadDebtCents', 0);
  assertInteger(losses.damageCents, 'damageCents', 0);
  assertInteger(losses.badDebtCents, 'badDebtCents', 0);
  assertInteger(losses.belowCostCents, 'belowCostCents', 0);
  assertInteger(result.expensesCents, 'expensesCents', 0);
  assertInteger(result.cashOverShortCents, 'cashOverShortCents');
  assertInteger(result.carriedDeficitInCents, 'carriedDeficitInCents', 0);
  const lossesCents = losses.damageCents + losses.badDebtCents + losses.belowCostCents;
  const netProfitCents =
    result.recognizedProfitCents +
    result.returnsEffectCents +
    result.recoveredBadDebtCents -
    lossesCents -
    result.expensesCents +
    result.cashOverShortCents -
    result.carriedDeficitInCents;
  assertInteger(netProfitCents, 'netProfitCents');
  return { lossesCents, netProfitCents };
}

/**
 * Settles one period (SPEC §8.1, T6, T7, T9, T10).
 * net = recognized profit + recovered bad debts − losses − paid expenses ± cash over/short −
 * carried deficit.
 * - net ≤ 0: nothing is distributed, the deficit carries to the next period, capital is untouched.
 * - net > 0: owner / partner / shop by the split rule, the division cents to the shop; the shop
 *   share becomes capital (retained_profit) split between the partners by ownership.
 * periodResultOf gathers the amounts from the records; locking the period is the API's job
 * (BUILD_PROMPTS 4.3).
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const { periodStart, periodEnd, losses } = input;
  assertIsoDate(periodStart, 'periodStart');
  assertIsoDate(periodEnd, 'periodEnd');
  if (periodEnd < periodStart) {
    throw new RangeError(`period ends (${periodEnd}) before it starts (${periodStart})`);
  }
  const { lossesCents, netProfitCents } = periodNetProfit(input);
  const [owner, partner] = ownerAndPartner(input.partners);
  const splitRule = splitRuleForPeriod(input.splitRules, periodStart);

  const shares =
    netProfitCents > 0
      ? splitNetProfit(netProfitCents, splitRule)
      : { ownerCents: 0, partnerCents: 0, shopCents: 0 };
  // Math.max keeps +0 when net is exactly 0.
  const carryDeficitOutCents = Math.max(0, -netProfitCents);

  const partnerShares = [
    { partnerId: owner.partnerId, role: 'owner' as const, amountCents: shares.ownerCents },
    { partnerId: partner.partnerId, role: 'partner' as const, amountCents: shares.partnerCents },
  ].filter(({ amountCents }) => amountCents > 0);
  const capitalMoves = splitByOwnership(shares.shopCents, input.partners)
    .filter(({ amountCents }) => amountCents > 0)
    .map(({ partnerId, amountCents }) => ({
      partnerId,
      type: 'retained_profit' as const,
      amountCents,
    }));

  // `0 - x` rather than `-x`: a zero deduction stays +0.
  const breakdown: SettlementLine[] = [
    { key: 'recognized_profit', cents: input.recognizedProfitCents },
    { key: 'returns_effect', cents: input.returnsEffectCents },
    { key: 'bad_debt_recovered', cents: input.recoveredBadDebtCents },
    { key: 'loss_damage', cents: 0 - losses.damageCents },
    { key: 'loss_bad_debt', cents: 0 - losses.badDebtCents },
    { key: 'loss_below_cost', cents: 0 - losses.belowCostCents },
    { key: 'expenses', cents: 0 - input.expensesCents },
    { key: 'cash_over_short', cents: input.cashOverShortCents },
    { key: 'carried_deficit_in', cents: 0 - input.carriedDeficitInCents },
    { key: 'net_profit', cents: netProfitCents },
    ...(netProfitCents > 0
      ? ([
          { key: 'owner_share', cents: shares.ownerCents },
          { key: 'partner_share', cents: shares.partnerCents },
          { key: 'shop_share', cents: shares.shopCents },
        ] as const)
      : ([{ key: 'carry_deficit_out', cents: carryDeficitOutCents }] as const)),
  ];

  return {
    periodStart,
    periodEnd,
    recognizedProfitCents: input.recognizedProfitCents,
    returnsEffectCents: input.returnsEffectCents,
    recoveredBadDebtCents: input.recoveredBadDebtCents,
    lossesCents,
    expensesCents: input.expensesCents,
    cashOverShortCents: input.cashOverShortCents,
    carriedDeficitInCents: input.carriedDeficitInCents,
    netProfitCents,
    ownerShareCents: shares.ownerCents,
    partnerShareCents: shares.partnerCents,
    shopShareCents: shares.shopCents,
    carryDeficitOutCents,
    splitRule,
    partnerShares,
    capitalMoves,
    breakdown,
  };
}
