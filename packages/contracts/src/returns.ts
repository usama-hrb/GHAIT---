import { overpaymentCents, returnCreditCents } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, SALE_MAX_LINES } from './common.js';
import type { Payment, PaymentAllocation } from './customers.js';
import { paymentSchema } from './customers.js';
import { firstDifference } from './diff.js';
import type { ValidationIssue } from './errors.js';
import { type StockMove, stockMoveSchema } from './purchasing.js';

const reasonSchema = z.string().trim().min(1).max(500);

/** One line of a return: how much of a sale line came back, and the stock move that restores it. */
export const returnLineSchema = z.object({
  lineId: idSchema,
  /** The `return` stock_move this line creates (it puts the length back on the roll, RT1). */
  moveId: idSchema,
  returnedCm: z.int().min(1),
});
export type ReturnLine = z.output<typeof returnLineSchema>;

/**
 * SPEC §13 `sale_return`: goods a customer gave back from one sale, append-only (RT1). The sale
 * and its lines are never edited: the invoice's worth after returns is its total less the
 * credits of its live returns. Its length goes back on the rolls through `return` stock moves,
 * and the cash handed back now is a `refund` payment.
 */
export const saleReturnSchema = recordBaseSchema.extend({
  saleId: idSchema,
  date: isoDateSchema,
  reason: reasonSchema,
  lines: z.array(returnLineSchema).min(1).max(SALE_MAX_LINES),
  /** What the invoice is lowered by: the returned goods' proportional price (RT2). */
  creditCents: amountCentsSchema,
  /** The refund payment of cash handed back now (RT3); null when none. */
  refundId: idSchema.nullable(),
});
export type SaleReturn = z.output<typeof saleReturnSchema>;

/** One return op: the return, a `return` move per line, and the refund. */
export const saleReturnAggregateSchema = z.object({
  saleReturn: saleReturnSchema,
  moves: z.array(stockMoveSchema).min(1).max(SALE_MAX_LINES),
  refund: paymentSchema.nullable(),
});
export type SaleReturnAggregate = z.output<typeof saleReturnAggregateSchema>;

/** What the user enters on the return screen. */
export const newSaleReturnSchema = z.object({
  saleId: idSchema,
  date: isoDateSchema,
  reason: reasonSchema,
  lines: z
    .array(z.object({ lineId: idSchema, returnedCm: z.int().min(1) }))
    .min(1)
    .max(SALE_MAX_LINES),
  /** Cash handed back now; the rest of the overpayment stays as the customer's credit (RT3). */
  refundCents: amountCentsSchema.default(0),
});
export type NewSaleReturn = z.output<typeof newSaleReturnSchema>;
export type NewSaleReturnInput = z.input<typeof newSaleReturnSchema>;

export const RETURN_ISSUES = {
  saleVoided: 'return_sale_voided',
  writtenOff: 'return_sale_written_off',
  beforeSale: 'return_before_sale',
  unknownLine: 'return_unknown_line',
  duplicateLine: 'return_duplicate_line',
  aboveSold: 'return_above_sold',
  refundAboveOverpayment: 'return_refund_above_overpayment',
  refundRequired: 'return_refund_required',
  inconsistent: 'return_records_inconsistent',
  notCore: 'return_does_not_match_core',
} as const;

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/** What each sale line has had returned, by line id (voided returns left out). */
export function returnedCmByLine(returns: readonly SaleReturn[]): Map<string, number> {
  const returned = new Map<string, number>();
  for (const given of live(returns)) {
    for (const line of given.lines) {
      returned.set(line.lineId, (returned.get(line.lineId) ?? 0) + line.returnedCm);
    }
  }
  return returned;
}

/** What a sale's live returns have credited so far. */
export function returnedCreditCents(returns: readonly SaleReturn[]): number {
  return live(returns).reduce((total, given) => total + given.creditCents, 0);
}

/** The part of a sale a return reads (a Sale satisfies it; this file does not import sales.ts). */
export interface ReturnableSale {
  id: string;
  date: string;
  customerId: string | null;
  totalCents: number;
  discountCents: number;
  voidedAt: string | null;
}

/** The part of a sale line a return reads (a SaleLine satisfies it). */
export interface ReturnableSaleLine {
  id: string;
  rollId: string;
  soldCm: number;
  lineTotalCents: number;
}

