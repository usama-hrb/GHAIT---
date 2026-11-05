import { costBasisLength } from '@fabric/core';
import { syncOrder } from './order.js';
import type { Purchase, Roll, StockMove } from './purchasing.js';
import type { ProductBatch, ProductStockMove } from './stock.js';

/**
 * A device that kept its stock on rolls (before ADR 0012) carries it over to product batches in
 * place, without waiting for the server: the same mapping the SQL migration 0029 applies to the
 * server's rows (tested against each other), written for one device's records. Pure functions;
 * the device's database upgrade calls them.
 */

/** What the batch of a roll is made of: bought by weight (and kept), or counted in meters. */
function boughtByWeight(purchase: Pick<Purchase, 'method' | 'weightG'> | undefined): number | null {
  return purchase?.method === 'kg' && purchase.weightG !== null ? purchase.weightG : null;
}

export interface LegacyBatch {
  batch: ProductBatch;
  /** The receipt first, then the roll's moves in history order. */
  moves: ProductStockMove[];
  /** Where the server had each move in its order (null: not synced), kept so the order holds. */
  serverSeqOf: ReadonlyMap<string, number | null>;
}

/**
 * A roll as the batch it becomes, with its moves as the batch's moves. The roll's id is the
 * batch's id and each move keeps its id, so everything that points at them stays valid.
 * - bought by weight: a kg batch of that weight whose conversion is the roll's length, `estimated`
 *   until the roll was measured; each legacy length correction becomes a `measurement` of the
 *   roll's whole length after it;
 * - otherwise (by the meter, a ready piece, or no purchase known): a meter batch of the roll's length.
 */
export function legacyRollAsBatch(
  roll: Roll,
  purchase: Pick<Purchase, 'method' | 'weightG' | 'date'> | undefined,
  moves: readonly (StockMove & { serverSeq?: number | null })[],
): LegacyBatch {
  const weightG = boughtByWeight(purchase);
  const unit = weightG === null ? 'meter' : 'kg';
  const received = weightG ?? roll.lengthCmInitial;
  const batch: ProductBatch = {
    id: roll.id,
    createdAt: roll.createdAt,
    updatedAt: roll.updatedAt,
    deviceId: roll.deviceId,
    voidedAt: roll.voidedAt,
    code: roll.shortCode,
    productId: roll.variantId,
    purchaseId: roll.purchaseId,
    purchaseDate: purchase?.date ?? roll.createdAt.slice(0, 10),
    unit,
    receivedQuantity: received,
    costTotalCents: roll.costTotalCents,
    conversion:
      weightG === null
        ? null
        : {
            weightG,
            lengthCm: roll.lengthCmInitial,
            source: roll.lengthEstimated ? 'estimated' : 'measured',
          },
    status: roll.status,
  };

  const history = moves.filter((move) => move.rollId === roll.id).sort(syncOrder);
  const converted: ProductStockMove[] = [];
  const serverSeqOf = new Map<string, number | null>();
  const corrections: StockMove[] = [];
  for (const move of history) {
    if (move.type === 'length_correction') corrections.push(move);
    const common = {
      id: move.id,
      createdAt: move.createdAt,
      updatedAt: move.updatedAt,
      deviceId: move.deviceId,
      voidedAt: move.voidedAt,
      batchId: roll.id,
      refId: move.refId,
      date: move.date,
      note: move.note,
      actor: null,
    };
    serverSeqOf.set(move.id, move.serverSeq ?? null);
    if (move.type === 'purchase') {
      converted.push({ ...common, type: 'purchase', unit, delta: received });
    } else if (move.type === 'length_correction' && weightG !== null) {
      // The roll's whole length once this correction is in (core costBasisLength).
      converted.push({
        ...common,
        type: 'measurement',
        unit: 'meter',
        delta: costBasisLength(roll.lengthCmInitial, corrections),
      });
    } else {
      converted.push({ ...common, type: move.type, unit: 'meter', delta: move.deltaCm });
    }
  }
  // A roll that somehow has no purchase move still gets its receipt, so its ledger can be read.
  if (!converted.some((move) => move.type === 'purchase')) {
    converted.unshift({
      id: `${roll.id}:purchase`,
      createdAt: roll.createdAt,
      updatedAt: roll.updatedAt,
      deviceId: roll.deviceId,
      voidedAt: null,
      batchId: roll.id,
      type: 'purchase',
      unit,
      delta: received,
      refId: roll.purchaseId,
      date: batch.purchaseDate,
      note: null,
      actor: null,
    });
    serverSeqOf.set(`${roll.id}:purchase`, null);
  }
  return { batch, moves: converted, serverSeqOf };
}

