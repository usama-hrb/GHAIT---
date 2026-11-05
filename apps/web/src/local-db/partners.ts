import {
  type CapitalMove,
  capitalMoveFields,
  capitalMoveSchema,
  cashFlowsOf,
  checkPartnerSet,
  checkPartnerWrite,
  type NewCapitalMoveInput,
  newCapitalMoveSchema,
  type NewPartnerDrawInput,
  newPartnerDrawSchema,
  type Partner,
  partnerAccountOf,
  type PartnerDraw,
  partnerDrawSchema,
  type PartnerInput,
  partnerInputSchema,
  partnerSchema,
  type PartnerStatus,
  partnerStatusOf,
  type SettlementRecord,
  type SettlementShare,
} from '@fabric/contracts';
import {
  cashBalanceCents,
  drawWarnings,
  type PartnerAccount,
  type PartnerWarning,
  withdrawalWarnings,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class PartnerTable extends SyncedTable<Partner> {
  constructor(store: LocalStore) {
    super(store, 'partners', 'partner', partnerSchema);
  }

  /**
   * One partner's record. The same check the server makes (S4, S17): one owner who stays the
   * owner, and no more than 100% owned between everyone.
   */
  async save(input: PartnerInput, id: string = crypto.randomUUID()): Promise<string> {
    const fields = parseOrThrow(partnerInputSchema, input);
    const partners = await this.store.db.partners.toArray();
    const current = partners.find((partner) => partner.id === id);
    const issues = checkPartnerWrite(
      { id, voidedAt: current?.voidedAt ?? null, ...fields },
      current,
      partners,
    );
    if (issues.length > 0) throw new ValidationError(issues);
    return this.write(fields, id);
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

  constructor(private readonly store: LocalStore) {
    this.partners = new PartnerTable(store);
    this.moves = new CapitalMoveTable(store);
    this.draws = new DrawTable(store);
  }

  /** The owner first, then the partners in the order they joined, each with their account. */
  async list(): Promise<PartnerView[]> {
    const { db } = this.store;
    const [partners, capitalMoves, draws, shares, rules] = await Promise.all([
      db.partners.toArray(),
      db.capitalMoves.toArray(),
      db.partnerDraws.toArray(),
      sharesOf(db),
      db.profitSplitRules.toArray(),
    ]);
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
      }));
  }

  /**
   * Saves the table of participants at once: the owner and every partner, whole, with the parts
   * everyone owns adding up to exactly 100% (S4, checkPartnerSet). A partner without an `id` is
   * added; one who is not named keeps what they have. Returns the ids in the order given.
   *
   * The shop is never over 100% in between, as the server checks each record in the order they
   * arrive: whoever owns less comes first, whoever owns more (and anyone new) after. A partner
   * who is not changed is not written. Nobody is deleted: a partner who leaves owns 0%.
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
    if (!partner) return undefined;
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

/** Settlement shares (BUILD_PROMPTS 4.3): what each partner's undrawn balance is made of. */
async function sharesOf(db: ShopDatabase) {
  return (await db.settlementShares.toArray()).map(shareOf);
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
