import {
  hawlClockOf,
  type MetalPrice,
  nisabCheckOf,
  type PartnerDraw,
  zakatBaseCategoriesOf,
  zakatPaymentReason,
  type ZakatBreakdown,
  type ZakatReport,
} from '@fabric/contracts';
import type {
  Local,
  ZakatEstimate,
  ZakatHistoryRow,
  ZakatLatestReport,
  ZakatOptions,
  ZakatReportView,
  ZakatReview,
} from '@/local-db';

/** The helpers that render a component to static HTML are shared: see shared/testing. */
export { markup, occurrences, textOf } from '@/shared/testing/static-markup';

// Every figure below is written out in cents and never worked out in a test. The shop: 50 m of
// one fabric at 40 dirham a metre (2,000 dirham, cost 1,200), 70,000 dirham of money, 3,000 dirham
// expected from a customer (and 1,000 written off as doubtful), 500 dirham held for a customer and
// 1,500 dirham owed to a supplier. Gold at 700 dirham a gram makes the nisab 85 g = 59,500 dirham.
// The base is 2,000 + 70,000 + 3,000 - 500 - 1,500 = 73,000 dirham: above the nisab, so 2.5%,
// 1,825 dirham, is due once the hawl has come.

/** Midday UTC: the same calendar day in Morocco whichever offset it has. */
export const TODAY = '2026-11-12';
export const RECEIVED_AT = '2026-11-12T12:00:00.000Z';
export const SAVED_AT = '2026-11-12T12:05:00.000Z';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const SETTINGS: ZakatReport['settings'] = {
  nisabMetal: 'gold',
  goodsValuation: 'market',
  includeDoubtfulDebts: false,
};

export const GOLD: MetalPrice = { pricePerGramCents: 70_000, date: '2026-11-10' };

/** The hawl that began on 1 Ramadan 1446 has come on 1 Ramadan 1447, 18 February 2026. */
export const HAWL_START = '2025-03-01';
export const HAWL_DATE = '2026-02-18';

export const BREAKDOWN: ZakatBreakdown = {
  goods: [
    {
      rollId: ID(1),
      label: 'B-A0012 · Rosa',
      remainingCm: 5_000,
      remainingPieces: 0,
      refPricePerMeterCents: 4_000,
      costCents: 120_000,
      valueCents: 200_000,
    },
  ],
  goodsCents: 200_000,
  cashCents: 7_000_000,
  receivables: [
    { customerId: ID(2), name: 'Amal', amountCents: 300_000, doubtful: false },
    { customerId: ID(3), name: 'Karim', amountCents: 100_000, doubtful: true },
  ],
  receivablesCents: 300_000,
  doubtfulReceivablesCents: 100_000,
  debts: [{ customerId: ID(4), name: 'Salma', amountCents: 50_000 }],
  supplierDebts: [{ supplierId: ID(5), name: 'Atlas Textile', amountCents: 150_000 }],
  debtsDueCents: 200_000,
  hawlCompleted: true,
  reachesNisab: true,
};

/** The report's fields for the hawl above: the base is 7,300,000 cents, the zakat 182,500. */
export const FIELDS: ZakatEstimate['fields'] = {
  hawlDate: HAWL_DATE,
  metalPrice: GOLD,
  nisabCents: 5_950_000,
  baseCents: 7_300_000,
  zakatDueCents: 182_500,
  settings: SETTINGS,
  breakdown: BREAKDOWN,
};

/** The same shop with 23,000 dirham less money: the base, 50,000 dirham, is below the nisab. */
export const BELOW_NISAB_FIELDS: ZakatEstimate['fields'] = {
  ...FIELDS,
  baseCents: 5_000_000,
  zakatDueCents: 0,
  breakdown: { ...BREAKDOWN, cashCents: 4_700_000, reachesNisab: false },
};

export function estimateOf(
  fields: ZakatEstimate['fields'] = FIELDS,
  unpaidBillsCents = 0,
): ZakatEstimate {
  return {
    fields,
    categories: zakatBaseCategoriesOf(fields.breakdown, fields.settings, unpaidBillsCents),
    nisab: nisabCheckOf(fields),
  };
}

