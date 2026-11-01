import {
  buildPurchaseAggregate,
  errorResponseSchema,
  HEADERS,
  integrityReportSchema,
  PURCHASE_ISSUES,
  rollCode,
  type SyncOp,
  type SyncOpResult,
  SUPPLIER_PAYMENT_ISSUES,
  supplierPayableSchema,
  supplierStatementDetailSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('supplier payables (BUILD_PROMPTS 5.3, SP1–SP4)', () => {
  let t: TestApp;
  let session: Session;
  const variantId = crypto.randomUUID();
  const supplierId = crypto.randomUUID();
  let counter = 0;

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    const fabricId = crypto.randomUUID();
    await as(t.http().put(`/fabrics/${fabricId}`))
      .send({ name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1700 })
      .expect(200);
    await as(t.http().put(`/variants/${variantId}`))
      .send({ fabricId, colorName: 'أحمر' })
      .expect(200);
    await as(t.http().put(`/suppliers/${supplierId}`))
      .send({ name: 'مورد الأقمشة', phone: '0522000000' })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const push = async (op: SyncOp): Promise<SyncOpResult | undefined> => {
    const response = await as(t.http().post('/sync/push'))
      .send({ ops: [op] })
      .expect(200);
    return syncPushResponseSchema.parse(response.body).results[0];
  };

  /** 50 m at 16 dh/m = 800 dh, from the supplier unless said otherwise. */
  async function buy(paidCents: number | undefined, from: string | null = supplierId) {
    const aggregate = buildPurchaseAggregate(
      {
        method: 'meter',
        date: '2026-10-01',
        supplierId: from,
        paidCents,
        notes: null,
        pricePerMeterCents: 1600,
        rolls: [{ variantId, lengthCm: 5000 }],
      },
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('A', ++counter)],
      },
      { deviceId: 'desk', now: new Date().toISOString() },
    );
    const result = await push({
      opId: crypto.randomUUID(),
      entity: 'purchase',
      entityId: aggregate.purchase.id,
      kind: 'append',
      payload: aggregate,
      deviceId: 'desk',
      clientTs: new Date().toISOString(),
      baseServerSeq: null,
    });
    return { aggregate, result };
  }

  const statement = async () =>
    supplierStatementDetailSchema.parse(
      (await as(t.http().get(`/suppliers/${supplierId}/statement`)).expect(200)).body,
    );

  it('a purchase part paid leaves a debt to the supplier, in their statement and the payables', async () => {
    const { aggregate, result } = await buy(30_000);
    expect(result?.status).toBe('applied');
    expect(aggregate.purchase).toMatchObject({ totalCostCents: 80_000, paidCents: 30_000 });

    const owed = await statement();
    expect(owed.account).toMatchObject({ balanceCents: 50_000, owedCents: 50_000 });
    expect(owed.statement.map((entry) => [entry.kind, entry.balanceCents])).toEqual([
      ['purchase', 80_000],
      ['paid_at_purchase', 50_000],
    ]);
    const payables = z
      .array(supplierPayableSchema)
      .parse((await as(t.http().get('/supplier-payables')).expect(200)).body);
    expect(payables.map((row) => [row.supplier.id, row.account.owedCents])).toEqual([
      [supplierId, 50_000],
    ]);
  });

  it('the integrity check carries the debt as a claim, and it holds', async () => {
    await as(t.http().put(`/partners/${crypto.randomUUID()}`))
      .send({ name: 'أنا', ownershipBp: 5000, isOwner: true })
      .expect(200);
    const report = integrityReportSchema.parse(
      (await as(t.http().get('/integrity')).expect(200)).body,
    );
    const line = report.breakdown.find((entry) => entry.key === 'supplier_payables');
    expect(line).toEqual({ side: 'claims', key: 'supplier_payables', cents: 50_000 });
    // Nothing paid in (no capital), so the check shows the purchase as it is: stock 800, cash −300.
    expect(report.breakdown.find((entry) => entry.key === 'stock_at_cost')?.cents).toBe(80_000);
    expect(report.breakdown.find((entry) => entry.key === 'cash')?.cents).toBe(-30_000);
  });

  it('paying the supplier lowers the debt; never beyond it; a payment can be voided', async () => {
    const paid = await as(t.http().post(`/suppliers/${supplierId}/payments`))
      .send({ amountCents: 20_000, date: '2026-10-20', method: 'bank' })
      .expect(200);
    const after = supplierStatementDetailSchema.parse(paid.body);
    expect(after.account.balanceCents).toBe(30_000);
    expect(after.payments).toHaveLength(1);

    const refused = await as(t.http().post(`/suppliers/${supplierId}/payments`))
      .send({ amountCents: 30_001, date: '2026-10-21' })
      .expect(400);
    expect(errorResponseSchema.parse(refused.body).error.issues?.[0]?.message).toBe(
      SUPPLIER_PAYMENT_ISSUES.aboveOwed,
    );

    const paymentId = after.payments[0]?.id ?? '';
    await as(t.http().post(`/supplier-payments/${paymentId}/void`))
      .send({ reason: 'أخطأت في المبلغ' })
      .expect(200);
    expect((await statement()).account.balanceCents).toBe(50_000);

    await as(t.http().post(`/suppliers/${supplierId}/payments`))
      .send({ amountCents: 50_000, date: '2026-10-22' })
      .expect(200);
    expect((await statement()).account.owedCents).toBe(0);
    const payables = (await as(t.http().get('/supplier-payables')).expect(200)).body as unknown[];
    expect(payables).toEqual([]);
    const audit = await t.sql.query(
      `SELECT action FROM audit_log WHERE entity = 'supplier_payment' ORDER BY at`,
    );
    expect(audit.rows.map((row: { action: string }) => row.action)).toEqual([
      'create',
      'void',
      'create',
    ]);
  });

  it('devices pull the payments, and push them themselves; a debt without a supplier is refused', async () => {
    const pulled = syncPullResponseSchema.parse(
      (await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200)).body,
    );
    expect(pulled.changes.filter((change) => change.entity === 'supplier_payment')).toHaveLength(2);

    const { result } = await buy(10_000, null);
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(result?.error?.issues?.[0]?.message).toBe(PURCHASE_ISSUES.debtNeedsSupplier);

    const { aggregate } = await buy(0);
    const now = new Date().toISOString();
    const own = await push({
      opId: crypto.randomUUID(),
      entity: 'supplier_payment',
      entityId: crypto.randomUUID(),
      kind: 'upsert',
      payload: {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deviceId: 'desk',
        voidedAt: null,
        supplierId,
        purchaseId: aggregate.purchase.id,
        amountCents: 80_001,
        date: '2026-10-23',
        method: 'cash',
        note: null,
      },
      deviceId: 'desk',
      clientTs: now,
      baseServerSeq: null,
    });
    // entityId and payload.id differ: the op does not match its record.
    expect(own).toMatchObject({ status: 'rejected' });
  });
});
