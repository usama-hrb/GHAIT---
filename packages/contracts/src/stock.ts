import {
  type ProductStockBatch,
  type ProductStockBatchLedger,
  type ProductStockMovement,
  type ProductStockQuantity,
  productHoldsStock,
  productStockBatchLedger,
} from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import type { ValidationIssue } from './errors.js';
import { syncOrder } from './order.js';
import { PRODUCT_UNITS, type ProductUnit, productConversionSchema } from './products.js';

/**
 * Product stock (ADR 0012): the one place the shop's stock is kept. A **batch** is what one
 * purchase of one product brought in, in the unit it was bought in (kg, meter or piece), with
 * its cost and, when known, what a weight of it makes in meters. Everything else (what is left,
 * what a sale cost, what waits for a measurement) is derived from the batch's **moves** by the
 * product ledger in @fabric/core; nothing is stored as an editable number.
 */

/** A batch's short code: unique across devices, written on the roll or lot. */
export const batchCodeSchema = z.string().regex(/^[RB]-[A-Z]{1,3}\d{4,6}$/);

/** "B-" + the device's code + the device's own counter: the main till's first batch is B-A0001. */
export function batchCode(deviceCode: string, counter: number): string {
  return `B-${deviceCode}${String(counter).padStart(4, '0')}`;
}

/** Active, marked by hand as a remnant, or spent: only the remnant mark is ever changed by hand. */
export const BATCH_STATUSES = ['active', 'remnant', 'empty', 'written_off'] as const;

export const PRODUCT_STOCK_MOVE_TYPES = [
  'purchase',
  'sale',
  'loss',
  'length_correction',
  'adjustment',
  'return',
  'reversal',
  'measurement',
] as const satisfies readonly ProductStockMovement['type'][];
export type ProductStockMoveType = (typeof PRODUCT_STOCK_MOVE_TYPES)[number];

/** Issue messages for the stock rules zod has no built-in code for; the web shows i18n text. */
export const STOCK_ISSUES = {
  noChange: 'stock_move_changes_nothing',
  notPushable: 'stock_move_type_not_pushable',
  wrongBatch: 'stock_move_wrong_batch',
  reasonRequired: 'stock_move_reason_required',
  invalidQuantity: 'stock_move_invalid_quantity',
  notMeasurable: 'stock_batch_not_measurable',
  batchFieldsFixed: 'batch_fields_are_fixed',
  pieceWithConversion: 'batch_piece_has_no_conversion',
} as const;

/**
 * One purchase of one product. Its fields never change after the purchase (the remnant mark
 * excepted): later corrections and measurements are moves, so the receipt stays as it was.
 */
export const productBatchSchema = recordBaseSchema
  .extend({
    code: batchCodeSchema,
    productId: idSchema,
    purchaseId: idSchema,
    /** The purchase's date: the oldest purchase is sold first (PB1). */
    purchaseDate: isoDateSchema,
    /** The unit it was received in. */
    unit: z.enum(PRODUCT_UNITS),
    /** cm, g or pieces, by `unit`. */
    receivedQuantity: z.int().min(1),
    costTotalCents: amountCentsSchema,
    /**
     * What a weight of it makes in meters, as known when it was bought (kg only). null for a
     * weight whose length is not known yet: it waits for a measurement and has no meters.
     */
    conversion: productConversionSchema,
    status: z.enum(BATCH_STATUSES),
  })
  .superRefine((batch, context) => {
    if (batch.unit === 'piece' && batch.conversion !== null) {
      context.addIssue({
        code: 'custom',
        path: ['conversion'],
        message: STOCK_ISSUES.pieceWithConversion,
      });
    }
  });
export type ProductBatch = z.output<typeof productBatchSchema>;

