import { buildRollsFromPurchase, type PurchaseInput, type StockMoveType } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import { firstDifference } from './diff.js';
import type { ValidationIssue } from './errors.js';

/** SPEC §2.3: by the metre (assortments), ready piece, or by weight. */
export const PURCHASE_METHODS = ['meter', 'piece', 'kg'] as const;
export type PurchaseMethod = (typeof PURCHASE_METHODS)[number];

export const ROLL_STATUSES = ['active', 'remnant', 'empty', 'written_off'] as const;

export const STOCK_MOVE_TYPES = [
  'purchase',
  'sale',
  'loss',
  'length_correction',
  'adjustment',
  'return',
  'reversal',
] as const satisfies readonly StockMoveType[];

/**
 * Short roll codes, unique across devices without asking the server: "R-" + the device's code
 * (A, B…, assigned once at sign-in by POST /devices/register) + the device's own counter.
 * The main till's first roll is R-A0001.
 */
export const rollCodeSchema = z.string().regex(/^R-[A-Z]{1,3}\d{4,6}$/);
export const deviceCodeSchema = z.string().regex(/^[A-Z]{1,3}$/);

export function rollCode(deviceCode: string, counter: number): string {
  return `R-${deviceCode}${String(counter).padStart(4, '0')}`;
}

export const deviceRegistrationSchema = z.object({ code: deviceCodeSchema });
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

/** SPEC §13 `purchase`, plus what was typed for the method (to re-check its rolls). */
export const purchaseSchema = recordBaseSchema.extend({
  date: isoDateSchema,
  supplierId: idSchema.nullable(),
  method: z.enum(PURCHASE_METHODS),
  /** meter: the price per metre of every roll. */
  pricePerMeterCents: amountCentsSchema.nullable(),
  /** kg: the weight bought and the cm-per-kg estimate the length was computed with. */
  weightG: z.int().min(1).nullable(),
  estCmPerKg: z.int().min(1).nullable(),
  /** Σ of the rolls' costs. */
  totalCostCents: amountCentsSchema,
  /** Phase 1: purchases are paid in full (no supplier debts, SPEC §9 / I4). */
  paidCents: amountCentsSchema,
  notes: optionalTextSchema(1000),
});
export type Purchase = z.output<typeof purchaseSchema>;

/** SPEC §13 `roll`: the stock unit (SPEC §2.2). Remaining length is derived from stock moves. */
export const rollSchema = recordBaseSchema.extend({
  shortCode: rollCodeSchema,
  variantId: idSchema,
  purchaseId: idSchema,
  lengthCmInitial: z.int().min(1),
  costTotalCents: amountCentsSchema,
  /** Bought by weight and not measured yet (SPEC §2.3). */
  lengthEstimated: z.boolean(),
  status: z.enum(ROLL_STATUSES),
});
export type Roll = z.output<typeof rollSchema>;

/** SPEC §13 `stock_move`: append-only. */
export const stockMoveSchema = recordBaseSchema.extend({
  rollId: idSchema,
  type: z.enum(STOCK_MOVE_TYPES),
  /** Signed cm; the purchase move records the initial length (not counted twice). */
  deltaCm: z.int(),
  /** What caused it: the purchase, the sale line… */
  refId: idSchema.nullable(),
  date: isoDateSchema,
  note: optionalTextSchema(500),
});
export type StockMove = z.output<typeof stockMoveSchema>;

/** One purchase op: the purchase and the rolls and moves it creates, applied atomically. */
export const purchaseAggregateSchema = z.object({
  purchase: purchaseSchema,
  rolls: z.array(rollSchema).min(1).max(100),
  moves: z.array(stockMoveSchema).min(1).max(100),
});
export type PurchaseAggregate = z.output<typeof purchaseAggregateSchema>;

const purchaseCommon = {
  date: isoDateSchema,
  supplierId: idSchema.nullable().default(null),
  notes: optionalTextSchema(1000).default(null),
};

