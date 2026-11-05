import {
  checkProductRemoval,
  coreBatchOf,
  coreMovesOf,
  nextFabricEstimate,
  type NewProductPurchaseInput,
  PRODUCT_REMOVAL_ISSUES,
  type Product,
  type ProductConversion,
  type ProductInput,
  type ProductUnit,
  type ProductBatch,
  type ProductSellingUnit,
  type ValidationIssue,
} from '@fabric/contracts';
import {
  type ProductStockBatch,
  type ProductStockBatchLedger,
  type ProductStockMovement,
  type ProductStockQuantity,
  measuredCmPerKg,
  productStockBatchLedger,
  productStockLedger,
  productStockValue,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import { matchesSearch } from '@/shared/lib/search';
import type { Local } from './db';
import { ValidationError } from './errors';
import { withFrozenCosts } from './ledgers';
import type { PurchasesRepository } from './purchases';
import type { LocalStore } from './store';
import type { StockRepository } from './stock';
import type { ProductsRepository, SettingsRepository } from './tables';

/**
 * Where a product stands: in stock, running low, out of stock, or only waiting for a length
 * (weight received and not measured: it exists, it just cannot be sold by the meter yet).
 */
export type StockStatus = 'in_stock' | 'low' | 'out' | 'awaiting';

export const STOCK_FILTERS = ['all', 'in_stock', 'low', 'out', 'awaiting'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

/** What the screens show of one purchase batch of a product. */
export interface ProductBatchView {
  /** The batch's id, and the code written on it. */
  batchId: string;
  code: string;
  /** Marked a remnant by hand (a short end the shop sells off). */
  remnant: boolean;
  /** The unit it was received in. */
  unit: ProductBatch['unit'];
  purchaseId: string;
  purchaseDate: string;
  /** What the batch holds, from the product ledger: metres (cm) and pieces. */
  remainingCm: number;
  remainingPieces: number;
  /** Weight bought, for a batch bought by the kilo. */
  receivedG: number | null;
  /** Pieces or meters (cm) it was received as, for the history of the purchase. */
  receivedQuantity: number;
  /** What a weight of it makes in meters, when known (kg batches). */
  conversion: ProductBatch['conversion'];
  /** pending: the weight is known and the length is not; estimated: a guess; measured: real. */
  status: ProductStockBatchLedger['measurementStatus'];
  /** Weight still waiting for its length (pending batches only). */
  awaitingG: number;
  /** What the batch cost when bought. Only for those who may see costs. */
  costTotalCents: number;
  /** Cost per metre; null while no length is known. Only for those who may see costs. */
  costPerMeterCents: number | null;
  /** Cost per piece, for a batch counted in pieces. Only for those who may see costs. */
  costPerPieceCents: number | null;
  /** The cost still on the batch: what is left of it, at what it cost. Only for those who may see costs. */
  remainingCostCents: number;
  /** More was taken from it than it held. */
  oversold: boolean;
}

export interface ProductIdentity {
  id: string;
  name: string;
  /** The product's code. */
  sku: string | null;
  tags: string[];
  sellingUnits: ProductSellingUnit[];
  /**
   * Running low at or under this much: cm when the product is sold by the meter, pieces when it
   * is sold only by the piece; null: never low.
   */
  lowStockThreshold: number | null;
  /** What `lowStockThreshold` counts. */
  lowStockUnit: ProductSellingUnit;
  /** What it sells for per unit, and the lowest price it may go at (null: not sold in that unit). */
  pricePerMeterCents: number | null;
  minPricePerMeterCents: number | null;
  pricePerPieceCents: number | null;
  minPricePerPieceCents: number | null;
  /** The code written on the product and its description, as the form has them. */
  description: string | null;
}

export interface ProductStockView extends ProductIdentity {
  /** Everything the product ledger says can be sold, in metres (cm) and in pieces. */
  availableCm: number;
  availablePieces: number;
  /** Weight received and not yet measured: no length, so nothing to sell by the metre. */
  awaitingMeasurementG: number;
  status: StockStatus;
  /** Oversold, or a batch whose history the product ledger refused to read. */
  needsReview: boolean;
  /**
   * What the stock still held costs (PB18): the cost left on its batches, weight awaiting a
   * length included. Only for those who may see costs.
   */
  stockValueCents: number;
  /** Weighted average cost per metre of the stock held in metres; null when none is held. */
  averageCostPerMeterCents: number | null;
  /** Weighted average cost per piece of the stock held in pieces; null when none is held. */
  averageCostPerPieceCents: number | null;
  /** How many batches still hold stock (or wait for a length). */
  batchCount: number;
  /** Batches with stock first, oldest purchase first (the order a sale takes them). */
  batches: ProductBatchView[];
  /** Batches the product ledger could not read: shown, never added to the stock. */
  unreadable: { batchId: string; code: string }[];
}

/** One movement of one batch, newest first in a product's history. */
export interface ProductMovementView {
  id: string;
  batchId: string;
  code: string;
  type: ProductStockMovement['type'];
  date: string;
  createdAt: string;
  unit: ProductStockQuantity['unit'];
  /** Signed change in that unit (cm, g, pieces); a measurement carries the measured length. */
  amount: number;
  /** What a purchase cost, what a sale or loss carried, or a return gave back; null for the rest. */
  costCents: number | null;
  /** The purchase that brought the goods, or the sale that took them (or took them back). */
  reference: MovementReference | null;
  /** What the person wrote: the reason of a loss or a count, the note of a measurement. */
  note: string | null;
}

/** What a movement came from, as far as a screen can open it. */
export interface MovementReference {
  kind: 'purchase' | 'sale';
  id: string;
}

export interface ProductDetailView {
  stock: ProductStockView;
  /** The Product record. */
  record: Local<Product>;
  movements: ProductMovementView[];
  /** The supplier's name of each purchase that has one, by purchase id (none on a till's device). */
  supplierOfPurchase: Record<string, string>;
}

/** A batch with its movements, as the product ledger reads them. */
export interface ProductBatchSource {
  batchId: string;
  code: string;
  purchaseId: string;
  remnant: boolean;
  unit: ProductBatch['unit'];
  receivedQuantity: number;
  conversion: ProductBatch['conversion'];
  /** null: the batch's moves could not even be mapped. */
  history: { batch: ProductStockBatch; movements: ProductStockMovement[] } | null;
  /** What each move was caused by (the sale line…) and what was written on it, by move id. */
  origins?: ReadonlyMap<string, MoveOrigin>;
}

/** The part of a stored move the ledger does not need but a history screen does. */
export interface MoveOrigin {
  refId: string | null;
  note: string | null;
}

const centimeters = (quantity: ProductStockQuantity | null | undefined): number =>
  quantity?.unit === 'meter' ? quantity.centimeters : 0;
const grams = (quantity: ProductStockQuantity | null | undefined): number =>
  quantity?.unit === 'kg' ? quantity.grams : 0;
const pieces = (quantity: ProductStockQuantity | null | undefined): number =>
  quantity?.unit === 'piece' ? quantity.pieces : 0;

function amountOf(quantity: ProductStockQuantity): number {
  switch (quantity.unit) {
    case 'kg':
      return quantity.grams;
    case 'meter':
      return quantity.centimeters;
    case 'piece':
      return quantity.pieces;
  }
}

/**
 * The status of a product from what the ledger says it holds. Weight with no length never makes
 * a product "out of stock": nothing can be sold by the meter yet, but the cloth is there.
 */
export function stockStatusOf(
  stock: { availableCm: number; availablePieces: number; awaitingMeasurementG: number },
  lowStock: { threshold: number | null; unit: ProductSellingUnit },
): StockStatus {
  if (stock.availableCm <= 0 && stock.availablePieces <= 0) {
    return stock.awaitingMeasurementG > 0 ? 'awaiting' : 'out';
  }
  if (lowStock.threshold !== null) {
    const left = lowStock.unit === 'piece' ? stock.availablePieces : stock.availableCm;
    const sellsOther = lowStock.unit === 'piece' ? stock.availableCm : stock.availablePieces;
    if (sellsOther <= 0 && left <= lowStock.threshold) return 'low';
  }
  return 'in_stock';
}

/**
 * The filters of the stock screen. "In stock" is whatever can be sold (low included);
 * "awaiting" is any product with weight waiting for a length, even one that also has stock.
 */
export function matchesStockFilter(
  view: Pick<ProductStockView, 'status' | 'awaitingMeasurementG'>,
  filter: StockFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'in_stock':
      return view.status === 'in_stock' || view.status === 'low';
    case 'low':
    case 'out':
      return view.status === filter;
    case 'awaiting':
      return view.awaitingMeasurementG > 0;
  }
}

export interface InventorySummary {
  products: number;
  /** Σ of what products can be sold, in cm and in pieces (a short product counts as nothing). */
  availableCm: number;
  availablePieces: number;
  /** Σ of the products' stock value at cost (PB18). Only for those who may see costs. */
  stockValueCents: number;
  /** Products with weight waiting for a length. */
  awaiting: number;
  low: number;
  out: number;
}

export function summarizeInventory(views: readonly ProductStockView[]): InventorySummary {
  const summary: InventorySummary = {
    products: views.length,
    availableCm: 0,
    availablePieces: 0,
    stockValueCents: 0,
    awaiting: 0,
    low: 0,
    out: 0,
  };
  for (const view of views) {
    summary.availableCm += Math.max(0, view.availableCm);
    summary.availablePieces += Math.max(0, view.availablePieces);
    summary.stockValueCents += view.stockValueCents;
    if (view.awaitingMeasurementG > 0) summary.awaiting += 1;
    if (view.status === 'low') summary.low += 1;
    if (view.status === 'out') summary.out += 1;
  }
  return summary;
}

/** 0: the batch still holds something (or waits for a length); 1: it is spent. */
function heldRank(view: ProductBatchView): 0 | 1 {
  return view.remainingCm > 0 || view.remainingPieces > 0 || view.awaitingG > 0 || view.oversold
    ? 0
    : 1;
}

/**
 * One product's stock from its batches, every figure from @fabric/core. A batch whose history the
 * ledger refuses (a corrupt or half-synced one) is left out of the totals and listed, so one
 * bad batch never hides the others or breaks the screen.
 */
export function summarizeProductStock(
  identity: ProductIdentity,
  sources: readonly ProductBatchSource[],
): ProductStockView {
  const readable: {
    source: ProductBatchSource;
    batch: ProductStockBatch;
    movements: ProductStockMovement[];
    ledger: ProductStockBatchLedger;
  }[] = [];
  const unreadable: ProductStockView['unreadable'] = [];
  for (const source of sources) {
    try {
      if (!source.history) throw new RangeError('the batch could not be mapped');
      const { batch, movements } = source.history;
      readable.push({
        source,
        batch,
        movements,
        ledger: productStockBatchLedger(batch, movements),
      });
    } catch {
      unreadable.push({ batchId: source.batchId, code: source.code });
    }
  }
  const ledger = productStockLedger(
    readable.map(({ batch }) => batch),
    readable.flatMap(({ movements }) => movements),
  );
  const oversold = new Set(ledger.oversold.map((entry) => entry.batchId));
  const batches = readable
    .map(({ source, batch, ledger: entry }): ProductBatchView => {
      const costPerMeter = entry.costPerUnitCents.meter;
      return {
        batchId: source.batchId,
        code: source.code,
        remnant: source.remnant,
        unit: source.unit,
        purchaseId: source.purchaseId,
        purchaseDate: batch.purchaseDate,
        remainingCm: centimeters(entry.available.meter),
        remainingPieces: pieces(entry.available.piece),
        receivedG: grams(batch.received) || null,
        receivedQuantity: source.receivedQuantity,
        conversion: source.conversion,
        status: entry.measurementStatus,
        awaitingG: grams(entry.awaitingMeasurement),
        costTotalCents: batch.costTotalCents,
        costPerMeterCents: costPerMeter === undefined ? null : costPerMeter,
        costPerPieceCents: entry.costPerUnitCents.piece ?? null,
        remainingCostCents: entry.unallocatedCostCents,
        oversold: oversold.has(batch.id),
      };
    })
    .sort(
      (a, b) =>
        heldRank(a) - heldRank(b) ||
        a.purchaseDate.localeCompare(b.purchaseDate) ||
        a.code.localeCompare(b.code),
    );
  const value = productStockValue(ledger.batches);
  const stock = {
    availableCm: centimeters(ledger.available.meter),
    availablePieces: pieces(ledger.available.piece),
    awaitingMeasurementG: grams(ledger.awaitingMeasurementTotal),
  };
  return {
    ...identity,
    ...stock,
    status: stockStatusOf(stock, {
      threshold: identity.lowStockThreshold,
      unit: identity.lowStockUnit,
    }),
    needsReview: oversold.size > 0 || unreadable.length > 0,
    stockValueCents: value.valueCents,
    averageCostPerMeterCents: value.averageCostPerMeterCents,
    averageCostPerPieceCents: value.averageCostPerPieceCents,
    batchCount: batches.filter((batch) => heldRank(batch) === 0).length,
    batches,
    unreadable,
  };
}

/** The sale line a movement belongs to: a return and a void point at the sale move they undo. */
function saleLineOf(
  movement: ProductStockMovement,
  origins: ReadonlyMap<string, MoveOrigin>,
): string | null {
  switch (movement.type) {
    case 'sale':
      return origins.get(movement.id)?.refId ?? null;
    case 'return':
      return origins.get(movement.returnsMoveId)?.refId ?? null;
    case 'reversal':
      return origins.get(movement.reversesMoveId)?.refId ?? null;
    default:
      return null;
  }
}

const originsOf = (sources: readonly ProductBatchSource[]): Map<string, MoveOrigin> =>
  new Map(sources.flatMap((source) => [...(source.origins ?? [])]));

/** The sale lines the product's movements point at: look them up to know which sale each is. */
export function saleLineIdsOfMovements(sources: readonly ProductBatchSource[]): string[] {
  const origins = originsOf(sources);
  const ids = new Set<string>();
  for (const source of sources) {
    for (const movement of source.history?.movements ?? []) {
      const lineId = saleLineOf(movement, origins);
      if (lineId !== null) ids.add(lineId);
    }
  }
  return [...ids];
}

/**
 * Every movement of a product's readable batches, newest first, with the cost it carried and what
 * it came from. `saleOfLine` says which sale a sale line belongs to (the caller reads it).
 */
export function productMovements(
  sources: readonly ProductBatchSource[],
  saleOfLine: ReadonlyMap<string, string> = new Map(),
): ProductMovementView[] {
  const origins = originsOf(sources);
  const views: ProductMovementView[] = [];
  for (const source of sources) {
    if (!source.history) continue;
    let ledger: ProductStockBatchLedger;
    try {
      ledger = productStockBatchLedger(source.history.batch, source.history.movements);
    } catch {
      continue;
    }
    const costs = new Map(ledger.costs.map((entry) => [entry.moveId, entry.costCents]));
    const returned = new Map(ledger.returns.map((entry) => [entry.moveId, entry.costCents]));
    for (const movement of source.history.movements) {
      const measured = movement.type === 'measurement';
      const lineId = saleLineOf(movement, origins);
      const saleId = lineId === null ? undefined : saleOfLine.get(lineId);
      views.push({
        id: movement.id,
        batchId: source.batchId,
        code: source.code,
        type: movement.type,
        date: movement.date,
        createdAt: movement.createdAt,
        unit: measured ? 'meter' : movement.delta.unit,
        amount: measured ? movement.measuredLengthCm : amountOf(movement.delta),
        costCents:
          movement.type === 'purchase'
            ? source.history.batch.costTotalCents
            : movement.type === 'sale' || movement.type === 'loss'
              ? (costs.get(movement.id) ?? null)
              : movement.type === 'return'
                ? (returned.get(movement.id) ?? null)
                : null,
        reference:
          movement.type === 'purchase'
            ? { kind: 'purchase', id: source.purchaseId }
            : saleId === undefined
              ? null
              : { kind: 'sale', id: saleId },
        note: origins.get(movement.id)?.note ?? null,
      });
    }
  }
  return views.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export interface ProductInventoryQuery {
  /** Product name, code, tags or description. */
  search?: string;
  filter?: StockFilter;
}

export interface ProductInventoryOverview {
  /** The products that match the search and the filter, by name. */
  products: ProductStockView[];
  /** Over every product, whatever the search and the filter. */
  summary: InventorySummary;
}

/** Map.groupBy (ES2024; the project targets ES2023). */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/**
 * Stock by product (ADR 0012): a product's batches and their moves, every figure derived by the
 * product ledger of @fabric/core. Nothing here stores a number; the stock actions are
 * StockRepository's and PurchasesRepository's.
 */
/** Stock bought for a product: what the purchase form collects once the product is known. */
export interface StockPurchase {
  unit: ProductUnit;
  /** In g, cm or pieces, by `unit`. */
  quantity: number;
  totalCostCents: number;
  /** What a weight makes in meters, when known; null: the length waits for a measurement. */
  conversion?: ProductConversion;
  supplierId?: string | null;
  /** Paid now; omitted: all of it. */
  paidCents?: number | null;
  /** The purchase's day (YYYY-MM-DD); omitted: today. */
  date?: string;
  notes?: string | null;
}

/** What removing a product would do (PB20), for the dialog that asks the owner. */
export interface ProductRemovalView {
  /** Stock is left on a batch (or cannot be read): the product cannot be removed yet. */
  holdsStock: boolean;
  /** The purchases (batches) the product has: they and everything after them stay in the books. */
  batches: number;
}

export class ProductInventoryRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly products: ProductsRepository,
    private readonly purchases: PurchasesRepository,
    private readonly stock: StockRepository,
    private readonly settings: SettingsRepository,
  ) {}

  private purchaseOf(productId: string, stock: StockPurchase): NewProductPurchaseInput {
    return {
      date: stock.date ?? shopToday(this.store.now()),
      productId,
      unit: stock.unit,
      quantity: stock.quantity,
      totalCostCents: stock.totalCostCents,
      conversion: stock.unit === 'kg' ? (stock.conversion ?? null) : null,
      supplierId: stock.supplierId ?? null,
      paidCents: stock.paidCents ?? null,
      notes: stock.notes ?? null,
    };
  }

  /**
   * Creates a product, and with its first stock when there is some: the product and its batch are
   * saved together or not at all, offline (ADR 0012). The product is made buyable in the unit
   * the stock was bought in. Returns the product's id and the purchase's (null: no stock).
   */
  async addProduct(
    product: ProductInput,
    stock: StockPurchase | null = null,
  ): Promise<{ productId: string; purchaseId: string | null }> {
    this.store.assertWritable();
    const { db } = this.store;
    const productId = crypto.randomUUID();
    let purchaseId: string | null = null;
    await db.transaction(
      'rw',
      [
        db.products,
        db.purchases,
        db.productBatches,
        db.productStockMoves,
        db.outbox,
        db.meta,
        db.settlements,
      ],
      async () => {
        const units = new Set(product.purchaseUnits);
        if (stock) units.add(stock.unit);
        await this.products.save({ ...product, purchaseUnits: [...units] }, productId);
        if (stock) purchaseId = await this.purchases.create(this.purchaseOf(productId, stock));
      },
    );
    return { productId, purchaseId };
  }

  /**
   * A new purchase of an existing product: a batch of its own, never merged into another. Buying
   * the product in a unit it was not bought in before makes it buyable in that unit too.
   */
  async restock(productId: string, stock: StockPurchase): Promise<string> {
    this.store.assertWritable();
    const { db } = this.store;
    let purchaseId = '';
    await db.transaction(
      'rw',
      [
        db.products,
        db.purchases,
        db.productBatches,
        db.productStockMoves,
        db.outbox,
        db.meta,
        db.settlements,
      ],
      async () => {
        const product = await db.products.get(productId);
        if (product && product.voidedAt === null && !product.purchaseUnits.includes(stock.unit)) {
          const fields: ProductInput = {
            name: product.name,
            sku: product.sku,
            description: product.description,
            tags: product.tags,
            sellingUnits: product.sellingUnits,
            kgToMeterConversion: product.kgToMeterConversion,
            pricePerMeterCents: product.pricePerMeterCents,
            minPricePerMeterCents: product.minPricePerMeterCents,
            pricePerPieceCents: product.pricePerPieceCents,
            minPricePerPieceCents: product.minPricePerPieceCents,
            lowStockThreshold: product.lowStockThreshold,
            active: product.active,
            purchaseUnits: product.purchaseUnits,
          };
          await this.products.save(
            { ...fields, purchaseUnits: [...product.purchaseUnits, stock.unit] },
            productId,
          );
        }
        purchaseId = await this.purchases.create(this.purchaseOf(productId, stock));
      },
    );
    return purchaseId;
  }

  /**
   * The batch's whole length, measured (this is what makes a weight sellable by the meter). A
   * weight batch's measurement also moves the product's usual weight to length (SPEC §2.3, C11).
   */
  async measure(batchId: string, lengthCm: number, note: string | null = null): Promise<string> {
    const id = await this.stock.act({
      type: 'measure',
      batchId,
      date: shopToday(this.store.now()),
      lengthCm,
      note,
    });
    await this.followMeasurement(batchId, lengthCm);
    return id;
  }

  /**
   * The product's usual weight to length after a measurement of one of its weight batches (the
   * old fabric `est_cm_per_kg`): the first measurement replaces the initial guess, then the
   * setting's policy decides (running average, or the last one). Only a batch that was bought
   * without a measured length counts: a conversion the shop measured itself is not a guess.
   */
  private async followMeasurement(batchId: string, lengthCm: number): Promise<void> {
    const { db } = this.store;
    const batch = await db.productBatches.get(batchId);
    if (batch?.unit !== 'kg' || batch.conversion?.source === 'measured') return;
    const product = await db.products.get(batch.productId);
    if (!product || product.voidedAt !== null) return;

    const others = (await db.productBatches.where('productId').equals(product.id).toArray()).filter(
      (other) => other.voidedAt === null && other.unit === 'kg' && other.id !== batch.id,
    );
    let measurementsSoFar = 0;
    for (const other of others) {
      const measured = await db.productStockMoves
        .where('batchId')
        .equals(other.id)
        .filter((move) => move.type === 'measurement' && move.voidedAt === null)
        .count();
      if (measured > 0) measurementsSoFar += 1;
    }
    const usual = product.kgToMeterConversion;
    const current = usual ? measuredCmPerKg(usual.lengthCm, usual.weightG) : null;
    const next = nextFabricEstimate({
      policy: await this.settings.get('est_cm_per_kg_policy', shopToday(this.store.now())),
      current,
      measurementsSoFar,
      measuredTotalCm: lengthCm,
      weightG: batch.receivedQuantity,
    });
    if (next === current && usual?.source === 'measured') return;
    await this.products.save(
      {
        name: product.name,
        sku: product.sku,
        description: product.description,
        tags: product.tags,
        purchaseUnits: product.purchaseUnits,
        sellingUnits: product.sellingUnits,
        kgToMeterConversion: { weightG: 1000, lengthCm: next, source: 'measured' },
        pricePerMeterCents: product.pricePerMeterCents,
        minPricePerMeterCents: product.minPricePerMeterCents,
        pricePerPieceCents: product.pricePerPieceCents,
        minPricePerPieceCents: product.minPricePerPieceCents,
        lowStockThreshold: product.lowStockThreshold,
        active: product.active,
      },
      product.id,
    );
  }

  /** Everything the views are built from, read once. */
  private async read() {
    const { db } = this.store;
    const [products, batches, rawMoves] = await Promise.all([
      db.products.toArray(),
      db.productBatches.toArray(),
      db.productStockMoves.toArray(),
    ]);
    const moves = await withFrozenCosts(db, rawMoves);
    const movesOf = groupBy(moves, (move) => move.batchId);
    const batchesOf = groupBy(
      batches.filter((batch) => batch.voidedAt === null),
      (batch) => batch.productId,
    );
    const recordOf = new Map(products.map((product) => [product.id, product]));

    const entries = products
      .filter((product) => product.voidedAt === null)
      .map((product) => ({
        identity: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          tags: product.tags,
          sellingUnits: product.sellingUnits,
          lowStockThreshold: product.lowStockThreshold,
          lowStockUnit: product.sellingUnits.includes('meter')
            ? ('meter' as const)
            : ('piece' as const),
          // A product record from before prices existed lacks these fields: none, not undefined.
          pricePerMeterCents: product.pricePerMeterCents ?? null,
          minPricePerMeterCents: product.minPricePerMeterCents ?? null,
          pricePerPieceCents: product.pricePerPieceCents ?? null,
          minPricePerPieceCents: product.minPricePerPieceCents ?? null,
          description: product.description,
        } satisfies ProductIdentity,
        fields: [product.name, product.sku, product.description, ...product.tags],
      }));

    const sourcesOf = (productId: string): ProductBatchSource[] =>
      (batchesOf.get(productId) ?? []).map((batch): ProductBatchSource => {
        const origin = {
          batchId: batch.id,
          code: batch.code,
          purchaseId: batch.purchaseId,
          remnant: batch.status === 'remnant',
          unit: batch.unit,
          receivedQuantity: batch.receivedQuantity,
          conversion: batch.conversion,
          origins: new Map(
            (movesOf.get(batch.id) ?? []).map((move): [string, MoveOrigin] => [
              move.id,
              { refId: move.refId, note: move.note },
            ]),
          ),
        };
        try {
          return {
            ...origin,
            history: {
              batch: coreBatchOf(batch),
              movements: coreMovesOf(movesOf.get(batch.id) ?? []),
            },
          };
        } catch {
          return { ...origin, history: null };
        }
      });
    return { entries, sourcesOf, recordOf };
  }

  /** The stock screen: products matching the search and the filter, and the totals of all. */
  async overview({
    search = '',
    filter = 'all',
  }: ProductInventoryQuery = {}): Promise<ProductInventoryOverview> {
    const { entries, sourcesOf } = await this.read();
    const all = entries.map(({ identity, fields }) => ({
      fields,
      view: summarizeProductStock(identity, sourcesOf(identity.id)),
    }));
    return {
      products: all
        .filter(({ fields }) => matchesSearch(search, fields))
        .map(({ view }) => view)
        .filter((view) => matchesStockFilter(view, filter))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      summary: summarizeInventory(all.map(({ view }) => view)),
    };
  }

  /** One product with its batches and every movement; null when it is not on this device. */
  async detail(id: string): Promise<ProductDetailView | null> {
    const { entries, sourcesOf, recordOf } = await this.read();
    const entry = entries.find(({ identity }) => identity.id === id);
    const record = recordOf.get(id);
    if (!entry || !record) return null;
    const sources = sourcesOf(id);
    const { db } = this.store;
    const [lines, purchases] = await Promise.all([
      db.saleLines.bulkGet(saleLineIdsOfMovements(sources)),
      db.purchases.bulkGet([...new Set(sources.map((source) => source.purchaseId))]),
    ]);
    const supplierIds = new Set(purchases.flatMap((purchase) => purchase?.supplierId ?? []));
    const suppliers = await db.suppliers.bulkGet([...supplierIds]);
    const nameOf = new Map(
      suppliers.flatMap((supplier): [string, string][] =>
        supplier ? [[supplier.id, supplier.name]] : [],
      ),
    );
    const supplierOfPurchase: Record<string, string> = {};
    for (const purchase of purchases) {
      const name = purchase?.supplierId ? nameOf.get(purchase.supplierId) : undefined;
      if (purchase && name !== undefined) supplierOfPurchase[purchase.id] = name;
    }
    return {
      stock: summarizeProductStock(entry.identity, sources),
      record,
      movements: productMovements(
        sources,
        new Map(
          lines.flatMap((line): [string, string][] => (line ? [[line.id, line.saleId]] : [])),
        ),
      ),
      supplierOfPurchase,
    };
  }

  /** The ledgers of the product's batches, and how many it has; null when it is not here or cancelled. */
  private async removalState(productId: string) {
    const { entries, sourcesOf } = await this.read();
    if (!entries.some(({ identity }) => identity.id === productId)) return null;
    const sources = sourcesOf(productId);
    const ledgers: ProductStockBatchLedger[] = [];
    let unreadable = false;
    for (const source of sources) {
      if (!source.history) {
        unreadable = true;
        continue;
      }
      ledgers.push(productStockBatchLedger(source.history.batch, source.history.movements));
    }
    // A batch that cannot be read cannot be shown to be empty: the product stays.
    const issues: ValidationIssue[] = unreadable
      ? [{ path: ['productId'], message: PRODUCT_REMOVAL_ISSUES.holdsStock, code: 'custom' }]
      : checkProductRemoval(ledgers);
    return { issues, batches: sources.length };
  }

  /** Whether the product can be removed, and what it has bought; null when it is not on this device. */
  async removal(productId: string): Promise<ProductRemovalView | null> {
    const state = await this.removalState(productId);
    return state && { holdsStock: state.issues.length > 0, batches: state.batches };
  }

  /**
   * Removes a product from the inventory (PB20). It is cancelled with a reason, never deleted:
   * its purchases, sales, returns, losses and photos stay where they are, and it only leaves the
   * lists and can no longer be bought. Refused while it still holds stock, which would vanish from
   * the stock value. The cancellation goes through the outbox like any change; the server checks
   * the same rule again.
   */
  async remove(productId: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const { db } = this.store;
    // The device id is read (and made, the first time) in a transaction of its own: have it before
    // this one opens, since `void` below asks for it and `meta` is not one of these tables.
    await this.store.deviceId();
    await db.transaction(
      'rw',
      [
        db.products,
        db.productBatches,
        db.productStockMoves,
        db.lockedCosts,
        db.outbox,
        db.settlements,
      ],
      async () => {
        const state = await this.removalState(productId);
        if (!state) throw new Error(`No product ${productId}`);
        if (state.issues.length > 0) throw new ValidationError(state.issues);
        await this.products.void(productId, reason);
      },
    );
  }
}
