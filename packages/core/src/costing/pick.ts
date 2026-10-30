import { assertInteger } from '../numeric/index.js';

/** A roll of the colour being sold, as the proposal sees it. */
export interface RollOnHand {
  id: string;
  /** What is left on it (rollLedger remainingCm). */
  remainingCm: number;
  /** Its purchase's date (YYYY-MM-DD): the oldest purchase is sold first. */
  purchaseDate: string;
  /** Ties on the date: the roll's creation time (ISO 8601), then its code. */
  createdAt: string;
  shortCode: string;
}

export interface RollTake {
  rollId: string;
  cm: number;
}

export interface RollProposal {
  /** One line per roll, oldest first. */
  takes: RollTake[];
  /** What the rolls cannot cover (0 when they hold enough). */
  shortCm: number;
}

function oldestFirst(a: RollOnHand, b: RollOnHand): number {
  return (
    a.purchaseDate.localeCompare(b.purchaseDate) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.shortCode.localeCompare(b.shortCode)
  );
}

/** The rolls in the order a sale takes them: oldest purchase first (SPEC §4). */
export function rollsOldestFirst<R extends RollOnHand>(rolls: readonly R[]): R[] {
  return [...rolls].sort(oldestFirst);
}

/**
 * Which rolls a sale of `wantedCm` of one colour takes (SPEC §4, docs/accounting-assumptions.md
 * P11): the oldest roll that holds enough on its own; when none does, the rolls oldest first,
 * each taken to its end, until the length is covered. Rolls with nothing left are skipped.
 */
export function proposeRolls(rolls: readonly RollOnHand[], wantedCm: number): RollProposal {
  assertInteger(wantedCm, 'wantedCm', 1);
  const onHand = rolls
    .filter((roll) => {
      assertInteger(roll.remainingCm, `remainingCm of ${roll.id}`);
      return roll.remainingCm > 0;
    })
    .sort(oldestFirst);

  const single = onHand.find((roll) => roll.remainingCm >= wantedCm);
  if (single) return { takes: [{ rollId: single.id, cm: wantedCm }], shortCm: 0 };

  const takes: RollTake[] = [];
  let left = wantedCm;
  for (const roll of onHand) {
    if (left === 0) break;
    const cm = Math.min(roll.remainingCm, left);
    takes.push({ rollId: roll.id, cm });
    left -= cm;
  }
  return { takes, shortCm: left };
}
