import {
  type DataExport,
  dataExportSchema,
  EXPORT_ENTITIES,
  type Fabric,
  type Roll,
  rollLedgerOf,
  type SyncConflict,
  type Variant,
} from '@fabric/contracts';
import type { RollLedger } from '@fabric/core';
import type { Local, OutboxEntry } from './db';
import { withFrozenCosts } from './ledgers';
import type { LocalStore } from './store';
import { PULLED_AT, tableOf } from './sync';

export interface RollToReview {
  roll: Local<Roll>;
  variant: Local<Variant> | undefined;
  fabric: Local<Fabric> | undefined;
  ledger: RollLedger;
}

/**
 * What needs the owner's eye after syncing (BUILD_PROMPTS 3.6): changes the server refused,
 * conflicts it settled, and rolls sold beyond their length (two devices offline, or an estimate
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

  /** Rolls with less than nothing left, or length sold that was not on them: count or measure them. */
  async rollsToReview(): Promise<RollToReview[]> {
    const { db } = this.store;
    const [rolls, moves, variants, fabrics] = await Promise.all([
      db.rolls.toArray(),
      db.stockMoves.toArray().then((all) => withFrozenCosts(db, all)),
      db.variants.toArray(),
      db.fabrics.toArray(),
    ]);
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const fabricById = new Map(fabrics.map((fabric) => [fabric.id, fabric]));
    return rolls.flatMap((roll) => {
      const ledger = rollLedgerOf(
        roll,
        moves.filter((move) => move.rollId === roll.id),
      );
      if (ledger.remainingCm >= 0 && ledger.oversoldCm === 0) return [];
      const variant = variantById.get(roll.variantId);
      return [{ roll, variant, fabric: variant && fabricById.get(variant.fabricId), ledger }];
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
