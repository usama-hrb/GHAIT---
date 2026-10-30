import {
  amountDueCents,
  computeSaleLine,
  paymentParts,
  type RollLedger,
  type SaleLine as PricedLine,
  type SaleSplit,
  splitSaleCapitalProfit,
} from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import {
  type Payment,
  type PaymentAllocation,
  paymentAllocationSchema,
  paymentSchema,
  writeOffSchema,
} from './customers.js';
import { firstDifference } from './diff.js';
import type { ValidationIssue } from './errors.js';
import { syncOrder } from './order.js';
import { rollLedgerOf, type SequencedMove } from './inventory.js';
import { type Roll, type StockMove, stockMoveSchema } from './purchasing.js';

/** Lines on one invoice: far more than a shop counter needs, small enough for one op. */
export const SALE_MAX_LINES = 50;

/** SPEC §13 `sale`. What was paid is derived from its payment allocations (SPEC §4.1). */
export const saleSchema = recordBaseSchema.extend({
  date: isoDateSchema,
  customerId: idSchema.nullable(),
  /** Σ line totals − discount. */
  totalCents: amountCentsSchema,
  discountCents: amountCentsSchema,
  /** Credit sales: when the rest is due (optional). */
  dueDate: isoDateSchema.nullable(),
  /** The seller confirmed selling under cost (SPEC §3); the server refuses such a sale without it. */
  confirmedBelowCost: z.boolean(),
  note: optionalTextSchema(500),
});
export type Sale = z.output<typeof saleSchema>;

/**
 * SPEC §13 `sale_line`: one roll each, append-only. Its cost is not stored: it is the roll
 * ledger's cost of the line's stock move, derived like a loss's (docs/accounting-assumptions.md P9).
 */
export const saleLineSchema = recordBaseSchema.extend({
  saleId: idSchema,
  rollId: idSchema,
  soldCm: z.int().min(1),
  /** The fabric's prices at the time, kept for negotiation analysis (SPEC §3). */
  refPricePerMeterCents: amountCentsSchema,
  minPricePerMeterCents: amountCentsSchema,
  /** For a whole piece: the piece price per metre, rounded (display and analysis only). */
  actualPricePerMeterCents: amountCentsSchema,
  /** Sold as the whole, untouched ready piece at its piece price (SPEC §2.3, P5). */
  wholePiece: z.boolean(),
  lineTotalCents: amountCentsSchema,
});
export type SaleLine = z.output<typeof saleLineSchema>;

/** A sale's cancellation (P13): append-only, with its reason. The sale gets voidedAt. */
export const saleVoidSchema = recordBaseSchema.extend({
  saleId: idSchema,
  date: isoDateSchema,
  reason: z.string().trim().min(1).max(500),
  /** The refund of what had been paid on the sale; null when nothing was. */
  refundId: idSchema.nullable(),
});
export type SaleVoid = z.output<typeof saleVoidSchema>;

/** One sale op: the sale, its lines and their stock moves, and what was paid there and then. */
export const saleAggregateSchema = z.object({
  sale: saleSchema,
  lines: z.array(saleLineSchema).min(1).max(SALE_MAX_LINES),
  moves: z.array(stockMoveSchema).min(1).max(SALE_MAX_LINES),
  payment: paymentSchema.nullable(),
  allocation: paymentAllocationSchema.nullable(),
});
export type SaleAggregate = z.output<typeof saleAggregateSchema>;

/** One void op: the cancellation, a reversal per line, and the refund. */
export const saleVoidAggregateSchema = z.object({
  saleVoid: saleVoidSchema,
  reversals: z.array(stockMoveSchema).min(1).max(SALE_MAX_LINES),
  refund: paymentSchema.nullable(),
});
export type SaleVoidAggregate = z.output<typeof saleVoidAggregateSchema>;

const linePriceSchema = z.union([
  z.object({ perMeterCents: amountCentsSchema }).strict(),
  z.object({ wholePieceCents: amountCentsSchema }).strict(),
]);

/** A line as the POS fills it in: one roll, a length, a price (SPEC §3, §4). */
export const newSaleLineSchema = z.object({
  rollId: idSchema,
  soldCm: z.int().min(1),
  price: linePriceSchema,
  refPricePerMeterCents: amountCentsSchema,
  minPricePerMeterCents: amountCentsSchema,
});

