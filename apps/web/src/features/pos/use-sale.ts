'use client';

import { useLiveQuery, useRepositories } from '@/local-db';
import { shopToday } from '@/shared/lib/dates';

/**
 * One sale from this device with the shop's name (the invoice text needs it): `undefined` while it
 * loads, `null` when the sale is not on this device. The invoice page, the details drawer and the
 * row actions all read it here.
 */
export function useSale(id: string) {
  const repositories = useRepositories();
  return useLiveQuery(async () => {
    const view = await repositories.sales.get(id);
    if (!view) return null;
    return { view, shopName: await repositories.settings.get('shop_name', shopToday()) };
  }, [repositories, id]);
}

/** What `useSale` yields once the sale is found. */
export type SaleData = NonNullable<ReturnType<typeof useSale>>;
