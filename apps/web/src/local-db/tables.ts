import {
  checkPurchaseAmend,
  type Customer,
  type CustomerInput,
  customerInputSchema,
  customerSchema,
  type Product,
  type ProductBatch,
  type ProductInput,
  productInputSchema,
  productSchema,
  periodDatesOf,
  productBatchSchema,
  type Purchase,
  purchaseSchema,
  SETTINGS,
  type SettingKey,
  settingInEffect,
  type SettingValue,
  type Supplier,
  type SupplierInput,
  supplierInputSchema,
  supplierSchema,
  type SyncEntity,
  voidPayloadSchema,
} from '@fabric/contracts';
import type { Table } from 'dexie';
import type { z } from 'zod';
import { matchesSearch } from '@/shared/lib/search';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';

type Base = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  voidedAt: string | null;
};

/**
 * Writes for one synced entity: the record and its outbox op in one local transaction
 * (ADR 0002), validated with the same contract schema the server applies.
 */
export class SyncedTable<R extends Base> {
  protected readonly table: Table<Local<R>, string>;

  constructor(
    protected readonly store: LocalStore,
    tableName:
      | 'products'
      | 'suppliers'
      | 'productBatches'
      | 'purchases'
      | 'customers'
      | 'expenses'
      | 'recurringExpenses'
      | 'employees'
      | 'employeeSalaries'
      | 'partners'
      | 'capitalMoves'
      | 'partnerDraws'
      | 'profitSplitRules'
      | 'cashAdjustments'
      | 'supplierPayments'
      | 'zakatReports'
      | 'photos',
    private readonly entity: SyncEntity,
    private readonly recordSchema: z.ZodType<R>,
  ) {
    this.table = store.db.table<Local<R>, string>(tableName);
  }

  get(id: string): Promise<Local<R> | undefined> {
    return this.table.get(id);
  }

  /** Creates (no id) or updates the record; throws ValidationError for invalid fields. Returns its id. */
  protected async write(fields: object, id: string = crypto.randomUUID()): Promise<string> {
    this.store.assertWritable();
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction('rw', [this.table, db.outbox, db.settlements], async () => {
      const existing = await this.table.get(id);
      const record = parseOrThrow(this.recordSchema, {
        ...fields,
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deviceId,
        voidedAt: existing?.voidedAt ?? null,
      });
      await this.store.assertPeriodOpen([
        ...this.periodDates(record),
        ...(existing ? this.periodDates(existing) : []),
      ]);
      await this.table.put({ ...record, serverSeq: existing?.serverSeq ?? null });
      await db.outbox.add({
        opId: crypto.randomUUID(),
        entity: this.entity,
        entityId: id,
        kind: 'upsert',
        payload: record,
        deviceId,
        clientTs: now,
        baseServerSeq: existing?.serverSeq ?? null,
        state: 'pending',
        error: null,
      });
    });
    this.store.changed();
    return id;
  }

  /** No delete (CLAUDE.md): the record stays, voided, with the reason in the op and the audit log. */
  async void(id: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const payload = parseOrThrow(voidPayloadSchema, { reason });
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction('rw', [this.table, db.outbox, db.settlements], async () => {
      const existing = await this.table.get(id);
      if (!existing) throw new Error(`No ${this.entity} ${id}`);
      if (existing.voidedAt !== null) return;
      await this.store.assertPeriodOpen(this.periodDates(existing));
      await this.table.put({ ...existing, voidedAt: now, updatedAt: now, deviceId });
      await db.outbox.add({
        opId: crypto.randomUUID(),
        entity: this.entity,
        entityId: id,
        kind: 'void',
        payload,
        deviceId,
        clientTs: now,
        baseServerSeq: existing.serverSeq,
        state: 'pending',
        error: null,
      });
    });
    this.store.changed();
  }

  /** The dates the record is accounted on (periodDatesOf): none for undated entities. */
  private periodDates(record: R): (string | null)[] {
    // A mutable entity's payload is its record (SyncPushPayload).
    return periodDatesOf(this.entity, record as never);
  }
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ar');

export class SuppliersRepository extends SyncedTable<Supplier> {
  constructor(store: LocalStore) {
    super(store, 'suppliers', 'supplier', supplierSchema);
  }

