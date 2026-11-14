import {
  batchCode,
  batchLedgerOf,
  buildProductPurchase,
  checkProductPurchase,
  checkPurchaseAmend,
  type NewProductPurchaseInput,
  newProductPurchaseSchema,
  type ProductBatch,
  type Purchase,
  supplierAccountOf,
  type ValidationIssue,
} from '@fabric/contracts';
import { type BatchCost, mulDivRoundHalfUp } from '@fabric/core';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { DEVICE_CODE } from './session';
import type { LocalStore } from './store';
import { type PurchasePaymentChange, PurchasePaymentTable } from './tables';

/** The counter the batch codes are numbered by (it continues the roll numbering of old versions). */
const BATCH_COUNTER = 'rollCounter';

/** The device has no code yet (it gets one when signing in online): it cannot number batches. */
export class DeviceNotRegisteredError extends Error {
  override readonly name = 'DeviceNotRegisteredError';
}

export interface PurchaseSummary {
  purchase: Local<Purchase>;
  /** What was bought, by product name (several only for purchases made before batches). */
  productNames: string[];
  supplierName: string | null;
  batchCount: number;
}

/** What a payment correction would leave: the same check and account as the save (SP9). */
export interface PurchasePaymentPreview {
  /** What the server would refuse; empty when the correction is valid. */
  issues: ValidationIssue[];
  /** What is still due on this purchase after it (payments made since count). */
  purchaseDueCents: number;
  /** What the shop owes the supplier in all after it; 0 with no supplier. */
  owedCents: number;
  /** What the supplier holds for the shop after it: payments made since can exceed the debt. */
  advanceCents: number;
}

const newest = (a: Local<Purchase>, b: Local<Purchase>) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * Purchases and the batches they bring in (SPEC §2.3, ADR 0012). A purchase is saved with its
 * batch, the batch's receipt and one outbox op, in one local transaction; the server re-checks
 * it with the same function (checkProductPurchase). Restocking a product and creating a product
 * with its first stock are both this.
 */
export class PurchasesRepository {
  private readonly payments: PurchasePaymentTable;

  constructor(private readonly store: LocalStore) {
    this.payments = new PurchasePaymentTable(store);
  }

