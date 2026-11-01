import 'fake-indexeddb/auto';
import {
  buildSettlement,
  type NewSettlement,
  type SettlementRecords,
  shopDate,
} from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { NeedsServerError, type ServerLink } from './settlements';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
/** The device's clock: 3 November 2026, a minute later at each call. */
let now = Date.UTC(2026, 10, 3, 9, 0);
let seq = 0;
let variantId: string;

/** Everything a settlement reads, from this device's tables. */
async function recordsOf(): Promise<SettlementRecords> {
  const [rolls, stockMoves, sales, saleLines, saleReturns, allocations, writeOffs, expenses] =
    await Promise.all([
      db.rolls.toArray(),
      db.stockMoves.toArray(),
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.saleReturns.toArray(),
      db.paymentAllocations.toArray(),
      db.writeOffs.toArray(),
      db.expenses.toArray(),
    ]);
  const [cashAdjustments, lockedCosts, settlements, splitRules, partners] = await Promise.all([
    db.cashAdjustments.toArray(),
    db.lockedCosts.toArray(),
    db.settlements.toArray(),
    db.profitSplitRules.toArray(),
    db.partners.toArray(),
  ]);
  return {
    rolls,
    stockMoves,
    sales,
    saleLines,
    saleReturns,
    allocations,
    writeOffs,
    expenses,
    cashAdjustments,
    lockedCosts,
    settlements,
    splitRules,
    partners,
  };
}

/**
 * The server, as far as settling goes: it settles this device's records (as if every device had
 * synced) and the results arrive as a pull would bring them.
 */
function fakeServer(): ServerLink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    syncNow: () => {
      calls.push('sync');
      return Promise.resolve();
    },
    request: async (path, schema, init) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const today = shopDate(new Date(now));
      if (path === '/settlements') {
        const body = init?.body as NewSettlement;
        const built = buildSettlement(
          await recordsOf(),
          { ...body, today },
          { settlementId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
          { deviceId: 'server', now: new Date(now).toISOString() },
        );
        if (!built.ok) throw new ApiError(409, 'conflict', 'The figures changed');
        const { settlement, shares, retainedProfit, lockedCosts } = built.aggregate;
        await db.settlements.put({ ...settlement, serverSeq: ++seq });
        await db.settlementShares.bulkPut(shares.map((r) => ({ ...r, serverSeq: ++seq })));
        await db.capitalMoves.bulkPut(retainedProfit.map((r) => ({ ...r, serverSeq: ++seq })));
        await db.lockedCosts.bulkPut(lockedCosts.map((r) => ({ ...r, serverSeq: ++seq })));
        return schema.parse({
          settlement: { ...settlement, serverSeq: seq },
          shares: shares.map((r) => ({ ...r, serverSeq: seq })),
          retainedProfit: retainedProfit.map((r) => ({ ...r, serverSeq: seq })),
          lockedCostCount: lockedCosts.length,
        });
      }
      const unlock = /^\/settlements\/(.+)\/unlock$/.exec(path)?.[1];
      if (unlock) {
        const at = new Date(now).toISOString();
        const voided = { voidedAt: at, updatedAt: at };
        const settlement = await db.settlements.get(unlock);
        if (!settlement) throw new ApiError(404, 'not_found', 'No settlement');
        await db.settlements.put({ ...settlement, ...voided });
        await db.settlementShares.where('settlementId').equals(unlock).modify(voided);
        await db.lockedCosts.where('settlementId').equals(unlock).modify(voided);
        await db.capitalMoves.filter((m) => m.settlementId === unlock).modify(voided);
        return schema.parse({
          settlement: { ...settlement, ...voided, serverSeq: ++seq },
          shares: [],
          retainedProfit: [],
          lockedCostCount: 0,
        });
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

let server: ReturnType<typeof fakeServer>;

beforeEach(async () => {
  now = Date.UTC(2026, 10, 3, 9, 0);
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  const store = new LocalStore(db, () => new Date((now += 60_000)));
  server = fakeServer();
  repos = createRepositories(store, server);
  await store.setMeta(DEVICE_CODE, 'A');
  await repos.partners.saveBoth({
    owner: { name: 'أنا', ownershipBp: 5000 },
    partner: { name: 'شريكي' },
  });
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1000,
    estCmPerKg: 500,
  });
  variantId = await repos.variants.save({ fabricId, colorName: 'أحمر' });
});

afterEach(async () => {
  await db.delete();
});

async function buy(input: object): Promise<string> {
  const purchaseId = await repos.purchases.create({
    variantId,
    date: '2026-10-01',
    ...input,
  } as never);
  const [roll] = await repos.purchases.rollsOf(purchaseId);
  if (!roll) throw new Error('no roll');
  return roll.id;
}

const sell = (rollId: string, date: string, soldCm: number, perMeterCents: number) =>
  repos.sales.create({
    date,
    customerId: null,
    lines: [
      {
        rollId,
        soldCm,
        price: { perMeterCents },
        refPricePerMeterCents: 2000,
        minPricePerMeterCents: 1000,
      },
    ],
    paidCents: Math.round((perMeterCents * soldCm) / 100),
  });

const lockedIssue = { issues: [expect.objectContaining({ message: 'period_locked' })] };

