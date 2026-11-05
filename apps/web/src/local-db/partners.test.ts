import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PARTNER_ISSUES } from '@fabric/contracts';
import { ShopDatabase } from './db';
import { ReadOnlyError, ValidationError } from './errors';
import { NEEDS_CONFIRMATION, type PartnerExitInput } from './partners';
import { createRepositories, type Repositories } from './repositories';
import { LocalStore } from './store';
import { seedProduct } from './test-helpers';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;

/** The device's clock: the same day, a millisecond later each time it is read. */
let tick = 0;
const clock = (day: string) => () => new Date(Date.parse(`${day}T09:00:00.000Z`) + tick++);

beforeEach(() => {
  tick = 0;
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, clock('2026-10-12'));
  repos = createRepositories(store);
});

afterEach(async () => {
  await db.delete();
});

const issueOf = (error: unknown) =>
  error instanceof ValidationError ? error.issues[0]?.message : error;

async function setUp() {
  await repos.partners.saveAll([
    { name: 'المالك', ownershipBp: 5000, isOwner: true },
    { name: 'الشريك', ownershipBp: 5000, isOwner: false },
  ]);
  const [owner, partner] = await repos.partners.list();
  if (!owner || !partner) throw new Error('no partners');
  return { owner: owner.partner.id, partner: partner.partner.id };
}

describe('partners on the device (BUILD_PROMPTS 4.2)', () => {
  it('two partners, the owner first, ownership adding up to 100%', async () => {
    const { owner, partner } = await setUp();
    expect(
      (await repos.partners.list()).map((view) => [
        view.partner.id,
        view.partner.ownershipBp,
        view.partner.isOwner,
      ]),
    ).toEqual([
      [owner, 5000, true],
      [partner, 5000, false],
    ]);
    // Everyone together is exactly the whole shop: more, or less, is refused and nothing is saved.
    await expect(
      repos.partners.saveAll([
        { id: owner, name: 'المالك', ownershipBp: 12_000, isOwner: true },
        { id: partner, name: 'الشريك', ownershipBp: 5000, isOwner: false },
      ]),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.ownershipOver);
    await expect(
      repos.partners.saveAll([
        { id: owner, name: 'المالك', ownershipBp: 6000, isOwner: true },
        { id: partner, name: 'الشريك', ownershipBp: 3000, isOwner: false },
      ]),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.ownershipShort);
    expect((await repos.partners.list()).map((view) => view.partner.ownershipBp)).toEqual([
      5000, 5000,
    ]);
    await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 6000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 4000, isOwner: false },
    ]);
    expect((await repos.partners.list()).map((view) => view.partner.ownershipBp)).toEqual([
      6000, 4000,
    ]);
  });

  it('accounts and cash from the records only; warnings need a confirmation', async () => {
    const { owner, partner } = await setUp();
    await repos.partners.recordCapitalMove({
      partnerId: owner,
      kind: 'contribution',
      amountCents: 5_000_000,
      date: '2026-10-01',
    });
    await repos.partners.recordCapitalMove({
      partnerId: partner,
      kind: 'contribution',
      amountCents: 5_000_000,
      date: '2026-10-01',
    });

    // No settlement yet: any draw is ahead of the partner's share.
    const draw = {
      partnerId: partner,
      amountCents: 20_000,
      date: '2026-10-05',
      reason: 'مصروف شخصي',
    };
    expect(await repos.partners.drawWarnings(draw)).toEqual(['draw_beyond_share']);
    await expect(repos.partners.recordDraw(draw)).rejects.toSatisfy(
      (error) => issueOf(error) === NEEDS_CONFIRMATION,
    );
    const drawId = await repos.partners.recordDraw(draw, true);

    const withdrawal = {
      partnerId: owner,
      kind: 'withdrawal' as const,
      amountCents: 6_000_000,
      date: '2026-10-06',
      note: 'سفر',
    };
    expect(await repos.partners.capitalWarnings(withdrawal)).toEqual(['capital_below_zero']);
    await expect(repos.partners.recordCapitalMove(withdrawal)).rejects.toSatisfy(
      (error) => issueOf(error) === NEEDS_CONFIRMATION,
    );
    await repos.partners.recordCapitalMove({ ...withdrawal, amountCents: 100_000 });

    expect((await repos.partners.account(partner))?.account).toMatchObject({
      capitalCents: 5_000_000,
      drawsCents: 20_000,
      undrawnCents: -20_000,
    });
    expect((await repos.partners.account(owner))?.account).toMatchObject({
      capitalCents: 4_900_000,
      withdrawalsCents: 100_000,
    });
    expect(await repos.partners.cash()).toBe(10_000_000 - 20_000 - 100_000);

    await repos.partners.voidDraw(drawId, 'أُدخل خطأً');
    expect((await repos.partners.account(partner))?.account.drawsCents).toBe(0);
    expect(await repos.partners.cash()).toBe(10_000_000 - 100_000);
  });

  it('a partner’s account is read-only on its device: no change is saved', async () => {
    await setUp();
    const before = await db.partners.count();
    store.setReadOnly(true);
    await expect(
      repos.partners.saveAll([
        { name: 'x', ownershipBp: 5000, isOwner: true },
        { name: 'y', ownershipBp: 5000, isOwner: false },
      ]),
    ).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(seedProduct(repos)).rejects.toBeInstanceOf(ReadOnlyError);
    expect(await db.partners.count()).toBe(before);
    expect(await db.products.count()).toBe(0);
  });
});

