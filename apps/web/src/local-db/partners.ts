import {
  type CapitalMove,
  capitalMoveFields,
  capitalMoveSchema,
  cashFlowsOf,
  checkExitShares,
  checkOwnershipTransfer,
  checkPartnerExit,
  checkPartnerSet,
  checkPartnerVoid,
  checkPartnerWrite,
  checkSplitRule,
  exitRuleChanges,
  exitRuleDate,
  type ExitShare,
  isoDateSchema,
  lockedThroughOf,
  type NewCapitalMoveInput,
  newCapitalMoveSchema,
  type NewPartnerDrawInput,
  newPartnerDrawSchema,
  type OwnershipShare,
  type Partner,
  partnerAccountOf,
  type PartnerDraw,
  partnerDrawSchema,
  type PartnerInput,
  partnerInputSchema,
  PARTNER_ISSUES,
  partnerSchema,
  type PartnerStanding,
  partnerStandingOf,
  type PartnerStatus,
  partnerStatusOf,
  type SettlementRecord,
  type SettlementShare,
  type SplitRule,
  type ValidationIssue,
} from '@fabric/contracts';
import {
  cashBalanceCents,
  drawWarnings,
  type PartnerAccount,
  type PartnerWarning,
  withdrawalWarnings,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { SplitRuleTable } from './settlements';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class PartnerTable extends SyncedTable<Partner> {
  constructor(store: LocalStore) {
    super(store, 'partners', 'partner', partnerSchema);
  }

  /**
   * One partner's record. The same check the server makes (S4, S17): one owner who stays the
   * owner, and no more than 100% owned between everyone. The form never carries the exit (S20), so
   * a partner who has left is still gone after their details are edited.
   */
  async save(input: PartnerInput, id: string = crypto.randomUUID()): Promise<string> {
    const fields = parseOrThrow(partnerInputSchema, input);
    const partners = await this.store.db.partners.toArray();
    const current = partners.find((partner) => partner.id === id);
    const exit = { exitedOn: current?.exitedOn ?? null, exitNote: current?.exitNote ?? null };
    const issues = checkPartnerWrite(
      { id, voidedAt: current?.voidedAt ?? null, ...exit, ...fields },
      current,
      partners,
    );
    if (issues.length > 0) throw new ValidationError(issues);
    return this.write({ ...fields, ...exit }, id);
  }

  /**
   * The day a partner leaves (S20), or null to bring them back: their record, whole, with only the
   * exit changed. The caller has made the checks that belong to the exit (checkPartnerExit).
   */
  async setExit(
    id: string,
    exit: { exitedOn: string | null; exitNote: string | null },
  ): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new Error(`No partner ${id}`);
    const { name, ownershipBp, isOwner, phone, title, startDate, notes } = current;
    const partners = await this.store.db.partners.toArray();
    const issues = checkPartnerWrite({ ...current, ...exit }, current, partners);
    if (issues.length > 0) throw new ValidationError(issues);
    await this.write({ name, ownershipBp, isOwner, phone, title, startDate, notes, ...exit }, id);
  }
}

class CapitalMoveTable extends SyncedTable<CapitalMove> {
  constructor(store: LocalStore) {
    super(store, 'capitalMoves', 'capital_move', capitalMoveSchema);
  }

  async create(fields: object): Promise<string> {
    return this.write(fields);
  }
}

class DrawTable extends SyncedTable<PartnerDraw> {
  constructor(store: LocalStore) {
    super(store, 'partnerDraws', 'partner_draw', partnerDrawSchema);
  }

  async create(fields: object): Promise<string> {
    return this.write(fields);
  }
}

export interface PartnerView {
  partner: Local<Partner>;
  account: PartnerAccount;
  /** Whether they still take part (S18): worked out from their ownership and the rules, not stored. */
  status: PartnerStatus;
  /** Whether they have left, or leave on a day still to come (S20): from the day an exit recorded. */
  standing: PartnerStanding;
  /** What stands in the way of removing them (S19); empty when they can go. */
  removal: ValidationIssue[];
}

/** A settlement's share of one partner, with the settlement it came from. */
export interface PartnerAllocation {
  share: Local<SettlementShare>;
  settlement: Local<SettlementRecord> | undefined;
}

export interface PartnerAccountView extends PartnerView {
  /** Newest first. */
  moves: Local<CapitalMove>[];
  draws: Local<PartnerDraw>[];
  /** What each settlement gave them, the latest period first (voided ones left out). */
  allocations: PartnerAllocation[];
}

