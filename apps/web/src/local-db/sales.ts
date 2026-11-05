import {
  batchLedgerOf,
  buildSaleAggregate,
  buildSaleReturn,
  buildSaleVoid,
  checkSaleAggregate,
  checkSaleMinimums,
  checkSaleReturn,
  checkSaleVoid,
  coreBatchOf,
  coreMovesOf,
  type Customer,
  customerAccountOf,
  minimumOverrideIssues,
  type NewSaleInput,
  type NewSaleReturnInput,
  newSaleReturnSchema,
  newSaleSchema,
  type PricedReturn,
  type PricedSale,
  type Product,
  type ProductBatch,
  type ProductStockMove,
  priceSale,
  priceSaleReturn,
  quantityOf,
  returnedCreditCents,
  type Sale,
  type SaleFigures,
  saleFigures,
  type SaleLine,
  type SaleReturn,
  type SaleReturnRecords,
  saleVoidIssues,
  type SaleVoid,
  voidPayloadSchema,
  type WriteOff,
} from '@fabric/contracts';
import {
  type AccountInvoice,
  type ProductStockBatchLedger,
  type ProductStockTake,
  proposeProductStockSale,
  type RollState,
  rollState,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import { batchHistories, ledgersOf } from './stock';
import type { LocalStore } from './store';
import type { SettingsRepository } from './tables';

/** A batch of a product as the POS offers it. */
export interface BatchChoice {
  batch: Local<ProductBatch>;
  ledger: ProductStockBatchLedger;
  /** Remnant or not, by what is left in meters (the owner's threshold). */
  state: RollState;
  /** What is left to sell in meters (cm) and in pieces. */
  remainingCm: number;
  remainingPieces: number;
  purchaseDate: string;
  /** Nothing taken off yet: a ready piece can still be sold whole (P5). */
  untouched: boolean;
}

export interface SaleLineView {
  line: Local<SaleLine>;
  batch: Local<ProductBatch> | undefined;
  product: Local<Product> | undefined;
  figures: SaleFigures['lines'][number] | undefined;
}

export interface SaleView {
  sale: Local<Sale>;
  customer: Local<Customer> | undefined;
  lines: SaleLineView[];
  figures: SaleFigures;
  saleVoid: Local<SaleVoid> | undefined;
  /** Written off as a bad debt (SPEC §4.1). */
  writeOff: Local<WriteOff> | undefined;
  /** The goods given back from it, oldest first (RT1). */
  returns: Local<SaleReturn>[];
}

export interface SaleSummary {
  sale: Local<Sale>;
  customerName: string | null;
  lineCount: number;
  /** The invoice's worth now: its total less what goods given back took off (RT2). */
  netTotalCents: number;
  /** What is applied to it: at most its worth now (RT3). Nothing on a voided sale. */
  paidCents: number;
  /** What is still due: `netTotalCents - paidCents`; 0 on a voided sale. */
  dueCents: number;
  /** Written off as a bad debt: still due on paper, no longer expected (S5). */
  writtenOff: boolean;
  /** Something is due, it is not written off, and its due date has passed. */
  overdue: boolean;
}

const newest = (a: Local<Sale>, b: Local<Sale>) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/** What a return of this sale is priced and checked against, from this device's records. */
async function returnRecordsOf(db: ShopDatabase, sale: Local<Sale>): Promise<SaleReturnRecords> {
  const lines = await db.saleLines.where('saleId').equals(sale.id).toArray();
  const [moves, allocations, returns, writeOffs] = await Promise.all([
    db.productStockMoves
      .where('refId')
      .anyOf(lines.map((line) => line.id))
      .toArray(),
    db.paymentAllocations.where('saleId').equals(sale.id).toArray(),
    db.saleReturns.where('saleId').equals(sale.id).toArray(),
    db.writeOffs.where('saleId').equals(sale.id).toArray(),
  ]);
  const refundIds = returns.flatMap((given) => (given.refundId ? [given.refundId] : []));
  const refunds = (await db.payments.bulkGet(refundIds)).flatMap((payment) =>
    payment ? [payment] : [],
  );
  return {
    sale,
    lines,
    moves: moves.filter((move) => move.type === 'sale'),
    returns,
    allocations,
    refunds,
    writtenOff: writeOffs.some((writeOff) => writeOff.voidedAt === null),
  };
}

/**
 * Sales at the counter (SPEC §3, §4). A sale is saved with its lines, stock moves and the cash
 * paid there, and one outbox op, in one local transaction; the server prices it again with the
 * same functions (buildSaleAggregate → @fabric/core computeSaleLine). A void is its own op.
 */
export class SalesRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly settings: SettingsRepository,
  ) {}

  /** The product's batches that still have something to sell, oldest purchase first (PB1). */
  async batchesOfProduct(productId: string): Promise<BatchChoice[]> {
    const { db } = this.store;
    const batches = await db.productBatches.where('productId').equals(productId).toArray();
    const [histories, threshold] = await Promise.all([
      batchHistories(
        db,
        batches.map((batch) => batch.id),
      ),
      this.settings.get('remnant_threshold_cm', shopToday()),
    ]);
    const choices = batches.flatMap((batch): BatchChoice[] => {
      const history = histories.get(batch.id);
      if (!history || batch.voidedAt !== null) return [];
      let ledger: ProductStockBatchLedger;
      try {
        ledger = batchLedgerOf(batch, history.moves);
      } catch {
        return []; // A history the ledger cannot read is never offered for sale.
      }
      // A weight still waiting for its length reads 0 meters: nothing to sell by the meter yet.
      const remainingCm = ledger.measurementStatus === 'pending' ? 0 : meters(ledger);
      const remainingPieces = pieces(ledger);
      if (remainingCm <= 0 && remainingPieces <= 0) return [];
      return [
        {
          batch,
          ledger,
          state: rollState(remainingCm, batch.status === 'remnant', threshold),
          remainingCm,
          remainingPieces,
          purchaseDate: batch.purchaseDate,
          untouched:
            history.moves.every((move) => move.type === 'purchase') &&
            ledger.lengthBasisCm !== null &&
            remainingCm === ledger.lengthBasisCm,
        },
      ];
    });
    return choices.sort(
      (a, b) =>
        a.purchaseDate.localeCompare(b.purchaseDate) ||
        a.batch.createdAt.localeCompare(b.batch.createdAt) ||
        a.batch.id.localeCompare(b.batch.id),
    );
  }

  /**
   * Which batches a quantity of this product takes (SPEC §4, PB1: the oldest purchase first).
   * `taken` is what the cart already holds, by batch, in `unit`. `shortfall` is what no batch has.
   */
  async propose(
    productId: string,
    unit: 'meter' | 'piece',
    wanted: number,
    taken: ReadonlyMap<string, number> = new Map(),
  ): Promise<{ takes: { take: ProductStockTake; choice: BatchChoice }[]; shortfall: number }> {
    const choices = await this.batchesOfProduct(productId);
    const histories = await batchHistories(
      this.store.db,
      choices.map((choice) => choice.batch.id),
    );
    // The lines already in the cart come after everything on the shelf. The bill holds batches of
    // other products too (and of this one's that have since run out): only what it holds of the
    // batches read here can come off them, so the rest is left out. Handing the core a move on a
    // batch it was not given is an error, and it must stay one.
    const offered = new Set(choices.map((choice) => choice.batch.id));
    const cartMoves = coreMovesOf(
      [...taken]
        .filter(([batchId]) => offered.has(batchId))
        .map(([batchId, quantity]) => cartSale(batchId, unit, quantity)),
    );
    const product = await this.store.db.products.get(productId);
    const proposal = proposeProductStockSale(
      choices.map((choice) => coreBatchOf(choice.batch)),
      [
        ...choices.flatMap((choice) => coreMovesOf(histories.get(choice.batch.id)?.moves ?? [])),
        ...cartMoves,
      ],
      quantityOf(unit, wanted),
      product?.sellingUnits ?? [unit],
    );
    const byId = new Map(choices.map((choice) => [choice.batch.id, choice]));
    return {
      takes: proposal.takes.flatMap((take) => {
        const choice = byId.get(take.batchId);
        return choice ? [{ take, choice }] : [];
      }),
      shortfall:
        proposal.shortfall.unit === 'meter'
          ? proposal.shortfall.centimeters
          : proposal.shortfall.unit === 'piece'
            ? proposal.shortfall.pieces
            : 0,
    };
  }

  /** The sale priced on the batches as they are on this device (live POS figures and warnings). */
  async preview(input: NewSaleInput): Promise<PricedSale> {
    const parsed = parseOrThrow(newSaleSchema, input);
    const histories = await batchHistories(
      this.store.db,
      parsed.lines.map((line) => line.batchId),
    );
    return priceSale(parsed, histories);
  }

  /**
   * Saves the sale; throws ValidationError when it is invalid, unconfirmed under cost, under a
   * product's minimum price without the owner's override, or an override not made by the owner.
   */
  async create(input: NewSaleInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newSaleSchema, input);
    await this.store.assertPeriodOpen([parsed.date]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const saleId = crypto.randomUUID();
    await db.transaction(
      'rw',
      [
        db.products,
        db.productBatches,
        db.productStockMoves,
        db.lockedCosts,
        db.sales,
        db.saleLines,
        db.payments,
        db.paymentAllocations,
        db.outbox,
      ],
      async () => {
        const histories = await batchHistories(
          db,
          parsed.lines.map((line) => line.batchId),
        );
        const built = buildSaleAggregate(
          parsed,
          histories,
          {
            saleId,
            lineIds: parsed.lines.map(() => crypto.randomUUID()),
            moveIds: parsed.lines.map(() => crypto.randomUUID()),
            paymentId: crypto.randomUUID(),
            allocationId: crypto.randomUUID(),
          },
          { deviceId, now },
        );
        if (!built.ok) throw new ValidationError(built.issues);
        const { aggregate } = built;
        // The server's own checks, here too: a bug shows up before it reaches the outbox.
        const products = new Map(
          (
            await db.products.bulkGet([...histories.values()].map((h) => h.batch.productId))
          ).flatMap((product) => (product ? [[product.id, product] as const] : [])),
        );
        const role = this.store.currentRole();
        const issues = [
          ...checkSaleAggregate(aggregate, histories),
          ...(role === null
            ? []
            : minimumOverrideIssues(aggregate.lines, {
                role,
                username: this.store.username() ?? '',
              })),
          ...checkSaleMinimums(aggregate.lines, (batchId) => {
            const product = products.get(histories.get(batchId)?.batch.productId ?? '');
            return product
              ? {
                  meter: product.minPricePerMeterCents ?? 0,
                  piece: product.minPricePerPieceCents ?? 0,
                }
              : undefined;
          }),
        ];
        if (issues.length > 0) throw new ValidationError(issues);
        await db.sales.put({ ...aggregate.sale, serverSeq: null });
        await db.saleLines.bulkPut(aggregate.lines.map((line) => ({ ...line, serverSeq: null })));
        await db.productStockMoves.bulkPut(
          aggregate.moves.map((move) => ({ ...move, serverSeq: null })),
        );
        if (aggregate.payment) await db.payments.put({ ...aggregate.payment, serverSeq: null });
        if (aggregate.allocation) {
          await db.paymentAllocations.put({ ...aggregate.allocation, serverSeq: null });
        }
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'sale',
          entityId: saleId,
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
    return saleId;
  }

  /**
   * Cancels a sale (P13): its goods go back on their batches (a reversal per line) and what was
   * paid on it is refunded. The reason is required and goes to the audit log.
   */
  async voidSale(saleId: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const payload = parseOrThrow(voidPayloadSchema, { reason });
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction(
      'rw',
      [
        db.sales,
        db.saleLines,
        db.productStockMoves,
        db.payments,
        db.paymentAllocations,
        db.saleVoids,
        db.saleReturns,
        db.settlements,
        db.outbox,
      ],
      async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error(`No sale ${saleId}`);
        if (sale.voidedAt !== null) return;
        // A sale of a settled period stays as it is (BUILD_PROMPTS 4.3).
        await this.store.assertPeriodOpen([sale.date, shopToday(this.store.now())]);
        const lineIds = (await db.saleLines.where('saleId').equals(saleId).toArray()).map(
          (line) => line.id,
        );
        const moves = (await db.productStockMoves.where('refId').anyOf(lineIds).toArray()).filter(
          (move) => move.type === 'sale',
        );
        const records = {
          sale,
          moves,
          allocations: await db.paymentAllocations.where('saleId').equals(saleId).toArray(),
          returns: await db.saleReturns.where('saleId').equals(saleId).toArray(),
        };
        // Goods came back from it: the rest is returned instead (RT7).
        const refused = saleVoidIssues(records);
        if (refused.length > 0) throw new ValidationError(refused);
        const aggregate = buildSaleVoid(
          { reason: payload.reason, date: shopToday(this.store.now()) },
          records,
          {
            voidId: crypto.randomUUID(),
            reversalIds: moves.map(() => crypto.randomUUID()),
            refundId: crypto.randomUUID(),
          },
          { deviceId, now },
        );
        const issues = checkSaleVoid(aggregate, records);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.saleVoids.put({ ...aggregate.saleVoid, serverSeq: null });
        await db.productStockMoves.bulkPut(
          aggregate.reversals.map((move) => ({ ...move, serverSeq: null })),
        );
        if (aggregate.refund) await db.payments.put({ ...aggregate.refund, serverSeq: null });
        await db.sales.put({ ...sale, voidedAt: now, updatedAt: now, deviceId });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'sale_void',
          entityId: aggregate.saleVoid.id,
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

  /**
   * The return as it would be saved (RT1–RT3): the credit, the invoice's worth after it and the
   * most that can be handed back in cash. Issues come back as data for the form to show.
   */
  async previewReturn(input: NewSaleReturnInput): Promise<PricedReturn | undefined> {
    const parsed = parseOrThrow(newSaleReturnSchema, input);
    const sale = await this.store.db.sales.get(parsed.saleId);
    if (!sale) return undefined;
    return priceSaleReturn(parsed, await returnRecordsOf(this.store.db, sale));
  }

  /**
   * Records goods a customer gave back (RT1): a `return` stock move per line puts the goods on
   * their batch, the credit lowers the invoice, and cash handed back is a refund payment, with one
   * outbox op. The server prices it again (checkSaleReturn). Returns the return's id.
   */
  async giveBack(input: NewSaleReturnInput): Promise<string> {
    this.store.assertWritable();
    const parsed = parseOrThrow(newSaleReturnSchema, input);
    // A return belongs to the day it is made, never to a settled one (RT4).
    await this.store.assertPeriodOpen([parsed.date]);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const returnId = crypto.randomUUID();
    await db.transaction(
      'rw',
      [
        db.sales,
        db.saleLines,
        db.productStockMoves,
        db.payments,
        db.paymentAllocations,
        db.saleReturns,
        db.writeOffs,
        db.settlements,
        db.outbox,
      ],
      async () => {
        const sale = await db.sales.get(parsed.saleId);
        if (!sale) throw new Error(`No sale ${parsed.saleId}`);
        const records = await returnRecordsOf(db, sale);
        const built = buildSaleReturn(
          parsed,
          records,
          {
            returnId,
            moveIds: parsed.lines.map(() => crypto.randomUUID()),
            refundId: parsed.refundCents > 0 ? crypto.randomUUID() : null,
          },
          { deviceId, now },
        );
        if (!built.ok) throw new ValidationError(built.issues);
        const { aggregate } = built;
        const issues = checkSaleReturn(aggregate, records);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.saleReturns.put({ ...aggregate.saleReturn, serverSeq: null });
        await db.productStockMoves.bulkPut(
          aggregate.moves.map((move) => ({ ...move, serverSeq: null })),
        );
        if (aggregate.refund) await db.payments.put({ ...aggregate.refund, serverSeq: null });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'sale_return',
          entityId: returnId,
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
    return returnId;
  }

  async get(id: string): Promise<SaleView | undefined> {
    const { db } = this.store;
    const sale = await db.sales.get(id);
    if (!sale) return undefined;
    // Entry order once synced (the server numbers them in order); by id until then.
    const unsynced = Number.MAX_SAFE_INTEGER;
    const lines = (await db.saleLines.where('saleId').equals(id).toArray()).sort(
      (a, b) => (a.serverSeq ?? unsynced) - (b.serverSeq ?? unsynced) || a.id.localeCompare(b.id),
    );
    const batchIds = lines.map((line) => line.batchId);
    const [histories, allocations, saleVoid, customer, moves, writeOff, returns] =
      await Promise.all([
        batchHistories(db, batchIds),
        db.paymentAllocations.where('saleId').equals(id).toArray(),
        db.saleVoids.where('saleId').equals(id).first(),
        sale.customerId ? db.customers.get(sale.customerId) : undefined,
        db.productStockMoves
          .where('refId')
          .anyOf(lines.map((line) => line.id))
          .toArray(),
        db.writeOffs.where('saleId').equals(id).first(),
        db.saleReturns.where('saleId').equals(id).toArray(),
      ]);
    const figures = saleFigures(
      sale,
      lines,
      moves.filter((move) => move.type === 'sale'),
      ledgersOf(histories),
      allocations,
      returns,
    );
    const products = await db.products.bulkGet(
      lines.map((line) => histories.get(line.batchId)?.batch.productId ?? ''),
    );
    return {
      sale,
      customer,
      lines: lines.map((line, index) => ({
        line,
        batch: histories.get(line.batchId)?.batch as Local<ProductBatch> | undefined,
        product: products[index],
        figures: figures.lines.find((entry) => entry.lineId === line.id),
      })),
      figures,
      saleVoid,
      writeOff,
      returns: returns.sort(
        (a, b) => (a.serverSeq ?? unsynced) - (b.serverSeq ?? unsynced) || a.id.localeCompare(b.id),
      ),
    };
  }

  /** What goods given back on this day credited (RT4): it lowers that day's sales. */
  async returnedOn(date: string): Promise<number> {
    const returns = await this.store.db.saleReturns
      .filter((given) => given.date === date)
      .toArray();
    return returnedCreditCents(returns);
  }

  /**
   * Newest first, with the customer's name and each invoice's figures. They come from the
   * customer's account (`customerAccountOf`, the function the customer screens call), so what is
   * paid, due, overdue or written off here is what the account says. A walk-in customer's sales
   * are one more group: they have no account, but their payments are applied the same way.
   */
  async list(): Promise<SaleSummary[]> {
    const { db } = this.store;
    const today = shopToday(this.store.now());
    const [sales, lines, payments, allocations, customers, returns, writeOffs] = await Promise.all([
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.payments.toArray(),
      db.paymentAllocations.toArray(),
      db.customers.toArray(),
      db.saleReturns.toArray(),
      db.writeOffs.toArray(),
    ]);
    const customerName = new Map(customers.map((customer) => [customer.id, customer.name]));
    const linesOf = new Map<string, number>();
    for (const line of lines) linesOf.set(line.saleId, (linesOf.get(line.saleId) ?? 0) + 1);
    const returnsOf = groupBy(returns, (given) => given.saleId);
    const writeOffsOf = groupBy(writeOffs, (writeOff) => writeOff.saleId);
    const salesOf = groupBy(sales, (sale) => sale.customerId);
    const paymentsOf = groupBy(payments, (payment) => payment.customerId);
    const allocationsOf = groupBy(allocations, (allocation) => allocation.paymentId);

    const invoices = new Map<string, AccountInvoice>();
    for (const [customerId, own] of salesOf) {
      const paid = paymentsOf.get(customerId) ?? [];
      const account = customerAccountOf(
        {
          sales: own,
          payments: paid,
          allocations: paid.flatMap((payment) => allocationsOf.get(payment.id) ?? []),
          writeOffs: own.flatMap((sale) => writeOffsOf.get(sale.id) ?? []),
          returns: own.flatMap((sale) => returnsOf.get(sale.id) ?? []),
        },
        today,
      );
      for (const invoice of account.invoices) invoices.set(invoice.saleId, invoice);
    }

    return sales.sort(newest).map((sale) => {
      const invoice = invoices.get(sale.id);
      // A voided sale is out of the account: nothing paid, nothing due, whatever it was worth.
      const netTotalCents =
        invoice?.totalCents ?? sale.totalCents - returnedCreditCents(returnsOf.get(sale.id) ?? []);
      return {
        sale,
        customerName: sale.customerId ? (customerName.get(sale.customerId) ?? null) : null,
        lineCount: linesOf.get(sale.id) ?? 0,
        netTotalCents,
        paidCents: invoice?.paidCents ?? 0,
        dueCents: invoice?.dueCents ?? 0,
        writtenOff: invoice?.writtenOff ?? false,
        overdue: invoice?.overdue ?? false,
      };
    });
  }
}

/** The items by a key, each group in the order the items came. */
function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const meters = (ledger: ProductStockBatchLedger): number => {
  const quantity = ledger.available.meter;
  return quantity?.unit === 'meter' ? quantity.centimeters : 0;
};
const pieces = (ledger: ProductStockBatchLedger): number => {
  const quantity = ledger.available.piece;
  return quantity?.unit === 'piece' ? quantity.pieces : 0;
};

/**
 * What the cart already holds of a batch, as a sale move on it (after everything real). The batch
 * is the move's identity: the bill holds a batch once however many lines take from it.
 */
function cartSale(
  batchId: string,
  unit: 'meter' | 'piece',
  quantity: number,
): ProductStockMove & { serverSeq: null } {
  const createdAt = '9999-12-31T23:59:59.999Z';
  return {
    id: `cart-${batchId}`,
    createdAt,
    updatedAt: createdAt,
    deviceId: 'cart',
    voidedAt: null,
    batchId,
    type: 'sale',
    unit,
    delta: -quantity,
    refId: null,
    date: '9999-12-31',
    note: null,
    actor: null,
    serverSeq: null,
  };
}
