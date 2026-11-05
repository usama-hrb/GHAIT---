import { AccountsRepository } from './accounts';
import { AuditRepository } from './audit';
import { EmployeesRepository } from './employees';
import { ExpensesRepository } from './expenses';
import { HomeRepository } from './home';
import { IntegrityRepository } from './integrity';
import { MaintenanceRepository } from './maintenance';
import { PartnersRepository } from './partners';
import { PhotosRepository } from './photos';
import { ProductInventoryRepository } from './product-inventory';
import { PurchasesRepository } from './purchases';
import { ReportsRepository } from './reports';
import { SalesRepository } from './sales';
import { StockRepository } from './stock';
import { SupplierAccountsRepository } from './supplier-accounts';
import { type ServerLink, SettlementsRepository } from './settlements';
import { ShopSettingsRepository } from './shop-settings';
import { UserAccountsRepository } from './user-accounts';
import { ZakatRepository } from './zakat';
import type { LocalStore } from './store';
import {
  BatchesTable,
  CustomersRepository,
  ProductsRepository,
  SuppliersRepository,
} from './tables';

export interface Repositories {
  products: ProductsRepository;
  photos: PhotosRepository;
  suppliers: SuppliersRepository;
  settings: ShopSettingsRepository;
  purchases: PurchasesRepository;
  supplierAccounts: SupplierAccountsRepository;
  stock: StockRepository;
  productInventory: ProductInventoryRepository;
  customers: CustomersRepository;
  sales: SalesRepository;
  accounts: AccountsRepository;
  /** The owner's management of cashier and partner logins (ADR 0024). */
  userAccounts: UserAccountsRepository;
  maintenance: MaintenanceRepository;
  expenses: ExpensesRepository;
  employees: EmployeesRepository;
  partners: PartnersRepository;
  settlements: SettlementsRepository;
  integrity: IntegrityRepository;
  audit: AuditRepository;
  zakat: ZakatRepository;
  reports: ReportsRepository;
  home: HomeRepository;
}

/** `server`: what approving a settlement needs (none in tests that do not settle). */
export function createRepositories(store: LocalStore, server?: ServerLink): Repositories {
  const settings = new ShopSettingsRepository(store, server);
  const products = new ProductsRepository(store);
  const purchases = new PurchasesRepository(store);
  const stock = new StockRepository(store, new BatchesTable(store));
  const accounts = new AccountsRepository(store);
  const supplierAccounts = new SupplierAccountsRepository(store);
  const productInventory = new ProductInventoryRepository(
    store,
    products,
    purchases,
    stock,
    settings,
  );
  const expenses = new ExpensesRepository(store, settings);
  const zakat = new ZakatRepository(store, settings, server);
  return {
    products,
    photos: new PhotosRepository(store),
    suppliers: new SuppliersRepository(store),
    settings,
    purchases,
    supplierAccounts,
    stock,
    productInventory,
    customers: new CustomersRepository(store),
    sales: new SalesRepository(store, settings),
    accounts,
    userAccounts: new UserAccountsRepository(store, server),
    maintenance: new MaintenanceRepository(store),
    expenses,
    employees: new EmployeesRepository(store, expenses),
    partners: new PartnersRepository(store),
    settlements: new SettlementsRepository(store, server),
    integrity: new IntegrityRepository(store),
    audit: new AuditRepository(store, server),
    zakat,
    reports: new ReportsRepository(store, settings),
    home: new HomeRepository(store, accounts, supplierAccounts, productInventory, expenses, zakat),
  };
}
