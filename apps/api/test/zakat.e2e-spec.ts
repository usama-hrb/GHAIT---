import {
  errorResponseSchema,
  HEADERS,
  storedZakatReportSchema,
  type SyncOp,
  syncPushResponseSchema,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatReportDetailSchema,
  zakatReportFieldsOf,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const dh = (amount: number) => amount * 100;

describe('zakat reports and their payment (BUILD_PROMPTS 5.1)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();
  let report: ZakatReport;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 6000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 4000, isOwner: false })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const upsert = (payload: ZakatReport): SyncOp => ({
    opId: crypto.randomUUID(),
    entity: 'zakat_report',
    entityId: payload.id,
    kind: 'upsert',
    payload,
    deviceId: 'desk',
    clientTs: payload.updatedAt,
    baseServerSeq: null,
  });

  async function push(payload: ZakatReport) {
    const response = await as(t.http().post('/sync/push'))
      .send({ ops: [upsert(payload)] })
      .expect(200);
    return syncPushResponseSchema.parse(response.body).results[0];
  }

  it('T14: a device saves the report; the server checks its figures against core', async () => {
    const fields = zakatReportFieldsOf(
      {
        goods: [
          {
            rollId: crypto.randomUUID(),
            label: 'R-A0001',
            remainingCm: 100_000,
            refPricePerMeterCents: dh(30),
            costCents: dh(24_000),
            valueCents: 0,
          },
        ],
        cashCents: dh(5000),
        receivables: [
          {
            customerId: crypto.randomUUID(),
            name: 'فاطمة',
            amountCents: dh(2000),
            doubtful: false,
          },
        ],
        debts: [{ customerId: crypto.randomUUID(), name: 'أمينة', amountCents: dh(1000) }],
        supplierDebts: [],
      },
      {
        hawlDate: '2026-10-20',
        hawlCompleted: true,
        settings: { nisabMetal: 'gold', goodsValuation: 'market', includeDoubtfulDebts: false },
        metalPrice: { pricePerGramCents: dh(300), date: '2026-10-19' },
      },
    );
    const now = new Date().toISOString();
    report = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      deviceId: 'desk',
      voidedAt: null,
      ...fields,
    };
    expect(fields.zakatDueCents).toBe(dh(900));

    const tampered = { ...report, id: crypto.randomUUID(), zakatDueCents: dh(10) };
    expect(await push(tampered)).toMatchObject({
      status: 'rejected',
      error: { issues: [expect.objectContaining({ message: ZAKAT_ISSUES.inconsistent })] },
    });
    expect(await push(report)).toMatchObject({ status: 'applied' });
    // One report per hawl.
    expect(await push({ ...report, id: crypto.randomUUID() })).toMatchObject({
      status: 'rejected',
    });
    // Never edited.
    expect(
      await push({ ...report, updatedAt: new Date().toISOString(), zakatDueCents: dh(1) }),
    ).toMatchObject({
      status: 'rejected',
    });
    const list = (await as(t.http().get('/zakat/reports')).expect(200)).body as unknown[];
    expect(list.map((row) => storedZakatReportSchema.parse(row).id)).toEqual([report.id]);
  });

  it('zakat settings: a price with its date, and "none" (null) as a value', async () => {
    await as(t.http().put('/settings/zakat_gold_price'))
      .send({ value: { pricePerGramCents: dh(900), date: '2026-10-19' } })
      .expect(200);
    await as(t.http().put('/settings/zakat_gold_price')).send({ value: null }).expect(200);
    const read = (await as(t.http().get('/settings/zakat_gold_price')).expect(200)).body as {
      value: unknown;
    };
    expect(read.value).toBeNull();
    await as(t.http().put('/settings/zakat_hawl_start')).send({ value: '2025-11-01' }).expect(200);
    await as(t.http().put('/settings/zakat_reminder_days')).send({ value: 99 }).expect(400);
  });

  it('paying it: a draw per partner by ownership, never beyond what is due; then it stays', async () => {
    const paid = zakatReportDetailSchema.parse(
      (
        await as(t.http().post(`/zakat/reports/${report.id}/payments`))
          .send({ amountCents: dh(500), date: '2026-10-25' })
          .expect(201)
      ).body,
    );
    expect(paid.paidCents).toBe(dh(500));
    expect(paid.payments.map((draw) => [draw.partnerId, draw.amountCents])).toEqual([
      [owner, dh(300)],
      [partner, dh(200)],
    ]);
    const account = (await as(t.http().get(`/partners/${owner}/account`)).expect(200)).body as {
      account: { drawsCents: number };
    };
    expect(account.account.drawsCents).toBe(dh(300));

    const above = await as(t.http().post(`/zakat/reports/${report.id}/payments`))
      .send({ amountCents: dh(401), date: '2026-10-25' })
      .expect(400);
    expect(errorResponseSchema.parse(above.body).error.issues).toEqual([
      expect.objectContaining({ message: ZAKAT_ISSUES.aboveDue }),
    ]);
    const kept = await as(t.http().post(`/zakat/reports/${report.id}/void`))
      .send({ reason: 'خطأ' })
      .expect(400);
    expect(errorResponseSchema.parse(kept.body).error.issues).toEqual([
      expect.objectContaining({ message: ZAKAT_ISSUES.hasPayments }),
    ]);

    // With its payments voided, the report can go.
    for (const draw of paid.payments) {
      await as(t.http().post(`/partner-draws/${draw.id}/void`))
        .send({ reason: 'خطأ' })
        .expect(200);
    }
    await as(t.http().post(`/zakat/reports/${report.id}/void`))
      .send({ reason: 'أُعيد الحساب' })
      .expect(200);
  });
});
