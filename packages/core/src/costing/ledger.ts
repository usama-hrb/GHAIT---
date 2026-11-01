import { assertInteger } from '../numeric/index.js';
import { shareOfLineCents } from '../payments/returns.js';
import { allocateLineCost, costPerMeterCents } from './allocation.js';
import { costBasisLength, isConsumption, remainingLength, type StockMoveType } from './stock.js';

/** A move of the roll's history, oldest first (stock_move, or a sale line as a `sale`). */
export interface RollLedgerMove {
  /** stock_move or sale_line id. */
  id: string;
  type: StockMoveType;
  deltaCm: number;
  /** A sale or loss in a locked period keeps the cost recorded for it (SPEC §2.4, BUILD_PROMPTS 4.3). */
  lockedCostCents?: number;
  /** For a `reversal`: the id of the move it cancels. */
  reverses?: string | null;
  /** For a `return`: the id of the sale move it gives part of back (RT1). */
  returns?: string | null;
}

/** Moves a reversal may cancel: what was taken off or counted, never a purchase or a measurement. */
const REVERSIBLE = new Set<StockMoveType>(['sale', 'loss', 'adjustment']);

/** The ids of the cancelled moves; throws when a reversal does not mirror exactly one move. */
function reversedIds(moves: readonly RollLedgerMove[]): Set<string> {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const reversed = new Set<string>();
  for (const move of moves) {
    if (move.type !== 'reversal') continue;
    const target = move.reverses ? byId.get(move.reverses) : undefined;
    if (!target || !REVERSIBLE.has(target.type) || target.deltaCm !== -move.deltaCm) {
      throw new RangeError(`reversal ${move.id} does not mirror a sale, loss or adjustment`);
    }
    if (reversed.has(target.id)) throw new RangeError(`move ${target.id} is reversed twice`);
    reversed.add(target.id);
  }
  return reversed;
}

export interface RollLedger {
  /** The length the cost is spread over: initial + corrections (the latest measurement). */
  basisLengthCm: number;
  /** initial + Σ moves (SPEC §13); negative when two offline devices sold the same length. */
  remainingCm: number;
  /** Bought by weight and not measured yet: profits on it are provisional (SPEC §2.3). */
  lengthEstimated: boolean;
  /** Display only. */
  costPerMeterCents: number;
  /** The roll's stock value at cost (SPEC §9). */
  unallocatedCostCents: number;
  /** cm taken beyond what the roll had. */
  oversoldCm: number;
  /**
   * Each sale and loss with the cost it still carries, in history order: a sale's cost less the
   * cost of what customers gave back (RT1).
   */
  costs: { id: string; costCents: number }[];
  /** Each return with the cost it put back on the roll: a share of its sale's cost (RT1). */
  returns: { id: string; saleMoveId: string; costCents: number }[];
}

/**
 * A roll's state from its history (SPEC §2.4): every sale and loss costed in order, as if the
 * latest measured length had always been known (the line that empties the roll takes the exact
 * remainder; locked lines keep their cost). Stocktake adjustments move the remaining length
 * only. A reversed move and its reversal are left out, as if neither had been made. Costs are
 * derived, so a measurement or a void never needs to edit an append-only move.
 */
