// local-db: the device's database, its outbox and the sync engine (ADR 0002). Features use the
// repositories and hooks from here; they never touch Dexie or fetch.
export type { AccountsRepository, CustomerAccountView, CustomerSummary } from './accounts';
export { ApiError, NetworkError } from './api';
export type { AuditFilters, AuditPage, AuditRepository } from './audit';
export type { Local, OutboxEntry } from './db';
export {
  isAlreadyCreated,
  isPeriodLocked,
  NotAllowedError,
  ReadOnlyError,
  ValidationError,
} from './errors';
export {
  type EmployeeDetailView,
  type EmployeeDirectory,
  type EmployeesRepository,
  type EmployeeSummary,
  SALARY_NEEDS_CONFIRMATION,
  type SalaryWarning,
} from './employees';
export type {
  ExpenseCategory,
  ExpensesRepository,
  MonthRow,
  MonthView,
  ReminderView,
  TemplateView,
} from './expenses';
export type {
  ActivityEvent,
  ActivityKind,
  DailySales,
  DuesOverview,
  HomeRepository,
  PayablesOverview,
  ReceivablesOverview,
  SalesOverview,
  SalesWindow,
  StockAdjustmentKind,
  StockAttention,
} from './home';
export type { IntegrityRepository, RecentEvent } from './integrity';
export {
  DeviceNotRegisteredError,
  type PurchasesRepository,
  type PurchaseSummary,
} from './purchases';
export type { MaintenanceRepository, BatchToReview } from './maintenance';
export {
  NEEDS_CONFIRMATION,
  type PartnerAccountView,
  type PartnerAllocation,
  type PartnerDraft,
  type PartnerExitInput,
  type PartnerExitPlan,
  type PartnersRepository,
  type PartnerView,
} from './partners';
export {
  createLocalDb,
  type Guarded,
  type LocalDb,
  LocalDbProvider,
  type RegistrationOpen,
  type SyncOverview,
  useGuardedQuery,
  useLiveQuery,
  useCanSeeCosts,
  useRegistrationOpen,
  useRepositories,
  useSession,
  useSyncStatus,
} from './react';
export type { PhotosRepository } from './photos';
export {
  type InventorySummary,
  type ProductBatchView,
  type ProductDetailView,
  type ProductInventoryOverview,
  type ProductInventoryRepository,
  type MovementReference,
  type ProductMovementView,
  type ProductRemovalView,
  type ProductStockView,
  STOCK_FILTERS,
  type StockPurchase,
  type StockFilter,
  type StockStatus,
} from './product-inventory';
export type { ReportsRepository, ReportsView } from './reports';
export type { Repositories } from './repositories';
export type { BatchChoice, SaleLineView, SalesRepository, SaleSummary, SaleView } from './sales';
export type { BatchView, StockRepository } from './stock';
export {
  type HistoryShare,
  NeedsServerError,
  type ServerLink,
  type SettlementHistoryRow,
  type SettlementsRepository,
  type SettlementView,
  type SplitRuleRow,
} from './settlements';
export type { ShopIdentity, ShopSettingsRepository } from './shop-settings';
export type {
  CustomersRepository,
  ProductsRepository,
  SettingsRepository,
  SuppliersRepository,
} from './tables';
export type { SessionState } from './session';
export type { UserAccountsRepository } from './user-accounts';
export type {
  PayableView,
  SupplierAccountsRepository,
  SupplierAccountView,
  SupplierPurchaseRecord,
  SupplierSummary,
} from './supplier-accounts';
export type { SyncState, SyncStatus } from './sync';
export type {
  HawlView,
  ZakatEstimate,
  ZakatHistoryRow,
  ZakatLatestReport,
  ZakatOptions,
  ZakatPreview,
  ZakatReminder,
  ZakatReportView,
  ZakatRepository,
  ZakatReview,
} from './zakat';
