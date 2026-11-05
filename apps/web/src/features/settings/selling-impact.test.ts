import { describe, expect, it } from 'vitest';
import { sellingImpact } from './selling-impact';

const product = (
  sellingUnits: ('meter' | 'piece')[],
  purchaseUnits: ('kg' | 'meter' | 'piece')[],
  extra: { active?: boolean; voidedAt?: string | null } = {},
) => ({ sellingUnits, purchaseUnits, active: true, voidedAt: null, ...extra });

const all = { piece: true, kg: true, meter: true };

describe('sellingImpact', () => {
  it('changes nothing while every unit stays on', () => {
    const products = [product(['meter'], ['kg', 'meter']), product(['piece'], ['piece'])];
    expect(sellingImpact(all, products)).toEqual({ unsellable: 0, restockBlocked: 0 });
  });

  it('refuses leaving a product with nothing to be sold in', () => {
    const products = [product(['meter'], ['meter']), product(['piece'], ['piece'])];
    expect(sellingImpact({ ...all, meter: false }, products)).toEqual({
      unsellable: 1,
      restockBlocked: 0,
    });
  });

  it('keeps a product that is sold in two units while one of them stays on', () => {
    const products = [product(['meter', 'piece'], ['meter'])];
    expect(sellingImpact({ ...all, meter: false }, products).unsellable).toBe(0);
  });

  it('only notices a product that can no longer be restocked, since it can still be sold', () => {
    const products = [product(['meter'], ['kg'])];
    expect(sellingImpact({ ...all, kg: false }, products)).toEqual({
      unsellable: 0,
      restockBlocked: 1,
    });
  });

  it('does not notice a product with another unit to buy in, or one never bought', () => {
    const products = [product(['meter'], ['kg', 'meter']), product(['meter'], [])];
    expect(sellingImpact({ ...all, kg: false }, products)).toEqual({
      unsellable: 0,
      restockBlocked: 0,
    });
  });

  it('counts a product once, as unsellable first', () => {
    const products = [product(['meter'], ['meter'])];
    expect(sellingImpact({ piece: true, kg: true, meter: false }, products)).toEqual({
      unsellable: 1,
      restockBlocked: 0,
    });
  });

  it('ignores inactive and removed products', () => {
    const products = [
      product(['meter'], ['meter'], { active: false }),
      product(['meter'], ['meter'], { voidedAt: '2026-11-01T00:00:00.000Z' }),
    ];
    expect(sellingImpact({ ...all, meter: false }, products)).toEqual({
      unsellable: 0,
      restockBlocked: 0,
    });
  });

  it('with weight alone on, every live product is unsellable', () => {
    const products = [product(['meter'], ['kg']), product(['piece'], ['piece'])];
    expect(sellingImpact({ piece: false, kg: true, meter: false }, products).unsellable).toBe(2);
  });
});
