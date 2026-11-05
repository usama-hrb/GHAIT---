import { readFile } from 'node:fs/promises';
import { HEADERS, storedProductSchema } from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('products', () => {
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

  it('creates and updates products by stable id with contract validation', async () => {
    const id = crypto.randomUUID();
    const input = {
      name: 'Rosa',
      purchaseUnits: ['kg', 'meter'],
      sellingUnits: ['meter'],
      pricePerMeterCents: 300,
      minPricePerMeterCents: 200,
      kgToMeterConversion: { weightG: 500, lengthCm: 100, source: 'measured' },
    };
    const created = storedProductSchema.parse(
      (
        await as(t.http().put(`/products/${id}`))
          .send(input)
          .expect(200)
      ).body,
    );
    expect(created).toMatchObject({ id, name: 'Rosa', active: true });
    expect(Number.isInteger(created.serverSeq)).toBe(true);

    const updated = storedProductSchema.parse(
      (
        await as(t.http().put(`/products/${id}`))
          .send({ ...input, name: 'Rosa updated' })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({ id, name: 'Rosa updated', createdAt: created.createdAt });

    const listed = z
      .array(storedProductSchema)
      .parse((await as(t.http().get('/products')).expect(200)).body);
    expect(listed.filter((product) => product.id === id)).toHaveLength(1);

    await as(t.http().put(`/products/${crypto.randomUUID()}`))
      .send({ ...input, sellingUnits: [] })
      .expect(400);
    await as(t.http().put(`/products/${crypto.randomUUID()}`))
      .send({ ...input, sellingUnits: ['kg'] })
      .expect(400);
  });

  it('keeps weight out of the selling units in the database as well', async () => {
    const insert = (units: string) =>
      t.sql.query(
        `INSERT INTO product (id, device_id, name, selling_units)
         VALUES ($1, 'db-test', 'Units', ${units}::product_unit[])`,
        [crypto.randomUUID()],
      );
    await expect(insert(`ARRAY['kg']`)).rejects.toThrow('product_selling_units_valid');
    await expect(insert(`ARRAY['meter', 'kg']`)).rejects.toThrow('product_selling_units_valid');
    await insert(`ARRAY['meter', 'piece']`);
  });

  it('backfills one Product per Variant without changing legacy history and is idempotent', async () => {
    const fabricId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const otherVariantId = crypto.randomUUID();
    await t.sql.query(
      `INSERT INTO fabric (id, device_id, name, ref_price_per_m_cents, min_price_per_m_cents,
          est_cm_per_kg, sellable_as_piece, tags, notes)
       VALUES ($1, 'migration-test', 'Rosa', 2000, 1800, 200, true, ARRAY['summer'], 'catalog note')`,
      [fabricId],
    );
    await t.sql.query(
      `INSERT INTO variant (id, device_id, fabric_id, color_name, low_stock_threshold_cm)
       VALUES ($1, 'migration-test', $3, 'Red', 500), ($2, 'migration-test', $3, 'Blue', 500)`,
      [variantId, otherVariantId, fabricId],
    );

    const purchaseIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const methods = ['kg', 'meter', 'piece'] as const;
    const rollIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, method] of methods.entries()) {
      const purchaseId = purchaseIds[index];
      const rollId = rollIds[index];
      if (!purchaseId || !rollId) throw new Error('test fixture id missing');
      await t.sql.query(
        `INSERT INTO purchase (id, device_id, date, method, total_cost_cents, paid_cents)
         VALUES ($1, 'migration-test', '2026-10-01', $2, 1000, 1000)`,
        [purchaseId, method],
      );
      await t.sql.query(
        `INSERT INTO roll (id, device_id, short_code, variant_id, purchase_id, length_cm_initial,
            cost_total_cents, length_estimated, status)
         VALUES ($1, 'migration-test', $2, $3, $4, 200, 1000, false, 'active')`,
        [rollId, `R-M${String(index + 1).padStart(4, '0')}`, variantId, purchaseId],
      );
    }

    const migration = await readFile(
      new URL('../drizzle/0026_products.sql', import.meta.url),
      'utf8',
    );
    const start = migration.indexOf('INSERT INTO "product"');
    const end = migration.indexOf(';--> statement-breakpoint', start);
    if (start < 0 || end < 0) throw new Error('Product backfill SQL not found in migration');
    const backfillSql = migration.slice(start, end + 1);
    await t.sql.query(backfillSql);

    const { rows } = await t.sql.query<{
      id: string;
      name: string;
      purchase_units: string[];
      selling_units: string[];
      kg_to_meter_weight_g: number | null;
      kg_to_meter_length_cm: number | null;
      kg_to_meter_source: string | null;
      active: boolean;
    }>(
      `SELECT id, name, array_to_json(purchase_units) AS purchase_units,
          array_to_json(selling_units) AS selling_units, kg_to_meter_weight_g,
          kg_to_meter_length_cm, kg_to_meter_source, active
       FROM product WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[variantId, otherVariantId]],
    );
    const red = rows.find((product) => product.id === variantId);
    const blue = rows.find((product) => product.id === otherVariantId);
    expect(red).toMatchObject({
      id: variantId,
      name: 'Rosa - Red',
      purchase_units: ['kg', 'meter', 'piece'],
      selling_units: ['meter', 'piece'],
      kg_to_meter_weight_g: 1000,
      kg_to_meter_length_cm: 200,
      kg_to_meter_source: 'estimated',
      active: true,
    });
    expect(blue).toMatchObject({
      id: otherVariantId,
      name: 'Rosa - Blue',
      purchase_units: [],
      selling_units: ['meter', 'piece'],
    });

    await t.sql.query(`UPDATE product SET name = 'Owner edit' WHERE id = $1`, [variantId]);
    await t.sql.query(backfillSql);
    const duplicateCheck = await t.sql.query<{ count: string }>(
      `SELECT count(*) FROM product WHERE id = ANY($1::uuid[])`,
      [[variantId, otherVariantId]],
    );
    const preserved = await t.sql.query<{ name: string }>(
      `SELECT name FROM product WHERE id = $1`,
      [variantId],
    );
    expect(duplicateCheck.rows[0]?.count).toBe('2');
    expect(preserved.rows[0]?.name).toBe('Owner edit');
    expect(
      (
        await t.sql.query(`SELECT id FROM variant WHERE id = ANY($1::uuid[])`, [
          [variantId, otherVariantId],
        ])
      ).rows,
    ).toHaveLength(2);
    expect(
      (await t.sql.query(`SELECT id FROM roll WHERE variant_id = $1`, [variantId])).rows,
    ).toHaveLength(3);
  });
});
