import {
  type BaseCategoryKey,
  goodsBasisOf,
  type HawlClock,
  type MetalPrice,
  type NisabCheck,
  type ZakatGoodsLine,
  type ZakatReviewItem,
  type ZakatReviewKey,
  type ZakatStatus,
} from '@fabric/contracts';
import { normalizeDigits, ZAKAT_RATE_BP } from '@fabric/core';
import type { ZakatOptions, ZakatReview } from '@/local-db';

/**
 * What the Zakat Management Center's screens decide for themselves: which tone a state takes, how
 * a bar is filled, which review items belong where, and what stops a report from being saved.
 * Everything here is about showing and gating. The figures come from @fabric/contracts and
 * @fabric/core and are never worked out again in this folder.
 */

// ── Tone ─────────────────────────────────────────────────────────────────────────────────────────

/** How a state looks. The colour only backs up the words and the icon, which say the same thing. */
export type ZakatTone = 'warning' | 'neutral' | 'info' | 'success';

export function statusTone(status: ZakatStatus): ZakatTone {
  switch (status) {
    case 'not_configured':
    case 'review_required':
      return 'warning';
    case 'waiting_for_hawl':
    case 'nisab_not_reached':
      return 'neutral';
    case 'hawl_in_progress':
    case 'zakat_due':
      return 'info';
    case 'calculation_completed':
    case 'payment_recorded':
      return 'success';
  }
}

// ── Bars ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * How far through the running hawl year the shop is, in whole percent, rounded down so it never
 * reads 100 before the hawl has come. Null where no year is running (no start, or the start day
 * is still ahead): a bar would say something that is not so.
 */
export function hawlProgressOf(
  clock: Pick<HawlClock, 'start' | 'startsLater' | 'elapsedDays' | 'totalDays'>,
): number | null {
  if (clock.start === null || clock.startsLater || clock.totalDays <= 0) return null;
  return Math.min(100, Math.floor((clock.elapsedDays * 100) / clock.totalDays));
}

/**
 * The base as a share of the nisab, in whole percent and rounded down, so it never reads 100
 * before the nisab is reached. It can pass 100: the bar clamps, the text does not. Null where the
 * threshold is not a positive amount.
 */
export function nisabPercentOf(
  check: Pick<NisabCheck, 'baseCents' | 'thresholdCents'>,
): number | null {
  if (check.thresholdCents <= 0) return null;
  return Math.max(0, Math.floor((check.baseCents * 100) / check.thresholdCents));
}

/** The zakat rate as plain digits for a sentence ("2.5"): @fabric/core's rate, never typed here. */
export function zakatRateText(): string {
  return String(ZAKAT_RATE_BP / 100);
}

// ── Goods ────────────────────────────────────────────────────────────────────────────────────────

/** What a stock line is counted in: metres, pieces, or weight still waiting to be measured. */
export type GoodsQuantity =
  { kind: 'length'; cm: number } | { kind: 'pieces'; pieces: number } | { kind: 'awaiting' };

/**
 * The quantity a line is held in, whichever valuation is chosen: a batch with no market amount is
 * measured in metres; one with a market amount is counted in pieces, or is weight with no length
 * yet. It reads the line the way `goodsBasisOf` does and adds no rule.
 */
export function goodsQuantityOf(
  line: Pick<ZakatGoodsLine, 'marketCents' | 'remainingPieces' | 'remainingCm'>,
): GoodsQuantity {
  const basis = goodsBasisOf(line, 'market');
  if (basis === 'length') return { kind: 'length', cm: line.remainingCm };
  if (basis === 'pieces') return { kind: 'pieces', pieces: line.remainingPieces };
  return { kind: 'awaiting' };
}

// ── Items to review: where each one is shown ─────────────────────────────────────────────────────

/** The base category an item is about, for the item to be shown next to it. */
const CATEGORY_OF_ITEM: Partial<Record<ZakatReviewKey, BaseCategoryKey>> = {
  goods_without_price: 'inventory',
  goods_unmeasured_at_cost: 'inventory',
  money_negative: 'money',
  doubtful_debts: 'doubtful_receivables',
  unpaid_expenses: 'unpaid_bills',
};

export function itemsForCategory(
  items: readonly ZakatReviewItem[],
  category: BaseCategoryKey,
): ZakatReviewItem[] {
  return items.filter((item) => CATEGORY_OF_ITEM[item.key] === category);
}

/** The steps of the guided review, in the order a person goes through them. */
export const REVIEW_STAGES = [
  'settings',
  'base',
  'inventory',
  'nisab',
  'hawl',
  'result',
  'confirm',
] as const;

export type ReviewStage = (typeof REVIEW_STAGES)[number];

/**
 * The items a step shows, so a person meets each one where it matters. The last step shows them
 * all. Every item is placed in at least one step (the test checks it): a new item that no step
 * shows would be one nobody sees.
 */