/**
 * One participant of the ownership table, as the owner fills it in (the partner form). `id` is
 * missing for a partner being added.
 */
export interface PartnerDraft {
  id?: string;
  name: string;
  /** 5000 = 50%. */
  ownershipBp: number;
  isOwner: boolean;
  phone?: string | null;
  title?: string | null;
  startDate?: string | null;
  notes?: string | null;
}

/**
 * Everything the Partner Exit Center works from (S20), read from the device: the partner's
 * account, the other partners and the profit rules. Nothing here is a figure of its own; the
 * screen asks @fabric/contracts what each choice would do.
 */
export interface PartnerExitPlan {
  partner: Local<Partner>;
  today: string;
  account: PartnerAccount;
  /** The shop's money according to the records, to warn when a payment is more than it holds. */
  cashCents: number;
  /** Every partner of the shop who has not been removed, the leaver among them. */
  partners: Local<Partner>[];
  /** The profit rules the owner entered, in force or to come. */
  rules: Local<SplitRule>[];
  /** The last settled day (S7); null before the first settlement. */
  lockedThrough: string | null;
  /** What would stop removing them outright (S19): empty for a partner who took part in nothing. */
  removal: ValidationIssue[];
}

/** What the owner confirmed at the end of the Partner Exit Center (S20). */
export interface PartnerExitInput {
  partnerId: string;
  /** The day they leave: when the profit stops and their standing changes. */
  exitedOn: string;
  /** What was agreed about what is still owed, in the owner's words. */
  note: string | null;
  /** Undrawn profit paid now (a draw), with the balance the screen showed. */
  profit: { payCents: number; expectedUndrawnCents: number; date: string; reason: string };
  /** Capital repaid now (a withdrawal), with the balance the screen showed. */
  capital: { repayCents: number; expectedCapitalCents: number; date: string; note: string };
  /** All of their ownership, handed to the owner and the partners who stay. */
  ownership: OwnershipShare[];
  /** Their share of the profit, handed over; none leaves it to the others in proportion. */
  profitShares: ExitShare[];
}

export const NEEDS_CONFIRMATION = 'partner_money_needs_confirmation';

const newestFirst = <R extends { date: string; createdAt: string }>(a: R, b: R) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * The partners, their capital and draws (SPEC §6, §8.4, BUILD_PROMPTS 4.2), saved on the device
 * first. Accounts and the shop's cash come from @fabric/core (partnerAccount, cashBalanceCents).
 * A withdrawal that takes capital below zero, or a draw beyond the undrawn share, needs an
 * explicit confirmation.
 */
export class PartnersRepository {
  private readonly partners: PartnerTable;
  private readonly moves: CapitalMoveTable;
  private readonly draws: DrawTable;
  private readonly rules: SplitRuleTable;

  constructor(private readonly store: LocalStore) {
    this.partners = new PartnerTable(store);
    this.moves = new CapitalMoveTable(store);
    this.draws = new DrawTable(store);
    this.rules = new SplitRuleTable(store);
  }

