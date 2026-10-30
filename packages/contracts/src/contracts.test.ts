import { describe, expect, it } from 'vitest';
import {
  errorResponseSchema,
  loginRequestSchema,
  parseSettingValue,
  SETTING_KEYS,
  SETTINGS,
  usernameSchema,
} from './index.js';

describe('settings registry', () => {
  it.each(SETTING_KEYS)('the default of %s is a valid value', (key) => {
    expect(SETTINGS[key].schema.safeParse(SETTINGS[key].default).success).toBe(true);
  });

  it('defaults follow the spec and core', () => {
    expect(SETTINGS.money_display_unit.default).toBe('rial');
    expect(SETTINGS.est_cm_per_kg_policy.default).toBe('average');
    expect(SETTINGS.remnant_threshold_cm.default).toBe(100);
    expect(SETTINGS.zakat_nisab_metal.default).toBe('gold');
  });

  it('validates a value for its key', () => {
    expect(parseSettingValue('money_display_unit', 'dirham')).toBe('dirham');
    expect(() => parseSettingValue('money_display_unit', 'euro')).toThrow();
    expect(() => parseSettingValue('remnant_threshold_cm', 1.5)).toThrow();
  });
});

describe('auth', () => {
  it('normalises usernames', () => {
    expect(usernameSchema.parse('  Owner.Shop ')).toBe('owner.shop');
    expect(usernameSchema.safeParse('a b').success).toBe(false);
  });

  it('accepts any non-empty password on login', () => {
    expect(loginRequestSchema.safeParse({ username: 'owner', password: 'x' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ username: 'owner', password: '' }).success).toBe(false);
  });
});

describe('errors', () => {
  it('has one shape', () => {
    expect(
      errorResponseSchema.safeParse({
        error: {
          code: 'validation_failed',
          message: 'Invalid input',
          requestId: 'r1',
          issues: [{ path: ['value'], message: 'Invalid option', code: 'invalid_value' }],
        },
      }).success,
    ).toBe(true);
    expect(errorResponseSchema.safeParse({ error: { code: 'nope', message: '' } }).success).toBe(
      false,
    );
  });
});
