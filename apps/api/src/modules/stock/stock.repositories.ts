import { checkBatchUpdate, type ProductBatch, type ProductStockMove } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
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

type BatchRow = typeof schema.productBatch.$inferSelect;

function batchOf(row: BatchRow): SyncedRow<ProductBatch> {
  const conversion =
    row.conversionWeightG !== null &&
    row.conversionLengthCm !== null &&
    row.conversionSource !== null
      ? {
          weightG: row.conversionWeightG,
          lengthCm: row.conversionLengthCm,
          source: row.conversionSource,
        }
      : null;
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      code: row.code,
      productId: row.productId,
      purchaseId: row.purchaseId,
      purchaseDate: row.purchaseDate,
      unit: row.unit,
      receivedQuantity: row.receivedQuantity,
      costTotalCents: row.costTotalCents,
      conversion,
      status: row.status,
    },
  };
}

/**
 * Batches are created with their purchase; afterwards only their remnant mark changes (an upsert
 * op, last write wins). Every other field is fixed (checkBatchUpdate).
 */
@Injectable()
export class BatchRepository implements SyncHandler<'product_batch'> {
  readonly entity = 'product_batch' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<ProductBatch> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.productBatch)
      .where(eq(schema.productBatch.id, id));
    return row && batchOf(row);
  }

  async write(record: ProductBatch): Promise<SyncedRow<ProductBatch>> {
    const current = await this.find(record.id);
    if (!current) {
      throw new SyncRejection('not_found', 'Batches are created with their purchase');
    }
    const issues = checkBatchUpdate(current.record, record);
    if (issues.length > 0) {
      throw new SyncRejection(
        'validation_failed',
        'Only the remnant mark of a batch can change',
        issues,
      );
    }
    const [row] = await this.tx.db
      .update(schema.productBatch)
      .set({
        status: record.status,
        updatedAt: new Date(record.updatedAt),
        deviceId: record.deviceId,
      })
      .where(eq(schema.productBatch.id, record.id))
      .returning();
    if (!row) throw new Error(`no batch ${record.id}`);
    return batchOf(row);
  }

  markVoided(): Promise<SyncedRow<ProductBatch>> {
    return Promise.reject(
      new SyncRejection('bad_request', 'A batch is cancelled with its purchase'),
    );
  }

  async insertMany(batches: readonly ProductBatch[]): Promise<SyncedRow<ProductBatch>[]> {
    const rows = await this.tx.db
      .insert(schema.productBatch)
      .values(
        batches.map((batch) => ({
          ...baseValues(batch),
          code: batch.code,
          productId: batch.productId,
          purchaseId: batch.purchaseId,
          purchaseDate: batch.purchaseDate,
          unit: batch.unit,
          receivedQuantity: batch.receivedQuantity,
          costTotalCents: batch.costTotalCents,
          conversionWeightG: batch.conversion?.weightG ?? null,
          conversionLengthCm: batch.conversion?.lengthCm ?? null,
          conversionSource: batch.conversion?.source ?? null,
          status: batch.status,
        })),
      )
      .returning();
    return rows.map(batchOf);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<ProductBatch>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.productBatch)
      .where(gt(schema.productBatch.serverSeq, since))
      .orderBy(asc(schema.productBatch.serverSeq))
      .limit(limit);
    return rows.map(batchOf);
  }

  async findMany(ids: readonly string[]): Promise<SyncedRow<ProductBatch>[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.productBatch)
      .where(inArray(schema.productBatch.id, [...ids]));
    return rows.map(batchOf);
  }

  /** A product's batches that were not cancelled with a purchase. */
  async listByProduct(productId: string): Promise<SyncedRow<ProductBatch>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.productBatch)
      .where(
        and(eq(schema.productBatch.productId, productId), isNull(schema.productBatch.voidedAt)),
      );
    return rows.map(batchOf);
  }

  async listByPurchase(purchaseId: string): Promise<SyncedRow<ProductBatch>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.productBatch)
      .where(eq(schema.productBatch.purchaseId, purchaseId))
      .orderBy(asc(schema.productBatch.code));
    return rows.map(batchOf);
  }
}

type MoveRow = typeof schema.productStockMove.$inferSelect;

function moveOf(row: MoveRow): SyncedRow<ProductStockMove> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      batchId: row.batchId,
      type: row.type,
      unit: row.unit,
      delta: row.delta,
      refId: row.refId,
      date: row.date,
      note: row.note,
      actor: row.actor,
    },
  };
}

/** Append-only (row guards). Losses, counts and measurements arrive as their own append ops. */
@Injectable()
export class ProductStockMoveRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<ProductStockMove> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.productStockMove)
      .where(eq(schema.productStockMove.id, id));
    return row && moveOf(row);
  }

  /** Every move of these batches, in history order. */
  async listByBatches(batchIds: readonly string[]): Promise<SyncedRow<ProductStockMove>[]> {
    if (batchIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.productStockMove)
      .where(inArray(schema.productStockMove.batchId, [...batchIds]))
      .orderBy(asc(schema.productStockMove.serverSeq));
    return rows.map(moveOf);
  }

  /** The moves a record caused (a sale's lines, a purchase…). */
  async listByRefs(refIds: readonly string[]): Promise<SyncedRow<ProductStockMove>[]> {
    if (refIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.productStockMove)
      .where(inArray(schema.productStockMove.refId, [...refIds]))
      .orderBy(asc(schema.productStockMove.serverSeq));
    return rows.map(moveOf);
  }

  /** The costs live settlements froze for these moves (P9). */
  async lockedCosts(
    moveIds: readonly string[],
  ): Promise<{ stockMoveId: string; costCents: number; voidedAt: null }[]> {
    if (moveIds.length === 0) return [];
    const rows = await this.tx.db
      .select({
        stockMoveId: schema.lockedCost.stockMoveId,
        costCents: schema.lockedCost.costCents,
      })
      .from(schema.lockedCost)
      .where(
        and(
          inArray(schema.lockedCost.stockMoveId, [...moveIds]),
          isNull(schema.lockedCost.voidedAt),
        ),
      );
    return rows.map((row) => ({ ...row, voidedAt: null }));
  }

  async insertMany(moves: readonly ProductStockMove[]): Promise<void> {
    await this.tx.db.insert(schema.productStockMove).values(
      moves.map((move) => ({
        ...baseValues(move),
        batchId: move.batchId,
        type: move.type,
        unit: move.unit,
        delta: move.delta,
        refId: move.refId,
        date: move.date,
        note: move.note,
        actor: move.actor,
      })),
    );
  }

  async pull(since: number, limit: number): Promise<SyncedRow<ProductStockMove>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.productStockMove)
      .where(gt(schema.productStockMove.serverSeq, since))
      .orderBy(asc(schema.productStockMove.serverSeq))
      .limit(limit);
    return rows.map(moveOf);
  }
}
