import type { Customer } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt, isNull } from 'drizzle-orm';
import { baseOf, schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow, SyncHandler } from '../sync/index.js';

type CustomerRow = typeof schema.customer.$inferSelect;

function customerOf(row: CustomerRow): SyncedRow<Customer> {
  return {
    serverSeq: row.serverSeq,
    record: { ...baseOf(row), name: row.name, phone: row.phone, notes: row.notes },
  };
}

/** Customers (SPEC §4.1): a mutable entity, last write wins. */
@Injectable()
export class CustomerRepository implements SyncHandler<'customer'> {
  readonly entity = 'customer' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Customer> | undefined> {
    const [row] = await this.tx.db.select().from(schema.customer).where(eq(schema.customer.id, id));
    return row && customerOf(row);
  }

  async write(record: Customer): Promise<SyncedRow<Customer>> {
    const fields = {
      name: record.name,
      phone: record.phone,
      notes: record.notes,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.customer)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.customer.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return customerOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Customer>> {
    const [row] = await this.tx.db
      .update(schema.customer)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.customer.id, id))
      .returning();
    if (!row) throw new Error(`no customer ${id}`);
    return customerOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Customer>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.customer)
      .where(gt(schema.customer.serverSeq, since))
      .orderBy(asc(schema.customer.serverSeq))
      .limit(limit);
    return rows.map(customerOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<Customer>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.customer)
      .where(includeVoided ? undefined : isNull(schema.customer.voidedAt))
      .orderBy(asc(schema.customer.name));
    return rows.map(customerOf);
  }
}
