import {
  batchCode,
  batchDetailSchema,
  buildProductPurchase,
  buildSaleAggregate,
  type DataExport,
  dataExportSchema,
  HEADERS,
  newProductPurchaseSchema,
  newSaleSchema,
  payrollSchema,
  saleDetailSchema,
  settingSchema,
  syncPullResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataService } from '../src/modules/data/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const at = (day: string) => `${day}T09:00:00.000Z`;

/** The shop's identity (ADR 0017): a name and a small JPEG logo (base64 of `bytes` bytes). */
const SHOP_NAME = 'أقمشة النور';
const SHOP_LOGO = (() => {
  const bytes = 3000;
  return {
    contentType: 'image/jpeg',
    width: 240,
    height: 120,
    byteLength: bytes,
    data: `/9j/${'A'.repeat((bytes / 3) * 4 - 4)}`,
  };
})();

describe('export and import (BUILD_PROMPTS 3.6)', () => {
  let source: TestApp;
  let target: TestApp;
  let legacyTarget: TestApp;
  let session: Session;
  const customerId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const employeeId = crypto.randomUUID();
  let batchId = '';
  let saleId = '';

  beforeAll(async () => {
    [source, target, legacyTarget] = await Promise.all([
      createTestApp(),
      createTestApp(),
      createTestApp(),
    ]);
    session = await source.login();
    const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
    await as(source.http().put(`/products/${productId}`))
      .send({
        name: 'روزا - أحمر',
        purchaseUnits: ['meter'],
        sellingUnits: ['meter'],
        pricePerMeterCents: 2000,
        minPricePerMeterCents: 1800,
      })
      .expect(200);
    await as(source.http().put(`/customers/${customerId}`))
      .send({ name: 'فاطمة' })
      .expect(200);
    await as(source.http().put('/settings/shop_name')).send({ value: SHOP_NAME }).expect(200);
    await as(source.http().put('/settings/shop_logo')).send({ value: SHOP_LOGO }).expect(200);
    const purchase = buildProductPurchase(
      newProductPurchaseSchema.parse({
        date: '2026-10-01',
        productId,
        unit: 'meter',
        quantity: 5000,
        totalCostCents: 80_000,
      }),
      {
        purchaseId: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        moveId: crypto.randomUUID(),
        code: batchCode('C', 1),
      },
      { deviceId: 'desk', now: at('2026-10-01') },
    );
    await as(source.http().post('/purchases')).send(purchase).expect(201);
    batchId = purchase.batches[0]?.id ?? '';
    const detail = batchDetailSchema.parse(
      (await as(source.http().get(`/batches/${batchId}`)).expect(200)).body,
    );
    const sold = buildSaleAggregate(
      newSaleSchema.parse({
        date: '2026-10-02',
        customerId,
        lines: [
          {
            batchId,
            unit: 'meter',
            quantity: 275,
            price: { perUnitCents: 1900 },
            refPriceCents: 2000,
            minPriceCents: 1800,
          },
        ],
        paidCents: 2000,
      }),
      new Map([[batchId, { batch: detail.batch, moves: detail.moves }]]),
      {
        saleId: crypto.randomUUID(),
        lineIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: at('2026-10-02') },
    );
    if (!sold.ok) throw new Error(JSON.stringify(sold.issues));
    saleId = sold.aggregate.sale.id;
    await as(source.http().post('/sales')).send(sold.aggregate).expect(201);
    // A colleague, his monthly rate and a part payment of October: the books a backup must keep.
    await as(source.http().put(`/employees/${employeeId}`))
      .send({ name: 'يوسف', position: 'قصّاص', startDate: '2026-10-01' })
      .expect(200);
    await as(source.http().put(`/employee-salaries/${crypto.randomUUID()}`))
      .send({ employeeId, effectiveFrom: '2026-10-01', amountCents: 300_000 })
      .expect(200);
    await as(source.http().put(`/expenses/${crypto.randomUUID()}`))
      .send({
        date: '2026-10-05',
        category: 'wages',
        amountCents: 100_000,
        paidDate: '2026-10-05',
        employeeId,
        salaryMonth: '2026-10',
      })
      .expect(200);
  });

  afterAll(async () => {
    await Promise.all([source.close(), target.close(), legacyTarget.close()]);
  });

  it('exports everything devices pull, and imports it into an empty server with a new epoch', async () => {
    const file: DataExport = await source.app.get(DataService).exportAll();
    expect(file.records.product_batch).toHaveLength(1);
    expect(file.records.product_stock_move.map((move) => move.type)).toEqual(['purchase', 'sale']);
    expect(file.records.sale_line).toMatchObject([{ batchId, unit: 'meter', quantity: 275 }]);
    expect(file.records.customer.map((customer) => customer.name)).toEqual(['فاطمة']);
    // Employees, their rates and the salary payment are in the backup (PY1–PY3).
    expect(file.records.employee).toMatchObject([{ id: employeeId, name: 'يوسف' }]);
    expect(file.records.employee_salary).toMatchObject([{ employeeId, amountCents: 300_000 }]);
    expect(file.records.expense).toMatchObject([
      { employeeId, salaryMonth: '2026-10', amountCents: 100_000, category: 'wages' },
    ]);
    // The shop's name and logo are in the backup (ADR 0017).
    expect(file.records.setting.map((row) => row.key)).toEqual(
      expect.arrayContaining(['shop_name', 'shop_logo']),
    );

    const targetSession = await target.login();
    const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(targetSession.accessToken, { type: 'bearer' });
    const pullEpoch = async () =>
      syncPullResponseSchema.parse(
        (await as(target.http().get('/sync/pull?since=0')).expect(200)).body,
      ).epoch;
    const before = await pullEpoch();
    // As a device export: no devices, so the codes come from the batches (B-C…).
    const counts = await target.app
      .get(DataService)
      .importAll(JSON.parse(JSON.stringify({ ...file, source: 'device', devices: [] })));
    expect(counts).toMatchObject({
      product: 1,
      product_batch: 1,
      product_stock_move: 2,
      sale_line: 1,
      customer: 1,
      employee: 1,
      employee_salary: 1,
      expense: 1,
    });
    expect(await pullEpoch()).not.toBe(before);
    // The restored server owes what the old one did: 3000 dh due, 1000 paid.
    const payroll = payrollSchema.parse(
      (await as(target.http().get(`/employees/${employeeId}/payroll?through=2026-10`)).expect(200))
        .body,
    );
    expect(payroll.months).toMatchObject([
      { month: '2026-10', dueCents: 300_000, paidCents: 100_000, remainingCents: 200_000 },
    ]);

    const batch = batchDetailSchema.parse(
      (await as(target.http().get(`/batches/${batchId}`)).expect(200)).body,
    );
    expect(batch.ledger).toMatchObject({
      available: { meter: { unit: 'meter', centimeters: 5000 - 275 } },
      costPerUnitCents: { meter: 1600 },
    });
    // The sale reads the same on the restored server: its cost comes from the batch.
    const sale = saleDetailSchema.parse(
      (await as(target.http().get(`/sales/${saleId}`)).expect(200)).body,
    );
    expect(sale.figures).toMatchObject({ capitalCents: 4400, profitCents: 825, dueCents: 3225 });
    // The restored server has the same identity: the name and the logo, byte for byte.
    const restored = async (key: string) =>
      settingSchema.parse((await as(target.http().get(`/settings/${key}`)).expect(200)).body);
    expect(await restored('shop_name')).toMatchObject({ value: SHOP_NAME, isDefault: false });
    expect(await restored('shop_logo')).toMatchObject({ value: SHOP_LOGO, isDefault: false });
    // The next device gets a code after the restored ones, so its batches never clash.
    const registered = await as(target.http().post('/devices/register'))
      .set(HEADERS.deviceId, 'new-phone')
      .expect(200);
    expect(registered.body).toEqual({ code: 'D' });

    await expect(target.app.get(DataService).importAll(file)).rejects.toThrow(
      /already has shop data/,
    );
    await expect(
      target.app.get(DataService).importAll({ format: 'something else' }),
    ).rejects.toThrow();
    expect(dataExportSchema.safeParse(file).success).toBe(true);
  });

  it('imports an export from before product batches: products and batches are made from the rolls, sales keep their cost', async () => {
    const base = (day: string) => ({
      createdAt: at(day),
      updatedAt: at(day),
      deviceId: 'legacy-desk',
      voidedAt: null,
    });
    const fabricId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const rollId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const legacy = {
      format: 'fabric-shop-export',
      version: 1,
      exportedAt: at('2026-10-10'),
      source: 'device',
      devices: [],
      records: {
        fabric: [
          {
            ...base('2026-09-01'),
            id: fabricId,
            name: 'روزا',
            type: null,
            defaultSupplierId: null,
            refPricePerMeterCents: 2000,
            minPricePerMeterCents: 1700,
            estCmPerKg: null,
            sellableAsPiece: false,
            piecePriceCents: null,
            tags: [],
            notes: null,
          },
        ],
        variant: [
          {
            ...base('2026-09-01'),
            id: variantId,
            fabricId,
            colorName: 'أحمر',
            lowStockThresholdCm: 500,
          },
        ],
        purchase: [
          {
            ...base('2026-10-01'),
            id: purchaseId,
            supplierId: null,
            date: '2026-10-01',
            method: 'meter',
            pricePerMeterCents: 1600,
            weightG: null,
            estCmPerKg: null,
            totalCostCents: 80_000,
            paidCents: 80_000,
            notes: null,
          },
        ],
        roll: [
          {
            ...base('2026-10-01'),
            id: rollId,
            shortCode: 'R-A0001',
            variantId,
            purchaseId,
            lengthCmInitial: 5000,
            costTotalCents: 80_000,
            lengthEstimated: false,
            status: 'active',
          },
        ],
        stock_move: [
          {
            ...base('2026-10-01'),
            id: crypto.randomUUID(),
            rollId,
            type: 'purchase',
            deltaCm: 5000,
            refId: purchaseId,
            date: '2026-10-01',
            note: null,
          },
          {
            ...base('2026-10-02'),
            id: crypto.randomUUID(),
            rollId,
            type: 'sale',
            deltaCm: -275,
            refId: lineId,
            date: '2026-10-02',
            note: null,
          },
        ],
        sale: [
          {
            ...base('2026-10-02'),
            id: saleId,
            date: '2026-10-02',
            customerId: null,
            totalCents: 4950,
            discountCents: 0,
            dueDate: null,
            confirmedBelowCost: false,
            note: null,
          },
        ],
        // The shape sale lines had before batches: on a roll, by the meter.
        sale_line: [
          {
            ...base('2026-10-02'),
            id: lineId,
            saleId,
            rollId,
            soldCm: 275,
            refPricePerMeterCents: 2000,
            minPricePerMeterCents: 1700,
            actualPricePerMeterCents: 1800,
            wholePiece: false,
            lineTotalCents: 4950,
          },
        ],
        payment: [
          {
            ...base('2026-10-02'),
            id: paymentId,
            customerId: null,
            kind: 'payment',
            amountCents: 4950,
            date: '2026-10-02',
            method: 'cash',
            note: null,
          },
        ],
        payment_allocation: [
          {
            ...base('2026-10-02'),
            id: crypto.randomUUID(),
            paymentId,
            saleId,
            amountCents: 4950,
            date: '2026-10-02',
          },
        ],
      },
    };

    const counts = await legacyTarget.app.get(DataService).importAll(legacy);
    expect(counts).toMatchObject({ roll: 1, stock_move: 2, sale_line: 1 });

    // The colour became a product (same id), the roll a batch (same id), its moves batch moves.
    const { rows } = await legacyTarget.sql.query<{ id: string; name: string }>(
      `SELECT id, name FROM product`,
    );
    expect(rows).toEqual([{ id: variantId, name: 'روزا - أحمر' }]);
    const legacySession = await legacyTarget.login();
    const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(legacySession.accessToken, { type: 'bearer' });
    const batch = batchDetailSchema.parse(
      (await as(legacyTarget.http().get(`/batches/${rollId}`)).expect(200)).body,
    );
    expect(batch.batch).toMatchObject({
      id: rollId,
      productId: variantId,
      unit: 'meter',
      receivedQuantity: 5000,
      costTotalCents: 80_000,
    });
    expect(batch.ledger.available.meter).toEqual({ unit: 'meter', centimeters: 5000 - 275 });
    // The sale line is on the batch and costs what the roll said: 275 cm of 16 dh/m.
    const sale = saleDetailSchema.parse(
      (await as(legacyTarget.http().get(`/sales/${saleId}`)).expect(200)).body,
    );
    expect(sale.lines[0]).toMatchObject({
      batchId: rollId,
      unit: 'meter',
      quantity: 275,
      actualPriceCents: 1800,
      minOverrideBy: null,
    });
    expect(sale.figures).toMatchObject({ capitalCents: 4400, profitCents: 550, dueCents: 0 });
  });
});
