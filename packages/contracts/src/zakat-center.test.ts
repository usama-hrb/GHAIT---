import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  goodsBasisOf,
  goodsLineLacksPrice,
  goodsTotalsOf,
  hawlClockOf,
  nextHawl,
  nisabCheckOf,
  unpaidExpensesCentsOf,
  zakatBaseCategoriesOf,
  zakatReportFieldsOf,
  zakatReviewOf,
  zakatStatusOf,
  type ZakatBreakdown,
  type ZakatReviewInput,
  type ZakatReviewItem,
} from './index.js';
import { dh } from './test-shop.js';

const MARKET = {
  nisabMetal: 'gold',
  goodsValuation: 'market',
  includeDoubtfulDebts: false,
} as const;
const COST = { ...MARKET, goodsValuation: 'cost' } as const;
const CHEAP_GOLD = { pricePerGramCents: dh(300), date: '2026-10-30' }; // nisab 25 500 dh

type Line = ZakatBreakdown['goods'][number];

const line = (more: Partial<Line> = {}): Line => ({ ...goods(), ...more });
function goods(): Line {
  return {
    rollId: crypto.randomUUID(),
    label: 'B-A0001 · Rosa',
    remainingCm: 100_000,
    remainingPieces: 0,
    refPricePerMeterCents: dh(30),
    costCents: dh(24_000),
    valueCents: 0,
  };
}

/** T14's position (stock 30 000 dh at the reference price, cash 5 000, expected debts 2 000, owed 1 000). */
function position() {
  return {
    goods: [line()],
    cashCents: dh(5000),
    receivables: [
      { customerId: crypto.randomUUID(), name: 'Fatima', amountCents: dh(2000), doubtful: false },
      { customerId: crypto.randomUUID(), name: 'Omar', amountCents: dh(400), doubtful: true },
    ],
    debts: [{ customerId: crypto.randomUUID(), name: 'Amina', amountCents: dh(1000) }],
    supplierDebts: [{ supplierId: crypto.randomUUID(), name: 'Mill', amountCents: dh(500) }],
  };
}

describe('the hawl clock', () => {
  it('has nothing to say while no start is set', () => {
    expect(hawlClockOf(null, '2026-11-12')).toEqual({
      start: null,
      last: null,
      next: null,
      periodStart: null,
      elapsedDays: 0,
      remainingDays: 0,
      totalDays: 0,
      startsLater: false,
    });
  });

  it('before the first hawl: the year runs from the start, no hawl has passed', () => {
    const start = '2026-03-01';
    const today = '2026-11-12';
    const clock = hawlClockOf(start, today);
    const next = nextHawl(start, today);
    expect(clock).toMatchObject({
      start,
      last: null,
      next,
      periodStart: start,
      elapsedDays: daysBetween(start, today),
      remainingDays: daysBetween(today, next),
      totalDays: daysBetween(start, next),
      startsLater: false,
    });
    expect(clock.elapsedDays + clock.remainingDays).toBe(clock.totalDays);
  });

  it('a start still ahead: waiting, nothing has elapsed, and the first hawl is a Hijri year after it', () => {
    const clock = hawlClockOf('2026-12-01', '2026-11-12');
    expect(clock.startsLater).toBe(true);
    expect(clock.last).toBeNull();
    expect(clock.periodStart).toBe('2026-12-01');
    expect(clock.elapsedDays).toBe(0);
    expect(clock.totalDays).toBeGreaterThanOrEqual(354);
    expect(clock.remainingDays).toBe(clock.totalDays + 19);
  });

  it('the start day itself is not "later": the year begins today with nothing elapsed', () => {
    const clock = hawlClockOf('2026-11-12', '2026-11-12');
    expect(clock.startsLater).toBe(false);
    expect(clock.elapsedDays).toBe(0);
    expect(clock.last).toBeNull();
  });

  it('on the hawl day, the hawl has come and the next year has just begun', () => {
    const start = '2025-03-01';
    const first = nextHawl(start, start);
    const clock = hawlClockOf(start, first);
    expect(clock.last).toBe(first);
    expect(clock.periodStart).toBe(first);
    expect(clock.elapsedDays).toBe(0);
    expect(clock.remainingDays).toBe(clock.totalDays);
    expect([354, 355]).toContain(clock.totalDays);
    expect(clock.next).toBe(nextHawl(start, first));
  });

  it('the day before the hawl: one day remains and the hawl has not come', () => {
    const start = '2025-03-01';
    const first = nextHawl(start, start);
    const clock = hawlClockOf(start, addDays(first, -1));
    expect(clock.last).toBeNull();
    expect(clock.remainingDays).toBe(1);
    expect(clock.next).toBe(first);
    expect(clock.elapsedDays + clock.remainingDays).toBe(clock.totalDays);
  });

  it('after the hawl: the year is counted from that hawl', () => {
    const start = '2025-03-01';
    const first = nextHawl(start, start);
    const clock = hawlClockOf(start, addDays(first, 30));
    expect(clock.last).toBe(first);
    expect(clock.periodStart).toBe(first);
    expect(clock.elapsedDays).toBe(30);
    expect(clock.next).toBe(nextHawl(start, first));
    expect(clock.elapsedDays + clock.remainingDays).toBe(clock.totalDays);
  });

  it('every day over three Hijri years: elapsed plus remaining is the year, next is ahead, last is behind', () => {
    const start = '2025-03-01';
    for (let offset = -12; offset <= 800; offset += 13) {
      const today = addDays(start, offset);
      const clock = hawlClockOf(start, today);
      expect(clock.next !== null && clock.next > today).toBe(true);
      expect(clock.remainingDays).toBeGreaterThanOrEqual(1);
      if (clock.last !== null) expect(clock.last <= today).toBe(true);
      if (!clock.startsLater) {
        expect(clock.elapsedDays + clock.remainingDays).toBe(clock.totalDays);
        expect(clock.elapsedDays).toBeGreaterThanOrEqual(0);
        expect(clock.totalDays).toBeLessThanOrEqual(355);
      }
    }
  });
});

