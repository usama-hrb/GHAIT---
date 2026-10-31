import { unallocatedCostCents } from '../costing/index.js';
import { assertInteger } from '../numeric/index.js';
import { amountDueCents, type SaleAmounts, unrecoveredCapitalCents } from '../payments/index.js';

/** Every amount that went into or out of the till, since the start (SPEC §9 "الصندوق"). */
export interface CashFlows {
  /** Cash sales and customer payments, overpayments included. */
  customerPaymentsCents: number;
  /** Money given back to customers: a voided sale's payments, a credit paid out (P6, P13). */
  customerRefundsCents: number;
  /** capital_move contributions (retained_profit moves no cash). */
  contributionsCents: number;
  /** capital_move withdrawals, as a positive amount. */
  capitalWithdrawalsCents: number;
  purchasesPaidCents: number;
  expensesPaidCents: number;
  drawsCents: number;
  /** Σ cash_adjustment differences (counted − expected), signed: the till now matches the count. */
  cashAdjustmentsCents: number;
}

/**
 * Cash the records say the till holds (SPEC §9): payments in − refunds + contributions −
 * withdrawals − purchases − expenses − draws ± cash adjustments. A physical count is compared with it, and
 * the difference is recorded as a cash_adjustment (cash over/short of its period, I2).
 */
export function cashBalanceCents(flows: CashFlows): number {
  const names: (keyof CashFlows)[] = [
    'customerPaymentsCents',
    'customerRefundsCents',
    'contributionsCents',
    'capitalWithdrawalsCents',
    'purchasesPaidCents',
    'expensesPaidCents',
    'drawsCents',
  ];
  for (const name of names) assertInteger(flows[name], name, 0);
  assertInteger(flows.cashAdjustmentsCents, 'cashAdjustmentsCents');
  return (
    flows.customerPaymentsCents -
    flows.customerRefundsCents +
    flows.contributionsCents -
    flows.capitalWithdrawalsCents -
    flows.purchasesPaidCents -
    flows.expensesPaidCents -
    flows.drawsCents +
    flows.cashAdjustmentsCents
  );
}

/**
 * Stock at cost (SPEC §9): for each roll, its cost − the costs allocated to its sale lines and
 * losses, exact to the cent.
 */
export function stockAtCostCents(
  rolls: readonly { costTotalCents: number; allocatedCostsCents: readonly number[] }[],
): number {
  let total = 0;
  for (const roll of rolls)
    total += unallocatedCostCents(roll.costTotalCents, roll.allocatedCostsCents);
  return total;
}

export interface ReceivableInvoice extends SaleAmounts {
  /** This invoice's payments, oldest first. */
  paymentsCents: readonly number[];
  /** Written off as a bad debt: its unrecovered capital was booked as a loss (S5). */
  writtenOff?: boolean;
}

/**
 * What the shop's invoices (non-voided) hold for the integrity check: the capital still in
 * customers' debts (SPEC §9), and the overpayments the shop holds for customers (I1).
 */
export function receivablesPosition(invoices: readonly ReceivableInvoice[]): {
  unrecoveredCapitalCents: number;
  customerCreditsCents: number;
} {
  let unrecovered = 0;
  let credits = 0;
  for (const invoice of invoices) {
    // A written-off invoice's capital was booked as a loss; money paid beyond it is still credit.
    if (!invoice.writtenOff) unrecovered += unrecoveredCapitalCents(invoice, invoice.paymentsCents);
    credits += Math.max(0, -amountDueCents(invoice.totalCents, invoice.paymentsCents));
  }
  return { unrecoveredCapitalCents: unrecovered, customerCreditsCents: credits };
}

/** The two sides of SPEC §9, each amount derived from the records with the functions above. */
export interface IntegrityState {
  /** cashBalanceCents. */
  cashCents: number;
  /** stockAtCostCents. */
  stockAtCostCents: number;
  /** receivablesPosition. */
  unrecoveredCapitalCents: number;
  /** Σ capital_move of both partners, retained profit included (partnerCapital). */
  capitalCents: number;
  /** Σ undrawn profit of both partners (partnerBalance); negative when they drew more. */
  partnerBalancesCents: number;
  /** periodNetProfit of the open period so far, carried deficit included; may be negative. */
  unsettledNetProfitCents: number;
  /** receivablesPosition: money held for customers who overpaid (I1). */
  customerCreditsCents: number;
}

export type IntegrityLineKey =
  | 'cash'
  | 'stock_at_cost'
  | 'unrecovered_capital'
  | 'capital'
  | 'partner_balances'
  | 'unsettled_net_profit'
  | 'customer_credits';

export interface IntegrityLine {
  /** holdings: what the shop has; claims: whose it is. */
  side: 'holdings' | 'claims';
  key: IntegrityLineKey;
  cents: number;
}

export interface IntegrityResult {
  ok: boolean;
  /** holdings − claims: positive = more is held than the records account for. */
  diffCents: number;
  holdingsCents: number;
  claimsCents: number;
  /** The UI labels each key through i18n ("فرق: X درهم، راجع الحركات الأخيرة"). */
  breakdown: IntegrityLine[];
}

/**
 * The integrity check (SPEC §9, T13): cash + stock at cost + capital still in customers' debts
 * must equal capital (retained profit included) + undrawn partner balances + the unsettled net
 * profit + customer credits, to the cent. It holds while there are no supplier debts.
 *
 * It catches records that disagree with each other, such as a roll whose cost no longer matches
 * its purchase, or a record changed inside a settled period. A consistent omission (a sale
 * never entered) only shows up in the physical cash count.
 */
export function checkIntegrity(state: IntegrityState): IntegrityResult {
  assertInteger(state.cashCents, 'cashCents');
  assertInteger(state.stockAtCostCents, 'stockAtCostCents', 0);
  assertInteger(state.unrecoveredCapitalCents, 'unrecoveredCapitalCents', 0);
  assertInteger(state.capitalCents, 'capitalCents');
  assertInteger(state.partnerBalancesCents, 'partnerBalancesCents');
  assertInteger(state.unsettledNetProfitCents, 'unsettledNetProfitCents');
  assertInteger(state.customerCreditsCents, 'customerCreditsCents', 0);

  const breakdown: IntegrityLine[] = [
    { side: 'holdings', key: 'cash', cents: state.cashCents },
    { side: 'holdings', key: 'stock_at_cost', cents: state.stockAtCostCents },
    { side: 'holdings', key: 'unrecovered_capital', cents: state.unrecoveredCapitalCents },
    { side: 'claims', key: 'capital', cents: state.capitalCents },
    { side: 'claims', key: 'partner_balances', cents: state.partnerBalancesCents },
    { side: 'claims', key: 'unsettled_net_profit', cents: state.unsettledNetProfitCents },
    { side: 'claims', key: 'customer_credits', cents: state.customerCreditsCents },
  ];
  const total = (side: IntegrityLine['side']) =>
    breakdown.filter((line) => line.side === side).reduce((sum, line) => sum + line.cents, 0);
  const holdingsCents = total('holdings');
  const claimsCents = total('claims');
  const diffCents = holdingsCents - claimsCents;
  assertInteger(diffCents, 'diffCents');
  return { ok: diffCents === 0, diffCents, holdingsCents, claimsCents, breakdown };
}
