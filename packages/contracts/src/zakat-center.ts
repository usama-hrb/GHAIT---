import { NISAB_GRAMS, type ZakatSettings } from '@fabric/core';
import type { Expense } from './expenses.js';
import { daysBetween, lastHawl, nextHawl } from './hijri.js';
import type { MetalPrice, ZakatBreakdown, zakatPositionOf } from './zakat.js';

/**
 * What the Zakat Management Center and its guided review say about the shop (ADR 0028). Every
 * function here only reads: it names the state, the items to look at and the parts of a figure
 * that @fabric/core and `zakatReportFieldsOf` already worked out. It adds no accounting rule, and
 * no figure it returns can end up in a report except through them.
 */

// ── The hawl clock ───────────────────────────────────────────────────────────────────────────────

/** Where the shop stands on its hawl today (SPEC §10, Z6, Z8). All days are whole days. */
export interface HawlClock {
  /** The first hawl's start (the setting); null while it is not set. */
  start: string | null;
  /** The latest hawl on or before today; null before the first. */
  last: string | null;
  /** The first hawl after today; null while there is no start. */
  next: string | null;
  /** The day the running hawl year began: the last hawl, or the start before the first hawl. */
  periodStart: string | null;
  /** From `periodStart` to today (0 while the start is still ahead). */
  elapsedDays: number;
  /** From today to the next hawl. */
  remainingDays: number;
  /** From `periodStart` to the next hawl. */
  totalDays: number;
  /** The start day itself has not come yet, so no hawl year is running. */
  startsLater: boolean;
}

/** The hawl clock for `today` (YYYY-MM-DD): the dates come from the Hijri helpers, nothing else. */
export function hawlClockOf(start: string | null, today: string): HawlClock {
  if (start === null) {
    return {
      start,
      last: null,
      next: null,
      periodStart: null,
      elapsedDays: 0,
      remainingDays: 0,
      totalDays: 0,
      startsLater: false,
    };
  }
  const last = lastHawl(start, today);
  const next = nextHawl(start, today);
  const periodStart = last ?? start;
  return {
    start,
    last,
    next,
    periodStart,
    elapsedDays: Math.max(0, daysBetween(periodStart, today)),
    remainingDays: daysBetween(today, next),
    totalDays: daysBetween(periodStart, next),
    startsLater: start > today,
  };
}

// ── Goods: which way each line was valued ────────────────────────────────────────────────────────

export type ZakatGoodsLine = ZakatBreakdown['goods'][number];

/**
 * How `computeZakat` values a line under `valuation`: at cost; at the reference price per metre
 * over the length left; at the piece price over the pieces left; or, for weight still waiting for
 * its length, at its cost because there are no metres to price (a market valuation has nothing
 * else to use, Z11). It mirrors the choice in `computeZakat` and never decides a value itself.
 */
export type GoodsBasis = 'cost' | 'length' | 'pieces' | 'unmeasured';

export function goodsBasisOf(
  line: Pick<ZakatGoodsLine, 'marketCents' | 'remainingPieces'>,
  valuation: ZakatSettings['goodsValuation'],
): GoodsBasis {
  if (valuation === 'cost') return 'cost';
  if (line.marketCents === undefined) return 'length';
  return line.remainingPieces > 0 ? 'pieces' : 'unmeasured';
}

/**
 * A line that a market valuation counts at nothing because its product has no price to value it
 * by (the reference price per metre, or the piece price). The calculation counts it at 0; this is
 * how a screen says so instead of leaving it unnoticed (Z12).
 */
export function goodsLineLacksPrice(
  line: Pick<
    ZakatGoodsLine,
    'marketCents' | 'remainingPieces' | 'remainingCm' | 'refPricePerMeterCents'
  >,
  valuation: ZakatSettings['goodsValuation'],
): boolean {
  const basis = goodsBasisOf(line, valuation);
  if (basis === 'length') return line.remainingCm > 0 && line.refPricePerMeterCents === 0;
  if (basis === 'pieces') return line.marketCents === 0;
  return false;
}

/**
 * What the goods lines add up to: at cost, and as valued in the base (which is the breakdown's
 * `goodsCents`). The audit shows both, so the owner sees what the chosen valuation adds to or takes
 * off the cost of the stock; neither figure feeds the base.
 */
export function goodsTotalsOf(goods: readonly Pick<ZakatGoodsLine, 'costCents' | 'valueCents'>[]): {
  costCents: number;
  valueCents: number;
} {
  return {
    costCents: goods.reduce((sum, line) => sum + line.costCents, 0),
    valueCents: goods.reduce((sum, line) => sum + line.valueCents, 0),
  };
}

// ── Items to review ──────────────────────────────────────────────────────────────────────────────

/**
 * What a calculation asks the owner to look at before relying on it, most important first.
 * `blocking`: the calculation cannot be made or trusted at all. `review`: it can be made, but a
 * figure in it rests on something the owner should confirm. `info`: a rule worth knowing about.
 */
