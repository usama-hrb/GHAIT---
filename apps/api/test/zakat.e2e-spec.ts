import {
  accessTokenResponseSchema,
  addDays,
  errorResponseSchema,
  HEADERS,
  shopDate,
  storedZakatReportSchema,
  type SyncOp,
  syncPushResponseSchema,
  ZAKAT_ISSUES,
  type ZakatReport,
  zakatDrawIdOf,
  zakatReportDetailSchema,
  zakatReportFieldsOf,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsService } from '../src/modules/accounts/index.js';
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
            remainingPieces: 0,
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

  /** T14's position saved for `hawlDate`, as a device would: 900 dh due when the hawl is completed. */
  function reportFor(hawlDate: string, hawlCompleted = true): ZakatReport {
    const fields = zakatReportFieldsOf(
      {
        goods: [],
        cashCents: dh(36_000),
        receivables: [],
        debts: [],
        supplierDebts: [],
      },
      {
        hawlDate,
        hawlCompleted,
        settings: { nisabMetal: 'gold', goodsValuation: 'market', includeDoubtfulDebts: false },
        metalPrice: { pricePerGramCents: dh(300), date: '2026-10-19' },
      },
    );
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      deviceId: 'desk',
      voidedAt: null,
      ...fields,
    };
  }

  it('a report is saved only for a hawl that has come: not one that says it is unfinished, not one ahead of the shop’s day', async () => {
    const today = shopDate(new Date());
    expect(await push(reportFor('2026-09-01', false))).toMatchObject({
      status: 'rejected',
      error: { issues: [expect.objectContaining({ message: ZAKAT_ISSUES.hawlNotReached })] },
    });
    expect(await push(reportFor(addDays(today, 3)))).toMatchObject({
      status: 'rejected',
      error: { issues: [expect.objectContaining({ message: ZAKAT_ISSUES.hawlInFuture })] },
    });
    // Today's hawl, and tomorrow's for a device whose clock runs a little fast, are accepted.
    expect(await push(reportFor(addDays(today, 1)))).toMatchObject({ status: 'applied' });
  });

  describe('a payment that names itself is recorded once', () => {
    let target: ZakatReport;
    const paymentId = crypto.randomUUID();
    const body = { amountCents: dh(300), date: '2026-10-25', paymentId, note: 'إيصال 42 · حسن' };
    const payOn = (id: string, payload: Record<string, unknown>) =>
      as(t.http().post(`/zakat/reports/${id}/payments`)).send(payload);

    beforeAll(async () => {
      target = reportFor('2026-09-15');
      expect(await push(target)).toMatchObject({ status: 'applied' });
    });

    it('draws that follow the payment’s id, and carry its note', async () => {
      const first = zakatReportDetailSchema.parse((await payOn(target.id, body).expect(201)).body);
      expect(first.paidCents).toBe(dh(300));
      expect(first.payments.map((draw) => draw.id).sort()).toEqual(
        [zakatDrawIdOf(paymentId, owner), zakatDrawIdOf(paymentId, partner)].sort(),
      );
      for (const draw of first.payments) {
        expect(draw.reason).toBe('zakat 2026-09-15 · إيصال 42 · حسن');
        expect(draw.zakatReportId).toBe(target.id);
      }
    });

    it('sent again, it changes nothing and answers as before, even once nothing more can be paid', async () => {
      const again = zakatReportDetailSchema.parse((await payOn(target.id, body).expect(201)).body);
      expect(again.paidCents).toBe(dh(300));
      expect(again.payments).toHaveLength(2);
      // The rest of what is due, paid as a payment of its own...
      await payOn(target.id, {
        amountCents: dh(600),
        date: '2026-10-26',
        paymentId: crypto.randomUUID(),
      }).expect(201);
      // ...and the first one, sent a third time, still answers instead of being "above what is due".
      const third = zakatReportDetailSchema.parse((await payOn(target.id, body).expect(201)).body);
      expect(third.paidCents).toBe(dh(900));
      expect(third.payments).toHaveLength(4);
      // But nothing new fits now.
      const above = await payOn(target.id, {
        amountCents: dh(1),
        date: '2026-10-26',
        paymentId: crypto.randomUUID(),
      }).expect(400);
      expect(errorResponseSchema.parse(above.body).error.issues).toEqual([
        expect.objectContaining({ message: ZAKAT_ISSUES.aboveDue }),
      ]);
    });

    it('an id already used for another amount or day is refused, not recorded again', async () => {
      for (const changed of [{ amountCents: dh(100) }, { date: '2026-10-30' }]) {
        const refused = await payOn(target.id, { ...body, ...changed }).expect(400);
        expect(errorResponseSchema.parse(refused.body).error.issues).toEqual([
          expect.objectContaining({ message: ZAKAT_ISSUES.paymentReused }),
        ]);
      }
      const after = zakatReportDetailSchema.parse(
        (await as(t.http().get(`/zakat/reports/${target.id}`)).expect(200)).body,
      );
      expect(after.paidCents).toBe(dh(900));
      // Each draw was audited once, when it was made: a payment sent again leaves no entry.
      const audited = await t.sql.query<{ entity_id: string; action: string }>(
        `SELECT entity_id, action FROM audit_log WHERE entity = 'partner_draw' AND entity_id = ANY($1)`,
        [after.payments.map((draw) => draw.id)],
      );
      expect(audited.rows).toHaveLength(after.payments.length);
      expect(new Set(audited.rows.map((row) => row.action))).toEqual(new Set(['create']));
    });

    it('without an id it still works as before: each request is a payment of its own', async () => {
      const fresh = reportFor('2026-08-10');
      expect(await push(fresh)).toMatchObject({ status: 'applied' });
      for (const amount of [dh(100), dh(100)]) {
        await payOn(fresh.id, { amountCents: amount, date: '2026-10-26' }).expect(201);
      }
      const detail = zakatReportDetailSchema.parse(
        (await as(t.http().get(`/zakat/reports/${fresh.id}`)).expect(200)).body,
      );
      expect(detail.paidCents).toBe(dh(200));
      expect(detail.payments).toHaveLength(4);
      for (const draw of detail.payments) expect(draw.reason).toBe('zakat 2026-08-10');
    });
  });

  it('a partner’s login reads the report list, and can neither read a report’s payments nor pay or void one', async () => {
    await t.app.get(AccountsService).setPartnerLogin({
      partner,
      username: 'sara',
      password: 'a-long-partner-password',
      displayName: 'سارة',
    });
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'sara', password: 'a-long-partner-password' })
      .expect(200);
    const token = accessTokenResponseSchema.parse(login.body).accessToken;
    const asPartner = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(token, { type: 'bearer' }).set(HEADERS.deviceId, 'phone');
    const id = report.id;

    await asPartner(t.http().get('/zakat/reports')).expect(200);
    await asPartner(t.http().get(`/zakat/reports/${id}`)).expect(403);
    const refused = await asPartner(t.http().post(`/zakat/reports/${id}/payments`))
      .send({ amountCents: dh(1), date: '2026-10-26', paymentId: crypto.randomUUID() })
      .expect(403);
    expect(errorResponseSchema.parse(refused.body).error.code).toBe('forbidden');
    await asPartner(t.http().post(`/zakat/reports/${id}/void`))
      .send({ reason: 'x' })
      .expect(403);
  });
});
