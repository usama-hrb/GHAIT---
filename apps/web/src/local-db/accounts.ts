import {
  buildCreditApplication,
  buildPayment,
  buildRefund,
  buildWriteOff,
  checkPaymentAggregate,
  checkWriteOff,
  type Customer,
  type CustomerRecords,
  customerAccountOf,
  type NewPaymentInput,
  newPaymentSchema,
  type NewRefundInput,
  newRefundSchema,
  type Payment,
  type PaymentAggregate,
  type PaymentAllocation,
  type Sale,
  type SaleReturn,
  voidPayloadSchema,
  type WriteOff,
} from '@fabric/contracts';
import type { CustomerAccount } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import { matchesSearch } from '@/shared/lib/search';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';

export interface CustomerAccountView {
  customer: Local<Customer>;
  account: CustomerAccount;
  /** Their sales, newest first (voided ones included). */
  sales: Local<Sale>[];
  /** Their payments and refunds, newest first. */
  payments: Local<Payment>[];
  allocations: Local<PaymentAllocation>[];
  writeOffs: Local<WriteOff>[];
  /** The goods they gave back (RT1), newest first. */
  returns: Local<SaleReturn>[];
}

export interface CustomerSummary {
  customer: Local<Customer>;
  account: CustomerAccount;
}

const newestFirst = <R extends { date: string; createdAt: string }>(a: R, b: R) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

async function recordsOf(
  db: ShopDatabase,
  customerId: string,
): Promise<{
  sales: Local<Sale>[];
  payments: Local<Payment>[];
  allocations: Local<PaymentAllocation>[];
  writeOffs: Local<WriteOff>[];
  returns: Local<SaleReturn>[];
}> {
  const [sales, payments] = await Promise.all([
    db.sales.where('customerId').equals(customerId).toArray(),
    db.payments.where('customerId').equals(customerId).toArray(),
  ]);
  const [allocations, writeOffs, returns] = await Promise.all([
    db.paymentAllocations
      .where('paymentId')
      .anyOf(payments.map((payment) => payment.id))
      .toArray(),
    db.writeOffs
      .where('saleId')
      .anyOf(sales.map((sale) => sale.id))
      .toArray(),
    db.saleReturns
      .where('saleId')
      .anyOf(sales.map((sale) => sale.id))
      .toArray(),
  ]);
  return { sales, payments, allocations, writeOffs, returns };
}

/**
 * What customers owe and pay (SPEC §4.1, §8.2, BUILD_PROMPTS 3.5): accounts derived by
 * @fabric/core, and payments, refunds, credit and write-offs saved on the device first, each
 * with its outbox op. The server checks them again (checkPaymentAggregate, checkWriteOff…).
 */
export class AccountsRepository {
  constructor(private readonly store: LocalStore) {}

  async account(customerId: string): Promise<CustomerAccountView | undefined> {
    const { db } = this.store;
    const customer = await db.customers.get(customerId);
    if (!customer) return undefined;
    const records = await recordsOf(db, customerId);
    return {
      customer,
      account: customerAccountOf(records, shopToday(this.store.now())),
      sales: records.sales.sort(newestFirst),
      payments: records.payments.sort(newestFirst),
      allocations: records.allocations,
      writeOffs: records.writeOffs,
      returns: records.returns.sort(newestFirst),
    };
  }

  /** Every live customer with their account, by name; `search` on name and phone. */
  async list(search = ''): Promise<CustomerSummary[]> {
    const { db } = this.store;
    const today = shopToday(this.store.now());
    const [customers, sales, payments, allocations, writeOffs, returns] = await Promise.all([
      db.customers.filter((customer) => customer.voidedAt === null).toArray(),
      db.sales.toArray(),
      db.payments.toArray(),
      db.paymentAllocations.toArray(),
      db.writeOffs.toArray(),
      db.saleReturns.toArray(),
    ]);
    return customers
      .filter((customer) => matchesSearch(search, [customer.name, customer.phone, customer.notes]))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      .map((customer) => {
        const own = sales.filter((sale) => sale.customerId === customer.id);
        const paid = payments.filter((payment) => payment.customerId === customer.id);
        const paymentIds = new Set(paid.map((payment) => payment.id));
        const saleIds = new Set(own.map((sale) => sale.id));
        return {
          customer,
          account: customerAccountOf(
            {
              sales: own,
              payments: paid,
              allocations: allocations.filter((allocation) => paymentIds.has(allocation.paymentId)),
              writeOffs: writeOffs.filter((writeOff) => saleIds.has(writeOff.saleId)),
              returns: returns.filter((given) => saleIds.has(given.saleId)),
            },
            today,
          ),
        };
      });
  }

  /** Who owes the shop: oldest debt first, or the largest first. */
  async debts(order: 'oldest' | 'largest' = 'oldest'): Promise<CustomerSummary[]> {
    const owing = (await this.list()).filter((summary) => summary.account.collectibleCents > 0);
    return owing.sort((a, b) =>
      order === 'oldest'
        ? (a.account.oldestOpenDate ?? '').localeCompare(b.account.oldestOpenDate ?? '') ||
          b.account.collectibleCents - a.account.collectibleCents
        : b.account.collectibleCents - a.account.collectibleCents ||
          (a.account.oldestOpenDate ?? '').localeCompare(b.account.oldestOpenDate ?? ''),
    );
  }