describe('several partners on the device (S4, S17, S18)', () => {
  it('whoever owns less is saved first, so the shop is never over 100% on the way; a partner who is not changed is not written', async () => {
    const { owner, partner } = await setUp();
    const before = await db.outbox.count();
    // The partner is listed first and grows by what the owner gives up.
    await repos.partners.saveAll([
      { id: partner, name: 'الشريك', ownershipBp: 6000, isOwner: false },
      { id: owner, name: 'المالك', ownershipBp: 4000, isOwner: true },
    ]);
    expect((await db.outbox.toArray()).slice(before).map((op) => op.entityId)).toEqual([
      owner,
      partner,
    ]);

    // Saved again as it is, nothing is written.
    await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 4000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 6000, isOwner: false },
    ]);
    expect(await db.outbox.count()).toBe(before + 2);
  });

  it('a partner joins with their details while the others make room; the order they joined in is kept', async () => {
    const { owner, partner } = await setUp();
    const ids = await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 4000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 4000, isOwner: false },
      {
        name: 'بلال',
        ownershipBp: 2000,
        isOwner: false,
        phone: '0612345678',
        title: 'شريك صامت',
        startDate: '2026-10-12',
        notes: 'دخل بمال',
      },
    ]);
    const views = await repos.partners.list();
    expect(views.map((view) => view.partner.id)).toEqual(ids);
    expect(views[2]?.partner).toMatchObject({
      name: 'بلال',
      ownershipBp: 2000,
      isOwner: false,
      phone: '0612345678',
      title: 'شريك صامت',
      startDate: '2026-10-12',
      notes: 'دخل بمال',
    });
    // The details of one partner change without touching the others.
    const before = await db.outbox.count();
    await repos.partners.saveAll([
      { id: ids[2], name: 'بلال', ownershipBp: 2000, isOwner: false, phone: '0699999999' },
    ]);
    expect((await db.outbox.toArray()).slice(before).map((op) => op.entityId)).toEqual([ids[2]]);
    expect((await repos.partners.list())[2]?.partner).toMatchObject({
      phone: '0699999999',
      title: null,
      startDate: null,
      notes: null,
    });
  });

  it('the owner stays the owner, and is the only one: no second owner, no one else made the owner', async () => {
    const { owner, partner } = await setUp();
    await expect(
      repos.partners.saveAll([
        { id: owner, name: 'المالك', ownershipBp: 5000, isOwner: true },
        { id: partner, name: 'الشريك', ownershipBp: 5000, isOwner: true },
      ]),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.secondOwner);
    await expect(
      repos.partners.saveAll([
        { id: owner, name: 'المالك', ownershipBp: 5000, isOwner: false },
        { id: partner, name: 'الشريك', ownershipBp: 5000, isOwner: true },
      ]),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.ownerFixed);
    expect((await repos.partners.list()).map((view) => view.partner.isOwner)).toEqual([
      true,
      false,
    ]);
  });

  it('a partner with no part of the shop and no weight in the rule in force is inactive; nobody is deleted', async () => {
    const { owner, partner } = await setUp();
    await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 10_000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 0, isOwner: false },
    ]);
    // The default rule still gives the first partner a third: they take part until a rule says otherwise.
    expect((await repos.partners.list()).map((view) => view.status)).toEqual(['active', 'active']);
    await repos.settlements.saveSplitRule({
      effectiveFrom: '2026-11-01',
      ownerWeight: 1,
      partnerWeight: 0,
      shopWeight: 1,
      partnerWeights: [{ partnerId: partner, weight: 0 }],
    });
    expect((await repos.partners.list()).map((view) => view.status)).toEqual(['active', 'active']);

    // From the rule's day on, with a device clock past it, the partner has left.
    const later = createRepositories(new LocalStore(db, clock('2026-11-02')));
    expect((await later.partners.list()).map((view) => view.status)).toEqual([
      'active',
      'inactive',
    ]);
    expect(await db.partners.count()).toBe(2);
  });
});

