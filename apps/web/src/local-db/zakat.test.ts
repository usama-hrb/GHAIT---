import 'fake-indexeddb/auto';
import { hijriOf, zakatDrawIdOf } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import type { ServerLink } from './settlements';
import { LocalStore } from './store';
import { PULLED_AT } from './sync';
import { seedBatch, seedPartners, seedProduct } from './test-helpers';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
/** 3 November 2026, a minute later at each call. */
let now = Date.UTC(2026, 10, 3, 9, 0);
const dh = (amount: number) => amount * 100;

/** A setting as the server sends it: one current row per key, so a newer value replaces the one before. */
async function setting(key: string, value: unknown) {
  await db.settings.where('key').equals(key).delete();
  await db.settings.put({
    id: crypto.randomUUID(),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deviceId: 'server',
    voidedAt: null,
    serverSeq: null,
    key,
    value,
    effectiveFrom: null,
  });
}

beforeEach(async () => {
  now = Date.UTC(2026, 10, 3, 9, 0);
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => new Date((now += 60_000)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  // A device that has received the shop's records, as every device in use has.
  await store.setMeta(PULLED_AT, '2026-11-03T08:00:00.000Z');
  await seedPartners(repos);
  const [owner] = await repos.partners.list();
  await repos.partners.recordCapitalMove({
    partnerId: owner?.partner.id ?? '',
    kind: 'contribution',
    amountCents: dh(1000),
    date: '2025-11-01',
  });
  await seedBatch(
    repos,
    await seedProduct(repos, { pricePerMeterCents: dh(20), minPricePerMeterCents: dh(15) }),
    5000,
    { date: '2025-11-02', costPerMeterCents: dh(16) },
  );
});

afterEach(async () => {
  await db.delete();
});

describe('zakat on the device (BUILD_PROMPTS 5.1)', () => {
  it('needs the hawl start and the metal price before anything is computed', async () => {
    expect(await repos.zakat.preview()).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ message: 'zakat_hawl_start_missing' })],
    });
    await setting('zakat_hawl_start', '2025-11-01');
    expect(await repos.zakat.preview()).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ message: 'zakat_metal_price_missing' })],
    });
  });

  it('the latest hawl’s report: stock at market, money; saved once, paid by ownership', async () => {
    await setting('zakat_hawl_start', '2025-11-01');
    await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: '2026-10-20' });
    const hawl = await repos.zakat.hawl();
    expect(hawl.last).not.toBeNull();
    const [start, last] = [hijriOf('2025-11-01'), hijriOf(hawl.last ?? '')];
    expect([last.year - start.year, last.month]).toEqual([1, start.month]);
    expect(await repos.zakat.reminder()).toEqual({ kind: 'due', hawlDate: hawl.last });

    const preview = await repos.zakat.preview();
    if (!preview.ok) throw new Error('a preview');
    // 50 m at 20 dh = 1000 dh of goods, 200 dh of money: 1200 dh ≥ the nisab (85 g × 10 dh).
    expect(preview.fields).toMatchObject({
      nisabCents: dh(850),
      baseCents: dh(1200),
      zakatDueCents: dh(30),
      breakdown: { goodsCents: dh(1000), cashCents: dh(200), hawlCompleted: true },
    });
    expect(preview.fields.breakdown.goods[0]?.label).toBe('B-A0001 · روزا');

    const id = await repos.zakat.save();
    await expect(repos.zakat.save()).rejects.toBeInstanceOf(ValidationError);
    expect(await repos.zakat.reminder()).toBeNull();

    await expect(
      repos.zakat.pay(id, { amountCents: dh(31), date: '2026-11-03' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await repos.zakat.pay(id, { amountCents: dh(30), date: '2026-11-03' });
    const view = await repos.zakat.report(id);
    expect(view?.paidCents).toBe(dh(30));
    expect(view?.payments.map((draw) => [draw.partnerName, draw.amountCents])).toEqual([
      ['أنا', dh(15)],
      ['شريكي', dh(15)],
    ]);
    await expect(repos.zakat.void(id, 'خطأ')).rejects.toBeInstanceOf(ValidationError);
    expect((await repos.zakat.history())[0]).toMatchObject({ id, paidCents: dh(30) });
    expect((await db.outbox.toArray()).slice(-3).map((op) => op.entity)).toEqual([
      'zakat_report',
      'partner_draw',
      'partner_draw',
    ]);
  });

  it('before the first hawl the position shows, but no report is saved; settings need the server', async () => {
    await setting('zakat_hawl_start', '2026-06-01');
    await setting('zakat_nisab_metal', 'silver');
    await setting('zakat_silver_price', { pricePerGramCents: dh(1), date: '2026-10-20' });
    const preview = await repos.zakat.preview();
    expect(preview).toMatchObject({
      ok: true,
      fields: { zakatDueCents: 0, breakdown: { hawlCompleted: false } },
    });
    await expect(repos.zakat.save()).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'zakat_hawl_not_reached' })],
    });
    await expect(repos.zakat.saveOption('zakat_reminder_days', 7)).rejects.toThrow(
      'Settings are changed on the server',
    );
  });
});

