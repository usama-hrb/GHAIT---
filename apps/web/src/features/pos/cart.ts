import type { Fabric, NewSaleInput, PricedSale, Variant } from '@fabric/contracts';
import type { PriceWarning } from '@fabric/core';
import type { Local } from '@/local-db';

/** The roll choice that lets the app propose the oldest roll that has enough. */
export const AUTO = 'auto';

export type SaleLineInput = NewSaleInput['lines'][number];

/** One thing the customer buys: a colour and a length, cut from one roll or more. */
export interface CartItem {
  key: string;
  fabric: Local<Fabric>;
  variant: Local<Variant>;
  /** The roll the employee picked, or AUTO. */
  rollChoice: string;
  lines: (SaleLineInput & { rollCode: string })[];
}

export const withoutCode = ({
  rollId,
  soldCm,
  price,
  refPricePerMeterCents,
  minPricePerMeterCents,
}: CartItem['lines'][number]): SaleLineInput => ({
  rollId,
  soldCm,
  price,
  refPricePerMeterCents,
  minPricePerMeterCents,
});

/** What the bill is as a sale, before payment: the total and the warnings do not depend on it. */
export function saleInputOf(
  cart: readonly CartItem[],
  options: { date: string; customerId: string | null; discountCents: number },
): NewSaleInput | null {
  const lines = cart.flatMap((item) => item.lines.map(withoutCode));
  if (lines.length === 0) return null;
  return {
    date: options.date,
    customerId: options.customerId,
    lines,
    discountCents: options.discountCents,
    paidCents: 0,
    dueDate: null,
    // Confirmed here so the bill can be priced; the checkout asks for it for real.
    confirmedBelowCost: true,
    note: null,
  };
}

export const itemLengthCm = (item: CartItem): number =>
  item.lines.reduce((sum, line) => sum + line.soldCm, 0);

/** Every line of an item carries the same price: per metre, or the whole piece's. */
export const itemPrice = (item: CartItem): SaleLineInput['price'] | undefined =>
  item.lines[0]?.price;

/** One cart item with what the pricing says about it. */
export interface PricedItem {
  item: CartItem;
  totalCents: number;
  profitCents: number;
  warnings: PriceWarning[];
  provisional: boolean;
}

/** The priced lines of `lines` start at `start` in the sale's lines (they follow its order). */
export function pricedItemOf(
  item: CartItem,
  priced: PricedSale | null | undefined,
  start: number,
): PricedItem {
  const lines = priced?.lines.slice(start, start + item.lines.length) ?? [];
  return {
    item,
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    profitCents: lines.reduce((sum, line) => sum + line.profitCents, 0),
    warnings: [...new Set(lines.flatMap((line) => line.warnings))] as PriceWarning[],
    provisional: lines.some((line) => line.costing.provisional),
  };
}

/** Per cart item, the priced lines it became (priced.lines follows the input's line order). */
export function pricedItemsOf(
  cart: readonly CartItem[],
  priced: PricedSale | null | undefined,
): PricedItem[] {
  let start = 0;
  return cart.map((item) => {
    const entry = pricedItemOf(item, priced, start);
    start += item.lines.length;
    return entry;
  });
}
