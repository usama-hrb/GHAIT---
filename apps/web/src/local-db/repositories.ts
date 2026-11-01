import { AccountsRepository } from './accounts';
import { AuditRepository } from './audit';
import { ExpensesRepository } from './expenses';
import { IntegrityRepository } from './integrity';
import { InventoryRepository } from './inventory';
import { MaintenanceRepository } from './maintenance';
import { PartnersRepository } from './partners';
import { PhotosRepository } from './photos';
import { PurchasesRepository } from './purchases';
import { ReportsRepository } from './reports';
import { SalesRepository } from './sales';
import { SupplierAccountsRepository } from './supplier-accounts';
import { type ServerLink, SettlementsRepository } from './settlements';
import { ZakatRepository } from './zakat';
import type { LocalStore } from './store';
import {
  CustomersRepository,
  FabricsRepository,
  RollsTable,
  SettingsRepository,
  SuppliersRepository,
  VariantsRepository,
} from './tables';

export interface Repositories {
  fabrics: FabricsRepository;
  variants: VariantsRepository;
  photos: PhotosRepository;
  suppliers: SuppliersRepository;
  settings: SettingsRepository;
  purchases: PurchasesRepository;
  supplierAccounts: SupplierAccountsRepository;
  inventory: InventoryRepository;
  customers: CustomersRepository;
  sales: SalesRepository;
  accounts: AccountsRepository;
  maintenance: MaintenanceRepository;
  expenses: ExpensesRepository;
  partners: PartnersRepository;
  settlements: SettlementsRepository;
  integrity: IntegrityRepository;
  audit: AuditRepository;
  zakat: ZakatRepository;
  reports: ReportsRepository;
}

/** `server`: what approving a settlement needs (none in tests that do not settle). */
export function createRepositories(store: LocalStore, server?: ServerLink): Repositories {
  const fabrics = new FabricsRepository(store);
  const settings = new SettingsRepository(store);
  return {
    fabrics,
    variants: new VariantsRepository(store),
    photos: new PhotosRepository(store),
    suppliers: new SuppliersRepository(store),
    settings,
    purchases: new PurchasesRepository(store),
    supplierAccounts: new SupplierAccountsRepository(store),
    inventory: new InventoryRepository(store, new RollsTable(store), fabrics, settings),
    customers: new CustomersRepository(store),
    sales: new SalesRepository(store, settings),
    accounts: new AccountsRepository(store),
    maintenance: new MaintenanceRepository(store),
    expenses: new ExpensesRepository(store, settings),
    partners: new PartnersRepository(store),
    settlements: new SettlementsRepository(store, server),
    integrity: new IntegrityRepository(store),
    audit: new AuditRepository(store, server),
    zakat: new ZakatRepository(store, settings, server),
    reports: new ReportsRepository(store, settings),
  };
}
