import { assertInteger, divRoundHalfUp } from '../numeric/index.js';

export const PRODUCT_STOCK_UNITS = ['kg', 'meter', 'piece'] as const;
export type ProductStockUnit = (typeof PRODUCT_STOCK_UNITS)[number];
export type ProductStockConversionSource = 'estimated' | 'measured';

export interface ProductStockConversion {
  /** Weight represented by `lengthCm`; never kilograms or a floating-point ratio. */
  weightG: number;
  lengthCm: number;
  source: ProductStockConversionSource;
}

export type ProductStockQuantity =
  | { unit: 'kg'; grams: number }
  | { unit: 'meter'; centimeters: number }
  | { unit: 'piece'; pieces: number };

/** Immutable receipt basis for one purchase. Every purchase creates a separate batch. */
export interface ProductStockBatch {
  id: string;
  productId: string;
  purchaseDate: string;
  createdAt: string;
  purchaseUnit: ProductStockUnit;
  received: ProductStockQuantity;
  costTotalCents: number;
  /** The conversion captured for this purchase; later measurements do not overwrite it. */
  initialConversion: ProductStockConversion | null;
}

interface ProductMovementBase {
  id: string;
  batchId: string;
  /** Append/history order is the order of this array in productStockLedger. */
  date: string;
  createdAt: string;
}

export type ProductStockMovement =
  | (ProductMovementBase & { type: 'purchase'; delta: ProductStockQuantity })
  | (ProductMovementBase & {
      type: 'sale' | 'loss';
      delta: ProductStockQuantity;
      /** A sale or loss in a locked period keeps the cost recorded for it (SPEC §2.4, P9). */
      lockedCostCents?: number;
    })
  | (ProductMovementBase & { type: 'length_correction'; delta: ProductStockQuantity })
  | (ProductMovementBase & {
      type: 'return';
      delta: ProductStockQuantity;
      returnsMoveId: string;
    })
  | (ProductMovementBase & { type: 'adjustment'; delta: ProductStockQuantity })
  | (ProductMovementBase & {
      type: 'reversal';
      delta: ProductStockQuantity;
      reversesMoveId: string;
    })
  | (ProductMovementBase & {
      type: 'measurement';
      measuredLengthCm: number;
      measuredBy: string;
      measuredAt: string;
    });

export type ProductStockMovementType = ProductStockMovement['type'];

export interface ProductStockBatchLedger {
  batchId: string;
  purchaseUnit: ProductStockUnit;
  /** The remaining quantity in the unit used to receive this batch. */
  remaining: ProductStockQuantity;
  available: Partial<Record<ProductStockUnit, ProductStockQuantity>>;
  costTotalCents: number;
  unallocatedCostCents: number;
  costs: { moveId: string; costCents: number }[];
  returns: { moveId: string; saleMoveId: string; costCents: number }[];
  measurementStatus: 'not_required' | 'pending' | 'estimated' | 'measured';
  /** Positive received weight remains visible even when no saleable length is known. */
  awaitingMeasurement: ProductStockQuantity | null;
  oversold: ProductStockQuantity;
  costPerUnitCents: Partial<Record<ProductStockUnit, number>>;
  conversion: ProductStockConversion | null;
  /**
   * The length (cm) the batch's cost is spread over: a meter batch's corrected length, a kg batch's
   * measured or estimated length; null when no length is known (a weight awaiting measurement, or
   * pieces). A whole-piece sale needs the batch untouched at this length.
   */
  lengthBasisCm: number | null;
}

export interface ProductStockLedger {
  batches: ProductStockBatchLedger[];
  available: Partial<Record<ProductStockUnit, ProductStockQuantity>>;
  awaitingMeasurement: { batchId: string; quantity: ProductStockQuantity }[];
  /** All the weight waiting for its length, or null when no batch waits. */
  awaitingMeasurementTotal: ProductStockQuantity | null;
  oversold: { batchId: string; quantity: ProductStockQuantity }[];
}

export interface ProductStockTake {
  batchId: string;
  quantity: ProductStockQuantity;
}

export interface ProductStockSaleProposal {
  takes: ProductStockTake[];
  shortfall: ProductStockQuantity;
}

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

