import type { PartnerView, SplitRuleRow } from '@/local-db';
import { describe, expect, it } from 'vitest';
import {
  canVoidRate,
  draftOf,
  nextMonthStart,
  profitOutlookOf,
  rateStartOptions,
  rateTimings,
  ruleInForce,
  ruleShares,
  rulesLeavingOut,
  shareBp,
  shareIn,
  sharesTotal,
  thisMonthStart,
  upcomingRule,
  weightFrom,
  weightIn,
} from './people-view';

const row = (over: Partial<SplitRuleRow> & { effectiveFrom: string }): SplitRuleRow => ({
  rule: { id: over.effectiveFrom } as SplitRuleRow['rule'],
  ownerWeight: 1,
  partnerWeight: 2,
  shopWeight: 1,
  partnerWeights: [
    { partnerId: 'a', weight: 1 },
    { partnerId: 'b', weight: 1 },
  ],
  future: false,
  ...over,
});

describe('the profit rules as the people screens read them', () => {
  const rows = [
    row({ rule: null, effectiveFrom: '2000-01-01' }),
    row({ effectiveFrom: '2026-06-01' }),
    row({
      effectiveFrom: '2026-12-01',
      future: true,
      partnerWeights: [{ partnerId: 'a', weight: 2 }],
    }),
    row({ effectiveFrom: '2027-03-01', future: true }),
  ];

  it('finds the rule in force and the next one to come', () => {
    expect(ruleInForce(rows)?.effectiveFrom).toBe('2026-06-01');
    expect(upcomingRule(rows)?.effectiveFrom).toBe('2026-12-01');
    expect(upcomingRule(rows.slice(0, 2))).toBeUndefined();
  });

  it('reads one participant’s weight and share, 0 for a partner the rule does not name', () => {
    const rule = rows[1];
    if (!rule) throw new Error('fixture');
    expect(weightIn(rule, { kind: 'owner' })).toBe(1);
    expect(weightIn(rule, { kind: 'shop' })).toBe(1);
    expect(weightIn(rule, { kind: 'partner', partnerId: 'a' })).toBe(1);
    expect(weightIn(rule, { kind: 'partner', partnerId: 'gone' })).toBe(0);
    // 1 + 2 + 1 = 4 weights: the owner holds a quarter.
    expect(shareIn(rule, { kind: 'owner' })).toBe(250);
    expect(shareIn(rule, { kind: 'partner', partnerId: 'a' })).toBe(250);
    expect(shareIn(rule, { kind: 'partner', partnerId: 'gone' })).toBe(0);
  });

  it('lists the later rules that leave a partner out, never the default or earlier ones', () => {
    const left = rulesLeavingOut(rows, 'b', '2026-12-01').map((r) => r.effectiveFrom);
    // The 2026-12-01 rule is the day itself (the new weight lands there), not after it.
    expect(left).toEqual([]);
    expect(rulesLeavingOut(rows, 'b', '2026-07-01').map((r) => r.effectiveFrom)).toEqual([
      '2026-12-01',
    ]);
  });
});

