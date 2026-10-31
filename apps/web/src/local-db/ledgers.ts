import { type SequencedMove, withLockedCosts } from '@fabric/contracts';
import type { ShopDatabase } from './db';

/**
 * Moves with the costs settlements froze for them (P9), so a roll is costed as the server costs
 * it. In a transaction, include db.lockedCosts.
 */
export async function withFrozenCosts<M extends SequencedMove>(
  db: ShopDatabase,
  moves: readonly M[],
): Promise<M[]> {
  if (moves.length === 0) return [...moves];
  const locked = await db.lockedCosts
    .where('stockMoveId')
    .anyOf(moves.map((move) => move.id))
    .toArray();
  return withLockedCosts(moves, locked);
}
