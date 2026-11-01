import {
  buildPurchaseAggregate,
  errorResponseSchema,
  buildSaleAggregate,
  buildSaleReturn,
  HEADERS,
  integrityReportSchema,
  type NewSaleInput,
  newSaleSchema,
  type NewSaleReturn,
  RETURN_ISSUES,
  type Roll,
  rollCode,
  rollDetailSchema,
  settlementPreviewSchema,
  type SaleAggregate,
  type SaleDetail,
  saleDetailSchema,
  SALE_ISSUES,
  type SaleReturnAggregate,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const DAY = '2026-10-30';

describe('returns (BUILD_PROMPTS 5.3, RT1–RT4)', () => {
  let t: TestApp;
  let session: Session;
  const variantId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
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
    await as(t.http().put(`/customers/${customerId}`))
      .send({ name: 'فاطمة', phone: '0612345678' })
      .expect(200);
    // A settlement needs the two partners.
    await as(t.http().put(`/partners/${crypto.randomUUID()}`))
      .send({ name: 'أنا', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${crypto.randomUUID()}`))
      .send({ name: 'شريكي', ownershipBp: 5000, isOwner: false })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const op = (entity: SyncOp['entity'], entityId: string, payload: unknown): SyncOp => ({
    opId: crypto.randomUUID(),
    entity,
    entityId,
    kind: 'append',
    payload,
    deviceId: 'desk',
    clientTs: new Date(clock).toISOString(),
    baseServerSeq: null,
  });

  const push = async (...ops: SyncOp[]): Promise<SyncOpResult[]> => {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  };

  /** T1's roll: 50 m that cost 800 dh (16 dh/m). */
  async function rosa(): Promise<Roll> {
    const aggregate = buildPurchaseAggregate(
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
        shortCodes: [rollCode('A', ++counter)],
      },
      { deviceId: 'desk', now: tick() },
    );
    const [result] = await push(op('purchase', aggregate.purchase.id, aggregate));
    expect(result?.status).toBe('applied');
    const [roll] = aggregate.rolls;
    if (!roll) throw new Error('no roll');
    return roll;
  }

  async function sell(input: NewSaleInput): Promise<SaleAggregate> {
    const parsed = newSaleSchema.parse(input);
    const histories = new Map(
      await Promise.all(
        [...new Set(parsed.lines.map((line) => line.rollId))].map(async (id) => {
          const detail = rollDetailSchema.parse(
            (await as(t.http().get(`/rolls/${id}`)).expect(200)).body,
          );
          return [id, { roll: detail.roll, moves: detail.moves }] as const;
        }),
      ),
    );
    const built = buildSaleAggregate(
      parsed,
      histories,
      {
        saleId: crypto.randomUUID(),
        lineIds: parsed.lines.map(() => crypto.randomUUID()),
        moveIds: parsed.lines.map(() => crypto.randomUUID()),
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const [result] = await push(op('sale', built.aggregate.sale.id, built.aggregate));
    expect(result?.status).toBe('applied');
    return built.aggregate;
  }

  const issueOf = (body: unknown) => errorResponseSchema.parse(body).error.issues?.[0]?.message;

  const detail = async (saleId: string): Promise<SaleDetail> =>
    saleDetailSchema.parse((await as(t.http().get(`/sales/${saleId}`)).expect(200)).body);

  const ledgerOf = async (rollId: string) =>
    rollDetailSchema.parse((await as(t.http().get(`/rolls/${rollId}`)).expect(200)).body).ledger;

  const integrity = async () =>
    integrityReportSchema.parse((await as(t.http().get('/integrity')).expect(200)).body);

  const line = (rollId: string, soldCm: number, perMeterCents: number) => ({
    rollId,
    soldCm,
    price: { perMeterCents },
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
  });

  /** A device builds a return from the sale as it knows it (here: what it just sent). */
  function giveBackOf(
    aggregate: SaleAggregate,
    input: Omit<NewSaleReturn, 'saleId'>,
    earlier: SaleReturnAggregate[] = [],
  ) {
    const built = buildSaleReturn(
      newSaleReturn(aggregate, input),
      {
        sale: aggregate.sale,
        lines: aggregate.lines,
        moves: aggregate.moves,
        returns: earlier.map((given) => given.saleReturn),
        allocations: aggregate.allocation ? [aggregate.allocation] : [],
        refunds: earlier.flatMap((given) => (given.refund ? [given.refund] : [])),
        writtenOff: false,
      },
      {
        returnId: crypto.randomUUID(),
        moveIds: input.lines.map(() => crypto.randomUUID()),
        refundId: input.refundCents > 0 ? crypto.randomUUID() : null,
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    return built.aggregate;
  }

  const newSaleReturn = (
    aggregate: SaleAggregate,
    input: Omit<NewSaleReturn, 'saleId'>,
  ): NewSaleReturn => ({ ...input, saleId: aggregate.sale.id });

  it('a device’s return puts the cloth back, refunds the cash, and the sale shows what is kept', async () => {
    const roll = await rosa();
    const sold = await sell({ date: DAY, lines: [line(roll.id, 1000, 2000)], paidCents: 20_000 });
    const lineId = sold.lines[0]?.id ?? '';
    const given = giveBackOf(sold, {
      date: DAY,
      reason: 'لم يعجبها اللون',
      lines: [{ lineId, returnedCm: 400 }],
      refundCents: 8000,
    });
    const [result] = await push(op('sale_return', given.saleReturn.id, given));
    expect(result?.status).toBe('applied');

    expect((await detail(sold.sale.id)).figures).toMatchObject({
      totalCents: 20_000,
      returnedCents: 8000,
      netTotalCents: 12_000,
      capitalCents: 9600, // 6 m at 16 dh
      profitCents: 2400,
      paidCents: 12_000,
      dueCents: 0,
      lines: [{ returnedCm: 400, costCents: 9600, profitCents: 2400 }],
    });
    const ledger = await ledgerOf(roll.id);
    expect(ledger.remainingCm).toBe(5000 - 1000 + 400);
    expect(ledger.unallocatedCostCents).toBe(80_000 - 9600);
    expect(ledger.returns).toEqual([
      expect.objectContaining({ saleMoveId: sold.moves[0]?.id, costCents: 6400 }),
    ]);
    expect(await integrity()).toMatchObject({ ok: true, diffCents: 0 });

    // Sent again, the same op answers the same and changes nothing.
    const [again] = await push(op('sale_return', given.saleReturn.id, given));
    expect(again?.status).toBe('applied');
    expect((await detail(sold.sale.id)).figures.returnedCents).toBe(8000);
  });

  it('REST: the server builds the return, and a second one takes only what is left', async () => {
    const roll = await rosa();
    const sold = await sell({
      date: DAY,
      customerId,
      lines: [line(roll.id, 500, 2000)],
      paidCents: 4000,
    });
    const lineId = sold.lines[0]?.id ?? '';
    const first = await as(t.http().post(`/sales/${sold.sale.id}/return`))
      .send({ date: DAY, reason: 'قصيرة', lines: [{ lineId, returnedCm: 200 }] })
      .expect(200);
    // Debt 6000 → 6000 − 4000 credit = 2000 still owed: nothing handed back.
    expect(saleDetailSchema.parse(first.body).figures).toMatchObject({
      returnedCents: 4000,
      netTotalCents: 6000,
      paidCents: 4000,
      dueCents: 2000,
    });

    const refused = await as(t.http().post(`/sales/${sold.sale.id}/return`))
      .send({ date: DAY, reason: 'أكثر', lines: [{ lineId, returnedCm: 301 }] })
      .expect(422);
    expect(issueOf(refused.body)).toBe(RETURN_ISSUES.aboveSold);

    const second = await as(t.http().post(`/sales/${sold.sale.id}/return`))
      .send({
        date: DAY,
        reason: 'الباقي',
        lines: [{ lineId, returnedCm: 300 }],
        refundCents: 4000,
      })
      .expect(200);
    expect(saleDetailSchema.parse(second.body).figures).toMatchObject({
      returnedCents: 10_000,
      netTotalCents: 0,
      dueCents: 0,
    });
    expect((await ledgerOf(roll.id)).remainingCm).toBe(5000);
    expect(await integrity()).toMatchObject({ ok: true });

    const audit = await t.sql.query(
      `SELECT action FROM audit_log WHERE entity = 'sale_return' ORDER BY at`,
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a return that does not add up, or against a sale the server has already given back', async () => {
    const roll = await rosa();
    const sold = await sell({ date: DAY, lines: [line(roll.id, 1000, 2000)], paidCents: 20_000 });
    const lineId = sold.lines[0]?.id ?? '';
    const honest = giveBackOf(sold, {
      date: DAY,
      reason: 'x',
      lines: [{ lineId, returnedCm: 100 }],
      refundCents: 2000,
    });
    const inflated = structuredClone(honest);
    inflated.saleReturn.creditCents += 100;
    const [tampered] = await push(op('sale_return', inflated.saleReturn.id, inflated));
    expect(tampered).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(tampered?.error?.issues?.[0]?.message).toBe(RETURN_ISSUES.notCore);

    // Another device returned the whole line first: this one can no longer return 100 of it.
    const whole = giveBackOf(sold, {
      date: DAY,
      reason: 'كلها',
      lines: [{ lineId, returnedCm: 1000 }],
      refundCents: 20_000,
    });
    expect((await push(op('sale_return', whole.saleReturn.id, whole)))[0]?.status).toBe('applied');
    const [late] = await push(op('sale_return', honest.saleReturn.id, honest));
    expect(late).toMatchObject({ status: 'rejected' });
    expect(late?.error?.issues?.[0]?.message).toBe(RETURN_ISSUES.aboveSold);
  });

  it('a sale with returns cannot be voided; return the rest instead (RT7)', async () => {
    const roll = await rosa();
    const sold = await sell({ date: DAY, lines: [line(roll.id, 400, 2000)], paidCents: 8000 });
    await as(t.http().post(`/sales/${sold.sale.id}/return`))
      .send({
        date: DAY,
        reason: 'جزء',
        lines: [{ lineId: sold.lines[0]?.id ?? '', returnedCm: 100 }],
        refundCents: 2000,
      })
      .expect(200);
    const refused = await as(t.http().post(`/sales/${sold.sale.id}/void`))
      .send({ reason: 'خطأ' })
      .expect(400);
    expect(issueOf(refused.body)).toBe(SALE_ISSUES.hasReturns);
  });

  it('a return is dated in the open period only: a settled day refuses it', async () => {
    const roll = await rosa();
    const sold = await sell({
      date: '2026-09-02',
      lines: [line(roll.id, 300, 2000)],
      paidCents: 6000,
    });
    const preview = settlementPreviewSchema.parse(
      (await as(t.http().get('/settlements/preview?end=2026-09-30')).expect(200)).body,
    );
    await as(t.http().post('/settlements'))
      .send({ periodEnd: '2026-09-30', expected: preview.breakdown })
      .expect(201);
    const june = giveBackOf(sold, {
      date: '2026-09-20',
      reason: 'قديم',
      lines: [{ lineId: sold.lines[0]?.id ?? '', returnedCm: 100 }],
      refundCents: 2000,
    });
    const [locked] = await push(op('sale_return', june.saleReturn.id, june));
    expect(locked).toMatchObject({ status: 'rejected', error: { code: 'period_locked' } });

    // Dated after the settlement it is accepted, and lowers that open period.
    const octoberEffect = async () =>
      settlementPreviewSchema.parse(
        (await as(t.http().get('/settlements/preview?end=2026-10-30')).expect(200)).body,
      ).returnsEffectCents;
    const before = await octoberEffect();
    const october = giveBackOf(sold, {
      date: DAY,
      reason: 'جديد',
      lines: [{ lineId: sold.lines[0]?.id ?? '', returnedCm: 100 }],
      refundCents: 2000,
    });
    expect((await push(op('sale_return', october.saleReturn.id, october)))[0]?.status).toBe(
      'applied',
    );
    expect(await integrity()).toMatchObject({ ok: true, diffCents: 0 });
    // 3 m sold for 60 dh (cost 48, profit 12 booked in September); 1 m back: the kept 2 m earn 8.
    expect((await octoberEffect()) - before).toBe(-400);
  });
});