/** Everything a return of one sale is priced and checked against. */
export interface SaleReturnRecords {
  sale: ReturnableSale;
  lines: readonly ReturnableSaleLine[];
  /** The sale's `sale` stock moves (refId = the line). */
  moves: readonly StockMove[];
  /** This sale's earlier returns (voided ones are ignored). */
  returns: readonly SaleReturn[];
  /** The payments applied to the sale. */
  allocations: readonly PaymentAllocation[];
  /** The refund payments of the earlier returns. */
  refunds: readonly Payment[];
  /** The sale has been written off as a bad debt (refused, RT6). */
  writtenOff: boolean;
}

export interface PricedReturn {
  /** What the invoice is lowered by. */
  creditCents: number;
  /** The invoice once this return is taken off. */
  totalAfterCents: number;
  paidCents: number;
  /** The most that can be handed back in cash now (RT3). */
  maxRefundCents: number;
  issues: ValidationIssue[];
}

/**
 * Prices a return on the sale as it stands (RT1–RT3, @fabric/core returnCreditCents): the credit
 * is the returned goods' proportional price, discount shared; the cash that may be handed back is
 * only what the customer has paid beyond the invoice after the return, less earlier refunds.
 */
export function priceSaleReturn(input: NewSaleReturn, records: SaleReturnRecords): PricedReturn {
  const issues: ValidationIssue[] = [];
  const { sale } = records;
  if (sale.voidedAt !== null) issues.push(issue(['saleId'], RETURN_ISSUES.saleVoided));
  if (records.writtenOff) issues.push(issue(['saleId'], RETURN_ISSUES.writtenOff));
  if (input.date < sale.date) issues.push(issue(['date'], RETURN_ISSUES.beforeSale));

  const before = returnedCmByLine(records.returns);
  const byId = new Map(records.lines.map((line) => [line.id, line]));
  const returning = new Map<string, number>();
  input.lines.forEach((entry, index) => {
    const line = byId.get(entry.lineId);
    if (!line) {
      issues.push(issue(['lines', index, 'lineId'], RETURN_ISSUES.unknownLine));
      return;
    }
    if (returning.has(entry.lineId)) {
      issues.push(issue(['lines', index, 'lineId'], RETURN_ISSUES.duplicateLine));
      return;
    }
    returning.set(entry.lineId, entry.returnedCm);
    if ((before.get(line.id) ?? 0) + entry.returnedCm > line.soldCm) {
      issues.push(issue(['lines', index, 'returnedCm'], RETURN_ISSUES.aboveSold));
    }
  });

  const paidCents = records.allocations.reduce(
    (total, allocation) => total + allocation.amountCents,
    0,
  );
  const priced: PricedReturn = {
    creditCents: 0,
    totalAfterCents: sale.totalCents - returnedCreditCents(records.returns),
    paidCents,
    maxRefundCents: 0,
    issues,
  };
  if (issues.length > 0) return priced;

  const creditCents = returnCreditCents({
    discountCents: sale.discountCents,
    lines: records.lines.map((line) => ({
      soldCm: line.soldCm,
      lineTotalCents: line.lineTotalCents,
      returnedCm: before.get(line.id) ?? 0,
      returningCm: returning.get(line.id) ?? 0,
    })),
  });
  const totalAfterCents = priced.totalAfterCents - creditCents;
  const refundedCents = live(records.refunds).reduce(
    (total, refund) => total + refund.amountCents,
    0,
  );
  const maxRefundCents = overpaymentCents(totalAfterCents, paidCents, refundedCents);
  if (input.refundCents > maxRefundCents) {
    issues.push(issue(['refundCents'], RETURN_ISSUES.refundAboveOverpayment));
  } else if (sale.customerId === null && input.refundCents < maxRefundCents) {
    // A walk-in buyer has no account to keep the credit on (RT3).
    issues.push(issue(['refundCents'], RETURN_ISSUES.refundRequired));
  }
  return { creditCents, totalAfterCents, paidCents, maxRefundCents, issues };
}

export interface SaleReturnIds {
  returnId: string;
  /** One per input line, in order. */
  moveIds: readonly string[];
  /** Needed when cash is handed back. */
  refundId: string | null;
}

