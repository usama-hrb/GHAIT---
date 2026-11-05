import { splitNetProfit } from '@fabric/core';
import { describe, expect, it } from 'vitest';
import {
  checkExitShares,
  checkOwnershipTransfer,
  checkPartnerExit,
  exitRuleChanges,
  exitRuleDate,
  partnerStandingOf,
  sharesUnsettledProfit,
} from './partner-exit.js';
import { checkPartnerWrite, type Partner, PARTNER_ISSUES } from './partners.js';
import { checkSplitRule, SETTLEMENT_ISSUES, type SplitRule } from './settlements.js';
import { base, NO_CONTACT } from './test-shop.js';

const OWNER = crypto.randomUUID();
const LEAVER = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const TODAY = '2026-11-05';

const partner = (id: string, createdOn: string, ownershipBp: number, isOwner = false): Partner => ({
  ...base(createdOn),
  ...NO_CONTACT,
  id,
  name: id.slice(0, 4),
  ownershipBp,
  isOwner,
});

const rule = (
  effectiveFrom: string,
  ownerWeight: number,
  named: { partnerId: string; weight: number }[] | null,
  shopWeight: number,
  partnerWeight = (named ?? []).reduce((sum, { weight }) => sum + weight, 0),
): SplitRule => ({
  ...base('2026-10-01'),
  id: crypto.randomUUID(),
  effectiveFrom,
  ownerWeight,
  partnerWeight,
  shopWeight,
  partnerWeights: named,
});

/** The owner, the first partner (who leaves) and a partner who joined later. */
const people = [
  partner(OWNER, '2026-01-01', 5000, true),
  partner(LEAVER, '2026-01-02', 0),
  partner(OTHER, '2026-06-01', 5000),
];

const weights = (change: { rule: { partnerWeights: { partnerId: string; weight: number }[] } }) =>
  Object.fromEntries(
    change.rule.partnerWeights.map(({ partnerId, weight }) => [partnerId, weight]),
  );

describe('standing and the exit rule date (S20)', () => {
  it('a partner is active until the day they leave, then a former partner', () => {
    expect(partnerStandingOf({ exitedOn: null }, TODAY)).toBe('active');
    expect(partnerStandingOf({}, TODAY)).toBe('active');
    expect(partnerStandingOf({ exitedOn: '2026-11-06' }, TODAY)).toBe('leaving');
    expect(partnerStandingOf({ exitedOn: TODAY }, TODAY)).toBe('former');
    expect(partnerStandingOf({ exitedOn: '2026-10-01' }, TODAY)).toBe('former');
  });

  it('the rules start on the day they leave, or tomorrow when that has passed', () => {
    expect(exitRuleDate('2026-12-31', TODAY)).toBe('2026-12-31');
    expect(exitRuleDate('2026-11-06', TODAY)).toBe('2026-11-06');
    expect(exitRuleDate(TODAY, TODAY)).toBe('2026-11-06');
    expect(exitRuleDate('2026-01-01', TODAY)).toBe('2026-11-06');
  });
});

