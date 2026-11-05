import {
  errorResponseSchema,
  HEADERS,
  PARTNER_ISSUES,
  type SyncOp,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('partners, capital and draws (BUILD_PROMPTS 4.2)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 5000, isOwner: false })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const account = async (id: string) =>
    (
      (await as(t.http().get(`/partners/${id}/account`)).expect(200)).body as {
        account: Record<string, number>;
      }
    ).account;

  it('balances come from the records only: contributions, a withdrawal with its reason, draws', async () => {
    await as(t.http().put(`/capital-moves/${crypto.randomUUID()}`))
      .send({ partnerId: owner, kind: 'contribution', amountCents: 5_000_000, date: '2026-10-01' })
      .expect(200);
    await as(t.http().put(`/capital-moves/${crypto.randomUUID()}`))
      .send({
        partnerId: partner,
        kind: 'contribution',
        amountCents: 5_000_000,
        date: '2026-10-01',
      })
      .expect(200);
    await as(t.http().put(`/capital-moves/${crypto.randomUUID()}`))
      .send({ partnerId: owner, kind: 'withdrawal', amountCents: 100_000, date: '2026-10-02' })
      .expect(400);
    await as(t.http().put(`/capital-moves/${crypto.randomUUID()}`))
      .send({
        partnerId: owner,
        kind: 'withdrawal',
        amountCents: 100_000,
        date: '2026-10-02',
        note: 'علاج',
      })
      .expect(200);
    const draw = crypto.randomUUID();
    await as(t.http().put(`/partner-draws/${draw}`))
      .send({ partnerId: partner, amountCents: 20_000, date: '2026-10-05', reason: 'مصروف شخصي' })
      .expect(200);
    await as(t.http().put(`/partner-draws/${crypto.randomUUID()}`))
      .send({ partnerId: partner, amountCents: 5000, date: '2026-10-05', reason: ' ' })
      .expect(400);

    expect(await account(owner)).toMatchObject({
      capitalCents: 4_900_000,
      contributionsCents: 5_000_000,
      withdrawalsCents: 100_000,
      undrawnCents: 0,
    });
    expect(await account(partner)).toMatchObject({
      capitalCents: 5_000_000,
      drawsCents: 20_000,
      undrawnCents: -20_000,
    });

    await as(t.http().post(`/partner-draws/${draw}/void`))
      .send({ reason: 'أُدخل خطأً' })
      .expect(200);
    expect((await account(partner)).drawsCents).toBe(0);
  });

  it('a capital move is never edited, and retained profit comes from settlements only', async () => {
    const id = crypto.randomUUID();
    const created = await as(t.http().put(`/capital-moves/${id}`))
      .send({ partnerId: owner, kind: 'contribution', amountCents: 1000, date: '2026-10-03' })
      .expect(200);
    const record = created.body as Record<string, unknown> & { serverSeq: number };
    const { serverSeq, ...stored } = record;
    const now = new Date().toISOString();
    const op = (payload: object, base: number | null = null): SyncOp => ({
      opId: crypto.randomUUID(),
      entity: 'capital_move',
      entityId: (payload as { id: string }).id,
      kind: 'upsert',
      payload,
      deviceId: 'desk',
      clientTs: now,
      baseServerSeq: base,
    });
    const retained = {
      ...stored,
      id: crypto.randomUUID(),
      type: 'retained_profit',
      updatedAt: now,
      deviceId: 'desk',
    };
    const response = await as(t.http().post('/sync/push'))
      .send({
        ops: [
          op({ ...stored, amountCents: 9999, updatedAt: now, deviceId: 'desk' }, serverSeq),
          op(retained),
        ],
      })
      .expect(200);
    const results = syncPushResponseSchema.parse(response.body).results;
    expect(results.map((result) => [result.status, result.error?.issues?.[0]?.message])).toEqual([
      ['rejected', PARTNER_ISSUES.fixed],
      ['rejected', PARTNER_ISSUES.retainedByHand],
    ]);
    await as(t.http().get(`/partners/${crypto.randomUUID()}/account`)).expect(404);
    const partners = (await as(t.http().get('/partners')).expect(200)).body as { name: string }[];
    expect(partners.map((p) => p.name)).toEqual(['المالك', 'الشريك']);
  });

  it('several partners (S17): one owner who stays the owner, and no more than 100% between them', async () => {
    const errors = (body: unknown) =>
      (body as { error: { issues: { message: string }[] } }).error.issues.map((i) => i.message);
    // A device that set the owner up again before it had pulled them would add a second owner.
    const second = await as(t.http().put(`/partners/${crypto.randomUUID()}`))
      .send({ name: 'المالك', ownershipBp: 0, isOwner: true })
      .expect(400);
    expect(errors(second.body)).toEqual([PARTNER_ISSUES.secondOwner]);
    // 50% + 50% + 10% is more than the whole shop.
    const third = crypto.randomUUID();
    const over = await as(t.http().put(`/partners/${third}`))
      .send({ name: 'الثالث', ownershipBp: 1000, isOwner: false })
      .expect(400);
    expect(errors(over.body)).toEqual([PARTNER_ISSUES.ownershipOver]);
    // The partner makes room, and the third fits, with their details.
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 4000, isOwner: false })
      .expect(200);
    await as(t.http().put(`/partners/${third}`))
      .send({
        name: 'الثالث',
        ownershipBp: 1000,
        isOwner: false,
        phone: '0600000000',
        title: 'شريك صامت',
        startDate: '2026-10-01',
        notes: 'دخل بعد الافتتاح',
      })
      .expect(200);
    // Nobody swaps places with the owner.
    const swap = await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 4000, isOwner: true })
      .expect(400);
    expect(errors(swap.body)).toEqual([PARTNER_ISSUES.ownerFixed]);
    const partners = (await as(t.http().get('/partners')).expect(200)).body as {
      name: string;
      ownershipBp: number;
      phone: string | null;
      title: string | null;
      startDate: string | null;
      notes: string | null;
    }[];
    expect(partners.map((p) => [p.name, p.ownershipBp])).toEqual([
      ['المالك', 5000],
      ['الشريك', 4000],
      ['الثالث', 1000],
    ]);
    expect(partners[2]).toMatchObject({
      phone: '0600000000',
      title: 'شريك صامت',
      startDate: '2026-10-01',
      notes: 'دخل بعد الافتتاح',
    });
    expect(partners[0]).toMatchObject({ phone: null, title: null, startDate: null, notes: null });
  });

  it('a partner who has a history is never removed; one who has none is, with the reason kept (S19)', async () => {
    const messages = (body: unknown) =>
      (errorResponseSchema.parse(body).error.issues ?? []).map((issue) => issue.message);
    const remove = (id: string, reason = 'غادر') =>
      as(t.http().post(`/partners/${id}/void`)).send({ reason });
    const partners = async () =>
      (await as(t.http().get('/partners')).expect(200)).body as {
        id: string;
        name: string;
        ownershipBp: number;
        voidedAt: string | null;
      }[];
    const third = (await partners()).find((p) => p.name === 'الثالث');
    if (!third) throw new Error('the third partner is missing');

    expect(messages((await remove(owner).expect(400)).body)).toEqual([PARTNER_ISSUES.ownerStays]);
    expect(messages((await remove(third.id).expect(400)).body)).toEqual([
      PARTNER_ISSUES.hasOwnership,
    ]);
    // A reason is required.
    await remove(third.id, ' ').expect(400);

    // The third gives their part away; the partner's contribution keeps the partner (PA3).
    await as(t.http().put(`/partners/${third.id}`))
      .send({ name: 'الثالث', ownershipBp: 0, isOwner: false })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 5000, isOwner: false })
      .expect(200);
    // They are also the first of two partners, who holds every rule that names no one (S17).
    expect(messages((await remove(partner).expect(400)).body)).toEqual([
      PARTNER_ISSUES.hasOwnership,
      PARTNER_ISSUES.hasRecords,
      PARTNER_ISSUES.inProfitSplit,
    ]);
    await remove(third.id, 'خرج من الشراكة').expect(200);

    const after = await partners();
    expect(after.find((p) => p.id === third.id)?.voidedAt).not.toBeNull();
    expect(after.filter((p) => p.voidedAt === null).map((p) => [p.name, p.ownershipBp])).toEqual([
      ['المالك', 5000],
      ['الشريك', 5000],
    ]);
    // The account of a removed partner is still readable, from the records (nothing was deleted).
    await as(t.http().get(`/partners/${third.id}/account`)).expect(200);
  });
});
