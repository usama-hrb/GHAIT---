import {
  buildCreditApplication,
  buildPayment,
  buildRefund,
  buildWriteOff,
  checkAllocations,
  checkPaymentAggregate,
  checkWriteOff,
  type CreditApplication,
  type CustomerAccountDetail,
  type CustomerInput,
  customerAccountOf,
  customerInputSchema,
  type CustomerRecords,
  type DebtSummary,
  type NewPayment,
  type NewRefund,
  type Payment,
  type PaymentAggregate,
  type PaymentAllocation,
  SERVER_DEVICE_ID,
  shopDate,
  type StoredCustomer,
  type ValidationIssue,
  type WriteOff,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { ReceivablesService } from '../receivables/index.js';
import { SalesService } from '../sales/index.js';
import {
  type SyncedRow,
  type SyncHandler,
  SyncRegistry,
  SyncRejection,
  SyncService,
} from '../sync/index.js';
import { CustomerRepository } from './customers.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Customers and what they owe (SPEC §4.1, §8.2, BUILD_PROMPTS 3.5): payments aimed at an invoice
 * or spread over the oldest, credit (applied or refunded), and bad-debt write-offs. Devices push
 * them through sync; these checks run on every push (@fabric/contracts checkPaymentAggregate,
 * checkAllocations, checkWriteOff), and the REST operations build them on the server.
 */
@Injectable()
export class CustomersService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly customers: CustomerRepository,
    private readonly receivables: ReceivablesService,
    private readonly sales: SalesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.customers);
    const payments: SyncHandler<'payment'> = {
      entity: 'payment',
      find: (id) => this.receivables.findPayment(id),
      pull: (since, limit) => this.receivables.pullPayments(since, limit),
      append: (aggregate, context) => this.receivePayment(aggregate, context),
    };
    const allocations: SyncHandler<'payment_allocation'> = {
      entity: 'payment_allocation',
      find: (id) => this.receivables.findAllocation(id),
      pull: (since, limit) => this.receivables.pullAllocations(since, limit),
      append: (application, context) => this.receiveCredit(application, context),
    };
    const writeOffs: SyncHandler<'write_off'> = {
      entity: 'write_off',
      find: (id) => this.receivables.findWriteOff(id),
      pull: (since, limit) => this.receivables.pullWriteOffs(since, limit),
      append: (writeOff, context) => this.receiveWriteOff(writeOff, context),
    };
    this.registry.register(payments);
    this.registry.register(allocations);
    this.registry.register(writeOffs);
  }

  async list(includeVoided: boolean): Promise<StoredCustomer[]> {
    return (await this.customers.list(includeVoided)).map(stored);
  }

  async get(id: string): Promise<StoredCustomer> {
    return stored(await this.found(id));
  }

  /** Creates or updates through SyncService (same validation and audit as a device). */
  async put(id: string, input: CustomerInput): Promise<StoredCustomer> {
    const current = await this.customers.find(id);
    const now = new Date().toISOString();
    const written = await this.sync.saveDirect('customer', {
      ...customerInputSchema.parse(input),
      id,
      createdAt: current?.record.createdAt ?? now,
      updatedAt: now,
      deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      voidedAt: current?.record.voidedAt ?? null,
    });
    return stored(written) as StoredCustomer;
  }

  async void(id: string, reason: string): Promise<StoredCustomer> {
    return stored(await this.sync.voidDirect('customer', id, reason)) as StoredCustomer;
  }

  /** The customer's account and the records it comes from. */
  async account(id: string): Promise<CustomerAccountDetail> {
    const customer = await this.found(id);
    const records = await this.records(id);
    return {
      customer: stored(customer),
      account: customerAccountOf(records, shopDate(new Date())),
      payments: [...records.payments],
      allocations: [...records.allocations],
      writeOffs: [...records.writeOffs],
    };
  }

  /** Who owes the shop (SPEC §4.1 "ديون الزبائن"): the oldest debt first. */
  async debts(): Promise<DebtSummary[]> {
    const today = shopDate(new Date());
    const customers = await this.customers.list(false);
    const summaries = await Promise.all(
      customers.map(async (customer) => ({
        customer: stored(customer),
        account: customerAccountOf(await this.records(customer.record.id), today),
      })),
    );
    return summaries
      .filter((summary) => summary.account.collectibleCents > 0)
      .sort(
        (a, b) =>
          (a.account.oldestOpenDate ?? '').localeCompare(b.account.oldestOpenDate ?? '') ||
          b.account.collectibleCents - a.account.collectibleCents,
      );
  }

  /** REST: a payment, applied by the server on its own view of the account. */
  async pay(input: NewPayment): Promise<CustomerAccountDetail> {
    await this.found(input.customerId);
    const built = buildPayment(
      input,
      await this.records(input.customerId),
      { paymentId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      this.meta(),
    );
    if (!built.ok) throw this.invalid(built.issues);
    await this.sync.appendDirect('payment', built.aggregate.payment.id, built.aggregate);
    return this.account(input.customerId);
  }

  async refund(input: NewRefund): Promise<CustomerAccountDetail> {
    await this.found(input.customerId);
    const built = buildRefund(
      input,
      await this.records(input.customerId),
      { paymentId: crypto.randomUUID() },
      { ...this.meta(), today: shopDate(new Date()) },
    );
    if (!built.ok) throw this.invalid(built.issues);
    await this.sync.appendDirect('payment', built.aggregate.payment.id, built.aggregate);
    return this.account(input.customerId);
  }

  async applyCredit(customerId: string): Promise<CustomerAccountDetail> {
    await this.found(customerId);
    const built = buildCreditApplication(
      await this.records(customerId),
      { newId: () => crypto.randomUUID() },
      { ...this.meta(), date: shopDate(new Date()) },
    );
    if (!built.ok) throw this.invalid(built.issues);
    const [first] = built.application.allocations;
    if (first) await this.sync.appendDirect('payment_allocation', first.id, built.application);
    return this.account(customerId);
  }

  async writeOff(
    customerId: string,
    saleId: string,
    reason: string,
  ): Promise<CustomerAccountDetail> {
    const sale = await this.sales.findSale(saleId);
    if (!sale || sale.customerId !== customerId) {
      throw new AppHttpException(
        'not_found',
        `No sale ${saleId} of this customer`,
        HttpStatus.NOT_FOUND,
      );
    }
    const meta = this.meta();
    const writeOff = buildWriteOff(
      { saleId, reason, date: shopDate(new Date(meta.now)) },
      { id: crypto.randomUUID() },
      meta,
    );
    await this.sync.appendDirect('write_off', writeOff.id, writeOff);
    return this.account(customerId);
  }

  private async records(customerId: string): Promise<CustomerRecords> {
    const [sales, payments] = await Promise.all([
      this.sales.salesOfCustomer(customerId),
      this.receivables.paymentsOfCustomer(customerId),
    ]);
    const [allocations, writeOffs] = await Promise.all([
      this.receivables.allocationsOfPayments(payments.map((payment) => payment.record.id)),
      this.receivables.writeOffsOfSales(sales.map((sale) => sale.id)),
    ]);
    return {
      sales,
      payments: payments.map((row) => ({ ...row.record, serverSeq: row.serverSeq })),
      allocations: allocations.map((row) => row.record),
      writeOffs: writeOffs.map((row) => row.record),
    };
  }

  private async receivePayment(
    aggregate: PaymentAggregate,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<Payment>> {
    const { payment } = aggregate;
    if (payment.id !== context.entityId || payment.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The payment does not match the op (id or device)');
    }
    const sales = await this.sales.salesByIds(aggregate.allocations.map((a) => a.saleId));
    const issues = checkPaymentAggregate(aggregate, sales);
    if (issues.length > 0) throw new SyncRejection('validation_failed', 'Invalid payment', issues);
    await this.receivables.record(payment, aggregate.allocations);
    return this.stored(await this.receivables.findPayment(payment.id));
  }

  private async receiveCredit(
    application: CreditApplication,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<PaymentAllocation>> {
    const { allocations } = application;
    if (
      allocations[0]?.id !== context.entityId ||
      allocations.some((allocation) => allocation.deviceId !== context.deviceId)
    ) {
      throw new SyncRejection('bad_request', 'The allocations do not match the op (id or device)');
    }
    const paymentIds = [...new Set(allocations.map((allocation) => allocation.paymentId))];
    const [payments, existing, sales] = await Promise.all([
      this.receivables.paymentsByIds(paymentIds),
      this.receivables.allocationsOfPayments(paymentIds),
      this.sales.salesByIds(allocations.map((allocation) => allocation.saleId)),
    ]);
    const applied = new Map<string, number>();
    for (const row of existing) {
      applied.set(
        row.record.paymentId,
        (applied.get(row.record.paymentId) ?? 0) + row.record.amountCents,
      );
    }
    const issues = checkAllocations(
      allocations,
      new Map(payments.map((row) => [row.record.id, row.record])),
      sales,
      applied,
    );
    if (issues.length > 0) throw new SyncRejection('validation_failed', 'Invalid credit', issues);
    await this.receivables.apply(allocations);
    return this.stored(await this.receivables.findAllocation(context.entityId));
  }

  private async receiveWriteOff(
    writeOff: WriteOff,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<WriteOff>> {
    if (writeOff.id !== context.entityId || writeOff.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The write-off does not match the op (id or device)');
    }
    const sale = await this.sales.findSale(writeOff.saleId);
    const records = sale?.customerId ? await this.records(sale.customerId) : undefined;
    const issues = checkWriteOff(writeOff, sale, records);
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid write-off', issues);
    return this.receivables.writeOff(writeOff);
  }

  private stored<R>(row: SyncedRow<R> | undefined): SyncedRow<R> {
    if (!row) throw new Error('a record just written was not found');
    return row;
  }

  private async found(id: string) {
    const row = await this.customers.find(id);
    if (!row) throw new AppHttpException('not_found', `No customer ${id}`, HttpStatus.NOT_FOUND);
    return row;
  }

  private meta() {
    return {
      deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      now: new Date().toISOString(),
    };
  }

  /** The first issue's code as the message (the web shows i18n text for each). */
  private invalid(issues: readonly ValidationIssue[]) {
    return new AppHttpException(
      'validation_failed',
      issues[0]?.message ?? 'Invalid',
      HttpStatus.BAD_REQUEST,
    );
  }
}