describe('checkPartnerExit', () => {
  const leaver = { id: LEAVER, isOwner: false, ownershipBp: 0, startDate: null, exitedOn: TODAY };
  const named = rule('2026-11-06', 1, [{ partnerId: OTHER, weight: 1 }], 1);
  const context = { today: TODAY, partners: people, rules: [named] };

  it('lets a partner go who owns nothing and whom no rule gives a share', () => {
    expect(checkPartnerExit(leaver, undefined, context)).toEqual([]);
  });

  it('refuses the owner, a second exit, and a day before they joined', () => {
    expect(checkPartnerExit({ ...leaver, isOwner: true }, undefined, context)).toMatchObject([
      { message: PARTNER_ISSUES.exitOwner },
    ]);
    expect(checkPartnerExit(leaver, { exitedOn: '2026-10-01' }, context)).toMatchObject([
      { message: PARTNER_ISSUES.alreadyExited },
    ]);
    expect(
      checkPartnerExit({ ...leaver, startDate: '2026-12-01' }, undefined, context),
    ).toMatchObject([{ message: PARTNER_ISSUES.exitBeforeStart }]);
  });

  it('refuses a partner who still owns part of the shop', () => {
    expect(checkPartnerExit({ ...leaver, ownershipBp: 1000 }, undefined, context)).toMatchObject([
      { message: PARTNER_ISSUES.hasOwnership },
    ]);
  });

  it('refuses while the rule in force from that day, or a later one, gives them a share', () => {
    const giving = [rule('2026-11-06', 1, [{ partnerId: LEAVER, weight: 1 }], 1)];
    expect(checkPartnerExit(leaver, undefined, { ...context, rules: giving })).toMatchObject([
      { message: PARTNER_ISSUES.exitProfitShare },
    ]);
    // The default rule, which belongs to the first partner, counts as a share too.
    expect(checkPartnerExit(leaver, undefined, { ...context, rules: [] })).toMatchObject([
      { message: PARTNER_ISSUES.exitProfitShare },
    ]);
    const later = [named, rule('2027-01-01', 1, [{ partnerId: LEAVER, weight: 1 }], 1)];
    expect(checkPartnerExit(leaver, undefined, { ...context, rules: later })).toMatchObject([
      { message: PARTNER_ISSUES.exitProfitShare },
    ]);
  });

  it('a share in a period that has already started does not stop an exit that day (S15)', () => {
    const past = [rule('2026-10-01', 1, [{ partnerId: LEAVER, weight: 1 }], 1), named];
    expect(checkPartnerExit(leaver, undefined, { ...context, rules: past })).toEqual([]);
  });

  it('a partner with a zero weight in a rule is not given a share', () => {
    const zero = [
      rule(
        '2026-11-06',
        1,
        [
          { partnerId: LEAVER, weight: 0 },
          { partnerId: OTHER, weight: 1 },
        ],
        1,
      ),
    ];
    expect(checkPartnerExit(leaver, undefined, { ...context, rules: zero })).toEqual([]);
  });
});

describe('checkOwnershipTransfer and checkExitShares', () => {
  const leaver = { id: LEAVER, ownershipBp: 2000 };

  it('hands over all of the ownership to the owner or partners who stay', () => {
    expect(checkOwnershipTransfer(leaver, [{ partnerId: OWNER, bp: 2000 }], people)).toEqual([]);
    expect(
      checkOwnershipTransfer(
        leaver,
        [
          { partnerId: OWNER, bp: 500 },
          { partnerId: OTHER, bp: 1500 },
        ],
        people,
      ),
    ).toEqual([]);
  });

  it('refuses a total that is not all of it, the leaver, a stranger, a repeat and a zero', () => {
    const total = [{ message: PARTNER_ISSUES.exitSharesTotal }];
    const recipient = [{ message: PARTNER_ISSUES.exitRecipient }];
    expect(checkOwnershipTransfer(leaver, [{ partnerId: OWNER, bp: 1000 }], people)).toMatchObject(
      total,
    );
    expect(checkOwnershipTransfer(leaver, [], people)).toMatchObject(total);
    expect(checkOwnershipTransfer(leaver, [{ partnerId: LEAVER, bp: 2000 }], people)).toMatchObject(
      recipient,
    );
    expect(
      checkOwnershipTransfer(leaver, [{ partnerId: crypto.randomUUID(), bp: 2000 }], people),
    ).toMatchObject(recipient);
    expect(
      checkOwnershipTransfer(
        leaver,
        [
          { partnerId: OWNER, bp: 1000 },
          { partnerId: OWNER, bp: 1000 },
        ],
        people,
      ),
    ).toMatchObject(recipient);
    expect(checkOwnershipTransfer(leaver, [{ partnerId: OWNER, bp: 0 }], people)).toMatchObject(
      recipient,
    );
  });

  it('never hands anything to a partner who has left', () => {
    const gone = people.map((p) => (p.id === OTHER ? { ...p, exitedOn: '2026-10-01' } : p));
    expect(checkOwnershipTransfer(leaver, [{ partnerId: OTHER, bp: 2000 }], gone)).toMatchObject([
      { message: PARTNER_ISSUES.exitRecipient },
    ]);
    expect(
      checkExitShares([{ to: { kind: 'partner', partnerId: OTHER }, bp: 10_000 }], LEAVER, gone),
    ).toMatchObject([{ message: PARTNER_ISSUES.exitRecipient }]);
  });

  it('a profit share is handed over whole, or to nobody so the others keep their weights', () => {
    expect(checkExitShares([], LEAVER, people)).toEqual([]);
    expect(checkExitShares([{ to: { kind: 'shop' }, bp: 10_000 }], LEAVER, people)).toEqual([]);
    expect(
      checkExitShares(
        [
          { to: { kind: 'owner' }, bp: 4000 },
          { to: { kind: 'partner', partnerId: OTHER }, bp: 6000 },
        ],
        LEAVER,
        people,
      ),
    ).toEqual([]);
    expect(checkExitShares([{ to: { kind: 'shop' }, bp: 9000 }], LEAVER, people)).toMatchObject([
      { message: PARTNER_ISSUES.exitSharesTotal },
    ]);
    expect(
      checkExitShares(
        [
          { to: { kind: 'shop' }, bp: 5000 },
          { to: { kind: 'shop' }, bp: 5000 },
        ],
        LEAVER,
        people,
      ),
    ).toMatchObject([{ message: PARTNER_ISSUES.exitRecipient }]);
    expect(
      checkExitShares([{ to: { kind: 'partner', partnerId: LEAVER }, bp: 10_000 }], LEAVER, people),
    ).toMatchObject([{ message: PARTNER_ISSUES.exitRecipient }]);
  });
});