export function rollLedger(
  roll: { costTotalCents: number; lengthCmInitial: number; lengthEstimated: boolean },
  moves: readonly RollLedgerMove[],
): RollLedger {
  assertInteger(roll.costTotalCents, 'costTotalCents', 0);
  const basisLengthCm = costBasisLength(roll.lengthCmInitial, moves);
  const reversed = reversedIds(moves);
  let remainingCm = basisLengthCm;
  let oversoldCm = 0;
  const costs: { id: string; costCents: number }[] = [];
  const allocated: number[] = [];
  const returns: RollLedger['returns'] = [];
  /** A sale move as costed: what a return of it gives back is a share of this gross cost. */
  const sold = new Map<
    string,
    { index: number; takenCm: number; grossCents: number; returnedCm: number }
  >();

  for (const move of moves) {
    if (
      move.type === 'purchase' ||
      move.type === 'length_correction' ||
      move.type === 'reversal' ||
      reversed.has(move.id)
    ) {
      continue;
    }
    if (move.type === 'return') {
      // The cost of what comes back is the same share of the sale's cost as its length (RT1):
      // cumulative, so many returns add up to the sale exactly. A return of no known sale only
      // puts the length back.
      const target = move.returns ? sold.get(move.returns) : undefined;
      if (target && move.returns && target.returnedCm + move.deltaCm <= target.takenCm) {
        const returnedCm = target.returnedCm + move.deltaCm;
        const back =
          shareOfLineCents(target.grossCents, target.takenCm, returnedCm) -
          shareOfLineCents(target.grossCents, target.takenCm, target.returnedCm);
        target.returnedCm = returnedCm;
        const entry = costs[target.index];
        if (entry) entry.costCents -= back;
        allocated[target.index] = (allocated[target.index] ?? 0) - back;
        returns.push({ id: move.id, saleMoveId: move.returns, costCents: back });
      }
      remainingCm += move.deltaCm;
      continue;
    }
    if (isConsumption(move.type)) {
      const takenCm = -move.deltaCm;
      let costCents: number;
      if (move.lockedCostCents === undefined) {
        const allocation = allocateLineCost(
          { costTotalCents: roll.costTotalCents, basisLengthCm, remainingCm },
          takenCm,
          allocated,
        );
        costCents = allocation.costCents;
        oversoldCm += allocation.oversoldCm;
      } else {
        assertInteger(move.lockedCostCents, `locked cost of ${move.id}`, 0);
        costCents = move.lockedCostCents;
      }
      allocated.push(costCents);
      costs.push({ id: move.id, costCents });
      if (move.type === 'sale') {
        sold.set(move.id, {
          index: costs.length - 1,
          takenCm,
          grossCents: costCents,
          returnedCm: 0,
        });
      }
    }
    remainingCm += move.deltaCm;
  }

  const unallocatedCostCents = roll.costTotalCents - allocated.reduce((sum, cost) => sum + cost, 0);
  if (unallocatedCostCents < 0) {
    throw new RangeError('locked costs exceed the roll cost');
  }
  return {
    basisLengthCm,
    remainingCm: remainingLength(roll.lengthCmInitial, moves),
    lengthEstimated:
      roll.lengthEstimated && !moves.some((move) => move.type === 'length_correction'),
    costPerMeterCents: costPerMeterCents(roll.costTotalCents, basisLengthCm),
    unallocatedCostCents,
    oversoldCm,
    costs,
    returns,
  };
}

/**
 * The roll's real total length from a measurement of what is on it now: what is left plus what
 * the books say was taken off (SPEC §2.3: "إن قيس بعد بيع جزء منه، يُجمع المباع مع المتبقي").
 */
export function measuredTotalLength(
  ledger: Pick<RollLedger, 'basisLengthCm' | 'remainingCm'>,
  measuredRemainingCm: number,
): number {
  assertInteger(measuredRemainingCm, 'measuredRemainingCm', 0);
  const total = ledger.basisLengthCm - ledger.remainingCm + measuredRemainingCm;
  if (total < 1) throw new RangeError('a roll must be at least 1 cm long');
  return total;
}

export type RollState = 'active' | 'remnant' | 'empty';

/**
 * Nothing left → empty; under the remnant threshold (setting, SPEC §4) or marked by hand →
 * remnant; otherwise active.
 */
export function rollState(
  remainingCm: number,
  markedRemnant: boolean,
  remnantThresholdCm: number,
): RollState {
  assertInteger(remainingCm, 'remainingCm');
  assertInteger(remnantThresholdCm, 'remnantThresholdCm', 0);
  if (remainingCm <= 0) return 'empty';
  return markedRemnant || remainingCm < remnantThresholdCm ? 'remnant' : 'active';
}
