import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/index.js';
import {
  formatSetupCode,
  hashSetupCode,
  newSetupCode,
  normalizeSetupCode,
  requireSetupCodeSecret,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
} from './setup-code.js';
import { ShopRefused } from './shop-names.js';

const SHAPE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

describe('the alphabet', () => {
  it('has 32 distinct characters and leaves out I, L, O and U', () => {
    expect(SETUP_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(SETUP_CODE_ALPHABET).size).toBe(32);
    for (const left of 'ILOU') expect(SETUP_CODE_ALPHABET).not.toContain(left);
  });

  it('makes a code of 60 bits: 12 characters of 5 bits', () => {
    expect(SETUP_CODE_LENGTH * Math.log2(SETUP_CODE_ALPHABET.length)).toBe(60);
  });
});

describe('newSetupCode', () => {
  it('is 12 characters of the alphabet', () => {
    for (let n = 0; n < 50; n += 1) expect(newSetupCode()).toMatch(SHAPE);
  });

  it('is not the same twice', () => {
    expect(new Set(Array.from({ length: 200 }, () => newSetupCode())).size).toBe(200);
  });

  it('reads each byte’s low 5 bits, from the source it is given', () => {
    const bytes = Uint8Array.from([0, 1, 9, 10, 31, 32, 33, 255, 128, 64, 17, 30]);
    // Low 5 bits: 0 1 9 10 31 0 1 31 0 0 17 30.
    expect(newSetupCode(() => bytes)).toBe('019AZ01Z00HY');
  });

  it('has no bias: the 256 values of a byte give each character exactly 8 times', () => {
    const counts = new Map<string, number>();
    for (let value = 0; value < 256; value += 1) {
      const code = newSetupCode(() => new Uint8Array(SETUP_CODE_LENGTH).fill(value));
      const character = code.charAt(0);
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    expect([...counts.values()].every((count) => count === 8)).toBe(true);
  });

  it('refuses a source of randomness that falls short', () => {
    expect(() => newSetupCode(() => new Uint8Array(5))).toThrow(/fell short/);
  });
});

describe('formatSetupCode and normalizeSetupCode', () => {
  it('shows the code in three groups of four', () => {
    expect(formatSetupCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
  });

  it('reads back what was shown, however it was typed', () => {
    const code = 'ABCDEFGHJKMN';
    for (const typed of [
      'ABCD-EFGH-JKMN',
      'abcd-efgh-jkmn',
      ' abcd efgh jkmn ',
      'ABCDEFGHJKMN',
      'abcd - efgh - jkmn',
    ]) {
      expect(normalizeSetupCode(typed)).toBe(code);
    }
  });

  it('round-trips every code that is made', () => {
    for (let n = 0; n < 100; n += 1) {
      const code = newSetupCode();
      expect(normalizeSetupCode(formatSetupCode(code))).toBe(code);
    }
  });

  it('reads the letters the alphabet leaves out as the digits they look like', () => {
    expect(normalizeSetupCode('OOOO-IIII-LLLL')).toBe('000011111111');
    expect(normalizeSetupCode('o0o0-1i1l-1l1l')).toBe('000011111111');
  });

  it.each([
    ['empty', ''],
    ['too short', 'ABCD-EFGH-JKM'],
    ['too long', 'ABCD-EFGH-JKMNP'],
    ['a U, which is not in the alphabet', 'ABCD-EFGH-JKMU'],
    ['a symbol', 'ABCD-EFGH-JK!N'],
    ['an Arabic letter', 'ABCD-EFGH-JKمN'],
    ['a quote', "ABCD-EFGH-JK'N"],
  ])('says null for %s', (_label, typed) => {
    expect(normalizeSetupCode(typed)).toBeNull();
  });
});

describe('hashSetupCode', () => {
  const secret = 'a-setup-code-secret-of-thirty-two-chars!';
  const shop = '0f7b2d0e-8f3f-4a53-9a06-5f1e1a1f7c11';
  const code = 'ABCDEFGHJKMN';

  it('is the HMAC-SHA256 as 64 hex characters, and is not the code', () => {
    const hash = hashSetupCode(secret, shop, code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code.toLowerCase());
  });

  it('is the same for the same inputs', () => {
    expect(hashSetupCode(secret, shop, code)).toBe(hashSetupCode(secret, shop, code));
  });

  it('changes with the secret, the shop and the code', () => {
    const hash = hashSetupCode(secret, shop, code);
    expect(hashSetupCode(`${secret}!`, shop, code)).not.toBe(hash);
    expect(hashSetupCode(secret, '1f7b2d0e-8f3f-4a53-9a06-5f1e1a1f7c11', code)).not.toBe(hash);
    expect(hashSetupCode(secret, shop, 'ABCDEFGHJKMP')).not.toBe(hash);
  });

  it('cannot be made to agree by moving text between the shop and the code', () => {
    expect(hashSetupCode(secret, 'a/b', 'c')).not.toBe(hashSetupCode(secret, 'a', 'b/c'));
  });
});

describe('requireSetupCodeSecret', () => {
  const configWith = (setupCodeSecret: string | undefined): AppConfig =>
    ({ multiShop: { controlDatabaseName: 'c', shopPoolMax: 5, setupCodeSecret } }) as AppConfig;

  it('gives the secret', () => {
    expect(requireSetupCodeSecret(configWith('x'.repeat(40)))).toBe('x'.repeat(40));
  });

  it('refuses, and says how to set it, when there is none', () => {
    expect(() => requireSetupCodeSecret(configWith(undefined))).toThrow(ShopRefused);
    expect(() => requireSetupCodeSecret(configWith(undefined))).toThrow(/openssl rand -base64 48/);
  });

  it('refuses when multi-shop is off, where there is no secret to have', () => {
    expect(() => requireSetupCodeSecret({ multiShop: null } as AppConfig)).toThrow(ShopRefused);
  });
});
