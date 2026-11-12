/**
 * Zakat payments (SPEC §10, Z7, ADR 0028). A payment is not a record of its own: it is a draw per
 * partner by ownership, linked to the report, so what these helpers do is read a report's due and
 * paid amounts, give a payment an identity that survives a retry, and keep a person's note with
 * the draws it belongs to. None of them moves money or decides an amount.
 */

export type ZakatPaymentState =
  /** The report found nothing due (below the nisab): there is nothing to pay. */
  | 'none_due'
  | 'unpaid'
  | 'partial'
  | 'paid'
  /** More was paid than is due (two devices paid offline, each below the limit). */
  | 'overpaid'
  | 'voided';

export interface ZakatPaymentSummary {
  state: ZakatPaymentState;
  dueCents: number;
  paidCents: number;
  /** What is left to pay; never negative, and nothing on a voided report. */
  remainingCents: number;
  /** What was paid beyond what is due; never negative. */
  excessCents: number;
  /** Paid as a share of due, in whole percent from 0 to 100 (for a progress bar). */
  percent: number;
}

/** Where a report stands on payment: due, paid, what is left, and whether more was paid than due. */
export function zakatPaymentStateOf(input: {
  dueCents: number;
  paidCents: number;
  voided: boolean;
}): ZakatPaymentSummary {
  const { dueCents, paidCents } = input;
  const remainingCents = input.voided ? 0 : Math.max(0, dueCents - paidCents);
  const excessCents = Math.max(0, paidCents - dueCents);
  const percent = dueCents > 0 ? Math.min(100, Math.floor((paidCents * 100) / dueCents)) : 0;
  const state: ZakatPaymentState = input.voided
    ? 'voided'
    : dueCents <= 0
      ? 'none_due'
      : paidCents <= 0
        ? 'unpaid'
        : paidCents < dueCents
          ? 'partial'
          : paidCents === dueCents
            ? 'paid'
            : 'overpaid';
  return { state, dueCents, paidCents, remainingCents, excessCents, percent };
}

/** The longest note a payment carries. */
export const ZAKAT_NOTE_MAX = 200;

const NOTE_SEPARATOR = ' · ';

/**
 * The reason on the draws of a payment: "zakat <hawl>", then the note when there is one. The
 * partners' pages already show a draw's reason, so the note reaches the people it concerns and
 * needs no field of its own.
 */
export function zakatPaymentReason(hawlDate: string, note: string | null): string {
  const text = note?.trim() ?? '';
  return text === '' ? `zakat ${hawlDate}` : `zakat ${hawlDate}${NOTE_SEPARATOR}${text}`;
}

/** The note in a draw's reason for the report of `hawlDate`; null when it carries none. */
export function zakatPaymentNoteOf(reason: string, hawlDate: string): string | null {
  const prefix = `zakat ${hawlDate}${NOTE_SEPARATOR}`;
  if (!reason.startsWith(prefix)) return null;
  const note = reason.slice(prefix.length).trim();
  return note === '' ? null : note;
}

// 128-bit FNV-1a, a fixed and portable hash: the same text gives the same number on every device
// and on the server, with no clock, no randomness and no asynchronous call.
const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const MASK_128 = (1n << 128n) - 1n;

function fnv1a128(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_128;
  }
  return hash;
}

/**
 * The id of the draw that a payment gives one partner. A payment has an id of its own, made once
 * when the person starts it; each draw's id follows from it and the partner, so sending the same
 * payment again (a second tap, a retry after a lost answer, the same request from two devices)
 * names the draws that exist instead of making new ones. The result is a valid UUID (version
 * 5 layout, RFC 4122 variant), which is what every record's id must be.
 */
export function zakatDrawIdOf(paymentId: string, partnerId: string): string {
  const hex = fnv1a128(`zakat-draw:${paymentId}:${partnerId}`).toString(16).padStart(32, '0');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Whether a draw already on a report belongs to the payment `paymentId` (a retry of it). */
export function isDrawOfZakatPayment(
  draw: { id: string; partnerId: string },
  paymentId: string,
): boolean {
  return draw.id === zakatDrawIdOf(paymentId, draw.partnerId);
}
