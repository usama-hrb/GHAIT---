import { describe, expect, it } from 'vitest';
import { checkLogoFile, LOGO_FILE_MAX_BYTES } from './logo-file';

describe('the logo file check', () => {
  it('takes a PNG, JPEG or WebP up to 5 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(checkLogoFile({ type, size: 1000 })).toBeNull();
    }
    expect(checkLogoFile({ type: 'image/png', size: LOGO_FILE_MAX_BYTES })).toBeNull();
  });

  it('refuses a file that is not one of those, whatever its size', () => {
    expect(checkLogoFile({ type: 'application/pdf', size: 10 })).toBe('not_image');
    expect(checkLogoFile({ type: 'image/gif', size: 10 })).toBe('not_image');
    expect(checkLogoFile({ type: 'image/svg+xml', size: 10 })).toBe('not_image');
    expect(checkLogoFile({ type: '', size: 10 })).toBe('not_image');
  });

  it('refuses a file over 5 MB', () => {
    expect(checkLogoFile({ type: 'image/png', size: LOGO_FILE_MAX_BYTES + 1 })).toBe('too_big');
    // A file of the wrong kind is reported as that first.
    expect(checkLogoFile({ type: 'text/plain', size: LOGO_FILE_MAX_BYTES + 1 })).toBe('not_image');
  });
});