describe('exitRuleChanges', () => {
  const from = '2026-12-01';
  const four = rule(
    '2026-09-01',
    1,
    [
      { partnerId: LEAVER, weight: 1 },
      { partnerId: OTHER, weight: 1 },
    ],
    1,
  );

  it('changes nothing when no rule gives them a share', () => {
    const none = [rule('2026-09-01', 1, [{ partnerId: OTHER, weight: 1 }], 1)];
    expect(exitRuleChanges(none, people, { partnerId: LEAVER, from, shares: [] })).toEqual([]);
  });

  it('writes a new rule from that day without them: the others keep their weights', () => {
    const [change, ...rest] = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [],
    });
    expect(rest).toEqual([]);
    expect(change?.id).toBeNull();
    expect(change?.rule).toEqual({
      effectiveFrom: from,
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: [{ partnerId: OTHER, weight: 1 }],
    });
  });

  it('hands their part to one person, whole', () => {
    const [toOther] = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'partner', partnerId: OTHER }, bp: 10_000 }],
    });
    expect(weights({ rule: toOther?.rule ?? { partnerWeights: [] } })).toEqual({ [OTHER]: 2 });
    expect(toOther?.rule).toMatchObject({ ownerWeight: 1, shopWeight: 1, partnerWeight: 2 });
    const [toOwner] = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'owner' }, bp: 10_000 }],
    });
    expect(toOwner?.rule).toMatchObject({ ownerWeight: 2, shopWeight: 1, partnerWeight: 1 });
    const [toShop] = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'shop' }, bp: 10_000 }],
    });
    expect(toShop?.rule).toMatchObject({ ownerWeight: 1, shopWeight: 2, partnerWeight: 1 });
  });

  it('halves a whole weight by scaling the whole rule, which changes nobody else’s share', () => {
    const [change] = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [
        { to: { kind: 'owner' }, bp: 5000 },
        { to: { kind: 'partner', partnerId: OTHER }, bp: 5000 },
      ],
    });
    expect(change?.rule).toEqual({
      effectiveFrom: from,
      ownerWeight: 3,
      partnerWeight: 3,
      shopWeight: 2,
      partnerWeights: [{ partnerId: OTHER, weight: 3 }],
    });
    // The rule is valid for the settlement, and each part is what was handed over: 800 → 300/300/200.
    if (!change) throw new Error('no rule written');
    const shares = splitNetProfit(80_000, change.rule);
    expect(shares).toMatchObject({ ownerCents: 30_000, partnerCents: 30_000, shopCents: 20_000 });
  });

  it('splits three ways in thirds as near as whole weights allow when scaling would pass the limit', () => {
    const heavy = rule(
      '2026-09-01',
      6000,
      [
        { partnerId: LEAVER, weight: 3 },
        { partnerId: OTHER, weight: 1000 },
      ],
      1000,
    );
    const [change] = exitRuleChanges([heavy], people, {
      partnerId: LEAVER,
      from,
      shares: [
        { to: { kind: 'owner' }, bp: 3333 },
        { to: { kind: 'shop' }, bp: 3333 },
        { to: { kind: 'partner', partnerId: OTHER }, bp: 3334 },
      ],
    });
    const parts = change?.rule;
    // The leaver's 3 are handed over in whole weights, none lost or made up.
    expect((parts?.ownerWeight ?? 0) + (parts?.shopWeight ?? 0) + (parts?.partnerWeight ?? 0)).toBe(
      6000 + 1000 + 1000 + 3,
    );
  });

  it('changes a later rule that names them in place, and leaves earlier rules alone', () => {
    const earlier = rule('2026-09-01', 1, [{ partnerId: LEAVER, weight: 2 }], 1);
    const later = rule(
      '2027-02-01',
      1,
      [
        { partnerId: LEAVER, weight: 2 },
        { partnerId: OTHER, weight: 1 },
      ],
      1,
    );
    const changes = exitRuleChanges([earlier, later], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'owner' }, bp: 10_000 }],
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]?.id).toBeNull();
    expect(changes[0]?.rule).toMatchObject({ effectiveFrom: from, ownerWeight: 3 });
    expect(changes[1]?.id).toBe(later.id);
    expect(changes[1]?.rule).toMatchObject({
      effectiveFrom: '2027-02-01',
      ownerWeight: 3,
      partnerWeights: [{ partnerId: OTHER, weight: 1 }],
    });
  });

  it('a rule already entered for that very day is changed in place (one rule a day, S15)', () => {
    const sameDay = rule(from, 1, [{ partnerId: LEAVER, weight: 1 }], 1);
    const [change] = exitRuleChanges([sameDay], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'partner', partnerId: OTHER }, bp: 10_000 }],
    });
    expect(change?.id).toBe(sameDay.id);
  });

  it('a rule that names no partners is the first partner’s, and becomes a named one', () => {
    const unnamed = rule('2026-09-01', 1, null, 1, 2);
    const [change] = exitRuleChanges([unnamed], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'owner' }, bp: 10_000 }],
    });
    expect(change?.rule).toEqual({
      effectiveFrom: from,
      ownerWeight: 3,
      partnerWeight: 0,
      shopWeight: 1,
      partnerWeights: [{ partnerId: LEAVER, weight: 0 }],
    });
  });

  it('the default thirds are the first partner’s: the others split what they leave', () => {
    const [change] = exitRuleChanges([], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'shop' }, bp: 10_000 }],
    });
    expect(change?.id).toBeNull();
    expect(change?.rule).toMatchObject({ ownerWeight: 1, shopWeight: 2, partnerWeight: 0 });
    expect(change?.rule.partnerWeights).toEqual([{ partnerId: LEAVER, weight: 0 }]);
  });

  it('a voided rule is not read: the rule in force is the one that is live', () => {
    const voided = { ...four, ownerWeight: 5, voidedAt: '2026-10-15T00:00:00.000Z' };
    const [change] = exitRuleChanges([voided], people, { partnerId: LEAVER, from, shares: [] });
    // The default thirds are in force, and belong to the first partner.
    expect(change?.id).toBeNull();
    expect(change?.rule).toMatchObject({ ownerWeight: 1, shopWeight: 1 });
  });

  it('the rules it writes pass the same check the server makes', () => {
    const changes = exitRuleChanges([four], people, {
      partnerId: LEAVER,
      from,
      shares: [{ to: { kind: 'partner', partnerId: OTHER }, bp: 10_000 }],
    });
    const partners = people.map((p) => (p.id === LEAVER ? { ...p, exitedOn: from } : p));
    for (const { id, rule: next } of changes) {
      const issues = checkSplitRule({ id: id ?? crypto.randomUUID(), ...next }, undefined, {
        today: TODAY,
        rules: [four],
        partners: people,
      });
      expect(issues).toEqual([]);
      // Once they have left, the same rule is refused only if it still gives them a share.
      expect(
        checkSplitRule({ id: id ?? crypto.randomUUID(), ...next }, undefined, {
          today: TODAY,
          rules: [four],
          partners,
        }),
      ).toEqual([]);
    }
  });
});

