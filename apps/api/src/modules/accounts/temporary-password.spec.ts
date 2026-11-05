import { newPasswordSchema, TEMPORARY_PASSWORD_ALPHABET } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { temporaryPassword } from './temporary-password.js';

describe('temporaryPassword', () => {
  it('is four groups of four characters from the alphabet, and long enough to be a password', () => {
    const password = temporaryPassword();
    expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(newPasswordSchema.safeParse(password).success).toBe(true);
    for (const character of password.replaceAll('-', '')) {
      expect(TEMPORARY_PASSWORD_ALPHABET).toContain(character);
    }
  });

  it('has none of the look-alike characters', () => {
    for (const lookAlike of ['0', 'O', '1', 'l', 'I']) {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(lookAlike);
    }
  });

  it('takes every character from the random source it is given', () => {
    const first = temporaryPassword(() => 0);
    expect(first).toBe('AAAA-AAAA-AAAA-AAAA');
    const last = temporaryPassword((max) => max - 1);
    expect(last).toBe('9999-9999-9999-9999');
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => temporaryPassword()));
    expect(seen.size).toBe(200);
  });
});
