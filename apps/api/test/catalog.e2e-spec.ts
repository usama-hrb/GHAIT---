import {
  errorResponseSchema,
  HEADERS,
  PRODUCT_ISSUES,
  storedFabricSchema,
  storedProductSchema,
  storedSupplierSchema,
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
  const productId = crypto.randomUUID();
  const rosa = {
    name: 'روزا',
    tags: ['صيفي'],
    purchaseUnits: ['kg', 'meter'],
    sellingUnits: ['meter'],
    pricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
  };

  it('creates a supplier and a product with client-generated ids', async () => {
    const supplier = await as(t.http().put(`/suppliers/${supplierId}`))
      .send({ name: 'مورد الدار البيضاء', phone: '+212 600 000 000' })
      .expect(200);
    expect(storedSupplierSchema.parse(supplier.body)).toMatchObject({
      id: supplierId,
      deviceId: 'desk-1',
    });

    const response = await as(t.http().put(`/products/${productId}`))
      .send(rosa)
      .expect(200);
    const created = storedProductSchema.parse(response.body);
    expect(created).toMatchObject({
      id: productId,
      name: 'روزا',
      pricePerMeterCents: 2000,
      minPricePerMeterCents: 1800,
      active: true,
      voidedAt: null,
    });
    expect(created.serverSeq).toBeGreaterThan(0);
  });

  it('updates and keeps createdAt', async () => {
    const before = storedProductSchema.parse(
      (await as(t.http().get(`/products/${productId}`)).expect(200)).body,
    );
    const after = storedProductSchema.parse(
      (
        await as(t.http().put(`/products/${productId}`))
          .send({
            ...rosa,
            name: 'روزا الجديدة',
            pricePerMeterCents: 2200,
            minPricePerMeterCents: 1900,
          })
          .expect(200)
      ).body,
    );
    expect(after).toMatchObject({ name: 'روزا الجديدة', createdAt: before.createdAt });
    expect(after.serverSeq).toBeGreaterThan(before.serverSeq);
  });

  it('validates with the contract: a minimum above the normal price, or none, is refused', async () => {
    const above = await as(t.http().put(`/products/${crypto.randomUUID()}`))
      .send({ ...rosa, pricePerMeterCents: 1000, minPricePerMeterCents: 2000 })
      .expect(400);
    expect(errorResponseSchema.parse(above.body).error.issues?.[0]).toMatchObject({
      path: ['minPricePerMeterCents'],
      message: PRODUCT_ISSUES.minAbovePrice,
    });
    const none = await as(t.http().put(`/products/${crypto.randomUUID()}`))
      .send({ ...rosa, minPricePerMeterCents: null })
      .expect(400);
    expect(errorResponseSchema.parse(none.body).error.issues?.[0]?.message).toBe(
      PRODUCT_ISSUES.minRequired,
    );
  });

  it('voids with a reason (no delete), hidden from lists unless asked for', async () => {
    const id = crypto.randomUUID();
    await as(t.http().put(`/products/${id}`))
      .send({ ...rosa, name: 'مؤقت' })
      .expect(200);
    await as(t.http().post(`/products/${id}/void`))
      .send({ reason: '' })
      .expect(400);
    const voided = storedProductSchema.parse(
      (
        await as(t.http().post(`/products/${id}/void`))
          .send({ reason: 'أُضيف خطأ' })
          .expect(200)
      ).body,
    );
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.active).toBe(false);

    const listed = z
      .array(storedProductSchema)
      .parse((await as(t.http().get('/products')).expect(200)).body);
    expect(listed.map((p) => p.id)).not.toContain(id);
    const all = z
      .array(storedProductSchema)
      .parse((await as(t.http().get('/products?includeVoided=true')).expect(200)).body);
    expect(all.map((p) => p.id)).toContain(id);

    const { rows } = await t.sql.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM audit_log WHERE entity_id = $1 ORDER BY server_seq`,
      [id],
    );
    expect(rows).toEqual([
      { action: 'create', reason: null },
      { action: 'void', reason: 'أُضيف خطأ' },
    ]);
    await as(t.http().delete(`/products/${id}`)).expect(404);
  });

  it('answers 404 for an unknown product', async () => {
    await as(t.http().get(`/products/${crypto.randomUUID()}`)).expect(404);
    await as(t.http().get('/products/not-a-uuid')).expect(400);
  });

  it('keeps the fabrics and colours the shop had as history: read, never written (ADR 0012)', async () => {
    const fabricId = crypto.randomUUID();
    await t.sql.query(
      `INSERT INTO fabric (id, device_id, name, ref_price_per_m_cents, min_price_per_m_cents, tags)
       VALUES ($1, 'legacy', 'روزا القديمة', 2000, 1800, ARRAY[]::text[])`,
      [fabricId],
    );
    const listed = z
      .array(storedFabricSchema)
      .parse((await as(t.http().get('/fabrics')).expect(200)).body);
    expect(listed.map((f) => f.id)).toContain(fabricId);
    await as(t.http().get(`/fabrics/${fabricId}`)).expect(200);
    // Nothing writes them any more: there is no route for it.
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'x', refPricePerMeterCents: 1, minPricePerMeterCents: 1 })
      .expect(404);
    await as(t.http().put(`/variants/${crypto.randomUUID()}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(404);
    await as(t.http().post(`/fabrics/${fabricId}/void`))
      .send({ reason: 'x' })
      .expect(404);
  });
});
