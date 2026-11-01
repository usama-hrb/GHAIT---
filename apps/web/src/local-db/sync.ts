import {
  SYNC_BATCH_MAX_BYTES,
  SYNC_ENTITIES,
  SYNC_PUSH_MAX_OPS,
  type SyncEntity,
  type SyncOp,
  type SyncOpResult,
  type SyncPullResponse,
  syncPullResponseSchema,
  syncPushResponseSchema,
  syncWeightOf,
} from '@fabric/contracts';
import type { Table } from 'dexie';
import { ApiError, NetworkError } from './api';
import type { Local, OutboxEntry, ShopDatabase } from './db';
import { withLock } from './locks';
import { type Session, SignedOutError } from './session';
import type { LocalStore } from './store';

const PULL_CURSOR = 'pullCursor';
/** When this device last pulled everything the server had: it knows the whole shop. */
export const PULLED_AT = 'pulledAt';
/** The server's data set the cursor belongs to (ADR 0002, slice 6). */
const SYNC_EPOCH = 'syncEpoch';
const PULL_LIMIT = 200;

type AnyLocal = Local<{ id: string }>;

/** The Dexie table of each synced entity. */
const TABLES = {
  fabric: 'fabrics',
  variant: 'variants',
  photo: 'photos',
  supplier: 'suppliers',
  setting: 'settings',
  purchase: 'purchases',
  roll: 'rolls',
  stock_move: 'stockMoves',
  customer: 'customers',
  sale: 'sales',
  sale_line: 'saleLines',
  payment: 'payments',
  payment_allocation: 'paymentAllocations',
  sale_void: 'saleVoids',
  sale_return: 'saleReturns',
  supplier_payment: 'supplierPayments',
  write_off: 'writeOffs',
  sync_conflict: 'syncConflicts',
  expense: 'expenses',
  recurring_expense: 'recurringExpenses',
  partner: 'partners',
  capital_move: 'capitalMoves',
  partner_draw: 'partnerDraws',
  profit_split_rule: 'profitSplitRules',
  settlement: 'settlements',
  settlement_share: 'settlementShares',
  locked_cost: 'lockedCosts',
  cash_adjustment: 'cashAdjustments',
  zakat_report: 'zakatReports',
} as const satisfies Record<SyncEntity, keyof ShopDatabase>;

/** The Dexie table of a synced entity. */
export function tableOf(db: ShopDatabase, entity: SyncEntity): Table<AnyLocal, string> {
  return db.table<AnyLocal, string>(TABLES[entity]);
}

function syncedTables(db: ShopDatabase): Table[] {
  return Object.values(TABLES).map((name) => db.table(name));
}

/**
 * Applies the server's answers to pushed ops. Applied, duplicate and conflict leave the outbox
 * (for a conflict the server kept the other device's version; the pull brings it). Rejected ops
 * stay, marked, for the user to see; they are never pushed again as they are.
 */
export async function applyPushResults(
  db: ShopDatabase,
  entries: readonly OutboxEntry[],
  results: readonly SyncOpResult[],
): Promise<void> {
  await db.transaction('rw', [db.outbox, ...syncedTables(db)], async () => {
    for (const result of results) {
      const entry = entries.find((candidate) => candidate.opId === result.opId);
      if (entry?.seq === undefined) continue;
      const status = result.status === 'duplicate' ? result.originalStatus : result.status;
      if (status === 'rejected') {
        await db.outbox.update(entry.seq, { state: 'rejected', error: result.error });
        continue;
      }
      await db.outbox.delete(entry.seq);
      if (status === 'applied' && result.serverSeq !== null) {
        // Later edits of this record are made on the version the server now has.
        await tableOf(db, entry.entity).update(entry.entityId, { serverSeq: result.serverSeq });
      }
    }
  });
}

/**
 * Applies a page of pulled changes and moves the cursor, in one transaction. A record with a
 * change still waiting in the outbox keeps its local version: the server decides when it gets
 * the op. Records this app version cannot read are skipped (a newer server).
 */
export async function applyPulledChanges(db: ShopDatabase, page: SyncPullResponse): Promise<void> {
  await db.transaction('rw', [...syncedTables(db), db.outbox, db.meta], async () => {
    for (const change of page.changes) {
      const parsed = SYNC_ENTITIES[change.entity].schema.safeParse(change.record);
      if (!parsed.success) continue;
      const record = parsed.data;
      const pending = await db.outbox
        .where('entityId')
        .equals(record.id)
        .filter((entry) => entry.state === 'pending')
        .count();
      if (pending > 0) continue;
      await tableOf(db, change.entity).put({ ...record, serverSeq: change.serverSeq });
    }
    await db.meta.put({ key: PULL_CURSOR, value: page.nextSince });
  });
}

/**
 * The oldest pending ops that go in one request: at most SYNC_PUSH_MAX_OPS, and at most
 * SYNC_BATCH_MAX_BYTES of images (a photo is ~100 KB, every other op a few hundred bytes). An op
 * over the budget on its own still goes, alone.
 */
export function takeBatch(entries: readonly OutboxEntry[]): OutboxEntry[] {
  const batch: OutboxEntry[] = [];
  let weight = 0;
  for (const entry of entries.slice(0, SYNC_PUSH_MAX_OPS)) {
    const next = weight + syncWeightOf(entry.entity, entry.payload);
    if (batch.length > 0 && next > SYNC_BATCH_MAX_BYTES) break;
    batch.push(entry);
    weight = next;
  }
  return batch;
}

