import {
  auditListResponseSchema,
  errorResponseSchema,
  HEADERS,
  settingListSchema,
  settingSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('settings', () => {
  let t: TestApp;
  let session: Session;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string) => t.http().get(path).auth(session.accessToken, { type: 'bearer' });
  const put = (path: string) => t.http().put(path).auth(session.accessToken, { type: 'bearer' });

  it('lists every setting with its default before anything is set', async () => {
    const response = await get('/settings').expect(200);
    const settings = settingListSchema.parse(response.body);
    expect(settings).toContainEqual({
      key: 'money_display_unit',
      value: 'rial',
      effectiveFrom: null,
      isDefault: true,
    });
    expect(settings.every((setting) => setting.isDefault)).toBe(true);
  });

  it('sets a value, audited with actor, device, reason and before/after', async () => {
    const reason = 'الزبائن يفكرون بالدرهم';
    const response = await put('/settings/money_display_unit')
      .set(HEADERS.deviceId, 'desk-1')
      .set(HEADERS.auditReason, encodeURIComponent(reason))
      .send({ value: 'dirham' })
      .expect(200);
    expect(settingSchema.parse(response.body)).toEqual({
      key: 'money_display_unit',
      value: 'dirham',
      effectiveFrom: null,
      isDefault: false,
    });

    const changed = await put('/settings/money_display_unit').send({ value: 'rial' }).expect(200);
    expect(settingSchema.parse(changed.body).value).toBe('rial');

    const audit = await get('/audit?entity=setting').expect(200);
    const { items } = auditListResponseSchema.parse(audit.body);
    expect(items.map((item) => item.action)).toEqual(['update', 'create']);
    const [update, create] = items;
    expect(create).toMatchObject({
      before: null,
      after: { key: 'money_display_unit', value: 'dirham', effectiveFrom: null },
      reason,
    });
    expect(update).toMatchObject({
      before: { value: 'dirham' },
      after: { value: 'rial' },
      reason: null,
      entityId: create?.entityId,
    });
    const { rows: owners } = await t.sql.query<{ id: string }>(`SELECT id FROM app_user`);
    expect(create?.actorId).toBe(owners[0]?.id);
    expect(create?.requestId).toEqual(expect.any(String));

    const { rows } = await t.sql.query<{ device_id: string }>(
      `SELECT device_id FROM audit_log WHERE entity = 'setting' ORDER BY server_seq`,
    );
    expect(rows.map((row) => row.device_id)).toEqual(['desk-1', 'server']);
  });

  it('keeps a history by effective date: each day sees the value in effect then', async () => {
    await put('/settings/remnant_threshold_cm')
      .send({ value: 80, effectiveFrom: '2026-01-01' })
      .expect(200);
    await put('/settings/remnant_threshold_cm')
      .send({ value: 120, effectiveFrom: '2027-01-01' })
      .expect(200);

    const value = async (at: string) =>
      settingSchema.parse((await get(`/settings/remnant_threshold_cm?at=${at}`).expect(200)).body);
    await expect(value('2025-12-31')).resolves.toMatchObject({ value: 100, isDefault: true });
    await expect(value('2026-06-15')).resolves.toMatchObject({
      value: 80,
      effectiveFrom: '2026-01-01',
    });
    await expect(value('2027-01-01')).resolves.toMatchObject({
      value: 120,
      effectiveFrom: '2027-01-01',
    });
  });

  it('validates the value against the key and the key against the registry', async () => {
    const badValue = await put('/settings/money_display_unit').send({ value: 'euro' }).expect(400);
    const { error } = errorResponseSchema.parse(badValue.body);
    expect(error.code).toBe('validation_failed');
    expect(error.issues?.[0]?.path).toEqual(['value']);

    await put('/settings/remnant_threshold_cm').send({ value: 1.5 }).expect(400);
    await put('/settings/no_such_key').send({ value: 1 }).expect(400);
    await get('/settings/remnant_threshold_cm?at=15-06-2026').expect(400);
    await put('/settings/money_display_unit')
      .send({ value: 'dirham', effectiveFrom: 'soon' })
      .expect(400);
  });

  it('rejects an audit reason that is not percent-encoded UTF-8', async () => {
    await put('/settings/money_display_unit')
      .set(HEADERS.auditReason, '%E0%A4%A')
      .send({ value: 'dirham' })
      .expect(400);
  });

  it('pages the audit log newest first', async () => {
    const first = auditListResponseSchema.parse((await get('/audit?limit=2').expect(200)).body);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = auditListResponseSchema.parse(
      (await get(`/audit?limit=2&cursor=${String(first.nextCursor)}`).expect(200)).body,
    );
    expect(second.items[0]?.id).not.toBe(first.items[1]?.id);
  });
});
