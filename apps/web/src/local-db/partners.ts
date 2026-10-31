import {
  type CapitalMove,
  capitalMoveFields,
  capitalMoveSchema,
  cashFlowsOf,
  type NewCapitalMoveInput,
  newCapitalMoveSchema,
  type NewPartnerDrawInput,
  newPartnerDrawSchema,
  type Partner,
  partnerAccountOf,
  type PartnerDraw,
  partnerDrawSchema,
  partnerInputSchema,
  partnerSchema,
} from '@fabric/contracts';
import {
  cashBalanceCents,
  drawWarnings,
  ownerAndPartner,
  type PartnerAccount,
  type PartnerWarning,
  withdrawalWarnings,
} from '@fabric/core';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class PartnerTable extends SyncedTable<Partner> {
  constructor(store: LocalStore) {
    super(store, 'partners', 'partner', partnerSchema);
  }

  async save(
    input: { name: string; ownershipBp: number; isOwner: boolean },
    id?: string,
  ): Promise<string> {
    return this.write(parseOrThrow(partnerInputSchema, input), id);
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
}

export interface PartnerAccountView extends PartnerView {
  /** Newest first. */
  moves: Local<CapitalMove>[];
  draws: Local<PartnerDraw>[];
}

export const PARTNER_SETUP_ISSUE = 'partners_must_be_owner_and_partner_adding_to_100';
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

  /** The owner first, then the partner, each with their account. */
  async list(): Promise<PartnerView[]> {
    const { db } = this.store;
    const [partners, capitalMoves, draws, shares] = await Promise.all([
      db.partners.toArray(),
      db.capitalMoves.toArray(),
      db.partnerDraws.toArray(),
      sharesOf(db),
    ]);
    return partners
      .filter((partner) => partner.voidedAt === null)
      .sort(
        (a, b) => Number(b.isOwner) - Number(a.isOwner) || a.createdAt.localeCompare(b.createdAt),
      )
      .map((partner) => ({
        partner,
        account: partnerAccountOf(partner.id, { capitalMoves, draws, shares }),
      }));
  }

  /**
   * Sets up or edits both partners at once: the owner and the partner, ownership adding up to
   * 100% (S4, @fabric/core ownerAndPartner).
   */
  async saveBoth(input: {
    owner: { id?: string; name: string; ownershipBp: number };
    partner: { id?: string; name: string };
  }): Promise<void> {
    const ownerId = input.owner.id ?? crypto.randomUUID();
    const partnerId = input.partner.id ?? crypto.randomUUID();
    try {
      ownerAndPartner([
        { partnerId: ownerId, ownershipBp: input.owner.ownershipBp, isOwner: true },
        { partnerId, ownershipBp: 10_000 - input.owner.ownershipBp, isOwner: false },
      ]);
    } catch {
      throw new ValidationError([
        { path: ['ownershipBp'], message: PARTNER_SETUP_ISSUE, code: 'custom' },
      ]);
    }
    await this.partners.save(
      { name: input.owner.name, ownershipBp: input.owner.ownershipBp, isOwner: true },
      ownerId,
    );
    await this.partners.save(
      { name: input.partner.name, ownershipBp: 10_000 - input.owner.ownershipBp, isOwner: false },
      partnerId,
    );
  }

  async account(partnerId: string): Promise<PartnerAccountView | undefined> {
    const { db } = this.store;
    const partner = await db.partners.get(partnerId);
    if (!partner) return undefined;
    const [capitalMoves, draws, shares] = await Promise.all([
      db.capitalMoves.where('partnerId').equals(partnerId).toArray(),
      db.partnerDraws.where('partnerId').equals(partnerId).toArray(),
      sharesOf(db, partnerId),
    ]);
    return {
      partner,
      account: partnerAccountOf(partnerId, { capitalMoves, draws, shares }),
      moves: capitalMoves.sort(newestFirst),
      draws: draws.sort(newestFirst),
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
async function sharesOf(
  db: ShopDatabase,
  partnerId?: string,
): Promise<{ partnerId: string; amountCents: number; voided: boolean }[]> {
  const shares =
    partnerId === undefined
      ? await db.settlementShares.toArray()
      : await db.settlementShares.where('partnerId').equals(partnerId).toArray();
  return shares.map((share) => ({
    partnerId: share.partnerId,
    amountCents: share.amountCents,
    voided: share.voidedAt !== null,
  }));
}

function needsConfirmation(): ValidationError {
  return new ValidationError([
    { path: ['confirmed'], message: NEEDS_CONFIRMATION, code: 'custom' },
  ]);
}
