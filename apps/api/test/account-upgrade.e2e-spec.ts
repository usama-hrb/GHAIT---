import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app.js';

/**
 * Migration 0034 (ADR 0024): a partner account made by `make partner-user` before accounts were
 * linked to a partner has no partner to belong to. Upgrading switches it off, with its sessions and
 * an audit entry, and touches nothing else. This runs that migration's own statements on such data.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../drizzle/0034_account_management.sql', import.meta.url)),
  'utf8',
);
const LEGACY_STATEMENTS = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes(`"role" = 'partner' AND "partner_id" IS NULL`));

describe('upgrading accounts that were not linked to a partner (ADR 0024)', () => {
  let t: TestApp;
  const legacy = crypto.randomUUID();
  const linked = crypto.randomUUID();
  const partner = crypto.randomUUID();
  const cashier = crypto.randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    // The state before the upgrade: no rule yet that a partner account is linked.
    await t.sql.query(`ALTER TABLE app_user DROP CONSTRAINT app_user_active_partner_linked`);
    await t.sql.query(
      `INSERT INTO partner (id, name, ownership_bp, is_owner, device_id) VALUES ($1, 'شريك', 1000, false, 'test')`,
      [partner],
    );
    const insertUser = (id: string, username: string, role: string, partnerId: string | null) =>
      t.sql.query(
        `INSERT INTO app_user (id, username, display_name, password_hash, role, partner_id, device_id)
         VALUES ($1, $2, $2, 'x', $3, $4, 'test')`,
        [id, username, role, partnerId],
      );
    await insertUser(legacy, 'old-partner', 'partner', null);
    await insertUser(linked, 'new-partner', 'partner', partner);
    await insertUser(cashier, 'a-cashier', 'cashier', null);
    for (const userId of [legacy, linked, cashier]) {
      await t.sql.query(
        `INSERT INTO auth_session (user_id, family_id, token_hash, expires_at, device_id)
         VALUES ($1, gen_random_uuid(), $2, now() + interval '1 day', 'test')`,
        [userId, `hash-${userId}`],
      );
    }
    for (const statement of LEGACY_STATEMENTS) await t.sql.query(statement);
  });

  afterAll(async () => {
    await t.close();
  });

  it('finds the three statements that switch the legacy accounts off', () => {
    expect(LEGACY_STATEMENTS).toHaveLength(3);
  });

  it('switches off the unlinked partner account and ends its sessions', async () => {
    const { rows } = await t.sql.query<{ deactivated_at: Date | null; revoked: string }>(
      `SELECT u.deactivated_at,
              (SELECT count(*) FROM auth_session s WHERE s.user_id = u.id AND s.revoked_at IS NOT NULL) AS revoked
         FROM app_user u WHERE u.id = $1`,
      [legacy],
    );
    expect(rows[0]?.deactivated_at).not.toBeNull();
    expect(rows[0]?.revoked).toBe('1');
  });

  it('says so in the audit log', async () => {
    const { rows } = await t.sql.query<{ reason: string }>(
      `SELECT reason FROM audit_log WHERE entity = 'app_user' AND entity_id = $1`,
      [legacy],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toContain('account-management upgrade');
  });

  it('leaves a linked partner account, a cashier and the owner as they were', async () => {
    const { rows } = await t.sql.query<{
      username: string;
      deactivated_at: Date | null;
      revoked: string;
    }>(
      `SELECT u.username, u.deactivated_at,
              (SELECT count(*) FROM auth_session s WHERE s.user_id = u.id AND s.revoked_at IS NOT NULL) AS revoked
         FROM app_user u WHERE u.id <> $1 ORDER BY u.username`,
      [legacy],
    );
    expect(rows.map((row) => row.username)).toEqual(['a-cashier', 'new-partner', 'owner']);
    for (const row of rows) {
      expect(row.deactivated_at).toBeNull();
      expect(row.revoked).toBe('0');
    }
    const audits = await t.sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE entity = 'app_user' AND entity_id = ANY($1)`,
      [[linked, cashier]],
    );
    expect(audits.rows[0]?.n).toBe('0');
  });
});
