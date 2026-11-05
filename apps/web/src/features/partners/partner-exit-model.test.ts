import { describe, expect, it } from 'vitest';
import type { PartnerAccount } from '@fabric/core';
import type { PartnerExitPlan } from '@/local-db';
import {
  canReview,
  departureIssue,
  type ExitChoices,
  factsOf,
  firstNeeding,
  firstPeriodWithoutThem,
  inputOf,
  noChoices,
  ownershipAfter,
  ownershipSharesOf,
  payOf,
  profitSharesOf,
  reviewOf,
  sectionStates,
  splitAfter,
  splitBefore,
  transferOf,
} from './partner-exit-model';

const stamp = '2026-01-01T00:00:00.000Z';
const base = {
  phone: null,
  title: null,
  startDate: null,
  notes: null,
  exitedOn: null,
  exitNote: null,
  createdAt: stamp,
  updatedAt: stamp,
  deviceId: 'd',
  voidedAt: null,
  serverSeq: 1,
};
const person = (id: string, ownershipBp: number, isOwner: boolean, createdAt = stamp) => ({
  ...base,
  id,
  name: id,
  ownershipBp,
  isOwner,
  createdAt,
});
const OWNER = person('owner', 5000, true);
const ANA = person('ana', 3000, false, '2026-01-02T00:00:00.000Z');
const BILAL = person('bilal', 2000, false, '2026-01-03T00:00:00.000Z');

const account = (over: Partial<PartnerAccount> = {}): PartnerAccount => ({
  capitalCents: 0,
  contributionsCents: 0,
  retainedProfitCents: 0,
  withdrawalsCents: 0,
  sharesCents: 0,
  drawsCents: 0,
  undrawnCents: 0,
  ...over,
});

/** Ana, the shop's first partner, leaves a shop of three people on 12 October 2026. */
const planOf = (over: Partial<PartnerExitPlan> = {}): PartnerExitPlan => ({
  partner: ANA,
  today: '2026-10-12',
  account: account(),
  cashCents: 0,
  partners: [OWNER, ANA, BILAL],
  rules: [],
  lockedThrough: '2026-09-30',
  removal: [],
  ...over,
});

const labels = {
  owner: 'Owner',
  shop: 'Shop',
  partner: (id: string) => id,
};

describe('what the account and the rules say about the day they leave', () => {
  it('the profit rules start the day they leave, or tomorrow when that day has passed', () => {
    expect(factsOf(planOf(), '2026-10-12').ruleFrom).toBe('2026-10-13');
    expect(factsOf(planOf(), '2026-12-01').ruleFrom).toBe('2026-12-01');
    expect(factsOf(planOf(), '2026-08-01').ruleFrom).toBe('2026-10-13');
  });

  it('carries the balances as the account has them', () => {
    const facts = factsOf(
      planOf({
        account: account({
          capitalCents: 300_000,
          contributionsCents: 500_000,
          withdrawalsCents: 200_000,
          sharesCents: 100_000,
          drawsCents: 60_000,
          undrawnCents: 40_000,
        }),
      }),
      '2026-10-12',
    );
    expect(facts.ownershipBp).toBe(3000);
    expect(facts.profit).toEqual({
      allocatedCents: 100_000,
      drawnCents: 60_000,
      undrawnCents: 40_000,
    });
    expect(facts.capital).toMatchObject({
      contributionsCents: 500_000,
      withdrawnCents: 200_000,
      balanceCents: 300_000,
    });
  });

  it('the first partner holds the rules that name no one; another partner does not', () => {
    expect(factsOf(planOf(), '2026-10-12').sharesProfit).toBe(true);
    expect(factsOf(planOf({ partner: BILAL }), '2026-10-12').sharesProfit).toBe(false);
  });

  it('months that start before the new rules are still shared with them until they are settled', () => {
    // October started on the 1st and is not settled: its profit is split with the rule of 1 October.
    expect(factsOf(planOf(), '2026-10-12').stillShared).toBe(true);
    // Bilal has no share in any month.
    expect(factsOf(planOf({ partner: BILAL }), '2026-10-12').stillShared).toBe(false);
  });
});

