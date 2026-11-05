import type { DataExport, ProductUnit, RecordBase } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { schema, stockBackfillSql, TransactionHost } from '../../database/index.js';

/** Where each exported entity goes, in insertion order (EXPORT_ENTITIES). */
const TABLES = {
  setting: schema.setting,
  supplier: schema.supplier,
  fabric: schema.fabric,
  variant: schema.variant,
  product: schema.product,
  photo: schema.photo,
  purchase: schema.purchase,
  roll: schema.roll,
  stock_move: schema.stockMove,
  product_batch: schema.productBatch,
  product_stock_move: schema.productStockMove,
  supplier_payment: schema.supplierPayment,
  customer: schema.customer,
  sale: schema.sale,
  sale_line: schema.saleLine,
  payment: schema.payment,
  payment_allocation: schema.paymentAllocation,
  sale_void: schema.saleVoid,
  sale_return: schema.saleReturn,
  write_off: schema.writeOff,
  employee: schema.employee,
  employee_salary: schema.employeeSalary,
  recurring_expense: schema.recurringExpense,
  expense: schema.expense,
  cash_adjustment: schema.cashAdjustment,
  partner: schema.partner,
  profit_split_rule: schema.profitSplitRule,
  settlement: schema.settlement,
  settlement_share: schema.settlementShare,
  locked_cost: schema.lockedCost,
  capital_move: schema.capitalMove,
  zakat_report: schema.zakatReport,
  partner_draw: schema.partnerDraw,
  sync_conflict: schema.syncConflict,
} as const satisfies Record<keyof DataExport['records'], unknown>;

/** A record's timestamps as the database stores them; every other field keeps its name. */
function rowOf(record: RecordBase): Record<string, unknown> {
  const { createdAt, updatedAt, voidedAt, ...fields } = record;
  return {
    ...fields,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    voidedAt: voidedAt === null ? null : new Date(voidedAt),
  };
}

/** Data access for `make export` / `make import` (BUILD_PROMPTS 3.6). */
@Injectable()
export class DataRepository {
  constructor(private readonly tx: TransactionHost) {}

  async devices(): Promise<{ key: string; code: string }[]> {
    return this.tx.db
      .select({ key: schema.device.key, code: schema.device.code })
      .from(schema.device);
  }

  /** Rows of business data already there (an import only goes into an empty database). */
  async businessRows(): Promise<number> {
    let total = 0;
    for (const table of Object.values(TABLES)) {
      const [row] = await this.tx.db.select({ n: count() }).from(table);
      total += row?.n ?? 0;
    }
    return total;
  }

  async insert(entity: keyof DataExport['records'], records: readonly RecordBase[]): Promise<void> {
    const table = TABLES[entity];
    // Insert in chunks: a big shop has tens of thousands of moves.
    for (let start = 0; start < records.length; start += 500) {
      const chunk = records.slice(start, start + 500).map(rowOf);
      // The record's fields are the table's columns (the contract and the schema share names);
      // drizzle cannot type that link for a table picked at runtime.
      await this.tx.db.insert(table).values(chunk as never);
    }
  }

  /** Backfills old exports that predate Product after their legacy transactions have been loaded. */
  async backfillLegacyProducts(): Promise<number> {
    const [catalog, purchaseHistory] = await Promise.all([
      this.tx.db
        .select({ variant: schema.variant, fabric: schema.fabric })
        .from(schema.variant)
        .innerJoin(schema.fabric, eq(schema.variant.fabricId, schema.fabric.id)),
      this.tx.db
        .select({ variantId: schema.roll.variantId, unit: schema.purchase.method })
        .from(schema.roll)
        .innerJoin(schema.purchase, eq(schema.roll.purchaseId, schema.purchase.id)),
    ]);

    const unitsByVariant = new Map<string, Set<ProductUnit>>();
    for (const { variantId, unit } of purchaseHistory) {
      const units = unitsByVariant.get(variantId) ?? new Set<ProductUnit>();
      units.add(unit);
      unitsByVariant.set(variantId, units);
    }

    const products: (typeof schema.product.$inferInsert)[] = catalog.map(({ variant, fabric }) => ({
      id: variant.id,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
      deviceId: variant.deviceId,
      name: `${fabric.name} - ${variant.colorName}`,
      sku: null,
      description: fabric.notes,
      tags: fabric.tags,
      purchaseUnits: [...(unitsByVariant.get(variant.id) ?? [])].sort(),
      sellingUnits: fabric.sellableAsPiece ? ['meter', 'piece'] : ['meter'],
      kgToMeterWeightG: fabric.estCmPerKg === null ? null : 1000,
      kgToMeterLengthCm: fabric.estCmPerKg,
      kgToMeterSource: fabric.estCmPerKg === null ? null : ('estimated' as const),
      pricePerMeterCents: fabric.refPricePerMeterCents,
      minPricePerMeterCents: fabric.minPricePerMeterCents,
      pricePerPieceCents: fabric.sellableAsPiece ? fabric.piecePriceCents : null,
      minPricePerPieceCents: fabric.sellableAsPiece ? 0 : null,
      lowStockThreshold: variant.lowStockThresholdCm,
      active: variant.voidedAt === null && fabric.voidedAt === null,
    }));

    if (products.length === 0) return 0;
    const inserted = await this.tx.db
      .insert(schema.product)
      .values(products)
      .onConflictDoNothing({ target: schema.product.id })
      .returning({ id: schema.product.id });
    return inserted.length;
  }

  /**
   * Old exports have rolls and moves but no batches: carries them over with the SQL migration 0029
   * ran (it only adds what is missing) and checks that nothing was lost.
   */
  async backfillLegacyStock(): Promise<void> {
    const { backfill, reconcile } = await stockBackfillSql();
    for (const statement of backfill) await this.tx.db.execute(sql.raw(statement));
    await this.tx.db.execute(sql.raw(reconcile));
  }

  /** Devices with their codes; the code sequence continues after the highest one. */
  async insertDevices(
    devices: readonly { key: string; code: string }[],
    highest: number,
  ): Promise<void> {
    if (devices.length > 0) {
      await this.tx.db
        .insert(schema.device)
        .values(devices.map((device) => ({ ...device, deviceId: 'import' })));
    }
    if (highest > 0) await this.tx.db.execute(sql`SELECT setval('device_code_seq', ${highest})`);
  }

  /** A new epoch: devices pull everything again (ADR 0002, slice 6). */
  async newEpoch(): Promise<void> {
    await this.tx.db.insert(schema.serverInstance).values({ deviceId: 'import' });
  }
}