  /** How a payment would be applied (the dialog shows it before saving). */
  async previewPayment(input: NewPaymentInput): Promise<{
    allocations: { saleId: string; amountCents: number }[];
    unappliedCents: number;
  } | null> {
    const parsed = newPaymentSchema.safeParse(input);
    if (!parsed.success) return null;
    const records = await recordsOf(this.store.db, parsed.data.customerId);
    const built = buildPayment(
      parsed.data,
      records,
      { paymentId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      { deviceId: 'preview', now: this.store.now().toISOString() },
    );
    if (!built.ok) return null;
    return {
      allocations: built.aggregate.allocations.map(({ saleId, amountCents }) => ({
        saleId,
        amountCents,
      })),
      unappliedCents: built.unappliedCents,
    };
  }

  /**
   * Records a payment: to the chosen invoice first, then the oldest unpaid ones; what is left
   * stays as the customer's credit (P6). Returns that rest.
   */
  async recordPayment(
    input: NewPaymentInput,
  ): Promise<{ paymentId: string; unappliedCents: number }> {
    const parsed = parseOrThrow(newPaymentSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const paymentId = crypto.randomUUID();
    let unappliedCents = 0;
    await this.save(parsed.customerId, (records, meta) => {
      const built = buildPayment(
        parsed,
        records,
        { paymentId, newId: () => crypto.randomUUID() },
        meta,
      );
      if (!built.ok) throw new ValidationError(built.issues);
      unappliedCents = built.unappliedCents;
      return built.aggregate;
    });
    return { paymentId, unappliedCents };
  }

  /** Gives money back out of the customer's credit (never more than it). */
  async refund(input: NewRefundInput): Promise<string> {
    const parsed = parseOrThrow(newRefundSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const paymentId = crypto.randomUUID();
    await this.save(parsed.customerId, (records, meta) => {
      const built = buildRefund(
        parsed,
        records,
        { paymentId },
        { ...meta, today: shopToday(this.store.now()) },
      );
      if (!built.ok) throw new ValidationError(built.issues);
      return built.aggregate;
    });
    return paymentId;
  }

  /** Applies the customer's credit to their unpaid invoices, oldest first. */
  async applyCredit(customerId: string): Promise<void> {
    this.store.assertWritable();
    await this.store.assertPeriodOpen([shopToday(this.store.now())]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction(
      'rw',
      [db.sales, db.payments, db.paymentAllocations, db.writeOffs, db.saleReturns, db.outbox],
      async () => {
        const records = await recordsOf(db, customerId);
        const built = buildCreditApplication(
          records,
          { newId: () => crypto.randomUUID() },
          { deviceId, now, date: shopToday(this.store.now()) },
        );
        if (!built.ok) throw new ValidationError(built.issues);
        const { allocations } = built.application;
        await db.paymentAllocations.bulkPut(
          allocations.map((allocation) => ({ ...allocation, serverSeq: null })),
        );
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'payment_allocation',
          entityId: allocations[0]?.id ?? '',
          kind: 'append',
          payload: built.application,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
  }

  /** Writes off what is due on a credit sale as a bad debt (SPEC §4.1, S5); the reason is required. */
  async writeOff(saleId: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const payload = parseOrThrow(voidPayloadSchema, { reason });
    await this.store.assertPeriodOpen([shopToday(this.store.now())]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction(
      'rw',
      [db.sales, db.payments, db.paymentAllocations, db.writeOffs, db.saleReturns, db.outbox],
      async () => {
        const sale = await db.sales.get(saleId);
        const records = sale?.customerId ? await recordsOf(db, sale.customerId) : undefined;
        const writeOff = buildWriteOff(
          { saleId, reason: payload.reason, date: shopToday(this.store.now()) },
          { id: crypto.randomUUID() },
          { deviceId, now },
        );
        const issues = checkWriteOff(writeOff, sale, records);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.writeOffs.put({ ...writeOff, serverSeq: null });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'write_off',
          entityId: writeOff.id,
          kind: 'append',
          payload: writeOff,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
  }

  /** A payment or refund built on the customer's records, saved with its op in one transaction. */
  private async save(
    customerId: string,
    build: (records: CustomerRecords, meta: { deviceId: string; now: string }) => PaymentAggregate,
  ): Promise<void> {
    this.store.assertWritable();
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction(
      'rw',
      [db.sales, db.payments, db.paymentAllocations, db.writeOffs, db.saleReturns, db.outbox],
      async () => {
        const records = await recordsOf(db, customerId);
        const aggregate = build(records, { deviceId, now });
        const issues = checkPaymentAggregate(
          aggregate,
          new Map(records.sales.map((sale) => [sale.id, sale])),
        );
        if (issues.length > 0) throw new ValidationError(issues);
        await db.payments.put({ ...aggregate.payment, serverSeq: null });
        await db.paymentAllocations.bulkPut(
          aggregate.allocations.map((allocation) => ({ ...allocation, serverSeq: null })),
        );
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'payment',
          entityId: aggregate.payment.id,
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
  }
}
