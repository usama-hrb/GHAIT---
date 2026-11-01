import { describe, expect, it } from 'vitest';
import {
  addDays,
  checkZakatReport,
  daysBetween,
  hijriOf,
  isHawl,
  lastHawl,
  nextHawl,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatPaidCents,
  zakatPaymentShares,
  zakatPositionOf,
  zakatReportFieldsOf,
} from './index.js';
import { base, dh, OWNER, PARTNER, Shop } from './test-shop.js';

const GOLD = { pricePerGramCents: dh(1000), date: '2026-10-30' }; // nisab 85 000 dh… too high for T14
const CHEAP_GOLD = { pricePerGramCents: dh(300), date: '2026-10-30' }; // nisab 25 500 dh
const SILVER = { pricePerGramCents: dh(10), date: '2026-10-30' }; // nisab 5 950 dh
const MARKET = {
  nisabMetal: 'gold',
  goodsValuation: 'market',
  includeDoubtfulDebts: false,
} as const;

/** T14's position: stock at market 30 000 dh (cost 24 000), cash 5 000, expected debts 2 000, debts due 1 000. */
const t14 = {
  goods: [
    {
      rollId: crypto.randomUUID(),
      label: 'R-A0001 · روزا · أحمر',
      remainingCm: 100_000,
      refPricePerMeterCents: dh(30),
      costCents: dh(24_000),
      valueCents: 0,
    },
  ],
  cashCents: dh(5000),
  receivables: [
    { customerId: crypto.randomUUID(), name: 'فاطمة', amountCents: dh(2000), doubtful: false },
    { customerId: crypto.randomUUID(), name: 'عمر', amountCents: dh(400), doubtful: true },
  ],
  debts: [{ customerId: crypto.randomUUID(), name: 'أمينة', amountCents: dh(1000) }],
  supplierDebts: [],
};

function report(fields: ReturnType<typeof zakatReportFieldsOf>): ZakatReport {
  return { ...base('2026-10-31'), id: crypto.randomUUID(), ...fields };
}

