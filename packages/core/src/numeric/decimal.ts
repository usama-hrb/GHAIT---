/** Why a user-typed number was rejected. The UI maps each code to a message. */
export type ParseError =
  'empty' | 'invalid' | 'negative' | 'too_precise' | 'not_exact' | 'too_large';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };

// Arabic-Indic (U+0660–0669) and Extended Arabic-Indic / Persian (U+06F0–06F9) digits.
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
// Bidi marks that sneak in when copying numbers out of RTL text.
const BIDI_MARKS = /[؜‎‏‪-‮⁦-⁩]/g;
const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** Replaces Arabic-Indic and Persian digits with ASCII digits; other characters are kept. */
export function normalizeDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Parses a decimal typed by a user into an exact integer count of 10^-scale units,
 * e.g. scale 2: "20.5" → 2050. Never goes through floating point.
 *
 * Accepts ASCII, Arabic-Indic and Persian digits; ".", "٫" (Arabic decimal separator)
 * or "," as the decimal separator. Thousands separators are rejected (ambiguous with ",").
 * Extra fractional digits are accepted only when they are zeros ("2.500" at scale 2).
 */
export function parseScaledDecimal(
  text: string,
  scale: number,
  options: { allowNegative?: boolean } = {},
): ParseResult<number> {
  const normalized = normalizeDigits(text).replace(BIDI_MARKS, '').trim().replace(/[٫,]/g, '.');
  if (normalized === '') return { ok: false, error: 'empty' };

  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return { ok: false, error: 'invalid' };
  const [, sign = '', whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return { ok: false, error: 'invalid' };

  const significantFraction = fraction.replace(/0+$/, '');
  if (significantFraction.length > scale) return { ok: false, error: 'too_precise' };

  const digits = BigInt((whole || '0') + fraction.padEnd(scale, '0').slice(0, scale));
  if (digits > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'too_large' };

  const value = Number(digits);
  if (sign === '-' && value !== 0) {
    return options.allowNegative ? { ok: true, value: -value } : { ok: false, error: 'negative' };
  }
  return { ok: true, value };
}

/**
 * U+200E (LRM) before a leading "-", as CLDR's ar-MA minus sign does: without it the minus of
 * "-410" lands on the wrong side inside Arabic text (WhatsApp, plain strings).
 */
export function directionSafeSign(digits: string): string {
  return digits.startsWith('-') ? `\u200E${digits}` : digits;
}

/** Formats an integer with "," every three digits: 1234567 → "1,234,567". */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
