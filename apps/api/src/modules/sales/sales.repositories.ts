import type { Sale, SaleLine, SaleVoid } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow } from '../sync/index.js';

type SaleRow = typeof schema.sale.$inferSelect;

function saleOf(row: SaleRow): SyncedRow<Sale> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      date: row.date,
      customerId: row.customerId,
      totalCents: row.totalCents,
      discountCents: row.discountCents,
      dueDate: row.dueDate,
      confirmedBelowCost: row.confirmedBelowCost,
      note: row.note,
    },
  };
}

/** Sales: inserted with their op; afterwards only voidedAt is set, by their sale_void. */
@Injectable()
export class SaleRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Sale> | undefined> {
    const [row] = await this.tx.db.select().from(schema.sale).where(eq(schema.sale.id, id));
    return row && saleOf(row);
  }

  async insert(sale: Sale): Promise<SyncedRow<Sale>> {
    const [row] = await this.tx.db
      .insert(schema.sale)
      .values({
        ...baseValues(sale),
        date: sale.date,
        customerId: sale.customerId,
        totalCents: sale.totalCents,
        discountCents: sale.discountCents,
        dueDate: sale.dueDate,
        confirmedBelowCost: sale.confirmedBelowCost,
        note: sale.note,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return saleOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Sale>> {
    const [row] = await this.tx.db
      .update(schema.sale)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.sale.id, id))
      .returning();
    if (!row) throw new Error(`no sale ${id}`);
    return saleOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<Sale>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.sale)
      .where(gt(schema.sale.serverSeq, since))
      .orderBy(asc(schema.sale.serverSeq))
      .limit(limit);
    return rows.map(saleOf);
  }

  async findMany(ids: readonly string[]): Promise<SyncedRow<Sale>[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.sale)
      .where(inArray(schema.sale.id, [...ids]));
    return rows.map(saleOf);
  }

  async listByCustomer(customerId: string): Promise<SyncedRow<Sale>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.sale)
      .where(eq(schema.sale.customerId, customerId))
      .orderBy(asc(schema.sale.date), asc(schema.sale.createdAt));
    return rows.map(saleOf);
  }

  async list(limit: number): Promise<SyncedRow<Sale>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.sale)
      .orderBy(desc(schema.sale.date), desc(schema.sale.createdAt))
      .limit(limit);
    return rows.map(saleOf);
  }
}

type LineRow = typeof schema.saleLine.$inferSelect;

function lineOf(row: LineRow): SyncedRow<SaleLine> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      saleId: row.saleId,
      rollId: row.rollId,
      soldCm: row.soldCm,
      refPricePerMeterCents: row.refPricePerMeterCents,
      minPricePerMeterCents: row.minPricePerMeterCents,
      actualPricePerMeterCents: row.actualPricePerMeterCents,
      wholePiece: row.wholePiece,
      lineTotalCents: row.lineTotalCents,
    },
  };
}

/** Append-only (row guards). */
@Injectable()
export class SaleLineRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<SaleLine> | undefined> {
    const [row] = await this.tx.db.select().from(schema.saleLine).where(eq(schema.saleLine.id, id));
    return row && lineOf(row);
  }

  async insertMany(lines: readonly SaleLine[]): Promise<void> {
    await this.tx.db.insert(schema.saleLine).values(
      lines.map((line) => ({
        ...baseValues(line),
        saleId: line.saleId,
        rollId: line.rollId,
        soldCm: line.soldCm,
        refPricePerMeterCents: line.refPricePerMeterCents,
        minPricePerMeterCents: line.minPricePerMeterCents,
        actualPricePerMeterCents: line.actualPricePerMeterCents,
        wholePiece: line.wholePiece,
        lineTotalCents: line.lineTotalCents,
      })),
    );
  }

  /** In the order they were entered (createdAt is shared; ids follow the build order). */
  async listBySale(saleId: string): Promise<SyncedRow<SaleLine>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.saleLine)
      .where(eq(schema.saleLine.saleId, saleId))
      .orderBy(asc(schema.saleLine.serverSeq));
    return rows.map(lineOf);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<SaleLine>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.saleLine)
      .where(gt(schema.saleLine.serverSeq, since))
      .orderBy(asc(schema.saleLine.serverSeq))
      .limit(limit);
    return rows.map(lineOf);
  }
}

type VoidRow = typeof schema.saleVoid.$inferSelect;

function voidOf(row: VoidRow): SyncedRow<SaleVoid> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      saleId: row.saleId,
      date: row.date,
      reason: row.reason,
      refundId: row.refundId,
    },
  };
}

/** Append-only (row guards); one per sale (unique sale_id). */
@Injectable()
export class SaleVoidRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<SaleVoid> | undefined> {
    const [row] = await this.tx.db.select().from(schema.saleVoid).where(eq(schema.saleVoid.id, id));
    return row && voidOf(row);
  }

  async findBySale(saleId: string): Promise<SyncedRow<SaleVoid> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.saleVoid)
      .where(eq(schema.saleVoid.saleId, saleId));
    return row && voidOf(row);
  }

  async insert(saleVoid: SaleVoid): Promise<SyncedRow<SaleVoid>> {
    const [row] = await this.tx.db
      .insert(schema.saleVoid)
      .values({
        ...baseValues(saleVoid),
        saleId: saleVoid.saleId,
        date: saleVoid.date,
        reason: saleVoid.reason,
        refundId: saleVoid.refundId,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return voidOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<SaleVoid>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.saleVoid)
      .where(gt(schema.saleVoid.serverSeq, since))
      .orderBy(asc(schema.saleVoid.serverSeq))
      .limit(limit);
    return rows.map(voidOf);
  }
}