/** SPEC §13 `stock_move`, per batch: append-only; a correction is a new move. */
export const productStockMoveSchema = recordBaseSchema.extend({
  batchId: idSchema,
  type: z.enum(PRODUCT_STOCK_MOVE_TYPES),
  /** The unit of `delta`: the batch's own for the receipt, meters for a sale of cloth. */
  unit: z.enum(PRODUCT_UNITS),
  /**
   * Signed cm, g or pieces. A `measurement` is not a change: it carries the batch's whole
   * measured length (cm).
   */
  delta: z.int(),
  /** What caused it: the purchase, the sale line, the sale move a return gives back… */
  refId: idSchema.nullable(),
  date: isoDateSchema,
  note: optionalTextSchema(500),
  /** Who measured or counted, for a measurement. */
  actor: optionalTextSchema(80).default(null),
});
export type ProductStockMove = z.output<typeof productStockMoveSchema>;

const withServerSeq = { serverSeq: z.int().positive() };
export const storedProductBatchSchema = productBatchSchema.extend(withServerSeq);
export const storedProductStockMoveSchema = productStockMoveSchema.extend(withServerSeq);
export type StoredProductBatch = z.output<typeof storedProductBatchSchema>;
export type StoredProductStockMove = z.output<typeof storedProductStockMoveSchema>;

/** A move as stored: with its server_seq once the server has it, and the cost a settlement froze. */
export type SequencedProductMove = ProductStockMove & {
  serverSeq?: number | null;
  lockedCostCents?: number;
};

export function quantityOf(unit: ProductUnit, amount: number): ProductStockQuantity {
  switch (unit) {
    case 'kg':
      return { unit, grams: amount };
    case 'meter':
      return { unit, centimeters: amount };
    case 'piece':
      return { unit, pieces: amount };
  }
}

/** The amount of a quantity in its own unit (cm, g or pieces). */
export function amountOfQuantity(quantity: ProductStockQuantity): number {
  switch (quantity.unit) {
    case 'kg':
      return quantity.grams;
    case 'meter':
      return quantity.centimeters;
    case 'piece':
      return quantity.pieces;
  }
}

export function coreBatchOf(batch: ProductBatch): ProductStockBatch {
  return {
    id: batch.id,
    productId: batch.productId,
    purchaseDate: batch.purchaseDate,
    createdAt: batch.createdAt,
    purchaseUnit: batch.unit,
    received: quantityOf(batch.unit, batch.receivedQuantity),
    costTotalCents: batch.costTotalCents,
    initialConversion: batch.conversion,
  };
}

function coreMoveOf(move: SequencedProductMove): ProductStockMovement {
  const common = { id: move.id, batchId: move.batchId, date: move.date, createdAt: move.createdAt };
  const delta = quantityOf(move.unit, move.delta);
  switch (move.type) {
    case 'purchase':
      return { ...common, type: 'purchase', delta };
    case 'sale':
      return {
        ...common,
        type: 'sale',
        delta,
        ...(move.lockedCostCents === undefined ? {} : { lockedCostCents: move.lockedCostCents }),
      };
    case 'loss':
      return {
        ...common,
        type: 'loss',
        delta,
        ...(move.lockedCostCents === undefined ? {} : { lockedCostCents: move.lockedCostCents }),
      };
    case 'length_correction':
      return { ...common, type: 'length_correction', delta };
    case 'adjustment':
      return { ...common, type: 'adjustment', delta };
    case 'return':
      return { ...common, type: 'return', delta, returnsMoveId: move.refId ?? '' };
    case 'reversal':
      return { ...common, type: 'reversal', delta, reversesMoveId: move.refId ?? '' };
    case 'measurement':
      return {
        ...common,
        type: 'measurement',
        measuredLengthCm: move.delta,
        measuredBy: move.actor ?? move.deviceId,
        measuredAt: move.createdAt,
      };
  }
}

/** A batch's moves as the ledger reads them: history order (syncOrder), the receipt first. */
export function coreMovesOf(moves: readonly SequencedProductMove[]): ProductStockMovement[] {
  const ordered = [...moves].sort(syncOrder);
  const receipt = ordered.find((move) => move.type === 'purchase');
  const rest = ordered.filter((move) => move !== receipt);
  return [...(receipt ? [receipt] : []), ...rest].map(coreMoveOf);
}

