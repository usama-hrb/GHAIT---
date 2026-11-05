import {
  type CapitalMove,
  checkCapitalMove,
  checkCapitalMoveVoid,
  checkPartnerExit,
  checkPartnerVoid,
  checkPartnerWrite,
  checkUnchanged,
  type Partner,
  type PartnerDraw,
  shopDate,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type PartnerRow = typeof schema.partner.$inferSelect;

function partnerOf(row: PartnerRow): SyncedRow<Partner> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      name: row.name,
      ownershipBp: row.ownershipBp,
      isOwner: row.isOwner,
      phone: row.phone,
      title: row.title,
      startDate: row.startDate,
      notes: row.notes,
      exitedOn: row.exitedOn,
      exitNote: row.exitNote,
    },
  };
}

/** The owner and the partners (SPEC §6, S17): mutable, last write wins. */
@Injectable()
export class PartnerRepository implements SyncHandler<'partner'> {
  readonly entity = 'partner' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Partner> | undefined> {
    const [row] = await this.tx.db.select().from(schema.partner).where(eq(schema.partner.id, id));
    return row && partnerOf(row);
  }

  /** Whether a login account that is switched on belongs to this partner (ADR 0024). */
  async hasActiveLogin(id: string): Promise<boolean> {
    const [row] = await this.tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(
        and(
          eq(schema.appUser.partnerId, id),
          isNull(schema.appUser.deactivatedAt),
          isNull(schema.appUser.voidedAt),
        ),
      );
    return row !== undefined;
  }

  async write(record: Partner): Promise<SyncedRow<Partner>> {
    // S4, S17: one owner, who stays the owner, and no more than 100% owned between everyone. A
    // device that set the owner up again before it had pulled them would otherwise add a second.
    const current = await this.find(record.id);
    const partners = (await this.list()).map((row) => row.record);
    const issues = checkPartnerWrite(record, current?.record, partners);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'These partners do not fit together', issues);
    }
    if (record.exitedOn !== null && record.voidedAt === null && current?.record.exitedOn == null) {
      // S20: a partner exits only owning nothing, with no rule giving them a share from the day
      // they leave. The exit is the last record a device writes for it, so a device that has not
      // yet pushed its ownership and rule changes is refused here, and nothing is half done.
      const exitIssues = checkPartnerExit(
        { ...record, exitedOn: record.exitedOn },
        current?.record,
        {
          today: shopDate(new Date()),
          partners,
          rules: await this.liveRules(),
        },
      );
      if (exitIssues.length > 0) {
        throw new SyncRejection('validation_failed', 'This partner cannot exit yet', exitIssues);
      }
    }
    const fields = {
      name: record.name,
      ownershipBp: record.ownershipBp,
      isOwner: record.isOwner,
      phone: record.phone,
      title: record.title,
      startDate: record.startDate,
      notes: record.notes,
      exitedOn: record.exitedOn,
      exitNote: record.exitNote,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.partner)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.partner.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return partnerOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Partner>> {
    // S19: only a partner who took part in nothing is removed; a device that has not pulled the
    // latest records would otherwise remove one who has since been given a share or a rule.
    const { db } = this.tx;
    const partners = (await this.list()).map((row) => row.record);
    const capitalMoves = await db
      .select({ partnerId: schema.capitalMove.partnerId })
      .from(schema.capitalMove)
      .where(and(eq(schema.capitalMove.partnerId, id), isNull(schema.capitalMove.voidedAt)));
    const draws = await db
      .select({ partnerId: schema.partnerDraw.partnerId })
      .from(schema.partnerDraw)
      .where(and(eq(schema.partnerDraw.partnerId, id), isNull(schema.partnerDraw.voidedAt)));
    const shares = await db
      .select({ partnerId: schema.settlementShare.partnerId })
      .from(schema.settlementShare)
      .where(
        and(eq(schema.settlementShare.partnerId, id), isNull(schema.settlementShare.voidedAt)),
      );
    const rules = await db
      .select({ partnerWeights: schema.profitSplitRule.partnerWeights })
      .from(schema.profitSplitRule)
      .where(isNull(schema.profitSplitRule.voidedAt));
    const issues = checkPartnerVoid(id, {
      partners,
      capitalMoves: capitalMoves.map(({ partnerId }) => ({ partnerId, voidedAt: null })),
      draws: draws.map(({ partnerId }) => ({ partnerId, voidedAt: null })),
      shares: shares.map(({ partnerId }) => ({ partnerId, voidedAt: null })),
      rules: rules.map(({ partnerWeights }) => ({ partnerWeights, voidedAt: null })),
    });
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'A partner who took part stays', issues);
    }
    const [row] = await this.tx.db
      .update(schema.partner)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.partner.id, id))
      .returning();
    if (!row) throw new Error(`no partner ${id}`);
    return partnerOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Partner>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.partner)
      .where(gt(schema.partner.serverSeq, since))
      .orderBy(asc(schema.partner.serverSeq))
      .limit(limit);
    return rows.map(partnerOf);
  }

  async list(): Promise<SyncedRow<Partner>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.partner)
      .orderBy(asc(schema.partner.createdAt));
    return rows.map(partnerOf);
  }

  /** The profit rules in force (a voided one is read as voided), for the checks of an exit. */
  private async liveRules() {
    const rows = await this.tx.db.select().from(schema.profitSplitRule);
    return rows.map((row) => ({
      effectiveFrom: row.effectiveFrom,
      ownerWeight: row.ownerWeight,
      partnerWeight: row.partnerWeight,
      shopWeight: row.shopWeight,
      partnerWeights: row.partnerWeights,
      voidedAt: row.voidedAt?.toISOString() ?? null,
    }));
  }
}

