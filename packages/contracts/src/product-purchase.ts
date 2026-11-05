import type { ProductStockBatchLedger } from '@fabric/core';
import { z } from 'zod';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import { firstDifference } from './diff.js';
import type { ValidationIssue } from './errors.js';
import { PRODUCT_UNITS, type Product, productConversionSchema } from './products.js';
import {
  PURCHASE_ISSUES,
  type Purchase,
  purchasePaymentIssues,
  purchaseSchema,
} from './purchasing.js';
import {
  batchLedgerOf,
  type ProductBatch,
  type ProductStockMove,
  productBatchSchema,
  productStockMoveSchema,
} from './stock.js';

/**
 * Buying stock (ADR 0012): one purchase of one product makes one batch with its receipt move,
 * in the unit it was bought in. Creating a product with its first stock and restocking an
 * existing product are the same operation.
 */

export const PRODUCT_PURCHASE_ISSUES = {
  unknownProduct: 'purchase_unknown_product',
  unitNotSupported: 'purchase_unit_not_supported',
  conversionOnlyForWeight: 'purchase_conversion_only_for_weight',
} as const;

/** One op: the purchase, the batch it brings in and the batch's receipt, applied atomically. */
export const productPurchaseAggregateSchema = z.object({
  purchase: purchaseSchema,
  batches: z.array(productBatchSchema).min(1).max(100),
  moves: z.array(productStockMoveSchema).min(1).max(100),
});
export type ProductPurchaseAggregate = z.output<typeof productPurchaseAggregateSchema>;

/** What the user enters to buy stock of a product. */
export const newProductPurchaseSchema = z
  .object({
    date: isoDateSchema,
    productId: idSchema,
    supplierId: idSchema.nullable().default(null),
    /** Paid now; null: all of it. Less than the total leaves a debt to the supplier (SP1). */
    paidCents: amountCentsSchema.nullable().optional(),
    notes: optionalTextSchema(1000).default(null),
    /** What was bought in: kilograms, meters or pieces. */
    unit: z.enum(PRODUCT_UNITS),
    /** In g, cm or pieces, by `unit`. */
    quantity: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
    /** What the whole purchase cost. */
    totalCostCents: amountCentsSchema,
    /**
     * What a weight bought makes in meters, when known. null: the length is not known, so the
     * weight is recorded and waits for a measurement; no length is made up (kg only).
     */
    conversion: productConversionSchema.default(null),
  })
  .superRefine((input, context) => {
    if (input.unit !== 'kg' && input.conversion !== null) {
      context.addIssue({
        code: 'custom',
        path: ['conversion'],
        message: PRODUCT_PURCHASE_ISSUES.conversionOnlyForWeight,
      });
    }
  });
export type NewProductPurchase = z.output<typeof newProductPurchaseSchema>;
export type NewProductPurchaseInput = z.input<typeof newProductPurchaseSchema>;

export interface ProductPurchaseIds {
  purchaseId: string;
  batchId: string;
  moveId: string;
  code: string;
}

/**
 * The records a purchase creates: the device builds them to save offline, and the server rebuilds
 * them to check what it is sent (checkProductPurchase).
 */
export function buildProductPurchase(
  input: NewProductPurchase,
  ids: ProductPurchaseIds,
  meta: { deviceId: string; now: string },
): ProductPurchaseAggregate {
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const purchase: Purchase = {
    ...base,
    id: ids.purchaseId,
    date: input.date,
    supplierId: input.supplierId,
    method: input.unit,
    pricePerMeterCents: null,
    weightG: input.unit === 'kg' ? input.quantity : null,
    estCmPerKg: null,
    totalCostCents: input.totalCostCents,
    paidCents: input.paidCents ?? input.totalCostCents,
    notes: input.notes,
  };
  const batch: ProductBatch = {
    ...base,
    id: ids.batchId,
    code: ids.code,
    productId: input.productId,
    purchaseId: ids.purchaseId,
    purchaseDate: input.date,
    unit: input.unit,
    receivedQuantity: input.quantity,
    costTotalCents: input.totalCostCents,
    conversion: input.unit === 'kg' ? input.conversion : null,
    status: 'active',
  };
  const receipt: ProductStockMove = {
    ...base,
    id: ids.moveId,
    batchId: ids.batchId,
    type: 'purchase',
    unit: input.unit,
    delta: input.quantity,
    refId: ids.purchaseId,
    date: input.date,
    note: null,
    actor: null,
  };
  return { purchase, batches: [batch], moves: [receipt] };
}

/** The purchase as typed, read back from its records (null when they are inconsistent). */
function inputOf({
  purchase,
  batches,
  moves,
}: ProductPurchaseAggregate): NewProductPurchase | null {
  const [batch] = batches;
  if (batches.length !== 1 || moves.length !== 1 || !batch) return null;
  return {
    date: purchase.date,
    productId: batch.productId,
    supplierId: purchase.supplierId,
    paidCents: purchase.paidCents,
    notes: purchase.notes,
    unit: batch.unit,
    quantity: batch.receivedQuantity,
    totalCostCents: purchase.totalCostCents,
    conversion: batch.conversion,
  };
}

/**
 * Re-checks a pushed purchase (the server's own check): its batch, receipt, totals and payment
 * must be exactly what buildProductPurchase gives for what was typed, for a product that exists
 * and is bought in that unit. Empty when it is consistent.
 */
export function checkProductPurchase(
  aggregate: ProductPurchaseAggregate,
  product: Pick<Product, 'voidedAt' | 'purchaseUnits'> | undefined,
): ValidationIssue[] {
  const issue = (path: string, message: string): ValidationIssue[] => [
    { path: [path], message, code: 'custom' },
  ];
  const input = inputOf(aggregate);
  const [batch] = aggregate.batches;
  const [move] = aggregate.moves;
  if (!input || !batch || !move) return issue('purchase', PURCHASE_ISSUES.inconsistent);
  let expected: ProductPurchaseAggregate;
  try {
    expected = buildProductPurchase(
      input,
      { purchaseId: aggregate.purchase.id, batchId: batch.id, moveId: move.id, code: batch.code },
      { deviceId: aggregate.purchase.deviceId, now: aggregate.purchase.createdAt },
    );
  } catch {
    return issue('purchase', PURCHASE_ISSUES.inconsistent);
  }
  const path = firstDifference(expected, aggregate);
  if (path) return [{ path, message: PURCHASE_ISSUES.notCore, code: 'custom' }];
  const payment = purchasePaymentIssues(aggregate.purchase);
  if (payment.length > 0) return payment;
  if (!product || product.voidedAt !== null) {
    return issue('productId', PRODUCT_PURCHASE_ISSUES.unknownProduct);
  }
  if (!product.purchaseUnits.includes(batch.unit)) {
    return issue('unit', PRODUCT_PURCHASE_ISSUES.unitNotSupported);
  }
  return [];
}

const PREVIEW_IDS: ProductPurchaseIds = {
  purchaseId: 'preview-purchase',
  batchId: 'preview-batch',
  moveId: 'preview-receipt',
  code: 'B-A0001',
};

/**
 * What a purchase would bring in, as the ledger reads it: the meters a weight makes, the cost
 * per meter, or weight awaiting a measurement. For the form to show before saving.
 */
export function previewProductPurchase(input: NewProductPurchase): ProductStockBatchLedger {
  const built = buildProductPurchase(input, PREVIEW_IDS, {
    deviceId: 'preview',
    now: `${input.date}T12:00:00.000Z`,
  });
  const [batch] = built.batches;
  if (!batch) throw new RangeError('a purchase makes a batch');
  return batchLedgerOf(batch, built.moves);
}