  async list(search = ''): Promise<Local<Supplier>[]> {
    const suppliers = await this.table.filter((supplier) => supplier.voidedAt === null).toArray();
    return suppliers
      .filter((supplier) => matchesSearch(search, [supplier.name, supplier.phone, supplier.notes]))
      .sort(byName);
  }

  async save(input: SupplierInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(supplierInputSchema, input), id);
  }
}

export class CustomersRepository extends SyncedTable<Customer> {
  constructor(store: LocalStore) {
    super(store, 'customers', 'customer', customerSchema);
  }

  async list(search = ''): Promise<Local<Customer>[]> {
    const customers = await this.table.filter((customer) => customer.voidedAt === null).toArray();
    return customers
      .filter((customer) => matchesSearch(search, [customer.name, customer.phone, customer.notes]))
      .sort(byName);
  }

  async save(input: CustomerInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(customerInputSchema, input), id);
  }
}

/**
 * Batches are created with their purchase; afterwards only their remnant mark changes, as an
 * upsert op (the server refuses any other change: checkBatchUpdate).
 */
export class BatchesTable extends SyncedTable<ProductBatch> {
  constructor(store: LocalStore) {
    super(store, 'productBatches', 'product_batch', productBatchSchema);
  }

  async setStatus(id: string, status: 'active' | 'remnant'): Promise<void> {
    const batch = await this.get(id);
    if (!batch) throw new Error(`No batch ${id}`);
    if (batch.status === status) return;
    await this.write(
      {
        code: batch.code,
        productId: batch.productId,
        purchaseId: batch.purchaseId,
        purchaseDate: batch.purchaseDate,
        unit: batch.unit,
        receivedQuantity: batch.receivedQuantity,
        costTotalCents: batch.costTotalCents,
        conversion: batch.conversion,
        status,
      },
      id,
    );
  }
}

/** What a purchase correction sets: what was paid, and the supplier only where there was none. */
export interface PurchasePaymentChange {
  paidCents: number;
  supplierId: string | null;
}

/**
 * A purchase is made with its stock and is never rewritten; afterwards only what was paid on it
 * can be corrected (SP9), as an upsert op the server re-checks with the same function
 * (checkPurchaseAmend). The rest of the record is the one that was made.
 */
export class PurchasePaymentTable extends SyncedTable<Purchase> {
  constructor(store: LocalStore) {
    super(store, 'purchases', 'purchase', purchaseSchema);
  }

  async setPayment(id: string, change: PurchasePaymentChange): Promise<void> {
    const purchase = await this.get(id);
    if (!purchase) throw new Error(`No purchase ${id}`);
    if (purchase.paidCents === change.paidCents && purchase.supplierId === change.supplierId) {
      return;
    }
    const issues = checkPurchaseAmend(purchase, { ...purchase, ...change });
    if (issues.length > 0) throw new ValidationError(issues);
    await this.write({ ...purchase, ...change }, id);
  }
}

export class ProductsRepository extends SyncedTable<Product> {
  constructor(store: LocalStore) {
    super(store, 'products', 'product', productSchema);
  }

  async list(search = ''): Promise<Local<Product>[]> {
    const products = await this.table.filter((product) => product.voidedAt === null).toArray();
    return products
      .filter((product) =>
        matchesSearch(search, [product.name, product.sku, product.description, ...product.tags]),
      )
      .sort(byName);
  }

  async save(input: ProductInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(productInputSchema, input), id);
  }
}

/** Settings as pulled from the server (a change goes through the API: ShopSettingsRepository). */
export class SettingsRepository {
  constructor(protected readonly store: LocalStore) {}

  /** The value in effect on `day` (YYYY-MM-DD), else the default (settingInEffect, as the API). */
  async get<K extends SettingKey>(key: K, day: string): Promise<SettingValue<K>> {
    const rows = await this.store.db.settings.where('key').equals(key).toArray();
    const parsed = SETTINGS[key].schema.safeParse(settingInEffect(key, rows, day)?.value);
    return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
  }
}
