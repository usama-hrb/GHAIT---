import type {
  CapitalMove,
  CashAdjustment,
  Customer,
  Expense,
  Fabric,
  LockedCost,
  Partner,
  PartnerDraw,
  Payment,
  Photo,
  PaymentAllocation,
  Purchase,
  RecurringExpense,
  Roll,
  Sale,
  SaleLine,
  SaleReturn,
  SaleVoid,
  SettlementRecord,
  SettlementShare,
  SplitRule,
  StockMove,
  Supplier,
  SupplierPayment,
  SyncConflict,
  SyncedSetting,
  SyncOp,
  SyncOpResult,
  Variant,
  WriteOff,
  ZakatReport,
} from '@fabric/contracts';
import { Dexie, type EntityTable } from 'dexie';

/** A synced record on the device, with the server_seq of the version it was last synced at. */
export type Local<R> = R & {
  /** null: created here and not pushed yet. */
  serverSeq: number | null;
};

/** A change waiting to be pushed (ADR 0002 outbox). */
export interface OutboxEntry extends SyncOp {
  /** Local order: ops are pushed oldest first. */
  seq?: number;
  /** `rejected`: the server refused it; kept and shown, never retried as is. */
  state: 'pending' | 'rejected';
  error: SyncOpResult['error'];
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * The device's replica of the shop (IndexedDB through Dexie). Each slice adds a new version()
 * with its tables; a released version is never edited, so devices upgrade in place.
 */
export class ShopDatabase extends Dexie {
  fabrics!: EntityTable<Local<Fabric>, 'id'>;
  variants!: EntityTable<Local<Variant>, 'id'>;
  suppliers!: EntityTable<Local<Supplier>, 'id'>;
  settings!: EntityTable<Local<SyncedSetting>, 'id'>;
  purchases!: EntityTable<Local<Purchase>, 'id'>;
  rolls!: EntityTable<Local<Roll>, 'id'>;
  stockMoves!: EntityTable<Local<StockMove>, 'id'>;
  customers!: EntityTable<Local<Customer>, 'id'>;
  sales!: EntityTable<Local<Sale>, 'id'>;
  saleLines!: EntityTable<Local<SaleLine>, 'id'>;
  payments!: EntityTable<Local<Payment>, 'id'>;
  paymentAllocations!: EntityTable<Local<PaymentAllocation>, 'id'>;
  saleVoids!: EntityTable<Local<SaleVoid>, 'id'>;
  saleReturns!: EntityTable<Local<SaleReturn>, 'id'>;
  supplierPayments!: EntityTable<Local<SupplierPayment>, 'id'>;
  writeOffs!: EntityTable<Local<WriteOff>, 'id'>;
  syncConflicts!: EntityTable<Local<SyncConflict>, 'id'>;
  expenses!: EntityTable<Local<Expense>, 'id'>;
  recurringExpenses!: EntityTable<Local<RecurringExpense>, 'id'>;
  partners!: EntityTable<Local<Partner>, 'id'>;
  capitalMoves!: EntityTable<Local<CapitalMove>, 'id'>;
  partnerDraws!: EntityTable<Local<PartnerDraw>, 'id'>;
  profitSplitRules!: EntityTable<Local<SplitRule>, 'id'>;
  settlements!: EntityTable<Local<SettlementRecord>, 'id'>;
  settlementShares!: EntityTable<Local<SettlementShare>, 'id'>;
  lockedCosts!: EntityTable<Local<LockedCost>, 'id'>;
  cashAdjustments!: EntityTable<Local<CashAdjustment>, 'id'>;
  zakatReports!: EntityTable<Local<ZakatReport>, 'id'>;
  photos!: EntityTable<Local<Photo>, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'fabric-shop') {
    super(name);
    // v1, BUILD_PROMPTS 3.1: catalog, settings (pulled), outbox, device metadata.
    this.version(1).stores({
      fabrics: 'id, name',
      variants: 'id, fabricId',
      suppliers: 'id, name',
      settings: 'id, key',
      outbox: '++seq, opId, entityId, state',
      meta: 'key',
    });
    // v2, BUILD_PROMPTS 3.2: purchases and the rolls and stock moves they create.
    this.version(2).stores({
      purchases: 'id, date',
      rolls: 'id, variantId, purchaseId, shortCode',
      stockMoves: 'id, rollId',
    });
    // v3, BUILD_PROMPTS 3.4: sales, their lines, customers, payments and voids; moves by cause.
    this.version(3).stores({
      stockMoves: 'id, rollId, refId',
      customers: 'id, name',
      sales: 'id, date, customerId',
      saleLines: 'id, saleId, rollId',
      payments: 'id, customerId',
      paymentAllocations: 'id, saleId, paymentId',
      saleVoids: 'id, saleId',
    });
    // v4, BUILD_PROMPTS 3.5: bad-debt write-offs.
    this.version(4).stores({
      writeOffs: 'id, saleId',
    });
    // v5, BUILD_PROMPTS 3.6: the server's conflict log, for the read-only sync screen.
    this.version(5).stores({
      syncConflicts: 'id, entityId',
    });
    // v6, BUILD_PROMPTS 4.1: expenses and their recurring templates.
    this.version(6).stores({
      expenses: 'id, date, paidDate, recurringExpenseId',
      recurringExpenses: 'id',
    });
    // v7, BUILD_PROMPTS 4.2: the partners, their capital moves and draws.
    this.version(7).stores({
      partners: 'id',
      capitalMoves: 'id, partnerId',
      partnerDraws: 'id, partnerId',
    });
    // v8, BUILD_PROMPTS 4.3: split rules, settlements, the partners' shares and frozen costs.
    this.version(8).stores({
      profitSplitRules: 'id',
      settlements: 'id, periodEnd',
      settlementShares: 'id, settlementId, partnerId',
      lockedCosts: 'id, stockMoveId, settlementId',
    });
    // v9, BUILD_PROMPTS 4.4: cash counts.
    this.version(9).stores({ cashAdjustments: 'id, date' });
    // v10, BUILD_PROMPTS 5.1: zakat reports.
    this.version(10).stores({ zakatReports: 'id, hawlDate' });
    // v11, BUILD_PROMPTS 5.3: goods given back, and payments to suppliers.
    this.version(11).stores({
      saleReturns: 'id, saleId',
      supplierPayments: 'id, supplierId',
    });
    // v12, ADR 0009: the pictures of colours.
    this.version(12).stores({ photos: 'id, variantId' });
  }
}