describe('rules and records after an exit (S20)', () => {
  const left = people.map((p) => (p.id === LEAVER ? { ...p, exitedOn: '2026-12-01' } : p));

  it('a rule that starts on or after the day they left cannot give them a share', () => {
    const giving = (effectiveFrom: string, weight: number) =>
      checkSplitRule(
        {
          id: crypto.randomUUID(),
          effectiveFrom,
          ownerWeight: 1,
          partnerWeight: weight + 1,
          shopWeight: 1,
          partnerWeights: [
            { partnerId: LEAVER, weight },
            { partnerId: OTHER, weight: 1 },
          ],
        },
        undefined,
        { today: TODAY, rules: [], partners: left },
      );
    expect(giving('2026-12-01', 1)).toMatchObject([
      { message: SETTLEMENT_ISSUES.ruleExitedPartner },
    ]);
    expect(giving('2027-03-01', 1)).toMatchObject([
      { message: SETTLEMENT_ISSUES.ruleExitedPartner },
    ]);
    expect(giving('2026-12-01', 0)).toEqual([]);
    expect(giving('2026-11-20', 1)).toEqual([]);
  });

  it('a rule that names no partners is the first partner’s, who may have left', () => {
    const alone = [people[0], people[1]].map((p) =>
      p?.id === LEAVER ? { ...p, exitedOn: '2026-12-01' } : p,
    ) as Partner[];
    const unnamed = {
      id: crypto.randomUUID(),
      effectiveFrom: '2026-12-15',
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: null,
    };
    expect(
      checkSplitRule(unnamed, undefined, { today: TODAY, rules: [], partners: alone }),
    ).toMatchObject([{ message: SETTLEMENT_ISSUES.ruleExitedPartner }]);
  });

  it('a partner who has left owns nothing, is not the owner, and the day they left is fixed', () => {
    const next = (patch: Partial<Partner>) => ({ ...(left[1] as Partner), ...patch });
    const current = { isOwner: false, exitedOn: '2026-12-01' };
    expect(checkPartnerWrite(next({}), current, left)).toEqual([]);
    expect(checkPartnerWrite(next({ ownershipBp: 100 }), current, left)).toMatchObject([
      { message: PARTNER_ISSUES.exitedOwns },
    ]);
    expect(checkPartnerWrite(next({ exitedOn: '2026-12-09' }), current, left)).toMatchObject([
      { message: PARTNER_ISSUES.exitFixed },
    ]);
    // Coming back is a reactivation: the day is cleared, and they own nothing yet.
    expect(checkPartnerWrite(next({ exitedOn: null }), current, left)).toEqual([]);
  });
});