export type ZakatReviewKey =
  | 'hawl_start_missing'
  | 'price_missing'
  | 'records_not_received'
  | 'price_in_future'
  | 'price_before_hawl'
  | 'goods_without_price'
  | 'goods_unmeasured_at_cost'
  | 'money_negative'
  | 'position_not_on_hawl_day'
  | 'doubtful_debts'
  | 'unpaid_expenses';

export type ZakatReviewSeverity = 'blocking' | 'review' | 'info';

export interface ZakatReviewItem {
  key: ZakatReviewKey;
  severity: ZakatReviewSeverity;
  /** How many batches or customers it is about; for the hawl day passed, how many days ago. */
  count?: number;
  /** The amount it is about, in cents. */
  cents?: number;
  /** The date it is about (a price's day). */
  date?: string;
}

export interface ZakatReviewInput {
  hawlStart: string | null;
  /** The price of the metal the nisab is measured in; null while there is none. */
  price: MetalPrice | null;
  settings: ZakatSettings;
  today: string;
  /** The hawl the calculation is for (the latest one); null before the first hawl. */
  hawlDate: string | null;
  position: ReturnType<typeof zakatPositionOf>;
  /** What the shop has recorded as owed on bills not paid yet (no rule deducts it, Z14). */
  unpaidExpensesCents: number;
  /** This device has received the shop's records at least once. */
  recordsReceived: boolean;
}

/**
 * The items a calculation needs reviewed. Nothing here has a threshold of its own: a price is
 * flagged only when its date is after today or before the hawl it is applied to, so the check
 * never invents how old a price may be (Z13).
 */
export function zakatReviewOf(input: ZakatReviewInput): ZakatReviewItem[] {
  const { position, settings, price } = input;
  const items: ZakatReviewItem[] = [];
  if (input.hawlStart === null) items.push({ key: 'hawl_start_missing', severity: 'blocking' });
  if (price === null) items.push({ key: 'price_missing', severity: 'blocking' });
  if (!input.recordsReceived) items.push({ key: 'records_not_received', severity: 'blocking' });
  if (price !== null && price.date > input.today) {
    items.push({ key: 'price_in_future', severity: 'review', date: price.date });
  } else if (price !== null && input.hawlDate !== null && price.date < input.hawlDate) {
    items.push({ key: 'price_before_hawl', severity: 'review', date: price.date });
  }
  if (settings.goodsValuation === 'market') {
    const without = position.goods.filter((line) => goodsLineLacksPrice(line, 'market'));
    if (without.length > 0) {
      items.push({ key: 'goods_without_price', severity: 'review', count: without.length });
    }
    const unmeasured = position.goods.filter(
      (line) => goodsBasisOf(line, 'market') === 'unmeasured',
    );
    if (unmeasured.length > 0) {
      items.push({
        key: 'goods_unmeasured_at_cost',
        severity: 'review',
        count: unmeasured.length,
        cents: unmeasured.reduce((sum, line) => sum + (line.marketCents ?? 0), 0),
      });
    }
  }
  if (position.cashCents < 0) {
    items.push({ key: 'money_negative', severity: 'review', cents: position.cashCents });
  }
  // A report reads the records as they are when it is made (Z6), not as they were on the hawl day.
  if (input.hawlDate !== null && input.hawlDate < input.today) {
    items.push({
      key: 'position_not_on_hawl_day',
      severity: 'info',
      count: daysBetween(input.hawlDate, input.today),
      date: input.hawlDate,
    });
  }
  const doubtful = position.receivables.filter((receivable) => receivable.doubtful);
  if (doubtful.length > 0) {
    items.push({
      key: 'doubtful_debts',
      severity: 'info',
      count: doubtful.length,
      cents: doubtful.reduce((sum, receivable) => sum + receivable.amountCents, 0),
    });
  }
  if (input.unpaidExpensesCents > 0) {
    items.push({ key: 'unpaid_expenses', severity: 'info', cents: input.unpaidExpensesCents });
  }
  return items;
}

/** What the shop has recorded as owed on bills it has not paid yet (live expenses with no paid day). */
export function unpaidExpensesCentsOf(records: {
  expenses: readonly Pick<Expense, 'amountCents' | 'paidDate' | 'voidedAt'>[];
}): number {
  return records.expenses
    .filter((expense) => expense.voidedAt === null && expense.paidDate === null)
    .reduce((sum, expense) => sum + expense.amountCents, 0);
}

// ── The base, category by category ───────────────────────────────────────────────────────────────

/**
 * How each part of the shop's position meets the zakat base: added to it, taken off it, left out
 * of it by a setting or a rule, or something the app does not track at all.
 */
export type BaseEffect = 'added' | 'deducted' | 'excluded' | 'not_tracked';

export type BaseCategoryKey =
  | 'money'
  | 'inventory'
  | 'receivables'
  | 'doubtful_receivables'
  | 'customer_credits'
  | 'supplier_debts'
  | 'unpaid_bills'
  | 'other_assets';

export interface BaseCategory {
  key: BaseCategoryKey;
  effect: BaseEffect;
  /** What the records give for it (cents); null where the app has no record of it. */
  cents: number | null;
  /** The items it is made of (batches, customers, suppliers); null where that has no meaning. */
  count: number | null;
}

