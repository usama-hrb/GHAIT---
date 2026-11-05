import { monthBounds, monthOf, nextMonth } from '@fabric/core';
import {
  exitRuleChanges,
  type ExitRecipient,
  exitRuleDate,
  type ExitShare,
  type OwnershipShare,
  ruleInForceOn,
  sharesProfitFrom,
  sharesUnsettledProfit,
  splitRulesOf,
} from '@fabric/contracts';
import type { PartnerExitInput, PartnerExitPlan } from '@/local-db';
import { permilleOf } from '@/shared/lib/percent';
import { type RuleShare, ruleShares, shareBp } from './people-view';

/**
 * What the Partner Exit Center works out from the choices the owner makes (S20), kept apart from
 * the components so it can be tested. Nothing here is an accounting rule: the balances come from
 * the partner's account, the rules from @fabric/contracts (`exitRuleChanges`, `sharesProfitFrom`),
 * and the device and the server check the whole exit again when it is confirmed. This only turns
 * the choices into the figures, the states and the sentences the screen shows.
 */

export type SectionKey = 'profit' | 'capital' | 'transfer' | 'other';

/** Needs the owner's decision, decided and waiting for the confirmation, nothing left to do, or nothing to do. */
export type SectionState = 'needs' | 'ready' | 'done' | 'na';

export const SECTIONS: readonly SectionKey[] = ['profit', 'capital', 'transfer', 'other'];

/** Who can take a part: the owner, the shop (profit only) or a partner who stays. */
export type Recipient = 'owner' | 'shop' | `partner:${string}`;

/** Money owed to the partner: paid now (all or part, on a date), or left on their account. */
export type PayChoice =
  { mode: 'unset' } | { mode: 'later' } | { mode: 'pay'; cents: number | null; date: string };

export interface TransferRow {
  to: Recipient | '';
  /** A percentage as typed. */
  text: string;
}

/** Handing over a part: to one person, to several in parts, or (profit only) to no one in particular. */
export type TransferChoice =
  | { mode: 'unset' }
  | { mode: 'one'; to: Recipient | '' }
  | { mode: 'several'; rows: TransferRow[] }
  | { mode: 'spread' };

export interface ExitChoices {
  profit: PayChoice;
  capital: PayChoice;
  ownership: TransferChoice;
  profitShare: TransferChoice;
}

export const noChoices = (): ExitChoices => ({
  profit: { mode: 'unset' },
  capital: { mode: 'unset' },
  ownership: { mode: 'unset' },
  profitShare: { mode: 'unset' },
});

/** What the partner's account and the rules say, for the day they leave. */
export interface ExitFacts {
  today: string;
  exitedOn: string;
  /** The day the new profit rules start: the day they leave, or tomorrow when that day has passed. */
  ruleFrom: string;
  ownershipBp: number;
  /** A rule gives them a share of the profit from `ruleFrom` on. */
  sharesProfit: boolean;
  /**
   * The first day a rule that gives them a share is changed: `ruleFrom` when one is in force that
   * day, or the date of a later rule (a share that was set to start later). Null without a share.
   */
  shareFrom: string | null;
  /** Months that start before `ruleFrom` and are not settled yet still share the profit with them. */
  stillShared: boolean;
  profit: { allocatedCents: number; drawnCents: number; undrawnCents: number };
  capital: {
    contributionsCents: number;
    retainedCents: number;
    withdrawnCents: number;
    balanceCents: number;
  };
}

function firstShareDate(plan: PartnerExitPlan, ruleFrom: string): string | null {
  const dates = exitRuleChanges(plan.rules, plan.partners, {
    partnerId: plan.partner.id,
    from: ruleFrom,
    shares: [],
  }).map(({ rule }) => rule.effectiveFrom);
  return dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b));
}

export function factsOf(plan: PartnerExitPlan, exitedOn: string): ExitFacts {
  const { account } = plan;
  const ruleFrom = exitRuleDate(exitedOn, plan.today);
  return {
    today: plan.today,
    exitedOn,
    ruleFrom,
    ownershipBp: plan.partner.ownershipBp,
    sharesProfit: sharesProfitFrom(plan.partner.id, plan.rules, plan.partners, ruleFrom),
    shareFrom: firstShareDate(plan, ruleFrom),
    stillShared: sharesUnsettledProfit(plan.partner.id, plan.rules, plan.partners, {
      lockedThrough: plan.lockedThrough,
      before: ruleFrom,
      today: plan.today,
    }),
    profit: {
      allocatedCents: account.sharesCents,
      drawnCents: account.drawsCents,
      undrawnCents: account.undrawnCents,
    },
    capital: {
      contributionsCents: account.contributionsCents,
      retainedCents: account.retainedProfitCents,
      withdrawnCents: account.withdrawalsCents,
      balanceCents: account.capitalCents,
    },
  };
}

const recipientOf = (key: Recipient): ExitRecipient =>
  key === 'owner'
    ? { kind: 'owner' }
    : key === 'shop'
      ? { kind: 'shop' }
      : { kind: 'partner', partnerId: key.slice('partner:'.length) };