describe('sharesUnsettledProfit', () => {
  const named = rule(
    '2026-01-01',
    1,
    [
      { partnerId: LEAVER, weight: 1 },
      { partnerId: OTHER, weight: 1 },
    ],
    1,
  );
  const without = rule('2026-12-01', 1, [{ partnerId: OTHER, weight: 1 }], 1);
  const period = (lockedThrough: string | null, before = '2026-12-01') => ({
    lockedThrough,
    before,
    today: TODAY,
  });

  it('is true while a period that has not been settled starts under a rule that gives them a share', () => {
    expect(sharesUnsettledProfit(LEAVER, [named, without], people, period('2026-10-31'))).toBe(
      true,
    );
    expect(sharesUnsettledProfit(LEAVER, [named, without], people, period(null))).toBe(true);
  });

  it('is false once every period before the new rule is settled', () => {
    // November is settled; the next period starts in December under the rule without them.
    expect(
      sharesUnsettledProfit(LEAVER, [named, without], people, period('2026-11-30', '2026-12-01')),
    ).toBe(false);
  });

  it('follows the default thirds, which belong to the first partner, when no rule is entered', () => {
    expect(sharesUnsettledProfit(LEAVER, [], people, period('2026-10-31'))).toBe(true);
    expect(sharesUnsettledProfit(OTHER, [], people, period('2026-10-31'))).toBe(false);
  });
});
