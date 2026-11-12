import type { IntegrityReport } from '@fabric/contracts';

/** The helpers that render a component to static HTML are shared: see shared/testing. */
export { markup, occurrences, textOf } from '@/shared/testing/static-markup';

// The reports below are written out in cents, never worked out in the test: each total is the sum
// of its side's lines as the check returns it (150 dirham = 3,000 rial on each side when balanced).

/** What the shop holds equals what it owes and what belongs to the partners, to the cent. */
export const BALANCED: IntegrityReport = {
  ok: true,
  diffCents: 0,
  holdingsCents: 15_000,
  claimsCents: 15_000,
  breakdown: [
    { side: 'holdings', key: 'cash', cents: 10_000 },
    { side: 'holdings', key: 'stock_at_cost', cents: 5_000 },
    { side: 'holdings', key: 'unrecovered_capital', cents: 0 },
    { side: 'claims', key: 'capital', cents: 12_000 },
    { side: 'claims', key: 'partner_balances', cents: 1_000 },
    { side: 'claims', key: 'unsettled_net_profit', cents: 500 },
    { side: 'claims', key: 'customer_credits', cents: 1_000 },
    { side: 'claims', key: 'supplier_payables', cents: 500 },
  ],
  lockedThrough: null,
};

/** One cent more is held than the records explain. */
export const HELD_MORE_BY_ONE_CENT: IntegrityReport = {
  ...BALANCED,
  ok: false,
  diffCents: 1,
  holdingsCents: 15_001,
  breakdown: BALANCED.breakdown.map((line) =>
    line.key === 'cash' ? { ...line, cents: 10_001 } : line,
  ),
};

/** 10 dirham (200 rial) less is held than the records explain. */
export const HELD_LESS_BY_TEN_DIRHAM: IntegrityReport = {
  ...BALANCED,
  ok: false,
  diffCents: -1_000,
  holdingsCents: 14_000,
  breakdown: BALANCED.breakdown.map((line) =>
    line.key === 'cash' ? { ...line, cents: 9_000 } : line,
  ),
};

/**
 * Lines that are negative: the cash result, the partners' balance, the open period and what is owed
 * to suppliers; and a difference of 1 dirham.
 */
export const NEGATIVE_LINES: IntegrityReport = {
  ok: false,
  diffCents: 100,
  holdingsCents: 5_500,
  claimsCents: 5_400,
  breakdown: [
    { side: 'holdings', key: 'cash', cents: -2_500 },
    { side: 'holdings', key: 'stock_at_cost', cents: 8_000 },
    { side: 'holdings', key: 'unrecovered_capital', cents: 0 },
    { side: 'claims', key: 'capital', cents: 6_000 },
    { side: 'claims', key: 'partner_balances', cents: -300 },
    { side: 'claims', key: 'unsettled_net_profit', cents: -200 },
    { side: 'claims', key: 'customer_credits', cents: 0 },
    { side: 'claims', key: 'supplier_payables', cents: -100 },
  ],
  lockedThrough: null,
};

/** Midday UTC: the same calendar day in Morocco whichever offset it has. */
export const RECEIVED_AT = '2026-11-12T12:00:00.000Z';
export const CALCULATED_AT = '2026-11-12T12:05:00.000Z';