/** What a payment choice comes to: the amount paid now, and whether the choice is complete. */
export function payOf(choice: PayChoice, owedCents: number): { cents: number; chosen: boolean } {
  if (choice.mode === 'later') return { cents: 0, chosen: true };
  if (choice.mode === 'pay') {
    const { cents } = choice;
    const valid = cents !== null && Number.isInteger(cents) && cents > 0 && cents <= owedCents;
    return { cents: valid ? cents : 0, chosen: valid };
  }
  return { cents: 0, chosen: false };
}

/** The parts a hand-over comes to, in basis points of `totalBp`, and whether it is complete. */
export function transferOf(
  choice: TransferChoice,
  totalBp: number,
): { parts: { to: Recipient; bp: number }[]; leftBp: number; chosen: boolean } {
  if (choice.mode === 'spread') return { parts: [], leftBp: 0, chosen: true };
  if (choice.mode === 'one') {
    return choice.to === ''
      ? { parts: [], leftBp: totalBp, chosen: false }
      : { parts: [{ to: choice.to, bp: totalBp }], leftBp: 0, chosen: true };
  }
  if (choice.mode === 'several') {
    const parts: { to: Recipient; bp: number }[] = [];
    let complete = choice.rows.length > 0;
    const seen = new Set<string>();
    for (const row of choice.rows) {
      const bp = shareBp(row.text);
      if (row.to === '' || bp === null || bp === 0 || seen.has(row.to)) {
        complete = false;
        continue;
      }
      seen.add(row.to);
      parts.push({ to: row.to, bp });
    }
    const given = parts.reduce((sum, part) => sum + part.bp, 0);
    return { parts, leftBp: totalBp - given, chosen: complete && given === totalBp };
  }
  return { parts: [], leftBp: totalBp, chosen: false };
}

/** The ownership handed over, as the device takes it (the owner is the partner who is the owner). */
export function ownershipSharesOf(choice: TransferChoice, plan: PartnerExitPlan): OwnershipShare[] {
  const ownerId = plan.partners.find((partner) => partner.isOwner)?.id ?? '';
  return transferOf(choice, plan.partner.ownershipBp).parts.map(({ to, bp }) => ({
    partnerId: to === 'owner' ? ownerId : to.slice('partner:'.length),
    bp,
  }));
}

/** The profit share handed over, as the device takes it: parts of their share out of 10000. */
export function profitSharesOf(choice: TransferChoice): ExitShare[] {
  return transferOf(choice, 10_000).parts.map(({ to, bp }) => ({ to: recipientOf(to), bp }));
}

/** How each part of the exit stands, from the choices so far. */
export function sectionStates(
  facts: ExitFacts,
  choices: ExitChoices,
): Record<SectionKey, SectionState> {
  const owed = (owedCents: number, choice: PayChoice, hadMoney: boolean): SectionState =>
    owedCents > 0
      ? payOf(choice, owedCents).chosen
        ? 'ready'
        : 'needs'
      : hadMoney
        ? 'done'
        : 'na';
  const { profit, capital } = facts;
  const transfer = (): SectionState => {
    const ownership =
      facts.ownershipBp === 0 || transferOf(choices.ownership, facts.ownershipBp).chosen;
    const sharing = !facts.sharesProfit || transferOf(choices.profitShare, 10_000).chosen;
    if (facts.ownershipBp === 0 && !facts.sharesProfit) return 'done';
    return ownership && sharing ? 'ready' : 'needs';
  };
  return {
    profit: owed(
      profit.undrawnCents,
      choices.profit,
      profit.allocatedCents > 0 || profit.drawnCents > 0,
    ),
    capital: owed(
      capital.balanceCents,
      choices.capital,
      capital.contributionsCents > 0 || capital.retainedCents > 0 || capital.withdrawnCents > 0,
    ),
    transfer: transfer(),
    other: profit.undrawnCents < 0 || facts.stillShared ? 'ready' : 'na',
  };
}

/** The exit can be reviewed once nothing still needs a decision. */
export const canReview = (states: Record<SectionKey, SectionState>): boolean =>
  SECTIONS.every((key) => states[key] !== 'needs');

/** The first part that still needs a decision, to open it. */
export const firstNeeding = (states: Record<SectionKey, SectionState>): SectionKey | null =>
  SECTIONS.find((key) => states[key] === 'needs') ?? null;

/**
 * The profit split from the day the new rules start, with this partner's part handed over as
 * chosen: the rule @fabric/contracts would write, shown as shares. Null when no rule gives them a share.
 */
export function splitAfter(
  plan: PartnerExitPlan,
  facts: ExitFacts,
  shares: readonly ExitShare[],
  labels: Parameters<typeof ruleShares>[1],
): RuleShare[] | null {
  const changes = exitRuleChanges(plan.rules, plan.partners, {
    partnerId: plan.partner.id,
    from: facts.ruleFrom,
    shares,
  });
  const change = changes.find(
    ({ rule }) => rule.effectiveFrom === (facts.shareFrom ?? facts.ruleFrom),
  );
  return change ? ruleShares(change.rule, labels) : null;
}

