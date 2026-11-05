import {
  expenseItemOf,
  grossProfitByDay,
  type Payment,
  type ProductStockMove,
  salesByDay,
} from '@fabric/contracts';
import type { EntityTable } from 'dexie';
import { monthlyExpenses, monthOf } from '@fabric/core';
import type { Local } from './db';
import type { AccountsRepository } from './accounts';
import type { ExpensesRepository } from './expenses';
import type { ProductInventoryRepository } from './product-inventory';
import { loadShopRecords } from './records';
import type { LocalStore } from './store';
import type { SupplierAccountsRepository } from './supplier-accounts';
import type { ZakatReminder, ZakatRepository } from './zakat';

/** The two lengths of the sales chart. */
export type SalesWindow = 7 | 30;

export interface DailySales {
  date: string;
  /** Sales of the day net of goods given back that day (RT4): the definition of the profit report. */
  salesCents: number;
  salesCount: number;
}

export interface SalesOverview {
  /** The `window` days up to and including today, oldest first (a quiet day is a zero). */
  days: DailySales[];
  totalCents: number;
  /** The `window` days before those: what the change is measured against. */
  previousTotalCents: number;
  todayCents: number;
  todayCount: number;
  yesterdayCents: number;
}

export interface ReceivablesOverview {
  /** What customers owe in all (the same figure as the customers screen). */
  owedCents: number;
  owingCount: number;
  overdueCents: number;
  overdueCount: number;
}

export interface PayablesOverview {
  owedCents: number;
  owingCount: number;
}

export interface StockAttention {
  outCount: number;
  lowCount: number;
  awaitingCount: number;
  /** The first few names of each, by name. */
  out: string[];
  low: string[];
  awaiting: string[];
}

export interface DuesOverview {
  /** The month's unpaid bills, from @fabric/core `monthlyExpenses` (what the expenses screen counts). */
  unpaidCents: number;
  unpaidCount: number;
  /** Recurring bills whose month's expense is due or late and not created yet. */
  billsDueCount: number;
  billsLateCount: number;
  zakat: ZakatReminder;
}

export type ActivityKind =
  'sale' | 'purchase' | 'customer_payment' | 'supplier_payment' | 'expense' | 'stock_adjustment';

export type StockAdjustmentKind = 'adjustment' | 'loss' | 'length_correction' | 'measurement';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** When it was recorded (ISO instant): the order of the feed, and the time shown. */
  at: string;
  /** The day it is dated (YYYY-MM-DD). */
  date: string;
  /** The customer, supplier or product as typed; null for a walk-in sale. */
  subject: string | null;
  /** A purchase of several products: how many besides `subject`. */
  more: number;
  /** An expense's category, shown by the screen in its own language. */
  category: { key: string; label: string } | null;
  amountCents: number | null;
  /** A stock change or receipt: signed, in cm, g or pieces by `unit`. */
  quantity: { unit: 'meter' | 'kg' | 'piece'; amount: number } | null;
  adjustment: StockAdjustmentKind | null;
  /** The page with its details (a record page takes `?id=`). */
  href: string;
}

const EMPTY = {
  subject: null,
  more: 0,
  category: null,
  amountCents: null,
  quantity: null,
  adjustment: null,
} as const;

const ADJUSTMENT_TYPES = ['adjustment', 'loss', 'length_correction', 'measurement'] as const;

/** Names listed in an attention row. */
const NAMES_SHOWN = 3;
/** How many payments are read per step while looking for those that were not made with a sale. */
const PAYMENT_PAGE = 40;
const PAYMENT_PAGES = 5;

