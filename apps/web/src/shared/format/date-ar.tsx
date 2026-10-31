import { locale } from '@/i18n';

// The shop is in Morocco: one fixed zone keeps server and client output identical.
const TIME_ZONE = 'Africa/Casablanca';

const FORMATS = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  month: { year: 'numeric', month: 'long' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateArFormat = keyof typeof FORMATS;

const formatters = new Map<DateArFormat, Intl.DateTimeFormat>();

function formatterFor(format: DateArFormat): Intl.DateTimeFormat {
  let formatter = formatters.get(format);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(`${locale}-MA`, {
      ...FORMATS[format],
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: TIME_ZONE,
    });
    formatters.set(format, formatter);
  }
  return formatter;
}

/** As DateAr shows it, for plain text (a shared invoice). */
export function formatDateAr(
  value: Date | string | number,
  format: DateArFormat = 'medium',
): string {
  return formatterFor(format).format(value instanceof Date ? value : new Date(value));
}

/** A Gregorian date in Arabic with Western digits ("29 أكتوبر 2026"). Hijri lives in the zakat module. */
export function DateAr({
  value,
  format = 'medium',
  className,
}: {
  value: Date | string | number;
  format?: DateArFormat;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time dateTime={date.toISOString()} data-num className={className}>
      {formatterFor(format).format(date)}
    </time>
  );
}
