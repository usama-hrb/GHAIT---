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
import { NeedsServerError, openPeriodEnds, type ServerLink } from './settlements';
import { LocalStore } from './store';
import { seedBatch, seedPartners, seedProduct } from './test-helpers';

let db: ShopDatabase;
let repos: Repositories;
/** The device's clock: 3 November 2026, a minute later at each call. */
let now = Date.UTC(2026, 10, 3, 9, 0);
let seq = 0;
let productId: string;

/** Everything a settlement reads, from this device's tables. */
async function recordsOf(): Promise<SettlementRecords> {
  const [batches, stockMoves, sales, saleLines, saleReturns, allocations, writeOffs, expenses] =
    await Promise.all([
      db.productBatches.toArray(),
      db.productStockMoves.toArray(),
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
    batches,
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
  await seedPartners(repos);
  productId = await seedProduct(repos, { minPricePerMeterCents: 1000 });
});

afterEach(async () => {
  await db.delete();
});

const buy = (lengthCm: number, date = '2026-10-01') =>
  seedBatch(repos, productId, lengthCm, { date });

const sell = (batchId: string, date: string, soldCm: number, perMeterCents: number) =>
  repos.sales.create({
    date,
    customerId: null,
    lines: [
      {
        batchId,
        unit: 'meter',
        quantity: soldCm,
        price: { perUnitCents: perMeterCents },
        refPriceCents: 2000,
        minPriceCents: 1000,
      },
    ],
    paidCents: Math.round((perMeterCents * soldCm) / 100),
  });

const lockedIssue = { issues: [expect.objectContaining({ message: 'period_locked' })] };

/** The shop with a third person: the owner and the first partner make room for them (40/40/20). */
async function withThirdPartner() {
  const rows = await db.partners.toArray();
  const owner = rows.find((row) => row.isOwner);
  const first = rows.find((row) => !row.isOwner);
  if (!owner || !first) throw new Error('the seeded partners');
  const ids = await repos.partners.saveAll([
    { id: owner.id, name: owner.name, ownershipBp: 4000, isOwner: true },
    { id: first.id, name: first.name, ownershipBp: 4000, isOwner: false },
    { name: 'سارة', ownershipBp: 2000, isOwner: false },
  ]);
  const thirdId = ids[2];
  if (thirdId === undefined) throw new Error('a third partner');
  return { firstId: first.id, thirdId };
}

describe('settlement on the device (BUILD_PROMPTS 4.3)', () => {
  it('previewed offline, approved through the server; what is dated in it is then refused', async () => {
    const roll = await buy(20_000);
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
      repos.stock.act({
        type: 'loss',
        batchId: roll,
        date: '2026-10-31',
        quantity: 10,
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
    const roll = await buy(5000);
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

  it('a settled sale keeps its cost on this device when the batch is measured later (P9)', async () => {
    // 2 kg at 500 cm/kg: an estimated 1000 cm for 100 dh; half sold in October.
    const purchaseId = await repos.purchases.create({
      date: '2026-10-01',
      productId,
      unit: 'kg',
      quantity: 2000,
      totalCostCents: 10_000,
      conversion: { weightG: 2000, lengthCm: 1000, source: 'estimated' },
    });
    const [batch] = await repos.purchases.batchesOf(purchaseId);
    const roll = batch?.id ?? '';
    await sell(roll, '2026-10-05', 500, 1600);
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    await repos.settlements.approve('2026-10-31', preview.preview.breakdown);

    // Measured at 800 cm in all: unfrozen, the settled half would now cost 62.50 dh.
    await repos.productInventory.measure(roll, 800);
    expect((await repos.stock.view(roll))?.ledger).toMatchObject({
      lengthBasisCm: 800,
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

  it('a partner is given a weight from a future date: the others keep theirs, one rule per day (S15, S17)', async () => {
    const { firstId, thirdId } = await withThirdPartner();
    const change = { partnerId: thirdId, weight: 1, effectiveFrom: '2026-12-01' };

    // The default rule names no partner, so it is the first one's; the third is added beside them.
    const preview = await repos.settlements.previewPartnerWeight(change);
    expect(preview).toEqual({
      id: null,
      rule: {
        effectiveFrom: '2026-12-01',
        ownerWeight: 1,
        partnerWeight: 2,
        shopWeight: 1,
        partnerWeights: [
          { partnerId: firstId, weight: 1 },
          { partnerId: thirdId, weight: 1 },
        ],
      },
    });
    expect(await repos.settlements.splitRules()).toHaveLength(1); // a preview saves nothing

    const id = await repos.settlements.setPartnerWeight(change);
    const saved = (await repos.settlements.splitRules()).at(-1);
    expect(saved).toMatchObject({ effectiveFrom: '2026-12-01', partnerWeight: 2, future: true });
    expect(saved?.partnerWeights).toEqual(preview.rule.partnerWeights);

    // The same day again changes that rule instead of adding a second one.
    expect((await repos.settlements.previewPartnerWeight({ ...change, weight: 3 })).id).toBe(id);
    await repos.settlements.setPartnerWeight({ ...change, weight: 3 });
    const rows = await repos.settlements.splitRules();
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.partnerWeights).toEqual([
      { partnerId: firstId, weight: 1 },
      { partnerId: thirdId, weight: 3 },
    ]);
    expect(rows.at(-1)?.partnerWeight).toBe(4);
  });

  it('a weight cannot start today or on a day that has passed: a settled period never changes (S15)', async () => {
    const { thirdId } = await withThirdPartner();
    await expect(
      repos.settlements.setPartnerWeight({
        partnerId: thirdId,
        weight: 1,
        effectiveFrom: '2026-11-03',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await repos.settlements.splitRules()).toHaveLength(1);
  });

  it('what a settled period shows does not move when records and rules change after it', async () => {
    const roll = await buy(5000);
    await sell(roll, '2026-10-05', 1000, 2000);
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    const id = await repos.settlements.approve('2026-10-31', preview.preview.breakdown);
    const approved = await repos.settlements.detail(id);
    expect(approved?.settlement).toMatchObject({
      periodStart: '2026-10-01',
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
    });

    // Afterwards: a new rule for a future date, and records in the open period.
    await repos.settlements.saveSplitRule({
      effectiveFrom: '2026-12-01',
      ownerWeight: 4,
      partnerWeight: 4,
      shopWeight: 2,
    });
    await sell(roll, '2026-11-02', 1000, 2000);
    await repos.expenses.save({
      date: '2026-11-02',
      category: 'rent',
      amountCents: 5000,
      paidDate: '2026-11-02',
    });
    expect(await repos.settlements.detail(id)).toEqual(approved);
    expect((await repos.settlements.history()).map((row) => row.id)).toEqual([id]);
  });

  it('the period ends on offer: each ended month after the last settled day, the oldest first', async () => {
    // 3 November 2026 here: October is the last ended month.
    expect(await repos.settlements.openPeriodEnds()).toEqual(['2026-10-31']);
    const roll = await buy(5000);
    await sell(roll, '2026-10-05', 1000, 2000);
    const preview = await repos.settlements.preview('2026-10-31');
    if (!preview.ok) throw new Error('a preview');
    await repos.settlements.approve('2026-10-31', preview.preview.breakdown);
    expect(await repos.settlements.openPeriodEnds()).toEqual([]);
  });
});

describe('openPeriodEnds (S7: a period starts the day after the last settlement)', () => {
  it('offers only the last ended month when nothing is settled: the first period takes all before it', () => {
    expect(openPeriodEnds(null, '2026-11-03')).toEqual(['2026-10-31']);
    expect(openPeriodEnds(null, '2027-01-01')).toEqual(['2026-12-31']);
  });

  it('lists every ended month after the settled day, the oldest first', () => {
    expect(openPeriodEnds('2026-08-31', '2026-11-03')).toEqual(['2026-09-30', '2026-10-31']);
    expect(openPeriodEnds('2026-07-31', '2026-11-03')).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
    ]);
  });

  it('a period settled to a day inside a month leaves that month open', () => {
    expect(openPeriodEnds('2026-09-15', '2026-11-03')).toEqual(['2026-09-30', '2026-10-31']);
    expect(openPeriodEnds('2026-10-15', '2026-11-03')).toEqual(['2026-10-31']);
  });

  it('is empty when every ended month is settled, and never offers a month that has not ended', () => {
    expect(openPeriodEnds('2026-10-31', '2026-11-03')).toEqual([]);
    expect(openPeriodEnds('2026-10-31', '2026-11-30')).toEqual([]);
    expect(openPeriodEnds('2026-10-31', '2026-12-01')).toEqual(['2026-11-30']);
  });

  it('crosses a year end', () => {
    expect(openPeriodEnds('2026-11-30', '2027-02-02')).toEqual(['2026-12-31', '2027-01-31']);
  });

  it('is capped, keeping the oldest', () => {
    expect(openPeriodEnds('2020-12-31', '2026-11-03', 3)).toEqual([
      '2021-01-31',
      '2021-02-28',
      '2021-03-31',
    ]);
  });
});
