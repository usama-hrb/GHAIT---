import { describe, expect, it } from 'vitest';
import { bindShop, currentShop, type ShopRef } from './shop-binding.js';

const A: ShopRef = { id: 'a'.repeat(8), slug: 'shop_a', databaseName: 'shop_a_db' };
const B: ShopRef = { id: 'b'.repeat(8), slug: 'shop_b', databaseName: 'shop_b_db' };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('bindShop', () => {
  it('has no shop outside', () => {
    expect(currentShop()).toBeUndefined();
  });

  it('gives the shop to everything the work awaits, and takes it away after', async () => {
    const seen = await bindShop(A, async () => {
      await tick();
      return currentShop();
    });
    expect(seen).toBe(A);
    expect(currentShop()).toBeUndefined();
  });

  it('keeps two works at once apart', async () => {
    const [a, b] = await Promise.all([
      bindShop(A, async () => {
        await tick();
        await tick();
        return currentShop();
      }),
      bindShop(B, async () => {
        await tick();
        return currentShop();
      }),
    ]);
    expect(a).toBe(A);
    expect(b).toBe(B);
  });

  it('refuses to enter a shop inside the work of another, or of the same one', async () => {
    await bindShop(A, async () => {
      await tick();
      expect(() => bindShop(B, () => 'never')).toThrow(/inside the work of shop "shop_a"/);
      expect(() => bindShop(A, () => 'never')).toThrow(/inside the work of shop "shop_a"/);
      expect(currentShop()).toBe(A);
    });
  });

  it('lets a shop be entered again once the first work has ended', async () => {
    await bindShop(A, () => Promise.resolve());
    await expect(bindShop(B, () => Promise.resolve(currentShop()))).resolves.toBe(B);
  });
});