describe('months', () => {
  it('starts a new rule on the first day of next month, across the year end', () => {
    expect(nextMonthStart('2026-11-04')).toBe('2026-12-01');
    expect(nextMonthStart('2026-12-31')).toBe('2027-01-01');
    expect(thisMonthStart('2026-11-04')).toBe('2026-11-01');
  });

  it('marks a salary rate as the one paying now, an upcoming one or an old one', () => {
    const rates = [
      { id: 'old', effectiveFrom: '2026-01-01' },
      { id: 'now', effectiveFrom: '2026-09-01' },
      { id: 'next', effectiveFrom: '2027-01-01' },
    ];
    expect(rateTimings(rates, '2026-11-04')).toEqual(
      new Map([
        ['old', 'past'],
        ['now', 'current'],
        ['next', 'upcoming'],
      ]),
    );
    // A rate that starts this very month is the current one.
    expect(rateTimings([{ id: 'x', effectiveFrom: '2026-11-01' }], '2026-11-30').get('x')).toBe(
      'current',
    );
  });

  it('removes a rate only if it starts this month or later (PY4)', () => {
    expect(canVoidRate({ effectiveFrom: '2026-10-01' }, '2026-11-04')).toBe(false);
    expect(canVoidRate({ effectiveFrom: '2026-11-01' }, '2026-11-04')).toBe(true);
    expect(canVoidRate({ effectiveFrom: '2027-01-01' }, '2026-11-04')).toBe(true);
  });

  it('offers a raise this month through a year ahead, never before the employee started', () => {
    const raise = rateStartOptions({ today: '2026-11-04', startedIn: '2025-01', hasRate: true });
    expect(raise[0]).toBe('2026-11-01');
    expect(raise.at(-1)).toBe('2027-11-01');
    expect(raise).toHaveLength(13);
    // Someone who starts in three months: nothing before that month.
    expect(rateStartOptions({ today: '2026-11-04', startedIn: '2027-02', hasRate: true })[0]).toBe(
      '2027-02-01',
    );
  });

  it('offers a first salary from the start date, two years back at most', () => {
    const recent = rateStartOptions({ today: '2026-11-04', startedIn: '2026-09', hasRate: false });
    expect(recent.slice(0, 3)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    const old = rateStartOptions({ today: '2026-11-04', startedIn: '2015-03', hasRate: false });
    expect(old[0]).toBe('2024-11-01');
    expect(old.at(-1)).toBe('2027-11-01');
  });
});

describe('typed shares and weights', () => {
  it('reads a percentage with up to two decimals, Arabic-Indic digits too', () => {
    expect(shareBp('50')).toBe(5000);
    expect(shareBp('33.33')).toBe(3333);
    expect(shareBp('٢٥')).toBe(2500);
    expect(shareBp('100')).toBe(10_000);
    expect(shareBp('100.01')).toBeNull();
    expect(shareBp('12.345')).toBeNull();
    expect(shareBp('')).toBeNull();
    expect(shareBp('abc')).toBeNull();
  });

  it('adds the ownership shares up and says whether they are exactly 100%', () => {
    expect(sharesTotal(['60', '30', '10'])).toEqual({
      bps: [6000, 3000, 1000],
      totalBp: 10_000,
      exact: true,
    });
    expect(sharesTotal(['60', '30', '0']).exact).toBe(false);
    expect(sharesTotal(['60', '50', '0'])).toMatchObject({ totalBp: 11_000, exact: false });
    // One that is not a number is no share, and the total is not exact even if the rest add up.
    expect(sharesTotal(['100', 'x'])).toMatchObject({ totalBp: 10_000, exact: false });
  });

  it('reads a profit weight as a whole number up to 10000', () => {
    expect(weightFrom('1')).toBe(1);
    expect(weightFrom('4000')).toBe(4000);
    expect(weightFrom('٣')).toBe(3);
    expect(weightFrom('0')).toBe(0);
    expect(weightFrom('10001')).toBeNull();
    expect(weightFrom('1.5')).toBeNull();
    expect(weightFrom('')).toBeNull();
  });
});

describe('what a rule comes to', () => {
  const labels = {
    owner: 'Owner',
    shop: 'Shop',
    partner: (id: string) => `Partner ${id}`,
  };

  it('shows each participant’s share of the profit, the shop last', () => {
    const shares = ruleShares(
      {
        ownerWeight: 2,
        shopWeight: 2,
        partnerWeights: [
          { partnerId: 'a', weight: 3 },
          { partnerId: 'b', weight: 1 },
        ],
      },
      labels,
    );
    expect(shares.map((s) => [s.label, s.weight, s.permille])).toEqual([
      ['Owner', 2, 250],
      ['Partner a', 3, 375],
      ['Partner b', 1, 125],
      ['Shop', 2, 250],
    ]);
  });

  it('shows 0% for everyone when every weight is 0', () => {
    const shares = ruleShares({ ownerWeight: 0, shopWeight: 0, partnerWeights: [] }, labels);
    expect(shares.map((s) => s.permille)).toEqual([0, 0]);
  });
});

describe('what a person gets of the profit, now and next', () => {
  const rows = [
    row({ rule: null, effectiveFrom: '2000-01-01' }),
    row({ effectiveFrom: '2026-06-01' }),
    row({
      effectiveFrom: '2026-12-01',
      future: true,
      ownerWeight: 1,
      shopWeight: 1,
      partnerWeight: 2,
      partnerWeights: [
        { partnerId: 'a', weight: 2 },
        { partnerId: 'b', weight: 0 },
      ],
    }),
  ];

  it('gives the share in force and the next one when a rule is coming that changes it', () => {
    expect(profitOutlookOf(rows, { kind: 'partner', partnerId: 'a' })).toEqual({
      nowPermille: 250,
      next: { permille: 500, from: '2026-12-01' },
    });
    // b leaves the split from December: 25% now, 0% next.
    expect(profitOutlookOf(rows, { kind: 'partner', partnerId: 'b' })).toEqual({
      nowPermille: 250,
      next: { permille: 0, from: '2026-12-01' },
    });
  });

  it('shows no next share when the coming rule changes nothing for them', () => {
    const same = [rows[0], rows[1], row({ effectiveFrom: '2027-01-01', future: true })].flatMap(
      (r) => (r ? [r] : []),
    );
    expect(profitOutlookOf(same, { kind: 'owner' })).toEqual({ nowPermille: 250, next: null });
  });

  it('gives 0 for a partner the rule in force does not name, and nothing without rules', () => {
    expect(profitOutlookOf(rows, { kind: 'partner', partnerId: 'new' }).nowPermille).toBe(0);
    expect(profitOutlookOf([], { kind: 'owner' })).toEqual({ nowPermille: 0, next: null });
  });
});

describe('a partner as the table of participants takes them', () => {
  // Only the fields the draft reads; the account and status play no part.
  const view = {
    partner: {
      id: 'p1',
      name: 'Sara',
      ownershipBp: 2500,
      isOwner: false,
      phone: '0600000000',
      title: 'Manager',
      startDate: '2026-01-01',
      notes: 'Silent partner',
    },
    account: {},
    status: 'active',
  } as unknown as PartnerView;

  it('carries the whole record, so saving it blanks nothing', () => {
    expect(draftOf(view)).toEqual({
      id: 'p1',
      name: 'Sara',
      ownershipBp: 2500,
      isOwner: false,
      phone: '0600000000',
      title: 'Manager',
      startDate: '2026-01-01',
      notes: 'Silent partner',
    });
  });

  it('puts the change on top and leaves the rest', () => {
    expect(draftOf(view, { ownershipBp: 0, title: null })).toMatchObject({
      id: 'p1',
      name: 'Sara',
      ownershipBp: 0,
      title: null,
      phone: '0600000000',
    });
  });
});
