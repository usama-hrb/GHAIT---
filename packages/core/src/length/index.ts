import { type DisplayLocale, type FormatOptions, UNIT_SEPARATOR } from '../money/index.js';
import {
  directionSafeSign,
  groupThousands,
  type ParseResult,
  parseScaledDecimal,
} from '../numeric/index.js';

/** Lengths are stored as integer centimetres; users type and read metres (SPEC §0.2). */
export const CM_PER_METER = 100;

export const LENGTH_UNIT_LABELS = {
  ar: { meter: 'م' },
  en: { meter: 'm' },
} as const satisfies Record<DisplayLocale, { meter: string }>;

export interface LengthInputOptions {
  /** Length corrections may be negative; sales and purchases may not. Default false. */
  allowNegative?: boolean;
}

/** Parses metres typed by the user into integer cm, to 1 cm precision ("2.75" → 275). */
export function parseLengthInput(
  text: string,
  options: LengthInputOptions = {},
): ParseResult<number> {
  return parseScaledDecimal(text, 2, options);
}

/** Metres (number or decimal string) → cm. Throws RangeError if not a whole number of cm. */
export function fromMeters(value: number | string): number {
  const text = typeof value === 'string' ? value : Number.isFinite(value) ? String(value) : '';
  const result = parseLengthInput(text, { allowNegative: true });
  if (result.ok) return result.value;
  throw new RangeError(`invalid length ${JSON.stringify(value)}: ${result.error}`);
}

/** cm → metres as a JS number, for display and interop only; never store the result. */
export function toMeters(cm: number): number {
  assertCm(cm);
  return cm / CM_PER_METER;
}

/**
 * Formats cm as metres, digits only, trailing zeros trimmed: 275 → "2.75", 250 → "2.5",
 * 5000 → "50". `grouping: false` drops the "," thousands separator (for inputs).
 */
export function formatLengthMeters(cm: number, { grouping = true }: FormatOptions = {}): string {
  assertCm(cm);
  const sign = cm < 0 ? '-' : '';
  const abs = Math.abs(cm);
  const whole = Math.floor(abs / CM_PER_METER);
  const fraction = String(abs % CM_PER_METER)
    .padStart(2, '0')
    .replace(/0+$/, '');
  const digits = grouping ? groupThousands(String(whole)) : String(whole);
  return `${sign}${digits}${fraction === '' ? '' : `.${fraction}`}`;
}

/**
 * Formats cm as metres with the unit label, as plain text: 275 → "2.75 م", 5000 → "50 م".
 * No-break space; a negative length starts with an LRM (see directionSafeSign).
 */
export function formatLength(
  cm: number,
  locale: DisplayLocale = 'ar',
  options: FormatOptions = {},
): string {
  const meters = directionSafeSign(formatLengthMeters(cm, options));
  return `${meters}${UNIT_SEPARATOR}${LENGTH_UNIT_LABELS[locale].meter}`;
}

function assertCm(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`not an integer cm length: ${String(value)}`);
  }
}
