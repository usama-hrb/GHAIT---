import {
  batchLedgerOf,
  coreBatchOf,
  coreMovesOf,
  legacyRollAsProductBatch,
  type ProductBatch,
  type ProductStockMove,
  type Roll,
  rollLedgerOf,
  type SequencedMove,
  type StockMove,
} from '@fabric/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stockBackfillSql } from '../src/database/index.js';
import { createTestApp, type TestApp } from './support/app.js';

/**
 * ADR 0012: the stock moves from rolls to product batches in SQL (migration 0029). This runs that
 * migration's own statements on legacy data of every kind and holds the result to the roll ledger
 * (the legacy truth) and to the TypeScript mapping the product screens were tested against.
 */

const statements = stockBackfillSql;

const uuid = () => crypto.randomUUID();

interface BaseRow {
  id: string;
  created_at: Date;
  updated_at: Date;
  device_id: string;
  server_seq: string;
}
interface RollRow extends BaseRow {
  short_code: string;
  variant_id: string;
  purchase_id: string;
  length_cm_initial: number;
  cost_total_cents: string;
  length_estimated: boolean;
  status: Roll['status'];
}
interface StockMoveRow extends BaseRow {
  roll_id: string;
  type: StockMove['type'];
  delta_cm: number;
  ref_id: string | null;
  day: string;
  note: string | null;
}
interface BatchRow extends BaseRow {
  code: string;
  product_id: string;
  purchase_id: string;
  day: string;
  unit: ProductBatch['unit'];
  received_quantity: string;
  cost_total_cents: string;
  conversion_weight_g: number | null;
  conversion_length_cm: number | null;
  conversion_source: 'estimated' | 'measured' | null;
  status: ProductBatch['status'];
}
interface BatchMoveRow extends BaseRow {
  batch_id: string;
  type: ProductStockMove['type'];
  unit: ProductStockMove['unit'];
  delta: string;
  ref_id: string | null;
  day: string;
  note: string | null;
  actor: string | null;
}
interface ProductRow {
  id: string;
  name: string;
  price: number | null;
  min: number | null;
  piece: number | null;
  min_piece: number | null;
  threshold: number | null;
  selling: string;
}
interface Counts {
  b: number;
  m: number;
  p: number;
}

