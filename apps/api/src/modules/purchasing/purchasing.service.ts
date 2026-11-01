import {
  checkPurchaseAggregate,
  type NewSupplierPayment,
  type Purchase,
  type PurchaseAggregate,
  type PurchaseDetail,
  type StoredPurchase,
  type StoredSupplierPayment,
  SERVER_DEVICE_ID,
  type SupplierPayable,
  type SupplierPayment,
  type SupplierStatementDetail,
  supplierAccountOf,
  supplierStatementOf,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { InventoryService } from '../inventory/index.js';
import {
  type SyncedRow,
  type SyncHandler,
  SyncRegistry,
  SyncRejection,
  SyncService,
} from '../sync/index.js';
import { PurchaseRepository } from './purchase.repository.js';
import { SupplierPaymentRepository } from './supplier-payment.repository.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Purchases → rolls (SPEC §2.3). A device sends one append op with the purchase and the rolls and
 * stock moves it creates; this re-checks them with @fabric/core (checkPurchaseAggregate) and
 * stores them atomically, in the op's transaction.
 */
@Injectable()
export class PurchasingService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly purchases: PurchaseRepository,
    private readonly supplierPayments: SupplierPaymentRepository,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit(): void {
    const handler: SyncHandler<'purchase'> = {
      entity: 'purchase',
      find: (id) => this.purchases.find(id),
      pull: (since, limit) => this.purchases.pull(since, limit),
      append: (aggregate, context) => this.receive(aggregate, context),
    };
    this.registry.register(handler);
    this.registry.register(this.supplierPayments);
  }

  /** Who the shop owes, the largest debt first (SP1). */
  async payables(): Promise<SupplierPayable[]> {
    const [suppliers, purchases, payments] = await Promise.all([
      this.sync.readAll('supplier'),
      this.sync.readAll('purchase'),
      this.sync.readAll('supplier_payment'),
    ]);
    const records = {
      purchases: purchases.map((row) => row.record),
      payments: payments.map((row) => row.record),
    };
    return suppliers
      .filter((row) => row.record.voidedAt === null)
      .map((row) => ({ supplier: stored(row), account: supplierAccountOf(row.record.id, records) }))
      .filter(({ account }) => account.balanceCents !== 0)
      .sort((a, b) => b.account.balanceCents - a.account.balanceCents);
  }

  /** A supplier's account and statement (BUILD_PROMPTS 5.3). */
  async statement(supplierId: string): Promise<SupplierStatementDetail> {
    const supplier = await this.sync.find('supplier', supplierId);
    if (!supplier) {
      throw new AppHttpException('not_found', `No supplier ${supplierId}`, HttpStatus.NOT_FOUND);
    }
    const [purchases, payments] = await Promise.all([
      this.purchases.listBySupplier(supplierId),
      this.supplierPayments.listBySupplier(supplierId),
    ]);
    const records = {
      purchases: purchases.map((row) => row.record),
      payments: payments.map((row) => row.record),
    };
    return {
      supplier: stored(supplier) as SupplierStatementDetail['supplier'],
      account: supplierAccountOf(supplierId, records),
      statement: supplierStatementOf(supplierId, records),
      payments: payments.map(stored),
    };
  }

  /** REST: pays a supplier (SP3); refused above what is owed. */
  async pay(supplierId: string, input: NewSupplierPayment): Promise<SupplierStatementDetail> {
    const now = new Date().toISOString();
    const payment: SupplierPayment = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      voidedAt: null,
      supplierId,
      purchaseId: input.purchaseId,
      amountCents: input.amountCents,
      date: input.date,
      method: input.method,
      note: input.note,
    };
    await this.sync.saveDirect('supplier_payment', payment);
    return this.statement(supplierId);
  }

  async voidPayment(id: string, reason: string): Promise<StoredSupplierPayment> {
    return stored(
      await this.sync.voidDirect('supplier_payment', id, reason),
    ) as StoredSupplierPayment;
  }

  /** REST: the same aggregate a device would push (scripts and tools act as a device). */
  async create(aggregate: PurchaseAggregate): Promise<PurchaseDetail> {
    await this.sync.appendDirect('purchase', aggregate.purchase.id, aggregate);
    return this.get(aggregate.purchase.id);
  }

  async list(limit = 100): Promise<StoredPurchase[]> {
    return (await this.purchases.list(limit)).map(stored);
  }

  async get(id: string): Promise<PurchaseDetail> {
    const purchase = await this.purchases.find(id);
    if (!purchase)
      throw new AppHttpException('not_found', `No purchase ${id}`, HttpStatus.NOT_FOUND);
    return {
      purchase: stored(purchase),
      rolls: (await this.inventory.rollsOfPurchase(id)).map(stored),
    };
  }

  private async receive(
    aggregate: PurchaseAggregate,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<Purchase>> {
    const { purchase } = aggregate;
    if (purchase.id !== context.entityId || purchase.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The purchase does not match the op (id or device)');
    }
    const issues = checkPurchaseAggregate(aggregate);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'The rolls do not match the purchase', issues);
    }
    const written = await this.purchases.insert(purchase);
    await this.inventory.receive(aggregate.rolls, aggregate.moves);
    return written;
  }
}
