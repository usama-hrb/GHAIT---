// local-db: the device's database, its outbox and the sync engine (ADR 0002). Features use the
// repositories and hooks from here; they never touch Dexie or fetch.
export type { AccountsRepository, CustomerAccountView, CustomerSummary } from './accounts';
export { ApiError, NetworkError } from './api';
export type { Local, OutboxEntry } from './db';
export { ValidationError } from './errors';
export type {
  ColorStock,
  ColorStockState,
  FabricStock,
  InventoryRepository,
  RollView,
} from './inventory';
export {
  DeviceNotRegisteredError,
  type PurchasesRepository,
  type PurchaseSummary,
} from './purchases';
export type { MaintenanceRepository, RollToReview } from './maintenance';
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
export type { Repositories } from './repositories';
export type { RollChoice, SaleLineView, SalesRepository, SaleSummary, SaleView } from './sales';
export type {
  CustomersRepository,
  FabricsRepository,
  SettingsRepository,
  SuppliersRepository,
  VariantsRepository,
} from './tables';
export type { SessionState } from './session';
export type { SyncState, SyncStatus } from './sync';
