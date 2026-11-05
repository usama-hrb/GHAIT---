import { PRODUCT_STOCK_UNITS, type ProductStockUnit } from '@fabric/core';
import { z } from 'zod';

/** Issue message for the one rule zod has no built-in code for; the web shows i18n text for it. */
export const SELLING_UNITS_ISSUES = { noneEnabled: 'selling_units_none' } as const;

/**
 * Which units the shop works in: three independent switches, at least one on. Unit and Meter
 * decide what a product can be sold in (and bought in); Kilogram decides whether the shop buys
 * and stocks by weight, which is only ever a way of buying (accounting assumption PB7: a weight
 * batch waits for its length to be measured, and nothing is sold by the kilogram). The keys are
 * the stock units' own names, so a switch and the unit it controls cannot drift apart.
 */
export const sellingUnitsSchema = z
  .object({ piece: z.boolean(), kg: z.boolean(), meter: z.boolean() })
  .refine((units) => units.piece || units.kg || units.meter, {
    message: SELLING_UNITS_ISSUES.noneEnabled,
  });
export type SellingUnits = z.infer<typeof sellingUnitsSchema>;

/** A shop that never chose behaves as every shop did before the switches existed. */
export const DEFAULT_SELLING_UNITS: SellingUnits = { piece: true, kg: true, meter: true };

/** The units a product can be bought and stocked in now, in the order stock units are listed. */
export function enabledStockUnits(units: SellingUnits): ProductStockUnit[] {
  return PRODUCT_STOCK_UNITS.filter((unit) => units[unit]);
}

/** The units a product can be sold in now: weight is a way of buying, never of selling. */
export function enabledSellingUnits(units: SellingUnits): ('meter' | 'piece')[] {
  const sellable: ('meter' | 'piece')[] = [];
  if (units.meter) sellable.push('meter');
  if (units.piece) sellable.push('piece');
  return sellable;
}