describe('how goods are valued', () => {
  it('at cost whatever the line says, under the cost valuation', () => {
    expect(goodsBasisOf(line(), 'cost')).toBe('cost');
    expect(goodsBasisOf(line({ remainingPieces: 3 }), 'cost')).toBe('cost');
  });

  it('under the market valuation: by length, by pieces, or at cost while the weight waits for its length', () => {
    expect(goodsBasisOf(line(), 'market')).toBe('length');
    expect(goodsBasisOf(line({ remainingPieces: 4, marketCents: dh(80) }), 'market')).toBe(
      'pieces',
    );
    expect(
      goodsBasisOf(line({ remainingCm: 0, remainingPieces: 0, marketCents: dh(500) }), 'market'),
    ).toBe('unmeasured');
  });

  it('a line with nothing to value it by is flagged, but only under the market valuation', () => {
    const noPrice = line({ refPricePerMeterCents: 0 });
    expect(goodsLineLacksPrice(noPrice, 'market')).toBe(true);
    expect(goodsLineLacksPrice(noPrice, 'cost')).toBe(false);
    expect(goodsLineLacksPrice(line(), 'market')).toBe(false);
    // No length left: a missing price costs nothing.
    expect(goodsLineLacksPrice(line({ refPricePerMeterCents: 0, remainingCm: 0 }), 'market')).toBe(
      false,
    );
    // Pieces with no piece price give a worth of 0.
    expect(goodsLineLacksPrice(line({ remainingPieces: 5, marketCents: 0 }), 'market')).toBe(true);
    expect(goodsLineLacksPrice(line({ remainingPieces: 5, marketCents: dh(80) }), 'market')).toBe(
      false,
    );
    // Weight awaiting its length is valued at its cost: not "without a price".
    expect(
      goodsLineLacksPrice(
        line({ remainingCm: 0, marketCents: dh(500), refPricePerMeterCents: 0 }),
        'market',
      ),
    ).toBe(false);
  });
});

describe('what the goods lines add up to', () => {
  it('adds the cost and the counted value of every line, and nothing for no lines', () => {
    expect(goodsTotalsOf([])).toEqual({ costCents: 0, valueCents: 0 });
    expect(
      goodsTotalsOf([
        line({ costCents: dh(100), valueCents: dh(150) }),
        line({ costCents: dh(40), valueCents: dh(30) }),
      ]),
    ).toEqual({ costCents: dh(140), valueCents: dh(180) });
  });
});

