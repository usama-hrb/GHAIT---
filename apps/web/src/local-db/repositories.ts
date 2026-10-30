import { AccountsRepository } from './accounts';
import { InventoryRepository } from './inventory';
import { MaintenanceRepository } from './maintenance';
import { PurchasesRepository } from './purchases';
import { SalesRepository } from './sales';
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
  suppliers: SuppliersRepository;
  settings: SettingsRepository;
  purchases: PurchasesRepository;
  inventory: InventoryRepository;
  customers: CustomersRepository;
  sales: SalesRepository;
  accounts: AccountsRepository;
  maintenance: MaintenanceRepository;
}

export function createRepositories(store: LocalStore): Repositories {
  const fabrics = new FabricsRepository(store);
  const settings = new SettingsRepository(store);
  return {
    fabrics,
    variants: new VariantsRepository(store),
    suppliers: new SuppliersRepository(store),
    settings,
    purchases: new PurchasesRepository(store),
    inventory: new InventoryRepository(store, new RollsTable(store), fabrics, settings),
    customers: new CustomersRepository(store),
    sales: new SalesRepository(store, settings),
    accounts: new AccountsRepository(store),
    maintenance: new MaintenanceRepository(store),
  };
}
