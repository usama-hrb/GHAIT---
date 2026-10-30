import { checkRollUpdate, type Roll, type StockMove } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type Base = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deviceId: string;
  voidedAt: Date | null;
};

function baseOf(row: Base) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deviceId: row.deviceId,
    voidedAt: row.voidedAt?.toISOString() ?? null,
  };
}

function baseValues(record: {
  id: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
}) {
  return {
    id: record.id,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    deviceId: record.deviceId,
  };
}

type RollRow = typeof schema.roll.$inferSelect;

function rollOf(row: RollRow): SyncedRow<Roll> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      shortCode: row.shortCode,
      variantId: row.variantId,
      purchaseId: row.purchaseId,
      lengthCmInitial: row.lengthCmInitial,
      costTotalCents: row.costTotalCents,
      lengthEstimated: row.lengthEstimated,
      status: row.status,
    },
  };
}

/**
 * Rolls are created with their purchase; afterwards only their remnant mark changes (an upsert
 * op, last write wins). Every other field is fixed (checkRollUpdate).
 */
@Injectable()
export class RollRepository implements SyncHandler<'roll'> {
  readonly entity = 'roll' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Roll> | undefined> {
    const [row] = await this.tx.db.select().from(schema.roll).where(eq(schema.roll.id, id));
    return row && rollOf(row);
  }

  async write(record: Roll): Promise<SyncedRow<Roll>> {
    const current = await this.find(record.id);
    if (!current) throw new SyncRejection('not_found', 'Rolls are created with their purchase');
    const issues = checkRollUpdate(current.record, record);
    if (issues.length > 0)
      throw new SyncRejection(
        'validation_failed',
        'Only the remnant mark of a roll can change',
        issues,
      );
    const [row] = await this.tx.db
      .update(schema.roll)
      .set({
        status: record.status,
        updatedAt: new Date(record.updatedAt),
        deviceId: record.deviceId,
      })
      .where(eq(schema.roll.id, record.id))
      .returning();
    if (!row) throw new Error(`no roll ${record.id}`);
    return rollOf(row);
  }

  markVoided(): Promise<SyncedRow<Roll>> {
    return Promise.reject(
      new SyncRejection('bad_request', 'A roll is cancelled with its purchase'),
    );
  }

  async insertMany(rolls: readonly Roll[]): Promise<SyncedRow<Roll>[]> {
    const rows = await this.tx.db
      .insert(schema.roll)
      .values(
        rolls.map((roll) => ({
          ...baseValues(roll),
          shortCode: roll.shortCode,
          variantId: roll.variantId,
          purchaseId: roll.purchaseId,
          lengthCmInitial: roll.lengthCmInitial,
          costTotalCents: roll.costTotalCents,
          lengthEstimated: roll.lengthEstimated,
          status: roll.status,
        })),
      )
      .returning();
    return rows.map(rollOf);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Roll>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.roll)
      .where(gt(schema.roll.serverSeq, since))
      .orderBy(asc(schema.roll.serverSeq))
      .limit(limit);
    return rows.map(rollOf);
  }

  async findMany(ids: readonly string[]): Promise<SyncedRow<Roll>[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.roll)
      .where(inArray(schema.roll.id, [...ids]));
    return rows.map(rollOf);
  }

  async listByPurchase(purchaseId: string): Promise<SyncedRow<Roll>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.roll)
      .where(eq(schema.roll.purchaseId, purchaseId))
      .orderBy(asc(schema.roll.shortCode));
    return rows.map(rollOf);
  }
}

type MoveRow = typeof schema.stockMove.$inferSelect;

function moveOf(row: MoveRow): SyncedRow<StockMove> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      rollId: row.rollId,
      type: row.type,
      deltaCm: row.deltaCm,
      refId: row.refId,
      date: row.date,
      note: row.note,
    },
  };
}

/** Append-only (row guards). Losses, counts and measurements arrive as their own append ops. */
@Injectable()
export class StockMoveRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<StockMove> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(eq(schema.stockMove.id, id));
    return row && moveOf(row);
  }

  async listByRoll(rollId: string): Promise<SyncedRow<StockMove>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(eq(schema.stockMove.rollId, rollId))
      .orderBy(asc(schema.stockMove.createdAt), asc(schema.stockMove.id));
    return rows.map(moveOf);
  }

  /** Every move of these rolls, in history order. */
  async listByRolls(rollIds: readonly string[]): Promise<SyncedRow<StockMove>[]> {
    if (rollIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(inArray(schema.stockMove.rollId, [...rollIds]))
      .orderBy(asc(schema.stockMove.createdAt), asc(schema.stockMove.id));
    return rows.map(moveOf);
  }

  /** The moves a record caused (a sale's lines, a purchase…). */
  async listByRefs(refIds: readonly string[]): Promise<SyncedRow<StockMove>[]> {
    if (refIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(inArray(schema.stockMove.refId, [...refIds]))
      .orderBy(asc(schema.stockMove.createdAt), asc(schema.stockMove.id));
    return rows.map(moveOf);
  }

  async insertMany(moves: readonly StockMove[]): Promise<void> {
    await this.tx.db.insert(schema.stockMove).values(
      moves.map((move) => ({
        ...baseValues(move),
        rollId: move.rollId,
        type: move.type,
        deltaCm: move.deltaCm,
        refId: move.refId,
        date: move.date,
        note: move.note,
      })),
    );
  }

  async pull(since: number, limit: number): Promise<SyncedRow<StockMove>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(gt(schema.stockMove.serverSeq, since))
      .orderBy(asc(schema.stockMove.serverSeq))
      .limit(limit);
    return rows.map(moveOf);
  }
}