const TODAY = '2026-11-12';
const HAWL = '2026-10-31';

function review(more: Partial<ZakatReviewInput> = {}): ZakatReviewItem[] {
  return zakatReviewOf({
    hawlStart: '2025-10-20',
    price: { pricePerGramCents: dh(300), date: HAWL },
    settings: MARKET,
    today: TODAY,
    hawlDate: HAWL,
    position: position(),
    unpaidExpensesCents: 0,
    recordsReceived: true,
    ...more,
  });
}

const keys = (items: readonly ZakatReviewItem[]) => items.map((item) => item.key);

describe('what a calculation asks the owner to look at', () => {
  it('a doubtful debt is only noted: it is the owner’s setting whether it counts', () => {
    expect(review({ hawlDate: TODAY, price: { pricePerGramCents: dh(300), date: TODAY } })).toEqual(
      [{ key: 'doubtful_debts', severity: 'info', count: 1, cents: dh(400) }],
    );
  });

  it('a report made after the hawl day says the records are today’s, and how many days after the hawl that is', () => {
    expect(review()).toEqual([
      { key: 'position_not_on_hawl_day', severity: 'info', count: 12, date: HAWL },
      { key: 'doubtful_debts', severity: 'info', count: 1, cents: dh(400) },
    ]);
    // On the hawl day itself, and before the first hawl, there is nothing to say.
    expect(keys(review({ hawlDate: TODAY }))).not.toContain('position_not_on_hawl_day');
    expect(keys(review({ hawlDate: null }))).not.toContain('position_not_on_hawl_day');
  });

  it('no hawl start and no price are blocking', () => {
    const items = review({ hawlStart: null, price: null, hawlDate: null });
    expect(items.filter((item) => item.severity === 'blocking').map((item) => item.key)).toEqual([
      'hawl_start_missing',
      'price_missing',
    ]);
  });

  it('a device that has not received the shop’s records is blocking: its empty books are not a position', () => {
    expect(keys(review({ recordsReceived: false }))).toContain('records_not_received');
    expect(
      review({ recordsReceived: false }).find((item) => item.key === 'records_not_received'),
    ).toMatchObject({ severity: 'blocking' });
  });

  it('a price dated after today, or before the hawl it is applied to, is flagged: no age limit is invented', () => {
    expect(review({ price: { pricePerGramCents: 1, date: addDays(TODAY, 1) } })).toContainEqual({
      key: 'price_in_future',
      severity: 'review',
      date: addDays(TODAY, 1),
    });
    expect(review({ price: { pricePerGramCents: 1, date: addDays(HAWL, -1) } })).toContainEqual({
      key: 'price_before_hawl',
      severity: 'review',
      date: addDays(HAWL, -1),
    });
    // Dated on the hawl, or any day after it: fine however old that is by now.
    for (const date of [HAWL, addDays(HAWL, 5), TODAY]) {
      expect(keys(review({ price: { pricePerGramCents: 1, date } }))).not.toContain(
        'price_before_hawl',
      );
    }
    // Before the first hawl there is none to compare with.
    expect(
      keys(review({ hawlDate: null, price: { pricePerGramCents: 1, date: '2020-01-01' } })),
    ).not.toContain('price_before_hawl');
  });

  it('goods with nothing to value them by, and weight counted at cost, are listed under a market valuation', () => {
    const items = review({
      position: {
        ...position(),
        goods: [
          line(),
          line({ refPricePerMeterCents: 0 }),
          line({ remainingPieces: 2, marketCents: 0 }),
          line({ remainingCm: 0, marketCents: dh(500), refPricePerMeterCents: 0 }),
        ],
      },
    });
    expect(items).toContainEqual({ key: 'goods_without_price', severity: 'review', count: 2 });
    expect(items).toContainEqual({
      key: 'goods_unmeasured_at_cost',
      severity: 'review',
      count: 1,
      cents: dh(500),
    });
  });

  it('the goods flags do not apply to a cost valuation: nothing there depends on a price', () => {
    const items = review({
      settings: COST,
      position: {
        ...position(),
        goods: [line({ refPricePerMeterCents: 0 }), line({ remainingCm: 0, marketCents: 1 })],
      },
    });
    expect(keys(items)).not.toContain('goods_without_price');
    expect(keys(items)).not.toContain('goods_unmeasured_at_cost');
  });

  it('negative money on the records is flagged with its amount (it is counted as nothing in the base)', () => {
    expect(review({ position: { ...position(), cashCents: -dh(40) } })).toContainEqual({
      key: 'money_negative',
      severity: 'review',
      cents: -dh(40),
    });
  });

  it('bills not paid yet are noted: no rule takes them off the base', () => {
    expect(review({ unpaidExpensesCents: dh(700) })).toContainEqual({
      key: 'unpaid_expenses',
      severity: 'info',
      cents: dh(700),
    });
  });

  it('lists the most important first: blocking, then review, then notes', () => {
    const items = review({
      hawlStart: null,
      price: { pricePerGramCents: 1, date: addDays(TODAY, 3) },
      recordsReceived: false,
      unpaidExpensesCents: 1,
      position: {
        ...position(),
        cashCents: -1,
        goods: [line({ refPricePerMeterCents: 0 }), line({ remainingCm: 0, marketCents: 5 })],
      },
    });
    expect(keys(items)).toEqual([
      'hawl_start_missing',
      'records_not_received',
      'price_in_future',
      'goods_without_price',
      'goods_unmeasured_at_cost',
      'money_negative',
      'position_not_on_hawl_day',
      'doubtful_debts',
      'unpaid_expenses',
    ]);
    const rank = { blocking: 0, review: 1, info: 2 } as const;
    const ranks = items.map((item) => rank[item.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('bills not paid yet', () => {
  const expense = (more: { amountCents: number; paidDate: string | null; voidedAt?: string }) => ({
    amountCents: more.amountCents,
    paidDate: more.paidDate,
    voidedAt: more.voidedAt ?? null,
  });

  it('adds up the live expenses that have no paid day', () => {
    const total = unpaidExpensesCentsOf({
      expenses: [
        expense({ amountCents: dh(300), paidDate: null }),
        expense({ amountCents: dh(200), paidDate: null }),
        expense({ amountCents: dh(999), paidDate: '2026-10-01' }),
        expense({ amountCents: dh(888), paidDate: null, voidedAt: '2026-10-02T00:00:00.000Z' }),
      ],
    });
    expect(total).toBe(dh(500));
  });

  it('is nothing when there are none', () => {
    expect(unpaidExpensesCentsOf({ expenses: [] })).toBe(0);
  });
});

describe('the base, category by category', () => {
  function fields(settings: typeof MARKET | typeof COST, includeDoubtful = false) {
    return zakatReportFieldsOf(position(), {
      hawlDate: HAWL,
      hawlCompleted: true,
      settings: { ...settings, includeDoubtfulDebts: includeDoubtful },
      metalPrice: CHEAP_GOLD,
    });
  }

  it('lists the categories in reading order, with the effect each has on the base', () => {
    const report = fields(MARKET);
    const categories = zakatBaseCategoriesOf(report.breakdown, report.settings, dh(250));
    expect(categories.map((category) => [category.key, category.effect])).toEqual([
      ['money', 'added'],
      ['inventory', 'added'],
      ['receivables', 'added'],
      ['doubtful_receivables', 'excluded'],
      ['customer_credits', 'deducted'],
      ['supplier_debts', 'deducted'],
      ['unpaid_bills', 'excluded'],
      ['other_assets', 'not_tracked'],
    ]);
    const cents = Object.fromEntries(categories.map((category) => [category.key, category.cents]));
    expect(cents).toEqual({
      money: dh(5000),
      inventory: dh(30_000),
      receivables: dh(2000),
      doubtful_receivables: dh(400),
      customer_credits: dh(1000),
      supplier_debts: dh(500),
      unpaid_bills: dh(250),
      other_assets: null,
    });
    expect(categories.map((category) => category.count)).toEqual([null, 1, 1, 1, 1, 1, null, null]);
  });

  it('counts the doubtful debts as added when the setting says so', () => {
    const report = fields(MARKET, true);
    const doubtful = zakatBaseCategoriesOf(report.breakdown, report.settings, null).find(
      (category) => category.key === 'doubtful_receivables',
    );
    expect(doubtful?.effect).toBe('added');
  });

  it('a saved report did not keep the bills not paid: it says nothing about them', () => {
    const report = fields(MARKET);
    const bills = zakatBaseCategoriesOf(report.breakdown, report.settings, null).find(
      (category) => category.key === 'unpaid_bills',
    );
    expect(bills).toEqual({ key: 'unpaid_bills', effect: 'excluded', cents: null, count: null });
  });

  it.each([
    ['market', MARKET, false],
    ['market, doubtful counted', MARKET, true],
    ['cost', COST, false],
    ['cost, doubtful counted', COST, true],
  ] as const)(
    'the added and deducted categories rebuild the base core gave (%s)',
    (_, settings, includeDoubtful) => {
      const report = fields(settings, includeDoubtful);
      const by = Object.fromEntries(
        zakatBaseCategoriesOf(report.breakdown, report.settings, null).map((category) => [
          category.key,
          category,
        ]),
      );
      const sum = (...names: string[]) =>
        names.reduce((total, name) => total + (by[name]?.cents ?? 0), 0);
      const added = Object.values(by)
        .filter((category) => category.effect === 'added')
        .reduce((total, category) => total + (category.cents ?? 0), 0);
      expect(added - sum('customer_credits', 'supplier_debts')).toBe(report.baseCents);
    },
  );

  it('a base below zero is still the sum of its parts', () => {
    const heavy = {
      ...position(),
      supplierDebts: [{ supplierId: crypto.randomUUID(), name: 'Mill', amountCents: dh(90_000) }],
    };
    const report = zakatReportFieldsOf(heavy, {
      hawlDate: HAWL,
      hawlCompleted: true,
      settings: MARKET,
      metalPrice: CHEAP_GOLD,
    });
    expect(report.baseCents).toBeLessThan(0);
    const categories = zakatBaseCategoriesOf(report.breakdown, report.settings, null);
    const added = categories
      .filter((category) => category.effect === 'added')
      .reduce((total, category) => total + (category.cents ?? 0), 0);
    const deducted = categories
      .filter((category) => category.effect === 'deducted')
      .reduce((total, category) => total + (category.cents ?? 0), 0);
    expect(added - deducted).toBe(report.baseCents);
  });
});

describe('the nisab, laid out', () => {
  it.each([
    ['gold', { ...MARKET }, { pricePerGramCents: dh(300), date: '2026-10-30' }, 85, dh(25_500)],
    [
      'silver',
      { ...MARKET, nisabMetal: 'silver' as const },
      { pricePerGramCents: dh(10), date: '2026-10-29' },
      595,
      dh(5950),
    ],
  ])(
    '%s: weight, price, threshold, base and the gap',
    (_, settings, metalPrice, grams, threshold) => {
      const report = zakatReportFieldsOf(position(), {
        hawlDate: HAWL,
        hawlCompleted: true,
        settings,
        metalPrice,
      });
      const check = nisabCheckOf(report);
      expect(check).toEqual({
        metal: settings.nisabMetal,
        grams,
        pricePerGramCents: metalPrice.pricePerGramCents,
        priceDate: metalPrice.date,
        thresholdCents: threshold,
        baseCents: report.baseCents,
        reached: true,
        differenceCents: report.baseCents - threshold,
      });
      expect(check.thresholdCents).toBe(grams * metalPrice.pricePerGramCents);
    },
  );

  it('below the nisab: reached is false and the gap is negative; at it: reached, the gap is zero', () => {
    const dear = { pricePerGramCents: dh(1000), date: '2026-10-30' }; // nisab 85 000 dh
    const below = nisabCheckOf(
      zakatReportFieldsOf(position(), {
        hawlDate: HAWL,
        hawlCompleted: true,
        settings: MARKET,
        metalPrice: dear,
      }),
    );
    expect(below.reached).toBe(false);
    expect(below.differenceCents).toBeLessThan(0);

    // A base of 35 500.25 dh, and a price per gram that makes the nisab exactly that: 85 g × 417.65 dh.
    const exactPosition = { ...position(), cashCents: dh(5000) + 25 };
    const exact = nisabCheckOf(
      zakatReportFieldsOf(exactPosition, {
        hawlDate: HAWL,
        hawlCompleted: true,
        settings: MARKET,
        metalPrice: { pricePerGramCents: 41_765, date: '2026-10-30' },
      }),
    );
    expect(exact.baseCents).toBe(3_550_025);
    expect(exact.thresholdCents).toBe(3_550_025);
    expect(exact.differenceCents).toBe(0);
    expect(exact.reached).toBe(true);
  });
});

describe('the headline state', () => {
  const start = '2025-03-01';
  const first = nextHawl(start, start);
  const afterHawl = addDays(first, 12);
  const none: ZakatReviewItem[] = [];
  const blocking: ZakatReviewItem[] = [{ key: 'price_missing', severity: 'blocking' }];
  const attention: ZakatReviewItem[] = [
    { key: 'goods_without_price', severity: 'review', count: 1 },
  ];
  const note: ZakatReviewItem[] = [{ key: 'doubtful_debts', severity: 'info', count: 1 }];

  const status = (
    today: string,
    review: readonly ZakatReviewItem[],
    latest: { paidCents: number } | null,
    reachesNisab: boolean | null,
    from: string | null = start,
  ) => zakatStatusOf({ clock: hawlClockOf(from, today), review, latest, reachesNisab });

  it('not configured: no hawl start, whatever else is known', () => {
    expect(status(TODAY, none, null, true, null)).toBe('not_configured');
    expect(status(TODAY, blocking, null, null, null)).toBe('not_configured');
  });

  it('waiting for the hawl: the start day has not come', () => {
    expect(status(TODAY, none, null, false, '2026-12-01')).toBe('waiting_for_hawl');
  });

  it('hawl in progress: started, the first hawl has not come', () => {
    expect(status(addDays(first, -40), none, null, true)).toBe('hawl_in_progress');
    expect(status(TODAY, note, null, true, '2026-03-01')).toBe('hawl_in_progress');
  });

  it('nisab not reached: a hawl has come and the base is under it', () => {
    expect(status(afterHawl, none, null, false)).toBe('nisab_not_reached');
  });

  it('zakat due: a hawl has come, nothing is saved and the base reaches the nisab', () => {
    expect(status(afterHawl, none, null, true)).toBe('zakat_due');
    expect(status(first, note, null, true)).toBe('zakat_due');
  });

  it('review required: something blocks the calculation, or a figure needs confirming before it is relied on', () => {
    expect(status(afterHawl, blocking, null, null)).toBe('review_required');
    expect(status(afterHawl, attention, null, true)).toBe('review_required');
    expect(status(afterHawl, [...note, ...attention], null, false)).toBe('review_required');
    // Blocking comes before the hawl phases, so a missing price shows early too.
    expect(status(addDays(first, -40), blocking, null, null)).toBe('review_required');
    expect(status(TODAY, blocking, null, null, '2026-12-01')).toBe('review_required');
  });

  it('a hawl still ahead is not "due" however the base looks: only a review item can change that', () => {
    expect(status(addDays(first, -1), none, null, true)).toBe('hawl_in_progress');
    expect(status(addDays(first, -1), attention, null, true)).toBe('hawl_in_progress');
  });

  it('calculation completed: a report is saved for the latest hawl and nothing is paid', () => {
    expect(status(afterHawl, none, { paidCents: 0 }, true)).toBe('calculation_completed');
    // A saved report stands even if something now needs a look: that is for the next calculation.
    expect(status(afterHawl, attention, { paidCents: 0 }, true)).toBe('calculation_completed');
  });

  it('payment recorded: something is paid on the latest hawl’s report', () => {
    expect(status(afterHawl, none, { paidCents: 1 }, true)).toBe('payment_recorded');
  });

  it('a note alone changes nothing', () => {
    expect(status(afterHawl, note, null, true)).toBe('zakat_due');
    expect(status(afterHawl, note, null, false)).toBe('nisab_not_reached');
  });
});
