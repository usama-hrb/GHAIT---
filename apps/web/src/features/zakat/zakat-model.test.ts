import type { HawlClock, ZakatReviewItem, ZakatReviewKey, ZakatStatus } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import {
  attentionItemsOf,
  goodsQuantityOf,
  hawlProgressOf,
  infoItemsOf,
  itemKeysOfStage,
  itemsForCategory,
  itemsForStage,
  checkZakatSettings,
  nisabPercentOf,
  reminderDaysOf,
  REVIEW_STAGES,
  saveBlocksOf,
  statusTone,
  type ZakatSettingsDraft,
  zakatRateText,
} from './zakat-model';

const STATUSES = {
  not_configured: true,
  review_required: true,
  waiting_for_hawl: true,
  hawl_in_progress: true,
  nisab_not_reached: true,
  zakat_due: true,
  calculation_completed: true,
  payment_recorded: true,
} satisfies Record<ZakatStatus, true>;

// A key that is missing here fails to compile: a new item must be placed in a step.
const REVIEW_KEYS = {
  hawl_start_missing: 'blocking',
  price_missing: 'blocking',
  records_not_received: 'blocking',
  price_in_future: 'review',
  price_before_hawl: 'review',
  goods_without_price: 'review',
  goods_unmeasured_at_cost: 'review',
  money_negative: 'review',
  position_not_on_hawl_day: 'info',
  doubtful_debts: 'info',
  unpaid_expenses: 'info',
} as const satisfies Record<ZakatReviewKey, ZakatReviewItem['severity']>;

const item = (key: ZakatReviewKey): ZakatReviewItem => ({ key, severity: REVIEW_KEYS[key] });
const ALL_ITEMS = (Object.keys(REVIEW_KEYS) as ZakatReviewKey[]).map(item);

const CLOCK: HawlClock = {
  start: '2025-03-01',
  last: '2026-02-18',
  next: '2027-02-07',
  periodStart: '2026-02-18',
  elapsedDays: 100,
  remainingDays: 200,
  totalDays: 300,
  startsLater: false,
};

describe('the tone of a state', () => {
  it('is set for every state, and a state that needs a look is never shown as calm', () => {
    for (const status of Object.keys(STATUSES) as ZakatStatus[]) {
      expect(['warning', 'neutral', 'info', 'success']).toContain(statusTone(status));
    }
    expect(statusTone('review_required')).toBe('warning');
    expect(statusTone('not_configured')).toBe('warning');
    expect(statusTone('zakat_due')).toBe('info');
    expect(statusTone('payment_recorded')).toBe('success');
  });
});

describe('the hawl bar', () => {
  it('fills with the days gone of the running year, rounded down', () => {
    expect(hawlProgressOf(CLOCK)).toBe(33);
    expect(hawlProgressOf({ ...CLOCK, elapsedDays: 0 })).toBe(0);
    expect(hawlProgressOf({ ...CLOCK, elapsedDays: 150 })).toBe(50);
  });

  it('never reads 100 before the hawl has come, and never passes it', () => {
    expect(hawlProgressOf({ ...CLOCK, elapsedDays: 299 })).toBe(99);
    expect(hawlProgressOf({ ...CLOCK, elapsedDays: 300 })).toBe(100);
    expect(hawlProgressOf({ ...CLOCK, elapsedDays: 900 })).toBe(100);
  });

  it('is absent where no year is running', () => {
    expect(hawlProgressOf({ ...CLOCK, start: null })).toBeNull();
    expect(hawlProgressOf({ ...CLOCK, startsLater: true })).toBeNull();
    expect(hawlProgressOf({ ...CLOCK, totalDays: 0 })).toBeNull();
  });
});

describe('the nisab percentage', () => {
  it('is the base as a share of the threshold, rounded down', () => {
    expect(nisabPercentOf({ baseCents: 50_000, thresholdCents: 100_000 })).toBe(50);
    expect(nisabPercentOf({ baseCents: 33_333, thresholdCents: 100_000 })).toBe(33);
  });

  it('never reads 100 until the base reaches the threshold, and can pass it', () => {
    expect(nisabPercentOf({ baseCents: 99_999, thresholdCents: 100_000 })).toBe(99);
    expect(nisabPercentOf({ baseCents: 100_000, thresholdCents: 100_000 })).toBe(100);
    expect(nisabPercentOf({ baseCents: 250_000, thresholdCents: 100_000 })).toBe(250);
  });

  it('is nothing for a negative base and absent without a threshold', () => {
    expect(nisabPercentOf({ baseCents: -500, thresholdCents: 100_000 })).toBe(0);
    expect(nisabPercentOf({ baseCents: 500, thresholdCents: 0 })).toBeNull();
  });
});

