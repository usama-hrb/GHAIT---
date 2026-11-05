import {
  costBasisLength,
  type ProductStockBatch,
  type ProductStockMovement,
  type ProductStockQuantity,
} from '@fabric/core';
import type { SequencedMove } from './inventory.js';
import { syncOrder } from './order.js';
import type { Purchase, Roll } from './purchasing.js';

/**
 * The read bridge from the legacy rolls to the product stock ledger (ADR 0011).
 *
 * Sales, returns, voids and write-offs still write `roll` and `stock_move` rows; those stay the
 * only source of truth. This maps one roll and its moves into the batch and movements that
 * `@fabric/core` productStockBatchLedger derives its figures from, so the product screens can
 * show real stock through the new ledger without a second copy of it. Nothing is stored.
 */

/** What a purchase says about its roll; a cashier's device has no purchase at all. */
export type LegacyPurchaseFacts = Pick<Purchase, 'method' | 'date' | 'weightG'>;

export interface LegacyProductBatch {
  batch: ProductStockBatch;
  /** The receipt first, then the roll's moves in history order. */
  movements: ProductStockMovement[];
}

const meters = (centimeters: number): ProductStockQuantity => ({ unit: 'meter', centimeters });

/**
 * One legacy roll as a product stock batch. The product is the roll's colour (a migrated Product
 * reuses its Variant's id, ADR 0010) and the batch reuses the roll's id.
 *
 * - bought by the metre, or a ready piece: a **meter** batch of its length (the owner's rule: a
 *   ready piece keeps being cut by the metre, or sold whole as its remaining length);
 * - bought by weight: a **kg** batch holding the weight bought and the roll's length as its
 *   conversion, `estimated` until the roll is measured. Each legacy measurement
 *   (`length_correction`) becomes a `measurement` of the full length, as the ledger records it;
 * - without the purchase (a cashier's device): a meter batch, which gives the same meters.
 *
 */
export function legacyRollAsProductBatch(
  roll: Roll,
  purchase: LegacyPurchaseFacts | undefined,
  moves: readonly SequencedMove[],
): LegacyProductBatch {
  const history = moves.filter((move) => move.rollId === roll.id).sort(syncOrder);
  const weightG = purchase?.method === 'kg' ? purchase.weightG : null;
  const purchaseDate = purchase?.date ?? roll.createdAt.slice(0, 10);
  const received: ProductStockQuantity =
    weightG === null ? meters(roll.lengthCmInitial) : { unit: 'kg', grams: weightG };

  const batch: ProductStockBatch = {
    id: roll.id,
    productId: roll.variantId,
    purchaseDate,
    createdAt: roll.createdAt,
    purchaseUnit: received.unit,
    received,
    costTotalCents: roll.costTotalCents,
    initialConversion:
      weightG === null
        ? null
        : {
            weightG,
            lengthCm: roll.lengthCmInitial,
            source: roll.lengthEstimated ? 'estimated' : 'measured',
          },
  };

  const receipt = history.find((move) => move.type === 'purchase');
  const movements: ProductStockMovement[] = [
    {
      id: receipt?.id ?? `${roll.id}:purchase`,
      batchId: roll.id,
      type: 'purchase',
      date: receipt?.date ?? purchaseDate,
      createdAt: receipt?.createdAt ?? roll.createdAt,
      delta: received,
    },
  ];

  const rest = history.filter((move) => move.type !== 'purchase');
  rest.forEach((move, index) => {
    const common = { id: move.id, batchId: roll.id, date: move.date, createdAt: move.createdAt };
    const delta = meters(move.deltaCm);
    switch (move.type) {
      case 'sale':
      case 'loss':
        movements.push({
          ...common,
          type: move.type,
          delta,
          // The cost a settlement froze for it (P9): the roll ledger keeps it, so does this.
          ...(move.lockedCostCents === undefined ? {} : { lockedCostCents: move.lockedCostCents }),
        });
        break;
      case 'adjustment':
        movements.push({ ...common, type: 'adjustment', delta });
        break;
      case 'return':
        movements.push({ ...common, type: 'return', delta, returnsMoveId: move.refId ?? '' });
        break;
      case 'reversal':
        movements.push({ ...common, type: 'reversal', delta, reversesMoveId: move.refId ?? '' });
        break;
      case 'length_correction':
        movements.push(
          weightG === null
            ? { ...common, type: 'length_correction', delta }
            : {
                ...common,
                type: 'measurement',
                // The roll's whole length after this correction, which is what a legacy
                // measurement stands for (core costBasisLength).
                measuredLengthCm: costBasisLength(roll.lengthCmInitial, rest.slice(0, index + 1)),
                measuredBy: move.deviceId,
                measuredAt: move.createdAt,
              },
        );
        break;
      case 'purchase':
        break;
    }
  });
  return { batch, movements };
}