describe('how each part of the exit stands', () => {
  const facts = (over: Partial<PartnerExitPlan> = {}) => factsOf(planOf(over), '2026-10-12');
  const money = account({
    capitalCents: 300_000,
    contributionsCents: 500_000,
    withdrawalsCents: 200_000,
    sharesCents: 100_000,
    drawsCents: 60_000,
    undrawnCents: 40_000,
  });

  it('a partner who took part in nothing has only the ownership and the profit to hand over', () => {
    const states = sectionStates(facts(), noChoices());
    expect(states).toEqual({ profit: 'na', capital: 'na', transfer: 'needs', other: 'ready' });
  });

  it('what is owed needs a decision; paying part, or leaving it, is ready', () => {
    const f = facts({ account: money });
    expect(sectionStates(f, noChoices()).profit).toBe('needs');
    expect(sectionStates(f, noChoices()).capital).toBe('needs');
    const paying: ExitChoices = {
      ...noChoices(),
      profit: { mode: 'pay', cents: 10_000, date: '2026-10-12' },
      capital: { mode: 'later' },
    };
    expect(sectionStates(f, paying)).toMatchObject({ profit: 'ready', capital: 'ready' });
    // More than is owed, or nothing, is not a decision.
    for (const cents of [40_001, 0, null]) {
      expect(
        sectionStates(f, { ...noChoices(), profit: { mode: 'pay', cents, date: '2026-10-12' } })
          .profit,
      ).toBe('needs');
    }
  });

  it('nothing owed completes by itself: fully drawn profit and a settled capital', () => {
    const settled = account({
      capitalCents: 0,
      contributionsCents: 500_000,
      withdrawalsCents: 500_000,
      sharesCents: 100_000,
      drawsCents: 100_000,
    });
    expect(sectionStates(facts({ account: settled }), noChoices())).toMatchObject({
      profit: 'done',
      capital: 'done',
    });
  });

  it('having drawn ahead is told, not a blocker; neither is nothing to say', () => {
    const ahead = account({ sharesCents: 10_000, drawsCents: 30_000, undrawnCents: -20_000 });
    expect(sectionStates(facts({ account: ahead }), noChoices())).toMatchObject({
      profit: 'done',
      other: 'ready',
    });
    expect(sectionStates(facts({ partner: BILAL, account: account() }), noChoices()).other).toBe(
      'na',
    );
  });

  it('the hand-over is ready once the ownership and the profit are each given to someone', () => {
    const f = facts();
    const one: ExitChoices = {
      ...noChoices(),
      ownership: { mode: 'one', to: 'partner:bilal' },
    };
    expect(sectionStates(f, one).transfer).toBe('needs');
    const both: ExitChoices = { ...one, profitShare: { mode: 'one', to: 'partner:bilal' } };
    expect(sectionStates(f, both).transfer).toBe('ready');
    expect(sectionStates(f, { ...one, profitShare: { mode: 'spread' } }).transfer).toBe('ready');
    // A partner who owns nothing and shares no profit has nothing to hand over.
    const nothing = factsOf(planOf({ partner: { ...BILAL, ownershipBp: 0 } }), '2026-10-12');
    expect(sectionStates(nothing, noChoices()).transfer).toBe('done');
  });

  it('the exit can be reviewed only when nothing needs a decision', () => {
    const f = facts({ account: money });
    expect(canReview(sectionStates(f, noChoices()))).toBe(false);
    expect(firstNeeding(sectionStates(f, noChoices()))).toBe('profit');
    const decided: ExitChoices = {
      profit: { mode: 'later' },
      capital: { mode: 'later' },
      ownership: { mode: 'one', to: 'owner' },
      profitShare: { mode: 'spread' },
    };
    expect(canReview(sectionStates(f, decided))).toBe(true);
    expect(firstNeeding(sectionStates(f, decided))).toBeNull();
  });
});