const ITEMS_OF_STAGE: Record<ReviewStage, readonly ZakatReviewKey[]> = {
  settings: ['hawl_start_missing', 'price_missing'],
  base: ['records_not_received', 'money_negative', 'doubtful_debts', 'unpaid_expenses'],
  inventory: ['goods_without_price', 'goods_unmeasured_at_cost'],
  nisab: ['price_missing', 'price_in_future', 'price_before_hawl'],
  hawl: ['hawl_start_missing', 'position_not_on_hawl_day'],
  result: [],
  confirm: [],
};

export function itemsForStage(
  items: readonly ZakatReviewItem[],
  stage: ReviewStage,
): ZakatReviewItem[] {
  if (stage === 'confirm') return [...items];
  const keys = ITEMS_OF_STAGE[stage];
  return items.filter((item) => keys.includes(item.key));
}

/** The items stage `stage` is placed to show, by key (for the test of coverage). */
export function itemKeysOfStage(stage: ReviewStage): readonly ZakatReviewKey[] {
  return ITEMS_OF_STAGE[stage];
}

/** Items that stop a calculation, and items that ask for a look before it is relied on. */
export function attentionItemsOf(items: readonly ZakatReviewItem[]): ZakatReviewItem[] {
  return items.filter((item) => item.severity !== 'info');
}

/** Items that are only worth knowing about. */
export function infoItemsOf(items: readonly ZakatReviewItem[]): ZakatReviewItem[] {
  return items.filter((item) => item.severity === 'info');
}

// ── Saving the report ────────────────────────────────────────────────────────────────────────────

/** Why a report cannot be saved now. Empty means it can. */
export type SaveBlock = 'not_owner' | 'blocking_items' | 'hawl_not_completed' | 'already_saved';

/**
 * What stops the report for the latest hawl from being saved. The device repository and the
 * server refuse the same cases; this says so before the person tries, and names each reason.
 */
export function saveBlocksOf(input: {
  isOwner: boolean;
  review: Pick<ZakatReview, 'items' | 'clock' | 'latest'>;
}): SaveBlock[] {
  const { review } = input;
  const blocks: SaveBlock[] = [];
  if (!input.isOwner) blocks.push('not_owner');
  if (review.items.some((item) => item.severity === 'blocking')) blocks.push('blocking_items');
  if (review.clock.start !== null && review.clock.last === null) blocks.push('hawl_not_completed');
  if (review.latest !== null) blocks.push('already_saved');
  return blocks;
}

// ── The methodology form ─────────────────────────────────────────────────────────────────────────

/** What the methodology form holds: the text and numbers as typed, before they are checked. */
export interface ZakatSettingsDraft {
  hawlStart: string;
  nisabMetal: ZakatOptions['nisabMetal'];
  goodsValuation: ZakatOptions['goodsValuation'];
  includeDoubtfulDebts: boolean;
  goldCents: number | null;
  goldDate: string;
  silverCents: number | null;
  silverDate: string;
  reminderDays: string;
}

/** The fields of a draft that cannot be saved as they stand. */
export type ZakatSettingsError = 'gold' | 'silver' | 'reminder';

export type ZakatSettingsCheck =
  { ok: true; options: ZakatOptions } | { ok: false; errors: ZakatSettingsError[] };

type DraftPrice = { ok: true; price: MetalPrice | null } | { ok: false };

/**
 * A price is its amount and the day it was seen together, or nothing at all. An amount with no day,
 * or a day with no amount, is refused rather than saved as nothing: the form never clears a price
 * the person did not mean to clear.
 */
function draftPriceOf(cents: number | null, date: string): DraftPrice {
  const amount = cents ?? 0;
  if (amount > 0 && date !== '') return { ok: true, price: { pricePerGramCents: amount, date } };
  if (amount <= 0 && date === '') return { ok: true, price: null };
  return { ok: false };
}

/** A whole number of days from 0 to 60 (the range of the setting), typed in any digits; else null. */
export function reminderDaysOf(text: string): number | null {
  const digits = normalizeDigits(text).trim();
  if (!/^\d{1,2}$/.test(digits)) return null;
  const days = Number(digits);
  return days <= 60 ? days : null;
}

/**
 * Checks what was typed into the methodology form and turns it into the options to save, or says
 * which fields are wrong. It does not save and does not decide what a setting should be.
 */
export function checkZakatSettings(draft: ZakatSettingsDraft): ZakatSettingsCheck {
  const gold = draftPriceOf(draft.goldCents, draft.goldDate);
  const silver = draftPriceOf(draft.silverCents, draft.silverDate);
  const days = reminderDaysOf(draft.reminderDays);
  const errors: ZakatSettingsError[] = [];
  if (!gold.ok) errors.push('gold');
  if (!silver.ok) errors.push('silver');
  if (days === null) errors.push('reminder');
  if (!gold.ok || !silver.ok || days === null) return { ok: false, errors };
  return {
    ok: true,
    options: {
      hawlStart: draft.hawlStart === '' ? null : draft.hawlStart,
      nisabMetal: draft.nisabMetal,
      goodsValuation: draft.goodsValuation,
      includeDoubtfulDebts: draft.includeDoubtfulDebts,
      goldPrice: gold.price,
      silverPrice: silver.price,
      reminderDays: days,
    },
  };
}
