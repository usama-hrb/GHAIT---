// local-db: the device's database, its outbox and the sync engine (ADR 0002). Features use the
// repositories and hooks from here; they never touch Dexie or fetch.
export type { AccountsRepository, CustomerAccountView, CustomerSummary } from './accounts';
export { ApiError, NetworkError } from './api';
export type { AuditFilters, AuditPage, AuditRepository } from './audit';
export type { Local, OutboxEntry } from './db';
export { isPeriodLocked, NotAllowedError, ReadOnlyError, ValidationError } from './errors';
export type { ExpenseCategory, ExpensesRepository, MonthView, ReminderView } from './expenses';
export type { IntegrityRepository, RecentEvent } from './integrity';
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
  NEEDS_CONFIRMATION,
  PARTNER_SETUP_ISSUE,
  type PartnerAccountView,
  type PartnersRepository,
  type PartnerView,
} from './partners';
export {
  createLocalDb,
  type LocalDb,
  LocalDbProvider,
  type SyncOverview,
  useLiveQuery,
  useCanSeeCosts,
  useRepositories,
  useSession,
  useSyncStatus,
} from './react';
export type { PhotosRepository } from './photos';
export type { ReportsRepository, ReportsView } from './reports';
export type { Repositories } from './repositories';
export type { RollChoice, SaleLineView, SalesRepository, SaleSummary, SaleView } from './sales';
export {
  NeedsServerError,
  type ServerLink,
  type SettlementsRepository,
  type SettlementView,
  type SplitRuleRow,
} from './settlements';
export type {
  CustomersRepository,
  FabricsRepository,
  SettingsRepository,
  SuppliersRepository,
  VariantsRepository,
} from './tables';
export type { SessionState } from './session';
export type {
  PayableView,
  SupplierAccountsRepository,
  SupplierStatementView,
} from './supplier-accounts';
export type { SyncState, SyncStatus } from './sync';
export type {
  HawlView,
  ZakatOptions,
  ZakatPreview,
  ZakatReminder,
  ZakatReportView,
  ZakatRepository,
} from './zakat';