describe('the stock backfill (migration 0029)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const run = async <R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => t.sql.query<R>(sql, params);

  async function fabric(name: string, sellableAsPiece = false) {
    const id = uuid();
    await run(
      `INSERT INTO fabric (id, device_id, name, ref_price_per_m_cents, min_price_per_m_cents,
          est_cm_per_kg, sellable_as_piece, piece_price_cents, tags)
       VALUES ($1, 'legacy', $2, 2000, 1800, 400, $3, $4, ARRAY['summer'])`,
      [id, name, sellableAsPiece, sellableAsPiece ? 9000 : null],
    );
    return id;
  }
  async function variant(fabricId: string, color: string, threshold = 700) {
    const id = uuid();
    await run(
      `INSERT INTO variant (id, device_id, fabric_id, color_name, low_stock_threshold_cm)
       VALUES ($1, 'legacy', $2, $3, $4)`,
      [id, fabricId, color, threshold],
    );
    return id;
  }
  async function roll(args: {
    variantId: string;
    code: string;
    method: 'meter' | 'piece' | 'kg';
    lengthCm: number;
    costCents: number;
    weightG?: number;
    estimated?: boolean;
  }) {
    const purchaseId = uuid();
    const rollId = uuid();
    await run(
      `INSERT INTO purchase (id, device_id, date, method, weight_g, est_cm_per_kg, total_cost_cents, paid_cents)
       VALUES ($1, 'legacy', '2026-10-01', $2, $3, $4, $5, $5)`,
      [purchaseId, args.method, args.weightG ?? null, args.weightG ? 400 : null, args.costCents],
    );
    await run(
      `INSERT INTO roll (id, device_id, short_code, variant_id, purchase_id, length_cm_initial,
          cost_total_cents, length_estimated, status)
       VALUES ($1, 'legacy', $2, $3, $4, $5, $6, $7, 'active')`,
      [
        rollId,
        args.code,
        args.variantId,
        purchaseId,
        args.lengthCm,
        args.costCents,
        args.estimated ?? false,
      ],
    );
    const move = async (type: string, deltaCm: number, refId: string | null = null) => {
      const id = uuid();
      await run(
        `INSERT INTO stock_move (id, device_id, roll_id, type, delta_cm, ref_id, date, note)
         VALUES ($1, 'legacy', $2, $3, $4, $5, '2026-10-02', $6)`,
        [id, rollId, type, deltaCm, refId, ['loss', 'adjustment'].includes(type) ? 'reason' : null],
      );
      return id;
    };
    await move('purchase', args.lengthCm, purchaseId);
    return { rollId, purchaseId, move };
  }

  async function seed() {
    const rosa = await fabric('Rosa');
    const crepe = await fabric('Crepe', true);
    const red = await variant(rosa, 'Red');
    const blue = await variant(rosa, 'Blue');
    const crepeRed = await variant(crepe, 'Red', 300);

    // A metre roll with a sale, a loss, a return of part of the sale, and a count.
    const metres = await roll({
      variantId: red,
      code: 'R-T0001',
      method: 'meter',
      lengthCm: 5000,
      costCents: 80_000,
    });
    const sale = await metres.move('sale', -275, uuid());
    await metres.move('loss', -30);
    await metres.move('return', 75, sale);
    await metres.move('adjustment', -20);

    // A ready piece sold whole.
    const piece = await roll({
      variantId: crepeRed,
      code: 'R-T0002',
      method: 'piece',
      lengthCm: 230,
      costCents: 10_000,
    });
    await piece.move('sale', -230, uuid());

    // Bought by weight: an estimated length, a sale, then two measurements and another sale.
    const kg = await roll({
      variantId: blue,
      code: 'R-T0003',
      method: 'kg',
      lengthCm: 8000,
      costCents: 40_000,
      weightG: 20_000,
      estimated: true,
    });
    await kg.move('sale', -1000, uuid());
    await kg.move('length_correction', -400);
    await kg.move('sale', -500, uuid());
    await kg.move('length_correction', 150);

    // A voided sale, and a roll sold beyond its length.
    const voided = await roll({
      variantId: blue,
      code: 'R-T0004',
      method: 'meter',
      lengthCm: 1000,
      costCents: 9_000,
    });
    const voidedSale = await voided.move('sale', -300, uuid());
    await voided.move('reversal', 300, voidedSale);
    await voided.move('sale', -1200, uuid());

    // A colour made after the Product migration: it has no product yet, and a picture.
    const late = await variant(rosa, 'Late');
    await roll({
      variantId: late,
      code: 'R-T0005',
      method: 'meter',
      lengthCm: 2000,
      costCents: 20_000,
    });
    await run(
      `INSERT INTO photo (id, device_id, variant_id, content_type, width, height, byte_length, data)
       VALUES ($1, 'legacy', $2, 'image/jpeg', 10, 10, 4, '/9j/AAA=')`,
      [uuid(), late],
    );
    return { red, blue, late, crepeRed };
  }

  it('turns every roll into a batch and every move into a move, and agrees with the roll ledger', async () => {
    const ids = await seed();
    const { backfill, reconcile } = await statements();
    for (const statement of backfill) await run(statement);
    await run(reconcile);

    const rolls = (await run<RollRow>(`SELECT * FROM roll ORDER BY short_code`)).rows;
    expect(rolls).toHaveLength(5);

    for (const row of rolls) {
      const legacyRoll: Roll = {
        id: row.id,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        deviceId: row.device_id,
        voidedAt: null,
        shortCode: row.short_code,
        variantId: row.variant_id,
        purchaseId: row.purchase_id,
        lengthCmInitial: row.length_cm_initial,
        costTotalCents: Number(row.cost_total_cents),
        lengthEstimated: row.length_estimated,
        status: row.status,
      };
      const purchase = (
        await run<{ method: 'kg' | 'meter' | 'piece'; weight_g: number | null; date: string }>(
          `SELECT method, weight_g, date::text AS date FROM purchase WHERE id = $1`,
          [row.purchase_id],
        )
      ).rows[0];
      if (!purchase) throw new Error('a roll has a purchase');
      const legacyMoves: SequencedMove[] = (
        await run<StockMoveRow>(
          `SELECT *, date::text AS day FROM stock_move WHERE roll_id = $1 ORDER BY server_seq`,
          [row.id],
        )
      ).rows.map((move): StockMove & { serverSeq: number } => ({
        id: move.id,
        createdAt: move.created_at.toISOString(),
        updatedAt: move.updated_at.toISOString(),
        deviceId: move.device_id,
        voidedAt: null,
        rollId: move.roll_id,
        type: move.type,
        deltaCm: move.delta_cm,
        refId: move.ref_id,
        date: move.day,
        note: move.note,
        serverSeq: Number(move.server_seq),
      }));

      const batchRow = (
        await run<BatchRow>(
          `SELECT *, purchase_date::text AS day FROM product_batch WHERE id = $1`,
          [row.id],
        )
      ).rows[0];
      if (!batchRow) throw new Error('a roll has a batch');
      const batch: ProductBatch = {
        id: batchRow.id,
        createdAt: batchRow.created_at.toISOString(),
        updatedAt: batchRow.updated_at.toISOString(),
        deviceId: batchRow.device_id,
        voidedAt: null,
        code: batchRow.code,
        productId: batchRow.product_id,
        purchaseId: batchRow.purchase_id,
        purchaseDate: batchRow.day,
        unit: batchRow.unit,
        receivedQuantity: Number(batchRow.received_quantity),
        costTotalCents: Number(batchRow.cost_total_cents),
        conversion:
          batchRow.conversion_weight_g === null ||
          batchRow.conversion_length_cm === null ||
          batchRow.conversion_source === null
            ? null
            : {
                weightG: batchRow.conversion_weight_g,
                lengthCm: batchRow.conversion_length_cm,
                source: batchRow.conversion_source,
              },
        status: batchRow.status,
      };
      const batchMoves: (ProductStockMove & { serverSeq: number })[] = (
        await run<BatchMoveRow>(
          `SELECT *, date::text AS day FROM product_stock_move WHERE batch_id = $1 ORDER BY server_seq`,
          [row.id],
        )
      ).rows.map((move) => ({
        id: move.id,
        createdAt: move.created_at.toISOString(),
        updatedAt: move.updated_at.toISOString(),
        deviceId: move.device_id,
        voidedAt: null,
        batchId: move.batch_id,
        type: move.type,
        unit: move.unit,
        delta: Number(move.delta),
        refId: move.ref_id,
        date: move.day,
        note: move.note,
        actor: move.actor,
        serverSeq: Number(move.server_seq),
      }));

      // 1. The SQL makes what the TypeScript mapping makes.
      const bridge = legacyRollAsProductBatch(
        legacyRoll,
        { method: purchase.method, date: purchase.date, weightG: purchase.weight_g },
        legacyMoves,
      );
      expect(JSON.parse(JSON.stringify(coreBatchOf(batch)))).toEqual(
        JSON.parse(JSON.stringify(bridge.batch)),
      );
      expect(JSON.parse(JSON.stringify(coreMovesOf(batchMoves)))).toEqual(
        JSON.parse(JSON.stringify(bridge.movements)),
      );

      // 2. And what the roll ledger says about the roll, the batch ledger says too.
      const legacy = rollLedgerOf(legacyRoll, legacyMoves);
      const ledger = batchLedgerOf(batch, batchMoves);
      const meters = ledger.available.meter;
      expect(meters?.unit === 'meter' ? meters.centimeters : undefined).toBe(legacy.remainingCm);
      expect(ledger.unallocatedCostCents).toBe(legacy.unallocatedCostCents);
      expect(ledger.costPerUnitCents.meter).toBe(legacy.costPerMeterCents);
      expect(ledger.measurementStatus === 'estimated').toBe(legacy.lengthEstimated);
      const net = new Map(ledger.costs.map(({ moveId, costCents }) => [moveId, costCents]));
      for (const back of ledger.returns) {
        net.set(back.saleMoveId, (net.get(back.saleMoveId) ?? 0) - back.costCents);
      }
      expect([...net].map(([id, costCents]) => ({ id, costCents }))).toEqual(legacy.costs);
    }

    // The colour made after the Product migration has its product, prices and picture.
    const products = (
      await run<ProductRow>(
        `SELECT id, name, price_per_m_cents::int AS price, min_price_per_m_cents::int AS min,
          price_per_piece_cents::int AS piece, min_price_per_piece_cents::int AS min_piece,
          low_stock_threshold AS threshold, selling_units::text AS selling
       FROM product WHERE id = ANY($1::uuid[]) ORDER BY name`,
        [[ids.red, ids.blue, ids.late, ids.crepeRed]],
      )
    ).rows;
    expect(products).toEqual([
      {
        id: ids.crepeRed,
        name: 'Crepe - Red',
        price: 2000,
        min: 1800,
        piece: 9000,
        min_piece: 0,
        threshold: 300,
        selling: '{meter,piece}',
      },
      {
        id: ids.blue,
        name: 'Rosa - Blue',
        price: 2000,
        min: 1800,
        piece: null,
        min_piece: null,
        threshold: 700,
        selling: '{meter}',
      },
      {
        id: ids.late,
        name: 'Rosa - Late',
        price: 2000,
        min: 1800,
        piece: null,
        min_piece: null,
        threshold: 700,
        selling: '{meter}',
      },
      {
        id: ids.red,
        name: 'Rosa - Red',
        price: 2000,
        min: 1800,
        piece: null,
        min_piece: null,
        threshold: 700,
        selling: '{meter}',
      },
    ]);
    const photo = (
      await run<{ product_id: string }>(`SELECT product_id FROM photo WHERE variant_id = $1`, [
        ids.late,
      ])
    ).rows[0];
    expect(photo?.product_id).toBe(ids.late);

    // The old tables are untouched.
    const count = async (table: string) =>
      (await run<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n;
    expect(await count('roll')).toBe(5);
    expect(await count('stock_move')).toBe(await count('product_stock_move'));
  });

  it('is idempotent: running it again changes nothing', async () => {
    const before = (
      await run<Counts>(
        `SELECT (SELECT count(*) FROM product_batch)::int AS b, (SELECT count(*) FROM product_stock_move)::int AS m, (SELECT count(*) FROM product)::int AS p`,
      )
    ).rows[0];
    const { backfill, reconcile } = await statements();
    for (const statement of backfill) await run(statement);
    await run(reconcile);
    const after = (
      await run<Counts>(
        `SELECT (SELECT count(*) FROM product_batch)::int AS b, (SELECT count(*) FROM product_stock_move)::int AS m, (SELECT count(*) FROM product)::int AS p`,
      )
    ).rows[0];
    expect(after).toEqual(before);
  });

  it('refuses to finish when a roll was not carried over', async () => {
    const variantId =
      (await run<{ id: string }>(`SELECT id FROM variant LIMIT 1`)).rows[0]?.id ?? '';
    await roll({ variantId, code: 'R-T0099', method: 'meter', lengthCm: 100, costCents: 100 });
    const { reconcile } = await statements();
    await expect(run(reconcile)).rejects.toThrow('stock backfill');
  });

  it('gives a roll without a purchase move its receipt, so its ledger can be read', async () => {
    const variantId =
      (await run<{ id: string }>(`SELECT id FROM variant LIMIT 1`)).rows[0]?.id ?? '';
    const purchaseId = uuid();
    const rollId = uuid();
    await run(
      `INSERT INTO purchase (id, device_id, date, method, total_cost_cents, paid_cents)
       VALUES ($1, 'legacy', '2026-10-05', 'meter', 500, 500)`,
      [purchaseId],
    );
    await run(
      `INSERT INTO roll (id, device_id, short_code, variant_id, purchase_id, length_cm_initial,
          cost_total_cents, length_estimated, status)
       VALUES ($1, 'legacy', 'R-T0100', $2, $3, 400, 500, false, 'active')`,
      [rollId, variantId, purchaseId],
    );
    const { backfill } = await statements();
    for (const statement of backfill) await run(statement);
    const receipt = (
      await run<{ type: string; unit: string; delta: number }>(
        `SELECT type, unit, delta::int AS delta FROM product_stock_move WHERE batch_id = $1`,
        [rollId],
      )
    ).rows;
    expect(receipt).toEqual([{ type: 'purchase', unit: 'meter', delta: 400 }]);
  });
});