type Loose = Record<string, unknown>;
const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A sale line written before batches, in today's shape (the roll is its batch, by the meter). */
export function legacySaleLineAsBatchLine(line: Loose): Loose {
  if (line.batchId !== undefined || line.rollId === undefined) return line;
  const {
    rollId,
    soldCm,
    refPricePerMeterCents,
    minPricePerMeterCents,
    actualPricePerMeterCents,
    ...rest
  } = line;
  return {
    ...rest,
    batchId: rollId,
    unit: 'meter',
    quantity: soldCm,
    refPriceCents: refPricePerMeterCents,
    minPriceCents: minPricePerMeterCents,
    actualPriceCents: actualPricePerMeterCents,
    minOverrideBy: null,
  };
}

/**
 * A stock move that came inside another record's op (a sale, a return, a void), in today's shape.
 * Those are sales, returns and reversals, always counted in meters; a weight-based roll's own
 * moves go through legacyRollAsBatch.
 */
export function legacyMoveAsBatchMove(move: Loose): Loose {
  if (move.batchId !== undefined || move.rollId === undefined) return move;
  const { rollId, deltaCm, ...rest } = move;
  return { ...rest, batchId: rollId, unit: 'meter', delta: deltaCm, actor: null };
}

const mapAll = (items: unknown, map: (item: Loose) => Loose): unknown =>
  Array.isArray(items) ? items.map((item: unknown) => (isRecord(item) ? map(item) : item)) : items;

/** A return's lines recorded `returnedCm`; they are `quantity` now. */
function legacyReturnLine(line: Loose): Loose {
  if (line.quantity !== undefined || line.returnedCm === undefined) return line;
  const { returnedCm, ...rest } = line;
  return { ...rest, quantity: returnedCm };
}

/**
 * The payload of an op that was pending when the device upgraded, in the shape the server takes
 * now (sale, void and return ops carry their moves and lines; a purchase carries its rolls).
 * Ops about rolls and stock moves on their own are rewritten from the converted records by the
 * caller. Anything else passes through.
 */
export function legacyOpPayload(
  entity: string,
  payload: unknown,
  batchOf: (rollId: string) => LegacyBatch | undefined,
): unknown {
  if (!isRecord(payload)) return payload;
  switch (entity) {
    case 'sale':
      return {
        ...payload,
        lines: mapAll(payload.lines, legacySaleLineAsBatchLine),
        moves: mapAll(payload.moves, legacyMoveAsBatchMove),
      };
    case 'sale_void':
      return { ...payload, reversals: mapAll(payload.reversals, legacyMoveAsBatchMove) };
    case 'sale_return': {
      const saleReturn = isRecord(payload.saleReturn)
        ? {
            ...payload.saleReturn,
            lines: mapAll(payload.saleReturn.lines, legacyReturnLine),
          }
        : payload.saleReturn;
      return { ...payload, saleReturn, moves: mapAll(payload.moves, legacyMoveAsBatchMove) };
    }
    case 'purchase': {
      const { rolls, ...rest } = payload;
      if (!Array.isArray(rolls)) return payload;
      const converted = (rolls as Roll[]).flatMap((roll) => batchOf(roll.id) ?? []);
      return {
        ...rest,
        batches: converted.map((entry) => entry.batch),
        // A purchase op carries the receipts of its rolls, not the moves made on them since.
        moves: converted.flatMap((entry) => entry.moves.filter((move) => move.type === 'purchase')),
      };
    }
    default:
      return payload;
  }
}
