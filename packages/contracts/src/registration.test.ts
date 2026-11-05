import { describe, expect, it } from 'vitest';
import { loginRequestSchema, usernameSchema } from './auth.js';
import { CASHIER_SETTING_KEYS } from './access.js';
import {
  emailSchema,
  ownerRegistrationRequestSchema,
  REGISTRATION_ISSUES,
} from './registration.js';
import {
  DEFAULT_SELLING_UNITS,
  enabledSellingUnits,
  enabledStockUnits,
  SELLING_UNITS_ISSUES,
  sellingUnitsSchema,
} from './selling-units.js';
import { parseSettingValue, SETTINGS } from './settings.js';

const COMBINATIONS = [
  { piece: true, kg: false, meter: false },
  { piece: false, kg: true, meter: false },
  { piece: false, kg: false, meter: true },
  { piece: true, kg: true, meter: false },
  { piece: true, kg: false, meter: true },
  { piece: false, kg: true, meter: true },
  { piece: true, kg: true, meter: true },
] as const;

const valid = {
  fullName: '  Amina Alaoui ',
  email: ' Amina@Example.MA ',
  password: 'correct horse battery staple',
  confirmPassword: 'correct horse battery staple',
  shopName: ' Dar Al Qomash ',
  sellingUnits: DEFAULT_SELLING_UNITS,
  currency: 'dirham',
};

describe('selling units', () => {
  it('accepts each of the seven combinations of switches', () => {
    for (const combination of COMBINATIONS) {
      expect(sellingUnitsSchema.parse(combination)).toEqual(combination);
      expect(parseSettingValue('selling_units', combination)).toEqual(combination);
    }
  });

  it('refuses all three off, and a value that is not three booleans', () => {
    const none = sellingUnitsSchema.safeParse({ piece: false, kg: false, meter: false });
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]?.message).toBe(SELLING_UNITS_ISSUES.noneEnabled);
    expect(sellingUnitsSchema.safeParse({ piece: true, kg: false }).success).toBe(false);
    expect(sellingUnitsSchema.safeParse({ piece: 1, kg: 0, meter: 0 }).success).toBe(false);
  });

  it('leaves every unit on for a shop that never chose, as before the switches existed', () => {
    expect(SETTINGS.selling_units.default).toEqual({ piece: true, kg: true, meter: true });
    expect(enabledStockUnits(DEFAULT_SELLING_UNITS)).toEqual(['kg', 'meter', 'piece']);
  });

  it('lets weight be bought but never sold: kilogram is not a selling unit', () => {
    const weightOnly = { piece: false, kg: true, meter: false };
    expect(enabledStockUnits(weightOnly)).toEqual(['kg']);
    expect(enabledSellingUnits(weightOnly)).toEqual([]);
    expect(enabledSellingUnits({ piece: true, kg: true, meter: true })).toEqual(['meter', 'piece']);
  });

  it('is sent to a cashier, whose till needs it to offer the right units', () => {
    expect(CASHIER_SETTING_KEYS).toContain('selling_units');
  });
});

describe('owner registration', () => {
  it('accepts a complete request for every combination of units, in either currency', () => {
    for (const sellingUnits of COMBINATIONS) {
      for (const currency of ['dirham', 'rial']) {
        const parsed = ownerRegistrationRequestSchema.parse({ ...valid, sellingUnits, currency });
        expect(parsed.sellingUnits).toEqual(sellingUnits);
        expect(parsed.currency).toBe(currency);
      }
    }
  });

  it('trims the names, lower-cases the email and has no logo unless one is sent', () => {
    const parsed = ownerRegistrationRequestSchema.parse(valid);
    expect(parsed).toMatchObject({
      fullName: 'Amina Alaoui',
      email: 'amina@example.ma',
      shopName: 'Dar Al Qomash',
      shopLogo: null,
    });
  });

  it('asks for every required field', () => {
    for (const field of ['fullName', 'email', 'password', 'confirmPassword', 'shopName']) {
      const rest = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
      expect(ownerRegistrationRequestSchema.safeParse(rest).success, field).toBe(false);
    }
    expect(
      ownerRegistrationRequestSchema.safeParse({ ...valid, sellingUnits: undefined }).success,
    ).toBe(false);
    expect(ownerRegistrationRequestSchema.safeParse({ ...valid, shopName: '   ' }).success).toBe(
      false,
    );
  });

  it('refuses a short password and a confirmation that differs', () => {
    expect(
      ownerRegistrationRequestSchema.safeParse({
        ...valid,
        password: 'too short',
        confirmPassword: 'too short',
      }).success,
    ).toBe(false);
    const mismatch = ownerRegistrationRequestSchema.safeParse({
      ...valid,
      confirmPassword: 'correct horse battery stapl3',
    });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]).toMatchObject({
      path: ['confirmPassword'],
      message: REGISTRATION_ISSUES.passwordMismatch,
    });
  });

  it('refuses all units off', () => {
    const parsed = ownerRegistrationRequestSchema.safeParse({
      ...valid,
      sellingUnits: { piece: false, kg: false, meter: false },
    });
    expect(parsed.success).toBe(false);
  });

  it('drops a role or shop id the client sends: the server decides both', () => {
    const parsed = ownerRegistrationRequestSchema.parse({
      ...valid,
      role: 'partner',
      shopId: 'someone-elses-shop',
    });
    expect(parsed).not.toHaveProperty('role');
    expect(parsed).not.toHaveProperty('shopId');
  });

  it('refuses an unknown currency', () => {
    expect(ownerRegistrationRequestSchema.safeParse({ ...valid, currency: 'euro' }).success).toBe(
      false,
    );
  });
});

describe('sign-in identifier', () => {
  it('accepts an email as well as the short names accounts already have', () => {
    expect(emailSchema.parse(' Amina@Example.MA ')).toBe('amina@example.ma');
    expect(usernameSchema.parse('owner')).toBe('owner');
    expect(usernameSchema.parse('Amina@Example.MA')).toBe('amina@example.ma');
    expect(loginRequestSchema.parse({ username: 'Amina@Example.MA', password: 'x' }).username).toBe(
      'amina@example.ma',
    );
  });

  it('refuses a malformed email and characters a sign-in cannot carry', () => {
    for (const bad of [
      'no-at-sign',
      'a@b',
      '@example.ma',
      'a b@example.ma',
      "o'brien@example.ma",
    ]) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('has space').success).toBe(false);
  });
});