describe('the rate in a sentence', () => {
  it("is the core's rate as plain digits", () => {
    expect(zakatRateText()).toBe('2.5');
  });
});

describe('what a stock line is counted in', () => {
  const base = { remainingCm: 0, remainingPieces: 0 };

  it('is metres for a batch with no market amount', () => {
    expect(goodsQuantityOf({ ...base, remainingCm: 275 })).toEqual({ kind: 'length', cm: 275 });
  });

  it('is pieces for a batch counted in pieces', () => {
    expect(goodsQuantityOf({ ...base, remainingPieces: 4, marketCents: 8_000 })).toEqual({
      kind: 'pieces',
      pieces: 4,
    });
  });

  it('is awaiting measurement for weight with no length yet', () => {
    expect(goodsQuantityOf({ ...base, marketCents: 12_000 })).toEqual({ kind: 'awaiting' });
  });
});

describe('where the items of a review are shown', () => {
  it('shows every item in at least one step, so none goes unseen', () => {
    for (const { key } of ALL_ITEMS) {
      const shown = REVIEW_STAGES.some((stage) => itemKeysOfStage(stage).includes(key));
      expect(shown, key).toBe(true);
    }
  });

  it('shows a step only the items that are about it, and the last step all of them', () => {
    expect(itemsForStage(ALL_ITEMS, 'inventory').map((found) => found.key)).toEqual([
      'goods_without_price',
      'goods_unmeasured_at_cost',
    ]);
    expect(itemsForStage(ALL_ITEMS, 'result')).toEqual([]);
    expect(itemsForStage(ALL_ITEMS, 'confirm')).toEqual(ALL_ITEMS);
  });

  it('puts a missing price on the settings step and on the nisab step', () => {
    const missing = [item('price_missing')];
    expect(itemsForStage(missing, 'settings')).toEqual(missing);
    expect(itemsForStage(missing, 'nisab')).toEqual(missing);
    expect(itemsForStage(missing, 'inventory')).toEqual([]);
  });

  it('shows an item next to the part of the base it is about', () => {
    expect(itemsForCategory(ALL_ITEMS, 'inventory').map((found) => found.key)).toEqual([
      'goods_without_price',
      'goods_unmeasured_at_cost',
    ]);
    expect(itemsForCategory(ALL_ITEMS, 'money').map((found) => found.key)).toEqual([
      'money_negative',
    ]);
    expect(itemsForCategory(ALL_ITEMS, 'doubtful_receivables').map((found) => found.key)).toEqual([
      'doubtful_debts',
    ]);
    expect(itemsForCategory(ALL_ITEMS, 'unpaid_bills').map((found) => found.key)).toEqual([
      'unpaid_expenses',
    ]);
    expect(itemsForCategory(ALL_ITEMS, 'other_assets')).toEqual([]);
  });

  it('keeps items that need a look apart from those that are only worth knowing', () => {
    expect(attentionItemsOf(ALL_ITEMS).every((found) => found.severity !== 'info')).toBe(true);
    expect(infoItemsOf(ALL_ITEMS).map((found) => found.key)).toEqual([
      'position_not_on_hawl_day',
      'doubtful_debts',
      'unpaid_expenses',
    ]);
    expect(attentionItemsOf(ALL_ITEMS).length + infoItemsOf(ALL_ITEMS).length).toBe(
      ALL_ITEMS.length,
    );
  });
});

