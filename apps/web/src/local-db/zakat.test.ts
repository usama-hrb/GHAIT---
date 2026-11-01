import 'fake-indexeddb/auto';
import { hijriOf } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { DEVICE_CODE } from './session';
import { LocalStore } from './store';

let db: ShopDatabase;
let repos: Repositories;
/** 3 November 2026, a minute later at each call. */
let now = Date.UTC(2026, 10, 3, 9, 0);
const dh = (amount: number) => amount * 100;

/** A setting as the server sends it. */
async function setting(key: string, value: unknown) {
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
  const store = new LocalStore(db, () => new Date((now += 60_000)));
  repos = createRepositories(store);
  await store.setMeta(DEVICE_CODE, 'A');
  await repos.partners.saveBoth({
    owner: { name: 'أنا', ownershipBp: 5000 },
    partner: { name: 'شريكي' },
  });
  const [owner] = await repos.partners.list();
  await repos.partners.recordCapitalMove({
    partnerId: owner?.partner.id ?? '',
    kind: 'contribution',
    amountCents: dh(1000),
    date: '2025-11-01',
  });
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: dh(20),
    minPricePerMeterCents: dh(15),
  });
  const variantId = await repos.variants.save({ fabricId, colorName: 'أحمر' });
  await repos.purchases.create({
    method: 'meter',
    date: '2025-11-02',
    pricePerMeterCents: dh(16),
    rolls: [{ variantId, lengthCm: 5000 }],
  });
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
    expect(preview.fields.breakdown.goods[0]?.label).toBe('R-A0001 · روزا · أحمر');

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
