import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saleLinesBackfillSql, stockBackfillSql } from '../src/database/index.js';
import { createTestApp, type TestApp } from './support/app.js';

/**
 * ADR 0012: sale lines move from rolls to batches in SQL (migration 0030). This puts the table
 * back to its pre-migration shape inside a transaction, seeds sales the way old versions wrote
 * them, runs the migration's own backfill statements and checks every line, the frozen costs,
 * the append-only guard and the failure path. Everything is rolled back at the end.
 */

const uuid = () => crypto.randomUUID();

type Run = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<pg.QueryResult<R>>;

interface LineRow {
  id: string;
  sale_id: string;
  line_total_cents: string;
  whole_piece: boolean;
  server_seq: string;
  roll_id: string | null;
  sold_cm: number | null;
  batch_id: string;
  unit: string;
  quantity: number;
  ref_price_cents: string;
  min_price_cents: string;
  actual_price_cents: string;
  actual_price_per_m_cents: string | null;
  min_override_by: string | null;
}
const NEW_COLUMNS = [
  'batch_id',
  'unit',
  'quantity',
  'ref_price_cents',
  'min_price_cents',
  'actual_price_cents',
];

describe('the sale lines backfill (migration 0030)', () => {
  let t: TestApp;
  let client: pg.PoolClient;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  /** A transaction where sale_line is as it was before 0030, rolled back after the test. */
  async function inLegacyShape(test: (run: Run) => Promise<void>) {
    client = await t.sql.connect();
    try {
      await client.query('BEGIN');
      // Before 0030 a line had no batch column, and so no foreign key to one.
      await client.query(
        `ALTER TABLE sale_line DROP CONSTRAINT sale_line_batch_id_product_batch_id_fk`,
      );
      for (const column of NEW_COLUMNS) {
        await client.query(`ALTER TABLE sale_line ALTER COLUMN ${column} DROP NOT NULL`);
      }
      await test((sql, params) => client.query(sql, params));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function seed(run: Run) {
    const fabricId = uuid();
    await run(
      `INSERT INTO fabric (id, device_id, name, ref_price_per_m_cents, min_price_per_m_cents, tags)
       VALUES ($1, 'legacy', 'Rosa', 2000, 1700, ARRAY[]::text[])`,
      [fabricId],
    );
    const variantId = uuid();
    await run(
      `INSERT INTO variant (id, device_id, fabric_id, color_name, low_stock_threshold_cm)
       VALUES ($1, 'legacy', $2, 'Red', 0)`,
      [variantId, fabricId],
    );
    const rollOf = async (lengthCm: number, costCents: number, code: string) => {
      const purchaseId = uuid();
      const rollId = uuid();
      await run(
        `INSERT INTO purchase (id, device_id, date, method, total_cost_cents, paid_cents)
         VALUES ($1, 'legacy', '2026-10-01', 'meter', $2, $2)`,
        [purchaseId, costCents],
      );
      await run(
        `INSERT INTO roll (id, device_id, short_code, variant_id, purchase_id, length_cm_initial,
            cost_total_cents, length_estimated, status)
         VALUES ($1, 'legacy', $2, $3, $4, $5, $6, false, 'active')`,
        [rollId, code, variantId, purchaseId, lengthCm, costCents],
      );
      await run(
        `INSERT INTO stock_move (id, device_id, roll_id, type, delta_cm, ref_id, date)
         VALUES ($1, 'legacy', $2, 'purchase', $3, $4, '2026-10-01')`,
        [uuid(), rollId, lengthCm, purchaseId],
      );
      return rollId;
    };
    const saleOf = async (
      rollId: string,
      soldCm: number,
      pricePerMeter: number,
      wholePiece = false,
    ) => {
      const saleId = uuid();
      const lineId = uuid();
      const moveId = uuid();
      const total = Math.round((pricePerMeter * soldCm) / 100);
      await run(
        `INSERT INTO sale (id, device_id, date, total_cents, discount_cents, confirmed_below_cost)
         VALUES ($1, 'legacy', '2026-10-05', $2, 0, false)`,
        [saleId, total],
      );
      await run(
        `INSERT INTO sale_line (id, device_id, sale_id, roll_id, sold_cm, ref_price_per_m_cents,
            min_price_per_m_cents, actual_price_per_m_cents, whole_piece, line_total_cents)
         VALUES ($1, 'legacy', $2, $3, $4, 2000, 1700, $5, $6, $7)`,
        [lineId, saleId, rollId, soldCm, pricePerMeter, wholePiece, total],
      );
      await run(
        `INSERT INTO stock_move (id, device_id, roll_id, type, delta_cm, ref_id, date)
         VALUES ($1, 'legacy', $2, 'sale', $3, $4, '2026-10-05')`,
        [moveId, rollId, -soldCm, lineId],
      );
      return { saleId, lineId, moveId, total };
    };

    const metres = await rollOf(5000, 80_000, 'R-T0001');
    const piece = await rollOf(230, 10_000, 'R-T0002');
    const first = await saleOf(metres, 275, 1800);
    const second = await saleOf(metres, 100, 1500); // under the old minimum: history stays as it was
    const whole = await saleOf(piece, 230, 5217, true);

    // A settlement froze the cost of the first sale's move (P9).
    const settlementId = uuid();
    await run(
      `INSERT INTO settlement (id, device_id, period_start, period_end, recognized_profit_cents,
          recovered_bad_debt_cents, damage_cents, bad_debt_cents, below_cost_cents, expenses_cents,
          cash_over_short_cents, carried_deficit_in_cents, net_profit_cents, owner_share_cents,
          partner_share_cents, shop_share_cents, carry_deficit_out_cents, owner_weight,
          partner_weight, shop_weight, locked_at)
       VALUES ($1, 'legacy', '2026-10-01', '2026-10-31', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          1, 1, 1, now())`,
      [settlementId],
    );
    return { metres, piece, first, second, whole, settlementId };
  }

  it('gives every legacy line its batch, unit, quantity and prices, and changes nothing else', async () => {
    await inLegacyShape(async (run) => {
      const ids = await seed(run);
      // The stock first (migration 0029 ran on a database with no rolls; this is the import path).
      const stock = await stockBackfillSql();
      for (const statement of stock.backfill) await run(statement);
      await run(
        `INSERT INTO locked_cost (id, device_id, settlement_id, stock_move_id, cost_cents)
         VALUES ($1, 'legacy', $2, $3, 4400)`,
        [uuid(), ids.settlementId, ids.first.moveId],
      );
      const before = (
        await run<LineRow>(
          `SELECT id, sale_id, line_total_cents, whole_piece, server_seq, roll_id, sold_cm
           FROM sale_line ORDER BY id`,
        )
      ).rows;

      const { backfill, reconcile } = await saleLinesBackfillSql();
      for (const statement of backfill) await run(statement);
      await run(reconcile);

      const lines = (await run<LineRow>(`SELECT * FROM sale_line ORDER BY sold_cm`)).rows;
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(line).toMatchObject({
          batch_id: line.roll_id,
          unit: 'meter',
          quantity: line.sold_cm,
          ref_price_cents: '2000',
          min_price_cents: '1700',
          actual_price_cents: line.actual_price_per_m_cents,
          min_override_by: null,
        });
      }
      expect(lines.map((line) => line.batch_id)).toEqual([ids.metres, ids.piece, ids.metres]);
      expect(lines.map((line) => line.whole_piece)).toEqual([false, true, false]);

      // Nothing the line already said was touched: same rows, same server_seq (no re-sync).
      const after = (
        await run<LineRow>(
          `SELECT id, sale_id, line_total_cents, whole_piece, server_seq, roll_id, sold_cm
           FROM sale_line ORDER BY id`,
        )
      ).rows;
      expect(after).toEqual(before);

      // The batches those lines point at are the rolls' batches, and the frozen cost kept its move.
      const orphans = await run<{ n: number }>(
        `SELECT count(*)::int AS n FROM sale_line l
         WHERE NOT EXISTS (SELECT 1 FROM product_batch b WHERE b.id = l.batch_id)`,
      );
      expect(orphans.rows[0]).toEqual({ n: 0 });
      const frozen = await run<{ batch_id: string; type: string }>(
        `SELECT m.batch_id, m.type FROM locked_cost c
         JOIN product_stock_move m ON m.id = c.stock_move_id`,
      );
      expect(frozen.rows).toEqual([{ batch_id: ids.metres, type: 'sale' }]);
    });
  });

  it('is idempotent, and leaves the append-only guard on', async () => {
    await inLegacyShape(async (run) => {
      const ids = await seed(run);
      for (const statement of (await stockBackfillSql()).backfill) await run(statement);
      const { backfill, reconcile } = await saleLinesBackfillSql();
      for (const statement of backfill) await run(statement);
      const once = (await run<LineRow>(`SELECT * FROM sale_line ORDER BY id`)).rows;
      for (const statement of backfill) await run(statement);
      await run(reconcile);
      expect((await run<LineRow>(`SELECT * FROM sale_line ORDER BY id`)).rows).toEqual(once);

      const guard = await run<{ tgenabled: string }>(
        `SELECT tgenabled FROM pg_trigger
         WHERE tgrelid = 'sale_line'::regclass AND tgname = 'row_guard_append_only'`,
      );
      expect(guard.rows).toEqual([{ tgenabled: 'O' }]);
      // A sale line is still append-only: the guard refuses an update after the migration.
      await run('SAVEPOINT guard');
      await expect(
        run(`UPDATE sale_line SET quantity = 1 WHERE id = $1`, [ids.first.lineId]),
      ).rejects.toThrow(/append-only/);
      await run('ROLLBACK TO SAVEPOINT guard');
    });
  });

  it('aborts when a line has no batch, and leaves nothing half-done', async () => {
    await inLegacyShape(async (run) => {
      await seed(run);
      // The stock backfill did not run: no roll has a batch, so no line can point at one.
      const { backfill, reconcile } = await saleLinesBackfillSql();
      await run('SAVEPOINT backfill');
      for (const statement of backfill) await run(statement);
      await expect(run(reconcile)).rejects.toThrow(/have no batch/);
      await run('ROLLBACK TO SAVEPOINT backfill');
      const unfilled = await run<{ n: number }>(
        `SELECT count(*)::int AS n FROM sale_line WHERE batch_id IS NULL`,
      );
      expect(unfilled.rows[0]).toEqual({ n: 3 });
    });
  });
});
