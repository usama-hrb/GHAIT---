import { describe, expect, it } from 'vitest';
import { RESERVED_SHOP_SLUGS } from './control/schema.js';
import { checkedHost, checkedSlug, databaseNameForSlug, ShopRefused } from './shop-names.js';

describe('checkedSlug', () => {
  it.each(['abc', 'main_shop', 'shop_2', 'a1_', `a${'b'.repeat(30)}`])('accepts %s', (slug) => {
    expect(checkedSlug(slug)).toBe(slug);
  });

  it.each([
    ['too short', 'ab'],
    ['too long (32)', `a${'b'.repeat(31)}`],
    ['empty', ''],
    ['starting with a digit', '1shop'],
    ['starting with an underscore', '_shop'],
    ['upper case', 'Shop'],
    ['with a hyphen', 'my-shop'],
    ['with a space', 'my shop'],
    ['with a dot', 'my.shop'],
    ['with a quote', "shop'"],
    ['with a double quote', 'shop"x'],
    ['an injection', 'abc"; DROP DATABASE fabric; --'],
    ['with a newline at the end', 'shop\n'],
    ['Arabic', 'متجر'],
  ])('refuses %s', (_label, slug) => {
    expect(() => checkedSlug(slug)).toThrow(ShopRefused);
  });

  it('refuses every reserved name, and says it is reserved', () => {
    expect([...RESERVED_SHOP_SLUGS].sort()).toEqual(
      ['admin', 'all', 'api', 'app', 'control', 'www'].sort(),
    );
    for (const slug of RESERVED_SHOP_SLUGS) {
      expect(() => checkedSlug(slug)).toThrow(/reserved/);
    }
  });

  it('refuses with the error of the caller when one is given', () => {
    class Mine extends Error {}
    expect(() => checkedSlug('A', (message) => new Mine(message))).toThrow(Mine);
  });
});

describe('databaseNameForSlug', () => {
  it('is shop_<slug>, which is a valid database name for every valid slug', () => {
    expect(databaseNameForSlug('main_shop')).toBe('shop_main_shop');
    // 63 is PostgreSQL's limit on a name: "shop_" and the longest slug (31) fit well inside it.
    expect(databaseNameForSlug(`a${'b'.repeat(30)}`).length).toBeLessThanOrEqual(63);
  });
});

describe('checkedHost', () => {
  it.each([
    ['shop.example.com', 'shop.example.com'],
    ['  Shop.Example.COM ', 'shop.example.com'],
    ['203.0.113.7', '203.0.113.7'],
    ['localhost', 'localhost'],
    ['a', 'a'],
  ])('accepts %s as %s', (typed, host) => {
    expect(checkedHost(typed)).toBe(host);
  });

  it.each([
    ['a scheme', 'https://shop.example.com'],
    ['a port', 'shop.example.com:443'],
    ['a path', 'shop.example.com/app'],
    ['credentials', 'me@shop.example.com'],
    ['a query', 'shop.example.com?x=1'],
    ['a space inside', 'shop example.com'],
    ['an underscore', 'shop_one.example.com'],
    ['a leading hyphen', '-shop.example.com'],
    ['a trailing dot', 'shop.example.com.'],
    ['empty', ''],
    ['Arabic', 'متجر.example'],
  ])('refuses %s, and says what an address is', (_label, host) => {
    expect(() => checkedHost(host)).toThrow(ShopRefused);
  });
});
