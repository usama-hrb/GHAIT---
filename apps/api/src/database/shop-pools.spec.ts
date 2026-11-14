import { describe, expect, it } from 'vitest';
import { type AppConfig, parseConfig } from '../config/index.js';
import { bindShop, type ShopRef } from './shop-binding.js';
import { ShopPools } from './shop-pools.js';

const BASE = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://fabric:secret@127.0.0.1:1/fabric',
  JWT_ACCESS_SECRET: 'unit-test-secret-0123456789abcdef-abcdef',
};

function pools(extra: Record<string, string> = {}): ShopPools {
  const config: AppConfig = parseConfig({ ...BASE, ...extra });
  return new ShopPools(config);
}

const A: ShopRef = { id: 'a'.repeat(8), slug: 'shop_a', databaseName: 'shop_a_db' };
const B: ShopRef = { id: 'b'.repeat(8), slug: 'shop_b', databaseName: 'shop_b_db' };

// Pools connect only when a query runs, and nothing here runs one: there is no server at port 1.
describe('ShopPools', () => {
  it('one-shop mode: the one database, bound or not', () => {
    const p = pools();
    const db = p.current();
    expect(bindShop(A, () => p.current())).toBe(db);
  });

  it('multi-shop mode: a request bound to no shop gets an error, never a default shop', () => {
    const p = pools({ MULTI_SHOP: 'true' });
    expect(() => p.current()).toThrow(/No shop is bound/);
  });

  it('multi-shop mode: one database for each shop, made once', async () => {
    const p = pools({ MULTI_SHOP: 'true' });
    const a = bindShop(A, () => p.current());
    expect(bindShop(A, () => p.current())).toBe(a);
    expect(bindShop(B, () => p.current())).not.toBe(a);
    await p.onApplicationShutdown();
  });
});
