import { CM_PER_METER } from '../length/index.js';
import { assertInteger, mulDivRoundHalfUp } from '../numeric/index.js';
import { GRAMS_PER_KG } from '../weight/index.js';

/** A roll created by a purchase (SPEC §2.2, §13 `roll`). */
export interface PurchasedRoll {
  variantId: string;
  lengthCmInitial: number;
  costTotalCents: number;
  /** Bought by weight: the length is an estimate until the roll is measured (SPEC §2.3). */
  lengthEstimated: boolean;
  /** Bought by weight only. */
  weightG?: number;
}

/** The three ways of buying fabric (SPEC §2.3). */
export type PurchaseInput =
  | {
      /** By the metre: one purchase, one roll per colour (an assortment / تلوينة). */
      method: 'meter';
      pricePerMeterCents: number;
      rolls: readonly { variantId: string; lengthCm: number }[];
    }
  | {
      /** A ready piece: one roll of the piece's length at the piece's price. */
      method: 'piece';
      variantId: string;
      lengthCm: number;
      totalCostCents: number;
    }
  | {
      /** By weight: the length is estimated from the fabric's est_cm_per_kg. */
      method: 'kg';
      variantId: string;
      weightG: number;
      totalCostCents: number;
      estCmPerKg: number;
    };

export interface PurchaseRolls {
  method: PurchaseInput['method'];
  /** purchase.total_cost_cents: the sum of the rolls' costs. */
  totalCostCents: number;
  rolls: PurchasedRoll[];
}

/**
 * Turns a purchase into rolls with their length and total cost (SPEC §2.3).
 * - meter: cost = price per metre × length, rounded half up to the cent when not exact
 *   (e.g. 16.05 dh/m × 2.75 m = 44.1375 dh → 4414 cents).
 * - piece: one roll, cost = the piece's price.
 * - kg: one roll, length = weight × est_cm_per_kg, rounded half up; lengthEstimated = true.
 */
export function buildRollsFromPurchase(input: PurchaseInput): PurchaseRolls {
  const rolls = buildRolls(input);
  const totalCostCents = rolls.reduce((sum, roll) => sum + roll.costTotalCents, 0);
  assertInteger(totalCostCents, 'purchase total cost');
  return { method: input.method, totalCostCents, rolls };
}

function buildRolls(input: PurchaseInput): PurchasedRoll[] {
  switch (input.method) {
    case 'meter': {
      assertInteger(input.pricePerMeterCents, 'pricePerMeterCents', 0);
      if (input.rolls.length === 0)
        throw new RangeError('a meter purchase needs at least one roll');
      return input.rolls.map((roll) => {
        assertInteger(roll.lengthCm, 'lengthCm', 1);
        return {
          variantId: roll.variantId,
          lengthCmInitial: roll.lengthCm,
          costTotalCents: mulDivRoundHalfUp(input.pricePerMeterCents, roll.lengthCm, CM_PER_METER),
          lengthEstimated: false,
        };
      });
    }
    case 'piece': {
      assertInteger(input.lengthCm, 'lengthCm', 1);
      assertInteger(input.totalCostCents, 'totalCostCents', 0);
      return [
        {
          variantId: input.variantId,
          lengthCmInitial: input.lengthCm,
          costTotalCents: input.totalCostCents,
          lengthEstimated: false,
        },
      ];
    }
    case 'kg': {
      assertInteger(input.weightG, 'weightG', 1);
      assertInteger(input.totalCostCents, 'totalCostCents', 0);
      assertInteger(input.estCmPerKg, 'estCmPerKg', 1);
      const lengthCm = mulDivRoundHalfUp(input.weightG, input.estCmPerKg, GRAMS_PER_KG);
      if (lengthCm < 1) throw new RangeError('estimated length rounds to 0 cm');
      return [
        {
          variantId: input.variantId,
          lengthCmInitial: lengthCm,
          costTotalCents: input.totalCostCents,
          lengthEstimated: true,
          weightG: input.weightG,
        },
      ];
    }
  }
}

/** cm per kg measured on a weighed roll: round(length × 1000 / weight). T4: 7600 cm, 20 kg → 380. */
export function measuredCmPerKg(lengthCm: number, weightG: number): number {
  assertInteger(lengthCm, 'lengthCm', 1);
  assertInteger(weightG, 'weightG', 1);
  return mulDivRoundHalfUp(lengthCm, GRAMS_PER_KG, weightG);
}

export type EstCmPerKgPolicy = 'last' | 'average';

/**
 * Default of the est_cm_per_kg update setting (C11): the running average smooths out one
 * badly measured or unusual roll; 'last' follows a supplier's change of batch faster.
 */
export const DEFAULT_EST_CM_PER_KG_POLICY: EstCmPerKgPolicy = 'average';

/**
 * The fabric's next est_cm_per_kg after measuring a roll (SPEC §2.3: "average or last
 * measurement", a setting). `measurementsSoFar` counts earlier measurements; the initial
 * guess is not one, so the first measurement always replaces it.
 * - last: the new measurement.
 * - average: running mean of all measurements, rounded half up.
 */
export function nextEstCmPerKg({
  policy,
  current,
  measurementsSoFar,
  measured,
}: {
  policy: EstCmPerKgPolicy;
  current: number;
  measurementsSoFar: number;
  measured: number;
}): number {
  assertInteger(current, 'current est_cm_per_kg', 1);
  assertInteger(measurementsSoFar, 'measurementsSoFar', 0);
  assertInteger(measured, 'measured cm per kg', 1);
  if (policy === 'last' || measurementsSoFar === 0) return measured;
  return mulDivRoundHalfUp(current * measurementsSoFar + measured, 1, measurementsSoFar + 1);
}

/** A batch's cost and length: one purchase's rolls of one fabric. */
export interface BatchCost {
  costTotalCents: number;
  lengthCm: number;
}

/** Σ cost × 100 / Σ length, half up: a batch's average cost per metre, for display. */
export function averageCostPerMeterCents(rolls: readonly BatchCost[]): number {
  const { cost, length } = batchTotals(rolls);
  return mulDivRoundHalfUp(cost, CM_PER_METER, length);
}

/**
 * SPEC §8.5: the new batch costs more per metre than the previous batch of the same fabric
 * ("تكلفة التجديد أعلى من رأس المال المسترد"). Compared exactly (cross-multiplied), not on the
 * rounded per-metre figures.
 */
export function isRenewalCostHigher(
  previous: readonly BatchCost[],
  next: readonly BatchCost[],
): boolean {
  const before = batchTotals(previous);
  const after = batchTotals(next);
  return BigInt(after.cost) * BigInt(before.length) > BigInt(before.cost) * BigInt(after.length);
}

function batchTotals(rolls: readonly BatchCost[]): { cost: number; length: number } {
  let cost = 0;
  let length = 0;
  for (const roll of rolls) {
    assertInteger(roll.costTotalCents, 'costTotalCents', 0);
    assertInteger(roll.lengthCm, 'lengthCm', 1);
    cost += roll.costTotalCents;
    length += roll.lengthCm;
  }
  if (length === 0) throw new RangeError('a batch needs at least one roll');
  return { cost, length };
}
