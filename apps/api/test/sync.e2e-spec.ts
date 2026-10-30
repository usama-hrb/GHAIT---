import {
  CATALOG_ISSUES,
  type Fabric,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute)).toISOString();

function fabric(overrides: Partial<Fabric> = {}): Fabric {
  return {
    id: crypto.randomUUID(),
    createdAt: at(0),
    updatedAt: at(0),
    deviceId: 'desk',
    voidedAt: null,
    name: 'روزا',
    type: null,
    defaultSupplierId: null,
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
    estCmPerKg: null,
    sellableAsPiece: false,
    piecePriceCents: null,
    tags: [],
    notes: null,
    ...overrides,
  };
}

function upsert(record: Fabric, baseServerSeq: number | null = null): SyncOp {
  return {
    opId: crypto.randomUUID(),
    entity: 'fabric',
    entityId: record.id,
    kind: 'upsert',
    payload: record,
    deviceId: record.deviceId,
    clientTs: record.updatedAt,
    baseServerSeq,
  };
}

describe('sync push and pull (ADR 0002)', () => {
  let t: TestApp;
  let session: Session;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
  });

  afterAll(async () => {
    await t.close();
  });

  const push = async (...ops: SyncOp[]): Promise<SyncOpResult[]> => {
    const response = await t
      .http()
      .post('/sync/push')
      .auth(session.accessToken, { type: 'bearer' })
      .send({ ops })
      .expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };
  const pull = async (since: number, limit = 200) => {
    const response = await t
      .http()
      .get(`/sync/pull?since=${String(since)}&limit=${String(limit)}`)
      .auth(session.accessToken, { type: 'bearer' })
      .expect(200);
    return syncPullResponseSchema.parse(response.body);
  };
  const count = async (sql: string, params: unknown[] = []) =>
    (await t.sql.query(sql, params)).rowCount;

  it('applies a new record, audited with the op’s device and the signed-in owner', async () => {
    const record = fabric({ deviceId: 'phone-1' });
    const [result] = await push(upsert(record));
    expect(result).toMatchObject({ status: 'applied', error: null });
    expect(result?.serverSeq).toEqual(expect.any(Number));

    const { rows } = await t.sql.query<{
      action: string;
      device_id: string;
      actor_id: string | null;
    }>(
      `SELECT action, device_id, actor_id FROM audit_log WHERE entity = 'fabric' AND entity_id = $1`,
      [record.id],
    );
    const { rows: owners } = await t.sql.query<{ id: string }>(`SELECT id FROM app_user`);
    expect(rows).toEqual([{ action: 'create', device_id: 'phone-1', actor_id: owners[0]?.id }]);
  });

  it('is idempotent by opId: a replay answers the same and changes nothing', async () => {
    const op = upsert(fabric());
    const [first] = await push(op);
    const [again, inSameBatch] = await push(op, op);
    for (const replay of [again, inSameBatch]) {
      expect(replay).toEqual({
        opId: op.opId,
        status: 'duplicate',
        originalStatus: 'applied',
        serverSeq: first?.serverSeq,
        error: null,
      });
    }
    await expect(count(`SELECT 1 FROM fabric WHERE id = $1`, [op.entityId])).resolves.toBe(1);
    await expect(
      count(`SELECT 1 FROM audit_log WHERE entity_id = $1`, [op.entityId]),
    ).resolves.toBe(1);
    await expect(count(`SELECT 1 FROM sync_op WHERE id = $1`, [op.opId])).resolves.toBe(1);
  });

  it('rejects an invalid record with the contract’s issues, and keeps rejecting it', async () => {
    const op = upsert(fabric({ minPricePerMeterCents: 2500 }));
    const [result] = await push(op);
    expect(result).toMatchObject({
      status: 'rejected',
      serverSeq: null,
      error: {
        code: 'validation_failed',
        issues: [
          expect.objectContaining({
            path: ['payload', 'minPricePerMeterCents'],
            message: CATALOG_ISSUES.minAboveRef,
          }),
        ],
      },
    });
    const [replay] = await push(op);
    expect(replay).toMatchObject({
      status: 'duplicate',
      originalStatus: 'rejected',
      error: result?.error,
    });
    await expect(count(`SELECT 1 FROM fabric WHERE id = $1`, [op.entityId])).resolves.toBe(0);
  });

  it('applies the other ops of a batch when one is rejected', async () => {
    const good = fabric();
    const missingFabric = {
      ...upsert(good),
      entity: 'variant' as const,
      entityId: crypto.randomUUID(),
      payload: {
        id: '',
        fabricId: crypto.randomUUID(),
        colorName: 'أحمر',
        lowStockThresholdCm: 500,
        createdAt: at(0),
        updatedAt: at(0),
        deviceId: 'desk',
        voidedAt: null,
      },
    };
    missingFabric.payload.id = missingFabric.entityId;
    const results = await push(missingFabric, upsert(good));
    expect(results.map((result) => result.status)).toEqual(['rejected', 'applied']);
    expect(results[0]?.error).toMatchObject({ code: 'conflict' });
  });

  it('rejects an op whose record does not match it, and ops an entity does not take', async () => {
    const record = fabric();
    const results = await push(
      { ...upsert(record), entityId: crypto.randomUUID() },
      { ...upsert(record), deviceId: 'other-device' },
      { ...upsert(record), kind: 'append' },
      { ...upsert(record), entity: 'setting' },
    );
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ]);
  });

  it('never treats a device’s own consecutive edits as a conflict', async () => {
    const record = fabric();
    const [created] = await push(upsert(record));
    const base = created?.serverSeq ?? null;
    const [first, second] = await push(
      upsert({ ...record, name: 'روزا 2', updatedAt: at(1) }, base),
      upsert({ ...record, name: 'روزا 3', updatedAt: at(2) }, base),
    );
    expect([first?.status, second?.status]).toEqual(['applied', 'applied']);
    await expect(
      count(`SELECT 1 FROM sync_conflict WHERE entity_id = $1`, [record.id]),
    ).resolves.toBe(0);
  });

  it('concurrent edits: the later one wins, the loser is kept in sync_conflict', async () => {
    const record = fabric({ deviceId: 'desk' });
    const [created] = await push(upsert(record));
    const base = created?.serverSeq ?? null;

    // The phone edits at 10:05 on the version it pulled.
    const [phone] = await push(
      upsert({ ...record, deviceId: 'phone', name: 'هاتف', updatedAt: at(5) }, base),
    );
    expect(phone?.status).toBe('applied');

    // The desk, offline, edited the same version at 10:03: older, it loses.
    const [stale] = await push(upsert({ ...record, name: 'مكتب قديم', updatedAt: at(3) }, base));
    expect(stale).toMatchObject({ status: 'conflict', serverSeq: phone?.serverSeq });

    // A desk edit at 10:07 on that old version wins over the phone's.
    const [later] = await push(upsert({ ...record, name: 'مكتب أحدث', updatedAt: at(7) }, base));
    expect(later?.status).toBe('applied');

    const { rows } = await t.sql.query<{ winner: string; loser: { name: string } }>(
      `SELECT winner, loser FROM sync_conflict WHERE entity_id = $1 ORDER BY server_seq`,
      [record.id],
    );
    expect(rows.map((row) => [row.winner, row.loser.name])).toEqual([
      ['server', 'مكتب قديم'],
      ['incoming', 'هاتف'],
    ]);
    const { rows: now } = await t.sql.query<{ name: string }>(
      `SELECT name FROM fabric WHERE id = $1`,
      [record.id],
    );
    expect(now[0]?.name).toBe('مكتب أحدث');
  });

  it('an edit on the current version applies even with an older clock (no conflict)', async () => {
    const record = fabric({ updatedAt: at(30) });
    const [created] = await push(upsert(record));
    const [edit] = await push(
      upsert(
        { ...record, deviceId: 'phone', name: 'ساعة متأخرة', updatedAt: at(10) },
        created?.serverSeq ?? null,
      ),
    );
    expect(edit?.status).toBe('applied');
  });

  it('voids: final, audited with the reason, idempotent, and a later upsert keeps it voided', async () => {
    const record = fabric();
    const [created] = await push(upsert(record));
    const voidOp: SyncOp = {
      ...upsert(record),
      opId: crypto.randomUUID(),
      kind: 'void',
      payload: { reason: 'أُدخل مرتين' },
      clientTs: at(9),
    };
    const [voided] = await push(voidOp);
    expect(voided?.status).toBe('applied');
    const [again] = await push({ ...voidOp, opId: crypto.randomUUID() });
    expect(again).toMatchObject({ status: 'applied', serverSeq: voided?.serverSeq });

    await push(
      upsert(
        { ...record, name: 'تعديل بعد الإلغاء', updatedAt: at(10) },
        voided?.serverSeq ?? null,
      ),
    );
    const { rows } = await t.sql.query<{ voided_at: Date; name: string }>(
      `SELECT voided_at, name FROM fabric WHERE id = $1`,
      [record.id],
    );
    expect(rows[0]?.voided_at.toISOString()).toBe(at(9));
    expect(rows[0]?.name).toBe('تعديل بعد الإلغاء');

    const { rows: audit } = await t.sql.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM audit_log WHERE entity_id = $1 ORDER BY server_seq`,
      [record.id],
    );
    expect(audit.map((row) => row.action)).toEqual(['create', 'void', 'update']);
    expect(audit[1]?.reason).toBe('أُدخل مرتين');
    expect(created?.serverSeq).toBeLessThan(voided?.serverSeq ?? 0);
  });

  it('rejects a void without a reason or of an unknown record', async () => {
    const record = fabric();
    await push(upsert(record));
    const results = await push(
      { ...upsert(record), kind: 'void', payload: { reason: ' ' } },
      { ...upsert(fabric()), kind: 'void', payload: { reason: 'x' } },
    );
    expect(results.map((result) => [result.status, result.error?.code])).toEqual([
      ['rejected', 'validation_failed'],
      ['rejected', 'not_found'],
    ]);
  });

  it('pulls every change once, in server_seq order, page by page', async () => {
    await t
      .http()
      .put('/settings/money_display_unit')
      .auth(session.accessToken, { type: 'bearer' })
      .send({ value: 'dirham' })
      .expect(200);

    const all = await pull(0);
    expect(all.hasMore).toBe(false);
    const seqs = all.changes.map((change) => change.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // Settings changed through the API reach the devices too (pull only).
    expect(new Set(all.changes.map((change) => change.entity))).toEqual(
      new Set(['fabric', 'setting']),
    );
    expect(all.changes.some((change) => (change.record as Fabric).voidedAt !== null)).toBe(true);

    const paged: number[] = [];
    let since = 0;
    for (let page = 0; page < 100; page++) {
      const response = await pull(since, 3);
      paged.push(...response.changes.map((change) => change.serverSeq));
      since = response.nextSince;
      if (!response.hasMore) break;
    }
    expect(paged).toEqual(seqs);
    await expect(pull(since)).resolves.toEqual({ changes: [], nextSince: since, hasMore: false });
  });

  it('requires a signed-in owner', async () => {
    await t.http().get('/sync/pull').expect(401);
    await t.http().post('/sync/push').send({ ops: [] }).expect(401);
  });
});
