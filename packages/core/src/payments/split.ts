import { assertInteger } from '../numeric/index.js';

/** What payment allocation needs to know about an invoice. */
export interface SaleAmounts {
  /** sale.total_cents: lines minus discount. */
  totalCents: number;
  /** capital_part: Σ line costs (SPEC §8.2). */
  capitalCents: number;
}

export interface SaleSplit extends SaleAmounts {
  linesTotalCents: number;
  discountCents: number;
  /** profit_part = total − capital (SPEC §7, §8.2); negative when sold under cost. */
  profitCents: number;
  /** min(capital, total): the capital payments can recover. */
  collectibleCapitalCents: number;
  /** max(0, profit): the profit payments can make recognisable. */
  recognizableProfitCents: number;
  /**
   * max(0, capital − total): the "negative part" of a below-cost sale (SPEC §8.1), a loss
   * of the period in which the sale is made. Measured per invoice: a below-cost line inside
   * a profitable invoice only lowers that invoice's profit.
   */
  lossCents: number;
  /** total < capital: the API requires an explicit confirmation (SPEC §3). */
  belowCost: boolean;
}

/**
 * Splits an invoice into capital and profit (SPEC §7, §8.2, T5). The discount (if any)
 * reduces the invoice total, so it comes out of the profit part.
 */
export function splitSaleCapitalProfit(sale: {
  lines: readonly { lineTotalCents: number; lineCostCents: number }[];
  discountCents?: number;
}): SaleSplit {
  const discountCents = sale.discountCents ?? 0;
  assertInteger(discountCents, 'discountCents', 0);
  let linesTotalCents = 0;
  let capitalCents = 0;
  for (const line of sale.lines) {
    assertInteger(line.lineTotalCents, 'lineTotalCents', 0);
    assertInteger(line.lineCostCents, 'lineCostCents', 0);
    linesTotalCents += line.lineTotalCents;
    capitalCents += line.lineCostCents;
  }
  if (discountCents > linesTotalCents) {
    throw new RangeError(
      `discount (${String(discountCents)}) exceeds the lines total (${String(linesTotalCents)})`,
    );
  }
  const totalCents = linesTotalCents - discountCents;
  const profitCents = totalCents - capitalCents;
  return {
    linesTotalCents,
    discountCents,
    totalCents,
    capitalCents,
    profitCents,
    collectibleCapitalCents: Math.min(capitalCents, totalCents),
    recognizableProfitCents: Math.max(0, profitCents),
    lossCents: Math.max(0, -profitCents),
    belowCost: profitCents < 0,
  };
}
