import { CM_PER_METER } from '../length/index.js';
import { assertInteger, mulDivRoundHalfUp } from '../numeric/index.js';

/** What costing needs to know about a roll at the moment something is taken off it. */
export interface RollCostState {
  costTotalCents: number;
  /** Length the cost is spread over: length_cm_initial + corrections (costBasisLength). */
  basisLengthCm: number;
  /** Length left before this consumption (remainingLength). */
  remainingCm: number;
  /** Length not yet measured (kg purchase): profit is provisional (SPEC §2.3). */
  lengthEstimated?: boolean;
}

export interface LineCostAllocation {
  costCents: number;
  /** Takes the roll to 0 (or below): this line got the exact remainder of the cost. */
  exhaustsRoll: boolean;
  /**
   * cm taken beyond what the roll had: two offline devices sold the same length, or an
   * estimated length was short. That part costs 0 until a length correction re-costs it.
   */
  oversoldCm: number;
  /** Profit on this line is provisional: the roll's length is still an estimate. */
  provisional: boolean;
}

function sumCosts(costs: readonly number[], costTotalCents: number): number {
  let total = 0;
  for (const cost of costs) {
    assertInteger(cost, 'previous cost', 0);
    total += cost;
  }
  if (total > costTotalCents) {
    throw new RangeError(
      `previous costs (${String(total)}) exceed the roll's cost (${String(costTotalCents)})`,
    );
  }
  return total;
}

/**
 * Cost of taking `soldCm` off a roll, for a sale line or a loss (SPEC §2.4, T2, T3, T12):
 *   cost = round(cost_total × sold_cm / basis_length), half up;
 *   the line that empties the roll takes cost_total − Σ previous costs, so totals never drift.
 *
 * `previousCostsCents` are the costs of every earlier sale line AND loss on this roll: losses
 * consume cost like sales, so they must count towards the remainder.
 * A line never takes more than the cost still unallocated, so no line ever costs < 0 and the
 * roll never allocates more than its cost (rounding up on many small lines could otherwise
 * push the last line negative).
 */
export function allocateLineCost(
  roll: RollCostState,
  soldCm: number,
  previousCostsCents: readonly number[],
): LineCostAllocation {
  assertInteger(roll.costTotalCents, 'costTotalCents', 0);
  assertInteger(roll.basisLengthCm, 'basisLengthCm', 1);
  assertInteger(roll.remainingCm, 'remainingCm');
  assertInteger(soldCm, 'soldCm', 1);
  const unallocated = roll.costTotalCents - sumCosts(previousCostsCents, roll.costTotalCents);
  const provisional = roll.lengthEstimated === true;

  if (soldCm >= roll.remainingCm) {
    return {
      costCents: unallocated,
      exhaustsRoll: true,
      oversoldCm: soldCm - Math.max(roll.remainingCm, 0),
      provisional,
    };
  }
  const proportional = mulDivRoundHalfUp(roll.costTotalCents, soldCm, roll.basisLengthCm);
  return {
    costCents: Math.min(proportional, unallocated),
    exhaustsRoll: false,
    oversoldCm: 0,
    provisional,
  };
}

/**
 * Costs a whole sequence of consumptions (sale lines and losses, in order) on a roll that
 * starts with its full basis length. Used to re-cost a roll and in tests.
 */
export function allocateRollCosts(
  roll: Omit<RollCostState, 'remainingCm'>,
  consumptionsCm: readonly number[],
): LineCostAllocation[] {
  let remainingCm = roll.basisLengthCm;
  const costs: number[] = [];
  return consumptionsCm.map((soldCm) => {
    const allocation = allocateLineCost({ ...roll, remainingCm }, soldCm, costs);
    costs.push(allocation.costCents);
    remainingCm -= soldCm;
    return allocation;
  });
}

/** Cost per metre, for display and alerts only (never for line costs): T2 → 4348 (≈ 43.48 dh). */
export function costPerMeterCents(costTotalCents: number, basisLengthCm: number): number {
  assertInteger(costTotalCents, 'costTotalCents', 0);
  assertInteger(basisLengthCm, 'basisLengthCm', 1);
  return mulDivRoundHalfUp(costTotalCents, CM_PER_METER, basisLengthCm);
}

/** Cost still carried by what is left on the roll: its stock value at cost, exact to the cent. */
export function unallocatedCostCents(
  costTotalCents: number,
  previousCostsCents: readonly number[],
): number {
  assertInteger(costTotalCents, 'costTotalCents', 0);
  return costTotalCents - sumCosts(previousCostsCents, costTotalCents);
}
