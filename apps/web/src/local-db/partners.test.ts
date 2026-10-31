import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ReadOnlyError, ValidationError } from './errors';
import { NEEDS_CONFIRMATION, PARTNER_SETUP_ISSUE } from './partners';
import { createRepositories, type Repositories } from './repositories';
import { LocalStore } from './store';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;

beforeEach(() => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => new Date('2026-10-12T09:00:00.000Z'));
  repos = createRepositories(store);
});

afterEach(async () => {
  await db.delete();
});

const issueOf = (error: unknown) =>
  error instanceof ValidationError ? error.issues[0]?.message : error;

async function setUp() {
  await repos.partners.saveBoth({
    owner: { name: 'المالك', ownershipBp: 5000 },
    partner: { name: 'الشريك' },
  });
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
    await expect(
      repos.partners.saveBoth({
        owner: { id: owner, name: 'المالك', ownershipBp: 12_000 },
        partner: { id: partner, name: 'الشريك' },
      }),
    ).rejects.toSatisfy((error) => issueOf(error) === PARTNER_SETUP_ISSUE);
    await repos.partners.saveBoth({
      owner: { id: owner, name: 'المالك', ownershipBp: 6000 },
      partner: { id: partner, name: 'الشريك' },
    });
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
      repos.partners.saveBoth({ owner: { name: 'x', ownershipBp: 5000 }, partner: { name: 'y' } }),
    ).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(
      repos.fabrics.save({ name: 'روزا', refPricePerMeterCents: 1, minPricePerMeterCents: 1 }),
    ).rejects.toBeInstanceOf(ReadOnlyError);
    expect(await db.partners.count()).toBe(before);
    expect(await db.fabrics.count()).toBe(0);
  });
});