/** The batch's costs, quantities and measurement state, from its moves (@fabric/core). */
export function batchLedgerOf(
  batch: ProductBatch,
  moves: readonly SequencedProductMove[],
): ProductStockBatchLedger {
  return productStockBatchLedger(
    coreBatchOf(batch),
    coreMovesOf(moves.filter((move) => move.batchId === batch.id)),
  );
}

/** Issue messages for removing a product from the inventory (PB20); the web shows i18n text. */
export const PRODUCT_REMOVAL_ISSUES = {
  holdsStock: 'product_holds_stock',
} as const;

/**
 * Whether a product may be removed from the inventory (PB20), from the ledgers of its batches: it
 * may not while it still holds stock (@fabric/core `productHoldsStock`). The device checks it
 * before it removes the product; the server re-runs it on every removal, so a stale device cannot
 * hide goods that still exist. Nothing else blocks it: the product is cancelled, never deleted,
 * so its purchases, sales, returns and losses stay in the books.
 */
export function checkProductRemoval(
  batches: readonly ProductStockBatchLedger[],
): ValidationIssue[] {
  return productHoldsStock(batches)
    ? [{ path: ['productId'], message: PRODUCT_REMOVAL_ISSUES.holdsStock, code: 'custom' }]
    : [];
}

/**
 * What each sale and loss of a batch still carries once the goods that came back are taken off
 * (RT1). The product ledger keeps a sale's gross cost and each return's cost apart; the books
 * (settlements, integrity, sale figures) read the net, as the roll ledger always gave it.
 */
export function netCostsOf(
  ledger: Pick<ProductStockBatchLedger, 'costs' | 'returns'>,
): { moveId: string; costCents: number }[] {
  const returned = new Map<string, number>();
  for (const back of ledger.returns) {
    returned.set(back.saleMoveId, (returned.get(back.saleMoveId) ?? 0) + back.costCents);
  }
  return ledger.costs.map(({ moveId, costCents }) => ({
    moveId,
    costCents: costCents - (returned.get(moveId) ?? 0),
  }));
}

/** The unit a batch's counts and losses are made in: weight while it has no length, else its own. */
export function workingUnitOf(ledger: ProductStockBatchLedger): ProductUnit {
  if (ledger.purchaseUnit === 'piece') return 'piece';
  if (ledger.purchaseUnit === 'kg' && ledger.conversion === null) return 'kg';
  return 'meter';
}

/** What the ledger says the batch holds in `unit` (0 when that unit does not apply). */
export function availableIn(ledger: ProductStockBatchLedger, unit: ProductUnit): number {
  const quantity = ledger.available[unit];
  return quantity ? amountOfQuantity(quantity) : 0;
}

/** What a stock action asks for: a loss, a count of what is on the batch, or a measurement. */
const reasonSchema = z.string().trim().min(1).max(500);
export const newBatchActionSchema = z.discriminatedUnion('type', [
  /** Damaged or wasted stock: a loss of the period, at cost (T12). */
  z.object({
    type: z.literal('loss'),
    batchId: idSchema,
    date: isoDateSchema,
    quantity: z.int().min(1),
    reason: reasonSchema,
  }),
  /** Stocktake: what was actually counted on the batch; the difference is recorded. */
  z.object({
    type: z.literal('adjustment'),
    batchId: idSchema,
    date: isoDateSchema,
    counted: z.int().min(0),
    reason: reasonSchema,
  }),
  /** The batch's whole length, measured; this is what makes a weight saleable by the meter. */
  z.object({
    type: z.literal('measure'),
    batchId: idSchema,
    date: isoDateSchema,
    lengthCm: z.int().min(1),
    note: optionalTextSchema(500).default(null),
  }),
]);
export type NewBatchAction = z.output<typeof newBatchActionSchema>;
export type NewBatchActionInput = z.input<typeof newBatchActionSchema>;

const issue = (path: string, message: string): ValidationIssue[] => [
  { path: [path], message, code: 'custom' },
];

