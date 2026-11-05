import { describe, expect, it } from 'vitest';
import { CASHIER_SETTING_KEYS, redactForRole } from './access.js';
import { base64ByteLength, PHOTO_ISSUES, PHOTO_LIMIT_BYTES } from './photos.js';
import { parseSettingValue, SETTINGS, settingAuditValue } from './settings.js';
import { syncWeightOf } from './sync.js';
import { base } from './test-shop.js';

/** A base64 text that decodes to `bytes` bytes and starts like a JPEG. */
function fakeJpeg(bytes: number): string {
  const triples = Math.ceil(bytes / 3);
  const text = `/9j/${'A'.repeat(triples * 4 - 4)}`;
  const drop = triples * 3 - bytes;
  return drop === 0 ? text : `${text.slice(0, text.length - drop)}${'='.repeat(drop)}`;
}

const logo = (bytes = 3000) => ({
  contentType: 'image/jpeg' as const,
  width: 240,
  height: 120,
  byteLength: bytes,
  data: fakeJpeg(bytes),
});

const row = (value: unknown, key = 'shop_logo') => ({
  ...base('2026-11-04'),
  id: crypto.randomUUID(),
  key,
  value,
  effectiveFrom: null,
});

describe('the shop logo setting (ADR 0017)', () => {
  it('is none until one is set, and takes the photo image or null', () => {
    expect(SETTINGS.shop_logo.default).toBeNull();
    expect(parseSettingValue('shop_logo', null)).toBeNull();
    expect(parseSettingValue('shop_logo', logo())).toMatchObject({ width: 240, byteLength: 3000 });
  });

  it('refuses what is not a small JPEG, with the photo rules', () => {
    const issues = (value: unknown) => {
      const result = SETTINGS.shop_logo.schema.safeParse(value);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(issues({ ...logo(), data: `iVBO${'A'.repeat(3996)}` })).toContain(PHOTO_ISSUES.notJpeg);
    expect(issues({ ...logo(), byteLength: 3001 })).toContain(PHOTO_ISSUES.sizeMismatch);
    expect(
      issues({ ...logo(PHOTO_LIMIT_BYTES + 3), byteLength: PHOTO_LIMIT_BYTES + 3 }),
    ).not.toEqual([]);
    expect(issues('logo.png')).not.toEqual([]);
    expect(base64ByteLength(logo().data)).toBe(3000);
  });

  it('weighs what its image weighs in sync, and no other setting does', () => {
    expect(syncWeightOf('setting', row(logo()))).toBe(logo().data.length);
    expect(syncWeightOf('setting', row(null))).toBe(0);
    expect(syncWeightOf('setting', row('rial', 'money_display_unit'))).toBe(0);
    expect(syncWeightOf('setting', row(logo(), 'shop_name'))).toBe(0);
  });

  it('reaches a cashier, who must show it on the till', () => {
    expect(CASHIER_SETTING_KEYS).toContain('shop_logo');
    expect(redactForRole('cashier', 'setting', row(logo()))).not.toBeNull();
  });

  it('keeps the image bytes out of the audit log', () => {
    const audited = settingAuditValue('shop_logo', logo(4096)) as Record<string, unknown>;
    expect(audited).toMatchObject({ width: 240, byteLength: 4096, data: '[JPEG 4096 bytes]' });
    expect(settingAuditValue('shop_logo', null)).toBeNull();
    expect(settingAuditValue('shop_name', 'غيث')).toBe('غيث');
  });
});
