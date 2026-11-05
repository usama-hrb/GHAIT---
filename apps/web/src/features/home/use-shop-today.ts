'use client';

import { useSyncExternalStore } from 'react';
import { shopToday } from '@/shared/lib/dates';
import { type GreetingKey, greetingAt } from './greeting';

function subscribe(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 60_000);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
}

/**
 * The shop's day, kept current: a till left open overnight moves to the new day by itself (a live
 * query only re-runs when data changes, so "today" must come from here). null until the screen is
 * on the device, so the server never writes a date into the page.
 */
export function useShopToday(): string | null {
  return useSyncExternalStore(subscribe, shopToday, () => null);
}

/** Which greeting the shop's hour gets now; it follows the clock while the screen stays open. */
export function useGreeting(): GreetingKey {
  return useSyncExternalStore(
    subscribe,
    () => greetingAt(new Date()),
    () => 'morning',
  );
}