/**
 * The batch's whole length from a measurement of what is on it now: what is on it plus what the
 * books say was taken off (SPEC §2.3). A batch nothing was taken from is just the measurement.
 */
export function wholeLengthFrom(
  ledger: Pick<ProductStockBatchLedger, 'lengthBasisCm' | 'available'>,
  measuredNowCm: number,
): number {
  const basis = ledger.lengthBasisCm;
  const left = ledger.available.meter?.unit === 'meter' ? ledger.available.meter.centimeters : 0;
  return basis === null ? measuredNowCm : basis - left + measuredNowCm;
}

export interface BuiltBatchMove {
  move: ProductStockMove;
}

/**
 * The stock move an action records, or an issue when it changes nothing or cannot be:
 * - a loss takes `quantity` off, in the unit the batch is counted in;
 * - a count records the difference with the books;
 * - a measurement of a weight is a `measurement` of its whole length (the weight's receipt
 *   stays as it was); of a batch bought by the meter, a correction of its length.
 */
export function buildBatchMove(
  input: NewBatchAction,
  batch: ProductBatch,
  ledger: ProductStockBatchLedger,
  meta: { id: string; deviceId: string; now: string; actor: string | null },
): { ok: true; move: ProductStockMove } | { ok: false; issues: ValidationIssue[] } {
  const base = {
    id: meta.id,
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
    batchId: batch.id,
    refId: null,
    date: input.date,
  };
  const unit = workingUnitOf(ledger);
  switch (input.type) {
    case 'loss':
      return {
        ok: true,
        move: {
          ...base,
          type: 'loss',
          unit,
          delta: -input.quantity,
          note: input.reason,
          actor: null,
        },
      };
    case 'adjustment': {
      const delta = input.counted - availableIn(ledger, unit);
      if (delta === 0) return { ok: false, issues: issue('counted', STOCK_ISSUES.noChange) };
      return {
        ok: true,
        move: { ...base, type: 'adjustment', unit, delta, note: input.reason, actor: null },
      };
    }
    case 'measure': {
      if (batch.unit === 'kg') {
        return {
          ok: true,
          move: {
            ...base,
            type: 'measurement',
            unit: 'meter',
            delta: input.lengthCm,
            note: input.note,
            actor: meta.actor,
          },
        };
      }
      if (batch.unit === 'meter' && ledger.lengthBasisCm !== null) {
        const delta = input.lengthCm - ledger.lengthBasisCm;
        if (delta === 0) return { ok: false, issues: issue('lengthCm', STOCK_ISSUES.noChange) };
        return {
          ok: true,
          move: {
            ...base,
            type: 'length_correction',
            unit: 'meter',
            delta,
            note: input.note,
            actor: meta.actor,
          },
        };
      }
      return { ok: false, issues: issue('batchId', STOCK_ISSUES.notMeasurable) };
    }
  }
}

const PUSHABLE: ReadonlySet<ProductStockMoveType> = new Set([
  'loss',
  'adjustment',
  'length_correction',
  'measurement',
]);

/**
 * Re-checks a pushed stock move against its batch (the server's own check). Purchase, sale,
 * return and void moves come inside their own ops, never alone. The ledger must still read the
 * history with the move added (a weight with no length cannot be counted in meters…).
 */
export function checkBatchMove(
  move: ProductStockMove,
  batch: ProductBatch,
  history: readonly SequencedProductMove[],
): ValidationIssue[] {
  if (!PUSHABLE.has(move.type) || move.refId !== null) {
    return issue('type', STOCK_ISSUES.notPushable);
  }
  if (move.batchId !== batch.id) return issue('batchId', STOCK_ISSUES.wrongBatch);
  if (move.type === 'loss' && move.delta >= 0) return issue('delta', STOCK_ISSUES.invalidQuantity);
  if ((move.type === 'loss' || move.type === 'adjustment') && move.note === null) {
    return issue('note', STOCK_ISSUES.reasonRequired);
  }
  if (move.type === 'measurement') {
    if (batch.unit !== 'kg' || move.unit !== 'meter' || move.delta < 1) {
      return issue('delta', STOCK_ISSUES.notMeasurable);
    }
  } else if (move.type === 'length_correction') {
    if (batch.unit !== 'meter' || move.unit !== 'meter') {
      return issue('type', STOCK_ISSUES.notMeasurable);
    }
    if (move.delta === 0) return issue('delta', STOCK_ISSUES.noChange);
  } else if (move.delta === 0) {
    return issue('delta', STOCK_ISSUES.noChange);
  }
  try {
    batchLedgerOf(batch, [...history, move]);
  } catch {
    return issue('delta', STOCK_ISSUES.invalidQuantity);
  }
  return [];
}