export const OPTIONS: ZakatOptions = {
  ...SETTINGS,
  hawlStart: HAWL_START,
  goldPrice: GOLD,
  silverPrice: null,
  reminderDays: 7,
};

/** The latest hawl's report as the overview knows it: saved today, nothing paid yet. */
export const LATEST: ZakatLatestReport = {
  id: ID(10),
  hawlDate: HAWL_DATE,
  savedAt: SAVED_AT,
  nisabCents: 5_950_000,
  baseCents: 7_300_000,
  zakatDueCents: 182_500,
  paidCents: 0,
};

/** What the overview reads for a shop whose hawl has come and whose base reaches the nisab. */
export function reviewOf(over: Partial<ZakatReview> = {}): ZakatReview {
  return {
    today: TODAY,
    options: OPTIONS,
    clock: hawlClockOf(HAWL_START, TODAY),
    price: GOLD,
    receivedAt: RECEIVED_AT,
    items: [],
    estimate: estimateOf(),
    latest: null,
    lastCalculatedAt: null,
    unpaidExpensesCents: 0,
    status: 'zakat_due',
    ...over,
  };
}

/** One review for each of the eight states. */
export const REVIEWS: Record<ZakatReview['status'], ZakatReview> = {
  not_configured: reviewOf({
    options: { ...OPTIONS, hawlStart: null },
    clock: hawlClockOf(null, TODAY),
    items: [{ key: 'hawl_start_missing', severity: 'blocking' }],
    estimate: null,
    status: 'not_configured',
  }),
  review_required: reviewOf({
    options: { ...OPTIONS, goldPrice: null },
    price: null,
    items: [{ key: 'price_missing', severity: 'blocking' }],
    estimate: null,
    status: 'review_required',
  }),
  waiting_for_hawl: reviewOf({
    options: { ...OPTIONS, hawlStart: '2027-01-01' },
    clock: hawlClockOf('2027-01-01', TODAY),
    status: 'waiting_for_hawl',
  }),
  hawl_in_progress: reviewOf({
    options: { ...OPTIONS, hawlStart: '2026-05-01' },
    clock: hawlClockOf('2026-05-01', TODAY),
    status: 'hawl_in_progress',
  }),
  nisab_not_reached: reviewOf({
    estimate: estimateOf(BELOW_NISAB_FIELDS),
    status: 'nisab_not_reached',
  }),
  zakat_due: reviewOf(),
  calculation_completed: reviewOf({
    latest: LATEST,
    lastCalculatedAt: SAVED_AT,
    status: 'calculation_completed',
  }),
  payment_recorded: reviewOf({
    latest: { ...LATEST, paidCents: 100_000 },
    lastCalculatedAt: SAVED_AT,
    status: 'payment_recorded',
  }),
};

/** The saved report of the hawl, as the device holds it. */
export const REPORT: Local<ZakatReport> = {
  id: ID(10),
  createdAt: SAVED_AT,
  updatedAt: SAVED_AT,
  deviceId: 'tablet',
  voidedAt: null,
  serverSeq: 12,
  ...FIELDS,
};

export const VOIDED_REPORT: Local<ZakatReport> = {
  ...REPORT,
  voidedAt: '2026-11-13T09:00:00.000Z',
};

export function historyRowOf(report: Local<ZakatReport> = REPORT, paidCents = 0): ZakatHistoryRow {
  return { ...report, paidCents };
}

/** A payment of the report by one partner: its part by ownership, with the person's own note. */
export function drawOf(
  over: Partial<Local<PartnerDraw>> & { partnerName?: string } = {},
): Local<PartnerDraw> & { partnerName: string } {
  const { partnerName = 'Owner', ...fields } = over;
  return {
    id: ID(20),
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
    deviceId: 'tablet',
    voidedAt: null,
    serverSeq: 13,
    partnerId: ID(30),
    amountCents: 100_000,
    date: '2026-11-12',
    reason: zakatPaymentReason(HAWL_DATE, 'Receipt 41'),
    zakatReportId: REPORT.id,
    partnerName,
    ...fields,
  };
}

export function reportViewOf(over: Partial<ZakatReportView> = {}): ZakatReportView {
  return { report: REPORT, paidCents: 0, payments: [], ...over };
}
