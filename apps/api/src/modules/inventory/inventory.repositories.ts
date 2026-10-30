import type { Roll, StockMove } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow, SyncHandler } from '../sync/index.js';

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

/** Rolls reach devices by pull; they are created with their purchase (pull_only for now). */
@Injectable()
export class RollRepository implements SyncHandler<'roll'> {
  readonly entity = 'roll' as const;

  constructor(private readonly tx: TransactionHost) {}

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

/** Append-only (row guards); losses and corrections arrive as their own ops with BUILD_PROMPTS 3.3. */
@Injectable()
export class StockMoveRepository implements SyncHandler<'stock_move'> {
  readonly entity = 'stock_move' as const;

  constructor(private readonly tx: TransactionHost) {}

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
