import {
  buildPurchaseAggregate,
  buildSaleAggregate,
  buildWriteOff,
  type CustomerAccountDetail,
  customerAccountDetailSchema,
  debtSummarySchema,
  errorResponseSchema,
  HEADERS,
  newSaleSchema,
  type NewSaleInput,
  RECEIVABLE_ISSUES,
  rollCode,
  rollDetailSchema,
  saleDetailSchema,
  type SyncOp,
  type SyncOpResult,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('customers, credit and payments (BUILD_PROMPTS 3.5)', () => {
  let t: TestApp;
  let session: Session;
  const variantId = crypto.randomUUID();
  let rollId: string;
  let counter = 0;
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

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
    // T1's roll, large enough for every sale here: 16 dh/m.
    const aggregate = buildPurchaseAggregate(
      {
        method: 'meter',
        date: '2026-09-01',
        supplierId: null,
        notes: null,
        pricePerMeterCents: 1600,
        rolls: [{ variantId, lengthCm: 50_000 }],
      },
      {
        purchaseId: crypto.randomUUID(),
        rollIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        shortCodes: [rollCode('A', ++counter)],
      },
      { deviceId: 'desk', now: tick() },
    );
    await push(op('purchase', aggregate.purchase.id, aggregate));
    rollId = aggregate.rolls[0]?.id ?? '';
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  async function push(...ops: SyncOp[]): Promise<SyncOpResult[]> {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  }

  function op(entity: SyncOp['entity'], entityId: string, payload: unknown): SyncOp {
    return {
      opId: crypto.randomUUID(),
      entity,
      entityId,
      kind: 'append',
      payload,
      deviceId: 'desk',
      clientTs: new Date(clock).toISOString(),
      baseServerSeq: null,
    };
  }

  async function customer(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await as(t.http().put(`/customers/${id}`))
      .send({ name })
      .expect(200);
    return id;
  }

  /** A credit sale of `meters` at `perMeterCents`, nothing paid, on `date`. */
  async function creditSale(
    customerId: string,
    soldCm: number,
    perMeterCents: number,
    date: string,
  ) {
    const detail = rollDetailSchema.parse(
      (await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body,
    );
    const input: NewSaleInput = {
      date,
      customerId,
      lines: [
        {
          rollId,
          soldCm,
          price: { perMeterCents },
          refPricePerMeterCents: 2000,
          minPricePerMeterCents: 1700,
        },
      ],
      paidCents: 0,
    };
    const built = buildSaleAggregate(
      newSaleSchema.parse(input),
      new Map([[rollId, { roll: detail.roll, moves: detail.moves }]]),
      {
        saleId: crypto.randomUUID(),
        lineIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        paymentId: null,
        allocationId: null,
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const [result] = await push(op('sale', built.aggregate.sale.id, built.aggregate));
    expect(result?.status).toBe('applied');
    return built.aggregate.sale.id;
  }

  const account = async (id: string): Promise<CustomerAccountDetail> =>
    customerAccountDetailSchema.parse(
      (await as(t.http().get(`/customers/${id}/account`)).expect(200)).body,
    );

  const pay = (id: string, body: object) =>
    as(t.http().post(`/customers/${id}/payments`)).send(body);

  it('T8: 200 dh costing 160, paid 100 then 100 → capital 100 / 0, then 60 / 40', async () => {
    const fatima = await customer('فاطمة');
    const saleId = await creditSale(fatima, 1000, 2000, '2026-10-01');
    await pay(fatima, { amountCents: 10_000, date: '2026-10-10', targetSaleId: saleId }).expect(
      201,
    );
    await pay(fatima, { amountCents: 10_000, date: '2026-10-20' }).expect(201);
    const sale = saleDetailSchema.parse(
      (await as(t.http().get(`/sales/${saleId}`)).expect(200)).body,
    );
    expect(
      sale.figures.payments.map((p) => [p.amountCents, p.capitalCents, p.profitCents]),
    ).toEqual([
      [10_000, 10_000, 0],
      [10_000, 6000, 4000],
    ]);
    expect((await account(fatima)).account).toMatchObject({ balanceCents: 0, collectibleCents: 0 });
  });

  it('an overpayment is credit: refunded (never beyond it) or applied to the next invoice', async () => {
    const amina = await customer('أمينة');
    const first = await creditSale(amina, 100, 2000, '2026-10-01');
    const after = customerAccountDetailSchema.parse(
      (await pay(amina, { amountCents: 3000, date: '2026-10-05', targetSaleId: first }).expect(201))
        .body,
    );
    expect(after.account).toMatchObject({
      balanceCents: -1000,
      creditCents: 1000,
      collectibleCents: 0,
    });

    const tooMuch = await as(t.http().post(`/customers/${amina}/refunds`))
      .send({ amountCents: 1500, date: '2026-10-06' })
      .expect(400);
    expect(errorResponseSchema.parse(tooMuch.body).error.message).toBe(
      RECEIVABLE_ISSUES.aboveCredit,
    );
    await as(t.http().post(`/customers/${amina}/refunds`))
      .send({ amountCents: 400, date: '2026-10-06' })
      .expect(201);

    await creditSale(amina, 100, 2000, '2026-10-07');
    const applied = customerAccountDetailSchema.parse(
      (await as(t.http().post(`/customers/${amina}/apply-credit`)).expect(200)).body,
    );
    expect(applied.account).toMatchObject({
      creditCents: 0,
      collectibleCents: 1400,
      balanceCents: 1400,
    });
    // Balance = Σ sales − Σ payments + Σ refunds.
    expect(applied.account.balanceCents).toBe(2000 + 2000 - 3000 + 400);
    await as(t.http().post(`/customers/${amina}/apply-credit`)).expect(400);
  });

  it('a bad debt is written off once; who owes me lists the oldest debt first', async () => {
    const [omar, said] = [await customer('عمر'), await customer('سعيد')];
    const omarSale = await creditSale(omar, 300, 2000, '2026-08-01');
    await creditSale(said, 500, 2000, '2026-09-15');
    let debts = (await as(t.http().get('/customers/debts')).expect(200)).body as unknown[];
    const names = () => debts.map((entry) => debtSummarySchema.parse(entry).customer.name);
    expect(names().indexOf('عمر')).toBeLessThan(names().indexOf('سعيد'));

    const writtenOff = customerAccountDetailSchema.parse(
      (
        await as(t.http().post(`/customers/${omar}/write-offs`))
          .send({ saleId: omarSale, reason: 'سافر' })
          .expect(201)
      ).body,
    );
    expect(writtenOff.account).toMatchObject({
      collectibleCents: 0,
      writtenOffCents: 6000,
      balanceCents: 6000,
    });
    debts = (await as(t.http().get('/customers/debts')).expect(200)).body as unknown[];
    expect(names()).not.toContain('عمر');
    await as(t.http().post(`/customers/${omar}/write-offs`))
      .send({ saleId: omarSale, reason: 'مرة أخرى' })
      .expect(400);
    await as(t.http().post(`/customers/${said}/write-offs`))
      .send({ saleId: omarSale, reason: 'x' })
      .expect(404);

    // Paid later anyway: a recovery on that invoice (S5).
    const recovered = customerAccountDetailSchema.parse(
      (
        await pay(omar, { amountCents: 6000, date: '2026-10-30', targetSaleId: omarSale }).expect(
          201,
        )
      ).body,
    );
    expect(recovered.account).toMatchObject({ writtenOffCents: 0, balanceCents: 0 });
  });

  it('pushed payments, credit and write-offs are checked; devices pull them', async () => {
    const [hind, other] = [await customer('هند'), await customer('آخر')];
    const saleId = await creditSale(hind, 100, 2000, '2026-10-01');
    const otherSale = await creditSale(other, 100, 2000, '2026-10-01');
    const now = tick();
    const base = { createdAt: now, updatedAt: now, deviceId: 'desk', voidedAt: null };
    const payment = {
      ...base,
      id: crypto.randomUUID(),
      customerId: hind,
      kind: 'payment' as const,
      amountCents: 1500,
      date: DAY,
      method: 'cash' as const,
      note: null,
    };
    const allocation = (sale: string, amountCents: number, paymentId = payment.id) => ({
      ...base,
      id: crypto.randomUUID(),
      paymentId,
      saleId: sale,
      amountCents,
      date: DAY,
    });
    const results = await push(
      op('payment', payment.id, { payment, allocations: [allocation(saleId, 1600)] }),
      op('payment', payment.id, { payment, allocations: [allocation(otherSale, 1000)] }),
      op('payment', payment.id, { payment, allocations: [allocation(saleId, 1000)] }),
    );
    expect(results.map((r) => [r.status, r.error?.issues?.[0]?.message])).toEqual([
      ['rejected', RECEIVABLE_ISSUES.overApplied],
      ['rejected', RECEIVABLE_ISSUES.otherCustomer],
      ['applied', undefined],
    ]);
    // 500 left on the payment: applying 600 of it is refused, 500 is fine.
    const tooMuch = allocation(saleId, 600);
    const enough = allocation(saleId, 500);
    const credit = await push(
      op('payment_allocation', tooMuch.id, { allocations: [tooMuch] }),
      op('payment_allocation', enough.id, { allocations: [enough] }),
    );
    expect(credit.map((r) => r.status)).toEqual(['rejected', 'applied']);
    expect((await account(hind)).account).toMatchObject({ collectibleCents: 500, creditCents: 0 });

    const writeOff = buildWriteOff(
      { saleId, reason: 'لن تدفع', date: DAY },
      { id: crypto.randomUUID() },
      { deviceId: 'desk', now: tick() },
    );
    const [written] = await push(op('write_off', writeOff.id, writeOff));
    expect(written?.status).toBe('applied');

    const pulled = syncPullResponseSchema.parse(
      (await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200)).body,
    );
    const entities = new Set(pulled.changes.map((change) => change.entity));
    for (const entity of ['payment', 'payment_allocation', 'write_off'])
      expect(entities).toContain(entity);
  });
});

const DAY = '2026-10-30';
