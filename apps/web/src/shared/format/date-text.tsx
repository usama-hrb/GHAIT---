import { getLanguage, LANGUAGE_INFO, type Language } from '@/i18n';

// The shop is in Morocco: one fixed zone keeps server and client output identical.
const TIME_ZONE = 'Africa/Casablanca';

const FORMATS = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  month: { year: 'numeric', month: 'long' },
  /** The zakat hawl only (CLAUDE.md: Hijri only in the zakat module). */
  hijri: { dateStyle: 'long', calendar: 'islamic-umalqura' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateFormat = keyof typeof FORMATS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(format: DateFormat, language: Language): Intl.DateTimeFormat {
  const key = `${language}:${format}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LANGUAGE_INFO[language].locale, {
      // Gregorian and Western digits in every language; a format may name another calendar.
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: TIME_ZONE,
      ...FORMATS[format],
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** As DateText shows it, for plain text (a shared invoice), in the language shown now. */
export function formatDate(
  value: Date | string | number,
  format: DateFormat = 'medium',
  language: Language = getLanguage(),
): string {
  return formatterFor(format, language).format(value instanceof Date ? value : new Date(value));
}

/**
 * A Gregorian date in the language shown, with Western digits ("29 Oct 2026", "29 أكتوبر 2026").
 * Hijri lives in the zakat module.
 */
export function DateText({
  value,
  format = 'medium',
  className,
}: {
  value: Date | string | number;
  format?: DateFormat;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time dateTime={date.toISOString()} data-num className={className}>
      {formatDate(date, format)}
    </time>
  );
}
