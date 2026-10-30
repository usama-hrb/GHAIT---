import { assertInteger } from '../numeric/index.js';
import { allocateLineCost, costPerMeterCents } from './allocation.js';

/** A recorded move of the roll, oldest first. Sale lines and losses carry the cost recorded for them. */
export type RollHistoryMove =
  | {
      type: 'sale' | 'loss';
      /** sale_line id or loss move id. */
      id: string;
      deltaCm: number;
      costCents: number;
      /** Its period is settled and locked: its cost can no longer change (SPEC §2.4, §8.3). */
      locked: boolean;
    }
  | { type: 'length_correction' | 'adjustment' | 'return'; deltaCm: number };

export interface CostChange {
  id: string;
  oldCostCents: number;
  newCostCents: number;
}

export interface LengthCorrection {
  /** Record as a `length_correction` stock_move. T4: 7600 measured on an 8000 estimate → −400. */
  correctionDeltaCm: number;
  /** The measured length: the cost is now spread over it. */
  basisLengthCm: number;
  remainingCm: number;
  /** Display only: T4 → 526 (5.26 dh/m, was 5.00). */
  costPerMeterCents: number;
  /** Measured: profits on this roll stop being provisional. */
  lengthEstimated: false;
  /** Unlocked sale lines and losses whose cost changes; persist the new costs. */
  recompute: CostChange[];
  /** Lines in locked periods, kept at their recorded cost. */
  lockedIds: string[];
  /** cm already taken beyond the measured length (sold before measuring an over-estimate). */
  oversoldCm: number;
  /** Cost carried by what is left on the roll after the re-costing. */
  unallocatedCostCents: number;
}

/**
 * Records a measurement of a roll's real length (SPEC §2.3, §2.4, T4).
 *
 * `newLengthCm` is the roll's real total length (if it was measured after some sales, add
 * what was taken to what is left). The cost is then spread over that length as if it had
 * always been known: earlier corrections are superseded, and every sale line and loss is
 * re-costed in order (the one that empties the roll still takes the exact remainder).
 * Lines in locked periods keep their recorded cost and still count towards the remainder.
 */
export function applyLengthCorrection(
  roll: { costTotalCents: number; lengthCmInitial: number },
  history: readonly RollHistoryMove[],
  newLengthCm: number,
): LengthCorrection {
  assertInteger(roll.costTotalCents, 'costTotalCents', 0);
  assertInteger(roll.lengthCmInitial, 'lengthCmInitial', 1);
  assertInteger(newLengthCm, 'newLengthCm', 1);

  let previousBasis = roll.lengthCmInitial;
  for (const move of history) {
    if (move.type === 'length_correction') previousBasis += move.deltaCm;
  }

  let remainingCm = newLengthCm;
  const costs: number[] = [];
  const recompute: CostChange[] = [];
  const lockedIds: string[] = [];

  for (const move of history) {
    assertInteger(move.deltaCm, `${move.type} deltaCm`);
    if (move.type !== 'sale' && move.type !== 'loss') {
      // Earlier corrections are superseded by this measurement; stocktakes and returns stay.
      if (move.type !== 'length_correction') remainingCm += move.deltaCm;
      continue;
    }
    if (move.deltaCm >= 0) throw new RangeError(`${move.type} must have a negative deltaCm`);
    assertInteger(move.costCents, `${move.type} ${move.id} costCents`, 0);
    const soldCm = -move.deltaCm;

    if (move.locked) {
      costs.push(move.costCents);
      lockedIds.push(move.id);
    } else {
      const { costCents } = allocateLineCost(
        { costTotalCents: roll.costTotalCents, basisLengthCm: newLengthCm, remainingCm },
        soldCm,
        costs,
      );
      costs.push(costCents);
      if (costCents !== move.costCents) {
        recompute.push({ id: move.id, oldCostCents: move.costCents, newCostCents: costCents });
      }
    }
    remainingCm -= soldCm;
  }

  const allocated = costs.reduce((sum, cost) => sum + cost, 0);
  if (allocated > roll.costTotalCents) {
    throw new RangeError('locked costs exceed the roll cost: a locked line follows unlocked ones');
  }

  return {
    correctionDeltaCm: newLengthCm - previousBasis,
    basisLengthCm: newLengthCm,
    remainingCm,
    costPerMeterCents: costPerMeterCents(roll.costTotalCents, newLengthCm),
    lengthEstimated: false,
    recompute,
    lockedIds,
    oversoldCm: Math.max(0, -remainingCm),
    unallocatedCostCents: roll.costTotalCents - allocated,
  };
}
