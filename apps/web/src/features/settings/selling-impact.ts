import {
  enabledSellingUnits,
  enabledStockUnits,
  type Product,
  type SellingUnits,
} from '@fabric/contracts';

/** What switching units off would do to the products the shop already has. */
export interface SellingImpact {
  /** Active products left with no unit they can be sold in: the change is refused. */
  unsellable: number;
  /** Active products that can still be sold but no longer restocked in any unit they list. */
  restockBlocked: number;
}

/**
 * The safe-disable check for Settings > Selling units (ADR 0023). Switching a unit off never
 * touches a record: stock, sales and purchases already made stay as they are. It only decides what
 * can be started from now on, so the one thing to refuse is a change that would leave a live
 * product with nothing it can be sold in (it would vanish from the till); a product that can no
 * longer be restocked in the unit it lists is worth a notice, since editing the product fixes it.
 * Inactive and removed products are not counted: they are not offered anywhere.
 */
export function sellingImpact(
  proposed: SellingUnits,
  products: readonly Pick<Product, 'active' | 'voidedAt' | 'sellingUnits' | 'purchaseUnits'>[],
): SellingImpact {
  const sellable = enabledSellingUnits(proposed);
  const stockable = enabledStockUnits(proposed);
  let unsellable = 0;
  let restockBlocked = 0;
  for (const product of products) {
    if (!product.active || product.voidedAt !== null) continue;
    if (!product.sellingUnits.some((unit) => sellable.includes(unit))) unsellable += 1;
    else if (
      product.purchaseUnits.length > 0 &&
      !product.purchaseUnits.some((unit) => stockable.includes(unit))
    ) {
      restockBlocked += 1;
    }
  }
  return { unsellable, restockBlocked };
}
