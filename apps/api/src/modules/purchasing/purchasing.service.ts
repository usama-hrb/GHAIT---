import {
  checkPurchaseAggregate,
  type Purchase,
  type PurchaseAggregate,
  type PurchaseDetail,
  type StoredPurchase,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException } from '../../common/index.js';
import { InventoryService } from '../inventory/index.js';
import {
  type SyncedRow,
  type SyncHandler,
  SyncRegistry,
  SyncRejection,
  SyncService,
} from '../sync/index.js';
import { PurchaseRepository } from './purchase.repository.js';

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
