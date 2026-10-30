import {
  directionSafeSign,
  groupThousands,
  type ParseResult,
  parseScaledDecimal,
} from '../numeric/index.js';

/**
 * Money is stored and computed as integer cents (MAD). The user types and reads either
 * dirham or rial (SPEC §0.2): 1 dirham = 20 rial = 100 cents, so 1 rial = 5 cents.
 */
export type MoneyUnit = 'rial' | 'dirham';

/** Locales with unit labels. The app is Arabic-only for now (SPEC §0.4). */
export type DisplayLocale = 'ar';

/** Unit symbols as the shop writes them (SPEC §0.2: "410 ريال (20.5 د)"). */
export const MONEY_UNIT_LABELS = {
  ar: { rial: 'ريال', dirham: 'د' },
} as const satisfies Record<DisplayLocale, Record<MoneyUnit, string>>;

/** Keeps a number and its unit on one line. */
export const UNIT_SEPARATOR = '\u00A0';

export const CENTS_PER_DIRHAM = 100;
export const CENTS_PER_RIAL = 5;
export const RIALS_PER_DIRHAM = 20;

export interface MoneyInputOptions {
  /** Refunds and corrections may be negative; prices and payments may not. Default false. */
  allowNegative?: boolean;
}

/**
 * Parses what the user typed into integer cents.
 * - dirham: up to 2 decimals ("20.5" → 2050).
 * - rial: any value that is a whole number of cents ("410" → 2050, "869.6" → 4348).
 *   Half a rial (2.5 cents) cannot be stored and is rejected with `not_exact`, never rounded.
 */
export function parseMoneyInput(
  text: string,
  unit: MoneyUnit,
  options: MoneyInputOptions = {},
): ParseResult<number> {
  if (unit === 'dirham') return parseScaledDecimal(text, 2, options);

  const tenths = parseScaledDecimal(text, 1, options);
  if (!tenths.ok) return tenths;
  // 0.1 rial = 0.5 cent, so only an even number of tenths is a whole number of cents.
  if (tenths.value % 2 !== 0) return { ok: false, error: 'not_exact' };
  return { ok: true, value: tenths.value / 2 };
}

/** Dirham amount (number or decimal string) → cents. Throws RangeError if not exact. */
export function fromDirham(value: number | string): number {
  return unwrap(parseMoneyInput(toDecimalString(value), 'dirham', { allowNegative: true }), value);
}

/** Rial amount (number or decimal string) → cents. Throws RangeError if not exact. */
export function fromRial(value: number | string): number {
  return unwrap(parseMoneyInput(toDecimalString(value), 'rial', { allowNegative: true }), value);
}

/** Cents → dirham as a JS number, for display and interop only; never store the result. */
export function toDirham(cents: number): number {
  assertCents(cents);
  return cents / CENTS_PER_DIRHAM;
}

/** Cents → rial as a JS number, for display and interop only; never store the result. */
export function toRial(cents: number): number {
  assertCents(cents);
  return cents / CENTS_PER_RIAL;
}

export interface FormatOptions {
  /** "," every three digits. Default true; inputs use false so the text parses back. */
  grouping?: boolean;
}

/**
 * Formats cents for display, digits only (the UI adds the unit label):
 * - dirham: "20.50", "100", "1,234.05": two decimals unless the amount is whole.
 * - rial: "410", "869.6": every cent amount is exact with at most one rial decimal.
 */
export function formatMoneyAmount(
  cents: number,
  unit: MoneyUnit,
  { grouping = true }: FormatOptions = {},
): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const group = grouping ? groupThousands : (digits: string) => digits;

  if (unit === 'dirham') {
    const whole = Math.floor(abs / CENTS_PER_DIRHAM);
    const fraction = abs % CENTS_PER_DIRHAM;
    const decimals = fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`;
    return `${sign}${group(String(whole))}${decimals}`;
  }

  const tenths = abs * 2;
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  const decimals = fraction === 0 ? '' : `.${String(fraction)}`;
  return `${sign}${group(String(whole))}${decimals}`;
}

/**
 * Formats cents with the unit label, as plain text (invoice sharing, messages):
 * formatMoney(2050, 'rial') → "410 ريال", formatMoney(2050, 'dirham') → "20.50 د".
 * The space is a no-break space; a negative amount starts with an LRM (see directionSafeSign).
 * Components render the digits and the label separately (apps/web <Money/>).
 */
export function formatMoney(
  cents: number,
  unit: MoneyUnit,
  locale: DisplayLocale = 'ar',
  options: FormatOptions = {},
): string {
  const amount = directionSafeSign(formatMoneyAmount(cents, unit, options));
  return `${amount}${UNIT_SEPARATOR}${MONEY_UNIT_LABELS[locale][unit]}`;
}

export function isCents(value: number): boolean {
  return Number.isSafeInteger(value);
}

function assertCents(value: number): void {
  if (!isCents(value)) throw new RangeError(`not an integer cent amount: ${String(value)}`);
}

function toDecimalString(value: number | string): string {
  if (typeof value === 'string') return value;
  // Shortest round-trip form; "1e+21" and similar are rejected by the parser.
  return Number.isFinite(value) ? String(value) : '';
}

function unwrap(result: ParseResult<number>, input: number | string): number {
  if (result.ok) return result.value;
  throw new RangeError(`invalid money amount ${JSON.stringify(input)}: ${result.error}`);
}
