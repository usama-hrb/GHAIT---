/**
 * The setup code of a new shop (ADR 0029): what the operator gives the first owner so that the
 * sign-up page makes the owner of this shop and no other. Its shape is here, and not only in the
 * API, because the sign-up form reads what a person typed the same way the server does. Making a
 * code and hashing it need Node's `crypto` and stay in the API.
 *
 * 12 characters from an alphabet of 32 are 60 bits. The alphabet is Crockford's: the digits and
 * the letters but I, L, O and U, so a code read aloud or copied by hand is not mistaken.
 */
export const SETUP_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SETUP_CODE_LENGTH = 12;

/** The most characters the sign-up request takes for a typed code (spaces and hyphens included). */
export const SETUP_CODE_TYPED_MAX = 64;

/** Exactly SETUP_CODE_LENGTH characters, each from the alphabet (it has nothing a class would read as a range). */
const SETUP_CODE_SHAPE = new RegExp(`^[${SETUP_CODE_ALPHABET}]{${String(SETUP_CODE_LENGTH)}}$`);

/** `ABCD-EFGH-JKMN`: how the code is shown. */
export function formatSetupCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/**
 * What a person typed, as the code it stands for, or null if it cannot be a code. Case, spaces and
 * hyphens do not matter; the letters that Crockford's alphabet leaves out are read as the digits
 * they look like (O as 0, I and L as 1).
 */
export function normalizeSetupCode(typed: string): string | null {
  const code = typed
    .toUpperCase()
    .replaceAll(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll(/[IL]/g, '1');
  return SETUP_CODE_SHAPE.test(code) ? code : null;
}
