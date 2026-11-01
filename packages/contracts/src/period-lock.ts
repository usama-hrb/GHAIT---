import type { SyncEntity, SyncPushPayload } from './sync.js';

type DatesOf = { [E in SyncEntity]?: (payload: SyncPushPayload<E>) => (string | null)[] };

/**
 * The dates each entity's change is accounted on: a change dated inside a settled period is
 * refused (periodLockIssues, BUILD_PROMPTS 4.3). An expense counts by its paid date (S6), so an
 * unpaid one is never locked. A sale void is also dated by its sale, which the op does not carry:
 * whoever checks it adds that date. A zakat report is a snapshot, not a record of the books:
 * it is left out, so a hawl's report can be saved after its month is settled (its payments,
 * draws, are locked by their own date).
 */
const DATES: DatesOf = {
  purchase: (aggregate) => [aggregate.purchase.date],
  stock_move: (move) => [move.date],
  sale: (aggregate) => [aggregate.sale.date],
  sale_void: (aggregate) => [aggregate.saleVoid.date],
  sale_return: (aggregate) => [aggregate.saleReturn.date],
  supplier_payment: (payment) => [payment.date],
  payment: (aggregate) => [aggregate.payment.date],
  payment_allocation: (application) => application.allocations.map((a) => a.date),
  write_off: (writeOff) => [writeOff.date],
  expense: (expense) => [expense.paidDate],
  capital_move: (move) => [move.date],
  partner_draw: (draw) => [draw.date],
  cash_adjustment: (count) => [count.date],
};

/** The dates `payload` (an op's payload, or a mutable record) is accounted on; [] when undated. */
export function periodDatesOf<E extends SyncEntity>(
  entity: E,
  payload: SyncPushPayload<E>,
): (string | null)[] {
  const dates = DATES[entity];
  return dates ? dates(payload) : [];
}