/** What the user enters on the "new purchase" screen. */
export const newPurchaseSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('meter'),
    ...purchaseCommon,
    pricePerMeterCents: amountCentsSchema,
    /** One roll per colour (an assortment), each with its own length. */
    rolls: z
      .array(z.object({ variantId: idSchema, lengthCm: z.int().min(1) }))
      .min(1)
      .max(100),
  }),
  z.object({
    method: z.literal('piece'),
    ...purchaseCommon,
    variantId: idSchema,
    lengthCm: z.int().min(1),
    totalCostCents: amountCentsSchema,
  }),
  z.object({
    method: z.literal('kg'),
    ...purchaseCommon,
    variantId: idSchema,
    weightG: z.int().min(1),
    totalCostCents: amountCentsSchema,
    estCmPerKg: z.int().min(1),
  }),
]);
export type NewPurchase = z.output<typeof newPurchaseSchema>;
export type NewPurchaseInput = z.input<typeof newPurchaseSchema>;

function coreInput(input: NewPurchase): PurchaseInput {
  switch (input.method) {
    case 'meter':
      return { method: 'meter', pricePerMeterCents: input.pricePerMeterCents, rolls: input.rolls };
    case 'piece':
      return {
        method: 'piece',
        variantId: input.variantId,
        lengthCm: input.lengthCm,
        totalCostCents: input.totalCostCents,
      };
    case 'kg':
      return {
        method: 'kg',
        variantId: input.variantId,
        weightG: input.weightG,
        totalCostCents: input.totalCostCents,
        estCmPerKg: input.estCmPerKg,
      };
  }
}

/** The rolls a purchase would create, as @fabric/core costs them (for a preview before saving). */
export function previewPurchaseRolls(
  input: NewPurchase,
): ReturnType<typeof buildRollsFromPurchase> {
  return buildRollsFromPurchase(coreInput(input));
}

/** How many rolls a purchase creates (ids and codes to allocate). */
export function rollCountOf(input: NewPurchase): number {
  return input.method === 'meter' ? input.rolls.length : 1;
}

/**
 * The records a purchase creates, costed by @fabric/core buildRollsFromPurchase (SPEC §2.3):
 * the device builds them to save offline, and the server rebuilds them to check what it is sent.
 */
