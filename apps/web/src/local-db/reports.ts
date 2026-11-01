import {
  cashFlowByMonth,
  type DateRange,
  expensesByCategory,
  negotiation,
  profitByMonth,
  receivablesAgeing,
  salesByColor,
  salesByFabric,
  slowMoving,
  stockValue,
} from '@fabric/contracts';
import { shopToday } from '@/shared/lib/dates';
import { loadShopRecords } from './records';
import type { LocalStore } from './store';
import type { SettingsRepository } from './tables';

/**
 * Reports (BUILD_PROMPTS 5.2) from this device's records, offline: the @fabric/contracts report
 * functions, accounting figures through core.
 */
export class ReportsRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly settings: SettingsRepository,
  ) {}

  /** Every report for a range (the ones that are "now" ignore it). */
  async all(range: DateRange) {
    const today = shopToday(this.store.now());
    const [records, categories] = await Promise.all([
      loadShopRecords(this.store.db),
      this.settings.get('expense_categories', today),
    ]);
    const labels = new Map(categories.map((category) => [category.key, category.label]));
    return {
      profit: profitByMonth(records, range),
      colors: salesByColor(records, range),
      fabrics: salesByFabric(records, range),
      slow: slowMoving(records, today),
      byCustomer: negotiation(records, range, 'customer'),
      byFabric: negotiation(records, range, 'fabric'),
      expenses: expensesByCategory(records, range).map((row) => ({
        ...row,
        label: labels.get(row.category) ?? row.category,
      })),
      ageing: receivablesAgeing(records, today),
      stock: stockValue(records),
      cash: cashFlowByMonth(records, range),
    };
  }
}

export type ReportsView = Awaited<ReturnType<ReportsRepository['all']>>;