interface CalculatedProductStockBatch {
  ledger: ProductStockBatchLedger;
  remaining: Fraction;
  conversion: ProductStockConversion | null;
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator === 0n) throw new RangeError('stock quantity denominator must not be zero');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

function add(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function compare(a: Fraction, b: Fraction): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function roundFraction(value: Fraction): number {
  if (value.numerator < 0n) {
    return -divRoundHalfUp(-value.numerator, value.denominator);
  }
  return divRoundHalfUp(value.numerator, value.denominator);
}

function amountOf(quantity: ProductStockQuantity): number {
  switch (quantity.unit) {
    case 'kg':
      return quantity.grams;
    case 'meter':
      return quantity.centimeters;
    case 'piece':
      return quantity.pieces;
  }
}

function quantity(unit: ProductStockUnit, amount: number): ProductStockQuantity {
  switch (unit) {
    case 'kg':
      return { unit, grams: amount };
    case 'meter':
      return { unit, centimeters: amount };
    case 'piece':
      return { unit, pieces: amount };
  }
}

function validateQuantity(value: ProductStockQuantity, name: string, allowZero = false): void {
  if (!PRODUCT_STOCK_UNITS.includes(value.unit)) {
    throw new RangeError(`${name} has an unsupported unit`);
  }
  const amount = amountOf(value);
  assertInteger(Math.abs(amount), name, allowZero ? 0 : 1);
}

function validateBatch(batch: ProductStockBatch): void {
  if (!batch.id || !batch.productId) throw new RangeError('batch and product ids are required');
  if (!PRODUCT_STOCK_UNITS.includes(batch.purchaseUnit)) {
    throw new RangeError('batch has an unsupported purchase unit');
  }
  if (
    !Number.isFinite(Date.parse(batch.purchaseDate)) ||
    !Number.isFinite(Date.parse(batch.createdAt))
  ) {
    throw new RangeError('batch purchase date and creation timestamp must be valid');
  }
  if (batch.received.unit !== batch.purchaseUnit) {
    throw new RangeError('received quantity unit must match the purchase unit');
  }
  validateQuantity(batch.received, 'received quantity');
  assertInteger(batch.costTotalCents, 'costTotalCents', 0);
  if (batch.initialConversion) {
    assertInteger(batch.initialConversion.weightG, 'conversion weightG', 1);
    assertInteger(batch.initialConversion.lengthCm, 'conversion lengthCm', 1);
  }
  if (batch.purchaseUnit === 'piece' && batch.initialConversion) {
    throw new RangeError('piece batches do not support kg-to-meter conversion');
  }
}

function sourceAmount(
  batch: ProductStockBatch,
  value: ProductStockQuantity,
  conversion: ProductStockConversion | null,
): Fraction {
  const amount = amountOf(value);
  if (value.unit === batch.purchaseUnit) return fraction(BigInt(amount));
  if (!conversion) throw new RangeError('cross-unit movement requires a batch conversion');
  if (batch.purchaseUnit === 'piece' || value.unit === 'piece') {
    throw new RangeError('piece stock cannot be converted to or from kg or meter');
  }
  if (batch.purchaseUnit === 'kg' && value.unit === 'meter') {
    return fraction(BigInt(amount) * BigInt(conversion.weightG), BigInt(conversion.lengthCm));
  }
  if (batch.purchaseUnit === 'meter' && value.unit === 'kg') {
    return fraction(BigInt(amount) * BigInt(conversion.lengthCm), BigInt(conversion.weightG));
  }
  throw new RangeError('unsupported stock unit conversion');
}

function quantityFromSource(
  batch: ProductStockBatch,
  source: Fraction,
  unit: ProductStockUnit,
  conversion: ProductStockConversion | null,
): ProductStockQuantity {
  if (unit === batch.purchaseUnit) return quantity(unit, roundFraction(source));
  if (!conversion) return quantity(unit, 0);
  if (batch.purchaseUnit === 'kg' && unit === 'meter') {
    return quantity(
      unit,
      roundFraction(
        fraction(
          source.numerator * BigInt(conversion.lengthCm),
          source.denominator * BigInt(conversion.weightG),
        ),
      ),
    );
  }
  if (batch.purchaseUnit === 'meter' && unit === 'kg') {
    return quantity(
      unit,
      roundFraction(
        fraction(
          source.numerator * BigInt(conversion.weightG),
          source.denominator * BigInt(conversion.lengthCm),
        ),
      ),
    );
  }
  return quantity(unit, 0);
}

function sourceInUnit(
  batch: ProductStockBatch,
  source: Fraction,
  unit: ProductStockUnit,
  conversion: ProductStockConversion | null,
): Fraction | null {
  if (unit === batch.purchaseUnit) return source;
  if (!conversion || batch.purchaseUnit === 'piece' || unit === 'piece') return null;
  if (batch.purchaseUnit === 'kg' && unit === 'meter') {
    return fraction(
      source.numerator * BigInt(conversion.lengthCm),
      source.denominator * BigInt(conversion.weightG),
    );
  }
  if (batch.purchaseUnit === 'meter' && unit === 'kg') {
    return fraction(
      source.numerator * BigInt(conversion.weightG),
      source.denominator * BigInt(conversion.lengthCm),
    );
  }
  return null;
}

function floorPositive(value: Fraction): number {
  if (value.numerator <= 0n) return 0;
  const result = value.numerator / value.denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('stock quantity exceeds Number.MAX_SAFE_INTEGER');
  }
  return Number(result);
}

