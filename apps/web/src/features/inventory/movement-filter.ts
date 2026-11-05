import { shopDate } from '@fabric/contracts';
import type { ProductMovementView } from '@/local-db';

export type MovementType = ProductMovementView['type'];

/**
 * What the movement history is narrowed to. Empty `types` and a null `batchId` mean "all", and an
 * empty date means "no limit"; dates are shop days (YYYY-MM-DD), both ends included.
 */
export interface MovementFilter {
  types: readonly MovementType[];
  batchId: string | null;
  from: string;
  to: string;
}

export const NO_FILTER: MovementFilter = { types: [], batchId: null, from: '', to: '' };

export function isFiltering(filter: MovementFilter): boolean {
  return (
    filter.types.length > 0 || filter.batchId !== null || filter.from !== '' || filter.to !== ''
  );
}

/** The shop day the history shows for a movement (the same day the date column reads). */
export function dayOfMovement(move: Pick<ProductMovementView, 'createdAt'>): string {
  const at = new Date(move.createdAt);
  // A timestamp that cannot be read has no day: only a history without a date limit shows it.
  return Number.isNaN(at.getTime()) ? '' : shopDate(at);
}

/** The movements that pass every part of the filter, in the order they came. */
export function filterMovements(
  movements: readonly ProductMovementView[],
  filter: MovementFilter,
): ProductMovementView[] {
  if (!isFiltering(filter)) return [...movements];
  const dated = filter.from !== '' || filter.to !== '';
  return movements.filter((move) => {
    if (filter.types.length > 0 && !filter.types.includes(move.type)) return false;
    if (filter.batchId !== null && move.batchId !== filter.batchId) return false;
    if (dated) {
      const day = dayOfMovement(move);
      if (day === '') return false;
      if (filter.from !== '' && day < filter.from) return false;
      if (filter.to !== '' && day > filter.to) return false;
    }
    return true;
  });
}

/**
 * How many movements each type would show, given the rest of the filter (the batch and the dates,
 * not the types chosen): the number on a type's chip is what picking it adds.
 */
export function countByType(
  movements: readonly ProductMovementView[],
  filter: MovementFilter,
): Map<MovementType, number> {
  const counts = new Map<MovementType, number>();
  for (const move of filterMovements(movements, { ...filter, types: [] })) {
    counts.set(move.type, (counts.get(move.type) ?? 0) + 1);
  }
  return counts;
}

/** The order the types are offered in; a type missing here is a compile error. */
const TYPE_ORDER: Record<MovementType, number> = {
  purchase: 0,
  sale: 1,
  return: 2,
  reversal: 3,
  loss: 4,
  adjustment: 5,
  length_correction: 6,
  measurement: 7,
};

/** The types the history has at least one movement of, in the order they are offered. */
export function typesOfMovements(movements: readonly ProductMovementView[]): MovementType[] {
  return [...new Set(movements.map((move) => move.type))].sort(
    (a, b) => TYPE_ORDER[a] - TYPE_ORDER[b],
  );
}

/**
 * The batches the history has movements on, one entry each, the one bought first first. `movements`
 * come newest first (as the product page has them), so the oldest movement of a batch (its
 * purchase) is the last one met.
 */
export function batchesOfMovements(
  movements: readonly ProductMovementView[],
): { batchId: string; code: string }[] {
  const seen = new Map<string, string>();
  for (const move of [...movements].reverse()) {
    if (!seen.has(move.batchId)) seen.set(move.batchId, move.code);
  }
  return [...seen].map(([batchId, code]) => ({ batchId, code }));
}
