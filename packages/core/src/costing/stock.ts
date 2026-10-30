import { assertInteger } from '../numeric/index.js';

/**
 * stock_move.type (SPEC §13). A `reversal` cancels one earlier move (a voided sale's lines): it
 * gives back that move's length, and costing treats both as if neither had been made.
 */
export type StockMoveType =
  'purchase' | 'sale' | 'loss' | 'length_correction' | 'adjustment' | 'return' | 'reversal';

/** A stock_move as costing sees it: a signed length (sales and losses are negative). */
export interface StockMove {
  type: StockMoveType;
  deltaCm: number;
}

/** Sales and losses take length off a roll; they are the moves that carry a cost. */
export function isConsumption(type: StockMoveType): type is 'sale' | 'loss' {
  return type === 'sale' || type === 'loss';
}

function assertMove(move: StockMove): void {
  assertInteger(move.deltaCm, `${move.type} deltaCm`);
  if (isConsumption(move.type) && move.deltaCm >= 0) {
    throw new RangeError(`${move.type} must have a negative deltaCm, got ${String(move.deltaCm)}`);
  }
  if (move.type === 'return' && move.deltaCm <= 0) {
    throw new RangeError(`return must have a positive deltaCm, got ${String(move.deltaCm)}`);
  }
  if (move.type === 'reversal' && move.deltaCm === 0) {
    throw new RangeError('a reversal must give back some length');
  }
}

/**
 * Length left on a roll: length_cm_initial + Σ delta_cm (SPEC §13).
 * The purchase move records the initial length itself, so it is not counted a second time.
 * May be negative when two offline devices sold the same length (flag it, never block: §12.1).
 */
export function remainingLength(lengthCmInitial: number, moves: readonly StockMove[]): number {
  assertInteger(lengthCmInitial, 'lengthCmInitial', 1);
  let remaining = lengthCmInitial;
  for (const move of moves) {
    assertMove(move);
    if (move.type !== 'purchase') remaining += move.deltaCm;
  }
  return remaining;
}

/**
 * Length the roll's cost is spread over: the initial length plus length corrections
 * (measurements, SPEC §2.3). Sales, losses and stocktake adjustments do not change it.
 */
export function costBasisLength(lengthCmInitial: number, moves: readonly StockMove[]): number {
  assertInteger(lengthCmInitial, 'lengthCmInitial', 1);
  let basis = lengthCmInitial;
  for (const move of moves) {
    assertMove(move);
    if (move.type === 'length_correction') basis += move.deltaCm;
  }
  if (basis < 1) throw new RangeError(`corrected length must be >= 1 cm, got ${String(basis)}`);
  return basis;
}
