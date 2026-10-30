import { describe, expect, it } from 'vitest';
import type { SettingRow } from './settings.repository.js';
import { resolveSetting, shopToday } from './settings.service.js';

const row = (overrides: Partial<SettingRow>): SettingRow => ({
  id: crypto.randomUUID(),
  createdAt: new Date(),
  updatedAt: new Date(),
  deviceId: 'server',
  voidedAt: null,
  serverSeq: 1,
  key: 'remnant_threshold_cm',
  value: 80,
  effectiveFrom: null,
  ...overrides,
});

describe('resolveSetting', () => {
  it('falls back to the default without rows', () => {
    expect(resolveSetting('remnant_threshold_cm', [], '2026-10-29')).toEqual({
      key: 'remnant_threshold_cm',
      value: 100,
      effectiveFrom: null,
      isDefault: true,
    });
  });

  it('takes the latest row on or before the day; null is the earliest', () => {
    const rows = [
      row({ value: 90 }),
      row({ value: 80, effectiveFrom: '2026-01-01' }),
      row({ value: 120, effectiveFrom: '2027-01-01' }),
    ];
    expect(resolveSetting('remnant_threshold_cm', rows, '2025-06-01').value).toBe(90);
    expect(resolveSetting('remnant_threshold_cm', rows, '2026-01-01').value).toBe(80);
    expect(resolveSetting('remnant_threshold_cm', rows, '2026-12-31').value).toBe(80);
    expect(resolveSetting('remnant_threshold_cm', rows, '2027-01-01').value).toBe(120);
  });

  it('ignores voided rows and other keys', () => {
    const rows = [
      row({ value: 80, voidedAt: new Date() }),
      row({ key: 'money_display_unit', value: 'dirham' }),
    ];
    expect(resolveSetting('remnant_threshold_cm', rows, '2026-10-29').isDefault).toBe(true);
  });
});

describe('shopToday', () => {
  it('is the calendar day in Morocco (IANA Africa/Casablanca), not in UTC', () => {
    // July 2025, settled history: UTC+1, so 23:30 UTC is already the 16th in Casablanca.
    // (Past dates only: tzdata updates change Morocco's future offsets.)
    expect(shopToday(new Date('2025-07-15T23:30:00Z'))).toBe('2025-07-16');
    expect(shopToday(new Date('2025-07-15T12:00:00Z'))).toBe('2025-07-15');
  });
});
