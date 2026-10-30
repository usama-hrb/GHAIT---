import type { Payment, PaymentAllocation, WriteOff } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow } from '../sync/index.js';

type PaymentRow = typeof schema.payment.$inferSelect;

function paymentOf(row: PaymentRow): SyncedRow<Payment> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      customerId: row.customerId,
      kind: row.kind,
      amountCents: row.amountCents,
      date: row.date,
      method: row.method,
      note: row.note,
    },
  };
}

/** Append-only (row guards): payments and refunds. */
@Injectable()
export class PaymentRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Payment> | undefined> {
    const [row] = await this.tx.db.select().from(schema.payment).where(eq(schema.payment.id, id));
    return row && paymentOf(row);
  }

  async insert(payment: Payment): Promise<void> {
    await this.tx.db.insert(schema.payment).values({
      ...baseValues(payment),
      customerId: payment.customerId,
      kind: payment.kind,
      amountCents: payment.amountCents,
      date: payment.date,
      method: payment.method,
      note: payment.note,
    });
  }

  async findMany(ids: readonly string[]): Promise<SyncedRow<Payment>[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.payment)
      .where(inArray(schema.payment.id, [...ids]));
    return rows.map(paymentOf);
  }

  async listByCustomer(customerId: string): Promise<SyncedRow<Payment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.customerId, customerId))
      .orderBy(asc(schema.payment.createdAt), asc(schema.payment.id));
    return rows.map(paymentOf);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Payment>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.payment)
      .where(gt(schema.payment.serverSeq, since))
      .orderBy(asc(schema.payment.serverSeq))
      .limit(limit);
    return rows.map(paymentOf);
  }
}

type AllocationRow = typeof schema.paymentAllocation.$inferSelect;

function allocationOf(row: AllocationRow): SyncedRow<PaymentAllocation> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      paymentId: row.paymentId,
      saleId: row.saleId,
      amountCents: row.amountCents,
      date: row.date,
    },
  };
}

/** Append-only (row guards): which sale a payment pays, and how much of it. */
@Injectable()
export class PaymentAllocationRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<PaymentAllocation> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.paymentAllocation)
      .where(eq(schema.paymentAllocation.id, id));
    return row && allocationOf(row);
  }

  async insertMany(allocations: readonly PaymentAllocation[]): Promise<void> {
    if (allocations.length === 0) return;
    await this.tx.db.insert(schema.paymentAllocation).values(
      allocations.map((allocation) => ({
        ...baseValues(allocation),
        paymentId: allocation.paymentId,
        saleId: allocation.saleId,
        amountCents: allocation.amountCents,
        date: allocation.date,
      })),
    );
  }

  async listByPayments(paymentIds: readonly string[]): Promise<SyncedRow<PaymentAllocation>[]> {
    if (paymentIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.paymentAllocation)
      .where(inArray(schema.paymentAllocation.paymentId, [...paymentIds]))
      .orderBy(asc(schema.paymentAllocation.createdAt), asc(schema.paymentAllocation.id));
    return rows.map(allocationOf);
  }

  async listBySale(saleId: string): Promise<SyncedRow<PaymentAllocation>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.paymentAllocation)
      .where(eq(schema.paymentAllocation.saleId, saleId))
      .orderBy(asc(schema.paymentAllocation.createdAt), asc(schema.paymentAllocation.id));
    return rows.map(allocationOf);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<PaymentAllocation>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.paymentAllocation)
      .where(gt(schema.paymentAllocation.serverSeq, since))
      .orderBy(asc(schema.paymentAllocation.serverSeq))
      .limit(limit);
    return rows.map(allocationOf);
  }
}

type WriteOffRow = typeof schema.writeOff.$inferSelect;

function writeOffOf(row: WriteOffRow): SyncedRow<WriteOff> {
  return {
    serverSeq: row.serverSeq,
    record: { ...baseOf(row), saleId: row.saleId, date: row.date, reason: row.reason },
  };
}

/** Append-only (row guards); one per sale (unique sale_id). */
@Injectable()
export class WriteOffRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<WriteOff> | undefined> {
    const [row] = await this.tx.db.select().from(schema.writeOff).where(eq(schema.writeOff.id, id));
    return row && writeOffOf(row);
  }

  async listBySales(saleIds: readonly string[]): Promise<SyncedRow<WriteOff>[]> {
    if (saleIds.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.writeOff)
      .where(inArray(schema.writeOff.saleId, [...saleIds]));
    return rows.map(writeOffOf);
  }

  async insert(writeOff: WriteOff): Promise<SyncedRow<WriteOff>> {
    const [row] = await this.tx.db
      .insert(schema.writeOff)
      .values({
        ...baseValues(writeOff),
        saleId: writeOff.saleId,
        date: writeOff.date,
        reason: writeOff.reason,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return writeOffOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<WriteOff>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.writeOff)
      .where(gt(schema.writeOff.serverSeq, since))
      .orderBy(asc(schema.writeOff.serverSeq))
      .limit(limit);
    return rows.map(writeOffOf);
  }
}
