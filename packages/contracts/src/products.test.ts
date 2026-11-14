import { describe, expect, it } from 'vitest';
import { productInputSchema, productSchema, SYNC_ENTITIES } from './index.js';

const product = {
  name: 'Rosa',
  purchaseUnits: ['kg', 'meter'],
  sellingUnits: ['meter'],
  pricePerMeterCents: 300,
  minPricePerMeterCents: 200,
};

describe('product', () => {
  it('parses a product with distinct purchase and selling units', () => {
    expect(productInputSchema.parse(product)).toMatchObject({
      name: 'Rosa',
      sku: null,
      purchaseUnits: ['kg', 'meter'],
      sellingUnits: ['meter'],
      pricePerMeterCents: 300,
      minPricePerMeterCents: 200,
      lowStockThreshold: null,
      kgToMeterConversion: null,
      active: true,
    });
  });

  it('requires a sellable unit and rejects repeated or unknown units', () => {
    expect(productInputSchema.safeParse({ ...product, sellingUnits: [] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...product, purchaseUnits: ['kg', 'kg'] }).success).toBe(
      false,
    );
    expect(productInputSchema.safeParse({ ...product, sellingUnits: ['box'] }).success).toBe(false);
  });

  it('is sold in metres or pieces, never by weight', () => {
    const piece = { pricePerPieceCents: 1_000, minPricePerPieceCents: 800 };
    for (const sellingUnits of [['meter', 'piece'], ['piece']]) {
      expect(productInputSchema.safeParse({ ...product, ...piece, sellingUnits }).success).toBe(
        true,
      );
    }
    expect(productInputSchema.safeParse({ ...product, sellingUnits: ['kg'] }).success).toBe(false);
    expect(
      productInputSchema.safeParse({ ...product, sellingUnits: ['meter', 'kg'] }).success,
    ).toBe(false);
    // Weight stays a way of buying.
    expect(
      productInputSchema.safeParse({ ...product, purchaseUnits: ['kg', 'meter', 'piece'] }).success,
    ).toBe(true);
  });

  it('needs a price and a minimum for every unit it is sold in, the minimum not above the price', () => {
    const issues = (fields: Record<string, unknown>) => {
      const result = productInputSchema.safeParse({ ...product, ...fields });
      return result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
    };
    expect(issues({})).toEqual([]);
    expect(issues({ pricePerMeterCents: null })).toEqual([
      'pricePerMeterCents:product_price_required',
    ]);
    expect(issues({ pricePerMeterCents: 0, minPricePerMeterCents: 0 })).toEqual([
      'pricePerMeterCents:product_price_required',
    ]);
    expect(issues({ minPricePerMeterCents: null })).toEqual([
      'minPricePerMeterCents:product_min_price_required',
    ]);
    expect(issues({ minPricePerMeterCents: 301 })).toEqual([
      'minPricePerMeterCents:product_min_price_above_price',
    ]);
    // A minimum of nothing is allowed (no floor); a price per piece only matters when sold by it.
    expect(issues({ minPricePerMeterCents: 0 })).toEqual([]);
    expect(issues({ sellingUnits: ['meter', 'piece'] })).toEqual([
      'pricePerPieceCents:product_price_required',
      'minPricePerPieceCents:product_min_price_required',
    ]);
    expect(issues({ pricePerMeterCents: -1 }).length).toBeGreaterThan(0);
  });

  it('keeps the suppliers a product is bought from, each once', () => {
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    expect(productInputSchema.parse(product).supplierIds).toEqual([]);
    expect(
      productInputSchema.parse({ ...product, supplierIds: [first, second] }).supplierIds,
    ).toEqual([first, second]);
    const twice = productInputSchema.safeParse({ ...product, supplierIds: [first, first] });
    expect(twice.success ? [] : twice.error.issues.map((issue) => issue.message)).toEqual([
      'duplicate_product_supplier',
    ]);
    expect(productInputSchema.safeParse({ ...product, supplierIds: ['atlas'] }).success).toBe(
      false,
    );
  });

  it('accepts a measured or estimated integer conversion only', () => {
    const measured = { weightG: 500, lengthCm: 100, source: 'measured' };
    expect(
      productInputSchema.safeParse({ ...product, kgToMeterConversion: measured }).success,
    ).toBe(true);
    expect(
      productInputSchema.safeParse({
        ...product,
        kgToMeterConversion: { ...measured, weightG: 0 },
      }).success,
    ).toBe(false);
  });

  it('validates full records and registers the sync entity', () => {
    const record = {
      ...productInputSchema.parse(product),
      id: crypto.randomUUID(),
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
      deviceId: 'desk-1',
      voidedAt: null,
    };
    expect(productSchema.safeParse(record).success).toBe(true);
    expect(productSchema.safeParse({ ...record, voidedAt: record.updatedAt }).success).toBe(false);
    expect(SYNC_ENTITIES.product.schema).toBe(productSchema);
  });
});