const live = (record: { voidedAt: string | null }) => record.voidedAt === null;
const newest = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * What the Home screen shows (ADR 0018). It adds up nothing of its own: sales by day and gross
 * profit come from @fabric/contracts (the profit report's definitions), debts from the customer
 * and supplier accounts, stock from the product ledger, expenses from @fabric/core. Each method is
 * one small live query, so a change only recomputes the section it affects.
 */
export class HomeRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly accounts: AccountsRepository,
    private readonly supplierAccounts: SupplierAccountsRepository,
    private readonly productInventory: ProductInventoryRepository,
    private readonly expenses: ExpensesRepository,
    private readonly zakat: ZakatRepository,
  ) {}

  /** The sales chart and the sales cards: no cost is read, so a cashier's device can show them. */
  async sales(today: string, window: SalesWindow): Promise<SalesOverview> {
    const { db } = this.store;
    const from = addDays(today, -(2 * window - 1));
    const [sales, returns] = await Promise.all([
      db.sales.where('date').between(from, today, true, true).toArray(),
      db.saleReturns.where('date').between(from, today, true, true).toArray(),
    ]);
    // A return counts only for a sale that is not voided, wherever that sale is dated.
    const known = new Set(sales.map((sale) => sale.id));
    const outside = await db.sales.bulkGet(
      [...new Set(returns.map((given) => given.saleId))].filter((id) => !known.has(id)),
    );
    const rows = salesByDay(
      {
        sales: [...sales, ...outside.flatMap((sale) => (sale ? [sale] : []))],
        saleReturns: returns,
      },
      { from, to: today },
    );
    const days = rows.slice(window).map(({ date, salesCents, salesCount }) => ({
      date,
      salesCents,
      salesCount,
    }));
    const sum = (list: readonly { salesCents: number }[]) =>
      list.reduce((total, row) => total + row.salesCents, 0);
    const last = rows.at(-1);
    return {
      days,
      totalCents: sum(days),
      previousTotalCents: sum(rows.slice(0, window)),
      todayCents: last?.salesCents ?? 0,
      todayCount: last?.salesCount ?? 0,
      yesterdayCents: rows.at(-2)?.salesCents ?? 0,
    };
  }

  /**
   * Today's gross profit (sales less the batch cost of what was sold, less what returns took
   * back): null when it cannot be worked out reliably, so the card is left out rather than guessed.
   * Never call it for an account that does not see costs.
   */
  async grossProfitToday(today: string): Promise<number | null> {
    try {
      const records = await loadShopRecords(this.store.db);
      return grossProfitByDay(records, { from: today, to: today })[0]?.grossProfitCents ?? 0;
    } catch {
      return null;
    }
  }

  /** What customers owe, and how much of it is late: the customers' own accounts, summed. */
  async receivables(): Promise<ReceivablesOverview> {
    const owing = await this.accounts.debts();
    const late = owing.filter(({ account }) => account.overdueCents > 0);
    return {
      owedCents: owing.reduce((total, { account }) => total + account.collectibleCents, 0),
      owingCount: owing.length,
      overdueCents: late.reduce((total, { account }) => total + account.overdueCents, 0),
      overdueCount: late.length,
    };
  }

  /** What the shop owes its suppliers: the suppliers' accounts, summed as the directory does. */
  async payables(): Promise<PayablesOverview> {
    const owed = (await this.supplierAccounts.list()).filter(
      ({ account }) => account.owedCents > 0,
    );
    return {
      owedCents: owed.reduce((total, { account }) => total + account.owedCents, 0),
      owingCount: owed.length,
    };
  }

  /** Products out, running low or waiting for a length: the counts the stock screen's filters give. */
  async stock(): Promise<StockAttention> {
    const { products, summary } = await this.productInventory.overview();
    const names = (status: 'out' | 'low') =>
      products
        .filter((product) => product.status === status)
        .slice(0, NAMES_SHOWN)
        .map((product) => product.name);
    return {
      outCount: summary.out,
      lowCount: summary.low,
      awaitingCount: summary.awaiting,
      out: names('out'),
      low: names('low'),
      awaiting: products
        .filter((product) => product.awaitingMeasurementG > 0)
        .slice(0, NAMES_SHOWN)
        .map((product) => product.name),
    };
  }

  /** Bills to pay or create, and the zakat reminder. Costs only. */
  async dues(today: string): Promise<DuesOverview> {
    const [all, reminders, zakat] = await Promise.all([
      this.store.db.expenses.toArray(),
      this.expenses.reminders(),
      this.zakat.reminder(),
    ]);
    const month = monthlyExpenses(all.map(expenseItemOf), monthOf(today));
    return {
      unpaidCents: month.unpaidCents,
      unpaidCount: month.unpaidCount,
      billsDueCount: reminders.filter((reminder) => reminder.status === 'due').length,
      billsLateCount: reminders.filter((reminder) => reminder.status === 'overdue').length,
      zakat,
    };
  }

  /**
   * The newest events of the shop, newest first: sales, purchases, customer and supplier payments,
   * expenses and manual stock changes, read from their own records (no activity table). Each kind
   * reads only its newest few, by when they were made, and the lists are merged. The costs side
   * (purchases, supplier payments, expenses, stock changes) is left out unless `costs`.
   */
  async recent(limit: number, costs: boolean): Promise<ActivityEvent[]> {
    const { db } = this.store;
    const newestOf = <T extends { id: string; voidedAt: string | null }>(
      table: EntityTable<T, 'id'>,
    ) => table.orderBy('createdAt').reverse().filter(live).limit(limit).toArray();

    const [sales, payments] = await Promise.all([
      newestOf(db.sales),
      this.standalonePayments(limit),
    ]);
    const [purchases, supplierPayments, spent, moves] = costs
      ? await Promise.all([
          newestOf(db.purchases),
          newestOf(db.supplierPayments),
          newestOf(db.expenses),
          this.manualMoves(limit),
        ])
      : [[], [], [], []];

    const [customers, suppliers, batches, categories] = await Promise.all([
      db.customers.bulkGet([
        ...new Set([...sales, ...payments].flatMap(({ customerId }) => customerId ?? [])),
      ]),
      db.suppliers.bulkGet([
        ...new Set([
          ...purchases.flatMap(({ supplierId }) => supplierId ?? []),
          ...supplierPayments.map(({ supplierId }) => supplierId),
        ]),
      ]),
      Promise.all([
        db.productBatches
          .where('purchaseId')
          .anyOf(purchases.map(({ id }) => id))
          .toArray(),
        db.productBatches.bulkGet([...new Set(moves.map(({ batchId }) => batchId))]),
      ]),
      costs ? this.expenses.categories() : Promise.resolve([]),
    ]);
    const [batchesOfPurchases, batchesOfMoves] = batches;
    const heldBatches = batchesOfMoves.flatMap((batch) => (batch ? [batch] : []));
    const products = await db.products.bulkGet([
      ...new Set([...batchesOfPurchases, ...heldBatches].map(({ productId }) => productId)),
    ]);
    const customerName = new Map(
      customers.flatMap((row) => (row ? [[row.id, row.name] as const] : [])),
    );
    const supplierName = new Map(
      suppliers.flatMap((row) => (row ? [[row.id, row.name] as const] : [])),
    );
    const productName = new Map(
      products.flatMap((row) => (row ? [[row.id, row.name] as const] : [])),
    );
    const batchOf = new Map(heldBatches.map((batch) => [batch.id, batch]));
    const categoryOf = new Map(categories.map((category) => [category.key, category]));

    const events: ActivityEvent[] = [
      ...sales.map((sale): ActivityEvent => ({
        ...EMPTY,
        id: `sale:${sale.id}`,
        kind: 'sale',
        at: sale.createdAt,
        date: sale.date,
        subject: sale.customerId ? (customerName.get(sale.customerId) ?? null) : null,
        amountCents: sale.totalCents,
        href: `/pos/view?id=${sale.id}`,
      })),
      ...payments.map((payment): ActivityEvent => ({
        ...EMPTY,
        id: `customer_payment:${payment.id}`,
        kind: 'customer_payment',
        at: payment.createdAt,
        date: payment.date,
        subject: payment.customerId ? (customerName.get(payment.customerId) ?? null) : null,
        amountCents: payment.amountCents,
        href: payment.customerId ? `/customers/view?id=${payment.customerId}` : '/customers',
      })),
      ...purchases.map((purchase): ActivityEvent => {
        const own = batchesOfPurchases
          .filter((batch) => batch.purchaseId === purchase.id)
          .sort((a, b) => a.code.localeCompare(b.code));
        const names = [
          ...new Set(own.map((batch) => productName.get(batch.productId) ?? '')),
        ].filter(Boolean);
        const only = own.length === 1 ? own[0] : undefined;
        return {
          ...EMPTY,
          id: `purchase:${purchase.id}`,
          kind: 'purchase',
          at: purchase.createdAt,
          date: purchase.date,
          subject:
            names[0] ??
            (purchase.supplierId ? (supplierName.get(purchase.supplierId) ?? null) : null),
          more: Math.max(0, names.length - 1),
          amountCents: purchase.totalCostCents,
          quantity: only ? { unit: only.unit, amount: only.receivedQuantity } : null,
          href: own[0] ? `/inventory/product?id=${own[0].productId}` : '/inventory',
        };
      }),
      ...supplierPayments.map((payment): ActivityEvent => ({
        ...EMPTY,
        id: `supplier_payment:${payment.id}`,
        kind: 'supplier_payment',
        at: payment.createdAt,
        date: payment.date,
        subject: supplierName.get(payment.supplierId) ?? null,
        amountCents: payment.amountCents,
        href: `/payables/view?id=${payment.supplierId}`,
      })),
      // An unpaid bill is not money out yet (expenses count by payment date): it is an attention
      // item until it is paid, not an event of the feed.
      ...spent
        .filter((expense) => expense.paidDate !== null)
        .map((expense): ActivityEvent => ({
          ...EMPTY,
          id: `expense:${expense.id}`,
          kind: 'expense',
          at: expense.createdAt,
          date: expense.date,
          subject: expense.note,
          category: categoryOf.get(expense.category) ?? {
            key: expense.category,
            label: expense.category,
          },
          amountCents: expense.amountCents,
          href: '/expenses',
        })),
      ...moves.map((move): ActivityEvent => {
        const batch = batchOf.get(move.batchId);
        return {
          ...EMPTY,
          id: `stock_adjustment:${move.id}`,
          kind: 'stock_adjustment',
          at: move.createdAt,
          date: move.date,
          subject: batch ? (productName.get(batch.productId) ?? null) : null,
          quantity: { unit: move.unit, amount: move.delta },
          adjustment: move.type as StockAdjustmentKind,
          href: batch ? `/inventory/product?id=${batch.productId}` : '/inventory',
        };
      }),
    ];
    return events
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  /** The newest stock changes made by hand (a count, a loss, a corrected or measured length). */
  private async manualMoves(limit: number): Promise<Local<ProductStockMove>[]> {
    const lists = await Promise.all(
      ADJUSTMENT_TYPES.map((type) =>
        this.store.db.productStockMoves
          .where('[type+createdAt]')
          .between([type, ''], [type, '\uffff'])
          .reverse()
          .filter(live)
          .limit(limit)
          .toArray(),
      ),
    );
    return lists.flat().sort(newest).slice(0, limit);
  }

  /**
   * Customer payments that were not made with a sale: a sale paid at the till saves its payment in
   * the same breath (same instant, device and customer), and that money is already in the sale.
   */
  private async standalonePayments(limit: number): Promise<Local<Payment>[]> {
    const { db } = this.store;
    const found: Local<Payment>[] = [];
    for (let page = 0; page < PAYMENT_PAGES && found.length < limit; page += 1) {
      const rows = await db.payments
        .orderBy('createdAt')
        .reverse()
        .offset(page * PAYMENT_PAGE)
        .limit(PAYMENT_PAGE)
        .toArray();
      const candidates = rows.filter((payment) => live(payment) && payment.kind === 'payment');
      const sales = await db.sales
        .where('createdAt')
        .anyOf(candidates.map((payment) => payment.createdAt))
        .toArray();
      const ofSale = new Set(
        sales.map((sale) => `${sale.createdAt}|${sale.deviceId}|${sale.customerId ?? ''}`),
      );
      for (const payment of candidates.sort(newest)) {
        if (!ofSale.has(`${payment.createdAt}|${payment.deviceId}|${payment.customerId ?? ''}`)) {
          found.push(payment);
        }
      }
      if (rows.length < PAYMENT_PAGE) break;
    }
    return found.slice(0, limit);
  }
}
