'use client';

import { useLiveQuery as useDexieLiveQuery } from 'dexie-react-hooks';
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiClient } from './api';
import { ShopDatabase } from './db';
import { createRepositories, type Repositories } from './repositories';
import { Session, type SessionState } from './session';
import { SyncEngine, type SyncStatus } from './sync';
import { LocalStore } from './store';

export interface LocalDb {
  repositories: Repositories;
  session: Session;
  sync: SyncEngine;
  store: LocalStore;
}

export function createLocalDb(db = new ShopDatabase()): LocalDb {
  // A newer app version (another tab, or after an update) upgrades the database: this tab's
  // code is older, so it lets go and reloads with the new code. Its data is already saved.
  db.on('versionchange', () => {
    db.close();
    window.location.reload();
    return false;
  });
  const store = new LocalStore(db);
  const session = new Session(store, new ApiClient(store));
  const sync = new SyncEngine(store, session);
  return {
    repositories: createRepositories(store, {
      request: (path, schema, init) => session.request(path, schema, init),
      syncNow: () => sync.syncNow(),
    }),
    session,
    sync,
    store,
  };
}

let browserLocalDb: LocalDb | undefined;
const LocalDbContext = createContext<LocalDb | null>(null);

/**
 * One local database per tab, created on first use. Nothing touches IndexedDB until an effect
 * or a live query runs, so server rendering only ever shows the loading state.
 */
export function LocalDbProvider({ children, value }: { children: ReactNode; value?: LocalDb }) {
  const [localDb] = useState(() => value ?? (browserLocalDb ??= createLocalDb()));
  useEffect(() => {
    void localDb.session.load();
    // Ask the browser not to evict the shop's data under storage pressure (ADR 0002).
    if ('storage' in navigator) void navigator.storage.persist().catch(() => false);
    return localDb.sync.start();
  }, [localDb]);
  return <LocalDbContext value={localDb}>{children}</LocalDbContext>;
}

function useLocalDb(): LocalDb {
  const localDb = use(LocalDbContext);
  if (!localDb) throw new Error('local-db hooks must be used inside <LocalDbProvider>');
  return localDb;
}

/** Repositories: the only way features read and write shop data. */
export function useRepositories(): Repositories {
  return useLocalDb().repositories;
}

/**
 * Re-renders whenever the data the query read changes, in this tab or another (Dexie live
 * queries). Undefined while loading.
 */
export function useLiveQuery<T>(
  query: () => Promise<T> | T,
  deps: readonly unknown[],
): T | undefined {
  return useDexieLiveQuery(query, [...deps]);
}

const LOADING_SESSION: SessionState = { status: 'loading', user: null, needsSignIn: false };

export function useSession(): SessionState & Pick<Session, 'login' | 'logout'> {
  const { session } = useLocalDb();
  const state = useSyncExternalStore(session.subscribe, session.getState, () => LOADING_SESSION);
  return { ...state, login: (input) => session.login(input), logout: () => session.logout() };
}

const IDLE: SyncStatus = { state: 'idle', lastSyncedAt: null };

export interface SyncOverview extends SyncStatus {
  /** Changes on this device not on the server yet. */
  pendingCount: number;
  /** Changes the server refused (kept for the user to see). */
  rejectedCount: number;
  syncNow: () => Promise<void>;
}

export function useSyncStatus(): SyncOverview {
  const { sync, store } = useLocalDb();
  const status = useSyncExternalStore(sync.subscribe, sync.getStatus, () => IDLE);
  const counts = useDexieLiveQuery(async () => {
    const entries = await store.db.outbox.toArray();
    return {
      pendingCount: entries.filter((entry) => entry.state === 'pending').length,
      rejectedCount: entries.filter((entry) => entry.state === 'rejected').length,
    };
  }, []);
  return {
    ...status,
    pendingCount: counts?.pendingCount ?? 0,
    rejectedCount: counts?.rejectedCount ?? 0,
    syncNow: () => sync.syncNow(),
  };
}