/** What the user enters on the POS screen. */
export const newSaleSchema = z.object({
  date: isoDateSchema,
  customerId: idSchema.nullable().default(null),
  lines: z.array(newSaleLineSchema).min(1).max(SALE_MAX_LINES),
  discountCents: amountCentsSchema.default(0),
  /** Paid now, in cash (P12). Less than the total: the rest is a credit to the customer. */
  paidCents: amountCentsSchema,
  dueDate: isoDateSchema.nullable().default(null),
  confirmedBelowCost: z.boolean().default(false),
  note: optionalTextSchema(500).default(null),
});
export type NewSale = z.output<typeof newSaleSchema>;
export type NewSaleInput = z.input<typeof newSaleSchema>;

export const SALE_ISSUES = {
  unknownRoll: 'sale_unknown_roll',
  wholePieceTouched: 'sale_whole_piece_not_untouched',
  discountAboveTotal: 'sale_discount_above_total',
  paidAboveTotal: 'sale_paid_above_total',
  creditNeedsCustomer: 'sale_credit_needs_customer',
  dueDateWithoutCredit: 'sale_due_date_without_credit',
  dueDateBeforeSale: 'sale_due_date_before_sale',
  belowCostUnconfirmed: 'sale_below_cost_unconfirmed',
  inconsistent: 'sale_records_inconsistent',
  notCore: 'sale_does_not_match_core',
  alreadyVoided: 'sale_already_voided',
} as const;

/** A roll and every move it has so far: what pricing and costing need to know about it. */
export interface RollHistory {
  roll: Roll;
  /** With their server_seq where known: history order (syncOrder). */
  moves: readonly SequencedMove[];
}

export interface PricedSale {
  /** One per input line, in order (missing for a roll that is not known). */
  lines: (PricedLine & { rollId: string })[];
  /** Null while a line or the discount is invalid. */
  split: SaleSplit | null;
  /** A line or the invoice is under cost: it needs an explicit confirmation (SPEC §3, P2). */
  requiresConfirmation: boolean;
  issues: ValidationIssue[];
}

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

/**
 * Prices a sale on the rolls as they stand (SPEC §3, §4, T5, T11): each line with @fabric/core
 * computeSaleLine, costed after the lines before it on the same roll; the invoice with
 * splitSaleCapitalProfit. The POS shows it live; buildSaleAggregate and the server's check use it.
 */
export function priceSale(input: NewSale, histories: ReadonlyMap<string, RollHistory>): PricedSale {
  const issues: ValidationIssue[] = [];
  const state = new Map<
    string,
    { roll: Roll; ledger: RollLedger; remainingCm: number; costs: number[] }
  >();
  const lines: PricedSale['lines'] = [];
  input.lines.forEach((line, index) => {
    let rollState = state.get(line.rollId);
    if (!rollState) {
      const history = histories.get(line.rollId);
      if (!history) {
        issues.push(issue(['lines', index, 'rollId'], SALE_ISSUES.unknownRoll));
        return;
      }
      const ledger = rollLedgerOf(history.roll, history.moves);
      rollState = {
        roll: history.roll,
        ledger,
        remainingCm: ledger.remainingCm,
        costs: ledger.costs.map((cost) => cost.costCents),
      };
      state.set(line.rollId, rollState);
    }
    let priced: PricedLine;
    try {
      priced = computeSaleLine({
        roll: {
          costTotalCents: rollState.roll.costTotalCents,
          basisLengthCm: rollState.ledger.basisLengthCm,
          remainingCm: rollState.remainingCm,
          lengthEstimated: rollState.ledger.lengthEstimated,
        },
        soldCm: line.soldCm,
        price: line.price,
        refPricePerMeterCents: line.refPricePerMeterCents,
        minPricePerMeterCents: line.minPricePerMeterCents,
        previousCostsCents: rollState.costs,
      });
    } catch {
      issues.push(issue(['lines', index, 'price'], SALE_ISSUES.wholePieceTouched));
      return;
    }
    rollState.remainingCm -= line.soldCm;
    rollState.costs.push(priced.lineCostCents);
    lines.push({ ...priced, rollId: line.rollId });
  });

  let split: SaleSplit | null = null;
  if (issues.length === 0) {
    try {
      split = splitSaleCapitalProfit({ lines, discountCents: input.discountCents });
    } catch {
      issues.push(issue(['discountCents'], SALE_ISSUES.discountAboveTotal));
    }
  }
  if (split) {
    if (input.paidCents > split.totalCents) {
      issues.push(issue(['paidCents'], SALE_ISSUES.paidAboveTotal));
    } else if (input.paidCents < split.totalCents && input.customerId === null) {
      issues.push(issue(['customerId'], SALE_ISSUES.creditNeedsCustomer));
    }
    if (input.dueDate !== null && input.paidCents >= split.totalCents) {
      issues.push(issue(['dueDate'], SALE_ISSUES.dueDateWithoutCredit));
    }
  }
  if (input.dueDate !== null && input.dueDate < input.date) {
    issues.push(issue(['dueDate'], SALE_ISSUES.dueDateBeforeSale));
  }
  return {
    lines,
    split,
    requiresConfirmation:
      lines.some((line) => line.requiresConfirmation) || split?.belowCost === true,
    issues,
  };
}

