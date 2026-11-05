import {
  batchLedgerOf,
  type DataExport,
  dataExportSchema,
  EXPORT_ENTITIES,
  type Product,
  type ProductBatch,
  type SyncConflict,
} from '@fabric/contracts';
import type { ProductStockBatchLedger } from '@fabric/core';
import type { Local, OutboxEntry } from './db';
import { withFrozenCosts } from './ledgers';
import type { LocalStore } from './store';
import { PULLED_AT, tableOf } from './sync';

export interface BatchToReview {
  batch: Local<ProductBatch>;
  product: Local<Product> | undefined;
  ledger: ProductStockBatchLedger;
}

/**
 * What needs the owner's eye after syncing (BUILD_PROMPTS 3.6): changes the server refused,
 * conflicts it settled, and batches sold beyond what they held (two devices offline, or an estimate
 * that was too short). Plus a full export of the device's data.
 */
export class MaintenanceRepository {
  constructor(private readonly store: LocalStore) {}

  /**
   * Whether this device has pulled the whole shop at least once. Until then a missing record may
   * just not be here yet: a set-up screen waits instead of creating a second one.
   */
  async pulledOnce(): Promise<boolean> {
    return (await this.store.getMeta(PULLED_AT)) !== undefined;
  }

  /** Changes the server refused, oldest first (never retried as they are, ADR 0002). */
  rejected(): Promise<OutboxEntry[]> {
    return this.store.db.outbox.where('state').equals('rejected').sortBy('seq');
  }

  /** The server's conflict log, newest first. */
  async conflicts(): Promise<Local<SyncConflict>[]> {
    const conflicts = await this.store.db.syncConflicts.toArray();
    return conflicts.sort(
      (a, b) => (b.serverSeq ?? 0) - (a.serverSeq ?? 0) || b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** Batches with less than nothing left, or more sold than was on them: count or measure them. */
  async batchesToReview(): Promise<BatchToReview[]> {
    const { db } = this.store;
    const [batches, moves, products] = await Promise.all([
      db.productBatches.toArray(),
      db.productStockMoves.toArray().then((all) => withFrozenCosts(db, all)),
      db.products.toArray(),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    return batches.flatMap((batch) => {
      let ledger: ProductStockBatchLedger;
      try {
        ledger = batchLedgerOf(
          batch,
          moves.filter((move) => move.batchId === batch.id),
        );
      } catch {
        return []; // A history the ledger cannot read has nothing to show here.
      }
      const oversold =
        ledger.oversold.unit === 'meter'
          ? ledger.oversold.centimeters
          : ledger.oversold.unit === 'piece'
            ? ledger.oversold.pieces
            : ledger.oversold.grams;
      return oversold > 0 ? [{ batch, product: productById.get(batch.productId), ledger }] : [];
    });
  }

  /** Everything on this device, in the export format `make import` reads (a full copy of the shop). */
  async exportData(): Promise<DataExport> {
    const { db } = this.store;
    const records = Object.fromEntries(
      await Promise.all(
        // The schemas drop server_seq (not a record field): the import numbers records anew.
        EXPORT_ENTITIES.map(
          async (entity) => [entity, await tableOf(db, entity).toArray()] as const,
        ),
      ),
    );
    return dataExportSchema.parse({
      format: 'fabric-shop-export',
      version: 1,
      exportedAt: this.store.now().toISOString(),
      source: 'device',
      devices: [],
      records,
    });
  }
}