describe('removing a partner (S19)', () => {
  it('the owner stays; a partner who owns a part stays until it is given away; then they go, voided with the reason', async () => {
    const { owner, partner } = await setUp();
    const views = await repos.partners.list();
    expect(views.map((view) => view.removal.map(({ message }) => message))).toEqual([
      [PARTNER_ISSUES.ownerStays],
      [PARTNER_ISSUES.hasOwnership],
    ]);
    await expect(repos.partners.remove(owner, 'x')).rejects.toSatisfy(
      (error) => issueOf(error) === PARTNER_ISSUES.ownerStays,
    );
    await expect(repos.partners.remove(partner, 'x')).rejects.toSatisfy(
      (error) => issueOf(error) === PARTNER_ISSUES.hasOwnership,
    );
    expect(await db.partners.count()).toBe(2);

    await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 10_000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 0, isOwner: false },
    ]);
    // The only partner holds the rules that name no one, and nobody else would take them.
    expect((await repos.partners.list())[1]?.removal).toEqual([]);
    const before = await db.outbox.count();
    await repos.partners.remove(partner, 'خرج من الشراكة');

    expect((await repos.partners.list()).map((view) => view.partner.id)).toEqual([owner]);
    expect(await repos.partners.account(partner)).toBeUndefined();
    // Nothing is deleted: the record stays, voided, with a void op carrying the reason.
    expect(await db.partners.count()).toBe(2);
    expect((await db.partners.get(partner))?.voidedAt).not.toBeNull();
    const ops = (await db.outbox.toArray()).slice(before);
    expect(ops.map((op) => [op.entity, op.kind, op.entityId])).toEqual([
      ['partner', 'void', partner],
    ]);
    expect(ops[0]?.payload).toEqual({ reason: 'خرج من الشراكة' });
    // The shop is still whole: the owner owns it all.
    await expect(
      repos.partners.saveAll([{ id: owner, name: 'المالك', ownershipBp: 10_000, isOwner: true }]),
    ).resolves.toEqual([owner]);
  });

  it('a partner with capital, a draw or a profit weight stays; the first of several partners stays too', async () => {
    const { owner, partner } = await setUp();
    // A third partner joins with no part yet, while the other two keep the whole shop.
    const [, , thirdId] = await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 7000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 3000, isOwner: false },
      { name: 'ثالث', ownershipBp: 0, isOwner: false },
    ]);
    if (!thirdId) throw new Error('third partner not saved');
    const removalOf = async (id: string) =>
      (await repos.partners.list())
        .find((view) => view.partner.id === id)
        ?.removal.map(({ message }) => message);

    // The third has nothing: they can go. The first partner holds the rules that name no one.
    expect(await removalOf(thirdId)).toEqual([]);
    expect(await removalOf(partner)).toEqual([
      PARTNER_ISSUES.hasOwnership,
      PARTNER_ISSUES.inProfitSplit,
    ]);

    await repos.partners.recordCapitalMove({
      partnerId: thirdId,
      kind: 'contribution',
      amountCents: 10_000,
      date: '2026-10-12',
    });
    expect(await removalOf(thirdId)).toEqual([PARTNER_ISSUES.hasRecords]);
    const [move] = await db.capitalMoves.toArray();
    if (!move) throw new Error('no capital move');
    await repos.partners.voidCapitalMove(move.id, 'entered by mistake');
    expect(await removalOf(thirdId)).toEqual([]);

    await repos.settlements.saveSplitRule({
      effectiveFrom: '2026-11-01',
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: [{ partnerId: thirdId, weight: 1 }],
    });
    expect(await removalOf(thirdId)).toEqual([PARTNER_ISSUES.inProfitSplit]);
  });

  it('a partner’s device cannot remove anyone', async () => {
    const { owner, partner } = await setUp();
    await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 10_000, isOwner: true },
      { id: partner, name: 'الشريك', ownershipBp: 0, isOwner: false },
    ]);
    store.setReadOnly(true);
    await expect(repos.partners.remove(partner, 'x')).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await db.partners.get(partner))?.voidedAt).toBeNull();
  });
});