  /** Saves the purchase; throws ValidationError for invalid input. Returns the purchase id. */
  async create(input: NewProductPurchaseInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newProductPurchaseSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const purchaseId = crypto.randomUUID();
    await db.transaction(
      'rw',
      [db.purchases, db.productBatches, db.productStockMoves, db.products, db.outbox, db.meta],
      async () => {
        const code = await this.nextCode();
        if (!code) {
          throw new DeviceNotRegisteredError('This device has no code yet: sign in online once');
        }
        const aggregate = buildProductPurchase(
          parsed,
          { purchaseId, batchId: crypto.randomUUID(), moveId: crypto.randomUUID(), code },
          { deviceId, now },
        );
        // The server's own check, here too: a bug shows up before it reaches the outbox.
        const issues = checkProductPurchase(aggregate, await db.products.get(parsed.productId));
        if (issues.length > 0) throw new ValidationError(issues);
        await db.purchases.put({ ...aggregate.purchase, serverSeq: null });
        await db.productBatches.bulkPut(
          aggregate.batches.map((batch) => ({ ...batch, serverSeq: null })),
        );
        await db.productStockMoves.bulkPut(
          aggregate.moves.map((move) => ({ ...move, serverSeq: null })),
        );
        await db.meta.put({ key: BATCH_COUNTER, value: (await this.counter()) + 1 });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'purchase',
          entityId: purchaseId,
          kind: 'append',
          payload: aggregate,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
    return purchaseId;
  }

  /**
   * Corrects what was paid when the purchase was made (SP9): the stock, the cost and the date stay
   * as they were, the supplier owes the rest. A supplier can be set only where there was none (a
   * debt needs a supplier) and is never swapped. Throws ValidationError for what the server
   * refuses, and while the purchase's month is settled and locked.
   */
  setPayment(id: string, change: PurchasePaymentChange): Promise<void> {
    return this.payments.setPayment(id, change);
  }

  /**
   * What correcting the payment would leave, before anything is saved; null for an unknown
   * purchase. The check is the save's (checkPurchaseAmend) and the figures are the supplier
   * account's (core), computed with the corrected purchase in place of the stored one.
   */
  async previewPayment(
    id: string,
    change: PurchasePaymentChange,
  ): Promise<PurchasePaymentPreview | null> {
    const { db } = this.store;
    const purchase = await db.purchases.get(id);
    if (!purchase) return null;
    const next = { ...purchase, ...change };
    const issues = checkPurchaseAmend(purchase, next);
    // What the save would refuse has no account to show (core refuses a purchase paid beyond its total).
    if (issues.length > 0) {
      return { issues, purchaseDueCents: 0, owedCents: 0, advanceCents: 0 };
    }
    if (next.supplierId === null) {
      return {
        issues,
        purchaseDueCents: Math.max(0, next.totalCostCents - next.paidCents),
        owedCents: 0,
        advanceCents: 0,
      };
    }
    const [purchases, payments] = await Promise.all([
      db.purchases.filter((other) => other.supplierId === next.supplierId).toArray(),
      db.supplierPayments.where('supplierId').equals(next.supplierId).toArray(),
    ]);
    const account = supplierAccountOf(next.supplierId, {
      purchases: [...purchases.filter((other) => other.id !== id), next],
      payments,
    });
    return {
      issues,
      purchaseDueCents: account.purchases.find((due) => due.purchaseId === id)?.dueCents ?? 0,
      owedCents: account.owedCents,
      advanceCents: account.advanceCents,
    };
  }

  /** The code the next batch will get (for the confirmation); null without a device code. */
  nextBatchCode(): Promise<string | null> {
    return this.nextCode();
  }

  get(id: string): Promise<Local<Purchase> | undefined> {
    return this.store.db.purchases.get(id);
  }

  async batchesOf(purchaseId: string): Promise<Local<ProductBatch>[]> {
    const batches = await this.store.db.productBatches
      .where('purchaseId')
      .equals(purchaseId)
      .toArray();
    return batches.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Newest first, with the product and supplier names for the list. */
  async list(): Promise<PurchaseSummary[]> {
    const { db } = this.store;
    const [purchases, batches, products, suppliers] = await Promise.all([
      db.purchases.toArray(),
      db.productBatches.toArray(),
      db.products.toArray(),
      db.suppliers.toArray(),
    ]);
    const productName = new Map(products.map((product) => [product.id, product.name]));
    const supplierName = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    return purchases
      .filter((purchase) => purchase.voidedAt === null)
      .sort(newest)
      .map((purchase) => {
        const own = batches.filter((batch) => batch.purchaseId === purchase.id);
        const names = [...new Set(own.flatMap((batch) => productName.get(batch.productId) ?? []))];
        return {
          purchase,
          productNames: names,
          supplierName: purchase.supplierId
            ? (supplierName.get(purchase.supplierId) ?? null)
            : null,
          batchCount: own.length,
        };
      });
  }

  /**
   * The product's previous batch (SPEC §8.5 renewal warning): what its latest purchase cost,
   * against the length the batch's cost is spread over (its meters; a weight counts with the
   * length it makes, estimated until measured, as the ledger reads it). null for a product never
   * bought, or when that purchase has no length (a weight awaiting a measurement, or pieces).
   */
  async lastBatchOf(productId: string): Promise<BatchCost[] | null> {
    const { db } = this.store;
    const batches = (await db.productBatches.where('productId').equals(productId).toArray())
      .filter((batch) => batch.voidedAt === null)
      .sort(
        (a, b) =>
          b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt),
      );
    const latest = batches[0];
    if (!latest) return null;
    const moves = await db.productStockMoves.where('batchId').equals(latest.id).toArray();
    let ledger;
    try {
      ledger = batchLedgerOf(latest, moves);
    } catch {
      // A batch the ledger cannot read has no length to compare with.
      return null;
    }
    // A weight makes the length its conversion gives for the weight received (the conversion is
    // a proportion, or the whole batch once measured); a meter batch is its corrected length.
    const conversion = ledger.conversion;
    const lengthCm =
      latest.unit === 'meter'
        ? ledger.lengthBasisCm
        : latest.unit === 'kg' && conversion
          ? mulDivRoundHalfUp(latest.receivedQuantity, conversion.lengthCm, conversion.weightG)
          : null;
    if (lengthCm === null || lengthCm < 1) return null;
    return [{ costTotalCents: latest.costTotalCents, lengthCm }];
  }

  private async counter(): Promise<number> {
    const value = await this.store.getMeta(BATCH_COUNTER);
    return typeof value === 'number' ? value : 0;
  }

  private async nextCode(): Promise<string | null> {
    const code = await this.store.getMeta(DEVICE_CODE);
    if (typeof code !== 'string') return null;
    return batchCode(code, (await this.counter()) + 1);
  }
}
