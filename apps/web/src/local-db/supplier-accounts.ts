import {
  checkSupplierPayment,
  type NewSupplierPaymentInput,
  newSupplierPaymentSchema,
  type Purchase,
  type Supplier,
  type SupplierPayment,
  supplierAccountOf,
  supplierPaymentSchema,
  supplierStatementOf,
} from '@fabric/contracts';
import type { SupplierAccount, SupplierStatementLine } from '@fabric/core';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

class SupplierPaymentsTable extends SyncedTable<SupplierPayment> {
  constructor(store: LocalStore) {
    super(store, 'supplierPayments', 'supplier_payment', supplierPaymentSchema);
  }

  create(fields: object, id: string): Promise<string> {
    return this.write(fields, id);
  }
}

export interface PayableView {
  supplier: Local<Supplier>;
  account: SupplierAccount;
}

export interface SupplierStatementView extends PayableView {
  statement: SupplierStatementLine[];
  purchases: Local<Purchase>[];
  /** Newest first. */
  payments: Local<SupplierPayment>[];
}

const byDateDesc = <R extends { date: string; createdAt: string }>(a: R, b: R) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * What the shop owes its suppliers (SPEC §9, §10, BUILD_PROMPTS 5.3): accounts and statements
 * derived by @fabric/core from purchases and payments, and payments saved on the device first
 * with their outbox op. The server checks a payment again (checkSupplierPayment).
 */
export class SupplierAccountsRepository {
  private readonly payments: SupplierPaymentsTable;

  constructor(private readonly store: LocalStore) {
    this.payments = new SupplierPaymentsTable(store);
  }

  /** Suppliers the shop owes (or holds an advance with), the largest debt first. */
  async payables(): Promise<PayableView[]> {
    const { db } = this.store;
    const [suppliers, purchases, payments] = await Promise.all([
      db.suppliers.filter((supplier) => supplier.voidedAt === null).toArray(),
      db.purchases.toArray(),
      db.supplierPayments.toArray(),
    ]);
    return suppliers
      .map((supplier) => ({
        supplier,
        account: supplierAccountOf(supplier.id, { purchases, payments }),
      }))
      .filter(({ account }) => account.balanceCents !== 0)
      .sort((a, b) => b.account.balanceCents - a.account.balanceCents);
  }

  /** What the shop owes all its suppliers together. */
  async totalOwedCents(): Promise<number> {
    return (await this.payables()).reduce((sum, { account }) => sum + account.owedCents, 0);
  }

  async statement(supplierId: string): Promise<SupplierStatementView | undefined> {
    const { db } = this.store;
    const supplier = await db.suppliers.get(supplierId);
    if (!supplier) return undefined;
    const [purchases, payments] = await Promise.all([
      db.purchases.toArray(),
      db.supplierPayments.where('supplierId').equals(supplierId).toArray(),
    ]);
    const own = purchases.filter((purchase) => purchase.supplierId === supplierId);
    const records = { purchases: own, payments };
    return {
      supplier,
      account: supplierAccountOf(supplierId, records),
      statement: supplierStatementOf(supplierId, records),
      purchases: own.filter((purchase) => purchase.voidedAt === null),
      payments: payments.sort(byDateDesc),
    };
  }

  /** Pays a supplier part of what is owed (SP3); throws ValidationError above that. */
  async pay(input: NewSupplierPaymentInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newSupplierPaymentSchema, input);
    const { db } = this.store;
    const id = crypto.randomUUID();
    const [purchases, payments] = await Promise.all([
      db.purchases.toArray(),
      db.supplierPayments.toArray(),
    ]);
    const issues = checkSupplierPayment({ id, ...parsed }, { purchases, payments });
    if (issues.length > 0) throw new ValidationError(issues);
    return this.payments.create(parsed, id);
  }

  /** A mistaken payment is voided with a reason; what it paid is owed again. */
  voidPayment(id: string, reason: string): Promise<void> {
    return this.payments.void(id, reason);
  }
}