describe('payments and hand-overs', () => {
  it('a payment is a whole positive amount no more than is owed', () => {
    expect(payOf({ mode: 'unset' }, 100)).toEqual({ cents: 0, chosen: false });
    expect(payOf({ mode: 'later' }, 100)).toEqual({ cents: 0, chosen: true });
    expect(payOf({ mode: 'pay', cents: 100, date: 'd' }, 100)).toEqual({
      cents: 100,
      chosen: true,
    });
    expect(payOf({ mode: 'pay', cents: 101, date: 'd' }, 100).chosen).toBe(false);
    expect(payOf({ mode: 'pay', cents: 0, date: 'd' }, 100).chosen).toBe(false);
    expect(payOf({ mode: 'pay', cents: 0.5, date: 'd' }, 100).chosen).toBe(false);
  });

  it('one person takes all of it; several must add up to all of it, each named once', () => {
    expect(transferOf({ mode: 'one', to: 'owner' }, 3000)).toEqual({
      parts: [{ to: 'owner', bp: 3000 }],
      leftBp: 0,
      chosen: true,
    });
    expect(transferOf({ mode: 'one', to: '' }, 3000).chosen).toBe(false);
    const several = (rows: { to: 'owner' | 'shop' | 'partner:bilal' | ''; text: string }[]) =>
      transferOf({ mode: 'several', rows }, 3000);
    expect(
      several([
        { to: 'owner', text: '10' },
        { to: 'partner:bilal', text: '20' },
      ]),
    ).toMatchObject({ leftBp: 0, chosen: true });
    // 25% of the shop is 5% short; the screen shows what is left to hand over.
    expect(
      several([
        { to: 'owner', text: '10' },
        { to: 'partner:bilal', text: '15' },
      ]),
    ).toMatchObject({ leftBp: 500, chosen: false });
    expect(
      several([
        { to: 'owner', text: '10' },
        { to: 'owner', text: '20' },
      ]).chosen,
    ).toBe(false);
    expect(several([{ to: 'owner', text: 'x' }]).chosen).toBe(false);
    expect(several([]).chosen).toBe(false);
  });

  it('turns the hand-over into what the device takes: the owner by their id, the profit in parts of their share', () => {
    const plan = planOf();
    expect(ownershipSharesOf({ mode: 'one', to: 'owner' }, plan)).toEqual([
      { partnerId: 'owner', bp: 3000 },
    ]);
    expect(
      ownershipSharesOf(
        {
          mode: 'several',
          rows: [
            { to: 'owner', text: '10' },
            { to: 'partner:bilal', text: '20' },
          ],
        },
        plan,
      ),
    ).toEqual([
      { partnerId: 'owner', bp: 1000 },
      { partnerId: 'bilal', bp: 2000 },
    ]);
    expect(profitSharesOf({ mode: 'one', to: 'shop' })).toEqual([
      { to: { kind: 'shop' }, bp: 10_000 },
    ]);
    expect(
      profitSharesOf({
        mode: 'several',
        rows: [
          { to: 'owner', text: '25' },
          { to: 'partner:bilal', text: '75' },
        ],
      }),
    ).toEqual([
      { to: { kind: 'owner' }, bp: 2500 },
      { to: { kind: 'partner', partnerId: 'bilal' }, bp: 7500 },
    ]);
    expect(profitSharesOf({ mode: 'spread' })).toEqual([]);
  });
});

