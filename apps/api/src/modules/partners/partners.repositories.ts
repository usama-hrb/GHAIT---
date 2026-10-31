import {
  type CapitalMove,
  checkCapitalMove,
  checkCapitalMoveVoid,
  checkUnchanged,
  PARTNER_ISSUES,
  type Partner,
  type PartnerDraw,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type PartnerRow = typeof schema.partner.$inferSelect;

function partnerOf(row: PartnerRow): SyncedRow<Partner> {
  return {
    serverSeq: row.serverSeq,
    record: { ...baseOf(row), name: row.name, ownershipBp: row.ownershipBp, isOwner: row.isOwner },
  };
}

/** The owner and the partner (SPEC §6): mutable, last write wins. */
@Injectable()
export class PartnerRepository implements SyncHandler<'partner'> {
  readonly entity = 'partner' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Partner> | undefined> {
    const [row] = await this.tx.db.select().from(schema.partner).where(eq(schema.partner.id, id));
    return row && partnerOf(row);
  }

  async write(record: Partner): Promise<SyncedRow<Partner>> {
    // S4: the owner and one partner. A device that set them up again before it had pulled
    // them would otherwise add two more.
    if (!(await this.find(record.id))) {
      const live = (await this.list()).filter((row) => row.record.voidedAt === null);
      if (live.length >= 2) {
        throw new SyncRejection('validation_failed', 'The two partners are set up already', [
          { path: ['id'], message: PARTNER_ISSUES.alreadySetUp, code: 'custom' },
        ]);
      }
    }
    const fields = {
      name: record.name,
      ownershipBp: record.ownershipBp,
      isOwner: record.isOwner,
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
    },
  };
}

const DRAW_FIELDS = ['partnerId', 'amountCents', 'date', 'reason'] as const;

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
