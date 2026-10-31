import { HEADERS, PARTNER_ISSUES, type SyncOp, syncPushResponseSchema } from '@fabric/contracts';
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

  it('a third partner is refused (S4): a device that set them up again adds nothing', async () => {
    const refused = await as(t.http().put(`/partners/${crypto.randomUUID()}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(400);
    expect((refused.body as { error: { issues: { message: string }[] } }).error.issues).toEqual([
      expect.objectContaining({ message: PARTNER_ISSUES.alreadySetUp }),
    ]);
    // Editing one of the two still works.
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 6000, isOwner: true })
      .expect(200);
  });
});
