import {
  costBasisLength,
  type EstCmPerKgPolicy,
  measuredCmPerKg,
  measuredTotalLength,
  nextEstCmPerKg,
  type RollLedger,
  rollLedger,
} from '@fabric/core';
import { z } from 'zod';
import { idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import type { ValidationIssue } from './errors.js';
import { syncOrder } from './order.js';
import { type Roll, type StockMove, stockMoveSchema, storedRollSchema } from './purchasing.js';

const reasonSchema = z.string().trim().min(1).max(500);

/** What the user enters for the stock actions on a roll (BUILD_PROMPTS 3.3). */
export const newStockMoveSchema = z.discriminatedUnion('type', [
  /** Damaged or wasted cloth (SPEC §8.3): a loss of the period, at cost (T12). */
  z.object({
    type: z.literal('loss'),
    rollId: idSchema,
    date: isoDateSchema,
    lengthCm: z.int().min(1),
    reason: reasonSchema,
  }),
  /** Stocktake: the length actually counted on the roll; the difference is recorded. */
  z.object({
    type: z.literal('adjustment'),
    rollId: idSchema,
    date: isoDateSchema,
    countedCm: z.int().min(0),
    reason: reasonSchema,
  }),
  /** A measurement (kg rolls, SPEC §2.3, T4): the length on the roll now. */
  z.object({
    type: z.literal('length_correction'),
    rollId: idSchema,
    date: isoDateSchema,
    measuredRemainingCm: z.int().min(0),
    note: optionalTextSchema(500).default(null),
  }),
]);
export type NewStockMove = z.output<typeof newStockMoveSchema>;
export type NewStockMoveInput = z.input<typeof newStockMoveSchema>;

export const INVENTORY_ISSUES = {
  noChange: 'stock_move_changes_nothing',
  notPushable: 'stock_move_type_not_pushable',
  wrongRoll: 'stock_move_wrong_roll',
  reasonRequired: 'stock_move_reason_required',
  invalidLength: 'stock_move_invalid_length',
  rollFieldsFixed: 'roll_fields_are_fixed',
} as const;

/**
 * A move as stored: with its server_seq once the server has it (history order, syncOrder), and
 * the cost a settlement froze for it (withLockedCosts, P9).
 */
export type SequencedMove = StockMove & { serverSeq?: number | null; lockedCostCents?: number };

/** The roll's costs, lengths and state from its moves (@fabric/core rollLedger). */
export function rollLedgerOf(roll: Roll, moves: readonly SequencedMove[]): RollLedger {
  return rollLedger(
    {
      costTotalCents: roll.costTotalCents,
      lengthCmInitial: roll.lengthCmInitial,
      lengthEstimated: roll.lengthEstimated,
    },
    [...moves].sort(syncOrder).map((move) => ({
      id: move.id,
      type: move.type,
      deltaCm: move.deltaCm,
      reverses: move.type === 'reversal' ? move.refId : null,
      lockedCostCents: move.lockedCostCents,
    })),
  );
}

/** The stock_move a stock action records; an issue when it would change nothing or is impossible. */
export function buildStockMove(
  input: NewStockMove,
  ledger: Pick<RollLedger, 'basisLengthCm' | 'remainingCm'>,
  meta: { id: string; deviceId: string; now: string },
): { ok: true; move: StockMove } | { ok: false; issues: ValidationIssue[] } {
  const issue = (path: string, message: string) => ({
    ok: false as const,
    issues: [{ path: [path], message, code: 'custom' }],
  });
  let deltaCm: number;
  let note: string | null;
  switch (input.type) {
    case 'loss':
      deltaCm = -input.lengthCm;
      note = input.reason;
      break;
    case 'adjustment':
      deltaCm = input.countedCm - ledger.remainingCm;
      note = input.reason;
      if (deltaCm === 0) return issue('countedCm', INVENTORY_ISSUES.noChange);
      break;
    case 'length_correction': {
      let total: number;
      try {
        total = measuredTotalLength(ledger, input.measuredRemainingCm);
      } catch {
        return issue('measuredRemainingCm', INVENTORY_ISSUES.invalidLength);
      }
      deltaCm = total - ledger.basisLengthCm;
      note = input.note;
      if (deltaCm === 0) return issue('measuredRemainingCm', INVENTORY_ISSUES.noChange);
      break;
    }
  }
  return {
    ok: true,
    move: {
      id: meta.id,
      createdAt: meta.now,
      updatedAt: meta.now,
      deviceId: meta.deviceId,
      voidedAt: null,
      rollId: input.rollId,
      type: input.type,
      deltaCm,
      refId: null,
      date: input.date,
      note,
    },
  };
}

const PUSHABLE: ReadonlySet<StockMove['type']> = new Set([
  'loss',
  'adjustment',
  'length_correction',
]);

/**
 * Re-checks a pushed stock move against its roll (the server's own check). Purchase and sale
 * moves come inside their purchase or sale, never alone.
 */
export function checkStockMove(
  move: StockMove,
  roll: Roll,
  history: readonly StockMove[],
): ValidationIssue[] {
  const issue = (path: string, message: string): ValidationIssue[] => [
    { path: [path], message, code: 'custom' },
  ];
  if (!PUSHABLE.has(move.type) || move.refId !== null)
    return issue('type', INVENTORY_ISSUES.notPushable);
  if (move.rollId !== roll.id) return issue('rollId', INVENTORY_ISSUES.wrongRoll);
  if (move.type === 'loss' && move.deltaCm >= 0)
    return issue('deltaCm', INVENTORY_ISSUES.invalidLength);
  if (move.type !== 'length_correction' && move.note === null)
    return issue('note', INVENTORY_ISSUES.reasonRequired);
  if (move.deltaCm === 0) return issue('deltaCm', INVENTORY_ISSUES.noChange);
  try {
    costBasisLength(roll.lengthCmInitial, [...history, move]);
  } catch {
    return issue('deltaCm', INVENTORY_ISSUES.invalidLength);
  }
  return [];
}

/** A roll's own fields never change after its purchase; only the remnant mark does. */
export function checkRollUpdate(current: Roll, next: Roll): ValidationIssue[] {
  for (const key of [
    'shortCode',
    'variantId',
    'purchaseId',
    'lengthCmInitial',
    'costTotalCents',
    'lengthEstimated',
    'createdAt',
  ] as const) {
    if (current[key] !== next[key])
      return [{ path: [key], message: INVENTORY_ISSUES.rollFieldsFixed, code: 'custom' }];
  }
  if (next.status !== 'active' && next.status !== 'remnant') {
    return [{ path: ['status'], message: INVENTORY_ISSUES.rollFieldsFixed, code: 'custom' }];
  }
  return [];
}

/**
 * The fabric's est_cm_per_kg after measuring one of its kg rolls (SPEC §2.3, C11): the first
 * measurement replaces the initial guess; then the setting's policy (average or last).
 */
export function nextFabricEstimate(args: {
  policy: EstCmPerKgPolicy;
  current: number | null;
  measurementsSoFar: number;
  measuredTotalCm: number;
  weightG: number;
}): number {
  const measured = measuredCmPerKg(args.measuredTotalCm, args.weightG);
  if (args.current === null) return measured;
  return nextEstCmPerKg({
    policy: args.policy,
    current: args.current,
    measurementsSoFar: args.measurementsSoFar,
    measured,
  });
}

export const storedStockMoveSchema = stockMoveSchema.extend({ serverSeq: z.int().positive() });

export const rollLedgerSchema = z.object({
  basisLengthCm: z.int(),
  remainingCm: z.int(),
  lengthEstimated: z.boolean(),
  costPerMeterCents: z.int(),
  unallocatedCostCents: z.int(),
  oversoldCm: z.int(),
  costs: z.array(z.object({ id: idSchema, costCents: z.int() })),
});

/** GET /rolls/:id: the roll, its history and what core derives from it. */
export const rollDetailSchema = z.object({
  roll: storedRollSchema,
  moves: z.array(storedStockMoveSchema),
  ledger: rollLedgerSchema,
});
export type RollDetail = z.output<typeof rollDetailSchema>;
