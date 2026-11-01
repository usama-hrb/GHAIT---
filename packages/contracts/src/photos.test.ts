import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  currentPhotoOf,
  PHOTO_ISSUES,
  PHOTO_LIMIT_BYTES,
  photoSchema,
} from './photos.js';
import { CASHIER_ACCESS, mayPush, mayRead } from './access.js';
import { SYNC_ENTITIES, syncWeightOf } from './sync.js';

const ID = '5b0c4f56-0f8c-4a0e-9f3a-6f4a3a1c2d11';
const base = {
  id: ID,
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
  deviceId: 'desk',
  voidedAt: null,
  variantId: '9d6a7c52-1e0d-4c9b-8a39-0d9c2f6b7e44',
  contentType: 'image/jpeg',
  width: 480,
  height: 480,
};

/** A base64 text that decodes to `bytes` bytes and starts like a JPEG. */
function fakeJpeg(bytes: number): string {
  const triples = Math.ceil(bytes / 3);
  const text = `/9j/${'A'.repeat(triples * 4 - 4)}`;
  // Pad down to the exact byte count: each "=" drops one byte.
  const drop = triples * 3 - bytes;
  return drop === 0 ? text : `${text.slice(0, text.length - drop)}${'='.repeat(drop)}`;
}

const photo = (bytes: number) => ({ ...base, byteLength: bytes, data: fakeJpeg(bytes) });

describe('base64ByteLength', () => {
  it('counts the bytes a base64 text decodes to', () => {
    expect(base64ByteLength('AAAA')).toBe(3);
    expect(base64ByteLength('AAA=')).toBe(2);
    expect(base64ByteLength('AA==')).toBe(1);
    expect(base64ByteLength(fakeJpeg(1000))).toBe(1000);
  });
});

describe('photoSchema', () => {
  it('takes a small JPEG whose size matches its bytes', () => {
    expect(photoSchema.safeParse(photo(40_000)).success).toBe(true);
    // Too short to be an image at all.
    expect(photoSchema.safeParse(photo(2)).success).toBe(false);
    expect(photoSchema.safeParse(photo(6)).success).toBe(true);
  });

  it('refuses a size that is not the bytes', () => {
    const result = photoSchema.safeParse({ ...photo(40_000), byteLength: 39_999 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(PHOTO_ISSUES.sizeMismatch);
  });

  it('refuses anything that is not base64 or does not start like a JPEG', () => {
    expect(photoSchema.safeParse({ ...photo(30), data: `${fakeJpeg(30)}!` }).success).toBe(false);
    const png = { ...photo(30), data: `iVBO${fakeJpeg(30).slice(4)}` };
    expect(photoSchema.safeParse(png).error?.issues.map((issue) => issue.message)).toContain(
      PHOTO_ISSUES.notJpeg,
    );
  });

  it('refuses an image above what the server takes, and a type other than JPEG', () => {
    expect(photoSchema.safeParse(photo(PHOTO_LIMIT_BYTES)).success).toBe(true);
    expect(photoSchema.safeParse(photo(PHOTO_LIMIT_BYTES + 3)).success).toBe(false);
    expect(photoSchema.safeParse({ ...photo(30), contentType: 'image/png' }).success).toBe(false);
  });
});

describe('currentPhotoOf', () => {
  const at = (id: string, createdAt: string, voidedAt: string | null = null) => ({
    id,
    createdAt,
    voidedAt,
  });

  it('is the newest live photo', () => {
    const photos = [
      at('a', '2026-10-01T00:00:00.000Z'),
      at('b', '2026-10-03T00:00:00.000Z'),
      at('c', '2026-10-02T00:00:00.000Z'),
    ];
    expect(currentPhotoOf(photos)?.id).toBe('b');
  });

  it('skips a voided photo, and is null when none is live', () => {
    const old = at('a', '2026-10-01T00:00:00.000Z');
    const replaced = at('b', '2026-10-03T00:00:00.000Z', '2026-10-04T00:00:00.000Z');
    expect(currentPhotoOf([old, replaced])?.id).toBe('a');
    expect(currentPhotoOf([replaced])).toBeNull();
    expect(currentPhotoOf([])).toBeNull();
  });

  it('breaks a tie by id, the same way on every device', () => {
    const same = '2026-10-01T00:00:00.000Z';
    expect(currentPhotoOf([at('a', same), at('b', same)])?.id).toBe('b');
    expect(currentPhotoOf([at('b', same), at('a', same)])?.id).toBe('b');
  });
});

describe('photos in sync', () => {
  it('are a mutable entity with the photoSchema', () => {
    expect(SYNC_ENTITIES.photo.merge).toBe('mutable');
    expect(SYNC_ENTITIES.photo.schema).toBe(photoSchema);
  });

  it('weigh what their image weighs, and nothing else does', () => {
    expect(syncWeightOf('photo', photo(3000))).toBe(photo(3000).data.length);
    expect(syncWeightOf('fabric', photo(3000))).toBe(0);
    expect(syncWeightOf('photo', null)).toBe(0);
  });

  it('are seen by a cashier, who cannot add or void one', () => {
    expect(CASHIER_ACCESS.photo.read).toBe('all');
    expect(mayRead('cashier', 'photo')).toBe(true);
    expect(mayPush('cashier', 'photo', 'upsert')).toBe(false);
    expect(mayPush('cashier', 'photo', 'void')).toBe(false);
    expect(mayPush('owner', 'photo', 'upsert')).toBe(true);
    expect(mayPush('partner', 'photo', 'upsert')).toBe(false);
  });
});
