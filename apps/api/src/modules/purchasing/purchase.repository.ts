import type { Purchase } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, desc, eq, gt } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow } from '../sync/index.js';

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

  async pull(since: number, limit: number): Promise<SyncedRow<Purchase>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.purchase)
      .where(gt(schema.purchase.serverSeq, since))
      .orderBy(asc(schema.purchase.serverSeq))
      .limit(limit);
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
