import {
  type BatchHistory,
  buildSaleAggregate,
  errorResponseSchema,
  HEADERS,
  newSaleSchema,
  PARTNER_ISSUES,
  SETTLEMENT_ISSUES,
  settlementDetailSchema,
  settlementPreviewSchema,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';
import { stockKit } from './support/stock.js';

const dh = (amount: number) => amount * 100;

/**
 * More than one partner (docs/accounting-assumptions.md S17, S18): the owner at 50%, Ana at 30%,
 * Bilal (who joins later) at 20% of the shop's capital.
 */
describe('a settlement with three participants (S17, S18)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const ana = crypto.randomUUID();
  const bilal = crypto.randomUUID();
  /** Joins at the end, takes 10% from Bilal, and is removed again (S19). */
  const carol = crypto.randomUUID();
  let kit: ReturnType<typeof stockKit>;
  let roll = '';
  let clock = Date.UTC(2026, 7, 1, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    // Ana is entered first, Bilal after her: she is the shop's first partner (S17).
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${ana}`))
      .send({ name: 'آنا', ownershipBp: 3000, isOwner: false })
      .expect(200);
    await as(t.http().put(`/partners/${bilal}`))
      .send({ name: 'بلال', ownershipBp: 2000, isOwner: false })
      .expect(200);
    kit = stockKit(t, () => session, push);
    const productId = await kit.product({ minPricePerMeterCents: 1000 });
    roll = (
      await kit.buy({ productId, date: '2026-08-01', quantity: 10_000, totalCostCents: 160_000 })
    ).id;
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

  /** 100 m of the roll sold for 2000 dh in cash (cost 1600 dh). */
  async function sellAll(date: string) {
    const history = await kit.history(roll);
    const built = buildSaleAggregate(
      newSaleSchema.parse({
        date,
        customerId: null,
        lines: [
          {
            batchId: roll,
            unit: 'meter',
            quantity: 10_000,
            price: { perUnitCents: 2000 },
            refPriceCents: 2000,
            minPriceCents: 1000,
          },
        ],
        paidCents: dh(2000),
      }),
      new Map<string, BatchHistory>([[roll, history]]),
      {
        saleId: crypto.randomUUID(),
        lineIds: [crypto.randomUUID()],
        moveIds: [crypto.randomUUID()],
        paymentId: crypto.randomUUID(),
        allocationId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: tick() },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const [result] = await push({
      opId: crypto.randomUUID(),
      entity: 'sale',
      entityId: built.aggregate.sale.id,
      kind: 'append',
      payload: built.aggregate,
      deviceId: 'desk',
      clientTs: new Date(clock).toISOString(),
      baseServerSeq: null,
    });
    expect(result?.status).toBe('applied');
  }

  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  const rule = (partnerWeights: { partnerId: string; weight: number }[] | null, extra = {}) => ({
    effectiveFrom: '2099-01-01',
    ownerWeight: 2,
    partnerWeight: 2,
    shopWeight: 1,
    partnerWeights,
    ...extra,
  });

  it('a rule written before there were several partners belongs to the first one: Bilal takes no part in August', async () => {
    await sellAll('2026-08-05');
    await as(t.http().put(`/expenses/${crypto.randomUUID()}`))
      .send({ date: '2026-08-20', category: 'rent', amountCents: dh(100), paidDate: '2026-08-20' })
      .expect(200);

    // 400 + 200 − 100 = 300 dh, in the default thirds: owner, Ana (the one partner), the shop.
    const { breakdown, ...preview } = settlementPreviewSchema.parse(
      (await as(t.http().get('/settlements/preview?end=2026-08-31')).expect(200)).body,
    );
    expect(preview).toMatchObject({
      netProfitCents: 30_000,
      ownerShareCents: 10_000,
      partnerShareCents: 10_000,
      shopShareCents: 10_000,
    });
    expect(preview.shares.map((share) => [share.partnerId, share.amountCents])).toEqual([
      [owner, 10_000],
      [ana, 10_000],
    ]);

    const settled = settlementDetailSchema.parse(
      (
        await as(t.http().post('/settlements'))
          .send({ periodEnd: '2026-08-31', expected: breakdown })
          .expect(201)
      ).body,
    );
    expect(settled.shares.map((share) => [share.partnerId, share.amountCents])).toEqual([
      [owner, 10_000],
      [ana, 10_000],
    ]);

    // The shop's third stays in the business as capital, by what each put in: 50 / 30 / 20.
    const retained = Object.fromEntries(
      settled.retainedProfit.map((move) => [move.partnerId, move.amountCents]),
    );
    expect(retained).toEqual({ [owner]: 5000, [ana]: 3000, [bilal]: 2000 });
    expect(settled.retainedProfit.reduce((sum, move) => sum + move.amountCents, 0)).toBe(10_000);
    expect(settled.retainedProfit.every((move) => move.type === 'retained_profit')).toBe(true);

    // Each account shows only its own: Bilal holds capital, not a share of the profit.
    const account = async (id: string) =>
      (
        (await as(t.http().get(`/partners/${id}/account`)).expect(200)).body as {
          account: Record<string, number>;
        }
      ).account;
    expect(await account(ana)).toMatchObject({
      retainedProfitCents: 3000,
      sharesCents: 10_000,
      undrawnCents: 10_000,
    });
    expect(await account(bilal)).toMatchObject({
      retainedProfitCents: 2000,
      sharesCents: 0,
      undrawnCents: 0,
    });
  });

  it('a future rule names every partner’s weight; they add up to the partners’ weight (S17)', async () => {
    const put = (weights: { partnerId: string; weight: number }[] | null, extra = {}) =>
      as(t.http().put(`/split-rules/${crypto.randomUUID()}`)).send(rule(weights, extra));

    // With two partners the rule has to say who gets what.
    const unnamed = await put(null).expect(400);
    expect(errorOf(unnamed.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleNeedsPartners }),
    ]);
    const stranger = await put([
      { partnerId: crypto.randomUUID(), weight: 1 },
      { partnerId: bilal, weight: 1 },
    ]).expect(400);
    expect(errorOf(stranger.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
    const twice = await put([
      { partnerId: ana, weight: 1 },
      { partnerId: ana, weight: 1 },
    ]).expect(400);
    expect(errorOf(twice.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleUnknownPartner }),
    ]);
    const mismatch = await put([
      { partnerId: ana, weight: 1 },
      { partnerId: bilal, weight: 2 },
    ]).expect(400);
    expect(errorOf(mismatch.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleWeightsMismatch }),
    ]);

    const id = crypto.randomUUID();
    await as(t.http().put(`/split-rules/${id}`))
      .send(
        rule([
          { partnerId: ana, weight: 1 },
          { partnerId: bilal, weight: 1 },
        ]),
      )
      .expect(200);
    const stored = (await as(t.http().get('/split-rules')).expect(200)).body as {
      id: string;
      partnerWeights: { partnerId: string; weight: number }[] | null;
    }[];
    expect(stored.find((row) => row.id === id)?.partnerWeights).toEqual([
      { partnerId: ana, weight: 1 },
      { partnerId: bilal, weight: 1 },
    ]);
    // Only one rule on a date; the second try on 2099-01-01 is refused.
    const second = await put(
      [
        { partnerId: ana, weight: 2 },
        { partnerId: bilal, weight: 0 },
      ],
      { partnerWeight: 2 },
    ).expect(400);
    expect(errorOf(second.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleDateTaken }),
    ]);
  });

  it('the partners together can never be more than the whole shop (S4)', async () => {
    // Ana at 30% and Bilal at 20% with the owner at 50% is the whole shop: nobody else fits.
    const refused = await as(t.http().put(`/partners/${carol}`))
      .send({ name: 'كارول', ownershipBp: 1000, isOwner: false })
      .expect(400);
    expect(errorOf(refused.body).issues).toEqual([
      expect.objectContaining({ message: PARTNER_ISSUES.ownershipOver }),
    ]);
    // Room is made first, then the newcomer fits.
    await as(t.http().put(`/partners/${bilal}`))
      .send({ name: 'بلال', ownershipBp: 1000, isOwner: false })
      .expect(200);
    await as(t.http().put(`/partners/${carol}`))
      .send({ name: 'كارول', ownershipBp: 1000, isOwner: false })
      .expect(200);
  });

  it('a partner who takes part in nothing is removed, and the settlement goes on without them (S19)', async () => {
    const remove = (id: string) =>
      as(t.http().post(`/partners/${id}/void`)).send({ reason: 'غادر الشراكة' });
    const messages = (body: unknown) => (errorOf(body).issues ?? []).map((issue) => issue.message);

    // The owner is never removed; a partner who owns a part stays until it is given away.
    expect(messages((await remove(owner).expect(400)).body)).toEqual([PARTNER_ISSUES.ownerStays]);
    expect(messages((await remove(carol).expect(400)).body)).toEqual([PARTNER_ISSUES.hasOwnership]);
    // Ana and Bilal were settled with, and the future rule gives them a weight; Ana also holds the
    // rules that name no one.
    expect(messages((await remove(ana).expect(400)).body)).toEqual([
      PARTNER_ISSUES.hasOwnership,
      PARTNER_ISSUES.hasRecords,
      PARTNER_ISSUES.inProfitSplit,
    ]);
    expect(messages((await remove(bilal).expect(400)).body)).toEqual([
      PARTNER_ISSUES.hasOwnership,
      PARTNER_ISSUES.hasRecords,
      PARTNER_ISSUES.inProfitSplit,
    ]);

    // Carol gives her part back to Bilal; then she can go.
    await as(t.http().put(`/partners/${carol}`))
      .send({ name: 'كارول', ownershipBp: 0, isOwner: false })
      .expect(200);
    await as(t.http().put(`/partners/${bilal}`))
      .send({ name: 'بلال', ownershipBp: 2000, isOwner: false })
      .expect(200);
    await remove(carol).expect(200);

    const partners = (await as(t.http().get('/partners')).expect(200)).body as {
      id: string;
      voidedAt: string | null;
    }[];
    expect(partners.find((p) => p.id === carol)?.voidedAt).not.toBeNull();
    expect(partners.filter((p) => p.voidedAt === null).map((p) => p.id)).toEqual([
      owner,
      ana,
      bilal,
    ]);
    // August is settled; the next period is previewed with the three who are left.
    await as(t.http().put(`/expenses/${crypto.randomUUID()}`))
      .send({ date: '2026-09-10', category: 'rent', amountCents: dh(100), paidDate: '2026-09-10' })
      .expect(200);
    const preview = settlementPreviewSchema.parse(
      (await as(t.http().get('/settlements/preview?end=2026-09-30')).expect(200)).body,
    );
    expect(preview.netProfitCents).toBe(-dh(100));
    expect(preview.shares.map((share) => share.partnerId)).not.toContain(carol);
  });
});
