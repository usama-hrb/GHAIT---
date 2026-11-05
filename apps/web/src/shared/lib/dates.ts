import { shopDate } from '@fabric/contracts';

/** Today in the shop's time zone, YYYY-MM-DD (the same day the API computes). */
export function shopToday(now = new Date()): string {
  return shopDate(now);
}

/** Whole days from one YYYY-MM-DD date to another (the age of a debt). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A YYYY-MM-DD date moved by whole days (negative: earlier), on the calendar, no time zone. */
export function addDays(date: string, days: number): string {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}
