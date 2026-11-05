import type { Fabric, Product, Supplier, Variant } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow, SyncHandler } from '../sync/index.js';

type Base = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deviceId: string;
  voidedAt: Date | null;
};

function baseOf(row: Base) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deviceId: row.deviceId,
    voidedAt: row.voidedAt?.toISOString() ?? null,
  };
}

/** Columns a write sets from a record; createdAt only on insert, voidedAt never (void ops). */
function writeColumns(record: { updatedAt: string; deviceId: string }) {
  return { updatedAt: new Date(record.updatedAt), deviceId: record.deviceId };
}

type FabricRow = typeof schema.fabric.$inferSelect;

function fabricOf(row: FabricRow): SyncedRow<Fabric> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      name: row.name,
      type: row.type,
      defaultSupplierId: row.defaultSupplierId,
      refPricePerMeterCents: row.refPricePerMeterCents,
      minPricePerMeterCents: row.minPricePerMeterCents,
      estCmPerKg: row.estCmPerKg,
      sellableAsPiece: row.sellableAsPiece,
      piecePriceCents: row.piecePriceCents,
      tags: row.tags,
      notes: row.notes,
    },
  };
}

/** Fabrics are history since ADR 0012 (the product replaced them): read, never written. */
@Injectable()
export class FabricRepository implements SyncHandler<'fabric'> {
  readonly entity = 'fabric' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Fabric> | undefined> {
    const [row] = await this.tx.db.select().from(schema.fabric).where(eq(schema.fabric.id, id));
    return row && fabricOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Fabric>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.fabric)
      .where(gt(schema.fabric.serverSeq, since))
      .orderBy(asc(schema.fabric.serverSeq))
      .limit(limit);
    return rows.map(fabricOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<Fabric>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.fabric)
      .where(includeVoided ? undefined : isNull(schema.fabric.voidedAt))
      .orderBy(asc(schema.fabric.name));
    return rows.map(fabricOf);
  }
}

type VariantRow = typeof schema.variant.$inferSelect;

function variantOf(row: VariantRow): SyncedRow<Variant> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      fabricId: row.fabricId,
      colorName: row.colorName,
      lowStockThresholdCm: row.lowStockThresholdCm,
    },
  };
}

/** Colours are history since ADR 0012: read, never written. */
@Injectable()
export class VariantRepository implements SyncHandler<'variant'> {
  readonly entity = 'variant' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Variant> | undefined> {
    const [row] = await this.tx.db.select().from(schema.variant).where(eq(schema.variant.id, id));
    return row && variantOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Variant>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.variant)
      .where(gt(schema.variant.serverSeq, since))
      .orderBy(asc(schema.variant.serverSeq))
      .limit(limit);
    return rows.map(variantOf);
  }

  async listByFabric(fabricId: string, includeVoided: boolean): Promise<SyncedRow<Variant>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.variant)
      .where(
        and(
          eq(schema.variant.fabricId, fabricId),
          includeVoided ? undefined : isNull(schema.variant.voidedAt),
        ),
      )
      .orderBy(asc(schema.variant.colorName));
    return rows.map(variantOf);
  }
}

type ProductRow = typeof schema.product.$inferSelect;

function productOf(row: ProductRow): SyncedRow<Product> {
  const conversion =
    row.kgToMeterWeightG !== null && row.kgToMeterLengthCm !== null && row.kgToMeterSource !== null
      ? {
          weightG: row.kgToMeterWeightG,
          lengthCm: row.kgToMeterLengthCm,
          source: row.kgToMeterSource,
        }
      : null;
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      name: row.name,
      sku: row.sku,
      description: row.description,
      tags: row.tags,
      purchaseUnits: row.purchaseUnits,
      sellingUnits: row.sellingUnits,
      kgToMeterConversion: conversion,
      pricePerMeterCents: row.pricePerMeterCents,
      minPricePerMeterCents: row.minPricePerMeterCents,
      pricePerPieceCents: row.pricePerPieceCents,
      minPricePerPieceCents: row.minPricePerPieceCents,
      lowStockThreshold: row.lowStockThreshold,
      active: row.active,
    },
  };
}

