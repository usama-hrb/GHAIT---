import {
  errorResponseSchema,
  HEADERS,
  storedFabricSchema,
  storedSupplierSchema,
  storedVariantSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('catalog REST', () => {
  let t: TestApp;
  let session: Session;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
  });

  afterAll(async () => {
    await t.close();
  });

  const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
    request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk-1');
  const supplierId = crypto.randomUUID();
  const fabricId = crypto.randomUUID();

  it('creates a supplier and a fabric with client-generated ids', async () => {
    const supplier = await as(t.http().put(`/suppliers/${supplierId}`))
      .send({ name: 'مورد الدار البيضاء', phone: '+212 600 000 000' })
      .expect(200);
    expect(storedSupplierSchema.parse(supplier.body)).toMatchObject({
      id: supplierId,
      deviceId: 'desk-1',
    });

    const response = await as(t.http().put(`/fabrics/${fabricId}`))
      .send({
        name: 'روزا',
        refPricePerMeterCents: 2000,
        minPricePerMeterCents: 1800,
        defaultSupplierId: supplierId,
        tags: ['صيفي'],
      })
      .expect(200);
    const created = storedFabricSchema.parse(response.body);
    expect(created).toMatchObject({
      id: fabricId,
      name: 'روزا',
      sellableAsPiece: false,
      voidedAt: null,
    });
    expect(created.serverSeq).toBeGreaterThan(0);
  });

  it('updates and keeps createdAt', async () => {
    const before = storedFabricSchema.parse(
      (await as(t.http().get(`/fabrics/${fabricId}`)).expect(200)).body,
    );
    const after = storedFabricSchema.parse(
      (
        await as(t.http().put(`/fabrics/${fabricId}`))
          .send({ name: 'روزا الجديدة', refPricePerMeterCents: 2200, minPricePerMeterCents: 1900 })
          .expect(200)
      ).body,
    );
    expect(after).toMatchObject({ name: 'روزا الجديدة', createdAt: before.createdAt });
    expect(after.serverSeq).toBeGreaterThan(before.serverSeq);
  });

  it('validates with the contract (minimum above the reference price)', async () => {
    const response = await as(t.http().put(`/fabrics/${crypto.randomUUID()}`))
      .send({ name: 'خطأ', refPricePerMeterCents: 1000, minPricePerMeterCents: 2000 })
      .expect(400);
    expect(errorResponseSchema.parse(response.body).error.issues?.[0]?.path).toEqual([
      'minPricePerMeterCents',
    ]);
  });

  it('adds colours to a fabric and refuses a colour of an unknown fabric', async () => {
    const red = crypto.randomUUID();
    await as(t.http().put(`/variants/${red}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    await as(t.http().put(`/variants/${crypto.randomUUID()}`))
      .send({ fabricId, colorName: 'أزرق', lowStockThresholdCm: 1000 })
      .expect(200);
    const list = z
      .array(storedVariantSchema)
      .parse((await as(t.http().get(`/fabrics/${fabricId}/variants`)).expect(200)).body);
    expect(list.map((variant) => variant.colorName)).toEqual(['أحمر', 'أزرق']);
    expect(list[0]?.lowStockThresholdCm).toBe(500);

    const orphan = await as(t.http().put(`/variants/${crypto.randomUUID()}`))
      .send({ fabricId: crypto.randomUUID(), colorName: 'أخضر' })
      .expect(409);
    expect(errorResponseSchema.parse(orphan.body).error.code).toBe('conflict');
  });

  it('voids with a reason (no delete), hidden from lists unless asked for', async () => {
    const id = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${id}`))
      .send({ name: 'مؤقت', refPricePerMeterCents: 100, minPricePerMeterCents: 0 })
      .expect(200);
    await as(t.http().post(`/fabrics/${id}/void`))
      .send({ reason: '' })
      .expect(400);
    const voided = storedFabricSchema.parse(
      (
        await as(t.http().post(`/fabrics/${id}/void`))
          .send({ reason: 'أُضيف خطأ' })
          .expect(200)
      ).body,
    );
    expect(voided.voidedAt).not.toBeNull();

    const listed = z
      .array(storedFabricSchema)
      .parse((await as(t.http().get('/fabrics')).expect(200)).body);
    expect(listed.map((f) => f.id)).not.toContain(id);
    const all = z
      .array(storedFabricSchema)
      .parse((await as(t.http().get('/fabrics?includeVoided=true')).expect(200)).body);
    expect(all.map((f) => f.id)).toContain(id);

    const { rows } = await t.sql.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM audit_log WHERE entity_id = $1 ORDER BY server_seq`,
      [id],
    );
    expect(rows).toEqual([
      { action: 'create', reason: null },
      { action: 'void', reason: 'أُضيف خطأ' },
    ]);
    await as(t.http().delete(`/fabrics/${id}`)).expect(404);
  });

  it('answers 404 for an unknown fabric', async () => {
    await as(t.http().get(`/fabrics/${crypto.randomUUID()}`)).expect(404);
    await as(t.http().get('/fabrics/not-a-uuid')).expect(400);
  });
});
