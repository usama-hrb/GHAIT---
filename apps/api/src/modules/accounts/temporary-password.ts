import { randomInt } from 'node:crypto';
import {
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_GROUP_SIZE,
  TEMPORARY_PASSWORD_GROUPS,
} from '@fabric/contracts';

/**
 * A password the server makes for an account the owner creates or resets (ADR 0024): sixteen
 * characters in four dash-separated groups, from an alphabet without the look-alikes. `random`
 * is `crypto.randomInt` (uniform, from the operating system); a test passes its own.
 */
export function temporaryPassword(random: (max: number) => number = randomInt): string {
  const group = () =>
    Array.from(
      { length: TEMPORARY_PASSWORD_GROUP_SIZE },
      () => TEMPORARY_PASSWORD_ALPHABET[random(TEMPORARY_PASSWORD_ALPHABET.length)],
    ).join('');
  return Array.from({ length: TEMPORARY_PASSWORD_GROUPS }, group).join('-');
}