type MoveRow = typeof schema.capitalMove.$inferSelect;

function moveOf(row: MoveRow): SyncedRow<CapitalMove> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      partnerId: row.partnerId,
      type: row.type,
      amountCents: row.amountCents,
      date: row.date,
      note: row.note,
      settlementId: row.settlementId,
    },
  };
}

const MOVE_FIELDS = ['partnerId', 'type', 'amountCents', 'date', 'note', 'settlementId'] as const;

/** Capital moves (SPEC §8.4): created once (checkCapitalMove), then only voided (PA3). */
@Injectable()
export class CapitalMoveRepository implements SyncHandler<'capital_move'> {
  readonly entity = 'capital_move' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<CapitalMove> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.capitalMove)
      .where(eq(schema.capitalMove.id, id));
    return row && moveOf(row);
  }

  async write(record: CapitalMove): Promise<SyncedRow<CapitalMove>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(current.record, record, MOVE_FIELDS);
      if (issues.length > 0)
        throw new SyncRejection('validation_failed', 'A capital move is never edited', issues);
      return current;
    }
    const issues = checkCapitalMove(record);
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid capital move', issues);
    const [row] = await this.tx.db
      .insert(schema.capitalMove)
      .values({
        ...baseValues(record),
        partnerId: record.partnerId,
        type: record.type,
        amountCents: record.amountCents,
        date: record.date,
        note: record.note,
        settlementId: record.settlementId,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return moveOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<CapitalMove>> {
    const current = await this.find(id);
    const issues = current ? checkCapitalMoveVoid(current.record) : [];
    if (issues.length > 0) {
      throw new SyncRejection(
        'validation_failed',
        'Retained profit goes with its settlement',
        issues,
      );
    }
    const [row] = await this.tx.db
      .update(schema.capitalMove)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.capitalMove.id, id))
      .returning();
    if (!row) throw new Error(`no capital move ${id}`);
    return moveOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<CapitalMove>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.capitalMove)
      .where(gt(schema.capitalMove.serverSeq, since))
      .orderBy(asc(schema.capitalMove.serverSeq))
      .limit(limit);
    return rows.map(moveOf);
  }

  /** Every settlement share (the partners' balance entries, BUILD_PROMPTS 4.3). */
  async shares(): Promise<{ partnerId: string; amountCents: number; voided: boolean }[]> {
    const rows = await this.tx.db
      .select({
        partnerId: schema.settlementShare.partnerId,
        amountCents: schema.settlementShare.amountCents,
        voidedAt: schema.settlementShare.voidedAt,
      })
      .from(schema.settlementShare);
    return rows.map((row) => ({
      partnerId: row.partnerId,
      amountCents: row.amountCents,
      voided: row.voidedAt !== null,
    }));
  }

  async listAll(): Promise<SyncedRow<CapitalMove>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.capitalMove)
      .orderBy(asc(schema.capitalMove.serverSeq));
    return rows.map(moveOf);
  }
}

type DrawRow = typeof schema.partnerDraw.$inferSelect;

function drawOf(row: DrawRow): SyncedRow<PartnerDraw> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      partnerId: row.partnerId,
      amountCents: row.amountCents,
      date: row.date,
      reason: row.reason,
      zakatReportId: row.zakatReportId,
    },
  };
}

const DRAW_FIELDS = ['partnerId', 'amountCents', 'date', 'reason', 'zakatReportId'] as const;

/** Partner draws (SPEC §8.4): created once, then only voided (PA3). */
@Injectable()
export class PartnerDrawRepository implements SyncHandler<'partner_draw'> {
  readonly entity = 'partner_draw' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<PartnerDraw> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.partnerDraw)
      .where(eq(schema.partnerDraw.id, id));
    return row && drawOf(row);
  }

  async write(record: PartnerDraw): Promise<SyncedRow<PartnerDraw>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(current.record, record, DRAW_FIELDS);
      if (issues.length > 0)
        throw new SyncRejection('validation_failed', 'A draw is never edited', issues);
      return current;
    }
    const [row] = await this.tx.db
      .insert(schema.partnerDraw)
      .values({
        ...baseValues(record),
        partnerId: record.partnerId,
        amountCents: record.amountCents,
        date: record.date,
        reason: record.reason,
        zakatReportId: record.zakatReportId,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return drawOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<PartnerDraw>> {
    const [row] = await this.tx.db
      .update(schema.partnerDraw)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.partnerDraw.id, id))
      .returning();
    if (!row) throw new Error(`no partner draw ${id}`);
    return drawOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<PartnerDraw>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.partnerDraw)
      .where(gt(schema.partnerDraw.serverSeq, since))
      .orderBy(asc(schema.partnerDraw.serverSeq))
      .limit(limit);
    return rows.map(drawOf);
  }

  async listAll(): Promise<SyncedRow<PartnerDraw>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.partnerDraw)
      .orderBy(asc(schema.partnerDraw.serverSeq));
    return rows.map(drawOf);
  }
}