export interface SaleIds {
  saleId: string;
  lineIds: readonly string[];
  moveIds: readonly string[];
  /** Needed when something is paid now. */
  paymentId: string | null;
  allocationId: string | null;
}

/**
 * The records a sale creates (SPEC §4): the sale, a line and a `sale` stock move per roll, and
 * the cash paid now as a payment applied to the sale. The device builds them to save offline;
 * the server rebuilds them on its own view of the rolls (checkSaleAggregate).
 */
export function buildSaleAggregate(
  input: NewSale,
  histories: ReadonlyMap<string, RollHistory>,
  ids: SaleIds,
  meta: { deviceId: string; now: string },
):
  | { ok: true; aggregate: SaleAggregate; priced: PricedSale }
  | { ok: false; issues: ValidationIssue[] } {
  const priced = priceSale(input, histories);
  const issues = [...priced.issues];
  if (issues.length === 0 && priced.requiresConfirmation && !input.confirmedBelowCost) {
    issues.push(issue(['confirmedBelowCost'], SALE_ISSUES.belowCostUnconfirmed));
  }
  if (issues.length > 0 || !priced.split) return { ok: false, issues };
  const count = input.lines.length;
  if (
    ids.lineIds.length !== count ||
    ids.moveIds.length !== count ||
    (input.paidCents > 0 && (ids.paymentId === null || ids.allocationId === null))
  ) {
    throw new RangeError(
      `a sale of ${String(count)} lines needs ${String(count)} line and move ids`,
    );
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const sale: Sale = {
    ...base,
    id: ids.saleId,
    date: input.date,
    customerId: input.customerId,
    totalCents: priced.split.totalCents,
    discountCents: input.discountCents,
    dueDate: input.dueDate,
    confirmedBelowCost: input.confirmedBelowCost,
    note: input.note,
  };
  const lines: SaleLine[] = input.lines.map((line, index) => {
    const pricedLine = priced.lines[index];
    if (!pricedLine) throw new RangeError('a line was not priced');
    return {
      ...base,
      id: ids.lineIds[index] ?? '',
      saleId: sale.id,
      rollId: line.rollId,
      soldCm: line.soldCm,
      refPricePerMeterCents: line.refPricePerMeterCents,
      minPricePerMeterCents: line.minPricePerMeterCents,
      actualPricePerMeterCents: pricedLine.actualPricePerMeterCents,
      wholePiece: 'wholePieceCents' in line.price,
      lineTotalCents: pricedLine.lineTotalCents,
    };
  });
  const moves: StockMove[] = lines.map((line, index) => ({
    ...base,
    id: ids.moveIds[index] ?? '',
    rollId: line.rollId,
    type: 'sale',
    deltaCm: -line.soldCm,
    refId: line.id,
    date: input.date,
    note: null,
  }));
  let payment: Payment | null = null;
  let allocation: PaymentAllocation | null = null;
  if (input.paidCents > 0) {
    payment = {
      ...base,
      id: ids.paymentId ?? '',
      customerId: input.customerId,
      kind: 'payment',
      amountCents: input.paidCents,
      date: input.date,
      method: 'cash',
      note: null,
    };
    allocation = {
      ...base,
      id: ids.allocationId ?? '',
      paymentId: payment.id,
      saleId: sale.id,
      amountCents: input.paidCents,
      date: input.date,
    };
  }
  return { ok: true, aggregate: { sale, lines, moves, payment, allocation }, priced };
}

/** The sale as typed, read back from its records. */
function inputOf({ sale, lines, payment }: SaleAggregate): NewSale {
  return {
    date: sale.date,
    customerId: sale.customerId,
    lines: lines.map((line) => ({
      rollId: line.rollId,
      soldCm: line.soldCm,
      price: line.wholePiece
        ? { wholePieceCents: line.lineTotalCents }
        : { perMeterCents: line.actualPricePerMeterCents },
      refPricePerMeterCents: line.refPricePerMeterCents,
      minPricePerMeterCents: line.minPricePerMeterCents,
    })),
    discountCents: sale.discountCents,
    paidCents: payment?.amountCents ?? 0,
    dueDate: sale.dueDate,
    confirmedBelowCost: sale.confirmedBelowCost,
    note: sale.note,
  };
}

/**
 * Re-checks a pushed sale (BUILD_PROMPTS 3.4): its lines, totals, moves and payment must be what
 * buildSaleAggregate gives for what was typed, priced on the server's view of the rolls. An
 * unconfirmed sale under cost is refused (SPEC §3). Empty when it is consistent.
 */
export function checkSaleAggregate(
  aggregate: SaleAggregate,
  histories: ReadonlyMap<string, RollHistory>,
): ValidationIssue[] {
  if (aggregate.lines.length !== aggregate.moves.length) {
    return [issue(['moves'], SALE_ISSUES.inconsistent)];
  }
  const built = buildSaleAggregate(
    inputOf(aggregate),
    histories,
    {
      saleId: aggregate.sale.id,
      lineIds: aggregate.lines.map((line) => line.id),
      moveIds: aggregate.moves.map((move) => move.id),
      paymentId: aggregate.payment?.id ?? '',
      allocationId: aggregate.allocation?.id ?? '',
    },
    { deviceId: aggregate.sale.deviceId, now: aggregate.sale.createdAt },
  );
  if (!built.ok) return built.issues;
  const path = firstDifference(built.aggregate, aggregate);
  return path ? [issue(path, SALE_ISSUES.notCore)] : [];
}

/** What voiding a sale needs to know about it. */
export interface SaleRecords {
  sale: Sale;
  /** Its `sale` stock moves. */
  moves: readonly StockMove[];
  /** The payments applied to it. */
  allocations: readonly PaymentAllocation[];
}

/**
 * Cancels a sale (BUILD_PROMPTS 3.4, P13): a `reversal` per line puts its length back (the roll
 * is then costed as if the line had never been made), and what was paid on the sale is refunded.
 * Reversals follow the sale's moves in id order; `ids.reversalIds` must match that order.
 */
export function buildSaleVoid(
  input: { reason: string; date: string },
  records: SaleRecords,
  ids: { voidId: string; reversalIds: readonly string[]; refundId: string | null },
  meta: { deviceId: string; now: string },
): SaleVoidAggregate {
  const moves = [...records.moves].sort((a, b) => a.id.localeCompare(b.id));
  if (ids.reversalIds.length !== moves.length) {
    throw new RangeError(`a sale of ${String(moves.length)} moves needs as many reversal ids`);
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const paidCents = records.allocations.reduce(
    (sum, allocation) => sum + allocation.amountCents,
    0,
  );
  const refund: Payment | null =
    paidCents > 0
      ? {
          ...base,
          id: ids.refundId ?? '',
          customerId: records.sale.customerId,
          kind: 'refund',
          amountCents: paidCents,
          date: input.date,
          method: 'cash',
          note: null,
        }
      : null;
  return {
    saleVoid: {
      ...base,
      id: ids.voidId,
      saleId: records.sale.id,
      date: input.date,
      reason: input.reason,
      refundId: refund?.id ?? null,
    },
    reversals: moves.map((move, index) => ({
      ...base,
      id: ids.reversalIds[index] ?? '',
      rollId: move.rollId,
      type: 'reversal',
      deltaCm: -move.deltaCm,
      refId: move.id,
      date: input.date,
      note: input.reason,
    })),
    refund,
  };
}

/** Re-checks a pushed void against the sale as the server has it. */
export function checkSaleVoid(
  aggregate: SaleVoidAggregate,
  records: SaleRecords,
): ValidationIssue[] {
  if (records.sale.voidedAt !== null)
    return [issue(['saleVoid', 'saleId'], SALE_ISSUES.alreadyVoided)];
  const reversalOf = new Map(aggregate.reversals.map((move) => [move.refId, move.id]));
  const sorted = [...records.moves].sort((a, b) => a.id.localeCompare(b.id));
  const expected = buildSaleVoid(
    { reason: aggregate.saleVoid.reason, date: aggregate.saleVoid.date },
    records,
    {
      voidId: aggregate.saleVoid.id,
      reversalIds: sorted.map((move) => reversalOf.get(move.id) ?? ''),
      refundId: aggregate.refund?.id ?? '',
    },
    { deviceId: aggregate.saleVoid.deviceId, now: aggregate.saleVoid.createdAt },
  );
  const actual = {
    ...aggregate,
    reversals: [...aggregate.reversals].sort((a, b) =>
      (a.refId ?? '').localeCompare(b.refId ?? ''),
    ),
  };
  const path = firstDifference(expected, actual);
  return path ? [issue(path, SALE_ISSUES.inconsistent)] : [];
}

export const saleFiguresSchema = z.object({
  lines: z.array(
    z.object({
      lineId: idSchema,
      /** Null on a voided sale. */
      costCents: z.int().nullable(),
      profitCents: z.int().nullable(),
      /** The roll's length is still an estimate: the profit may change (SPEC §2.3). */
      provisional: z.boolean(),
    }),
  ),
  linesTotalCents: z.int(),
  discountCents: z.int(),
  totalCents: z.int(),
  /** Null on a voided sale. */
  capitalCents: z.int().nullable(),
  profitCents: z.int().nullable(),
  paidCents: z.int(),
  /** Still owed (0 on a voided sale); negative when overpaid. */
  dueCents: z.int(),
  /**
   * Each payment applied to the sale, in order, with the capital it recovered and the profit it
   * recognised (SPEC §8.2, T8), derived from the current capital (P10); null on a voided sale.
   */
  payments: z.array(
    z.object({
      allocationId: idSchema,
      paymentId: idSchema,
      date: isoDateSchema,
      amountCents: z.int(),
      capitalCents: z.int().nullable(),
      profitCents: z.int().nullable(),
    }),
  ),
});
export type SaleFigures = z.output<typeof saleFiguresSchema>;

/**
 * A sale's figures, derived (P9, P10): each line's cost from its roll's ledger, the invoice's
 * capital and profit, and what was paid and is still due.
 */
export function saleFigures(
  sale: Sale,
  lines: readonly SaleLine[],
  moves: readonly StockMove[],
  ledgers: ReadonlyMap<string, RollLedger>,
  allocations: readonly (PaymentAllocation & { serverSeq?: number | null })[],
): SaleFigures {
  const voided = sale.voidedAt !== null;
  const moveOfLine = new Map(moves.map((move) => [move.refId, move.id]));
  const figures = lines.map((line) => {
    const ledger = ledgers.get(line.rollId);
    const moveId = moveOfLine.get(line.id);
    const cost = voided ? undefined : ledger?.costs.find((entry) => entry.id === moveId);
    return {
      lineId: line.id,
      costCents: cost?.costCents ?? null,
      profitCents: cost ? line.lineTotalCents - cost.costCents : null,
      provisional: ledger?.lengthEstimated ?? false,
    };
  });
  const linesTotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const known = figures.every((line) => line.costCents !== null);
  const split = known
    ? splitSaleCapitalProfit({
        lines: lines.map((line, index) => ({
          lineTotalCents: line.lineTotalCents,
          lineCostCents: figures[index]?.costCents ?? 0,
        })),
        discountCents: sale.discountCents,
      })
    : null;
  const ordered = [...allocations].sort(syncOrder);
  const paid = ordered.map((allocation) => allocation.amountCents);
  const parts = split ? paymentParts(split, paid) : null;
  return {
    lines: figures,
    linesTotalCents,
    discountCents: sale.discountCents,
    totalCents: sale.totalCents,
    capitalCents: split?.capitalCents ?? null,
    profitCents: split?.profitCents ?? null,
    paidCents: paid.reduce((sum, amount) => sum + amount, 0),
    dueCents: voided ? 0 : amountDueCents(sale.totalCents, paid),
    payments: ordered.map((allocation, index) => ({
      allocationId: allocation.id,
      paymentId: allocation.paymentId,
      date: allocation.date,
      amountCents: allocation.amountCents,
      capitalCents: parts?.[index]?.capitalRecoveredCents ?? null,
      profitCents: parts?.[index]?.profitRecognizedCents ?? null,
    })),
  };
}

const withServerSeq = { serverSeq: z.int().positive() };
export const storedSaleSchema = saleSchema.extend(withServerSeq);
export type StoredSale = z.output<typeof storedSaleSchema>;

/** GET /sales/:id: the sale, its records and what core derives from them. */
export const saleDetailSchema = z.object({
  sale: storedSaleSchema,
  lines: z.array(saleLineSchema.extend(withServerSeq)),
  allocations: z.array(paymentAllocationSchema.extend(withServerSeq)),
  saleVoid: saleVoidSchema.extend(withServerSeq).nullable(),
  writeOff: writeOffSchema.extend(withServerSeq).nullable(),
  figures: saleFiguresSchema,
});
export type SaleDetail = z.output<typeof saleDetailSchema>;
