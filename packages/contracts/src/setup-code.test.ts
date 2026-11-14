import { describe, expect, it } from 'vitest';
import { ownerRegistrationRequestSchema, registrationStatusSchema } from './registration.js';
import {
  formatSetupCode,
  normalizeSetupCode,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  SETUP_CODE_TYPED_MAX,
} from './setup-code.js';

describe('setup code shape', () => {
  it('is 12 characters of an alphabet of 32 without I, L, O and U', () => {
    expect(SETUP_CODE_LENGTH).toBe(12);
    expect(SETUP_CODE_ALPHABET).toHaveLength(32);
    for (const left of 'ILOU') expect(SETUP_CODE_ALPHABET).not.toContain(left);
  });

  it('reads what a person types', () => {
    expect(normalizeSetupCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeSetupCode('  ABCD EFGH  JKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizeSetupCode('OIL0-0000-0000')).toBe('011000000000');
  });

  it('refuses what cannot be a code', () => {
    for (const typed of ['', 'ABC', 'ABCDEFGHJKMNP', 'ABCD-EFGH-JKM!', 'UUUU-UUUU-UUUU']) {
      expect(normalizeSetupCode(typed)).toBeNull();
    }
  });

  it('formats a code in groups of four, and the form reads back as the same code', () => {
    expect(formatSetupCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeSetupCode(formatSetupCode('0123456789AB'))).toBe('0123456789AB');
  });
});

describe('the sign-up contract and the setup code', () => {
  const request = {
    fullName: 'Amina Alaoui',
    email: 'amina@example.ma',
    password: 'correct horse battery staple',
    confirmPassword: 'correct horse battery staple',
    shopName: 'Dar Al Qomash',
    sellingUnits: { piece: false, kg: true, meter: true },
    currency: 'dirham',
  };

  it('takes a code as typed, or none', () => {
    expect(ownerRegistrationRequestSchema.safeParse(request).success).toBe(true);
    const typed = ownerRegistrationRequestSchema.parse({ ...request, setupCode: ' abcd-efgh ' });
    expect(typed.setupCode).toBe(' abcd-efgh ');
  });

  it('does not judge the code: any text up to the limit is taken, a longer one is not', () => {
    for (const setupCode of ['', 'nonsense', 'x'.repeat(SETUP_CODE_TYPED_MAX)]) {
      expect(ownerRegistrationRequestSchema.safeParse({ ...request, setupCode }).success).toBe(
        true,
      );
    }
    expect(
      ownerRegistrationRequestSchema.safeParse({
        ...request,
        setupCode: 'x'.repeat(SETUP_CODE_TYPED_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it('has the status carry the need for a code only when it is true', () => {
    expect(registrationStatusSchema.parse({ open: true })).toEqual({ open: true });
    expect(registrationStatusSchema.parse({ open: true, setupCodeRequired: true })).toEqual({
      open: true,
      setupCodeRequired: true,
    });
    expect(
      registrationStatusSchema.safeParse({ open: true, setupCodeRequired: false }).success,
    ).toBe(false);
  });
});