/** A batch's own fields never change after its purchase; only the remnant mark does. */
export function checkBatchUpdate(current: ProductBatch, next: ProductBatch): ValidationIssue[] {
  for (const key of [
    'code',
    'productId',
    'purchaseId',
    'purchaseDate',
    'unit',
    'receivedQuantity',
    'costTotalCents',
    'createdAt',
  ] as const) {
    if (current[key] !== next[key]) return issue(key, STOCK_ISSUES.batchFieldsFixed);
  }
  if (JSON.stringify(current.conversion) !== JSON.stringify(next.conversion)) {
    return issue('conversion', STOCK_ISSUES.batchFieldsFixed);
  }
  if (next.status !== 'active' && next.status !== 'remnant') {
    return issue('status', STOCK_ISSUES.batchFieldsFixed);
  }
  return [];
}

/** A batch and every move it has so far: what pricing and costing need to know about it. */
export interface BatchHistory {
  batch: ProductBatch;
  moves: SequencedProductMove[];
}

const quantitySchema = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('kg'), grams: z.int() }),
  z.object({ unit: z.literal('meter'), centimeters: z.int() }),
  z.object({ unit: z.literal('piece'), pieces: z.int() }),
]);

/** What @fabric/core derives from a batch's moves (productStockBatchLedger), as the API sends it. */
export const batchLedgerSchema = z.object({
  batchId: idSchema,
  purchaseUnit: z.enum(PRODUCT_UNITS),
  remaining: quantitySchema,
  available: z.object({
    kg: quantitySchema.optional(),
    meter: quantitySchema.optional(),
    piece: quantitySchema.optional(),
  }),
  costTotalCents: z.int(),
  unallocatedCostCents: z.int(),
  costs: z.array(z.object({ moveId: idSchema, costCents: z.int() })),
  returns: z.array(z.object({ moveId: idSchema, saleMoveId: idSchema, costCents: z.int() })),
  measurementStatus: z.enum(['not_required', 'pending', 'estimated', 'measured']),
  awaitingMeasurement: quantitySchema.nullable(),
  oversold: quantitySchema,
  costPerUnitCents: z.object({
    kg: z.int().optional(),
    meter: z.int().optional(),
    piece: z.int().optional(),
  }),
  conversion: productConversionSchema,
  lengthBasisCm: z.int().nullable(),
});

/** GET /batches/:id: the batch, its moves and what core derives from them. */
export const batchDetailSchema = z.object({
  batch: storedProductBatchSchema,
  moves: z.array(storedProductStockMoveSchema),
  ledger: batchLedgerSchema,
});
export type BatchDetail = z.output<typeof batchDetailSchema>;

/** Moves with the costs live settlements froze for them (P9), for batchLedgerOf. */
export function withLockedMoveCosts<M extends SequencedProductMove>(
  moves: readonly M[],
  lockedCosts: readonly { stockMoveId: string; costCents: number; voidedAt: string | null }[],
): M[] {
  const frozen = new Map(
    lockedCosts
      .filter((cost) => cost.voidedAt === null)
      .map((cost) => [cost.stockMoveId, cost.costCents]),
  );
  return moves.map((move) => {
    const lockedCostCents = frozen.get(move.id);
    return lockedCostCents === undefined ? move : { ...move, lockedCostCents };
  });
}
