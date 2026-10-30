import type {
  Fabric,
  Purchase,
  Roll,
  StockMove,
  Supplier,
  SyncedSetting,
  SyncOp,
  SyncOpResult,
  Variant,
} from '@fabric/contracts';
import { Dexie, type EntityTable } from 'dexie';

/** A synced record on the device, with the server_seq of the version it was last synced at. */
export type Local<R> = R & {
  /** null: created here and not pushed yet. */
  serverSeq: number | null;
};

/** A change waiting to be pushed (ADR 0002 outbox). */
export interface OutboxEntry extends SyncOp {
  /** Local order: ops are pushed oldest first. */
  seq?: number;
  /** `rejected`: the server refused it; kept and shown, never retried as is. */
  state: 'pending' | 'rejected';
  error: SyncOpResult['error'];
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * The device's replica of the shop (IndexedDB through Dexie). Each slice adds a new version()
 * with its tables; a released version is never edited, so devices upgrade in place.
 */
export class ShopDatabase extends Dexie {
  fabrics!: EntityTable<Local<Fabric>, 'id'>;
  variants!: EntityTable<Local<Variant>, 'id'>;
  suppliers!: EntityTable<Local<Supplier>, 'id'>;
  settings!: EntityTable<Local<SyncedSetting>, 'id'>;
  purchases!: EntityTable<Local<Purchase>, 'id'>;
  rolls!: EntityTable<Local<Roll>, 'id'>;
  stockMoves!: EntityTable<Local<StockMove>, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'fabric-shop') {
    super(name);
    // v1, BUILD_PROMPTS 3.1: catalog, settings (pulled), outbox, device metadata.
    this.version(1).stores({
      fabrics: 'id, name',
      variants: 'id, fabricId',
      suppliers: 'id, name',
      settings: 'id, key',
      outbox: '++seq, opId, entityId, state',
      meta: 'key',
    });
    // v2, BUILD_PROMPTS 3.2: purchases and the rolls and stock moves they create.
    this.version(2).stores({
      purchases: 'id, date',
      rolls: 'id, variantId, purchaseId, shortCode',
      stockMoves: 'id, rollId',
    });
  }
}
