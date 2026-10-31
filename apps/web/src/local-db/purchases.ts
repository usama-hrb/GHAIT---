import {
  buildPurchaseAggregate,
  checkPurchaseAggregate,
  type NewPurchaseInput,
  newPurchaseSchema,
  type Purchase,
  type Roll,
  rollCode,
  rollCountOf,
} from '@fabric/contracts';
import type { BatchCost } from '@fabric/core';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { DEVICE_CODE } from './session';
import type { LocalStore } from './store';

const ROLL_COUNTER = 'rollCounter';

/** The device has no code yet (it gets one when signing in online): it cannot number rolls. */
export class DeviceNotRegisteredError extends Error {
  override readonly name = 'DeviceNotRegisteredError';
}

export interface PurchaseSummary {
  purchase: Local<Purchase>;
  fabricName: string | null;
  supplierName: string | null;
  rollCount: number;
}

const newest = (a: Local<Purchase>, b: Local<Purchase>) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * Purchases and the rolls they create (SPEC §2.3). A purchase is saved with its rolls and stock
 * moves and one outbox op, in one local transaction; the server re-checks it with the same
 * function (buildPurchaseAggregate → @fabric/core buildRollsFromPurchase).
 */
export class PurchasesRepository {
  constructor(private readonly store: LocalStore) {}

  /** Saves the purchase; throws ValidationError for invalid input. Returns the purchase id. */
  async create(input: NewPurchaseInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newPurchaseSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const count = rollCountOf(parsed);
    const purchaseId = crypto.randomUUID();
    await db.transaction(
      'rw',
      [db.purchases, db.rolls, db.stockMoves, db.outbox, db.meta],
      async () => {
        const codes = await this.codesFrom(count);
        if (!codes)
          throw new DeviceNotRegisteredError('This device has no code yet: sign in online once');
        const aggregate = buildPurchaseAggregate(
          parsed,
          {
            purchaseId,
            rollIds: codes.map(() => crypto.randomUUID()),
            moveIds: codes.map(() => crypto.randomUUID()),
            shortCodes: codes,
          },
          { deviceId, now },
        );
        // The server's own check, here too: a bug shows up before it reaches the outbox.
        const issues = checkPurchaseAggregate(aggregate);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.purchases.put({ ...aggregate.purchase, serverSeq: null });
        await db.rolls.bulkPut(aggregate.rolls.map((roll) => ({ ...roll, serverSeq: null })));
        await db.stockMoves.bulkPut(aggregate.moves.map((move) => ({ ...move, serverSeq: null })));
        const counter = await this.counter();
        await db.meta.put({ key: ROLL_COUNTER, value: counter + count });
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

  /** The codes the next `count` rolls will get (for the confirmation); null without a device code. */
  nextRollCodes(count: number): Promise<string[] | null> {
    return this.codesFrom(count);
  }

  get(id: string): Promise<Local<Purchase> | undefined> {
    return this.store.db.purchases.get(id);
  }

  async rollsOf(purchaseId: string): Promise<Local<Roll>[]> {
    const rolls = await this.store.db.rolls.where('purchaseId').equals(purchaseId).toArray();
    return rolls.sort((a, b) => a.shortCode.localeCompare(b.shortCode));
  }

  /** Newest first, with the fabric and supplier names for the list. */
  async list(): Promise<PurchaseSummary[]> {
    const { db } = this.store;
    const [purchases, rolls, variants, fabrics, suppliers] = await Promise.all([
      db.purchases.toArray(),
      db.rolls.toArray(),
      db.variants.toArray(),
      db.fabrics.toArray(),
      db.suppliers.toArray(),
    ]);
    const fabricOfVariant = new Map(variants.map((variant) => [variant.id, variant.fabricId]));
    const fabricName = new Map(fabrics.map((fabric) => [fabric.id, fabric.name]));
    const supplierName = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    return purchases
      .filter((purchase) => purchase.voidedAt === null)
      .sort(newest)
      .map((purchase) => {
        const own = rolls.filter((roll) => roll.purchaseId === purchase.id);
        const fabricId = own[0] ? fabricOfVariant.get(own[0].variantId) : undefined;
        return {
          purchase,
          fabricName: fabricId ? (fabricName.get(fabricId) ?? null) : null,
          supplierName: purchase.supplierId
            ? (supplierName.get(purchase.supplierId) ?? null)
            : null,
          rollCount: own.length,
        };
      });
  }

  /**
   * The fabric's previous batch: the rolls of its latest purchase (SPEC §8.5 renewal warning).
   * null for a fabric never bought. Kg rolls count with their estimated length until measured.
   */
  async lastBatchOf(fabricId: string): Promise<BatchCost[] | null> {
    const { db } = this.store;
    const variantIds = (await db.variants.where('fabricId').equals(fabricId).toArray()).map(
      (variant) => variant.id,
    );
    if (variantIds.length === 0) return null;
    const rolls = (await db.rolls.where('variantId').anyOf(variantIds).toArray()).filter(
      (roll) => roll.voidedAt === null,
    );
    const purchases = (
      await db.purchases.bulkGet([...new Set(rolls.map((roll) => roll.purchaseId))])
    )
      .filter((purchase): purchase is Local<Purchase> => purchase?.voidedAt === null)
      .sort(newest);
    const latest = purchases[0];
    if (!latest) return null;
    return rolls
      .filter((roll) => roll.purchaseId === latest.id)
      .map((roll) => ({ costTotalCents: roll.costTotalCents, lengthCm: roll.lengthCmInitial }));
  }

  private async counter(): Promise<number> {
    const value = await this.store.getMeta(ROLL_COUNTER);
    return typeof value === 'number' ? value : 0;
  }

  private async codesFrom(count: number): Promise<string[] | null> {
    const code = await this.store.getMeta(DEVICE_CODE);
    if (typeof code !== 'string') return null;
    const counter = await this.counter();
    return Array.from({ length: count }, (_, index) => rollCode(code, counter + index + 1));
  }
}
