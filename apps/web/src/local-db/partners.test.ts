import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PARTNER_ISSUES } from '@fabric/contracts';
import { ShopDatabase } from './db';
import { ReadOnlyError, ValidationError } from './errors';
import { NEEDS_CONFIRMATION } from './partners';
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
