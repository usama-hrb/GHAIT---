// local-db: the device's database, its outbox and the sync engine (ADR 0002). Features use the
// repositories and hooks from here; they never touch Dexie or fetch.
export { ApiError, NetworkError } from './api';
export type { Local } from './db';
export { ValidationError } from './errors';
export {
  DeviceNotRegisteredError,
  type PurchasesRepository,
  type PurchaseSummary,
} from './purchases';
export {
  createLocalDb,
  type LocalDb,
  LocalDbProvider,
  type SyncOverview,
  useLiveQuery,
  useRepositories,
  useSession,
  useSyncStatus,
} from './react';
export type {
  FabricsRepository,
  Repositories,
  SettingsRepository,
  SuppliersRepository,
  VariantsRepository,
} from './repositories';
export type { SessionState } from './session';
export type { SyncState, SyncStatus } from './sync';