describe('the zakat report (SPEC §10, BUILD_PROMPTS 5.1)', () => {
  it('T14: 30 000 + 5 000 + 2 000 − 1 000 = 36 000 dh × 2.5% = 900 dh, every item listed', () => {
    const fields = zakatReportFieldsOf(t14, {
      hawlDate: '2026-10-31',
      hawlCompleted: true,
      settings: MARKET,
      metalPrice: CHEAP_GOLD,
    });
    expect(fields).toMatchObject({
      nisabCents: dh(25_500),
      baseCents: dh(36_000),
      zakatDueCents: dh(900),
      breakdown: {
        goodsCents: dh(30_000),
        cashCents: dh(5000),
        receivablesCents: dh(2000),
        doubtfulReceivablesCents: dh(400),
        debtsDueCents: dh(1000),
        reachesNisab: true,
      },
    });
    expect(fields.breakdown.goods[0]?.valueCents).toBe(dh(30_000));
    expect(checkZakatReport(report(fields))).toEqual([]);
  });

  it.each([
    ['goods at cost', { ...MARKET, goodsValuation: 'cost' }, CHEAP_GOLD, true, dh(30_000), dh(750)],
    [
      'doubtful debts counted',
      { ...MARKET, includeDoubtfulDebts: true },
      CHEAP_GOLD,
      true,
      dh(36_400),
      dh(910),
    ],
    ['the silver nisab', { ...MARKET, nisabMetal: 'silver' }, SILVER, true, dh(36_000), dh(900)],
    ['under the nisab', MARKET, GOLD, true, dh(36_000), 0],
    ['before the hawl', MARKET, CHEAP_GOLD, false, dh(36_000), 0],
  ] as const)(
    'settings: %s',
    (_, settings, metalPrice, hawlCompleted, baseCents, zakatDueCents) => {
      const fields = zakatReportFieldsOf(t14, {
        hawlDate: '2026-10-31',
        hawlCompleted,
        settings,
        metalPrice,
      });
      expect([fields.baseCents, fields.zakatDueCents]).toEqual([baseCents, zakatDueCents]);
      expect(fields.settings).toEqual(settings);
    },
  );

  it('what the shop owes suppliers comes off the base with the money held for customers (SP4)', () => {
    const withSupplier = {
      ...t14,
      supplierDebts: [{ supplierId: crypto.randomUUID(), name: 'مورد', amountCents: dh(1000) }],
    };
    const fields = zakatReportFieldsOf(withSupplier, {
      hawlDate: '2026-10-31',
      hawlCompleted: true,
      settings: MARKET,
      metalPrice: CHEAP_GOLD,
    });
    // 36 000 − 1 000 more = 35 000 dh × 2.5% = 875 dh.
    expect(fields.breakdown.debtsDueCents).toBe(dh(2000));
    expect([fields.baseCents, fields.zakatDueCents]).toEqual([dh(35_000), dh(875)]);
    expect(checkZakatReport(report(fields))).toEqual([]);
  });

  it('a report whose figures do not match its items is refused', () => {
    const fields = zakatReportFieldsOf(t14, {
      hawlDate: '2026-10-31',
      hawlCompleted: true,
      settings: MARKET,
      metalPrice: CHEAP_GOLD,
    });
    expect(checkZakatReport(report({ ...fields, zakatDueCents: dh(800) }))).toEqual([
      expect.objectContaining({ message: ZAKAT_ISSUES.inconsistent }),
    ]);
  });

  it('the position from the records: stock left, money, what customers owe and are owed', () => {
    const shop = new Shop();
    shop.contribute(OWNER, dh(1000));
    const roll = shop.roll(dh(800), 5000);
    shop.sale(roll, '2026-09-05', 1000, dh(200), 0); // owed, then written off
    const owed = shop.sale(roll, '2026-09-06', 1000, dh(200), dh(50)); // 150 still owed
    shop.records.writeOffs.push({
      ...base('2026-09-07'),
      id: crypto.randomUUID(),
      saleId: shop.records.sales[0]?.id ?? '',
      date: '2026-09-07',
      reason: 'لن يدفع',
    });
    const overpaid = shop.sale(roll, '2026-09-08', 500, dh(100), 0);
    shop.pay(overpaid, '2026-09-09', dh(130), dh(100)); // 30 held for the customer
    const position = zakatPositionOf({
      ...shop.records,
      fabrics: [],
      variants: [],
      customers: [],
      suppliers: [],
    });
    expect(position.goods).toEqual([
      expect.objectContaining({ rollId: roll.id, remainingCm: 2500, costCents: dh(400) }),
    ]);
    expect(position.receivables).toEqual([
      expect.objectContaining({
        customerId: shop.records.sales[0]?.customerId,
        amountCents: dh(200),
        doubtful: true,
      }),
      expect.objectContaining({
        customerId: owed.customerId,
        amountCents: dh(150),
        doubtful: false,
      }),
    ]);
    expect(position.debts).toEqual([
      expect.objectContaining({ customerId: overpaid.customerId, amountCents: dh(30) }),
    ]);
    expect(position.cashCents).toBe(dh(1000) - dh(800) + dh(50) + dh(130));
  });

  it('paying it: one draw per partner by ownership, the odd cent to the owner', () => {
    const shop = new Shop();
    expect(zakatPaymentShares(90_001, shop.records.partners)).toEqual([
      { partnerId: OWNER, amountCents: 45_001 },
      { partnerId: PARTNER, amountCents: 45_000 },
    ]);
    const reportId = crypto.randomUUID();
    const draw = (amountCents: number, voidedAt: string | null = null) => ({
      ...base('2026-11-01'),
      voidedAt,
      id: crypto.randomUUID(),
      partnerId: OWNER,
      amountCents,
      date: '2026-11-01',
      reason: 'زكاة',
      zakatReportId: reportId,
    });
    expect(
      zakatPaidCents(reportId, [draw(100), draw(50), draw(7, '2026-11-02T00:00:00.000Z')]),
    ).toBe(150);
  });
});

describe('the hawl on the Hijri calendar (SPEC §10)', () => {
  it('Hijri dates from Intl (Umm al-Qura)', () => {
    expect(hijriOf('2026-10-31')).toEqual({ year: 1448, month: 5, day: 20 });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('a hawl falls on the start’s Hijri day each Hijri year: 354 or 355 days later', () => {
    const start = '2025-03-01';
    const first = nextHawl(start, start);
    expect([354, 355]).toContain(daysBetween(start, first));
    const [a, b] = [hijriOf(start), hijriOf(first)];
    expect([b.year, b.month, b.day]).toEqual([a.year + 1, a.month, a.day]);
    expect(isHawl(start, first)).toBe(true);
    expect(isHawl(start, addDays(first, 1))).toBe(false);
    expect(lastHawl(start, addDays(first, -1))).toBeNull();
    expect(lastHawl(start, addDays(first, 30))).toBe(first);
    expect(nextHawl(start, first)).toBe(nextHawl(start, addDays(first, 1)));
    // A start in the future: its first hawl is a Hijri year after it.
    expect(daysBetween('2030-01-01', nextHawl('2030-01-01', '2026-10-31'))).toBeLessThan(356);
  });

  it('a start on the 30th falls on the 29th in a month without a 30th', () => {
    let start = '2025-01-01';
    while (hijriOf(start).day !== 30) start = addDays(start, 1);
    const hawls: string[] = [];
    let from = start;
    for (let year = 0; year < 4; year++) {
      from = nextHawl(start, from);
      hawls.push(from);
    }
    for (const hawl of hawls) {
      const day = hijriOf(hawl);
      expect(day.month).toBe(hijriOf(start).month);
      expect([29, 30]).toContain(day.day);
    }
  });
});
