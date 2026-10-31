import {
  cashBalanceCents,
  checkIntegrity,
  type IntegrityLineKey,
  type IntegrityState,
  partnerBalance,
  partnerCapital,
  periodNetProfit,
  periodResultOf,
  receivablesPosition,
  stockAtCostCents,
} from '@fabric/core';
import { z } from 'zod';
import { cashFlowsOf } from './cash-counts.js';
import { isoDateSchema } from './common.js';
import type { Payment } from './customers.js';
import type { CapitalMove, PartnerDraw } from './partners.js';
import type { Purchase } from './purchasing.js';
import {
  latestSettlementOf,
  periodBasisOf,
  type SettlementRecords,
  type SettlementShare,
} from './settlements.js';

/** Past any real date: the open period runs from the last settlement to the end of the records. */
const OPEN_PERIOD_END = '9999-12-31';

/** Everything the integrity check is derived from, voided records included. */
export interface IntegrityRecords extends SettlementRecords {
  payments: readonly Payment[];
  purchases: readonly Purchase[];
  capitalMoves: readonly CapitalMove[];
  draws: readonly PartnerDraw[];
  settlementShares: readonly SettlementShare[];
}

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/**
 * The integrity check's amounts (SPEC §9, BUILD_PROMPTS 4.4), each from the records alone:
 * - cash: the money the records say the shop has, cash counts included (cashBalanceCents);
 * - stock at cost: each roll's cost less what its sales and losses took, frozen costs kept;
 * - capital still in customers' debts, and the credits held for them: money paid in and neither
 *   applied to a live invoice nor refunded (P6, P14), plus any invoice paid beyond its total (I1);
 * - capital (retained profit included), the partners' undrawn shares less their draws;
 * - the net profit not settled yet: everything after the last settlement, its carried deficit
 *   included (periodResultOf, as the next settlement will count it).
 */
export function integrityStateOf(records: IntegrityRecords): IntegrityState {
  const basis = periodBasisOf(records);
  const latest = latestSettlementOf(records.settlements);
  const receivables = receivablesPosition(
    basis.sales.map(({ period }) => ({
      totalCents: period.totalCents,
      capitalCents: period.capitalCents,
      paymentsCents: period.allocations.map((allocation) => allocation.amountCents),
      writtenOff: period.writtenOffOn !== null,
    })),
  );
  // Per customer, so one customer's over-applied money never hides another's credit.
  const liveSales = new Set(basis.sales.map(({ sale }) => sale.id));
  const paymentsById = new Map(records.payments.map((payment) => [payment.id, payment]));
  const creditByCustomer = new Map<string, number>();
  const add = (customerId: string | null, cents: number) => {
    const key = customerId ?? '';
    creditByCustomer.set(key, (creditByCustomer.get(key) ?? 0) + cents);
  };
  for (const payment of live(records.payments)) {
    add(
      payment.customerId,
      payment.kind === 'payment' ? payment.amountCents : -payment.amountCents,
    );
  }
  for (const allocation of records.allocations) {
    const payment = paymentsById.get(allocation.paymentId);
    if (payment && liveSales.has(allocation.saleId))
      add(payment.customerId, -allocation.amountCents);
  }
  const unappliedCents = [...creditByCustomer.values()].reduce(
    (sum, cents) => sum + Math.max(0, cents),
    0,
  );

  return {
    cashCents: cashBalanceCents(cashFlowsOf(records)),
    stockAtCostCents: stockAtCostCents(
      records.rolls.map((roll) => ({
        costTotalCents: roll.costTotalCents,
        allocatedCostsCents: (basis.ledgers.get(roll.id)?.costs ?? []).map(
          (cost) => cost.costCents,
        ),
      })),
    ),
    unrecoveredCapitalCents: receivables.unrecoveredCapitalCents,
    capitalCents: partnerCapital(
      live(records.capitalMoves).map((move) => ({
        type: move.type,
        amountCents: move.amountCents,
      })),
    ),
    partnerBalancesCents: partnerBalance(
      records.settlementShares.map((share) => ({
        amountCents: share.amountCents,
        voided: share.voidedAt !== null,
      })),
      records.draws.map((draw) => ({
        amountCents: draw.amountCents,
        voided: draw.voidedAt !== null,
      })),
    ),
    unsettledNetProfitCents: periodNetProfit(
      periodResultOf(
        basis.records,
        { after: latest?.periodEnd ?? null, end: OPEN_PERIOD_END },
        latest?.carryDeficitOutCents ?? 0,
      ),
    ).netProfitCents,
    customerCreditsCents: receivables.customerCreditsCents + unappliedCents,
  };
}

/** The breakdown's lines, in order (@fabric/core checkIntegrity). */
export const INTEGRITY_LINE_KEYS = [
  'cash',
  'stock_at_cost',
  'unrecovered_capital',
  'capital',
  'partner_balances',
  'unsettled_net_profit',
  'customer_credits',
] as const satisfies readonly IntegrityLineKey[];

/** GET /integrity, and the device's own check: the same function on the same records. */
export const integrityReportSchema = z.object({
  ok: z.boolean(),
  /** holdings − claims: positive = more is held than the records account for. */
  diffCents: z.int(),
  holdingsCents: z.int(),
  claimsCents: z.int(),
  breakdown: z.array(
    z.object({
      side: z.enum(['holdings', 'claims']),
      key: z.enum(INTEGRITY_LINE_KEYS),
      cents: z.int(),
    }),
  ),
  /** The last settled day (null before the first settlement). */
  lockedThrough: isoDateSchema.nullable(),
});
export type IntegrityReport = z.output<typeof integrityReportSchema>;

/** The integrity check (@fabric/core checkIntegrity, T13) on the records. */
export function integrityReportOf(records: IntegrityRecords): IntegrityReport {
  return {
    ...checkIntegrity(integrityStateOf(records)),
    lockedThrough: latestSettlementOf(records.settlements)?.periodEnd ?? null,
  };
}
