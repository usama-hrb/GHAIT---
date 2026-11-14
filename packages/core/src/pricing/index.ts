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

/** What a product is sold by on a sale line: meters (quantity in cm) or pieces. */
export type SaleUnit = 'meter' | 'piece';

/** A line priced per unit (negotiated, the usual case), or a ready piece sold whole at its price. */
export type BatchLinePrice = { perUnitCents: number } | { wholePieceCents: number };

export interface BatchSaleLineInput {
  unit: SaleUnit;
  /** cm for a meter line, pieces for a piece line. */
  quantity: number;
  price: BatchLinePrice;
  /** The product's normal price per unit at the time of sale; kept for negotiation analysis. */
  refPriceCents: number;
  /** The lowest price per unit the product may be sold at; 0 = no minimum. */
  minPriceCents: number;
  /** What the batch's ledger says this consumption costs (SPEC §2.4). */
  costCents: number;
}

export interface BatchSaleLine {
  unit: SaleUnit;
  quantity: number;
  /** sale_line.actual_price_cents; for a whole piece, the equivalent per metre (rounded). */
  actualPriceCents: number;
  refPriceCents: number;
  lineTotalCents: number;
  lineCostCents: number;
  /** line total − line cost (SPEC §3, §7); negative when sold under cost. */
  profitCents: number;
  /** Sold under the product's minimum price: a cashier may never; the owner may, confirming. */
  belowMin: boolean;
  warnings: PriceWarning[];
  /** Sold under cost: the user must confirm explicitly and the API rejects it otherwise. */
  requiresConfirmation: boolean;
}

/**
 * The price per unit that gives a line the total the customer was quoted ("3 m for 145.20 dh"
 * when the price per metre is not known): total ÷ quantity, rounded half up to the cent. A line is
 * always priced per unit (`computeBatchSaleLine`), and a price is a whole number of cents, so a
 * total that does not divide evenly comes back a few cents off once the line is priced: by at most
 * `round(cm ÷ 200)` cents for a length, and by at most half the count for pieces. A length of
 * under a metre is never off, and neither is a total that divides evenly.
 * `quantity` is cm for a meter line, pieces for a piece line.
 */
export function unitPriceForLineTotal(input: {
  unit: SaleUnit;
  quantity: number;
  totalCents: number;
}): number {
  const { unit, quantity, totalCents } = input;
  assertInteger(quantity, 'quantity', 1);
  assertInteger(totalCents, 'totalCents', 0);
  return unit === 'meter'
    ? mulDivRoundHalfUp(totalCents, CM_PER_METER, quantity)
    : mulDivRoundHalfUp(totalCents, 1, quantity);
}

/**
 * Whether a price is under the product's minimum (SPEC §3), judged exactly: per unit against the
 * minimum per unit; a whole piece (sold in meters) against the minimum for its length. 0 = no
 * minimum. A cashier may never sell below it; the owner may after an explicit confirmation.
 */
export function isBelowMinimum(input: {
  quantity: number;
  price: BatchLinePrice;
  minPriceCents: number;
}): boolean {
  const { quantity, price, minPriceCents } = input;
  assertInteger(quantity, 'quantity', 1);
  assertInteger(minPriceCents, 'minPriceCents', 0);
  if ('perUnitCents' in price) {
    assertInteger(price.perUnitCents, 'perUnitCents', 0);
    return price.perUnitCents < minPriceCents;
  }
  assertInteger(price.wholePieceCents, 'wholePieceCents', 0);
  return (
    BigInt(price.wholePieceCents) * BigInt(CM_PER_METER) < BigInt(minPriceCents) * BigInt(quantity)
  );
}

/**
 * Prices one sale line of a batch (SPEC §3, §4, T5, T11), the cost coming from the product ledger:
 * - per meter: round(price × cm ÷ 100) half up; per piece: price × pieces;
 * - whole piece (a ready piece sold whole, in meters): the piece price as the line total.
 * Under the minimum is judged exactly (a whole piece against the minimum for its length).
 */
export function computeBatchSaleLine(input: BatchSaleLineInput): BatchSaleLine {
  const { unit, quantity, price, refPriceCents, minPriceCents, costCents } = input;
  assertInteger(quantity, 'quantity', 1);
  assertInteger(refPriceCents, 'refPriceCents', 0);
  assertInteger(minPriceCents, 'minPriceCents', 0);
  assertInteger(costCents, 'costCents', 0);

  let lineTotalCents: number;
  let actualPriceCents: number;
  let belowMin: boolean;
  if ('perUnitCents' in price) {
    assertInteger(price.perUnitCents, 'perUnitCents', 0);
    actualPriceCents = price.perUnitCents;
    lineTotalCents =
      unit === 'meter'
        ? mulDivRoundHalfUp(price.perUnitCents, quantity, CM_PER_METER)
        : price.perUnitCents * quantity;
    belowMin = isBelowMinimum({ quantity, price, minPriceCents });
  } else {
    if (unit !== 'meter') throw new RangeError('only a length is sold as a whole piece');
    assertInteger(price.wholePieceCents, 'wholePieceCents', 0);
    lineTotalCents = price.wholePieceCents;
    actualPriceCents = mulDivRoundHalfUp(price.wholePieceCents, CM_PER_METER, quantity);
    belowMin = isBelowMinimum({ quantity, price, minPriceCents });
  }

  const profitCents = lineTotalCents - costCents;
  const warnings: PriceWarning[] = [];
  if (belowMin) warnings.push('below_min_price');
  if (profitCents < 0) warnings.push('below_cost');
  return {
    unit,
    quantity,
    actualPriceCents,
    refPriceCents,
    lineTotalCents,
    lineCostCents: costCents,
    profitCents,
    belowMin,
    warnings,
    requiresConfirmation: profitCents < 0,
  };
}
