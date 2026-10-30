import {
  buildPurchaseAggregate,
  type DataExport,
  dataExportSchema,
  HEADERS,
  rollCode,
  rollDetailSchema,
  syncPullResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataService } from '../src/modules/data/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('export and import (BUILD_PROMPTS 3.6)', () => {
  let source: TestApp;
  let target: TestApp;
  let session: Session;
  const customerId = crypto.randomUUID();
  let rollId = '';

  beforeAll(async () => {
    [source, target] = await Promise.all([createTestApp(), createTestApp()]);
    session = await source.login();
    const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
    const variantId = crypto.randomUUID();
    const fabricId = crypto.randomUUID();
    await as(source.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1700 })
      .expect(200);
    await as(source.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    await as(source.http().put(`/customers/${customerId}`))
      .send({ name: 'فاطمة' })
      .expect(200);
    const purchase = buildPurchaseAggregate(
      {
        method: 'meter',
        date: '2026-10-01',
        supplierId: null,
        notes: null,
        pricePerMeterCents: 1600,
        rolls: [{ variantId, lengthCm: 5000 }],
      },
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('C', 1)],
      },
      { deviceId: 'desk', now: '2026-10-01T09:00:00.000Z' },
    );
    await as(source.http().post('/purchases')).send(purchase).expect(201);
    rollId = purchase.rolls[0]?.id ?? '';
  });

  afterAll(async () => {
    await Promise.all([source.close(), target.close()]);
  });

  it('exports everything devices pull, and imports it into an empty server with a new epoch', async () => {
    const file: DataExport = await source.app.get(DataService).exportAll();
    expect(file.records.roll).toHaveLength(1);
    expect(file.records.customer.map((customer) => customer.name)).toEqual(['فاطمة']);

    const targetSession = await target.login();
    const pullEpoch = async () =>
      syncPullResponseSchema.parse(
        (
          await target
            .http()
            .get('/sync/pull?since=0')
            .auth(targetSession.accessToken, { type: 'bearer' })
            .expect(200)
        ).body,
      ).epoch;
    const before = await pullEpoch();
    // As a device export: no devices, so the codes come from the rolls (R-C…).
    const counts = await target.app
      .get(DataService)
      .importAll(JSON.parse(JSON.stringify({ ...file, source: 'device', devices: [] })));
    expect(counts).toMatchObject({ fabric: 1, variant: 1, roll: 1, stock_move: 1, customer: 1 });
    expect(await pullEpoch()).not.toBe(before);

    const roll = rollDetailSchema.parse(
      (
        await target
          .http()
          .get(`/rolls/${rollId}`)
          .auth(targetSession.accessToken, { type: 'bearer' })
          .expect(200)
      ).body,
    );
    expect(roll.ledger).toMatchObject({ remainingCm: 5000, costPerMeterCents: 1600 });
    // The next device gets a code after the restored ones, so its rolls never clash.
    const registered = await target
      .http()
      .post('/devices/register')
      .auth(targetSession.accessToken, { type: 'bearer' })
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
});