describe('a partner exits (S20)', () => {
  /** The owner, then Ana (the first partner, who also holds the unnamed rules), then Bilal. */
  async function setUpThree() {
    // Ana joins first, so she is the shop's first partner and holds the rules that name no one.
    const [owner, ana] = await repos.partners.saveAll([
      { name: 'المالك', ownershipBp: 5000, isOwner: true },
      { name: 'آنا', ownershipBp: 5000, isOwner: false },
    ]);
    if (!owner || !ana) throw new Error('partners not saved');
    const [, , bilal] = await repos.partners.saveAll([
      { id: owner, name: 'المالك', ownershipBp: 5000, isOwner: true },
      { id: ana, name: 'آنا', ownershipBp: 3000, isOwner: false },
      { name: 'بلال', ownershipBp: 2000, isOwner: false },
    ]);
    if (!bilal) throw new Error('third partner not saved');
    return { owner, ana, bilal };
  }

  /** Profit a settlement allocated to a partner: the record the server writes, at the amount given. */
  async function allocate(partnerId: string, amountCents: number) {
    const at = new Date(store.now()).toISOString();
    await db.settlementShares.put({
      id: crypto.randomUUID(),
      settlementId: crypto.randomUUID(),
      partnerId,
      amountCents,
      createdAt: at,
      updatedAt: at,
      deviceId: 'server',
      voidedAt: null,
      serverSeq: 1,
    });
  }

  /** What the Exit Center would send when the owner pays nothing now and hands everything to `to`. */
  async function exitOf(
    partnerId: string,
    to: { owner?: boolean; partnerId?: string },
    over: Partial<PartnerExitInput> = {},
  ): Promise<PartnerExitInput> {
    const plan = await repos.partners.exitPlan(partnerId);
    if (!plan) throw new Error('no plan');
    const recipient = to.partnerId
      ? { kind: 'partner' as const, partnerId: to.partnerId }
      : { kind: 'owner' as const };
    const takerId = to.partnerId ?? plan.partners.find((partner) => partner.isOwner)?.id ?? '';
    return {
      partnerId,
      exitedOn: '2026-10-12',
      note: null,
      profit: {
        payCents: 0,
        expectedUndrawnCents: plan.account.undrawnCents,
        date: '2026-10-12',
        reason: 'ربح مستحق عند الخروج',
      },
      capital: {
        repayCents: 0,
        expectedCapitalCents: plan.account.capitalCents,
        date: '2026-10-12',
        note: 'رأس مال عند الخروج',
      },
      ownership:
        plan.partner.ownershipBp > 0 ? [{ partnerId: takerId, bp: plan.partner.ownershipBp }] : [],
      profitShares: [{ to: recipient, bp: 10_000 }],
      ...over,
    };
  }

  const stored = async (id: string) => {
    const row = await db.partners.get(id);
    if (!row) throw new Error('no partner');
    return row;
  };

  it('with no history: the ownership and the profit pass on, the exit is written last, nothing is paid', async () => {
    const { owner, ana, bilal } = await setUpThree();
    const before = await db.outbox.count();
    await repos.partners.completeExit(await exitOf(ana, { partnerId: bilal }));

    const left = await stored(ana);
    expect(left.exitedOn).toBe('2026-10-12');
    expect(left.ownershipBp).toBe(0);
    expect(left.voidedAt).toBeNull();
    expect((await stored(bilal)).ownershipBp).toBe(5000);
    expect((await stored(owner)).ownershipBp).toBe(5000);
    expect(await db.partnerDraws.count()).toBe(0);
    expect(await db.capitalMoves.count()).toBe(0);

    // From tomorrow Ana has no weight and Bilal takes the share; the exit is the last op pushed.
    const rules = await db.profitSplitRules.toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.effectiveFrom).toBe('2026-10-13');
    expect(rules[0]?.partnerWeights?.find((entry) => entry.partnerId === ana)?.weight ?? 0).toBe(0);
    expect(
      rules[0]?.partnerWeights?.find((entry) => entry.partnerId === bilal)?.weight,
    ).toBeGreaterThan(0);
    const ops = (await db.outbox.toArray()).slice(before);
    expect(ops.at(-1)).toMatchObject({ entity: 'partner', entityId: ana, kind: 'upsert' });
    expect(ops.map((op) => op.entity)).toEqual([
      'partner',
      'partner',
      'profit_split_rule',
      'partner',
    ]);

    const view = (await repos.partners.list()).find((row) => row.partner.id === ana);
    expect(view?.standing).toBe('former');
  });

  it('pays part of the profit and part of the capital now; what is left stays on the former partner’s account', async () => {
    const { ana, bilal } = await setUpThree();
    await repos.partners.recordCapitalMove({
      partnerId: ana,
      kind: 'contribution',
      amountCents: 500_000,
      date: '2026-09-01',
    });
    await allocate(ana, 100_000);
    const settledBefore = await db.settlementShares.toArray();

    await repos.partners.completeExit(
      await exitOf(
        ana,
        { partnerId: bilal },
        {
          note: 'يُسدَّد الباقي من رأس المال في ديسمبر',
          profit: {
            payCents: 60_000,
            expectedUndrawnCents: 100_000,
            date: '2026-10-12',
            reason: 'ربح عند الخروج',
          },
          capital: {
            repayCents: 200_000,
            expectedCapitalCents: 500_000,
            date: '2026-10-12',
            note: 'رأس مال عند الخروج',
          },
        },
      ),
    );

    const account = (await repos.partners.account(ana))?.account;
    expect(account).toMatchObject({
      drawsCents: 60_000,
      undrawnCents: 40_000,
      withdrawalsCents: 200_000,
      capitalCents: 300_000,
    });
    expect((await stored(ana)).exitNote).toBe('يُسدَّد الباقي من رأس المال في ديسمبر');
    // Real, dated, audited records: a draw and a withdrawal, each with its reason.
    expect(await db.partnerDraws.toArray()).toEqual([
      expect.objectContaining({ partnerId: ana, amountCents: 60_000, reason: 'ربح عند الخروج' }),
    ]);
    expect((await db.capitalMoves.toArray()).filter((move) => move.type === 'withdrawal')).toEqual([
      expect.objectContaining({ partnerId: ana, amountCents: -200_000 }),
    ]);
    // The settled history is exactly as it was.
    expect(await db.settlementShares.toArray()).toEqual(settledBefore);
    // They can be paid the rest later, still from their account.
    await repos.partners.recordDraw({
      partnerId: ana,
      amountCents: 40_000,
      date: '2026-10-20',
      reason: 'باقي الربح',
    });
    expect((await repos.partners.account(ana))?.account.undrawnCents).toBe(0);
  });

  it('fully drawn profit and no capital leave nothing to pay: the exit alone', async () => {
    const { ana, bilal } = await setUpThree();
    await allocate(ana, 50_000);
    await repos.partners.recordDraw({
      partnerId: ana,
      amountCents: 50_000,
      date: '2026-10-05',
      reason: 'سحب',
    });
    const draws = await db.partnerDraws.count();
    await repos.partners.completeExit(await exitOf(ana, { partnerId: bilal }));
    expect(await db.partnerDraws.count()).toBe(draws);
    expect((await stored(ana)).exitedOn).toBe('2026-10-12');
  });

  it('hands the ownership to several people at once, and the owner may take a part', async () => {
    const { owner, ana, bilal } = await setUpThree();
    await repos.partners.completeExit(
      await exitOf(
        ana,
        { partnerId: bilal },
        {
          ownership: [
            { partnerId: owner, bp: 1000 },
            { partnerId: bilal, bp: 2000 },
          ],
          profitShares: [
            { to: { kind: 'owner' }, bp: 2500 },
            { to: { kind: 'partner', partnerId: bilal }, bp: 7500 },
          ],
        },
      ),
    );
    expect((await stored(owner)).ownershipBp).toBe(6000);
    expect((await stored(bilal)).ownershipBp).toBe(4000);
    expect((await stored(ana)).ownershipBp).toBe(0);
  });

  it('refuses a payment on balances that moved since the screen showed them; nothing is written', async () => {
    const { ana, bilal } = await setUpThree();
    await allocate(ana, 100_000);
    const input = await exitOf(
      ana,
      { partnerId: bilal },
      {
        profit: {
          payCents: 100_000,
          expectedUndrawnCents: 100_000,
          date: '2026-10-12',
          reason: 'x',
        },
      },
    );
    // A draw arrives (another device) between the screen and the confirmation.
    await repos.partners.recordDraw({
      partnerId: ana,
      amountCents: 30_000,
      date: '2026-10-11',
      reason: 'y',
    });
    const snapshot = await snapshotOf();
    await expect(repos.partners.completeExit(input)).rejects.toSatisfy(
      (error) => issueOf(error) === PARTNER_ISSUES.exitBalancesChanged,
    );
    expect(await snapshotOf()).toEqual(snapshot);
  });

  it('refuses to pay more than is owed, a negative amount or a fraction', async () => {
    const { ana, bilal } = await setUpThree();
    await allocate(ana, 100_000);
    for (const payCents of [100_001, -1, 10.5]) {
      await expect(
        repos.partners.completeExit(
          await exitOf(
            ana,
            { partnerId: bilal },
            {
              profit: { payCents, expectedUndrawnCents: 100_000, date: '2026-10-12', reason: 'x' },
            },
          ),
        ),
      ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.exitPayment);
    }
    await expect(
      repos.partners.completeExit(
        await exitOf(
          ana,
          { partnerId: bilal },
          {
            capital: { repayCents: 1, expectedCapitalCents: 0, date: '2026-10-12', note: 'x' },
          },
        ),
      ),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.exitPayment);
    expect(await db.partnerDraws.count()).toBe(0);
    expect((await stored(ana)).exitedOn ?? null).toBeNull();
  });

  async function snapshotOf() {
    return {
      partners: await db.partners.toArray(),
      draws: await db.partnerDraws.toArray(),
      moves: await db.capitalMoves.toArray(),
      rules: await db.profitSplitRules.toArray(),
      outbox: await db.outbox.count(),
    };
  }

  it('a failure after the money is written undoes all of it: no payment without the exit', async () => {
    const { ana, bilal } = await setUpThree();
    await repos.partners.recordCapitalMove({
      partnerId: ana,
      kind: 'contribution',
      amountCents: 500_000,
      date: '2026-09-01',
    });
    await allocate(ana, 100_000);
    const snapshot = await snapshotOf();
    // A day before they joined fails the exit check, which runs after every other write.
    await db.partners.update(ana, { startDate: '2026-10-01' });
    const withStart = await snapshotOf();
    await expect(
      repos.partners.completeExit(
        await exitOf(
          ana,
          { partnerId: bilal },
          {
            exitedOn: '2026-09-15',
            profit: {
              payCents: 100_000,
              expectedUndrawnCents: 100_000,
              date: '2026-10-12',
              reason: 'x',
            },
            capital: {
              repayCents: 500_000,
              expectedCapitalCents: 500_000,
              date: '2026-10-12',
              note: 'x',
            },
          },
        ),
      ),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.exitBeforeStart);
    expect(await snapshotOf()).toEqual(withStart);
    expect(withStart.draws).toEqual(snapshot.draws);
  });

  it('a second submission of the same exit finds it done and writes nothing', async () => {
    const { ana, bilal } = await setUpThree();
    await allocate(ana, 100_000);
    const input = await exitOf(
      ana,
      { partnerId: bilal },
      {
        profit: {
          payCents: 100_000,
          expectedUndrawnCents: 100_000,
          date: '2026-10-12',
          reason: 'x',
        },
      },
    );
    const [first, second] = await Promise.allSettled([
      repos.partners.completeExit(input),
      repos.partners.completeExit(input),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.partnerDraws.count()).toBe(1);
    await expect(repos.partners.completeExit(input)).rejects.toSatisfy(
      (error) => issueOf(error) === PARTNER_ISSUES.alreadyExited,
    );
    expect(await db.partnerDraws.count()).toBe(1);
  });

  it('the owner never exits; a partner’s device cannot exit anyone', async () => {
    const { owner, ana, bilal } = await setUpThree();
    await expect(
      repos.partners.completeExit(await exitOf(owner, { partnerId: bilal })),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_ISSUES.exitOwner);
    const input = await exitOf(ana, { partnerId: bilal });
    store.setReadOnly(true);
    await expect(repos.partners.completeExit(input)).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await stored(ana)).exitedOn ?? null).toBeNull();
  });

  it('refuses ownership that does not add up, a leaver as the recipient, or a former partner as the recipient', async () => {
    const { ana, bilal } = await setUpThree();
    await expect(
      repos.partners.completeExit(
        await exitOf(ana, { partnerId: bilal }, { ownership: [{ partnerId: bilal, bp: 1000 }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repos.partners.completeExit(
        await exitOf(ana, { partnerId: bilal }, { ownership: [{ partnerId: ana, bp: 3000 }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repos.partners.completeExit(
        await exitOf(
          ana,
          { partnerId: bilal },
          {
            profitShares: [{ to: { kind: 'partner', partnerId: ana }, bp: 10_000 }],
          },
        ),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await stored(ana)).ownershipBp).toBe(3000);
    expect(await db.profitSplitRules.count()).toBe(0);
  });

  it('a day still to come makes them leaving, and the profit stops from that day, not before', async () => {
    const { ana, bilal } = await setUpThree();
    await repos.partners.completeExit(
      await exitOf(ana, { partnerId: bilal }, { exitedOn: '2026-12-01' }),
    );
    const view = (await repos.partners.list()).find((row) => row.partner.id === ana);
    expect(view?.standing).toBe('leaving');
    expect((await db.profitSplitRules.toArray()).map((rule) => rule.effectiveFrom)).toEqual([
      '2026-12-01',
    ]);
  });

  it('the details can be edited afterwards without undoing the exit; reactivating clears the day and gives nothing back', async () => {
    const { ana, bilal } = await setUpThree();
    await repos.partners.completeExit(await exitOf(ana, { partnerId: bilal }, { note: 'ملاحظة' }));
    const views = await repos.partners.list();
    const draft = views.map((row) => ({
      id: row.partner.id,
      name: row.partner.id === ana ? 'آنا العلي' : row.partner.name,
      ownershipBp: row.partner.ownershipBp,
      isOwner: row.partner.isOwner,
    }));
    await repos.partners.saveAll(draft);
    expect(await stored(ana)).toMatchObject({
      name: 'آنا العلي',
      exitedOn: '2026-10-12',
      exitNote: 'ملاحظة',
    });

    await repos.partners.reactivate(ana);
    expect(await stored(ana)).toMatchObject({ exitedOn: null, exitNote: null, ownershipBp: 0 });
    expect((await repos.partners.list()).find((row) => row.partner.id === ana)?.standing).toBe(
      'active',
    );
  });

  it('a partner saved before exits existed (no exit fields) reads as active and can still exit', async () => {
    const { ana, bilal } = await setUpThree();
    const row = await stored(ana);
    // The shape a device stored before exits existed: the two exit fields are not there at all.
    const old: Partial<typeof row> = { ...row };
    delete old.exitedOn;
    delete old.exitNote;
    await db.partners.put(old as typeof row);
    expect((await repos.partners.list()).find((view) => view.partner.id === ana)?.standing).toBe(
      'active',
    );
    await repos.partners.completeExit(await exitOf(ana, { partnerId: bilal }));
    expect((await stored(ana)).exitedOn).toBe('2026-10-12');
  });

  it('the plan is read from the device: the account, the other partners, the rules, and what would block removing outright', async () => {
    const { ana } = await setUpThree();
    await allocate(ana, 70_000);
    const plan = await repos.partners.exitPlan(ana);
    expect(plan?.account.undrawnCents).toBe(70_000);
    expect(plan?.partners).toHaveLength(3);
    expect(plan?.today).toBe('2026-10-12');
    expect(plan?.lockedThrough).toBeNull();
    expect(plan?.removal.length).toBeGreaterThan(0);
    expect(await repos.partners.exitPlan(crypto.randomUUID())).toBeUndefined();
  });
});