describe('what stops a report from being saved', () => {
  const ready = { items: [], clock: CLOCK, latest: null };

  it('stops nothing for the owner when the hawl has come, nothing blocks and none is saved', () => {
    expect(saveBlocksOf({ isOwner: true, review: ready })).toEqual([]);
  });

  it('stops a partner, who reads but never saves', () => {
    expect(saveBlocksOf({ isOwner: false, review: ready })).toEqual(['not_owner']);
  });

  it('stops while an item blocks the calculation, but not for an item that only asks for a look', () => {
    expect(
      saveBlocksOf({ isOwner: true, review: { ...ready, items: [item('price_missing')] } }),
    ).toEqual(['blocking_items']);
    expect(
      saveBlocksOf({ isOwner: true, review: { ...ready, items: [item('goods_without_price')] } }),
    ).toEqual([]);
  });

  it('stops before the first hawl has come, but names no hawl problem when there is no start', () => {
    const before = { ...CLOCK, last: null };
    expect(saveBlocksOf({ isOwner: true, review: { ...ready, clock: before } })).toEqual([
      'hawl_not_completed',
    ]);
    const noStart = { ...CLOCK, start: null, last: null };
    expect(
      saveBlocksOf({
        isOwner: true,
        review: { items: [item('hawl_start_missing')], clock: noStart, latest: null },
      }),
    ).toEqual(['blocking_items']);
  });

  it('stops when the latest hawl already has its report', () => {
    const latest = {
      id: 'r1',
      hawlDate: '2026-02-18',
      savedAt: '2026-02-18T10:00:00.000Z',
      nisabCents: 1,
      baseCents: 2,
      zakatDueCents: 3,
      paidCents: 0,
    };
    expect(saveBlocksOf({ isOwner: true, review: { ...ready, latest } })).toEqual([
      'already_saved',
    ]);
  });

  it('lists every reason at once, in a fixed order', () => {
    expect(
      saveBlocksOf({
        isOwner: false,
        review: {
          items: [item('records_not_received')],
          clock: { ...CLOCK, last: null },
          latest: null,
        },
      }),
    ).toEqual(['not_owner', 'blocking_items', 'hawl_not_completed']);
  });
});

describe('reminderDaysOf', () => {
  it('reads whole days from 0 to 60, in any digits', () => {
    expect(reminderDaysOf('0')).toBe(0);
    expect(reminderDaysOf('14')).toBe(14);
    expect(reminderDaysOf(' 60 ')).toBe(60);
    expect(reminderDaysOf('١٤')).toBe(14);
    expect(reminderDaysOf('۳۰')).toBe(30);
  });

  it('refuses anything else', () => {
    for (const text of ['', ' ', '-1', '61', '100', '1.5', '1,5', 'ten', '1 4', '007']) {
      expect(reminderDaysOf(text), text).toBeNull();
    }
  });
});

describe('checkZakatSettings', () => {
  const draft: ZakatSettingsDraft = {
    hawlStart: '2025-02-18',
    nisabMetal: 'silver',
    goodsValuation: 'cost',
    includeDoubtfulDebts: true,
    goldCents: 62_000_00,
    goldDate: '2026-02-01',
    silverCents: 8_00,
    silverDate: '2026-02-02',
    reminderDays: '21',
  };

  it('turns a good draft into the options to save', () => {
    expect(checkZakatSettings(draft)).toEqual({
      ok: true,
      options: {
        hawlStart: '2025-02-18',
        nisabMetal: 'silver',
        goodsValuation: 'cost',
        includeDoubtfulDebts: true,
        goldPrice: { pricePerGramCents: 62_000_00, date: '2026-02-01' },
        silverPrice: { pricePerGramCents: 8_00, date: '2026-02-02' },
        reminderDays: 21,
      },
    });
  });

  it('keeps a price that is empty as no price, and an empty start as no start', () => {
    const check = checkZakatSettings({
      ...draft,
      hawlStart: '',
      goldCents: null,
      goldDate: '',
      silverCents: 0,
      silverDate: '',
    });
    expect(check).toMatchObject({
      ok: true,
      options: { hawlStart: null, goldPrice: null, silverPrice: null },
    });
  });

  it('refuses a price with an amount and no day, or a day and no amount', () => {
    expect(checkZakatSettings({ ...draft, goldDate: '' })).toEqual({
      ok: false,
      errors: ['gold'],
    });
    expect(checkZakatSettings({ ...draft, silverCents: null })).toEqual({
      ok: false,
      errors: ['silver'],
    });
    expect(checkZakatSettings({ ...draft, goldCents: 0 })).toEqual({
      ok: false,
      errors: ['gold'],
    });
  });

  it('names every wrong field at once and saves nothing', () => {
    expect(
      checkZakatSettings({ ...draft, goldDate: '', silverDate: '', reminderDays: '99' }),
    ).toEqual({ ok: false, errors: ['gold', 'silver', 'reminder'] });
  });
});