describe('settlement on the device (BUILD_PROMPTS 4.3)', () => {
  it('previewed offline, approved through the server; what is dated in it is then refused', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 20_000 }],
    });
    const october = await sell(roll, '2026-10-05', 10_000, 2000);
    await repos.expenses.save({
      date: '2026-10-10',
      category: 'rent',
      amountCents: 10_000,
      paidDate: '2026-10-10',
    });

    expect(await repos.settlements.nextPeriodEnd()).toBe('2026-10-31');
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    expect(preview.preview).toMatchObject({ netProfitCents: 30_000, ownerShareCents: 10_000 });

    const id = await repos.settlements.approve('2026-10-31', preview.preview.breakdown);
    expect(server.calls).toEqual(['POST /settlements', 'sync']);
    expect(
      (await repos.settlements.detail(id))?.shares.map((s) => [s.partner?.name, s.amountCents]),
    ).toEqual([
      ['أنا', 10_000],
      ['شريكي', 10_000],
    ]);
    const [owner] = await repos.partners.list();
    expect(owner?.account).toMatchObject({ sharesCents: 10_000, retainedProfitCents: 5000 });
    expect(await repos.settlements.lockedThrough()).toBe('2026-10-31');
    expect(await repos.settlements.nextPeriodEnd()).toBeNull();

    // October is closed on this device too.
    await expect(sell(roll, '2026-10-20', 100, 2000)).rejects.toMatchObject(lockedIssue);
    await expect(repos.sales.voidSale(october, 'خطأ')).rejects.toMatchObject(lockedIssue);
    await expect(
      repos.expenses.save({
        date: '2026-10-15',
        category: 'rent',
        amountCents: 500,
        paidDate: '2026-10-15',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repos.inventory.record({
        type: 'loss',
        rollId: roll,
        date: '2026-10-31',
        lengthCm: 10,
        reason: 'تلف',
      }),
    ).rejects.toMatchObject(lockedIssue);
    await expect(sell(roll, '2026-11-02', 100, 2000)).resolves.toBeTypeOf('string');

    // Unlocked (with a reason, on the server), October takes changes again.
    await repos.settlements.unlock(id, 'نسيت مصروفاً');
    expect(await repos.settlements.lockedThrough()).toBeNull();
    await expect(sell(roll, '2026-10-20', 100, 2000)).resolves.toBeTypeOf('string');
    expect((await repos.partners.list())[0]?.account.sharesCents).toBe(0);
  });

  it('a stale preview is refused by the server, and settling needs it', async () => {
    const roll = await buy({
      method: 'meter',
      pricePerMeterCents: 1600,
      rolls: [{ variantId, lengthCm: 5000 }],
    });
    await sell(roll, '2026-10-05', 1000, 2000);
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    await sell(roll, '2026-10-06', 1000, 2000); // arrives before the approval
    await expect(
      repos.settlements.approve('2026-10-31', preview.preview.breakdown),
    ).rejects.toBeInstanceOf(ApiError);

    const offline = createRepositories(new LocalStore(db, () => new Date(now)));
    await expect(offline.settlements.approve('2026-10-31', [])).rejects.toBeInstanceOf(
      NeedsServerError,
    );
    await expect(offline.settlements.serverPreview('2026-10-31')).rejects.toBeInstanceOf(
      NeedsServerError,
    );
  });

  it('a settled sale keeps its cost on this device when the roll is measured later (P9)', async () => {
    // 2 kg at 500 cm/kg: an estimated 1000 cm for 100 dh; half sold in October.
    const roll = await buy({
      method: 'kg',
      weightG: 2000,
      totalCostCents: 10_000,
      estCmPerKg: 500,
    });
    await sell(roll, '2026-10-05', 500, 1600);
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    await repos.settlements.approve('2026-10-31', preview.preview.breakdown);

    await repos.inventory.record({
      type: 'length_correction',
      rollId: roll,
      date: '2026-11-02',
      measuredRemainingCm: 300,
    });
    expect((await repos.inventory.roll(roll))?.ledger).toMatchObject({
      basisLengthCm: 800,
      costs: [expect.objectContaining({ costCents: 5000 })],
      unallocatedCostCents: 5000,
    });
  });

  it('split rules: equal thirds by default; others only for future dates (SPEC §8.3)', async () => {
    expect(
      (await repos.settlements.splitRules()).map((row) => [row.effectiveFrom, row.future]),
    ).toEqual([['2000-01-01', false]]);
    const id = await repos.settlements.saveSplitRule({
      effectiveFrom: '2026-12-01',
      ownerWeight: 2,
      partnerWeight: 2,
      shopWeight: 1,
    });
    expect((await repos.settlements.splitRules()).at(-1)).toMatchObject({
      effectiveFrom: '2026-12-01',
      ownerWeight: 2,
      future: true,
    });
    await expect(
      repos.settlements.saveSplitRule({
        effectiveFrom: '2026-11-01',
        ownerWeight: 1,
        partnerWeight: 1,
        shopWeight: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await repos.settlements.voidSplitRule(id, 'اتفقنا على غير ذلك');
    expect(await repos.settlements.splitRules()).toHaveLength(1);
    expect((await db.outbox.toArray()).map((op) => [op.entity, op.kind]).slice(-2)).toEqual([
      ['profit_split_rule', 'upsert'],
      ['profit_split_rule', 'void'],
    ]);
  });
});
