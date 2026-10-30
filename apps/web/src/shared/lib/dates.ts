import { SHOP_TIME_ZONE } from '@fabric/contracts';

/** Today in the shop's time zone, YYYY-MM-DD (the same day the API computes). */
export function shopToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE }).format(now);
}
