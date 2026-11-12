import type { IntegrityReport } from '@fabric/contracts';

/** One line of the check, as `integrityReportOf` returns it. */
export type IntegrityLine = IntegrityReport['breakdown'][number];
export type IntegrityLineKey = IntegrityLine['key'];

/**
 * What the check says, for the screen to put first:
 * - balanced: the records agree, to the cent (the check's own exact `ok`, never a rounded one);
 * - difference: they do not, by this many cents (positive: more is held than the records explain);
 * - unable: it cannot be said, because this device has not received the shop's records yet, or
 *   the records it holds are incomplete (a sale without its cost, say) and the check cannot run.
 */
export type IntegrityStatus =
  | { kind: 'balanced' }
  | { kind: 'difference'; diffCents: number }
  | { kind: 'unable'; reason: 'notReceived' | 'incomplete' };

/**
 * @param report the check on this device's records, or null when it could not run
 * @param receivedAt when this device last finished pulling the shop's records, or null if never
 */
export function statusOf(
  report: IntegrityReport | null,
  receivedAt: string | null,
): IntegrityStatus {
  // A device that has never received the shop holds no records, which would add up to nothing
  // and look balanced: that is not a check, so it never says so.
  if (receivedAt === null) return { kind: 'unable', reason: 'notReceived' };
  if (report === null) return { kind: 'unable', reason: 'incomplete' };
  // Balanced only when both say so: the flag and the exact difference, in whole cents.
  if (report.ok && report.diffCents === 0) return { kind: 'balanced' };
  return { kind: 'difference', diffCents: report.diffCents };
}

/**
 * The lines as the screen lays them out: what the shop holds, and then what it belongs to (the
 * partners') and what it owes (to customers and suppliers).
 */
export const LINE_GROUPS = {
  holdings: ['cash', 'stock_at_cost', 'unrecovered_capital'],
  partners: ['capital', 'partner_balances', 'unsettled_net_profit'],
  owed: ['customer_credits', 'supplier_payables'],
} as const satisfies Record<string, readonly IntegrityLineKey[]>;

/** The lines of `report` named by `keys`, in that order; one the report lacks is left out. */
export function linesOf(
  report: IntegrityReport,
  keys: readonly IntegrityLineKey[],
): IntegrityLine[] {
  return keys.flatMap((key) => report.breakdown.filter((line) => line.key === key).slice(0, 1));
}

/** The lines whose negative amount has a meaning of its own that the screen explains. */
export const NEGATIVE_NOTE_KEYS = [
  'cash',
  'partner_balances',
  'unsettled_net_profit',
  'supplier_payables',
] as const satisfies readonly IntegrityLineKey[];
export type NegativeNoteKey = (typeof NEGATIVE_NOTE_KEYS)[number];

export function hasNegativeNote(key: IntegrityLineKey): key is NegativeNoteKey {
  return (NEGATIVE_NOTE_KEYS as readonly string[]).includes(key);
}
