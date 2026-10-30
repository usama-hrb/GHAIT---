import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app.js';

const APPEND_ONLY = new Set([
  'audit_log',
  'payment',
  'payment_allocation',
  'sale_line',
  'sale_void',
  'server_instance',
  'stock_move',
  'sync_conflict',
  'sync_op',
  'write_off',
]);
const BASE_COLUMNS = ['id', 'created_at', 'updated_at', 'device_id', 'voided_at', 'server_seq'];

describe('database rules (CLAUDE.md "Data rules")', () => {
  let t: TestApp;
  let tables: string[];

  beforeAll(async () => {
    t = await createTestApp();
    const { rows } = await t.sql.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    tables = rows.map((row) => row.table_name);
  });

  afterAll(async () => {
    await t.close();
  });

  it('finds the tables so far', () => {
    expect(tables).toEqual([
      'app_user',
      'audit_log',
      'auth_session',
      'customer',
      'device',
      'fabric',
      'payment',
      'payment_allocation',
      'purchase',
      'roll',
      'sale',
      'sale_line',
      'sale_void',
      'server_instance',
      'setting',
      'stock_move',
      'supplier',
      'sync_conflict',
      'sync_op',
      'variant',
      'write_off',
    ]);
  });

  it('gives every table the base columns', async () => {
    for (const table of tables) {
      const { rows } = await t.sql.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      expect(
        rows.map((row) => row.column_name),
        table,
      ).toEqual(expect.arrayContaining(BASE_COLUMNS));
    }
  });

  it('installs the row guards on every table', async () => {
    for (const table of tables) {
      const { rows } = await t.sql.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
        [table],
      );
      const expected = ['row_guard_no_delete', 'row_guard_no_truncate', 'row_guard_server_seq'];
      if (APPEND_ONLY.has(table)) expected.unshift('row_guard_append_only');
      expect(
        rows.map((row) => row.tgname),
        table,
      ).toEqual(expected);
    }
  });

  it('never deletes: DELETE and TRUNCATE are refused on every table', async () => {
    for (const table of tables) {
      await expect(t.sql.query(`DELETE FROM ${table}`), table).rejects.toThrow(
        `${table} is never deleted: set voided_at instead`,
      );
      await expect(t.sql.query(`TRUNCATE ${table} CASCADE`), table).rejects.toThrow(
        /is never deleted/,
      );
    }
  });

  it('keeps audit_log append-only', async () => {
    await expect(t.sql.query(`UPDATE audit_log SET reason = 'edited'`)).rejects.toThrow(
      'audit_log is append-only: write a compensating row instead',
    );
  });

  it('gives each insert and update a new, higher server_seq; a client cannot choose it', async () => {
    const insert = await t.sql.query<{ id: string; server_seq: string }>(
      `INSERT INTO setting (key, value, device_id, server_seq) VALUES ('probe', '1', 'server', 1)
       RETURNING id, server_seq`,
    );
    const inserted = insert.rows[0];
    expect(Number(inserted?.server_seq)).toBeGreaterThan(1);
    const update = await t.sql.query<{ server_seq: string }>(
      `UPDATE setting SET value = '2', server_seq = 1 WHERE id = $1 RETURNING server_seq`,
      [inserted?.id],
    );
    expect(Number(update.rows[0]?.server_seq)).toBeGreaterThan(Number(inserted?.server_seq));
  });
});