function effectiveConversion(
  batch: ProductStockBatch,
  moves: readonly ProductStockMovement[],
): ProductStockConversion | null {
  if (batch.purchaseUnit !== 'kg') return batch.initialConversion;
  const measurements = moves.filter(
    (move): move is Extract<ProductStockMovement, { type: 'measurement' }> =>
      move.type === 'measurement',
  );
  const latest = measurements.at(-1);
  if (!latest) return batch.initialConversion;
  return {
    weightG: amountOf(batch.received),
    lengthCm: latest.measuredLengthCm,
    source: 'measured',
  };
}

function validateMove(
  move: ProductStockMovement,
  batch: ProductStockBatch,
  conversion: ProductStockConversion | null,
): void {
  if (!move.id || move.batchId !== batch.id)
    throw new RangeError('stock movement identity mismatch');
  if (
    ![
      'purchase',
      'sale',
      'loss',
      'length_correction',
      'adjustment',
      'return',
      'reversal',
      'measurement',
    ].includes(move.type)
  ) {
    throw new RangeError(`stock movement ${move.id} has an unsupported type`);
  }
  if (move.type === 'measurement') {
    if (batch.purchaseUnit !== 'kg') {
      throw new RangeError('only a kg batch can have a length measurement');
    }
    assertInteger(move.measuredLengthCm, 'measuredLengthCm', 1);
    if (!move.measuredBy.trim()) throw new RangeError('measurement performer is required');
    if (!Number.isFinite(Date.parse(move.measuredAt))) {
      throw new RangeError('measurement timestamp is invalid');
    }
    return;
  }
  if (move.type === 'purchase' || move.type === 'return') {
    validateQuantity(move.delta, `${move.type} quantity`);
    if (amountOf(move.delta) <= 0) {
      throw new RangeError(`${move.type} movement must be positive`);
    }
  } else if (move.type === 'sale' || move.type === 'loss') {
    assertInteger(Math.abs(amountOf(move.delta)), `${move.type} quantity`, 1);
    if (amountOf(move.delta) >= 0) {
      throw new RangeError(`${move.type} movement must be negative`);
    }
  } else if (move.type === 'length_correction') {
    validateQuantity(move.delta, `${move.type} quantity`, true);
    if (amountOf(move.delta) === 0) throw new RangeError(`${move.type} movement must not be zero`);
    if (batch.purchaseUnit !== 'meter' || move.delta.unit !== 'meter') {
      throw new RangeError('length corrections are supported only on meter-purchased batches');
    }
  } else {
    validateQuantity(move.delta, `${move.type} quantity`, true);
    if (amountOf(move.delta) === 0) throw new RangeError(`${move.type} movement must not be zero`);
  }
  sourceAmount(batch, move.delta, conversion);
}

function addSourceDelta(current: Fraction, sourceDelta: Fraction): Fraction {
  return add(current, sourceDelta);
}

