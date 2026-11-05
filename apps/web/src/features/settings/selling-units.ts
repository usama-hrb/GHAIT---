'use client';

import { DEFAULT_SELLING_UNITS, type SellingUnits } from '@fabric/contracts';
import { useLiveQuery, useRepositories } from '@/local-db';
import { shopToday } from '@/shared/lib/dates';

/**
 * The units the shop works in now (ADR 0023), read from this device's copy of the setting so it
 * works offline. It decides what a NEW product, purchase or sale line may use; records already
 * made are never filtered by it. Every unit while the device reads it, as for a shop that never
 * chose.
 */
export function useSellingUnits(): SellingUnits {
  const repositories = useRepositories();
  const units = useLiveQuery(() => repositories.settings.sellingUnits(shopToday()), [repositories]);
  return units ?? DEFAULT_SELLING_UNITS;
}
