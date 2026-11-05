import type { ProductInput } from '@fabric/contracts';
import type { Repositories } from './repositories';

/** A product sold by the meter at 20 dh with a 17 dh minimum, bought by the meter, unless said otherwise. */
export async function seedProduct(
  repos: Repositories,
  fields: Partial<ProductInput> = {},
): Promise<string> {
  return repos.products.save({
    name: 'روزا',
    purchaseUnits: ['meter', 'kg', 'piece'],
    sellingUnits: ['meter'],
    pricePerMeterCents: 2000,
    minPricePerMeterCents: 1700,
    ...fields,
  });
}

/** A batch of `quantity` cm bought on `date`, costing `costPerMeterCents` a meter; its id. */
export async function seedBatch(
  repos: Repositories,
  productId: string,
  quantity: number,
  options: { date?: string; costPerMeterCents?: number; totalCostCents?: number } = {},
): Promise<string> {
  const purchaseId = await repos.purchases.create({
    date: options.date ?? '2026-10-01',
    productId,
    unit: 'meter',
    quantity,
    totalCostCents:
      options.totalCostCents ?? Math.round(((options.costPerMeterCents ?? 1600) * quantity) / 100),
  });
  const [batch] = await repos.purchases.batchesOf(purchaseId);
  if (!batch) throw new Error('a purchase makes a batch');
  return batch.id;
}

/**
 * The owner and one partner, at 50% each unless said otherwise: the shop most money tests start
 * from. Returns their ids.
 */
export async function seedPartners(
  repos: Repositories,
  options: { ownerBp?: number } = {},
): Promise<{ ownerId: string; partnerId: string }> {
  const ownerBp = options.ownerBp ?? 5000;
  const [ownerId, partnerId] = await repos.partners.saveAll([
    { name: 'أنا', ownershipBp: ownerBp, isOwner: true },
    { name: 'شريكي', ownershipBp: 10_000 - ownerBp, isOwner: false },
  ]);
  if (ownerId === undefined || partnerId === undefined) throw new Error('two partners');
  return { ownerId, partnerId };
}
