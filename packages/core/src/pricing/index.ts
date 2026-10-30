import { allocateLineCost, type LineCostAllocation, type RollCostState } from '../costing/index.js';
import { CM_PER_METER } from '../length/index.js';
import { assertInteger, mulDivRoundHalfUp } from '../numeric/index.js';

/** SPEC §3: under the minimum is a warning; under cost needs an explicit confirmation. */
export type PriceWarning = 'below_min_price' | 'below_cost';

/** How the line is priced: per metre (negotiated, the usual case) or a ready piece sold whole. */
export type LinePrice = { perMeterCents: number } | { wholePieceCents: number };

export interface SaleLineInput {
  roll: RollCostState;
  soldCm: number;
  price: LinePrice;
  /** Fabric (or variant) prices at the time of sale; stored with the line for negotiation analysis. */
  refPricePerMeterCents: number;
  /** 0 = no minimum. */
  minPricePerMeterCents: number;
  /** Costs of every earlier sale line and loss on this roll (see allocateLineCost). */
  previousCostsCents: readonly number[];
}

export interface SaleLine {
  soldCm: number;
  /** sale_line.actual_price_per_m_cents; for a whole piece, the equivalent per metre (rounded). */
  actualPricePerMeterCents: number;
  refPricePerMeterCents: number;
  lineTotalCents: number;
  lineCostCents: number;
  /** line total − line cost (SPEC §3, §7); negative when sold under cost. */
  profitCents: number;
  warnings: PriceWarning[];
  /** Sold under cost: the user must confirm explicitly and the API rejects it otherwise. */
  requiresConfirmation: boolean;
  /** Whether the line emptied or oversold the roll, and whether its profit is provisional. */
  costing: LineCostAllocation;
}

/**
 * Prices one sale line on one roll (SPEC §3, §4, T5, T11).
 * - per metre: line total = round(price per metre × sold cm / 100), half up.
 * - whole piece (`sellable_as_piece`): line total = the piece price; the line must take the
 *   whole, untouched piece (SPEC §2.3).
 * Line cost comes from allocateLineCost (SPEC §2.4).
 */
export function computeSaleLine(input: SaleLineInput): SaleLine {
  const { roll, soldCm, price, refPricePerMeterCents, minPricePerMeterCents } = input;
  assertInteger(soldCm, 'soldCm', 1);
  assertInteger(refPricePerMeterCents, 'refPricePerMeterCents', 0);
  assertInteger(minPricePerMeterCents, 'minPricePerMeterCents', 0);

  let lineTotalCents: number;
  let actualPricePerMeterCents: number;
  let belowMin: boolean;
  if ('perMeterCents' in price) {
    assertInteger(price.perMeterCents, 'perMeterCents', 0);
    actualPricePerMeterCents = price.perMeterCents;
    lineTotalCents = mulDivRoundHalfUp(price.perMeterCents, soldCm, CM_PER_METER);
    belowMin = price.perMeterCents < minPricePerMeterCents;
  } else {
    assertInteger(price.wholePieceCents, 'wholePieceCents', 0);
    // The piece price is for the untouched piece; once cut, the rest sells by the metre.
    if (soldCm !== roll.remainingCm || roll.remainingCm !== roll.basisLengthCm) {
      throw new RangeError('a whole-piece sale must take the whole, untouched piece');
    }
    lineTotalCents = price.wholePieceCents;
    actualPricePerMeterCents = mulDivRoundHalfUp(price.wholePieceCents, CM_PER_METER, soldCm);
    // Exact comparison of the piece price with the minimum for that length.
    belowMin =
      BigInt(price.wholePieceCents) * BigInt(CM_PER_METER) <
      BigInt(minPricePerMeterCents) * BigInt(soldCm);
  }

  const costing = allocateLineCost(roll, soldCm, input.previousCostsCents);
  const profitCents = lineTotalCents - costing.costCents;
  const warnings: PriceWarning[] = [];
  if (belowMin) warnings.push('below_min_price');
  if (profitCents < 0) warnings.push('below_cost');

  return {
    soldCm,
    actualPricePerMeterCents,
    refPricePerMeterCents,
    lineTotalCents,
    lineCostCents: costing.costCents,
    profitCents,
    warnings,
    requiresConfirmation: profitCents < 0,
    costing,
  };
}