function allocationCost(cost: number, amount: Fraction, basis: number): number {
  if (amount.numerator <= 0n) return 0;
  return divRoundHalfUp(BigInt(cost) * amount.numerator, BigInt(basis) * amount.denominator);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Derives one purchase batch from its immutable receipt and append-ordered movements.
 * The receipt is required in the history and checked against the original batch.
 */
function calculateProductStockBatchLedger(
  batch: ProductStockBatch,
  moves: readonly ProductStockMovement[],
): CalculatedProductStockBatch {
  validateBatch(batch);
  const batchMoves = moves.filter((move) => move.batchId === batch.id);
  const ids = new Set<string>();
  for (const move of batchMoves) {
    if (ids.has(move.id)) throw new RangeError(`duplicate stock movement ${move.id}`);
    ids.add(move.id);
  }
  const receipts = batchMoves.filter(
    (move): move is Extract<ProductStockMovement, { type: 'purchase' }> => move.type === 'purchase',
  );
  if (
    receipts.length !== 1 ||
    batchMoves[0]?.id !== receipts[0]?.id ||
    receipts[0]?.delta.unit !== batch.received.unit ||
    amountOf(receipts[0].delta) !== amountOf(batch.received)
  ) {
    throw new RangeError('batch history must contain exactly one matching purchase receipt');
  }

  const conversion = effectiveConversion(batch, batchMoves);
  let conversionAtMove = batch.initialConversion;
  for (const move of batchMoves) {
    if (!move.date || !Number.isFinite(Date.parse(move.date))) {
      throw new RangeError(`stock movement ${move.id} has an invalid date`);
    }
    if (!move.createdAt || !Number.isFinite(Date.parse(move.createdAt))) {
      throw new RangeError(`stock movement ${move.id} has an invalid creation timestamp`);
    }
    validateMove(move, batch, conversionAtMove);
    if (move.type === 'measurement') {
      conversionAtMove = {
        weightG: amountOf(batch.received),
        lengthCm: move.measuredLengthCm,
        source: 'measured',
      };
    }
  }

  const byId = new Map(batchMoves.map((move) => [move.id, move]));
  const reversed = new Set<string>();
  for (const [index, move] of batchMoves.entries()) {
    if (move.type !== 'reversal') continue;
    const target = byId.get(move.reversesMoveId);
    const targetIndex = batchMoves.findIndex((entry) => entry.id === move.reversesMoveId);
    if (
      !target ||
      targetIndex >= index ||
      (target.type !== 'sale' && target.type !== 'loss' && target.type !== 'adjustment') ||
      target.delta.unit !== move.delta.unit ||
      amountOf(target.delta) !== -amountOf(move.delta)
    ) {
      throw new RangeError(`reversal ${move.id} does not mirror a sale, loss or adjustment`);
    }
    if (reversed.has(target.id)) throw new RangeError(`movement ${target.id} is reversed twice`);
    reversed.add(target.id);
  }

  const receivedAmount = amountOf(batch.received);
  const correctedBasis = batchMoves.reduce((basis, move) => {
    if (move.type !== 'length_correction' || reversed.has(move.id)) return basis;
    return basis + amountOf(move.delta);
  }, receivedAmount);
  if (correctedBasis < 1)
    throw new RangeError('corrected cost basis must be at least one base unit');
  // Costed as if the corrected length had always been known (SPEC §2.4, PB5): the corrections
  // are in the starting point, so a sale made before one is not judged on the uncorrected length.
  let remaining = fraction(BigInt(correctedBasis));
  const costs: ProductStockBatchLedger['costs'] = [];
  const returns: ProductStockBatchLedger['returns'] = [];
  const allocatedCosts: number[] = [];
  const saleState = new Map<
    string,
    { sourceAmount: Fraction; cost: number; returned: Fraction; returnedCost: number }
  >();

  for (const move of batchMoves) {
    if (
      move.type === 'purchase' ||
      move.type === 'measurement' ||
      move.type === 'length_correction' ||
      reversed.has(move.id)
    ) {
      continue;
    }
    if (move.type === 'reversal') continue;
    const sourceDelta = sourceAmount(batch, move.delta, conversion);

    if (move.type === 'return') {
      const target = saleState.get(move.returnsMoveId);
      if (!target || byId.get(move.returnsMoveId)?.type !== 'sale') {
        throw new RangeError(`return ${move.id} must reference a sale in this batch`);
      }
      const returned = add(target.returned, sourceDelta);
      if (compare(returned, target.sourceAmount) > 0) {
        throw new RangeError(`return ${move.id} exceeds the sale quantity`);
      }
      const cumulativeCost = divRoundHalfUp(
        BigInt(target.cost) * returned.numerator * target.sourceAmount.denominator,
        returned.denominator * target.sourceAmount.numerator,
      );
      const returnCost = cumulativeCost - target.returnedCost;
      target.returned = returned;
      target.returnedCost = cumulativeCost;
      allocatedCosts.push(-returnCost);
      returns.push({ moveId: move.id, saleMoveId: move.returnsMoveId, costCents: returnCost });
      remaining = add(remaining, sourceDelta);
      continue;
    }

    if (move.type === 'sale' || move.type === 'loss') {
      const consumed = fraction(-sourceDelta.numerator, sourceDelta.denominator);
      const unallocated = batch.costTotalCents - sum(allocatedCosts);
      // The line that takes what is left, or more (two devices, a count, a shorter measurement),
      // takes the cost still on the batch, so no cost is stranded on an empty batch (the roll
      // rule, allocateLineCost); any other line takes its share, never more than is left.
      let costCents: number;
      if (move.lockedCostCents !== undefined) {
        // A settlement froze this line's cost; a later measurement does not change it.
        assertInteger(move.lockedCostCents, `locked cost of ${move.id}`, 0);
        costCents = move.lockedCostCents;
      } else {
        costCents =
          compare(consumed, remaining) >= 0
            ? unallocated
            : Math.min(unallocated, allocationCost(batch.costTotalCents, consumed, correctedBasis));
      }
      allocatedCosts.push(costCents);
      costs.push({ moveId: move.id, costCents });
      if (move.type === 'sale') {
        saleState.set(move.id, {
          sourceAmount: consumed,
          cost: costCents,
          returned: fraction(0n),
          returnedCost: 0,
        });
      }
    }

    remaining = addSourceDelta(remaining, sourceDelta);
  }

  const remainingInteger = roundFraction(remaining);
  const remainingQuantity = quantity(batch.purchaseUnit, remainingInteger);
  const oversold = quantity(batch.purchaseUnit, Math.max(-remainingInteger, 0));
  const unallocatedCostCents = batch.costTotalCents - sum(allocatedCosts);
  if (unallocatedCostCents < 0) throw new RangeError('allocated costs exceed the batch cost');

  let measurementStatus: ProductStockBatchLedger['measurementStatus'] = 'not_required';
  let awaitingMeasurement: ProductStockQuantity | null = null;
  if (batch.purchaseUnit === 'kg') {
    if (!conversion) {
      measurementStatus = 'pending';
      awaitingMeasurement = quantity('kg', Math.max(remainingInteger, 0));
    } else {
      measurementStatus = conversion.source;
    }
  }

  const available: ProductStockBatchLedger['available'] = {
    [batch.purchaseUnit]: remainingQuantity,
  };
  if (batch.purchaseUnit === 'kg' && !conversion) {
    available.meter = quantity('meter', 0);
  } else if (conversion && batch.purchaseUnit === 'kg') {
    available.meter = quantityFromSource(batch, remaining, 'meter', conversion);
  } else if (conversion && batch.purchaseUnit === 'meter') {
    available.kg = quantityFromSource(batch, remaining, 'kg', conversion);
  }

  const costPerUnitCents: ProductStockBatchLedger['costPerUnitCents'] = {};
  if (batch.purchaseUnit === 'piece') {
    costPerUnitCents.piece = divRoundHalfUp(batch.costTotalCents, correctedBasis);
  } else if (batch.purchaseUnit === 'kg') {
    costPerUnitCents.kg = divRoundHalfUp(BigInt(batch.costTotalCents) * 1000n, correctedBasis);
    if (conversion) {
      costPerUnitCents.meter = divRoundHalfUp(
        BigInt(batch.costTotalCents) * 100n * BigInt(conversion.weightG),
        BigInt(correctedBasis) * BigInt(conversion.lengthCm),
      );
    }
  } else {
    costPerUnitCents.meter = divRoundHalfUp(BigInt(batch.costTotalCents) * 100n, correctedBasis);
    if (conversion) {
      costPerUnitCents.kg = divRoundHalfUp(
        BigInt(batch.costTotalCents) * 1000n * BigInt(conversion.lengthCm),
        BigInt(correctedBasis) * BigInt(conversion.weightG),
      );
    }
  }

  const ledger: ProductStockBatchLedger = {
    batchId: batch.id,
    purchaseUnit: batch.purchaseUnit,
    remaining: remainingQuantity,
    available,
    costTotalCents: batch.costTotalCents,
    unallocatedCostCents,
    costs,
    returns,
    measurementStatus,
    awaitingMeasurement,
    oversold,
    costPerUnitCents,
    conversion,
    lengthBasisCm:
      batch.purchaseUnit === 'meter'
        ? correctedBasis
        : batch.purchaseUnit === 'kg' && conversion
          ? conversion.lengthCm
          : null,
  };
  return { ledger, remaining, conversion };
}

export function productStockBatchLedger(
  batch: ProductStockBatch,
  moves: readonly ProductStockMovement[],
): ProductStockBatchLedger {
  return calculateProductStockBatchLedger(batch, moves).ledger;
}

/** Aggregate batches without blending their individual cost bases or conversion ratios. */
export function productStockLedger(
  batches: readonly ProductStockBatch[],
  moves: readonly ProductStockMovement[],
): ProductStockLedger {
  const batchIds = new Set<string>();
  const productIds = new Set<string>();
  for (const batch of batches) {
    if (batchIds.has(batch.id)) throw new RangeError(`duplicate product stock batch ${batch.id}`);
    batchIds.add(batch.id);
    productIds.add(batch.productId);
  }
  if (productIds.size > 1) throw new RangeError('a product stock ledger cannot mix product ids');
  for (const move of moves) {
    if (!batchIds.has(move.batchId)) {
      throw new RangeError(`stock movement ${move.id} references an unknown batch`);
    }
  }
  const batchLedgers = batches.map((batch) => productStockBatchLedger(batch, moves));
  const available: ProductStockLedger['available'] = {};
  for (const unit of ['kg', 'meter', 'piece'] as const) {
    const entries = batchLedgers
      .map((ledger) => ledger.available[unit])
      .filter((entry): entry is ProductStockQuantity => entry !== undefined);
    if (entries.length > 0) {
      available[unit] = quantity(
        unit,
        entries.reduce((total, entry) => {
          const next = total + amountOf(entry);
          assertInteger(next, `aggregate ${unit} quantity`);
          return next;
        }, 0),
      );
    }
  }
  const awaitingMeasurement = batchLedgers.flatMap((ledger) =>
    ledger.awaitingMeasurement
      ? [{ batchId: ledger.batchId, quantity: ledger.awaitingMeasurement }]
      : [],
  );
  let awaitingGrams = 0;
  for (const waiting of awaitingMeasurement) {
    awaitingGrams += amountOf(waiting.quantity);
    assertInteger(awaitingGrams, 'aggregate awaiting-measurement weight');
  }
  return {
    batches: batchLedgers,
    available,
    awaitingMeasurement,
    awaitingMeasurementTotal:
      awaitingMeasurement.length === 0 ? null : quantity('kg', awaitingGrams),
    oversold: batchLedgers
      .filter((ledger) => amountOf(ledger.oversold) > 0)
      .map((ledger) => ({ batchId: ledger.batchId, quantity: ledger.oversold })),
  };
}

/**
 * Proposes an oldest-purchase-first sale plan. Any shortage is reported (not rejected), preserving
 * the existing offline rule: a concurrently oversold operation is accepted and flagged.
 */
export function proposeProductStockSale(
  batches: readonly ProductStockBatch[],
  moves: readonly ProductStockMovement[],
  wanted: ProductStockQuantity,
  sellingUnits: readonly ProductStockUnit[],
): ProductStockSaleProposal {
  validateQuantity(wanted, 'wanted quantity');
  if (!sellingUnits.includes(wanted.unit)) {
    throw new RangeError(`product is not configured to sell in ${wanted.unit}`);
  }
  const productIds = new Set(batches.map((batch) => batch.productId));
  if (productIds.size > 1) throw new RangeError('a sale proposal cannot mix product ids');
  const batchIds = new Set(batches.map((batch) => batch.id));
  for (const move of moves) {
    if (!batchIds.has(move.batchId)) {
      throw new RangeError(`stock movement ${move.id} references an unknown batch`);
    }
  }
  const ordered = [...batches].sort(
    (a, b) =>
      a.purchaseDate.localeCompare(b.purchaseDate) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  let left = amountOf(wanted);
  const takes: ProductStockTake[] = [];
  for (const batch of ordered) {
    if (left === 0) break;
    const calculated = calculateProductStockBatchLedger(batch, moves);
    const exactOnHand = sourceInUnit(
      batch,
      calculated.remaining,
      wanted.unit,
      calculated.conversion,
    );
    if (!exactOnHand) continue;
    const availableWholeUnits = floorPositive(exactOnHand);
    if (availableWholeUnits <= 0) continue;
    const taken = Math.min(availableWholeUnits, left);
    takes.push({ batchId: batch.id, quantity: quantity(wanted.unit, taken) });
    left -= taken;
  }
  return { takes, shortfall: quantity(wanted.unit, left) };
}

/** What a product's batches still hold, at the cost each batch was bought for (PB18). */
export interface ProductStockValue {
  /**
   * Σ of the cost still on each batch (`unallocatedCostCents`): the cost of what is left, with
   * sales, losses and returns already taken off. Weight still waiting for a length counts.
   */
  valueCents: number;
  /**
   * The weighted average cost of the stock held in metres: the cost still on those batches over
   * the metres still on them, half up. null when no batch holds metres.
   */
  averageCostPerMeterCents: number | null;
  /** The same for the stock held in pieces. null when no batch holds pieces. */
  averageCostPerPieceCents: number | null;
}

/**
 * The value of what a product still holds and its weighted average cost per unit, from its
 * batches' ledgers (PB18). Each batch keeps its own cost: nothing here replaces a batch's cost by
 * a product-level one, and weight with no length is never given a cost per metre (it is in the
 * value, and out of the average).
 */
export function productStockValue(batches: readonly ProductStockBatchLedger[]): ProductStockValue {
  let valueCents = 0;
  const held = {
    meter: { costCents: 0, amount: 0 },
    piece: { costCents: 0, amount: 0 },
  };
  for (const ledger of batches) {
    assertInteger(ledger.unallocatedCostCents, `unallocated cost of ${ledger.batchId}`, 0);
    valueCents += ledger.unallocatedCostCents;
    for (const unit of ['meter', 'piece'] as const) {
      const entry = ledger.available[unit];
      const amount = entry ? amountOf(entry) : 0;
      if (amount <= 0) continue;
      held[unit].costCents += ledger.unallocatedCostCents;
      held[unit].amount += amount;
    }
  }
  assertInteger(valueCents, 'stock value');
  return {
    valueCents,
    averageCostPerMeterCents:
      held.meter.amount > 0
        ? divRoundHalfUp(BigInt(held.meter.costCents) * 100n, BigInt(held.meter.amount))
        : null,
    averageCostPerPieceCents:
      held.piece.amount > 0
        ? divRoundHalfUp(BigInt(held.piece.costCents), BigInt(held.piece.amount))
        : null,
  };
}

/**
 * Whether a product still holds stock (PB20): something left to sell in any unit, weight still
 * waiting for its length, or cost still on a batch. A product that holds none has been sold,
 * lost or returned out; one that is oversold holds none either (there is nothing left to value).
 * Removing a product from the inventory is refused while this is true, so the stock value, the
 * zakat base and the books never lose goods that still exist.
 */
export function productHoldsStock(batches: readonly ProductStockBatchLedger[]): boolean {
  return batches.some(
    (ledger) =>
      Object.values(ledger.available).some((entry) => amountOf(entry) > 0) ||
      (ledger.awaitingMeasurement !== null && amountOf(ledger.awaitingMeasurement) > 0) ||
      ledger.unallocatedCostCents > 0,
  );
}
