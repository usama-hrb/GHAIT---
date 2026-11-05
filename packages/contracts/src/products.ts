import { PRODUCT_STOCK_UNITS, type ProductStockUnit } from '@fabric/core';
import { z } from 'zod';
import { amountCentsSchema, optionalTextSchema } from './common.js';
import { recordBaseSchema } from './catalog.js';

export const PRODUCT_UNITS = PRODUCT_STOCK_UNITS;
export type ProductUnit = ProductStockUnit;

/** What a product is sold in: weight is a way of buying, never of selling (owner, Task 5). */
export const PRODUCT_SELLING_UNITS = ['meter', 'piece'] as const satisfies readonly ProductUnit[];
export type ProductSellingUnit = (typeof PRODUCT_SELLING_UNITS)[number];

export const productConversionSchema = z
  .object({
    weightG: z.int().min(1),
    lengthCm: z.int().min(1),
    source: z.enum(['estimated', 'measured']),
  })
  .nullable();
export type ProductConversion = z.output<typeof productConversionSchema>;

/** Issue messages for the product rules zod has no built-in code for; the web shows i18n text. */
export const PRODUCT_ISSUES = {
  duplicateUnit: 'duplicate_product_unit',
  priceRequired: 'product_price_required',
  minRequired: 'product_min_price_required',
  minAbovePrice: 'product_min_price_above_price',
  voidedActive: 'voided_product_cannot_be_active',
} as const;

const productFields = z.object({
  name: z.string().trim().min(1).max(160),
  sku: optionalTextSchema(80).default(null),
  description: optionalTextSchema(1000).default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  /** Empty is allowed for migrated products that have never had a purchase. */
  purchaseUnits: z.array(z.enum(PRODUCT_UNITS)).max(PRODUCT_UNITS.length),
  sellingUnits: z.array(z.enum(PRODUCT_SELLING_UNITS)).min(1).max(PRODUCT_SELLING_UNITS.length),
  kgToMeterConversion: productConversionSchema.default(null),
  /**
   * What the product sells for, per unit it is sold in: the normal price and the lowest price it
   * may be sold at. A cashier never sells below the minimum; the owner may, after confirming.
   */
  pricePerMeterCents: amountCentsSchema.nullable().default(null),
  minPricePerMeterCents: amountCentsSchema.nullable().default(null),
  pricePerPieceCents: amountCentsSchema.nullable().default(null),
  minPricePerPieceCents: amountCentsSchema.nullable().default(null),
  /**
   * Running low at or under this much, in the unit it is mainly sold in: cm for a product sold by
   * the meter, pieces for one sold only by the piece. null: never low.
   */
  lowStockThreshold: z.int().min(0).max(10_000_000).nullable().default(null),
  active: z.boolean().default(true),
});

/** The selling price and minimum of each unit the product is sold in (a form's rules, SPEC §3). */
function sellingPrices(
  product: Pick<
    z.infer<typeof productFields>,
    | 'sellingUnits'
    | 'pricePerMeterCents'
    | 'minPricePerMeterCents'
    | 'pricePerPieceCents'
    | 'minPricePerPieceCents'
  >,
  context: z.RefinementCtx,
): void {
  const prices = {
    meter: [product.pricePerMeterCents, product.minPricePerMeterCents],
    piece: [product.pricePerPieceCents, product.minPricePerPieceCents],
  } as const;
  const keys = {
    meter: ['pricePerMeterCents', 'minPricePerMeterCents'],
    piece: ['pricePerPieceCents', 'minPricePerPieceCents'],
  } as const;
  for (const unit of product.sellingUnits) {
    const [price, min] = prices[unit];
    const [priceKey, minKey] = keys[unit];
    if (price === null || price < 1) {
      context.addIssue({ code: 'custom', path: [priceKey], message: PRODUCT_ISSUES.priceRequired });
    }
    if (min === null) {
      context.addIssue({ code: 'custom', path: [minKey], message: PRODUCT_ISSUES.minRequired });
    } else if (price !== null && min > price) {
      context.addIssue({ code: 'custom', path: [minKey], message: PRODUCT_ISSUES.minAbovePrice });
    }
  }
}

function uniqueUnits(
  product: Pick<z.infer<typeof productFields>, 'purchaseUnits' | 'sellingUnits'>,
  context: z.RefinementCtx,
): void {
  for (const key of ['purchaseUnits', 'sellingUnits'] as const) {
    if (new Set(product[key]).size !== product[key].length) {
      context.addIssue({
        code: 'custom',
        path: [key],
        message: PRODUCT_ISSUES.duplicateUnit,
      });
    }
  }
}

/** What a user edits: units, and a price with its minimum for every unit it is sold in. */
export const productInputSchema = productFields.superRefine((product, context) => {
  uniqueUnits(product, context);
  sellingPrices(product, context);
});
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductFields = z.output<typeof productInputSchema>;
export const productSchema = recordBaseSchema
  .extend(productFields.shape)
  .superRefine((product, context) => {
    uniqueUnits(product, context);
    if (product.voidedAt !== null && product.active) {
      context.addIssue({
        code: 'custom',
        path: ['active'],
        message: PRODUCT_ISSUES.voidedActive,
      });
    }
  });
export type Product = z.output<typeof productSchema>;

export const storedProductSchema = productSchema.extend({ serverSeq: z.int().positive() });
export type StoredProduct = z.output<typeof storedProductSchema>;
