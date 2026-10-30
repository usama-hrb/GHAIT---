import { type DisplayLocale, type FormatOptions, UNIT_SEPARATOR } from '../money/index.js';
import { groupThousands, type ParseResult, parseScaledDecimal } from '../numeric/index.js';

/** Weights are stored as integer grams; users type and read kilograms (CLAUDE.md). */
export const GRAMS_PER_KG = 1000;

export const WEIGHT_UNIT_LABELS = {
  ar: { kilogram: 'كغ' },
} as const satisfies Record<DisplayLocale, { kilogram: string }>;

/** Parses kilograms typed by the user into integer grams, to 1 g precision ("20.5" → 20500). */
export function parseWeightInput(text: string): ParseResult<number> {
  return parseScaledDecimal(text, 3);
}

/** grams → kilograms, digits only, trailing zeros trimmed: 20500 → "20.5", 20000 → "20". */
export function formatWeightKg(grams: number, { grouping = true }: FormatOptions = {}): string {
  if (!Number.isSafeInteger(grams) || grams < 0) {
    throw new RangeError(`not a non-negative integer weight in grams: ${String(grams)}`);
  }
  const whole = Math.floor(grams / GRAMS_PER_KG);
  const fraction = String(grams % GRAMS_PER_KG)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const digits = grouping ? groupThousands(String(whole)) : String(whole);
  return `${digits}${fraction === '' ? '' : `.${fraction}`}`;
}

/** grams as plain text with the unit: 20500 → "20.5 كغ" (no-break space). */
export function formatWeight(
  grams: number,
  locale: DisplayLocale = 'ar',
  options: FormatOptions = {},
): string {
  return `${formatWeightKg(grams, options)}${UNIT_SEPARATOR}${WEIGHT_UNIT_LABELS[locale].kilogram}`;
}
