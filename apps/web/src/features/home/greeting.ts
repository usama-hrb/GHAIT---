/** The shop's clock: Africa/Casablanca, like every date the app shows. */
const HOUR = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'Africa/Casablanca',
});

export type GreetingKey = 'morning' | 'afternoon' | 'evening';

/** Which greeting an hour of the shop's day (0 to 23) gets: morning until noon, evening from 6 pm. */
export function greetingOf(hour: number): GreetingKey {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** The greeting for this moment, by the shop's own hour whatever the device's time zone. */
export function greetingAt(now: Date): GreetingKey {
  return greetingOf(Number(HOUR.format(now)));
}