/** The profit split in force on the day the new rules start, before this exit changes it. */
export function splitBefore(
  plan: PartnerExitPlan,
  facts: ExitFacts,
  labels: Parameters<typeof ruleShares>[1],
): RuleShare[] | null {
  const rule = ruleInForceOn(
    splitRulesOf(plan.rules, plan.partners),
    facts.shareFrom ?? facts.ruleFrom,
  );
  return rule ? ruleShares({ ...rule, partnerWeights: rule.partnerWeights ?? [] }, labels) : null;
}

/** Ownership of the shop after the hand-over: everyone who holds a part, as shares. */
export function ownershipAfter(
  plan: PartnerExitPlan,
  handed: readonly OwnershipShare[],
  labelOf: (partnerId: string, isOwner: boolean) => string,
): RuleShare[] {
  return plan.partners
    .filter((partner) => partner.id !== plan.partner.id)
    .map((partner) => {
      const bp =
        partner.ownershipBp + (handed.find(({ partnerId }) => partnerId === partner.id)?.bp ?? 0);
      return {
        key: partner.id,
        label: labelOf(partner.id, partner.isOwner),
        weight: bp,
        permille: permilleOf(bp, 10_000),
      };
    })
    .filter((share) => share.weight > 0);
}

/**
 * The first period that starts on or after the day the new rules start, as its month (YYYY-MM):
 * a period is settled with the rule in force on its first day (S3), so that is the first one that
 * is shared without them.
 */
export function firstPeriodWithoutThem(ruleFrom: string): string {
  const month = monthOf(ruleFrom);
  return monthBounds(month).start >= ruleFrom ? month : nextMonth(month);
}

/** Whether the day is one a partner can leave on: not before they joined. */
export function departureIssue(
  exitedOn: string,
  startDate: string | null,
): 'empty' | 'before_start' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exitedOn)) return 'empty';
  return startDate !== null && exitedOn < startDate ? 'before_start' : null;
}

export interface ExitDetails {
  note: string;
  /** The reasons written on the payments, in the language showing. */
  profitReason: string;
  capitalNote: string;
}

/**
 * What is sent to the device when the owner confirms; null until every part is decided. The
 * balances are the ones shown, so a payment on figures that moved is refused.
 */
export function inputOf(
  plan: PartnerExitPlan,
  facts: ExitFacts,
  choices: ExitChoices,
  details: ExitDetails,
): PartnerExitInput | null {
  const states = sectionStates(facts, choices);
  if (!canReview(states)) return null;
  const profit = payOf(choices.profit, facts.profit.undrawnCents);
  const capital = payOf(choices.capital, facts.capital.balanceCents);
  const note = details.note.trim();
  return {
    partnerId: plan.partner.id,
    exitedOn: facts.exitedOn,
    note: note === '' ? null : note,
    profit: {
      payCents: profit.cents,
      expectedUndrawnCents: facts.profit.undrawnCents,
      date: choices.profit.mode === 'pay' ? choices.profit.date : facts.today,
      reason: details.profitReason,
    },
    capital: {
      repayCents: capital.cents,
      expectedCapitalCents: facts.capital.balanceCents,
      date: choices.capital.mode === 'pay' ? choices.capital.date : facts.today,
      note: details.capitalNote,
    },
    ownership: facts.ownershipBp > 0 ? ownershipSharesOf(choices.ownership, plan) : [],
    profitShares: facts.sharesProfit ? profitSharesOf(choices.profitShare) : [],
  };
}

/** The figures the confirmation reads out. */
export interface ExitReview {
  profit: { openingCents: number; paidCents: number; remainingCents: number };
  capital: { openingCents: number; paidCents: number; remainingCents: number };
  paidCents: number;
  remainingCents: number;
  /** The day after the last day they share the profit, as the first period without them. */
  firstPeriodWithoutThem: string;
}

export function reviewOf(facts: ExitFacts, choices: ExitChoices): ExitReview {
  const profitPaid = payOf(choices.profit, facts.profit.undrawnCents).cents;
  const capitalPaid = payOf(choices.capital, facts.capital.balanceCents).cents;
  const profitOwed = Math.max(facts.profit.undrawnCents, 0);
  const capitalOwed = Math.max(facts.capital.balanceCents, 0);
  return {
    profit: {
      openingCents: facts.profit.undrawnCents,
      paidCents: profitPaid,
      remainingCents: facts.profit.undrawnCents - profitPaid,
    },
    capital: {
      openingCents: facts.capital.balanceCents,
      paidCents: capitalPaid,
      remainingCents: facts.capital.balanceCents - capitalPaid,
    },
    paidCents: profitPaid + capitalPaid,
    remainingCents: profitOwed - profitPaid + (capitalOwed - capitalPaid),
    firstPeriodWithoutThem: firstPeriodWithoutThem(facts.ruleFrom),
  };
}

/** The key of a recipient in the pick lists: the owner, the shop or a partner. */
export const partnerKey = (partnerId: string): Recipient => `partner:${partnerId}`;
