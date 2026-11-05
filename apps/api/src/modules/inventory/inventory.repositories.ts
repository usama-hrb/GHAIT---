import type { Roll, StockMove } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt } from 'drizzle-orm';
import { baseOf, schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow, SyncHandler } from '../sync/index.js';

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

/** The rolls the stock was kept on before batches (ADR 0012): read, never written. */
@Injectable()
export class RollRepository implements SyncHandler<'roll'> {
  readonly entity = 'roll' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Roll> | undefined> {
    const [row] = await this.tx.db.select().from(schema.roll).where(eq(schema.roll.id, id));
    return row && rollOf(row);
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

/** Their moves, as they were written: history, read and never written. */
@Injectable()
export class StockMoveRepository implements SyncHandler<'stock_move'> {
  readonly entity = 'stock_move' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<StockMove> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.stockMove)
      .where(eq(schema.stockMove.id, id));
    return row && moveOf(row);
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