@Injectable()
export class ProductRepository implements SyncHandler<'product'> {
  readonly entity = 'product' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Product> | undefined> {
    const [row] = await this.tx.db.select().from(schema.product).where(eq(schema.product.id, id));
    return row && productOf(row);
  }

  async write(record: Product): Promise<SyncedRow<Product>> {
    const conversion = record.kgToMeterConversion;
    const fields = {
      name: record.name,
      sku: record.sku,
      description: record.description,
      tags: record.tags,
      purchaseUnits: record.purchaseUnits,
      sellingUnits: record.sellingUnits,
      kgToMeterWeightG: conversion?.weightG ?? null,
      kgToMeterLengthCm: conversion?.lengthCm ?? null,
      kgToMeterSource: conversion?.source ?? null,
      pricePerMeterCents: record.pricePerMeterCents,
      minPricePerMeterCents: record.minPricePerMeterCents,
      pricePerPieceCents: record.pricePerPieceCents,
      minPricePerPieceCents: record.minPricePerPieceCents,
      lowStockThreshold: record.lowStockThreshold,
      active: record.active,
      ...writeColumns(record),
    };
    const [row] = await this.tx.db
      .insert(schema.product)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.product.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return productOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Product>> {
    const [row] = await this.tx.db
      .update(schema.product)
      .set({ voidedAt: at, updatedAt: at, deviceId, active: false })
      .where(eq(schema.product.id, id))
      .returning();
    if (!row) throw new Error(`no product ${id}`);
    return productOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Product>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.product)
      .where(gt(schema.product.serverSeq, since))
      .orderBy(asc(schema.product.serverSeq))
      .limit(limit);
    return rows.map(productOf);
  }

  async findMany(ids: readonly string[]): Promise<SyncedRow<Product>[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.product)
      .where(inArray(schema.product.id, [...ids]));
    return rows.map(productOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<Product>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.product)
      .where(includeVoided ? undefined : isNull(schema.product.voidedAt))
      .orderBy(asc(schema.product.name));
    return rows.map(productOf);
  }
}

type SupplierRow = typeof schema.supplier.$inferSelect;

function supplierOf(row: SupplierRow): SyncedRow<Supplier> {
  return {
    serverSeq: row.serverSeq,
    record: { ...baseOf(row), name: row.name, phone: row.phone, notes: row.notes },
  };
}

@Injectable()
export class SupplierRepository implements SyncHandler<'supplier'> {
  readonly entity = 'supplier' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Supplier> | undefined> {
    const [row] = await this.tx.db.select().from(schema.supplier).where(eq(schema.supplier.id, id));
    return row && supplierOf(row);
  }

  async write(record: Supplier): Promise<SyncedRow<Supplier>> {
    const fields = {
      name: record.name,
      phone: record.phone,
      notes: record.notes,
      ...writeColumns(record),
    };
    const [row] = await this.tx.db
      .insert(schema.supplier)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.supplier.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return supplierOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Supplier>> {
    const [row] = await this.tx.db
      .update(schema.supplier)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.supplier.id, id))
      .returning();
    if (!row) throw new Error(`no supplier ${id}`);
    return supplierOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Supplier>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.supplier)
      .where(gt(schema.supplier.serverSeq, since))
      .orderBy(asc(schema.supplier.serverSeq))
      .limit(limit);
    return rows.map(supplierOf);
  }

  async list(includeVoided: boolean): Promise<SyncedRow<Supplier>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.supplier)
      .where(includeVoided ? undefined : isNull(schema.supplier.voidedAt))
      .orderBy(asc(schema.supplier.name));
    return rows.map(supplierOf);
  }
}
