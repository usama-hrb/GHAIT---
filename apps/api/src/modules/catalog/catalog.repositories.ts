import type { Fabric, Supplier, Variant } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
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

function fabricFields(record: Fabric) {
  return {
    name: record.name,
    type: record.type,
    defaultSupplierId: record.defaultSupplierId,
    refPricePerMeterCents: record.refPricePerMeterCents,
    minPricePerMeterCents: record.minPricePerMeterCents,
    estCmPerKg: record.estCmPerKg,
    sellableAsPiece: record.sellableAsPiece,
    piecePriceCents: record.piecePriceCents,
    tags: record.tags,
    notes: record.notes,
  };
}

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

@Injectable()
export class FabricRepository implements SyncHandler<'fabric'> {
  readonly entity = 'fabric' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Fabric> | undefined> {
    const [row] = await this.tx.db.select().from(schema.fabric).where(eq(schema.fabric.id, id));
    return row && fabricOf(row);
  }

  async write(record: Fabric): Promise<SyncedRow<Fabric>> {
    const fields = { ...fabricFields(record), ...writeColumns(record) };
    const [row] = await this.tx.db
      .insert(schema.fabric)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.fabric.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return fabricOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Fabric>> {
    const [row] = await this.tx.db
      .update(schema.fabric)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.fabric.id, id))
      .returning();
    if (!row) throw new Error(`no fabric ${id}`);
    return fabricOf(row);
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

@Injectable()
export class VariantRepository implements SyncHandler<'variant'> {
  readonly entity = 'variant' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Variant> | undefined> {
    const [row] = await this.tx.db.select().from(schema.variant).where(eq(schema.variant.id, id));
    return row && variantOf(row);
  }

  async write(record: Variant): Promise<SyncedRow<Variant>> {
    const fields = {
      fabricId: record.fabricId,
      colorName: record.colorName,
      lowStockThresholdCm: record.lowStockThresholdCm,
      ...writeColumns(record),
    };
    const [row] = await this.tx.db
      .insert(schema.variant)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.variant.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return variantOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Variant>> {
    const [row] = await this.tx.db
      .update(schema.variant)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.variant.id, id))
      .returning();
    if (!row) throw new Error(`no variant ${id}`);
    return variantOf(row);
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
