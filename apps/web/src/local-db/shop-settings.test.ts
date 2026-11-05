import 'fake-indexeddb/auto';
import { formatMoneyAmount, parseMoneyInput } from '@fabric/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { ReadOnlyError, ValidationError } from './errors';
import { createRepositories } from './repositories';
import { NeedsServerError, type ServerLink } from './settlements';
import { LocalStore } from './store';

let db: ShopDatabase;
let store: LocalStore;

beforeEach(() => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db);
});

afterEach(async () => {
  await db.delete();
});

/**
 * A setting as the server sends it. The server keeps one row for a key and changes it in place,
 * so a second pull of the same key replaces the row it had (same id), as it does on a device.
 */
async function pulled(key: string, value: unknown) {
  const held = (await db.settings.toArray()).find(
    (row) => row.key === key && row.effectiveFrom === null,
  );
  await db.settings.put({
    id: held?.id ?? crypto.randomUUID(),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deviceId: 'server',
    voidedAt: null,
    serverSeq: null,
    key,
    value,
    effectiveFrom: null,
  });
}

/** A server that accepts a setting and sends it back on the next sync, as the real one does. */
function server(calls: string[] = []): ServerLink {
  let accepted: { key: string; value: unknown } | null = null;
  return {
    request: (path, schema, init) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const body = init?.body as { value: unknown; effectiveFrom: string | null };
      accepted = { key: path.split('/').at(-1) ?? '', value: body.value };
      return Promise.resolve(
        schema.parse({
          key: accepted.key,
          value: body.value,
          effectiveFrom: null,
          isDefault: false,
        }),
      );
    },
    syncNow: async () => {
      calls.push('sync');
      if (accepted) await pulled(accepted.key, accepted.value);
    },
  };
}

const logo = {
  contentType: 'image/jpeg' as const,
  width: 240,
  height: 120,
  byteLength: 6,
  data: '/9j/AAAA',
};

describe('the shop’s identity (ADR 0017)', () => {
  it('is the built-in name and no logo until the server sends one', async () => {
    const { settings } = createRepositories(store);
    expect(await settings.identity('2026-11-04')).toEqual({ name: 'غيث', logo: null });
    await pulled('shop_name', 'محل النور');
    await pulled('shop_logo', logo);
    expect(await settings.identity('2026-11-04')).toEqual({ name: 'محل النور', logo });
  });

  it('falls back to the default for a stored value that is no longer valid', async () => {
    const { settings } = createRepositories(store);
    await pulled('shop_logo', { contentType: 'image/png' });
    expect((await settings.identity('2026-11-04')).logo).toBeNull();
  });
});

describe('changing a setting', () => {
  it('goes to the server, then syncs, so the device shows what the server accepted', async () => {
    const calls: string[] = [];
    const { settings } = createRepositories(store, server(calls));
    await settings.save('shop_name', 'محل النور');
    await settings.save('shop_logo', logo);
    expect(calls).toEqual(['PUT /settings/shop_name', 'sync', 'PUT /settings/shop_logo', 'sync']);
    expect(await settings.identity('2026-11-04')).toEqual({ name: 'محل النور', logo });
    // Removing the logo is saving none.
    await settings.save('shop_logo', null);
    expect((await settings.identity('2026-11-04')).logo).toBeNull();
  });

  it('is refused with no server link, and nothing is kept as if it were saved', async () => {
    const { settings } = createRepositories(store);
    await expect(settings.save('shop_name', 'محل النور')).rejects.toBeInstanceOf(NeedsServerError);
    expect((await settings.identity('2026-11-04')).name).toBe('غيث');
    expect(await db.outbox.count()).toBe(0);
  });

  it('is refused here, before the server is asked, when the contract would refuse it', async () => {
    const calls: string[] = [];
    const { settings } = createRepositories(store, server(calls));
    await expect(settings.save('shop_name', '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(settings.save('shop_logo', { ...logo, data: 'iVBORw0K' })).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: 'photo_not_jpeg' })],
    });
    expect(calls).toEqual([]);
  });

  it('is not for a read-only account', async () => {
    const calls: string[] = [];
    const { settings } = createRepositories(store, server(calls));
    store.setReadOnly(true);
    await expect(settings.save('shop_name', 'محل النور')).rejects.toBeInstanceOf(ReadOnlyError);
    expect(calls).toEqual([]);
  });
});

describe('the money display unit never changes an amount (ADR 0017)', () => {
  it('leaves every stored amount as it was, whichever unit is chosen', async () => {
    const repositories = createRepositories(store, server());
    await repositories.expenses.save({
      date: '2026-11-02',
      category: 'rent',
      amountCents: 123_450,
      paidDate: '2026-11-02',
    });
    const before = JSON.stringify(await db.expenses.toArray());
    expect(await repositories.settings.moneyUnit('2026-11-04')).toBe('rial');
    await repositories.settings.save('money_display_unit', 'dirham');
    expect(await repositories.settings.moneyUnit('2026-11-04')).toBe('dirham');
    await repositories.settings.save('money_display_unit', 'rial');
    expect(await repositories.settings.moneyUnit('2026-11-04')).toBe('rial');
    expect(JSON.stringify(await db.expenses.toArray())).toBe(before);
    expect(await db.outbox.count()).toBe(1);
  });

  it('reads the same cents back in either unit: what is typed is what is stored', () => {
    const cents = 123_450;
    for (const unit of ['rial', 'dirham'] as const) {
      const text = formatMoneyAmount(cents, unit, { grouping: false });
      expect(parseMoneyInput(text, unit)).toEqual({ ok: true, value: cents });
    }
  });
});
