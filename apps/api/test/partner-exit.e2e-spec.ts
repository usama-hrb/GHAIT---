import { dayAfter } from '@fabric/core';
import {
  errorResponseSchema,
  HEADERS,
  PARTNER_ISSUES,
  SETTLEMENT_ISSUES,
  shopDate,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

/**
 * A partner leaves (docs/accounting-assumptions.md S20). The exit is the last record a device
 * writes: the server refuses it while the partner still owns part of the shop or a rule still
 * gives them a share, and afterwards neither can come back. Their money stays on their account.
 */
describe('a partner exits (S20)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const ana = crypto.randomUUID();
  const bilal = crypto.randomUUID();
  const today = shopDate(new Date());
  const tomorrow = dayAfter(today);
  const left = '2026-11-01';

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    // Ana is entered first: she is the shop's first partner and holds the rules that name no one.
    await put(owner, { name: 'المالك', ownershipBp: 5000, isOwner: true });
    await put(ana, { name: 'آنا', ownershipBp: 3000, isOwner: false });
    await put(bilal, { name: 'بلال', ownershipBp: 2000, isOwner: false });
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  async function put(id: string, body: object, status = 200) {
    return as(t.http().put(`/partners/${id}`))
      .send(body)
      .expect(status);
  }

  async function push(...ops: SyncOp[]): Promise<SyncOpResult[]> {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  }

  type Stored = {
    id: string;
    name: string;
    ownershipBp: number;
    isOwner: boolean;
    phone: string | null;
    title: string | null;
    startDate: string | null;
    notes: string | null;
    exitedOn: string | null;
    exitNote: string | null;
    createdAt: string;
    updatedAt: string;
    deviceId: string;
    voidedAt: string | null;
    serverSeq: number;
  };

  async function partners(): Promise<Stored[]> {
    return (await as(t.http().get('/partners')).expect(200)).body as Stored[];
  }

  async function partner(id: string): Promise<Stored> {
    const found = (await partners()).find((row) => row.id === id);
    if (!found) throw new Error(`no partner ${id}`);
    return found;
  }

  /** A device writes the partner record the way the exit does: the whole record, one op. */
  async function write(id: string, change: Partial<Stored>): Promise<SyncOpResult> {
    const current = await partner(id);
    const { serverSeq, ...record } = current;
    const [result] = await push({
      opId: crypto.randomUUID(),
      entity: 'partner',
      entityId: id,
      kind: 'upsert',
      payload: { ...record, ...change, updatedAt: new Date().toISOString() },
      deviceId: 'desk',
      clientTs: new Date().toISOString(),
      baseServerSeq: serverSeq,
    });
    if (!result) throw new Error('no result');
    return result;
  }

  const messagesOf = (result: SyncOpResult) =>
    (result.error?.issues ?? []).map((issue) => issue.message);

  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  const rule = (
    partnerWeights: { partnerId: string; weight: number }[],
    effectiveFrom: string,
  ) => ({
    effectiveFrom,
    ownerWeight: 1,
    partnerWeight: partnerWeights.reduce((sum, { weight }) => sum + weight, 0),
    shopWeight: 1,
    partnerWeights,
  });

  it('the owner never exits', async () => {
    const result = await write(owner, { exitedOn: left });
    expect(result.status).toBe('rejected');
    expect(messagesOf(result)).toEqual([PARTNER_ISSUES.exitOwner]);
    expect((await partner(owner)).exitedOn).toBeNull();
  });

  it('is refused while they own part of the shop or a rule gives them a share, and nothing is changed', async () => {
    const early = await write(ana, { exitedOn: left, ownershipBp: 0 });
    // The default thirds are the first partner's, so she still shares the profit.
    expect(early.status).toBe('rejected');
    expect(messagesOf(early)).toEqual([PARTNER_ISSUES.exitProfitShare]);

    const owning = await write(ana, { exitedOn: left });
    expect(owning.status).toBe('rejected');
    expect(messagesOf(owning)).toEqual([PARTNER_ISSUES.exitedOwns]);
    const stored = await partner(ana);
    expect(stored.exitedOn).toBeNull();
    expect(stored.ownershipBp).toBe(3000);
  });

  it('goes through once the ownership and the rules are handed over, in the order the device writes them', async () => {
    // Ownership first, the part that is given up before the part that grows (S4).
    await write(ana, { ownershipBp: 0 });
    await put(owner, { name: 'المالك', ownershipBp: 8000, isOwner: true });
    // The rules from the day after today name Bilal only; Ana stays in the rule at 0.
    await as(t.http().put(`/split-rules/${crypto.randomUUID()}`))
      .send(
        rule(
          [
            { partnerId: ana, weight: 0 },
            { partnerId: bilal, weight: 2 },
          ],
          tomorrow,
        ),
      )
      .expect(200);

    const result = await write(ana, { exitedOn: left, exitNote: 'يُسدَّد نصف رأس المال لاحقًا' });
    expect(result.status).toBe('applied');
    const stored = await partner(ana);
    expect(stored.exitedOn).toBe(left);
    expect(stored.exitNote).toBe('يُسدَّد نصف رأس المال لاحقًا');
    expect(stored.voidedAt).toBeNull();
    expect(stored.ownershipBp).toBe(0);
    // The others are untouched.
    expect((await partner(owner)).exitedOn).toBeNull();
    expect((await partner(bilal)).exitedOn).toBeNull();
  });

  it('the day they left is fixed, they own nothing, and editing the details keeps the exit', async () => {
    const again = await write(ana, { exitedOn: '2026-11-03' });
    expect(again.status).toBe('rejected');
    expect(messagesOf(again)).toEqual([PARTNER_ISSUES.exitFixed]);

    const owns = await put(ana, { name: 'آنا', ownershipBp: 500, isOwner: false }, 400);
    expect(errorOf(owns.body).issues).toEqual([
      expect.objectContaining({ message: PARTNER_ISSUES.exitedOwns }),
    ]);

    // The form carries no exit: saving the details leaves it as it is.
    await put(ana, { name: 'آنا العلي', ownershipBp: 0, isOwner: false, phone: '0600000000' });
    const stored = await partner(ana);
    expect(stored.name).toBe('آنا العلي');
    expect(stored.phone).toBe('0600000000');
    expect(stored.exitedOn).toBe(left);
    expect(stored.exitNote).toBe('يُسدَّد نصف رأس المال لاحقًا');
  });

  it('no rule gives them a share from the day they left', async () => {
    const give = (weights: { partnerId: string; weight: number }[], effectiveFrom: string) =>
      as(t.http().put(`/split-rules/${crypto.randomUUID()}`)).send(rule(weights, effectiveFrom));
    const refused = await give(
      [
        { partnerId: ana, weight: 1 },
        { partnerId: bilal, weight: 1 },
      ],
      '2099-01-01',
    ).expect(400);
    expect(errorOf(refused.body).issues).toEqual([
      expect.objectContaining({ message: SETTLEMENT_ISSUES.ruleExitedPartner }),
    ]);
    await give(
      [
        { partnerId: ana, weight: 0 },
        { partnerId: bilal, weight: 1 },
      ],
      '2099-01-01',
    ).expect(200);
  });

  it('their money stays on their account and can be paid later', async () => {
    const stamp = new Date().toISOString();
    const record = (id: string) => ({
      id,
      partnerId: ana,
      createdAt: stamp,
      updatedAt: stamp,
      deviceId: 'desk',
      voidedAt: null,
    });
    const op = (entity: 'capital_move' | 'partner_draw', payload: { id: string }): SyncOp => ({
      opId: crypto.randomUUID(),
      entity,
      entityId: payload.id,
      kind: 'upsert',
      payload,
      deviceId: 'desk',
      clientTs: stamp,
      baseServerSeq: null,
    });
    const moveId = crypto.randomUUID();
    const drawId = crypto.randomUUID();
    const results = await push(
      op('capital_move', {
        ...record(moveId),
        type: 'contribution',
        amountCents: 500_000,
        date: '2026-01-10',
        note: null,
        settlementId: null,
      } as { id: string }),
      op('partner_draw', {
        ...record(drawId),
        amountCents: 10_000,
        date: today,
        reason: 'دفع متأخر بعد المغادرة',
        zakatReportId: null,
      } as { id: string }),
    );
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
    const account = (await as(t.http().get(`/partners/${ana}/account`)).expect(200)).body as {
      account: { capitalCents: number; drawsCents: number };
    };
    expect(account.account.capitalCents).toBe(500_000);
    expect(account.account.drawsCents).toBe(10_000);
  });

  it('coming back is a reactivation: the day is cleared and nothing else is given back', async () => {
    const result = await write(ana, { exitedOn: null, exitNote: null });
    expect(result.status).toBe('applied');
    const stored = await partner(ana);
    expect(stored.exitedOn).toBeNull();
    expect(stored.ownershipBp).toBe(0);
    // She can be given a part again, as any partner.
    await put(owner, { name: 'المالك', ownershipBp: 7000, isOwner: true });
    await put(ana, { name: 'آنا العلي', ownershipBp: 1000, isOwner: false });
    expect((await partner(ana)).ownershipBp).toBe(1000);
  });
});
