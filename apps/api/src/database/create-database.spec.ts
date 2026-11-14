import { describe, expect, it } from 'vitest';
import { quoteDatabaseName } from './create-database.js';
import { withDatabase } from './database-url.js';

describe('quoteDatabaseName', () => {
  it('quotes a plain lower-case name', () => {
    expect(quoteDatabaseName('shop_two')).toBe('"shop_two"');
    expect(quoteDatabaseName('fabric_control')).toBe('"fabric_control"');
  });

  it.each([
    ['empty', ''],
    ['too short', 'ab'],
    ['upper case', 'Shop'],
    ['a dash', 'shop-two'],
    ['a leading digit', '1shop'],
    ['a quote', 'shop"x'],
    ['a second statement', 'shop"; DROP DATABASE fabric_shop; --'],
    ['a space', 'shop two'],
    ['64 characters', `s${'x'.repeat(63)}`],
  ])('refuses a name with %s', (_label, name) => {
    expect(() => quoteDatabaseName(name)).toThrow(/Not a usable database name/);
  });
});

describe('withDatabase', () => {
  it('changes only the database: login, host, port and options stay', () => {
    expect(withDatabase('postgres://user:pass@db:5432/shop?sslmode=require', 'shop_two')).toBe(
      'postgres://user:pass@db:5432/shop_two?sslmode=require',
    );
  });

  it('keeps a postgresql:// scheme and a URL with no database yet', () => {
    expect(withDatabase('postgresql://user@localhost', 'fabric_control')).toBe(
      'postgresql://user@localhost/fabric_control',
    );
  });

  it('does not let a name change the rest of the URL', () => {
    expect(withDatabase('postgres://user:pass@db:5432/shop', 'x/../../y?z')).toBe(
      'postgres://user:pass@db:5432/x%2F..%2F..%2Fy%3Fz',
    );
  });
});