/**
 * The categories of the zakat base for a calculation (or a saved report's breakdown), in the
 * order a person reads it. `unpaidBillsCents` is what the shop has recorded as owed on bills not
 * paid: null for a saved report, which did not keep it. The sums only group the items of the
 * breakdown; the base itself is what @fabric/core worked out from them.
 */
export function zakatBaseCategoriesOf(
  breakdown: ZakatBreakdown,
  settings: ZakatSettings,
  unpaidBillsCents: number | null,
): BaseCategory[] {
  const expected = breakdown.receivables.filter((receivable) => !receivable.doubtful);
  const doubtful = breakdown.receivables.filter((receivable) => receivable.doubtful);
  return [
    { key: 'money', effect: 'added', cents: breakdown.cashCents, count: null },
    {
      key: 'inventory',
      effect: 'added',
      cents: breakdown.goodsCents,
      count: breakdown.goods.length,
    },
    {
      key: 'receivables',
      effect: 'added',
      cents: expected.reduce((sum, receivable) => sum + receivable.amountCents, 0),
      count: expected.length,
    },
    {
      key: 'doubtful_receivables',
      effect: settings.includeDoubtfulDebts ? 'added' : 'excluded',
      cents: breakdown.doubtfulReceivablesCents,
      count: doubtful.length,
    },
    {
      key: 'customer_credits',
      effect: 'deducted',
      cents: breakdown.debts.reduce((sum, debt) => sum + debt.amountCents, 0),
      count: breakdown.debts.length,
    },
    {
      key: 'supplier_debts',
      effect: 'deducted',
      cents: breakdown.supplierDebts.reduce((sum, debt) => sum + debt.amountCents, 0),
      count: breakdown.supplierDebts.length,
    },
    { key: 'unpaid_bills', effect: 'excluded', cents: unpaidBillsCents, count: null },
    { key: 'other_assets', effect: 'not_tracked', cents: null, count: null },
  ];
}

// ── The nisab ────────────────────────────────────────────────────────────────────────────────────

/** The nisab check, laid out: the threshold, the base it is measured against and the gap between. */
export interface NisabCheck {
  metal: ZakatSettings['nisabMetal'];
  grams: number;
  pricePerGramCents: number;
  priceDate: string;
  thresholdCents: number;
  baseCents: number;
  reached: boolean;
  /** Base less threshold: positive above the nisab, negative below it. */
  differenceCents: number;
}

export function nisabCheckOf(figures: {
  settings: Pick<ZakatSettings, 'nisabMetal'>;
  metalPrice: MetalPrice;
  nisabCents: number;
  baseCents: number;
  breakdown: Pick<ZakatBreakdown, 'reachesNisab'>;
}): NisabCheck {
  return {
    metal: figures.settings.nisabMetal,
    grams: NISAB_GRAMS[figures.settings.nisabMetal],
    pricePerGramCents: figures.metalPrice.pricePerGramCents,
    priceDate: figures.metalPrice.date,
    thresholdCents: figures.nisabCents,
    baseCents: figures.baseCents,
    reached: figures.breakdown.reachesNisab,
    differenceCents: figures.baseCents - figures.nisabCents,
  };
}

// ── The headline state ───────────────────────────────────────────────────────────────────────────

/**
 * The one state the overview leads with. Each is decided from records and settings the app holds,
 * never from a reminder having arrived:
 * - not_configured: no hawl start is set, so there is no hawl to follow;
 * - review_required: the calculation cannot be made or trusted yet (see the items);
 * - waiting_for_hawl: the start day is still ahead;
 * - hawl_in_progress: the first hawl has not come yet;
 * - nisab_not_reached / zakat_due: the hawl has come, nothing is saved, and the base today does
 *   not / does reach the nisab (the amount is an estimate until a report is saved);
 * - calculation_completed: a report is saved for the latest hawl and nothing is paid on it;
 * - payment_recorded: something is paid on the latest hawl's report.
 */
export type ZakatStatus =
  | 'not_configured'
  | 'review_required'
  | 'waiting_for_hawl'
  | 'hawl_in_progress'
  | 'nisab_not_reached'
  | 'zakat_due'
  | 'calculation_completed'
  | 'payment_recorded';

export function zakatStatusOf(input: {
  clock: HawlClock;
  review: readonly ZakatReviewItem[];
  /** The live report for the latest hawl, with what was paid on it; null when there is none. */
  latest: { paidCents: number } | null;
  /** Whether the base today reaches the nisab; null while that cannot be told (no price). */
  reachesNisab: boolean | null;
}): ZakatStatus {
  if (input.clock.start === null) return 'not_configured';
  if (input.latest !== null) {
    return input.latest.paidCents > 0 ? 'payment_recorded' : 'calculation_completed';
  }
  if (input.review.some((item) => item.severity === 'blocking')) return 'review_required';
  if (input.clock.last === null) {
    return input.clock.startsLater ? 'waiting_for_hawl' : 'hawl_in_progress';
  }
  if (input.review.some((item) => item.severity === 'review')) return 'review_required';
  return input.reachesNisab === true ? 'zakat_due' : 'nisab_not_reached';
}
