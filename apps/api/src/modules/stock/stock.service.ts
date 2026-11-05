import {
  type BatchDetail,
  type BatchHistory,
  batchLedgerOf,
  checkBatchMove,
  checkProductRemoval,
  type ProductBatch,
  type ProductStockMove,
  type SequencedProductMove,
  withLockedMoveCosts,
} from '@fabric/contracts';
import type { ProductStockBatchLedger } from '@fabric/core';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException } from '../../common/index.js';
import { type SyncedRow, type SyncHandler, SyncRegistry, SyncRejection } from '../sync/index.js';
import { BatchRepository, ProductStockMoveRepository } from './stock.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * The shop's stock (ADR 0012): batches and their moves. Derived figures come from
 * @fabric/core through the moves; the other modules (purchasing, sales, settlements, integrity)
 * reach stock only through here.
 */
@Injectable()
export class StockService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly batches: BatchRepository,
    private readonly moves: ProductStockMoveRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.batches);
    const moves: SyncHandler<'product_stock_move'> = {
      entity: 'product_stock_move',
      find: (id) => this.moves.find(id),
      pull: (since, limit) => this.moves.pull(since, limit),
      append: (move, context) => this.record(move, context),
    };
    this.registry.register(moves);
    // A product is cancelled, never deleted, and only once it holds no stock (PB20).
    this.registry.addVoidGuard('product', {
      assertCanVoid: (productId) => this.assertProductRemovable(productId),
    });
  }

  /** Refuses the removal of a product that still holds stock, on the server's own ledgers. */
  private async assertProductRemovable(productId: string): Promise<void> {
    const batches = await this.batches.listByProduct(productId);
    const ledgers = await this.ledgers(batches.map((batch) => batch.record.id));
    const issues = checkProductRemoval([...ledgers.values()]);
    if (issues.length > 0) {
      throw new SyncRejection(
        'validation_failed',
        'The product still holds stock: sell it or record it as lost first',
        issues,
      );
    }
  }

  /** For a purchase: its batches and their receipts, in the caller's transaction. */
  async receive(
    batches: readonly ProductBatch[],
    moves: readonly ProductStockMove[],
  ): Promise<SyncedRow<ProductBatch>[]> {
    const inserted = await this.batches.insertMany(batches);
    await this.moves.insertMany(moves);
    return inserted;
  }

  /** Moves that come inside another record's op (a sale, a return, a void), in its transaction. */
  async insertMoves(moves: readonly ProductStockMove[]): Promise<void> {
    await this.moves.insertMany(moves);
  }

  /**
   * Each batch with every move it has so far (for pricing a sale on the server's view), with the
   * costs settlements froze (P9).
   */
  async histories(batchIds: readonly string[]): Promise<Map<string, BatchHistory>> {
    const unique = [...new Set(batchIds)];
    const [batches, rows] = await Promise.all([
      this.batches.findMany(unique),
      this.moves.listByBatches(unique),
    ]);
    const moves = await this.withLockedCosts(rows.map(stored));
    return new Map(
      batches.map((batch) => [
        batch.record.id,
        { batch: batch.record, moves: moves.filter((move) => move.batchId === batch.record.id) },
      ]),
    );
  }

  async ledgers(batchIds: readonly string[]): Promise<Map<string, ProductStockBatchLedger>> {
    const histories = await this.histories(batchIds);
    return new Map(
      [...histories].map(([id, history]) => [id, batchLedgerOf(history.batch, history.moves)]),
    );
  }

  /** The moves these records caused (a sale's lines). */
  async movesOf(refIds: readonly string[]): Promise<ProductStockMove[]> {
    return (await this.moves.listByRefs(refIds)).map((row) => row.record);
  }

  batchesOfPurchase(purchaseId: string): Promise<SyncedRow<ProductBatch>[]> {
    return this.batches.listByPurchase(purchaseId);
  }

  async detail(batchId: string): Promise<BatchDetail> {
    const batch = await this.batches.find(batchId);
    if (!batch) {
      throw new AppHttpException('not_found', `No batch ${batchId}`, HttpStatus.NOT_FOUND);
    }
    const moves = await this.withLockedCosts(
      (await this.moves.listByBatches([batchId])).map(stored),
    );
    return {
      batch: stored(batch),
      moves,
      ledger: batchLedgerOf(batch.record, moves),
    };
  }

  private async withLockedCosts<M extends SequencedProductMove & { serverSeq: number }>(
    moves: readonly M[],
  ): Promise<M[]> {
    return withLockedMoveCosts(moves, await this.moves.lockedCosts(moves.map((move) => move.id)));
  }

  /** A loss, count or measurement pushed by a device: re-checked against its batch. */
  private async record(
    move: ProductStockMove,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<ProductStockMove>> {
    if (move.id !== context.entityId || move.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The move does not match the op (id or device)');
    }
    const batch = await this.batches.find(move.batchId);
    if (!batch) throw new SyncRejection('conflict', 'Refers to a batch the server does not have');
    const history = (await this.moves.listByBatches([move.batchId])).map((row) => row.record);
    const issues = checkBatchMove(move, batch.record, history);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'Invalid stock move', issues);
    }
    await this.moves.insertMany([move]);
    const inserted = await this.moves.find(move.id);
    if (!inserted) throw new Error(`stock move ${move.id} not stored`);
    return inserted;
  }
}
