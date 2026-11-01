import {
  accessTokenResponseSchema,
  HEADERS,
  PHOTO_ISSUES,
  type Photo,
  type SyncOp,
  type SyncOpResult,
  SYNC_BATCH_MAX_BYTES,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';

/** A base64 text that decodes to `bytes` bytes and starts like a JPEG (the server checks no more). */
function fakeJpeg(bytes: number): string {
  const triples = Math.ceil(bytes / 3);
  const text = `/9j/${'A'.repeat(triples * 4 - 4)}`;
  const drop = triples * 3 - bytes;
  return drop === 0 ? text : `${text.slice(0, text.length - drop)}${'='.repeat(drop)}`;
}

describe('photos of colours (ADR 0009)', () => {
  let t: TestApp;
  let owner: Session;
  let cashierToken = '';
  const variantId = crypto.randomUUID();
  let tick = 0;

  const photo = (bytes: number, overrides: Partial<Photo> = {}): Photo => {
    tick += 1;
    const at = new Date(Date.UTC(2026, 9, 31, 10, 0, tick)).toISOString();
    return {
      id: crypto.randomUUID(),
      createdAt: at,
      updatedAt: at,
      deviceId: 'desk',
      voidedAt: null,
      variantId,
      contentType: 'image/jpeg',
      width: 480,
      height: 480,
      byteLength: bytes,
      data: fakeJpeg(bytes),
      ...overrides,
    };
  };
  const upsert = (record: Photo): Omit<SyncOp, 'opId' | 'deviceId' | 'clientTs'> => ({
    entity: 'photo',
    entityId: record.id,
    kind: 'upsert',
    payload: record,
    baseServerSeq: null,
  });

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login();
    const fabricId = crypto.randomUUID();
    await asOwner(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1700 })
      .expect(200);
    await asOwner(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    await t.app.get(AuthService).setCashierUser({
      username: 'amina',
      password: 'a-long-cashier-password',
      displayName: 'أمينة',
    });
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'amina', password: 'a-long-cashier-password' })
      .expect(200);
    cashierToken = accessTokenResponseSchema.parse(login.body).accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  function asOwner(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(owner.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }
  function asCashier(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(cashierToken, { type: 'bearer' }).set(HEADERS.deviceId, 'till');
  }
  type As = typeof asOwner;

  const push = async (
    as: As,
    ...ops: Omit<SyncOp, 'opId' | 'deviceId' | 'clientTs'>[]
  ): Promise<SyncOpResult[]> => {
    const response = await as(t.http().post('/sync/push'))
      .send({
        ops: ops.map((op) => ({
          ...op,
          opId: crypto.randomUUID(),
          deviceId: as === asOwner ? 'desk' : 'till',
          clientTs: new Date().toISOString(),
        })),
      })
      .expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };
  const pull = async (as: As, since: number, limit = 500) => {
    const response = await as(
      t.http().get(`/sync/pull?since=${String(since)}&limit=${String(limit)}`),
    ).expect(200);
    return { page: syncPullResponseSchema.parse(response.body), bytes: response.text.length };
  };

  it('a photo is pushed whole (past the default 100 KB body limit), pulled, and audited without its image', async () => {
    const record = photo(90_000);
    // ~120 KB of base64 in one op: the API takes it.
    const [result] = await push(asOwner, upsert(record));
    expect(result?.status).toBe('applied');

    const { page } = await pull(asOwner, 0);
    const change = page.changes.find((entry) => entry.entity === 'photo');
    expect(change?.record).toMatchObject({ id: record.id, variantId, byteLength: 90_000 });
    expect((change?.record as Photo).data).toBe(record.data);

    const { rows } = await t.sql.query<{ action: string; after: { data: string } }>(
      `SELECT action, after FROM audit_log WHERE entity = 'photo' AND entity_id = $1`,
      [record.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('create');
    expect(rows[0]?.after.data).toBe('[JPEG 90000 bytes]');
    expect(JSON.stringify(rows[0]).length).toBeLessThan(2000);
  });

  it('a replaced photo is voided with a reason; both stay, the void is audited without the image', async () => {
    const first = photo(30_000);
    const second = photo(31_000);
    await push(asOwner, upsert(first), upsert(second));
    const [voided] = await push(asOwner, {
      entity: 'photo',
      entityId: first.id,
      kind: 'void',
      payload: { reason: 'replaced' },
      baseServerSeq: null,
    });
    expect(voided?.status).toBe('applied');
    const { rows } = await t.sql.query<{ voided_at: Date | null }>(
      `SELECT voided_at FROM photo WHERE id = ANY($1)`,
      [[first.id, second.id]],
    );
    expect(rows.filter((row) => row.voided_at !== null)).toHaveLength(1);
    const audit = await t.sql.query<{ before: { data: string }; reason: string }>(
      `SELECT before, reason FROM audit_log WHERE entity = 'photo' AND entity_id = $1 AND action = 'void'`,
      [first.id],
    );
    expect(audit.rows[0]?.reason).toBe('replaced');
    expect(audit.rows[0]?.before.data).toBe('[JPEG 30000 bytes]');
  });

  it('a photo is never edited: the same photo with other bytes is refused', async () => {
    const record = photo(20_000);
    await push(asOwner, upsert(record));
    const [result] = await push(
      asOwner,
      upsert({ ...record, byteLength: 21_000, data: fakeJpeg(21_000) }),
    );
    expect(result?.status).toBe('rejected');
    expect(result?.error?.issues?.[0]?.message).toBe(PHOTO_ISSUES.fixed);
  });

  it('refuses what is not a JPEG of the size it says, and a photo of a colour the server lacks', async () => {
    const wrongSize = { ...photo(20_000), byteLength: 19_999 };
    const notJpeg = { ...photo(20_000), data: `iVBO${fakeJpeg(20_000).slice(4)}` };
    const orphan = photo(20_000, { variantId: crypto.randomUUID() });
    const results = await push(asOwner, upsert(wrongSize), upsert(notJpeg), upsert(orphan));
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results[0]?.error?.issues?.map((issue) => issue.message)).toContain(
      PHOTO_ISSUES.sizeMismatch,
    );
    expect(results[1]?.error?.issues?.map((issue) => issue.message)).toContain(
      PHOTO_ISSUES.notJpeg,
    );
    expect(results[2]?.error?.code).toBe('conflict');
  });

  it('a cashier is sent the photos but cannot add or void one', async () => {
    const { page } = await pull(asCashier, 0);
    expect(page.changes.some((change) => change.entity === 'photo')).toBe(true);

    const [added] = await push(asCashier, upsert(photo(20_000)));
    expect(added?.status).toBe('rejected');
    expect(added?.error?.code).toBe('forbidden');
  });

  it('pages are cut by size, and no photo is skipped between them', async () => {
    const stamp = new Date(Date.UTC(2026, 9, 31, 11)).toISOString();
    const records = Array.from({ length: 12 }, (_, index) =>
      photo(150_000, { createdAt: new Date(Date.parse(stamp) + index).toISOString() }),
    );
    for (const record of records) {
      const [result] = await push(asOwner, upsert(record));
      expect(result?.status).toBe('applied');
    }
    const wanted = new Set(records.map((record) => record.id));

    const seen: string[] = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const { page, bytes } = await pull(asOwner, since, 200);
      pages += 1;
      // A page stays near the budget (one record past it at most, and the rest of the JSON).
      expect(bytes).toBeLessThan(SYNC_BATCH_MAX_BYTES + 250_000);
      for (const change of page.changes) {
        if (change.entity === 'photo' && wanted.has((change.record as Photo).id)) {
          seen.push((change.record as Photo).id);
        }
      }
      since = page.nextSince;
      if (!page.hasMore) break;
    }
    // Every photo arrived once, in the order it was made; the images took several pages.
    expect(seen).toEqual(records.map((record) => record.id));
    expect(pages).toBeGreaterThan(2);
  });
});
