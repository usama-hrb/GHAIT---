import {
  type BatchHistory,
  buildBatchMove,
  type NewBatchActionInput,
  newBatchActionSchema,
  type ProductBatch,
  type SequencedProductMove,
  batchLedgerOf,
} from '@fabric/contracts';
import type { ProductStockBatchLedger } from '@fabric/core';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { withFrozenCosts } from './ledgers';
import type { LocalStore } from './store';
import type { BatchesTable } from './tables';

/** Each batch with every move it has on this device, frozen costs kept (P9). */
export async function batchHistories(
  db: ShopDatabase,
  batchIds: readonly string[],
): Promise<Map<string, BatchHistory>> {
  const ids = [...new Set(batchIds)];
  const [batches, moves] = await Promise.all([
    db.productBatches.bulkGet(ids),
    db.productStockMoves
      .where('batchId')
      .anyOf(ids)
      .toArray()
      .then((all) => withFrozenCosts(db, all)),
  ]);
  const histories = new Map<string, BatchHistory>();
  for (const batch of batches) {
    if (batch) {
      histories.set(batch.id, { batch, moves: moves.filter((move) => move.batchId === batch.id) });
    }
  }
  return histories;
}

/** The batches' ledgers as @fabric/core derives them from their moves. */
export function ledgersOf(
  histories: ReadonlyMap<string, BatchHistory>,
): Map<string, ProductStockBatchLedger> {
  return new Map(
    [...histories].map(([id, history]) => [id, batchLedgerOf(history.batch, history.moves)]),
  );
}

/** The batch and its moves, history order as the ledger reads them. */
export interface BatchView {
  batch: Local<ProductBatch>;
  moves: (Local<SequencedProductMove> & { serverSeq: number | null })[];
  ledger: ProductStockBatchLedger;
}

/**
 * The stock actions of a batch (SPEC §2.4, ADR 0012): a loss, a stocktake count, a measurement
 * of a length, and the remnant mark. Each is a stock move saved with one outbox op in one local
 * transaction (an append-only record: a correction is a new move); the server re-checks it
 * against the batch (checkBatchMove). Every figure comes from @fabric/core through the moves.
 */
export class StockRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly batches: BatchesTable,
  ) {}

  async view(batchId: string): Promise<BatchView | undefined> {
    const history = (await batchHistories(this.store.db, [batchId])).get(batchId);
    if (!history) return undefined;
    return {
      batch: history.batch as Local<ProductBatch>,
      moves: history.moves as BatchView['moves'],
      ledger: batchLedgerOf(history.batch, history.moves),
    };
  }

  /**
   * Records a loss, a count or a measurement of a batch. Throws ValidationError when it changes
   * nothing or the ledger cannot read it. Returns the move's id.
   */
  async act(input: NewBatchActionInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newBatchActionSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const id = crypto.randomUUID();
    await db.transaction(
      'rw',
      [db.productBatches, db.productStockMoves, db.lockedCosts, db.outbox, db.settlements],
      async () => {
        const view = await this.view(parsed.batchId);
        if (!view) throw new Error(`No batch ${parsed.batchId}`);
        const built = buildBatchMove(parsed, view.batch, view.ledger, {
          id,
          deviceId,
          now,
          actor: this.store.username(),
        });
        if (!built.ok) throw new ValidationError(built.issues);
        await db.productStockMoves.put({ ...built.move, serverSeq: null });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'product_stock_move',
          entityId: id,
          kind: 'append',
          payload: built.move,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
    return id;
  }

  /** Marks a batch a remnant (a short end the shop sells off), or back to active. */
  async setRemnant(batchId: string, remnant: boolean): Promise<void> {
    await this.batches.setStatus(batchId, remnant ? 'remnant' : 'active');
  }
}
