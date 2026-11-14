import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOOKUP_CACHE_MAX,
  LOOKUP_TTL_MS,
  RETRY_AFTER_FAILURE_MS,
  ShopLookup,
} from './shop-lookup.js';
import type { ShopSchema } from './shop-schema.js';
import type { ShopRecord, ShopsRepository } from './shops.repository.js';

const ID = '11111111-1111-4111-8111-111111111111';

function record(state: ShopRecord['state']): ShopRecord {
  return { id: ID, slug: 'shop_a', dbName: 'shop_a_db', state };
}

function setup(
  find: (host: string) => Promise<ShopRecord | undefined>,
  isCurrent: () => Promise<boolean> = () => Promise.resolve(true),
) {
  const findByHost = vi.fn(find);
  const isCurrentSpy = vi.fn(isCurrent);
  const lookup = new ShopLookup(
    { findByHost } as unknown as ShopsRepository,
    { isCurrent: isCurrentSpy } as unknown as ShopSchema,
  );
  return { lookup, findByHost, isCurrent: isCurrentSpy };
}

beforeEach(() => {
  // The failure paths log an error on purpose; the output would only bury the test results.
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('ShopLookup', () => {
  it('names what a shop is doing by its state', async () => {
    const states: [ShopRecord['state'], string][] = [
      ['active', 'serve'],
      ['suspended', 'suspended'],
      ['provisioning', 'starting'],
      ['closed', 'unknown'],
    ];
    for (const [state, kind] of states) {
      const { lookup } = setup(() => Promise.resolve(record(state)));
      expect((await lookup.resolve('shop.test')).kind).toBe(kind);
    }
    const { lookup } = setup(() => Promise.resolve(undefined));
    expect(await lookup.resolve('shop.test')).toEqual({ kind: 'unknown' });
  });

  it('gives the shop a request is bound to: id, slug and database', async () => {
    const { lookup } = setup(() => Promise.resolve(record('active')));
    expect(await lookup.resolve('shop.test')).toEqual({
      kind: 'serve',
      shop: { id: ID, slug: 'shop_a', databaseName: 'shop_a_db' },
    });
  });

  describe('a shop that is missing migrations', () => {
    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('is not served: it answers updating', async () => {
      const { lookup } = setup(
        () => Promise.resolve(record('active')),
        () => Promise.resolve(false),
      );
      expect(await lookup.resolve('shop.test')).toEqual({ kind: 'updating' });
    });

    it('is checked again with the answer, so a fixed shop is served in 30 seconds', async () => {
      let current = false;
      const { lookup, isCurrent } = setup(
        () => Promise.resolve(record('active')),
        () => Promise.resolve(current),
      );
      expect((await lookup.resolve('shop.test')).kind).toBe('updating');
      current = true;
      expect((await lookup.resolve('shop.test')).kind).toBe('updating');
      expect(isCurrent).toHaveBeenCalledTimes(1);
      later(LOOKUP_TTL_MS);
      expect((await lookup.resolve('shop.test')).kind).toBe('serve');
      expect(isCurrent).toHaveBeenCalledTimes(2);
    });

    it('is checked only when the shop would be served', async () => {
      for (const state of ['suspended', 'provisioning', 'closed'] as const) {
        const { lookup, isCurrent } = setup(() => Promise.resolve(record(state)));
        await lookup.resolve('shop.test');
        expect(isCurrent).not.toHaveBeenCalled();
      }
    });
  });

  it('asks the control database once in 30 seconds, then again', async () => {
    const { lookup, findByHost } = setup(() => Promise.resolve(record('active')));
    await lookup.resolve('shop.test');
    later(LOOKUP_TTL_MS - 1);
    await lookup.resolve('shop.test');
    expect(findByHost).toHaveBeenCalledTimes(1);
    later(2);
    await lookup.resolve('shop.test');
    expect(findByHost).toHaveBeenCalledTimes(2);
  });

  it('sees a change of state once the answer is old', async () => {
    let state: ShopRecord['state'] = 'active';
    const { lookup } = setup(() => Promise.resolve(record(state)));
    expect((await lookup.resolve('shop.test')).kind).toBe('serve');
    state = 'suspended';
    expect((await lookup.resolve('shop.test')).kind).toBe('serve');
    later(LOOKUP_TTL_MS + 1);
    expect((await lookup.resolve('shop.test')).kind).toBe('suspended');
  });

  it('asks once for a burst of requests to a cold address', async () => {
    let release: (value: ShopRecord) => void = () => undefined;
    const { lookup, findByHost } = setup(
      () => new Promise<ShopRecord>((resolve) => (release = resolve)),
    );
    const burst = Promise.all([1, 2, 3].map(() => lookup.resolve('shop.test')));
    release(record('active'));
    const answers = await burst;
    expect(findByHost).toHaveBeenCalledTimes(1);
    expect(answers.every((answer) => answer.kind === 'serve')).toBe(true);
  });

  it('does not look up a name that can never be an address', async () => {
    const { lookup, findByHost } = setup(() => Promise.resolve(record('active')));
    for (const host of ['', 'UPPER.test', 'a b.test', '-bad.test', '[::1]', "x'--"]) {
      expect(await lookup.resolve(host)).toEqual({ kind: 'unknown' });
    }
    expect(findByHost).not.toHaveBeenCalled();
  });

  describe('when the control database cannot be read', () => {
    it('keeps serving an address it answered before, even when the answer is old', async () => {
      let down = false;
      const { lookup } = setup(() => {
        if (down) return Promise.reject(new Error('connection refused'));
        return Promise.resolve(record('active'));
      });
      await lookup.resolve('shop.test');
      down = true;
      later(LOOKUP_TTL_MS + 1);
      expect((await lookup.resolve('shop.test')).kind).toBe('serve');
    });

    it('fails closed with 503 for an address it never answered', async () => {
      const { lookup } = setup(() => Promise.reject(new Error('connection refused')));
      await expect(lookup.resolve('new.test')).rejects.toMatchObject({
        code: 'service_unavailable',
        status: 503,
      });
    });

    it('does not try again for a few seconds, so requests do not queue on it', async () => {
      const { lookup, findByHost } = setup(() => Promise.reject(new Error('down')));
      await expect(lookup.resolve('new.test')).rejects.toBeDefined();
      await expect(lookup.resolve('other.test')).rejects.toBeDefined();
      expect(findByHost).toHaveBeenCalledTimes(1);
      later(RETRY_AFTER_FAILURE_MS + 1);
      await expect(lookup.resolve('new.test')).rejects.toBeDefined();
      expect(findByHost).toHaveBeenCalledTimes(2);
    });

    it('recovers when the control database is back', async () => {
      let down = true;
      const { lookup } = setup(() =>
        down ? Promise.reject(new Error('down')) : Promise.resolve(record('active')),
      );
      await expect(lookup.resolve('new.test')).rejects.toBeDefined();
      down = false;
      later(RETRY_AFTER_FAILURE_MS + 1);
      expect((await lookup.resolve('new.test')).kind).toBe('serve');
    });
  });

  it('keeps no more than LOOKUP_CACHE_MAX answers, however many addresses are tried', async () => {
    const { lookup, findByHost } = setup(() => Promise.resolve(undefined));
    for (let i = 0; i < LOOKUP_CACHE_MAX + 5; i++) await lookup.resolve(`h${String(i)}.test`);
    expect(findByHost).toHaveBeenCalledTimes(LOOKUP_CACHE_MAX + 5);
    // The newest are still cached, the oldest were let go.
    await lookup.resolve(`h${String(LOOKUP_CACHE_MAX + 4)}.test`);
    expect(findByHost).toHaveBeenCalledTimes(LOOKUP_CACHE_MAX + 5);
    await lookup.resolve('h0.test');
    expect(findByHost).toHaveBeenCalledTimes(LOOKUP_CACHE_MAX + 6);
  });
});
