import type { INestApplicationContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './config/index.js';
import { checkShopArgument, exitCodeOf, inShop, UsageError } from './shop-scope.js';

const base = {
  DATABASE_URL: 'postgres://fabric:s3cret-pass@localhost:5432/fabric_shop',
  JWT_ACCESS_SECRET: 'a-test-secret-that-is-long-enough-1234',
};
const oneShop = parseConfig(base);
const manyShops = parseConfig({
  ...base,
  MULTI_SHOP: 'true',
  SETUP_CODE_SECRET: 'a-setup-code-secret-that-is-long-enough-1234',
});

/** A context that must never be asked for anything: these paths decide before they use it. */
const noApp = new Proxy({} as INestApplicationContext, {
  get() {
    throw new Error('the app was used');
  },
});

describe('checkShopArgument', () => {
  it('lets a one-shop server run with no shop', () => {
    expect(() => {
      checkShopArgument(oneShop, undefined);
    }).not.toThrow();
  });

  it('refuses a shop on a one-shop server', () => {
    const check = (): void => {
      checkShopArgument(oneShop, 'shop_a');
    };
    expect(check).toThrow(UsageError);
    expect(check).toThrow('SHOP is only for MULTI_SHOP=true: this server has one shop.');
  });

  it('needs a shop on a many-shop server, and never picks one', () => {
    const none = (): void => {
      checkShopArgument(manyShops, undefined);
    };
    expect(none).toThrow(UsageError);
    expect(() => {
      checkShopArgument(manyShops, '');
    }).toThrow(UsageError);
    expect(none).toThrow('SHOP=<slug>');
  });

  it('takes a shop on a many-shop server', () => {
    expect(() => {
      checkShopArgument(manyShops, 'shop_a');
    }).not.toThrow();
  });
});

describe('inShop', () => {
  it('runs the work as it is on a one-shop server', async () => {
    await expect(inShop(noApp, oneShop, undefined, () => Promise.resolve('done'))).resolves.toBe(
      'done',
    );
  });

  it('refuses before the work runs', async () => {
    let ran = false;
    const work = (): Promise<void> => {
      ran = true;
      return Promise.resolve();
    };
    await expect(inShop(noApp, oneShop, 'shop_a', work)).rejects.toBeInstanceOf(UsageError);
    await expect(inShop(noApp, manyShops, undefined, work)).rejects.toBeInstanceOf(UsageError);
    expect(ran).toBe(false);
  });
});

describe('exitCodeOf', () => {
  it('is 2 for a wrong use and 1 for anything else', () => {
    expect(exitCodeOf(new UsageError('no'))).toBe(2);
    expect(exitCodeOf(new Error('boom'))).toBe(1);
    expect(exitCodeOf('boom')).toBe(1);
  });
});