  /** The owner first, then the partners in the order they joined, each with their account. */
  async list(): Promise<PartnerView[]> {
    const records = await this.records();
    const { partners, capitalMoves, draws, rules } = records;
    const shares = records.shares.map(shareOf);
    const today = shopToday(this.store.now());
    return partners
      .filter((partner) => partner.voidedAt === null)
      .sort(
        (a, b) =>
          Number(b.isOwner) - Number(a.isOwner) ||
          a.createdAt.localeCompare(b.createdAt) ||
          // The same tie-break as the shop's first partner (firstPartnerOf).
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((partner) => ({
        partner,
        account: partnerAccountOf(partner.id, { capitalMoves, draws, shares }),
        status: partnerStatusOf(partner, rules, partners, today),
        standing: partnerStandingOf(partner, today),
        removal: checkPartnerVoid(partner.id, records),
      }));
  }

  /**
   * Removes a partner (S19): voided with a reason, never deleted. Only one who took part in nothing
   * can go; the same check the server makes. The owner is never removed.
   */
  async remove(id: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const issues = checkPartnerVoid(id, await this.records());
    if (issues.length > 0) throw new ValidationError(issues);
    await this.partners.void(id, reason);
  }

  /**
   * Saves the table of participants at once: the owner and every partner, whole, with the parts
   * everyone owns adding up to exactly 100% (S4, checkPartnerSet). A partner without an `id` is
   * added; one who is not named keeps what they have. Returns the ids in the order given.
   *
   * The shop is never over 100% in between, as the server checks each record in the order they
   * arrive: whoever owns less comes first, whoever owns more (and anyone new) after. A partner
   * who is not changed is not written. A partner leaves by owning 0% and then being removed (S19).
   */
  async saveAll(drafts: readonly PartnerDraft[]): Promise<string[]> {
    this.store.assertWritable();
    const stored = (await this.store.db.partners.toArray()).filter(
      (partner) => partner.voidedAt === null,
    );
    const entries = drafts.map((draft) => {
      const id = draft.id ?? crypto.randomUUID();
      return { id, current: stored.find((partner) => partner.id === id), draft };
    });
    const named = new Set(entries.map(({ id }) => id));
    const issues = checkPartnerSet([
      ...entries.map(({ draft }) => ({
        isOwner: draft.isOwner,
        ownershipBp: draft.ownershipBp,
        voidedAt: null,
      })),
      ...stored.filter((partner) => !named.has(partner.id)),
    ]);
    if (issues.length > 0) throw new ValidationError(issues);
    const written = entries
      .map(({ id, current, draft }) => ({
        id,
        current,
        fields: parseOrThrow(partnerInputSchema, draft),
      }))
      .filter(
        ({ current, fields }) =>
          !current ||
          (Object.keys(fields) as (keyof typeof fields)[]).some(
            (key) => current[key] !== fields[key],
          ),
      );
    const growth = ({ current, fields }: (typeof written)[number]) =>
      fields.ownershipBp - (current?.ownershipBp ?? 0);
    for (const { id, fields } of written.sort((a, b) => growth(a) - growth(b))) {
      await this.partners.save(fields, id);
    }
    return entries.map(({ id }) => id);
  }

  async account(partnerId: string): Promise<PartnerAccountView | undefined> {
    const { db } = this.store;
    const partner = await db.partners.get(partnerId);
    if (!partner || partner.voidedAt !== null) return undefined;
    const [capitalMoves, draws, shares, partners, rules] = await Promise.all([
      db.capitalMoves.where('partnerId').equals(partnerId).toArray(),
      db.partnerDraws.where('partnerId').equals(partnerId).toArray(),
      db.settlementShares.where('partnerId').equals(partnerId).toArray(),
      db.partners.toArray(),
      db.profitSplitRules.toArray(),
    ]);
    const settlements = new Map(
      (await db.settlements.bulkGet([...new Set(shares.map((share) => share.settlementId))]))
        .filter((settlement) => settlement !== undefined)
        .map((settlement) => [settlement.id, settlement]),
    );
    return {
      partner,
      account: partnerAccountOf(partnerId, {
        capitalMoves,
        draws,
        shares: shares.map(shareOf),
      }),
      status: partnerStatusOf(partner, rules, partners, shopToday(this.store.now())),
      standing: partnerStandingOf(partner, shopToday(this.store.now())),
      removal: checkPartnerVoid(partnerId, { partners, capitalMoves, draws, shares, rules }),
      moves: capitalMoves.sort(newestFirst),
      draws: draws.sort(newestFirst),
      allocations: shares
        .filter((share) => share.voidedAt === null)
        .map((share) => ({ share, settlement: settlements.get(share.settlementId) }))
        .sort((a, b) =>
          (b.settlement?.periodEnd ?? '').localeCompare(a.settlement?.periodEnd ?? ''),
        ),
    };
  }

  /** What the Partner Exit Center shows for one partner; undefined for one who is not there (S20). */
  async exitPlan(id: string): Promise<PartnerExitPlan | undefined> {
    const records = await this.records();
    const partner = records.partners.find((row) => row.id === id && row.voidedAt === null);
    if (!partner) return undefined;
    const shares = records.shares.map(shareOf);
    return {
      partner,
      today: shopToday(this.store.now()),
      account: partnerAccountOf(id, {
        capitalMoves: records.capitalMoves,
        draws: records.draws,
        shares,
      }),
      cashCents: await this.cash(),
      partners: records.partners.filter((row) => row.voidedAt === null),
      rules: records.rules.filter((row) => row.voidedAt === null),
      lockedThrough: lockedThroughOf(await this.store.db.settlements.toArray()),
      removal: checkPartnerVoid(id, records),
    };
  }

  /**
   * A partner leaves (S20). The profit and the capital the owner chose to pay, the ownership, the
   * profit rules and, last, the exit itself are written in ONE local transaction, so a failure
   * anywhere leaves nothing behind: no payment without the exit, and no exit without the payment.
   * The balances are read again here and must still be what the screen showed, so a payment is
   * never made on a figure that has moved, and a second submission finds the exit done and writes
   * nothing. What is not paid stays on their account, to pay later. Nothing is erased.
   *
   * Each record syncs as its own op, in this order. The server checks the exit last, so a device
   * that pushes the exit before its ownership or rules have arrived is refused rather than half done.
   */
  async completeExit(input: PartnerExitInput): Promise<void> {
    this.store.assertWritable();
    await this.store.deviceId();
    const { db } = this.store;
    await db.transaction(
      'rw',
      [
        db.partners,
        db.capitalMoves,
        db.partnerDraws,
        db.profitSplitRules,
        db.settlementShares,
        db.settlements,
        db.outbox,
      ],
      () => this.exitWithin(input),
    );
  }

  /** Brings a partner who left back (S20): the day is cleared; ownership and profit are given again like to anyone. */
  async reactivate(id: string): Promise<void> {
    this.store.assertWritable();
    const partner = await this.partners.get(id);
    if (!partner || partner.exitedOn == null) return;
    await this.partners.setExit(id, { exitedOn: null, exitNote: null });
  }

  private async exitWithin(input: PartnerExitInput): Promise<void> {
    const { db } = this.store;
    const today = shopToday(this.store.now());
    const exitedOn = parseOrThrow(isoDateSchema, input.exitedOn);
    const fail = (path: string, message: string) =>
      new ValidationError([{ path: [path], message, code: 'custom' }]);
    const records = await this.records();
    const partner = records.partners.find(
      (row) => row.id === input.partnerId && row.voidedAt === null,
    );
    if (!partner) throw new Error(`No partner ${input.partnerId}`);
    if (partner.isOwner) throw fail('id', PARTNER_ISSUES.exitOwner);
    if (partner.exitedOn != null) throw fail('exitedOn', PARTNER_ISSUES.alreadyExited);

    const account = partnerAccountOf(partner.id, {
      capitalMoves: records.capitalMoves,
      draws: records.draws,
      shares: records.shares.map(shareOf),
    });
    const { profit, capital } = input;
    if (
      profit.expectedUndrawnCents !== account.undrawnCents ||
      capital.expectedCapitalCents !== account.capitalCents
    ) {
      throw fail('amountCents', PARTNER_ISSUES.exitBalancesChanged);
    }
    if (
      !Number.isInteger(profit.payCents) ||
      !Number.isInteger(capital.repayCents) ||
      profit.payCents < 0 ||
      capital.repayCents < 0 ||
      profit.payCents > Math.max(account.undrawnCents, 0) ||
      capital.repayCents > Math.max(account.capitalCents, 0)
    ) {
      throw fail('amountCents', PARTNER_ISSUES.exitPayment);
    }
    const live = records.partners.filter((row) => row.voidedAt === null);
    const issues = [
      ...checkOwnershipTransfer(partner, input.ownership, live),
      ...checkExitShares(input.profitShares, partner.id, live),
    ];
    if (issues.length > 0) throw new ValidationError(issues);

    // The money first: real, dated records, each with the reason the owner will read later.
    if (profit.payCents > 0) {
      await this.draws.create(
        parseOrThrow(newPartnerDrawSchema, {
          partnerId: partner.id,
          amountCents: profit.payCents,
          date: profit.date,
          reason: profit.reason,
        }),
      );
    }
    if (capital.repayCents > 0) {
      await this.moves.create(
        capitalMoveFields(
          parseOrThrow(newCapitalMoveSchema, {
            partnerId: partner.id,
            kind: 'withdrawal',
            amountCents: capital.repayCents,
            date: capital.date,
            note: capital.note,
          }),
        ),
      );
    }

    // Ownership: what is given up is written before what grows, so the shop is never over 100%.
    const ownedNow = (id: string) => db.partners.get(id);
    const ownershipTo = async (id: string, ownershipBp: number) => {
      const row = await ownedNow(id);
      if (!row) throw new Error(`No partner ${id}`);
      const { name, isOwner, phone, title, startDate, notes } = row;
      await this.partners.save({ name, ownershipBp, isOwner, phone, title, startDate, notes }, id);
    };
    if (partner.ownershipBp > 0) await ownershipTo(partner.id, 0);
    for (const { partnerId, bp } of input.ownership) {
      const row = await ownedNow(partnerId);
      await ownershipTo(partnerId, (row?.ownershipBp ?? 0) + bp);
    }

    // The rules: from the day they leave, and every later rule that still names them.
    const peopleNow = await db.partners.toArray();
    const rulesNow = (await db.profitSplitRules.toArray()).filter((rule) => rule.voidedAt === null);
    const changes = exitRuleChanges(rulesNow, peopleNow, {
      partnerId: partner.id,
      from: exitRuleDate(exitedOn, today),
      shares: input.profitShares,
    });
    for (const { id, rule } of changes) {
      const ruleId = id ?? crypto.randomUUID();
      const all = await db.profitSplitRules.toArray();
      const found = checkSplitRule(
        { id: ruleId, ...rule },
        all.find((row) => row.id === ruleId),
        {
          today,
          rules: all,
          partners: peopleNow,
        },
      );
      if (found.length > 0) throw new ValidationError(found);
      await this.rules.save(rule, ruleId);
    }

    // The exit itself, last: the same check the server makes when it arrives.
    const after = await db.partners.toArray();
    const mine = after.find((row) => row.id === partner.id);
    const exitIssues = checkPartnerExit(
      {
        id: partner.id,
        isOwner: partner.isOwner,
        ownershipBp: mine?.ownershipBp ?? 0,
        startDate: partner.startDate,
        exitedOn,
      },
      partner,
      {
        today,
        partners: after.filter((row) => row.voidedAt === null),
        rules: await db.profitSplitRules.toArray(),
      },
    );
    if (exitIssues.length > 0) throw new ValidationError(exitIssues);
    await this.partners.setExit(partner.id, { exitedOn, exitNote: input.note });
  }

  /** What a contribution or withdrawal would need confirmed (capital going below zero). */
  async capitalWarnings(input: NewCapitalMoveInput): Promise<PartnerWarning[]> {
    const parsed = newCapitalMoveSchema.safeParse(input);
    if (!parsed.success || parsed.data.kind === 'contribution') return [];
    const view = await this.account(parsed.data.partnerId);
    return view ? withdrawalWarnings(view.account, parsed.data.amountCents) : [];
  }

  /** What a draw would need confirmed (more than the undrawn share). */
  async drawWarnings(input: NewPartnerDrawInput): Promise<PartnerWarning[]> {
    const parsed = newPartnerDrawSchema.safeParse(input);
    if (!parsed.success) return [];
    const view = await this.account(parsed.data.partnerId);
    return view ? drawWarnings(view.account, parsed.data.amountCents) : [];
  }

  async recordCapitalMove(input: NewCapitalMoveInput, confirmed = false): Promise<string> {
    const parsed = parseOrThrow(newCapitalMoveSchema, input);
    if (!confirmed && (await this.capitalWarnings(input)).length > 0) throw needsConfirmation();
    return this.moves.create(capitalMoveFields(parsed));
  }

  async recordDraw(input: NewPartnerDrawInput, confirmed = false): Promise<string> {
    const parsed = parseOrThrow(newPartnerDrawSchema, input);
    if (!confirmed && (await this.drawWarnings(input)).length > 0) throw needsConfirmation();
    return this.draws.create(parsed);
  }

  voidCapitalMove(id: string, reason: string): Promise<void> {
    return this.moves.void(id, reason);
  }

  voidDraw(id: string, reason: string): Promise<void> {
    return this.draws.void(id, reason);
  }

  /** Everything a partner can be part of: the participants, their money and the profit rules. */
  private async records() {
    const { db } = this.store;
    const [partners, capitalMoves, draws, shares, rules] = await Promise.all([
      db.partners.toArray(),
      db.capitalMoves.toArray(),
      db.partnerDraws.toArray(),
      db.settlementShares.toArray(),
      db.profitSplitRules.toArray(),
    ]);
    return { partners, capitalMoves, draws, shares, rules };
  }

  /** The shop's money according to the records (@fabric/core cashBalanceCents, SPEC §9). */
  async cash(): Promise<number> {
    const { db } = this.store;
    const [payments, purchases, expenses, capitalMoves, draws, cashAdjustments] = await Promise.all(
      [
        db.payments.toArray(),
        db.purchases.toArray(),
        db.expenses.toArray(),
        db.capitalMoves.toArray(),
        db.partnerDraws.toArray(),
        db.cashAdjustments.toArray(),
      ],
    );
    return cashBalanceCents(
      cashFlowsOf({ payments, purchases, expenses, capitalMoves, draws, cashAdjustments }),
    );
  }
}

function shareOf(share: SettlementShare): {
  partnerId: string;
  amountCents: number;
  voided: boolean;
} {
  return {
    partnerId: share.partnerId,
    amountCents: share.amountCents,
    voided: share.voidedAt !== null,
  };
}

function needsConfirmation(): ValidationError {
  return new ValidationError([
    { path: ['confirmed'], message: NEEDS_CONFIRMATION, code: 'custom' },
  ]);
}
