'use client';

import { useLiveQuery as useDexieLiveQuery } from 'dexie-react-hooks';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { mayReadCosts } from '@fabric/contracts';
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

/** What a query on this device ended with: its value, or the error it threw. */
export type Guarded<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * A live query that reports its failure instead of throwing it. `useLiveQuery` throws a failed
 * query into the nearest error boundary, which would replace the whole page; here a section can say
 * it could not be read and offer a retry while the rest of the page keeps working. `result` is
 * undefined while the first answer is loading, and `retry` runs the query again.
 */
export function useGuardedQuery<T>(
  query: () => Promise<T>,
  deps: readonly unknown[],
): { result: Guarded<T> | undefined; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async (): Promise<Guarded<T>> => {
    try {
      return { ok: true, value: await query() };
    } catch (error: unknown) {
      return { ok: false, error };
    }
  }, [...deps, attempt]);
  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { result, retry };
}

const LOADING_SESSION: SessionState = { status: 'loading', user: null, needsSignIn: false };

export function useSession(): SessionState &
  Pick<Session, 'login' | 'logout' | 'register' | 'registrationOpen' | 'changePassword'> {
  const { session } = useLocalDb();
  const state = useSyncExternalStore(session.subscribe, session.getState, () => LOADING_SESSION);
  return {
    ...state,
    login: (input) => session.login(input),
    logout: () => session.logout(),
    register: (input) => session.register(input),
    registrationOpen: () => session.registrationOpen(),
    changePassword: (input) => session.changePassword(input),
  };
}

/** Whether the server takes the first owner's sign-up now; `unknown` until it answers or offline. */
export type RegistrationOpen = 'unknown' | 'open' | 'closed';

/**
 * Asks the server once whether the first owner may still sign up (ADR 0023). `unknown` while the
 * question is out and when it cannot be asked (offline, the server down): the login page then
 * shows no sign-up link and the sign-up page says it needs the internet. `setupCodeRequired`: the
 * shop of this address asks for the code its operator made (ADR 0029). `retry` asks again.
 */
export function useRegistrationOpen(): {
  state: RegistrationOpen;
  setupCodeRequired: boolean;
  asking: boolean;
  retry: () => void;
} {
  const { session } = useLocalDb();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    attempt: number;
    state: RegistrationOpen;
    setupCodeRequired: boolean;
  } | null>(null);

  useEffect(() => {
    let current = true;
    session
      .registrationStatus()
      .then((status) => {
        if (current) {
          setAnswer({
            attempt,
            state: status.open ? 'open' : 'closed',
            setupCodeRequired: status.setupCodeRequired,
          });
        }
      })
      .catch(() => {
        if (current) setAnswer({ attempt, state: 'unknown', setupCodeRequired: false });
      });
    return () => {
      current = false;
    };
  }, [session, attempt]);

  return {
    state: answer?.state ?? 'unknown',
    setupCodeRequired: answer?.setupCodeRequired ?? false,
    asking: answer?.attempt !== attempt,
    retry: () => {
      setAttempt((count) => count + 1);
    },
  };
}

/**
 * Whether the signed-in account sees costs, profit and what the shop earns (SPEC §11): everyone
 * but a cashier. The API never sends a cashier's device a cost; this keeps the screens from
 * showing blanks where a cost would be.
 */
export function useCanSeeCosts(): boolean {
  const { user } = useSession();
  return user !== null && mayReadCosts(user.role);
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