/** The first hawl's start, and a gold price dated on the hawl, so no price check gets in the way. */
async function configureForDueHawl(): Promise<string> {
  await setting('zakat_hawl_start', '2025-11-01');
  const { last } = await repos.zakat.hawl();
  if (last === null) throw new Error('the first hawl has come by 3 November 2026');
  await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: last });
  return last;
}

describe('the Zakat Management Center on the device (ADR 0028)', () => {
  it('with nothing set up it is not configured, names what is missing and works out nothing', async () => {
    const review = await repos.zakat.review();
    expect(review.status).toBe('not_configured');
    expect(review.items.map((item) => item.key)).toEqual(['hawl_start_missing', 'price_missing']);
    expect(review).toMatchObject({ estimate: null, latest: null, lastCalculatedAt: null });
  });

  it('before the first hawl it follows the hawl and shows today’s position as an estimate, claiming no zakat', async () => {
    await setting('zakat_hawl_start', '2026-06-01');
    await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: '2026-10-20' });
    const review = await repos.zakat.review();
    expect(review.status).toBe('hawl_in_progress');
    expect(review.clock).toMatchObject({ start: '2026-06-01', last: null, startsLater: false });
    expect(review.estimate?.fields.hawlDate).toBe('2026-11-03');
    expect(review.latest).toBeNull();
  });

  it('a start day still ahead is waiting for the hawl', async () => {
    await setting('zakat_hawl_start', '2027-01-15');
    await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: '2026-10-20' });
    expect((await repos.zakat.review()).status).toBe('waiting_for_hawl');
  });

  it('the hawl has come: due is only an estimate, equal to what saving the report stores', async () => {
    const hawl = await configureForDueHawl();
    const review = await repos.zakat.review();
    const preview = await repos.zakat.preview();
    if (!preview.ok) throw new Error('a preview');
    expect(review.status).toBe('zakat_due');
    expect(review.clock.last).toBe(hawl);
    expect(review.estimate?.fields).toEqual(preview.fields);
    // 50 m at 20 dh = 1000 dh of goods and 200 dh of money, above the nisab of 85 g at 10 dh.
    expect(review.estimate?.nisab).toMatchObject({ reached: true, thresholdCents: dh(850) });
    expect(review.estimate?.categories.map((category) => [category.key, category.cents])).toEqual([
      ['money', dh(200)],
      ['inventory', dh(1000)],
      ['receivables', 0],
      ['doubtful_receivables', 0],
      ['customer_credits', 0],
      ['supplier_debts', 0],
      ['unpaid_bills', 0],
      ['other_assets', null],
    ]);
  });

  it('a price dated before the hawl asks for a look instead of being called due', async () => {
    const hawl = await configureForDueHawl();
    await setting('zakat_gold_price', {
      pricePerGramCents: dh(10),
      date: new Date(Date.parse(`${hawl}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
    });
    const review = await repos.zakat.review();
    expect(review.items.map((item) => item.key)).toContain('price_before_hawl');
    expect(review.status).toBe('review_required');
  });

  it('the status moves from due to calculation completed to payment recorded, from the records alone', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    let review = await repos.zakat.review();
    expect(review.status).toBe('calculation_completed');
    expect(review.latest).toMatchObject({ id, zakatDueCents: dh(30), paidCents: 0 });
    expect(review.lastCalculatedAt).toBe(review.latest?.savedAt);

    await repos.zakat.pay(id, { amountCents: dh(10), date: '2026-11-03' });
    review = await repos.zakat.review();
    expect(review.status).toBe('payment_recorded');
    expect(review.latest?.paidCents).toBe(dh(10));
  });

  it('a report voided frees its hawl: the estimate shows again and no calculation counts as made', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    await repos.zakat.void(id, 'wrong price');
    const review = await repos.zakat.review();
    expect(review.status).toBe('zakat_due');
    expect(review.latest).toBeNull();
    expect(review.lastCalculatedAt).toBeNull();
  });

  it('looking writes nothing: no record, no queued change', async () => {
    await configureForDueHawl();
    const before = [
      await db.outbox.count(),
      await db.zakatReports.count(),
      await db.partnerDraws.count(),
    ];
    await repos.zakat.review();
    await repos.zakat.preview();
    expect([
      await db.outbox.count(),
      await db.zakatReports.count(),
      await db.partnerDraws.count(),
    ]).toEqual(before);
  });

  it('a device that never received the shop’s records is blocked, works out nothing and saves nothing', async () => {
    await configureForDueHawl();
    await db.meta.delete(PULLED_AT);
    const review = await repos.zakat.review();
    expect(review.status).toBe('review_required');
    expect(review.receivedAt).toBeNull();
    expect(
      review.items.filter((item) => item.severity === 'blocking').map((item) => item.key),
    ).toEqual(['records_not_received']);
    expect(review.estimate).toBeNull();
    await expect(repos.zakat.save()).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'zakat_records_not_received' })],
    });
    expect(await db.zakatReports.count()).toBe(0);
  });

  it('saves what was confirmed: figures that moved since are refused, and nothing is stored', async () => {
    await configureForDueHawl();
    const review = await repos.zakat.review();
    const shown = {
      baseCents: review.estimate?.fields.baseCents ?? -1,
      zakatDueCents: review.estimate?.fields.zakatDueCents ?? -1,
    };
    await expect(
      repos.zakat.save({ ...shown, baseCents: shown.baseCents + 1 }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'zakat_figures_changed' })],
    });
    expect(await db.zakatReports.count()).toBe(0);
    const id = await repos.zakat.save(shown);
    expect((await db.zakatReports.get(id))?.baseCents).toBe(shown.baseCents);
  });

  it('two taps on save make one report', async () => {
    await configureForDueHawl();
    const results = await Promise.allSettled([repos.zakat.save(), repos.zakat.save()]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.zakatReports.count()).toBe(1);
  });
});

describe('paying zakat is recorded once (ADR 0028)', () => {
  const day = '2026-11-03';
  const paidOn = (id: string) => repos.zakat.report(id).then((view) => view?.paidCents);
  const drawOps = async () =>
    (await db.outbox.toArray()).filter((op) => op.entity === 'partner_draw').length;

  it('the same payment sent again writes nothing, even after more was paid and it no longer fits', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    const first = crypto.randomUUID();
    await repos.zakat.pay(id, { amountCents: dh(20), date: day, paymentId: first });
    expect(await drawOps()).toBe(2);
    await repos.zakat.pay(id, { amountCents: dh(20), date: day, paymentId: first });
    expect(await drawOps()).toBe(2);
    expect(await paidOn(id)).toBe(dh(20));

    await repos.zakat.pay(id, { amountCents: dh(10), date: day, paymentId: crypto.randomUUID() });
    expect(await paidOn(id)).toBe(dh(30));
    // All of it is paid: sending the first payment again is still not a payment above what is due.
    await repos.zakat.pay(id, { amountCents: dh(20), date: day, paymentId: first });
    expect(await paidOn(id)).toBe(dh(30));
  });

  it('an id used again for another amount or another day is refused, and nothing changes', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    const paymentId = crypto.randomUUID();
    await repos.zakat.pay(id, { amountCents: dh(10), date: day, paymentId });
    for (const other of [
      { amountCents: dh(11), date: day },
      { amountCents: dh(10), date: '2026-11-02' },
    ]) {
      await expect(repos.zakat.pay(id, { ...other, paymentId })).rejects.toMatchObject({
        issues: [expect.objectContaining({ message: 'zakat_payment_id_reused' })],
      });
    }
    expect(await paidOn(id)).toBe(dh(10));
  });

  it('a payment’s draws have the ids its identity gives them, so every device writes the same ones', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    const paymentId = crypto.randomUUID();
    await repos.zakat.pay(id, { amountCents: dh(10), date: day, paymentId });
    const view = await repos.zakat.report(id);
    expect(view?.payments.map((draw) => draw.id).sort()).toEqual(
      (view?.payments ?? []).map((draw) => zakatDrawIdOf(paymentId, draw.partnerId)).sort(),
    );
  });

  it('without an identity every payment is a new one, as before', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    await repos.zakat.pay(id, { amountCents: dh(10), date: day });
    await repos.zakat.pay(id, { amountCents: dh(10), date: day });
    expect(await paidOn(id)).toBe(dh(20));
  });

  it('the note travels with the payment and reads back', async () => {
    const hawl = await configureForDueHawl();
    const id = await repos.zakat.save();
    await repos.zakat.pay(id, { amountCents: dh(10), date: day, note: 'Receipt 42 · Hassan' });
    const view = await repos.zakat.report(id);
    expect(new Set(view?.payments.map((draw) => draw.reason))).toEqual(
      new Set([`zakat ${hawl} · Receipt 42 · Hassan`]),
    );
  });

  it('all of a payment’s draws are written or none: a failure part-way leaves nothing behind', async () => {
    await configureForDueHawl();
    const id = await repos.zakat.save();
    const queued = await db.outbox.count();
    const add = db.outbox.add.bind(db.outbox);
    let calls = 0;
    const spy = vi.spyOn(db.outbox, 'add').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('the disk is full');
      return add(...args);
    });
    await expect(
      repos.zakat.pay(id, { amountCents: dh(10), date: day, paymentId: crypto.randomUUID() }),
    ).rejects.toThrow('the disk is full');
    spy.mockRestore();
    expect(await db.partnerDraws.count()).toBe(0);
    expect(await db.outbox.count()).toBe(queued);
    // Trying again, with the same identity, then works as a first payment.
    await repos.zakat.pay(id, { amountCents: dh(10), date: day, paymentId: crypto.randomUUID() });
    expect(await paidOn(id)).toBe(dh(10));
  });
});

describe('changing zakat settings (ADR 0017, ADR 0028)', () => {
  function recordingServer(calls: string[]): ServerLink {
    return {
      request: (path, schema, init) => {
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        const body = init?.body as { value: unknown };
        return Promise.resolve(
          schema.parse({
            key: path.split('/').at(-1),
            value: body.value,
            effectiveFrom: null,
            isDefault: false,
          }),
        );
      },
      syncNow: () => {
        calls.push('sync');
        return Promise.resolve();
      },
    };
  }

  it('sends only the settings that changed, then syncs once', async () => {
    await setting('zakat_hawl_start', '2025-11-01');
    await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: '2026-10-20' });
    const calls: string[] = [];
    const withServer = createRepositories(store, recordingServer(calls));
    const before = await withServer.zakat.options();
    const changed = await withServer.zakat.saveOptions({
      hawlStart: before.hawlStart,
      // The same price in another key order is no change.
      goldPrice: { date: '2026-10-20', pricePerGramCents: dh(10) },
      reminderDays: before.reminderDays + 1,
      includeDoubtfulDebts: !before.includeDoubtfulDebts,
    });
    expect(changed).toEqual(['zakat_include_doubtful_debts', 'zakat_reminder_days']);
    expect(calls).toEqual([
      'PUT /settings/zakat_include_doubtful_debts',
      'PUT /settings/zakat_reminder_days',
      'sync',
    ]);
  });

  it('with nothing changed it calls the server not at all', async () => {
    await setting('zakat_hawl_start', '2025-11-01');
    const calls: string[] = [];
    const withServer = createRepositories(store, recordingServer(calls));
    const before = await withServer.zakat.options();
    expect(await withServer.zakat.saveOptions(before)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a price can be cleared, and a start day can be cleared', async () => {
    await setting('zakat_hawl_start', '2025-11-01');
    await setting('zakat_gold_price', { pricePerGramCents: dh(10), date: '2026-10-20' });
    const calls: string[] = [];
    const withServer = createRepositories(store, recordingServer(calls));
    const changed = await withServer.zakat.saveOptions({ hawlStart: null, goldPrice: null });
    expect(changed).toEqual(['zakat_hawl_start', 'zakat_gold_price']);
  });

  it('needs the server', async () => {
    await expect(repos.zakat.saveOptions({ reminderDays: 3 })).rejects.toThrow(
      'Settings are changed on the server',
    );
  });
});
