import {
  checkSupplierPayment,
  type NewSupplierPaymentInput,
  newSupplierPaymentSchema,
  type Purchase,
  previewSupplierPayment,
  type Supplier,
  type SupplierPayment,
  type SupplierPaymentPreview,
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

/** One supplier of the directory: who they are, what the shop owes them, when it last dealt with them. */
export interface SupplierSummary extends PayableView {
  /** The date of their latest purchase or payment; null when there is none. */
  lastActivity: string | null;
}

/** A purchase from the supplier, with what it brought in. */
export interface SupplierPurchaseRecord {
  purchase: Local<Purchase>;
  /** What was bought, by product name. */
  productNames: string[];
  /** The codes of the batches it brought in: how the purchase is told apart on the shelf. */
  batchCodes: string[];
}

export interface SupplierAccountView extends SupplierSummary {
  statement: SupplierStatementLine[];
  /** Newest first; voided purchases are not part of the account and are left out. */
  purchases: SupplierPurchaseRecord[];
  /** Newest first; voided payments are kept (and marked), they just do not count. */
  payments: Local<SupplierPayment>[];
}

const byDateDesc = <R extends { date: string; createdAt: string }>(a: R, b: R) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

const byName = (a: { supplier: { name: string } }, b: { supplier: { name: string } }) =>
  a.supplier.name.localeCompare(b.supplier.name, 'ar');

const latest = (dates: readonly string[]): string | null =>
  dates.reduce<string | null>((best, date) => (best === null || date > best ? date : best), null);

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

  /** Every supplier with their account, by name: the directory. */
  async list(): Promise<SupplierSummary[]> {
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
        lastActivity: latest([
          ...purchases
            .filter((purchase) => purchase.supplierId === supplier.id && purchase.voidedAt === null)
            .map((purchase) => purchase.date),
          ...payments
            .filter((payment) => payment.supplierId === supplier.id && payment.voidedAt === null)
            .map((payment) => payment.date),
        ]),
      }))
      .sort(byName);
  }

  /** Suppliers the shop owes (or holds an advance with), the largest debt first. */
  async payables(): Promise<PayableView[]> {
    return (await this.list())
      .filter(({ account }) => account.balanceCents !== 0)
      .sort((a, b) => b.account.balanceCents - a.account.balanceCents);
  }

  /** What the shop owes all its suppliers together. */
  async totalOwedCents(): Promise<number> {
    return (await this.payables()).reduce((sum, { account }) => sum + account.owedCents, 0);
  }

  /** One supplier's account with the records it is made of; undefined for an unknown supplier. */
  async account(supplierId: string): Promise<SupplierAccountView | undefined> {
    const { db } = this.store;
    const supplier = await db.suppliers.get(supplierId);
    if (!supplier) return undefined;
    const [purchases, payments] = await Promise.all([
      db.purchases.toArray(),
      db.supplierPayments.where('supplierId').equals(supplierId).toArray(),
    ]);
    const own = purchases.filter((purchase) => purchase.supplierId === supplierId);
    const live = own.filter((purchase) => purchase.voidedAt === null);
    const records = { purchases: own, payments };

    const batches = await db.productBatches
      .where('purchaseId')
      .anyOf(live.map((purchase) => purchase.id))
      .toArray();
    const products = await db.products.bulkGet([...new Set(batches.map((b) => b.productId))]);
    const productName = new Map(
      products.flatMap((product) => (product ? [[product.id, product.name] as const] : [])),
    );
    const purchaseRecords = live.sort(byDateDesc).map((purchase): SupplierPurchaseRecord => {
      const mine = batches
        .filter((batch) => batch.purchaseId === purchase.id)
        .sort((a, b) => a.code.localeCompare(b.code));
      return {
        purchase,
        productNames: [...new Set(mine.flatMap((batch) => productName.get(batch.productId) ?? []))],
        batchCodes: mine.map((batch) => batch.code),
      };
    });
    return {
      supplier,
      account: supplierAccountOf(supplierId, records),
      statement: supplierStatementOf(supplierId, records),
      lastActivity: latest([
        ...live.map((purchase) => purchase.date),
        ...payments.filter((payment) => payment.voidedAt === null).map((payment) => payment.date),
      ]),
      purchases: purchaseRecords,
      payments: payments.sort(byDateDesc),
    };
  }

  /**
   * What a payment would do, from the same check and account as the save (SP2, SP3): where it goes
   * and what stays owed. null while what was typed is not a payment yet (no amount).
   */
  async previewPayment(input: NewSupplierPaymentInput): Promise<SupplierPaymentPreview | null> {
    const parsed = newSupplierPaymentSchema.safeParse(input);
    if (!parsed.success) return null;
    const { db } = this.store;
    const [purchases, payments] = await Promise.all([
      db.purchases.toArray(),
      db.supplierPayments.toArray(),
    ]);
    return previewSupplierPayment(
      { id: crypto.randomUUID(), ...parsed.data },
      { purchases, payments },
    );
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
