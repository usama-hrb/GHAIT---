/**
 * The Hijri calendar (Umm al-Qura, as Intl implements it) for the zakat hawl (SPEC §10:
 * "بالتقويم الهجري"). Dates in and out are Gregorian YYYY-MM-DD; only the hawl uses Hijri.
 */

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Hijri date of a Gregorian day. */
export function hijriOf(date: string): HijriDate {
  const parts = formatter.formatToParts(new Date(utc(date)));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/** The Gregorian day `days` after `date` (negative: before). */
export function addDays(date: string, days: number): string {
  return isoOf(utc(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/**
 * `date` is a hawl: the start's Hijri day and month, in a later Hijri year. A start on the 30th
 * falls on the 29th in a month that has no 30th.
 */
export function isHawl(start: string, date: string): boolean {
  const first = hijriOf(start);
  const day = hijriOf(date);
  if (day.year <= first.year || day.month !== first.month) return false;
  return (
    day.day === first.day ||
    (day.day < first.day && hijriOf(addDays(date, 1)).month !== first.month)
  );
}

/** A Hijri year is at most 355 days: a hawl is always found within this many. */
const SEARCH_DAYS = 400;

/** The latest hawl on or before `today`, or null before the first one. */
export function lastHawl(start: string, today: string): string | null {
  for (let back = 0; back < SEARCH_DAYS; back++) {
    const date = addDays(today, -back);
    if (date <= start) return null;
    if (isHawl(start, date)) return date;
  }
  return null;
}

/** The first hawl after `today`. */
export function nextHawl(start: string, today: string): string {
  const from = start > today ? start : today;
  for (let ahead = 1; ahead <= SEARCH_DAYS; ahead++) {
    const date = addDays(from, ahead);
    if (isHawl(start, date)) return date;
  }
  throw new RangeError(`no hawl within ${String(SEARCH_DAYS)} days of ${today}`);
}
