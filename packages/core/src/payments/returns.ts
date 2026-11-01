import { assertInteger, mulDivRoundHalfUp } from '../numeric/index.js';

/**
 * Returns (SPEC §4, BUILD_PROMPTS 5.3, docs/accounting-assumptions.md RT1–RT4): a customer gives
 * back part of what a sale line sold. Everything a return changes is a proportion of the line,
 * taken on the CUMULATIVE length returned so far and rounded half up, the whole line exactly:
 * returns in any order or number add up to the line, with no drift.
 */

/** A sale line as returns see it. */
export interface ReturnableLine {
  soldCm: number;
  lineTotalCents: number;
}

/**
 * The part of `amountCents` (a line's total, or its cost) that belongs to the first `returnedCm`
 * of the `soldCm` the line sold: round(amount × returned ÷ sold) half up; the whole line gives
 * the whole amount, so the last return takes the exact remainder (like the last sale off a roll).
 */
export function shareOfLineCents(amountCents: number, soldCm: number, returnedCm: number): number {
  assertInteger(amountCents, 'amountCents', 0);
  assertInteger(soldCm, 'soldCm', 1);
  assertInteger(returnedCm, 'returnedCm', 0);
  if (returnedCm > soldCm) {
    throw new RangeError(`returned ${String(returnedCm)} cm of a ${String(soldCm)} cm line`);
  }
  if (returnedCm === soldCm) return amountCents;
  return mulDivRoundHalfUp(amountCents, returnedCm, soldCm);
}

/** A line of an invoice and how much of it has been given back. */
export interface InvoiceLine extends ReturnableLine {
  returnedCm: number;
}

/**
 * What an invoice is worth after returns (RT2): the lines kept at their price, less the invoice
 * discount in proportion to what is kept (nothing kept, no discount left). Without returns it is
 * the invoice total (lines − discount); it never rises as more is returned.
 */
export function saleTotalAfterReturns(sale: {
  lines: readonly InvoiceLine[];
  discountCents: number;
}): number {
  assertInteger(sale.discountCents, 'discountCents', 0);
  let linesCents = 0;
  let keptCents = 0;
  for (const line of sale.lines) {
    assertInteger(line.lineTotalCents, 'lineTotalCents', 0);
    linesCents += line.lineTotalCents;
    keptCents +=
      line.lineTotalCents - shareOfLineCents(line.lineTotalCents, line.soldCm, line.returnedCm);
  }
  if (sale.discountCents > linesCents) {
    throw new RangeError(
      `discount (${String(sale.discountCents)}) exceeds the lines total (${String(linesCents)})`,
    );
  }
  const keptDiscount =
    linesCents === 0 || keptCents === linesCents
      ? sale.discountCents
      : mulDivRoundHalfUp(sale.discountCents, keptCents, linesCents);
  return keptCents - keptDiscount;
}

/**
 * The credit a return gives the customer (RT2): what the invoice was worth before it less what it
 * is worth after it. `returningCm` is what each line gives back now, on top of `returnedCm`.
 */
export function returnCreditCents(sale: {
  lines: readonly (InvoiceLine & { returningCm: number })[];
  discountCents: number;
}): number {
  const before = saleTotalAfterReturns(sale);
  const after = saleTotalAfterReturns({
    discountCents: sale.discountCents,
    lines: sale.lines.map((line) => ({
      ...line,
      returnedCm: line.returnedCm + line.returningCm,
    })),
  });
  return before - after;
}

/**
 * What the customer has paid beyond an invoice's worth after returns (RT3): the part of the credit
 * that is not a debt reduced but money owed back. `refundedCents` is what earlier returns of the
 * invoice already handed back in cash.
 */
export function overpaymentCents(
  totalAfterReturnsCents: number,
  paidCents: number,
  refundedCents = 0,
): number {
  assertInteger(totalAfterReturnsCents, 'totalAfterReturnsCents', 0);
  assertInteger(paidCents, 'paidCents', 0);
  assertInteger(refundedCents, 'refundedCents', 0);
  return Math.max(0, paidCents - totalAfterReturnsCents - refundedCents);
}
