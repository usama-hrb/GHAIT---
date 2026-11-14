import { checkPurchaseAmend, type Purchase } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, desc, eq, gt } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, SyncRejection } from '../sync/index.js';

type PurchaseRow = typeof schema.purchase.$inferSelect;

function purchaseOf(row: PurchaseRow): SyncedRow<Purchase> {
  return {
    serverSeq: row.serverSeq,
    record: {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deviceId: row.deviceId,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      date: row.date,
      supplierId: row.supplierId,
      method: row.method,
      pricePerMeterCents: row.pricePerMeterCents,
      weightG: row.weightG,
      estCmPerKg: row.estCmPerKg,
      totalCostCents: row.totalCostCents,
      paidCents: row.paidCents,
      notes: row.notes,
    },
  };
}

@Injectable()
export class PurchaseRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Purchase> | undefined> {
    const [row] = await this.tx.db.select().from(schema.purchase).where(eq(schema.purchase.id, id));
    return row && purchaseOf(row);
  }

  async insert(purchase: Purchase): Promise<SyncedRow<Purchase>> {
    const [row] = await this.tx.db
      .insert(schema.purchase)
      .values({
        id: purchase.id,
        createdAt: new Date(purchase.createdAt),
        updatedAt: new Date(purchase.updatedAt),
        deviceId: purchase.deviceId,
        date: purchase.date,
        supplierId: purchase.supplierId,
        method: purchase.method,
        pricePerMeterCents: purchase.pricePerMeterCents,
        weightG: purchase.weightG,
        estCmPerKg: purchase.estCmPerKg,
        totalCostCents: purchase.totalCostCents,
        paidCents: purchase.paidCents,
        notes: purchase.notes,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return purchaseOf(row);
  }

  /**
   * A correction of what was paid (SP9), as an upsert op of the record. Only that changes (and a
   * supplier where there was none): checkPurchaseAmend refuses the rest, so the stock a purchase
   * brought in and what it cost stay as they were.
   */
  async amend(record: Purchase): Promise<SyncedRow<Purchase>> {
    const current = await this.find(record.id);
    if (!current) {
      throw new SyncRejection('not_found', 'A purchase is made together with its stock');
    }
    const issues = checkPurchaseAmend(current.record, record);
    if (issues.length > 0) {
      throw new SyncRejection(
        'validation_failed',
        'Only what was paid on a purchase can change',
        issues,
      );
    }
    const [row] = await this.tx.db
      .update(schema.purchase)
      .set({
        paidCents: record.paidCents,
        supplierId: record.supplierId,
        updatedAt: new Date(record.updatedAt),
        deviceId: record.deviceId,
      })
      .where(eq(schema.purchase.id, record.id))
      .returning();
    if (!row) throw new Error(`no purchase ${record.id}`);
    return purchaseOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Purchase>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.purchase)
      .where(gt(schema.purchase.serverSeq, since))
      .orderBy(asc(schema.purchase.serverSeq))
      .limit(limit);
    return rows.map(purchaseOf);
  }

  /** Every purchase of a supplier, oldest first (their account, SP1). */
  async listBySupplier(supplierId: string): Promise<SyncedRow<Purchase>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.purchase)
      .where(eq(schema.purchase.supplierId, supplierId))
      .orderBy(asc(schema.purchase.date), asc(schema.purchase.serverSeq));
    return rows.map(purchaseOf);
  }

  /** Newest first. */
  async list(limit: number): Promise<SyncedRow<Purchase>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.purchase)
      .orderBy(desc(schema.purchase.date), desc(schema.purchase.serverSeq))
      .limit(limit);
    return rows.map(purchaseOf);
  }
}