export function buildPurchaseAggregate(
  input: NewPurchase,
  ids: {
    purchaseId: string;
    rollIds: readonly string[];
    moveIds: readonly string[];
    shortCodes: readonly string[];
  },
  meta: { deviceId: string; now: string },
): PurchaseAggregate {
  const built = buildRollsFromPurchase(coreInput(input));
  const count = built.rolls.length;
  if (
    ids.rollIds.length !== count ||
    ids.moveIds.length !== count ||
    ids.shortCodes.length !== count
  ) {
    throw new RangeError(
      `a purchase of ${String(count)} rolls needs ${String(count)} ids and codes`,
    );
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const purchase: Purchase = {
    ...base,
    id: ids.purchaseId,
    date: input.date,
    supplierId: input.supplierId,
    method: input.method,
    pricePerMeterCents: input.method === 'meter' ? input.pricePerMeterCents : null,
    weightG: input.method === 'kg' ? input.weightG : null,
    estCmPerKg: input.method === 'kg' ? input.estCmPerKg : null,
    totalCostCents: built.totalCostCents,
    paidCents: built.totalCostCents,
    notes: input.notes,
  };
  const rolls: Roll[] = built.rolls.map((roll, index) => ({
    ...base,
    id: ids.rollIds[index] ?? '',
    shortCode: ids.shortCodes[index] ?? '',
    variantId: roll.variantId,
    purchaseId: ids.purchaseId,
    lengthCmInitial: roll.lengthCmInitial,
    costTotalCents: roll.costTotalCents,
    lengthEstimated: roll.lengthEstimated,
    status: 'active',
  }));
  const moves: StockMove[] = rolls.map((roll, index) => ({
    ...base,
    id: ids.moveIds[index] ?? '',
    rollId: roll.id,
    type: 'purchase',
    deltaCm: roll.lengthCmInitial,
    refId: ids.purchaseId,
    date: input.date,
    note: null,
  }));
  return { purchase, rolls, moves };
}

/** The purchase as typed, read back from its records (null when they are inconsistent). */
function inputOf({ purchase, rolls }: PurchaseAggregate): NewPurchase | null {
  const common = { date: purchase.date, supplierId: purchase.supplierId, notes: purchase.notes };
  const [first] = rolls;
  if (!first) return null;
  if (purchase.method === 'meter') {
    if (purchase.pricePerMeterCents === null) return null;
    return {
      method: 'meter',
      ...common,
      pricePerMeterCents: purchase.pricePerMeterCents,
      rolls: rolls.map((roll) => ({ variantId: roll.variantId, lengthCm: roll.lengthCmInitial })),
    };
  }
  if (rolls.length !== 1) return null;
  if (purchase.method === 'piece') {
    return {
      method: 'piece',
      ...common,
      variantId: first.variantId,
      lengthCm: first.lengthCmInitial,
      totalCostCents: purchase.totalCostCents,
    };
  }
  if (purchase.weightG === null || purchase.estCmPerKg === null) return null;
  return {
    method: 'kg',
    ...common,
    variantId: first.variantId,
    weightG: purchase.weightG,
    totalCostCents: purchase.totalCostCents,
    estCmPerKg: purchase.estCmPerKg,
  };
}

export const PURCHASE_ISSUES = {
  inconsistent: 'purchase_records_inconsistent',
  notCore: 'purchase_does_not_match_core',
} as const;

/**
 * Re-checks a pushed purchase (BUILD_PROMPTS 3.2: the server re-validates with the same core
 * function): its rolls, costs, totals and moves must be exactly what buildPurchaseAggregate
 * gives for what was typed. Returns the issues; empty when it is consistent.
 */
export function checkPurchaseAggregate(aggregate: PurchaseAggregate): ValidationIssue[] {
  const input = inputOf(aggregate);
  if (!input)
    return [{ path: ['purchase'], message: PURCHASE_ISSUES.inconsistent, code: 'custom' }];
  let expected: PurchaseAggregate;
  try {
    expected = buildPurchaseAggregate(
      input,
      {
        purchaseId: aggregate.purchase.id,
        rollIds: aggregate.rolls.map((roll) => roll.id),
        moveIds: aggregate.moves.map((move) => move.id),
        shortCodes: aggregate.rolls.map((roll) => roll.shortCode),
      },
      { deviceId: aggregate.purchase.deviceId, now: aggregate.purchase.createdAt },
    );
  } catch {
    return [{ path: ['purchase'], message: PURCHASE_ISSUES.inconsistent, code: 'custom' }];
  }
  const path = firstDifference(expected, aggregate);
  if (path) return [{ path, message: PURCHASE_ISSUES.notCore, code: 'custom' }];
  const codes = new Set(aggregate.rolls.map((roll) => roll.shortCode));
  if (codes.size !== aggregate.rolls.length) {
    return [{ path: ['rolls'], message: PURCHASE_ISSUES.inconsistent, code: 'custom' }];
  }
  return [];
}

/** As the API returns them: with the server_seq of their current version. */
const withServerSeq = { serverSeq: z.int().positive() };
export const storedPurchaseSchema = purchaseSchema.extend(withServerSeq);
export const storedRollSchema = rollSchema.extend(withServerSeq);
export type StoredPurchase = z.output<typeof storedPurchaseSchema>;
export type StoredRoll = z.output<typeof storedRollSchema>;

export const purchaseDetailSchema = z.object({
  purchase: storedPurchaseSchema,
  rolls: z.array(storedRollSchema),
});
export type PurchaseDetail = z.output<typeof purchaseDetailSchema>;
