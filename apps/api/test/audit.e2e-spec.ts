import { errorResponseSchema } from '@fabric/contracts';
import { ConflictException, Controller, Post } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, TransactionHost } from '../src/database/index.js';
import { AuditExempt, AuditModule, AuditService } from '../src/modules/audit/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';

/** Test-only routes that write a row with and without its audit entry. */
@Controller('probe')
class ProbeController {
  constructor(
    private readonly tx: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  private async insert(key: string) {
    const [row] = await this.tx.db
      .insert(schema.setting)
      .values({ key, value: 1, deviceId: 'server' })
      .returning();
    if (!row) throw new Error('no row');
    return row;
  }

  @Post('unaudited')
  async unaudited(): Promise<void> {
    await this.insert('probe_unaudited');
  }

  @Post('audited')
  async audited(): Promise<void> {
    const row = await this.insert('probe_audited');
    await this.audit.record({
      entity: 'setting',
      entityId: row.id,
      action: 'create',
      before: null,
      after: row,
    });
  }

  @Post('audited-then-fails')
  async auditedThenFails(): Promise<void> {
    const row = await this.insert('probe_failed');
    await this.audit.record({
      entity: 'setting',
      entityId: row.id,
      action: 'create',
      before: null,
      after: row,
    });
    throw new ConflictException('changed my mind');
  }

  @Post('exempt')
  @AuditExempt('test: manages nothing')
  exempt(): { ok: true } {
    return { ok: true };
  }
}

describe('every mutating request is one audited unit of work', () => {
  let t: TestApp;
  let session: Session;

  beforeAll(async () => {
    t = await createTestApp({ imports: [AuditModule], controllers: [ProbeController] });
    session = await t.login();
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (path: string) => t.http().post(path).auth(session.accessToken, { type: 'bearer' });
  const rows = async (key: string) =>
    (await t.sql.query(`SELECT 1 FROM setting WHERE key = $1`, [key])).rowCount;

  it('rolls back a change that wrote no audit entry, and answers 500', async () => {
    const response = await post('/probe/unaudited').expect(500);
    expect(errorResponseSchema.parse(response.body).error).toMatchObject({
      code: 'internal_error',
      message: 'Internal server error',
    });
    await expect(rows('probe_unaudited')).resolves.toBe(0);
  });

  it('commits a change together with its audit entry', async () => {
    await post('/probe/audited').expect(201);
    await expect(rows('probe_audited')).resolves.toBe(1);
    const audit = await t.sql.query(
      `SELECT 1 FROM audit_log WHERE after->>'key' = 'probe_audited'`,
    );
    expect(audit.rowCount).toBe(1);
  });

  it('rolls back the change and its audit entry when the handler fails', async () => {
    await post('/probe/audited-then-fails').expect(409);
    await expect(rows('probe_failed')).resolves.toBe(0);
    const audit = await t.sql.query(`SELECT 1 FROM audit_log WHERE after->>'key' = 'probe_failed'`);
    expect(audit.rowCount).toBe(0);
  });

  it('lets an explicitly exempt route through', async () => {
    await post('/probe/exempt').expect(201).expect({ ok: true });
  });

  it('exposes no way to change or delete the audit log', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      await t.http()[method]('/audit').auth(session.accessToken, { type: 'bearer' }).expect(404);
    }
  });
});