/** The op as pushed: an outbox entry without its local bookkeeping. */
function toOp(entry: OutboxEntry): SyncOp {
  return {
    opId: entry.opId,
    entity: entry.entity,
    entityId: entry.entityId,
    kind: entry.kind,
    payload: entry.payload,
    deviceId: entry.deviceId,
    clientTs: entry.clientTs,
    baseServerSeq: entry.baseServerSeq,
  };
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed_out' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** ISO time of the last complete push + pull. */
  lastSyncedAt: string | null;
}

export interface SyncEngineOptions {
  /** Background sync while the app is open. */
  intervalMs?: number;
  /** Wait after a local write, so a burst of edits goes in one push. */
  debounceMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  isOnline?: () => boolean;
}

/**
 * Background sync, both ways (ADR 0002): push the outbox oldest first, then pull everything
 * after the cursor. Runs after local writes, when the connection comes back, when the app is
 * shown again and every 30 s; failures retry with exponential backoff. One tab syncs at a time.
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'idle', lastSyncedAt: null };
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private retryDelay = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: Required<SyncEngineOptions>;

  constructor(
    private readonly store: LocalStore,
    private readonly session: Session,
    options: SyncEngineOptions = {},
  ) {
    this.options = {
      intervalMs: 30_000,
      debounceMs: 400,
      retryMinMs: 2000,
      retryMaxMs: 60_000,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      ...options,
    };
  }

  readonly getStatus = (): SyncStatus => this.status;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starts background sync; returns the function that stops it. */
  start(): () => void {
    const sync = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(sync, this.options.intervalMs);
    const stopListening = this.store.onChange(() => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(sync, this.options.debounceMs);
    });
    const stopSession = this.session.subscribe(() => {
      if (this.session.getState().status === 'signed_in' && this.status.state === 'signed_out')
        sync();
    });
    sync();
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      clearTimeout(this.debounceTimer);
      clearTimeout(this.retryTimer);
      stopListening();
      stopSession();
    };
  }

  /** Syncs now; while a sync runs, one more run is queued instead. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.again = false;
    this.running = (async () => {
      try {
        do await this.cycle();
        while (this.takeRerun());
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Whether a sync was requested while one ran (and clears the request). */
  private takeRerun(): boolean {
    const again = this.again;
    this.again = false;
    return again;
  }

  private async cycle(): Promise<void> {
    clearTimeout(this.retryTimer);
    if (!this.options.isOnline()) {
      this.set({ state: 'offline' });
      return;
    }
    if (this.session.getState().status !== 'signed_in') {
      this.set({ state: 'signed_out' });
      return;
    }
    this.set({ state: 'syncing' });
    try {
      await withLock('fabric-sync', async () => {
        // Devices signed in before device codes existed get theirs here.
        await this.session.ensureDeviceCode();
        await this.push();
        await this.pull();
      });
      this.retryDelay = 0;
      this.set({ state: 'idle', lastSyncedAt: this.store.now().toISOString() });
    } catch (error) {
      if (error instanceof SignedOutError) {
        this.set({ state: 'signed_out' });
        return;
      }
      this.set({ state: error instanceof NetworkError ? 'offline' : 'error' });
      if (!(error instanceof NetworkError) && !(error instanceof ApiError)) console.error(error);
      this.scheduleRetry();
    }
  }

  private async push(): Promise<void> {
    const { db } = this.store;
    for (;;) {
      const entries = takeBatch(
        await db.outbox
          .orderBy('seq')
          .filter((entry) => entry.state === 'pending')
          .limit(SYNC_PUSH_MAX_OPS)
          .toArray(),
      );
      if (entries.length === 0) return;
      const ops = entries.map(toOp);
      const { results } = await this.session.request('/sync/push', syncPushResponseSchema, {
        method: 'POST',
        body: { ops },
      });
      await applyPushResults(db, entries, results);
    }
  }

  /**
   * Pulls page by page. A new epoch means the server's database was restored (a backup or an
   * export): the cursor points into data that no longer exists, so everything is pulled again
   * from 0. Pending local changes stay and are pushed as usual.
   */
  private async pull(): Promise<void> {
    const { db } = this.store;
    for (;;) {
      const cursor = await this.store.getMeta(PULL_CURSOR);
      const since = typeof cursor === 'number' ? cursor : 0;
      const page = await this.session.request(
        `/sync/pull?since=${String(since)}&limit=${String(PULL_LIMIT)}`,
        syncPullResponseSchema,
      );
      const epoch = await this.store.getMeta(SYNC_EPOCH);
      if (epoch !== page.epoch) {
        await this.store.setMeta(SYNC_EPOCH, page.epoch);
        if (typeof epoch === 'string' && since > 0) {
          await this.store.setMeta(PULL_CURSOR, 0);
          continue;
        }
      }
      await applyPulledChanges(db, page);
      if (!page.hasMore) {
        await this.store.setMeta(PULLED_AT, this.store.now().toISOString());
        return;
      }
    }
  }

  private scheduleRetry(): void {
    const { retryMinMs, retryMaxMs } = this.options;
    this.retryDelay = Math.min(
      retryMaxMs,
      this.retryDelay === 0 ? retryMinMs : this.retryDelay * 2,
    );
    // ±20% jitter so several devices do not retry in step.
    const delay = this.retryDelay * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(() => void this.syncNow(), delay);
  }

  private set(change: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...change };
    for (const listener of this.listeners) listener();
  }
}