/**
 * The records a return creates (RT1): the return, a `return` stock move per line putting the
 * length back on its roll, and the refund of the cash handed back. The device builds them to
 * save offline; the server rebuilds them on its own records (checkSaleReturn).
 */
export function buildSaleReturn(
  input: NewSaleReturn,
  records: SaleReturnRecords,
  ids: SaleReturnIds,
  meta: { deviceId: string; now: string },
):
  | { ok: true; aggregate: SaleReturnAggregate; priced: PricedReturn }
  | { ok: false; issues: ValidationIssue[] } {
  const priced = priceSaleReturn(input, records);
  if (priced.issues.length > 0) return { ok: false, issues: priced.issues };
  if (
    ids.moveIds.length !== input.lines.length ||
    (input.refundCents > 0 && ids.refundId === null)
  ) {
    throw new RangeError(`a return of ${String(input.lines.length)} lines needs as many move ids`);
  }
  const base = {
    createdAt: meta.now,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    voidedAt: null,
  };
  const lines = new Map(records.lines.map((line) => [line.id, line]));
  const saleMoveOf = new Map(
    records.moves.filter((move) => move.type === 'sale').map((move) => [move.refId, move.id]),
  );
  const moves: StockMove[] = input.lines.map((entry, index) => {
    const line = lines.get(entry.lineId);
    const saleMoveId = saleMoveOf.get(entry.lineId);
    if (!line || saleMoveId === undefined)
      throw new RangeError(`line ${entry.lineId} has no sale move`);
    return {
      ...base,
      id: ids.moveIds[index] ?? '',
      rollId: line.rollId,
      type: 'return',
      deltaCm: entry.returnedCm,
      refId: saleMoveId,
      date: input.date,
      note: input.reason,
    };
  });
  const refund: Payment | null =
    input.refundCents > 0
      ? {
          ...base,
          id: ids.refundId ?? '',
          customerId: records.sale.customerId,
          kind: 'refund',
          amountCents: input.refundCents,
          date: input.date,
          method: 'cash',
          note: null,
        }
      : null;
  return {
    ok: true,
    priced,
    aggregate: {
      saleReturn: {
        ...base,
        id: ids.returnId,
        saleId: records.sale.id,
        date: input.date,
        reason: input.reason,
        lines: input.lines.map((entry, index) => ({
          lineId: entry.lineId,
          moveId: ids.moveIds[index] ?? '',
          returnedCm: entry.returnedCm,
        })),
        creditCents: priced.creditCents,
        refundId: refund?.id ?? null,
      },
      moves,
      refund,
    },
  };
}

/**
 * Re-checks a pushed return (the server's own check): its credit, moves and refund must be what
 * buildSaleReturn gives for what was typed, priced on the sale as the server has it.
 */
export function checkSaleReturn(
  aggregate: SaleReturnAggregate,
  records: SaleReturnRecords,
): ValidationIssue[] {
  const { saleReturn, refund } = aggregate;
  if (saleReturn.saleId !== records.sale.id || aggregate.moves.length !== saleReturn.lines.length) {
    return [issue(['saleReturn'], RETURN_ISSUES.inconsistent)];
  }
  if (records.returns.some((given) => given.id === saleReturn.id)) return [];
  const built = buildSaleReturn(
    {
      saleId: saleReturn.saleId,
      date: saleReturn.date,
      reason: saleReturn.reason,
      lines: saleReturn.lines.map((line) => ({ lineId: line.lineId, returnedCm: line.returnedCm })),
      refundCents: refund?.amountCents ?? 0,
    },
    records,
    {
      returnId: saleReturn.id,
      moveIds: saleReturn.lines.map((line) => line.moveId),
      refundId: refund?.id ?? null,
    },
    { deviceId: saleReturn.deviceId, now: saleReturn.createdAt },
  );
  if (!built.ok) return built.issues;
  const path = firstDifference(built.aggregate, aggregate);
  return path ? [issue(path, RETURN_ISSUES.notCore)] : [];
}

const withServerSeq = { serverSeq: z.int().positive() };
export const storedSaleReturnSchema = saleReturnSchema.extend(withServerSeq);
export type StoredSaleReturn = z.output<typeof storedSaleReturnSchema>;