describe('what the owner sees before confirming', () => {
  const facts = factsOf(planOf(), '2026-10-12');

  it('the split from the new day, with their part given to one person', () => {
    const before = splitBefore(planOf(), facts, labels);
    expect(before?.map((share) => [share.key, share.permille])).toEqual([
      ['owner', 333],
      ['partner:ana', 333],
      ['shop', 333],
    ]);
    const after = splitAfter(
      planOf(),
      facts,
      [{ to: { kind: 'partner', partnerId: 'bilal' }, bp: 10_000 }],
      labels,
    );
    const bilal = after?.find((share) => share.key === 'partner:bilal');
    expect(bilal?.permille).toBe(333);
    expect(after?.find((share) => share.key === 'partner:ana')?.permille ?? 0).toBe(0);
    expect(after?.reduce((sum, share) => sum + share.weight, 0)).toBeGreaterThan(0);
  });

  it('no one in particular leaves their part to the others in proportion', () => {
    const after = splitAfter(planOf(), facts, [], labels);
    expect(after?.find((share) => share.key === 'partner:ana')?.permille ?? 0).toBe(0);
    const total = (after ?? []).reduce((sum, share) => sum + share.permille, 0);
    // Rounded to thousandths: the shares come to the whole.
    expect(total).toBeGreaterThanOrEqual(999);
    expect(total).toBeLessThanOrEqual(1001);
  });

  it('a share that starts in a later rule is previewed from that rule, not from the day they leave', () => {
    // Bilal has no part of the profit today; a rule from 1 December gives him a third.
    const later = {
      ...base,
      id: 'rule-dec',
      effectiveFrom: '2026-12-01',
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: [{ partnerId: 'bilal', weight: 1 }],
    };
    const plan = planOf({ partner: BILAL, rules: [later], lockedThrough: '2026-09-30' });
    const facts = factsOf(plan, '2026-10-12');
    expect(facts.sharesProfit).toBe(true);
    expect(facts.shareFrom).toBe('2026-12-01');
    const before = splitBefore(plan, facts, labels);
    expect(before?.find((share) => share.key === 'partner:bilal')?.weight).toBe(1);
    const after = splitAfter(plan, facts, [], labels);
    expect(after?.find((share) => share.key === 'partner:bilal')?.permille ?? 0).toBe(0);
    // A partner with a share in force on the day they leave is previewed from that day.
    expect(factsOf(planOf(), '2026-10-12').shareFrom).toBe('2026-10-13');
  });

  it('no split is shown for a partner no rule gives a share', () => {
    const plan = planOf({ partner: BILAL });
    const none = factsOf(plan, '2026-10-12');
    expect(splitAfter(plan, none, [], labels)).toBeNull();
  });

  it('ownership after the hand-over lists everyone who holds a part, without the leaver', () => {
    const after = ownershipAfter(
      planOf(),
      [
        { partnerId: 'owner', bp: 1000 },
        { partnerId: 'bilal', bp: 2000 },
      ],
      (id) => id,
    );
    expect(after.map((share) => [share.key, share.weight])).toEqual([
      ['owner', 6000],
      ['bilal', 4000],
    ]);
  });

  it('the first period shared without them is the first that starts on or after the new day', () => {
    expect(firstPeriodWithoutThem('2026-10-13')).toBe('2026-11');
    expect(firstPeriodWithoutThem('2026-12-01')).toBe('2026-12');
    expect(firstPeriodWithoutThem('2026-12-31')).toBe('2027-01');
  });

  it('a day before they joined, or no day, is not a day to leave on', () => {
    expect(departureIssue('2026-10-12', null)).toBeNull();
    expect(departureIssue('2026-10-12', '2026-10-13')).toBe('before_start');
    expect(departureIssue('', null)).toBe('empty');
  });

  it('what is paid and what stays owed, in total and for each', () => {
    const f = factsOf(
      planOf({
        account: account({
          capitalCents: 300_000,
          sharesCents: 100_000,
          drawsCents: 60_000,
          undrawnCents: 40_000,
        }),
      }),
      '2026-10-12',
    );
    const review = reviewOf(f, {
      ...noChoices(),
      profit: { mode: 'pay', cents: 40_000, date: '2026-10-12' },
      capital: { mode: 'pay', cents: 100_000, date: '2026-10-12' },
    });
    expect(review.profit).toEqual({ openingCents: 40_000, paidCents: 40_000, remainingCents: 0 });
    expect(review.capital).toEqual({
      openingCents: 300_000,
      paidCents: 100_000,
      remainingCents: 200_000,
    });
    expect(review.paidCents).toBe(140_000);
    expect(review.remainingCents).toBe(200_000);
    expect(review.firstPeriodWithoutThem).toBe('2026-11');
  });
});

describe('what is sent when the owner confirms', () => {
  const money = account({
    capitalCents: 300_000,
    contributionsCents: 500_000,
    withdrawalsCents: 200_000,
    sharesCents: 100_000,
    drawsCents: 60_000,
    undrawnCents: 40_000,
  });
  const plan = planOf({ account: money });
  const facts = factsOf(plan, '2026-10-12');
  const details = { note: '  الباقي في ديسمبر ', profitReason: 'ربح', capitalNote: 'رأس مال' };
  const decided: ExitChoices = {
    profit: { mode: 'pay', cents: 25_000, date: '2026-10-14' },
    capital: { mode: 'later' },
    ownership: { mode: 'one', to: 'partner:bilal' },
    profitShare: { mode: 'one', to: 'partner:bilal' },
  };

  it('nothing is sent until every part is decided', () => {
    expect(inputOf(plan, facts, noChoices(), details)).toBeNull();
  });

  it('carries the balances shown, the payments with their dates, the hand-over and the trimmed note', () => {
    expect(inputOf(plan, facts, decided, details)).toEqual({
      partnerId: 'ana',
      exitedOn: '2026-10-12',
      note: 'الباقي في ديسمبر',
      profit: { payCents: 25_000, expectedUndrawnCents: 40_000, date: '2026-10-14', reason: 'ربح' },
      capital: {
        repayCents: 0,
        expectedCapitalCents: 300_000,
        date: '2026-10-12',
        note: 'رأس مال',
      },
      ownership: [{ partnerId: 'bilal', bp: 3000 }],
      profitShares: [{ to: { kind: 'partner', partnerId: 'bilal' }, bp: 10_000 }],
    });
  });

  it('an empty note is none; a partner with nothing to hand over sends no hand-over', () => {
    const bare = planOf({ partner: { ...BILAL, ownershipBp: 0 } });
    const input = inputOf(bare, factsOf(bare, '2026-10-12'), noChoices(), {
      ...details,
      note: ' ',
    });
    expect(input).toMatchObject({ note: null, ownership: [], profitShares: [] });
  });
});
