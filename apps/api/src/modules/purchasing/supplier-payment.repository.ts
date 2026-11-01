import {
  checkSupplierPayment,
  checkSupplierPaymentUnchanged,
  type SupplierPayment,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';
import { PurchaseRepository } from './purchase.repository.js';

type PaymentRow = typeof schema.supplierPayment.$inferSelect;

function paymentOf(row: PaymentRow): SyncedRow<SupplierPayment> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      supplierId: row.supplierId,
      purchaseId: row.purchaseId,
      amountCents: row.amountCents,
      date: row.date,
      method: row.method,
      note: row.note,
    },
  };
}

/**
 * Money paid to suppliers for what purchases left owing (SP3): created once, never more than the
 * supplier is owed (checkSupplierPayment), then only voided with a reason.
 */
@Injectable()
export class SupplierPaymentRepository implements SyncHandler<'supplier_payment'> {
  readonly entity = 'supplier_payment' as const;

  constructor(
    private readonly tx: TransactionHost,
    private readonly purchases: PurchaseRepository,
  ) {}

  async find(id: string): Promise<SyncedRow<SupplierPayment> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.supplierPayment)
      .where(eq(schema.supplierPayment.id, id));
    return row && paymentOf(row);
  }

  async write(record: SupplierPayment): Promise<SyncedRow<SupplierPayment>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkSupplierPaymentUnchanged(current.record, record);
      if (issues.length > 0) {
        throw new SyncRejection('validation_failed', 'A supplier payment is never edited', issues);
      }
      return current;
    }
    const issues = checkSupplierPayment(record, {
      purchases: (await this.purchases.listBySupplier(record.supplierId)).map((row) => row.record),
      payments: (await this.listBySupplier(record.supplierId)).map((row) => row.record),
    });
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'Invalid supplier payment', issues);
    }
    const [row] = await this.tx.db
      .insert(schema.supplierPayment)
      .values({
        ...baseValues(record),
        supplierId: record.supplierId,
        purchaseId: record.purchaseId,
        amountCents: record.amountCents,
        date: record.date,
        method: record.method,
        note: record.note,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return paymentOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<SupplierPayment>> {
    const [row] = await this.tx.db
      .update(schema.supplierPayment)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.supplierPayment.id, id))
      .returning();
    if (!row) throw new Error(`no supplier payment ${id}`);
    return paymentOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<SupplierPayment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.supplierPayment)
      .where(gt(schema.supplierPayment.serverSeq, since))
      .orderBy(asc(schema.supplierPayment.serverSeq))
      .limit(limit);
    return rows.map(paymentOf);
  }

  async listBySupplier(supplierId: string): Promise<SyncedRow<SupplierPayment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.supplierPayment)
      .where(eq(schema.supplierPayment.supplierId, supplierId))
      .orderBy(asc(schema.supplierPayment.serverSeq));
    return rows.map(paymentOf);
  }
}
