import type { NewSaleInput, PricedSale } from '@fabric/contracts';
import type { PriceWarning } from '@fabric/core';

/** The batch choice that lets the app propose the oldest batch that has enough. */
export const AUTO = 'auto';

export type SaleLineInput = NewSaleInput['lines'][number];

/** What a cart item is counted and priced in: meters (cm) or pieces. */
export type CartUnit = SaleLineInput['unit'];

/**
 * One thing the customer buys: a product and a quantity of it, taken from one batch or more
 * (the oldest purchase first, or the one the employee picked).
 */
export interface CartItem {
  key: string;
  product: { id: string; name: string };
  unit: CartUnit;
  /** The batch the employee picked, or AUTO. */
  batchChoice: string;
  /**
   * The owner confirmed, on this line, selling it under cost. It belongs to the price it was given
   * for (the dialog drops it when the price changes) and is never sent: the sale carries one
   * `confirmedBelowCost`, which the server checks again against its own costs.
   */
  belowCostConfirmed: boolean;
  lines: (SaleLineInput & { batchCode: string })[];
}

/**
 * What an owner's confirmation on a line is bound to: the unit and the exact price it was given
 * for. A confirmation that does not match the price being typed is not one (a changed price asks
 * again), and a line made anew starts with none.
 */
export const priceKeyOf = (unit: CartUnit, price: SaleLineInput['price']): string =>
  'wholePieceCents' in price
    ? `${unit}:whole:${String(price.wholePieceCents)}`
    : `${unit}:unit:${String(price.perUnitCents)}`;

/** The line as the sale takes it: the batch's code is only for the screen. */
export function withoutCode(line: CartItem['lines'][number]): SaleLineInput {
  return {
    batchId: line.batchId,
    unit: line.unit,
    quantity: line.quantity,
    price: line.price,
    refPriceCents: line.refPriceCents,
    minPriceCents: line.minPriceCents,
    minOverrideBy: line.minOverrideBy,
  };
}

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

/**
 * What the rest of the bill holds of each batch, in `unit`, so that a line proposed next to them
 * is offered what is left. It is by batch, whatever the product: a bill of several products holds
 * several products' batches, and a batch taken by two lines is held once, for both.
 */
export function heldByBill(others: readonly CartItem[], unit: CartUnit): Map<string, number> {
  const held = new Map<string, number>();
  for (const line of others.flatMap((item) => item.lines)) {
    if (line.unit !== unit) continue;
    held.set(line.batchId, (held.get(line.batchId) ?? 0) + line.quantity);
  }
  return held;
}

/** How much the item holds, in its unit (cm for meters, pieces for pieces). */
export const itemQuantity = (item: CartItem): number =>
  item.lines.reduce((sum, line) => sum + line.quantity, 0);

/** Every line of an item carries the same price: per unit, or the whole piece's. */
export const itemPrice = (item: CartItem): SaleLineInput['price'] | undefined =>
  item.lines[0]?.price;

/** The owner who confirmed selling this item under the minimum price, if any (ADR 0012). */
export const itemOverrideBy = (item: CartItem): string | null =>
  item.lines.find((line) => line.minOverrideBy !== null)?.minOverrideBy ?? null;

/**
 * One cart item with what the pricing says about it. The selling screens read the total and the
 * authorizations that are needed: never a profit (the till is not where it is shown).
 */
export interface PricedItem {
  item: CartItem;
  totalCents: number;
  warnings: PriceWarning[];
  /** A line of it is sold under its cost: the owner has to have confirmed it. */
  belowCost: boolean;
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
    warnings: [...new Set(lines.flatMap((line) => line.warnings))],
    belowCost: lines.some((line) => line.requiresConfirmation),
  };
}

/**
 * Whether paying still has to ask for the below-cost confirmation. A line under its cost was
 * confirmed where it was typed, so the payment does not ask again; it asks only for what the line
 * could not know: a line nobody confirmed (the cost moved with the rest of the bill), or a
 * discount that takes the whole invoice under its cost.
 */
export function needsCostConfirmationAtPayment(
  items: readonly PricedItem[],
  split: NonNullable<PricedSale['split']> | null,
): boolean {
  if (items.some((entry) => entry.belowCost && !entry.item.belowCostConfirmed)) return true;
  return split !== null && split.belowCost && split.discountCents > 0;
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
